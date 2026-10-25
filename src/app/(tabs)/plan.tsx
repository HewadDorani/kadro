import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Eyebrow, IconCircle, PageTitle, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { hasRecipe } from '@/services/recipes';
import { useSubscription } from '@/context/SubscriptionContext';
import { recordRecommendationFeedback, recordRecommendationSet } from '@/services/cloudRepository';
import { recommendMeals } from '@/services/recommendations';
import { ComboPortion, comboSearchEntries, productDisplayName, StoreId, supermarketCombos, SupermarketCombo, supermarketDataset } from '@/services/supermarketCombos';
import { useMarketRegion } from '@/services/region';
import { SMALL_MEAL_CALORIES, suggestedNutrition } from '@/utils/mealSuggestions';
import { trackEvent } from '@/services/telemetry';
import { useLanguage } from '@/i18n/LanguageProvider';
import { MealContext, MealSuggestion, PortionFactor } from '@/types/nutrition';
import { formatNumber } from '@/utils/format';
import { selectionHaptic, successHaptic } from '@/services/haptics';


export default function PlanScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ context?: string; fromScan?: string }>();
  const router = useRouter();
  const { consumed, freeScansLeft, hasLoggedScan, logPlannedMeal, profile, remaining, startPlannedDraft, targets } = useApp();
  const { language, locale, t } = useLanguage();
  // Supermarkt follows the shopping region: Tesco in the UK, Walmart in the US.
  const region = useMarketRegion();
  const marketData = supermarketDataset(region);
  const contexts: { id: MealContext; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'home', title: t.plan.ctxHome, detail: t.plan.ctxHomeDetail, icon: 'home-outline' },
    { id: 'supermarket', title: t.plan.ctxMarket, detail: t.plan.ctxMarketStores[region], icon: 'basket-outline' },
    { id: 'eating-out', title: t.plan.ctxOut, detail: t.plan.ctxOutDetail, icon: 'restaurant-outline' },
  ];
  const { status: subscriptionStatus } = useSubscription();
  const [selected, setSelected] = useState<MealContext | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [portion, setPortion] = useState<PortionFactor>(1);
  const [logging, setLogging] = useState(false);
  const [loggedTitle, setLoggedTitle] = useState<string | null>(null);
  const recordedSet = useRef('');

  useEffect(() => {
    if (params.context && contexts.some((context) => context.id === params.context)) {
      setSelected(params.context as MealContext);
    }
  }, [params.context]);

  const availableCalories = targets.calories - consumed.calories;
  const smallBudget = availableCalories < SMALL_MEAL_CALORIES;
  const suggestions = useMemo(
    () => (selected ? recommendMeals(selected, remaining, profile.preferences) : []),
    // `language` picks the catalogue, and it arrives one render after the
    // device guess.
    [language, profile.preferences, remaining, selected],
  );
  // Supermarkt shows real products. The dish catalogue stays the fallback if
  // the bundled product data ever cannot fill three baskets.
  const combos = useMemo(
    () => (selected === 'supermarket' ? supermarketCombos(remaining, profile.preferences, marketData.products) : []),
    [marketData, profile.preferences, remaining, selected],
  );
  const marketMode = selected === 'supermarket' && combos.length === 3;
  const options: { id: string; calories: number; protein: number }[] = marketMode ? combos : suggestions;
  const range = (key: 'calories' | 'protein') => {
    const values = options.map((option) => option[key]);
    const low = Math.min(...values), high = Math.max(...values);
    return low === high ? formatNumber(low, locale) : `${formatNumber(low, locale)}–${formatNumber(high, locale)}`;
  };

  useEffect(() => {
    if (!selected || options.length !== 3) return;
    const key = `${selected}:${remaining.calories}:${remaining.protein}:${options.map((option) => option.id).join(',')}`;
    if (recordedSet.current === key) return;
    recordedSet.current = key;
    trackEvent('recommendation set viewed', { meal_context: selected });
    const recorded: MealSuggestion[] = marketMode
      ? combos.map((combo) => ({ id: combo.id, title: '', detail: '', time: '', calories: combo.calories, protein: combo.protein, carbs: combo.carbs, fat: combo.fat }))
      : suggestions;
    void recordRecommendationSet(selected, remaining, recorded).catch(() => {
      recordedSet.current = '';
    });
  }, [combos, marketMode, options, remaining, selected, suggestions]);

  const portionAmount = (portion: ComboPortion) => {
    const [one, many] = t.plan.marketPortion[portion.container];
    return portion.kind === 'half' ? t.plan.marketHalf(one) : t.plan.marketCount(portion.count, portion.count === 1 ? one : many);
  };
  const portionLabel = (portion: ComboPortion) => `${portionAmount(portion)} · ${t.plan.marketGrams(formatNumber(portion.grams, locale), portion.estimated)}`;

  /**
   * A basket is several products eaten as one meal. It opens the normal
   * confirm screen prefilled with every product and amount, so the person can
   * still change what they actually bought before it is logged.
   */
  const takeCombo = (combo: SupermarketCombo, rank: number) => {
    if (!selected) return;
    void selectionHaptic();
    trackEvent('recommendation selected', { meal_context: selected, rank: rank as 1 | 2 | 3 });
    void recordRecommendationFeedback(selected, combo.id, 'accepted').catch(() => undefined);
    // Confirm and the portion sheet print the grams themselves.
    startPlannedDraft(comboSearchEntries(combo, language, portionAmount));
    router.push('/confirm');
  };

  const chooseContext = (context: MealContext) => {
    void selectionHaptic();
    setSelected(context);
    setChosen(null);
  };

  const chooseMeal = (id: string) => {
    void selectionHaptic();
    if (selected && chosen !== id) {
      const rank = suggestions.findIndex((suggestion) => suggestion.id === id) + 1;
      if (rank >= 1 && rank <= 3) {
        trackEvent('recommendation selected', { meal_context: selected, rank: rank as 1 | 2 | 3 });
      }
      if (chosen && chosen !== id) void recordRecommendationFeedback(selected, chosen, 'rejected').catch(() => undefined);
      void recordRecommendationFeedback(selected, id, 'accepted').catch(() => undefined);
    }
    setChosen((current) => (current === id ? null : id));
    setPortion(1);
  };

  /**
   * Choosing a suggestion used to set local state and nothing else: no entry,
   * no calories, no change to the day. The one thing the whole product promises
   * is that the day re-plans after every meal, so this is where it happens.
   */
  const paywallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      if (paywallTimer.current) clearTimeout(paywallTimer.current);
      paywallTimer.current = null;
    };
  }, []));

  const logMeal = async (suggestion: MealSuggestion) => {
    if (logging) return;
    setLogging(true);
    try {
      await logPlannedMeal(suggestion, portion);
      void successHaptic();
      setLoggedTitle(suggestion.title);
      setChosen(null);
      // The paywall belongs after the value, never between choosing and eating.
      if (focused.current && params.fromScan === '1' && subscriptionStatus !== 'active' && freeScansLeft === 0) {
        if (paywallTimer.current) clearTimeout(paywallTimer.current);
        paywallTimer.current = setTimeout(() => router.push('/paywall?reason=after-meal'), 900);
      }
    } finally {
      setLogging(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Eyebrow>{t.plan.eyebrow}</Eyebrow>
          <PageTitle>{t.plan.title}</PageTitle>
          <Text style={styles.subtitle}>{t.plan.subtitle}</Text>
        </View>
        <IconCircle name="sparkles" size={48} />
      </View>

      <Card style={styles.balanceCard}>
        <View>
          <Text style={styles.balanceLabel}>{t.plan.afterMeals}</Text>
          <Text style={styles.balanceValue}>{availableCalories < 0 ? t.plan.kcalOver(formatNumber(-availableCalories, locale)) : t.plan.kcalLeft(formatNumber(availableCalories, locale))}</Text>
        </View>
        <View style={styles.proteinPill}>
          <Ionicons color={colors.success} name="barbell-outline" size={16} />
          <Text style={styles.proteinText}>{t.plan.proteinLeft(remaining.protein)}</Text>
        </View>
      </Card>

      <View style={styles.contextList}>
        {contexts.map((context) => {
          const active = selected === context.id;
          return (
            <Pressable aria-checked={active} accessibilityRole="radio" accessibilityState={{ checked: active }} key={context.id} onPress={() => chooseContext(context.id)} style={[styles.contextCard, active && styles.contextActive]}>
              <IconCircle name={context.icon} size={52} tone={active ? 'accent' : 'neutral'} />
              <View style={styles.contextCopy}>
                <Text style={styles.contextTitle}>{context.title}</Text>
                <Text style={styles.contextDetail}>{context.detail}</Text>
              </View>
              <View style={[styles.chevron, active && styles.chevronActive]}>
                <Ionicons color={active ? colors.onAccent : colors.text} name={active ? 'checkmark' : 'arrow-forward'} size={19} />
              </View>
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <View style={styles.results}>
          {loggedTitle ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/today')}
              style={styles.loggedBanner}
            >
              <View style={styles.loggedIcon}><Ionicons color={colors.text} name="checkmark" size={18} /></View>
              <View style={styles.loggedCopy}>
                <Text style={styles.loggedTitle}>{t.plan.loggedTitle(loggedTitle)}</Text>
                <Text style={styles.loggedText}>
                  {t.plan.loggedText(formatNumber(remaining.calories, locale), remaining.protein)}
                </Text>
              </View>
              <Ionicons color={colors.text} name="chevron-forward" size={18} />
            </Pressable>
          ) : null}

          {smallBudget ? (
            <Card style={styles.dayDone}>
              <IconCircle name="information-circle-outline" size={40} tone="neutral" />
              <Text style={styles.dayDoneTitle}>{t.plan.dayDoneTitle}</Text>
              <Text style={styles.dayDoneText}>{t.plan.dayDoneText}</Text>
            </Card>
          ) : null}

          <View style={styles.resultsHeading}>
            <View>
              <Text style={styles.resultsTitle}>{t.plan.optionsTitle}</Text>
              <Text style={styles.resultsMeta}>{t.plan.optionsMeta(range('calories'), range('protein'))}</Text>
            </View>
            <Ionicons color={colors.accentText} name="checkmark-done" size={24} />
          </View>

          {marketMode ? combos.map((combo, index) => {
            const afterMeal = Math.round(availableCalories - combo.calories);
            const estimated = combo.items.some((item) => item.portion.estimated);
            const prefix = estimated ? '~' : '';
            return (
              <Card key={combo.id} style={styles.suggestion}>
                <View style={styles.suggestionTop}>
                  <View style={styles.rank}><Text style={styles.rankText}>0{index + 1}</Text></View>
                  <View style={styles.comboItems}>
                    {combo.items.map((item) => (
                      <View key={item.product.id} style={styles.comboItem}>
                        <Text style={styles.suggestionTitle}>{productDisplayName(item.product, language)}</Text>
                        <Text style={styles.suggestionDetail}>
                          {portionLabel(item.portion)} · {t.plan.marketItemMacros(formatNumber(item.calories, locale), item.protein)}
                        </Text>
                        {item.portion.estimated ? <Text style={styles.source}>{t.plan.marketEstimatedPiece}</Text> : null}
                        {item.product.stores.length ? (
                          <View style={styles.storeRow}>
                            {item.product.stores.map((store) => {
                              const storeName = t.plan.marketStores[store as StoreId] ?? store;
                              return (
                                <View
                                  accessibilityLabel={t.plan.marketStore(storeName)}
                                  accessible
                                  key={store}
                                  style={styles.storeChip}
                                >
                                  <Ionicons color={colors.muted} name="storefront-outline" size={12} />
                                  <Text style={styles.storeChipText}>{storeName}</Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
                <View style={styles.nutritionRow}>
                  <NutritionStat label="kcal" value={`${prefix}${formatNumber(combo.calories, locale)}`} />
                  <NutritionStat label={t.common.protein} value={`${prefix}${combo.protein} g`} />
                  <NutritionStat label={t.common.carbs} value={`${prefix}${combo.carbs} g`} />
                  <NutritionStat label={t.common.fat} value={`${prefix}${combo.fat} g`} />
                </View>
                <Text style={styles.portionResult}>
                  {afterMeal < 0 ? t.plan.afterOver(formatNumber(-afterMeal, locale)) : t.plan.afterLeft(formatNumber(afterMeal, locale))}
                </Text>
                <PrimaryButton
                  icon="basket-outline"
                  label={t.plan.marketTake}
                  onPress={() => takeCombo(combo, index + 1)}
                  variant="secondary"
                />
              </Card>
            );
          }) : suggestions.map((suggestion, index) => {
            const isChosen = chosen === suggestion.id;
            const relativePortion = isChosen ? portion : 1;
            const nutrition = suggestedNutrition(suggestion, relativePortion);
            const recipeScale = (suggestion.portionScale ?? 1) * relativePortion;
            const afterMeal = Math.round(availableCalories - nutrition.calories);
            return (
              <Card key={suggestion.id} style={[styles.suggestion, isChosen && styles.suggestionChosen]}>
                <View style={styles.suggestionTop}>
                  <View style={styles.rank}><Text style={styles.rankText}>0{index + 1}</Text></View>
                  <View style={styles.suggestionCopy}>
                    <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
                    <Text style={styles.suggestionDetail}>{suggestion.detail}</Text>
                    <Text style={styles.source}>{suggestion.source?.label}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.time}>{suggestion.time}</Text>
                </View>
                <View style={styles.nutritionRow}>
                  <NutritionStat label="kcal" value={`~${nutrition.calories}`} />
                  <NutritionStat label={t.common.protein} value={`~${nutrition.protein} g`} />
                  <NutritionStat label={t.common.carbs} value={`~${nutrition.carbs} g`} />
                </View>
                {recipeScale !== 1 ? <Text style={styles.source}>{t.plan.portionOfStandard(formatNumber(Math.round(recipeScale * 100), locale))}</Text> : null}
                <Text style={styles.portionResult}>
                  {afterMeal < 0 ? t.plan.afterOver(formatNumber(-afterMeal, locale)) : t.plan.afterLeft(formatNumber(afterMeal, locale))}
                </Text>
                <PrimaryButton
                  icon={isChosen ? 'chevron-up' : 'arrow-forward'}
                  label={isChosen ? t.plan.dropIt : t.plan.take}
                  onPress={() => chooseMeal(suggestion.id)}
                  variant={isChosen ? 'ghost' : 'secondary'}
                />
                {/*
                  Picking a dish used to end here, which leaves the reader with
                  the question they actually had: how do I make this.
                */}
                {hasRecipe(suggestion.id) ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/recipe?id=${suggestion.id}&portion=${recipeScale}` as never)}
                    style={styles.recipeLink}
                  >
                    <Ionicons color={colors.accentText} name="book-outline" size={18} />
                    <Text style={styles.recipeLinkText}>{t.recipe.open}</Text>
                    <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                  </Pressable>
                ) : null}
                {isChosen ? (
                  <View style={styles.portionBlock}>
                    <Text style={styles.portionLabel}>{t.plan.howMuch}</Text>
                    <View style={styles.portionSelector}>
                      {([
                        { factor: 0.7 as PortionFactor, label: t.confirm.less, multiplier: `${formatNumber(0.7, locale)}×` },
                        { factor: 1 as PortionFactor, label: t.plan.normal, multiplier: '1×' },
                        { factor: 1.4 as PortionFactor, label: t.confirm.more, multiplier: `${formatNumber(1.4, locale)}×` },
                      ]).map((choice) => {
                        const active = portion === choice.factor;
                        return (
                          <Pressable
                            aria-checked={active}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            key={choice.label}
                            onPress={() => { void selectionHaptic(); setPortion(choice.factor); }}
                            style={[styles.portionChoice, active && styles.portionChoiceActive]}
                          >
                            <Text style={[styles.portionChoiceLabel, active && styles.portionChoiceActiveText]}>{choice.label}</Text>
                            <Text style={[styles.portionMultiplier, active && styles.portionChoiceActiveText]}>{choice.multiplier}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.portionResult}>
                      ~{formatNumber(nutrition.calories, locale)} kcal · ~{nutrition.protein} g {t.common.protein}
                    </Text>
                    <PrimaryButton
                      disabled={logging}
                      icon="checkmark"
                      label={logging ? t.plan.logging : t.plan.logIt}
                      onPress={() => void logMeal(suggestion)}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}

          {marketMode ? (
            <>
              <Text style={styles.catalogNote}>{t.plan.marketNote}</Text>
              <Text style={styles.catalogNote}>{t.plan.marketAttribution(formatDataDate(marketData.fetchedAt, locale))}</Text>
            </>
          ) : (
            <Text style={styles.catalogNote}>{t.plan.catalogNote}</Text>
          )}

          {hasLoggedScan && params.fromScan !== '1' && subscriptionStatus !== 'active' ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/paywall')} style={styles.proBanner}>
              <View style={styles.proIcon}><Ionicons color={colors.white} name="infinite" size={20} /></View>
              <View style={styles.proCopy}>
                <Text style={styles.proTitle}>{t.plan.proTitle}</Text>
                <Text style={styles.proText}>{t.plan.proText}</Text>
              </View>
              <Ionicons color={colors.text} name="chevron-forward" size={20} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.hint}>
          <Ionicons color={colors.muted} name="arrow-up" size={20} />
          <Text style={styles.hintText}>{t.plan.hint}</Text>
        </View>
      )}
    </Screen>
  );
}

function formatDataDate(isoDate: string, locale: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

function NutritionStat({ label, value }: { label: string; value: number | string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.nutritionStat}>
      <Text style={styles.nutritionValue}>{value}</Text>
      <Text style={styles.nutritionLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  headerCopy: { flex: 1, gap: 8 },
  subtitle: { ...typeScale.callout, color: colors.muted },
  balanceCard: { backgroundColor: colors.camera, borderColor: colors.camera, alignItems: 'flex-start', gap: 12 },
  balanceLabel: { ...typeScale.caption, color: 'rgba(255,255,255,0.62)', fontWeight: '800', letterSpacing: 1 },
  balanceValue: { ...typeScale.title2, color: colors.white, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  proteinPill: { alignSelf: 'flex-start', backgroundColor: 'rgba(187,220,142,0.14)', borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  proteinText: { ...typeScale.caption, color: colors.accent, fontWeight: '700' },
  contextList: { gap: 12 },
  contextCard: { minHeight: 84, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  contextActive: { backgroundColor: colors.neutralSoft, borderColor: colors.accentText },
  contextCopy: { flex: 1, gap: 4 },
  contextTitle: { ...typeScale.headline, color: colors.text, fontWeight: '600' },
  contextDetail: { ...typeScale.footnote, color: colors.muted },
  chevron: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  chevronActive: { backgroundColor: colors.accent },
  recipeLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  recipeLinkText: { ...typeScale.subhead, color: colors.accentText, fontWeight: '700' },
  dayDone: { alignItems: 'center', gap: 12 },
  dayDoneTitle: { color: colors.text, fontSize: 19, lineHeight: 24, fontWeight: '700' },
  dayDoneText: { ...typeScale.subhead, color: colors.muted, textAlign: 'center' },
  results: { gap: 12 },
  resultsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  resultsTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  resultsMeta: { ...typeScale.caption, color: colors.muted, marginTop: 4 },
  suggestion: { gap: 16 },
  suggestionChosen: { borderColor: colors.accentText, backgroundColor: colors.accentSoft },
  suggestionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rank: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  rankText: { ...typeScale.caption, color: colors.muted, fontWeight: '800' },
  suggestionCopy: { flex: 1, minWidth: 0, gap: 4 },
  comboItems: { flex: 1, minWidth: 0, gap: 12 },
  comboItem: { gap: 4 },
  storeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  storeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3 },
  storeChipText: { ...typeScale.caption, color: colors.text, fontWeight: '700' },
  suggestionTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  suggestionDetail: { ...typeScale.footnote, color: colors.muted },
  source: { ...typeScale.caption, color: colors.muted, marginTop: 2 },
  time: { ...typeScale.caption, flexShrink: 0, maxWidth: 100, color: colors.accentText, fontWeight: '600', textAlign: 'right' },
  nutritionRow: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 16, paddingVertical: 10 },
  nutritionStat: { flex: 1, alignItems: 'center', gap: 2 },
  nutritionValue: { ...typeScale.subhead, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nutritionLabel: { ...typeScale.caption, color: colors.muted },
  portionBlock: { gap: 10, marginTop: 2 },
  portionLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '700' },
  portionSelector: { flexDirection: 'row', borderRadius: radii.input, backgroundColor: colors.background, padding: 4, gap: 4 },
  portionChoice: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 2 },
  portionChoiceActive: { backgroundColor: colors.accent },
  portionChoiceLabel: { ...typeScale.footnote, color: colors.muted, fontWeight: '700' },
  portionChoiceActiveText: { color: colors.onAccent },
  portionMultiplier: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  portionResult: { ...typeScale.footnote, color: colors.text, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  loggedBanner: { minHeight: 66, borderRadius: radii.card, backgroundColor: colors.accentSoft, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loggedIcon: { width: 34, height: 34, borderRadius: 13, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  loggedCopy: { flex: 1, minWidth: 0, gap: 2 },
  loggedTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '800' },
  loggedText: { ...typeScale.caption, color: colors.text, opacity: 0.75 },
  catalogNote: { ...typeScale.caption, color: colors.muted, textAlign: 'center', paddingHorizontal: 12 },
  hint: { alignItems: 'center', gap: 8, paddingVertical: 14 },
  hintText: { ...typeScale.footnote, color: colors.muted },
  proBanner: { minHeight: 78, borderRadius: radii.card, backgroundColor: colors.accentSoft, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  proIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: colors.camera, alignItems: 'center', justifyContent: 'center' },
  proCopy: { flex: 1, gap: 2 },
  proTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  proText: { ...typeScale.caption, color: colors.text, opacity: 0.7 },
});
