import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Eyebrow, PageTitle, Screen } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageProvider';
import { recipeTitle } from '@/services/recommendations';
import { getRecipe } from '@/services/recipes';
import { recipePortion } from '@/utils/mealSuggestions';
import { formatNumber } from '@/utils/format';
import { typeScale } from '@/constants/theme';

export default function RecipeScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { language, locale, t } = useLanguage();
  const { id, portion } = useLocalSearchParams<{ id?: string; portion?: string }>();
  const portionScale = recipePortion(portion);
  // `language` is in the dependencies because these read it through the
  // non-React mirror. The stored language lands one render after the device
  // guess, and without it a German phone showed an English reader German
  // ingredients under English headings.
  const recipe = useMemo(() => (id ? getRecipe(id, portionScale) : null), [id, language, portionScale]);
  const title = useMemo(() => (id ? recipeTitle(id) : ''), [id, language]);
  // The weighing rule is a note about the amounts, not a cooking step.
  const weighingNote = recipe?.steps[0] === t.recipe.weighingInstructions ? recipe.steps[0] : null;
  const cookingSteps = weighingNote ? recipe!.steps.slice(1) : recipe?.steps ?? [];

  if (!recipe) {
    return (
      <Screen>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <PageTitle>{t.recipe.missingTitle}</PageTitle>
        <Text style={styles.missing}>{t.recipe.missingText}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <Text style={styles.topTitle}>{t.recipe.title}</Text>
        <View style={styles.iconButtonSpacer} />
      </View>

      <View style={styles.heading}>
        <Eyebrow>{portionScale === 1 ? t.recipe.forServings(recipe.servings) : t.plan.portionOfStandard(formatNumber(Math.round(portionScale * 100), locale))}</Eyebrow>
        <PageTitle>{title}</PageTitle>
      </View>

      <Card style={styles.macroCard}>
        <View style={styles.macroRow}>
          <Text style={styles.macroValue}>{formatNumber(recipe.nutrition.calories, locale)}</Text>
          <Text style={styles.macroUnit}>kcal</Text>
        </View>
        <Text style={styles.macroDetail}>
          {recipe.nutrition.protein} g {t.common.protein} · {recipe.nutrition.carbs} g {t.common.carbs} · {recipe.nutrition.fat} g {t.common.fat}
        </Text>
      </Card>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.recipe.ingredients}</Text>
        <Card style={styles.listCard}>
          {recipe.ingredients.map((ingredient, index) => (
            <View key={ingredient.key}>
              <View style={styles.ingredientRow}>
                <View style={{ flex: 1, paddingVertical: 8, gap: 3 }}><Text style={styles.ingredientName}>{ingredient.name}</Text><Text style={styles.ingredientState}>{ingredient.weighingLabel}</Text></View>
                {/* Kitchen precision: whole grams from 10 g; the calories use the exact amounts. */}
                <Text style={styles.ingredientAmount}>{ingredient.grams.toLocaleString(locale, { maximumFractionDigits: ingredient.grams >= 10 ? 0 : 1 })} g</Text>
              </View>
              {index < recipe.ingredients.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </Card>
        {/*
          The amounts are what the calorie figure above was summed from, so the
          two can never drift apart. Saying so is the difference between a
          recipe and a number somebody asserted.
        */}
        <Text style={styles.note}>{t.recipe.note}</Text>
        {weighingNote ? <Text style={styles.note}>{weighingNote}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t.recipe.steps}</Text>
        {cookingSteps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  iconButtonSpacer: { width: 42, height: 42 },
  topTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  heading: { gap: 6 },
  missing: { ...typeScale.subhead, color: colors.muted },
  macroCard: { gap: 4 },
  macroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  macroValue: { ...typeScale.display, color: colors.text, fontWeight: '700' },
  macroUnit: { ...typeScale.callout, color: colors.muted, fontWeight: '600' },
  macroDetail: { ...typeScale.footnote, color: colors.muted },
  section: { gap: 10 },
  sectionTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  listCard: { padding: 6 },
  ingredientRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 12 },
  ingredientName: { ...typeScale.subhead, flex: 1, color: colors.text, fontWeight: '600' },
  ingredientState: { ...typeScale.footnote, color: colors.muted },
  ingredientAmount: { ...typeScale.subhead, color: colors.muted, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 12 },
  note: { ...typeScale.caption, color: colors.muted },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { ...typeScale.caption, color: colors.onAccent, fontWeight: '800' },
  stepText: { ...typeScale.subhead, flex: 1, color: colors.text, paddingTop: 3 },
});
