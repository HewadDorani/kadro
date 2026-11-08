import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { loggedAmountLabel } from '@/components/MealDetailSheet';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useCustomFoods } from '@/hooks/useCustomFoods';
import { useLanguage } from '@/i18n/LanguageProvider';
import { customFoodResult, matchCustomFoods } from '@/services/customFoods';
import { foodUsage, frequentFoods, historyMatches, mergeSuggestions, recentFoods, suggestFoods } from '@/services/foodSuggest';
import { selectionHaptic } from '@/services/haptics';
import { searchProducts, type FoodSearchResult } from '@/services/mealAnalysis';
import { productSearchHint } from '@/services/productSearch';
import { getMarketRegion } from '@/services/region';
import { visibleFavorites } from '@/services/repeatMeals';
import type { Meal } from '@/types/nutrition';
import { formatNumber } from '@/utils/format';

/** Same pause as the scan tab's product search: one request per word, not per key. */
const SEARCH_DEBOUNCE_MS = 350;
const RESULT_LIMIT = 30;

export type PickerTab = 'frequent' | 'recent' | 'favorites';

/** The amount a one-tap add uses: last time's, else the food's first portion. */
export function quickGrams(food: FoodSearchResult) {
  return food.lastGrams ?? food.defaultGrams;
}

/** Stable key of a food, so a pick and its row recognise each other. */
export function foodKey(food: FoodSearchResult) {
  return food.source.referenceId ? `${food.source.provider}-${food.source.referenceId}` : food.id;
}

/**
 * The food list of a meal page, Yazio-style: search field, the tabs Häufig /
 * Zuletzt / Favoriten when it is empty, and every row with a + that adds the
 * food at once with its last amount. Tapping the row itself asks for the
 * amount. What this person already ate leads every typed search.
 */
