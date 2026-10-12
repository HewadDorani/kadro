import { friendlySource } from '@/utils/sourceLabel';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PortionSheet } from '@/components/PortionSheet';
import { Card, PrimaryButton, Screen } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { FoodSearchResult, MealAnalysisError, searchIngredientReplacement } from '@/services/mealAnalysis';
import { formatNumber } from '@/utils/format';
import { milkCorrectionQuery } from '@/utils/foodCorrectionQuery';
import { needsIngredientCorrection } from '@/utils/ingredientCorrection';
import { typeScale } from '@/constants/theme';

export default function CorrectFoodScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { detectedItems, replaceDetectedItem } = useApp();
  const item = detectedItems.find(entry => entry.id === itemId);
  const { t, locale, language } = useLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const suggestionQuery = item && needsIngredientCorrection(item) ? milkCorrectionQuery(item.name) : null;
  const [query, setQuery] = useState(suggestionQuery ?? item?.name ?? '');
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [pendingFood, setPendingFood] = useState<FoodSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const initialSuggestions = useRef(true);

  const changeQuery = (value: string) => {
    initialSuggestions.current = false;
    generation.current += 1;
    inFlight.current = false;
    setBusy(false);
    setQuery(value);
    setResults([]);
    setError(null);
    setNotice(null);
    setSearched(false);
  };

  const search = useCallback(async (term: string) => {
    if (inFlight.current || term.trim().length < 2) return;
    const current = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    setSearched(false);
    setError(null);
    setNotice(null);
    setResults([]);
    Keyboard.dismiss();
    try {
      const foods = await searchIngredientReplacement(term);
      if (current !== generation.current) return;
      setNotice(foods.searchStatus === 'partial' ? t.errors.searchPartial : null);
      setResults(foods);
      setSearched(true);
    } catch (failure) {
      if (current !== generation.current) return;
      setError(failure instanceof MealAnalysisError ? failure.message : t.errors.analysisFailed);
    } finally {
      if (current === generation.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }, [t.errors.analysisFailed, t.errors.searchPartial, language, locale]);

  useFocusEffect(useCallback(() => {
    // A request cancelled when leaving the screen must not strand the retry.
    setBusy(false);
    setResults([]);
    setSearched(false);
    if (initialSuggestions.current && suggestionQuery) {
      initialSuggestions.current = false;
      void search(suggestionQuery);
    }
    return () => {
      generation.current += 1;
      inFlight.current = false;
    };
  }, [search, suggestionQuery]));

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.back} onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>{t.confirm.replaceFood}</Text>
      </View>
      {!item ? <PrimaryButton label={t.common.back} onPress={() => router.replace('/confirm')} /> : <>
        <Text style={styles.foodName}>{item.name}</Text>
        <Text style={styles.copy}>{t.confirm.correctionHint}</Text>
        {suggestionQuery ? <Text style={styles.copy}>{t.confirm.milkCorrectionHint}</Text> : null}
        <TextInput
          accessibilityLabel={t.confirm.correctionSearch}
          placeholder={t.confirm.correctionSearch}
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={changeQuery}
          onSubmitEditing={() => void search(query)}
          maxLength={120}
          returnKeyType="search"
          autoCorrect={false}
          style={styles.input}
        />
        <PrimaryButton disabled={busy || query.trim().length < 2} label={busy ? t.scan.searchSearching : t.confirm.correctionSearchButton} onPress={() => void search(query)} />
        {busy ? <ActivityIndicator color={colors.accentText} /> : null}
        {notice ? <Text style={styles.copy}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.copy}>{error}</Text> : null}
        {!busy && !error && !notice && searched && !results.length ? <Text style={styles.copy}>{t.scan.searchEmpty}</Text> : null}
        {results.map(food => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${food.name}: ${t.confirm.replaceFood}`} key={food.id} onPress={() => { Keyboard.dismiss(); setPendingFood(food); }}>
            <Card style={styles.result}>
              <View style={styles.resultCopy}>
                <Text style={styles.foodName}>{food.name}</Text>
                <Text style={styles.copy}>{formatNumber(food.per100g.calories, locale)} kcal · {t.scan.searchPer100}</Text>
                <Text style={styles.source}>{friendlySource(food.source.label) ?? ''}</Text>
              </View>
              <Ionicons name="chevron-forward" color={colors.accentText} size={22} />
            </Card>
          </Pressable>
        ))}
        <PortionSheet
          visible={pendingFood !== null}
          target={pendingFood ? {
            name: pendingFood.name, per100g: pendingFood.per100g,
            defaultGrams: item.amountG, amountIsChosen: true,
            portions: pendingFood.portions, sourceLabel: pendingFood.source.label,
          } : null}
          onCancel={() => setPendingFood(null)}
          onConfirm={grams => {
            if (!pendingFood) return;
            replaceDetectedItem(item.id, pendingFood, grams);
            setPendingFood(null);
            router.back();
          }}
        />
      </>}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { ...typeScale.title2, flex: 1, color: colors.text, fontWeight: '700' },
  foodName: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  copy: { ...typeScale.subhead, color: colors.muted },
  source: { ...typeScale.footnote, color: colors.muted },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, padding: 14, fontSize: 17 },
  result: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultCopy: { flex: 1, gap: 6 },
});