export const MealFoodPicker = forwardRef<TextInput, {
  placeholder: string;
  picked: ReadonlySet<string>;
  onToggle: (food: FoodSearchResult) => void;
  onDetail: (food: FoodSearchResult) => void;
  onFavorite: (meal: Meal) => void;
  onMoreOptions: (query: string) => void;
}>(function MealFoodPicker({ placeholder, picked, onToggle, onDetail, onFavorite, onMoreOptions }, inputRef) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { favoriteMeals, mealHistory } = useApp();
  const { language, locale, t } = useLanguage();
  const customFoods = useCustomFoods(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<PickerTab | null>(null);
  const [remote, setRemote] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);
  const term = query.trim();

  const usage = useMemo(() => foodUsage(mealHistory), [mealHistory]);
  const myProducts = useMemo(() => customFoods.slice(0, 5).map(customFoodResult), [customFoods, language]);
  const frequent = useMemo(() => frequentFoods(mealHistory, 12), [mealHistory, language]);
  const recents = useMemo(() => recentFoods(mealHistory, 30), [mealHistory, language]);
  const favorites = useMemo(() => visibleFavorites(favoriteMeals), [favoriteMeals]);
  const activeTab = tab ?? (myProducts.length || frequent.length ? 'frequent' : 'recent');

  // Products and the gateway catalogue arrive after a short pause; local
  // matches show at once. A slower earlier answer never replaces a newer one.
  useEffect(() => {
    const current = ++generation.current;
    if (term.length < 2) { setRemote([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchProducts(term, { brands: productSearchHint(term, getMarketRegion()).brands })
        .then(results => { if (current === generation.current) setRemote([...results.generic, ...results.products]); })
        .catch(() => { if (current === generation.current) setRemote([]); })
        .finally(() => { if (current === generation.current) setSearching(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const eaten = useMemo(() => historyMatches(term, mealHistory), [term, mealHistory, language]);
  const others = useMemo(() => {
    if (term.length < 2) return [];
    const local = mergeSuggestions(matchCustomFoods(term, customFoods), suggestFoods(term, usage));
    return mergeSuggestions(eaten, mergeSuggestions(local, remote)).slice(eaten.length, eaten.length + RESULT_LIMIT);
  }, [customFoods, eaten, remote, term, usage]);

  const row = (food: FoodSearchResult) => {
    const grams = quickGrams(food);
    const on = picked.has(foodKey(food));
    return (
      <View key={food.id} style={styles.row}>
        <Pressable accessibilityHint={t.mealSlot.amountHint} accessibilityRole="button" onPress={() => onDetail(food)} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={styles.rowName}>{food.name}</Text>
          <Text numberOfLines={1} style={styles.rowMeta}>
            {[food.brand, loggedAmountLabel({ amountG: grams, portions: food.portions } as Meal['items'][number], locale), `${formatNumber(Math.round(food.per100g.calories * grams / 100), locale)} kcal`].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={on ? t.mealSlot.removePick(food.name) : t.mealSlot.addPick(food.name)}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          hitSlop={8}
          onPress={() => { void selectionHaptic(); onToggle(food); }}
          style={[styles.add, on && styles.addOn]}
        >
          <Ionicons color={on ? colors.white : colors.accentText} name={on ? 'checkmark' : 'add'} size={20} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputWrap}>
        <Ionicons color={colors.muted} name="search" size={18} />
        <TextInput
          accessibilityLabel={placeholder}
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxLength={60}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          ref={inputRef}
          returnKeyType="search"
          style={styles.input}
          value={query}
        />
      </View>

      {term.length < 2 ? <>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {(['frequent', 'recent', 'favorites'] as const).map(id => (
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: activeTab === id }} key={id} onPress={() => { void selectionHaptic(); setTab(id); }} style={[styles.tab, activeTab === id && styles.tabOn]}>
              <Text style={[styles.tabText, activeTab === id && styles.tabTextOn]}>{id === 'frequent' ? t.scan.tabFrequent : id === 'recent' ? t.scan.tabRecent : t.scan.tabFavorites}</Text>
            </Pressable>
          ))}
        </View>
        {activeTab === 'frequent' ? <>
          {[...myProducts, ...frequent].map(row)}
          {!myProducts.length && !frequent.length ? <Text style={styles.empty}>{t.scan.tabFrequentEmpty}</Text> : null}
        </> : activeTab === 'recent' ? <>
          {recents.map(row)}
          {!recents.length ? <Text style={styles.empty}>{t.scan.tabRecentEmpty}</Text> : null}
        </> : <>
          {favorites.map(favorite => (
            <View key={favorite.key} style={styles.row}>
              <View style={styles.rowMain}>
                <Text numberOfLines={1} style={styles.rowName}>{favorite.meal.title}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>{t.scan.favoriteItems(favorite.meal.items.filter(item => item.included).length, formatNumber(favorite.meal.calories, locale))}</Text>
              </View>
              <Pressable accessibilityLabel={t.mealSlot.addPick(favorite.meal.title)} accessibilityRole="button" hitSlop={8} onPress={() => { void selectionHaptic(); onFavorite(favorite.meal); }} style={styles.add}>
                <Ionicons color={colors.accentText} name="add" size={20} />
              </Pressable>
            </View>
          ))}
          {!favorites.length ? <Text style={styles.empty}>{t.scan.tabFavoritesEmpty}</Text> : null}
        </>}
      </> : <>
        {eaten.length ? <Text accessibilityRole="header" style={styles.section}>{t.scan.eatenTitle}</Text> : null}
        {eaten.map(row)}
        {others.length ? <Text accessibilityRole="header" style={styles.section}>{t.mealSlot.results}</Text> : null}
        {others.map(row)}
        {searching && !eaten.length && !others.length ? <Text style={styles.empty}>{t.scan.searchSearching}</Text> : null}
        {!searching && !eaten.length && !others.length ? <Text style={styles.empty}>{t.scan.searchEmpty}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => onMoreOptions(term)} style={styles.more}>
          <Ionicons color={colors.accentText} name="create-outline" size={18} />
          <Text style={styles.moreText}>{t.mealSlot.moreOptions}</Text>
        </Pressable>
      </>}
    </View>
  );
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: 2 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14 },
  input: { ...typeScale.body, flex: 1, color: colors.text, paddingVertical: 12 },
  tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: radii.pill, backgroundColor: colors.neutralSoft, marginTop: 12, marginBottom: 6 },
  tab: { flex: 1, minHeight: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.surface },
  tabText: { ...typeScale.subhead, color: colors.muted, fontWeight: '600' },
  tabTextOn: { color: colors.text },
  section: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 11 },
  pressed: { opacity: 0.6 },
  rowName: { ...typeScale.label, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typeScale.footnote, color: colors.muted },
  add: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.accentText, alignItems: 'center', justifyContent: 'center' },
  addOn: { backgroundColor: colors.accentText, borderColor: colors.accentText },
  empty: { ...typeScale.subhead, color: colors.muted, paddingVertical: 14 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  moreText: { ...typeScale.subhead, color: colors.accentText, fontWeight: '600' },
});
