import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChainComboCard } from '@/components/ChainComboCard';
import { PlanOptionCard, PlanOptionItem } from '@/components/PlanOptionCard';
import { Card, Eyebrow, IconCircle, PageTitle, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { getRecipe, hasRecipe } from '@/services/recipes';
import { knownPreferences } from '@/services/preferences';
import { useSubscription } from '@/context/SubscriptionContext';
import { recordRecommendationFeedback, recordRecommendationSet } from '@/services/cloudRepository';
import { ChainCombo, chainComboSearchEntries, chainCombos } from '@/services/chainCombos';
import { recommendMeals } from '@/services/recommendations';
import { useMarketRegion } from '@/services/region';
import { ComboItem, ComboPortion, comboSearchEntries, productName, StoreId, SUPERMARKET_DATA, supermarketCombos, SupermarketCombo } from '@/services/supermarketCombos';
import { optionFits, SMALL_MEAL_CALORIES, suggestedNutrition } from '@/utils/mealSuggestions';
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
  const contexts: { id: MealContext; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'home', title: t.plan.ctxHome, detail: t.plan.ctxHomeDetail, icon: 'home-outline' },
    { id: 'supermarket', title: t.plan.ctxMarket, detail: t.plan.ctxMarketDetail, icon: 'basket-outline' },
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
    () => (selected === 'supermarket' ? supermarketCombos(remaining, profile.preferences) : []),
    [profile.preferences, remaining, selected],
  );
  const marketMode = selected === 'supermarket' && combos.length === 3;
  // Unterwegs shows real chains of the person's market; the dish catalogue
  // stays the fallback when a market or a diet leaves fewer than three orders.
  const region = useMarketRegion();
  const orders = useMemo(
    () => (selected === 'eating-out' ? chainCombos(remaining, { market: region, hour: new Date().getHours(), preferences: profile.preferences }) : []),
    [profile.preferences, region, remaining, selected],
  );
  const chainMode = selected === 'eating-out' && orders.length === 3;
  const options: { id: string; calories: number; protein: number }[] = marketMode ? combos : chainMode ? orders : suggestions;
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
    const recorded: MealSuggestion[] = marketMode || chainMode
      ? (marketMode ? combos : orders).map((combo) => ({ id: combo.id, title: '', detail: '', time: '', calories: combo.calories, protein: combo.protein, carbs: combo.carbs, fat: combo.fat }))
      : suggestions;
    void recordRecommendationSet(selected, remaining, recorded).catch(() => {
      recordedSet.current = '';
    });
  }, [chainMode, combos, marketMode, options, orders, remaining, selected, suggestions]);

  const portionAmount = (portion: ComboPortion) => {
    const [one, many] = t.plan.marketPortion[portion.container];
    return portion.kind === 'half' ? t.plan.marketHalf(one) : t.plan.marketCount(portion.count, portion.count === 1 ? one : many);
  };

  /** "Skyr & Banane": what kind of thing each product is, loose fruit by name. */
  const comboTitle = (combo: SupermarketCombo) => t.plan.marketTitle([...new Set(combo.items.map(({ product }) => (
    product.category === 'fruit' ? productName(product, language) : t.plan.marketCategory[product.category] ?? productName(product, language)
  )))]);
  const comboItem = (item: ComboItem): PlanOptionItem => {
    const name = productName(item.product, language);
    return {
      key: item.product.id,
      name,
      detail: [
        item.product.brand && !name.toLowerCase().includes(item.product.brand.toLowerCase()) ? item.product.brand : '',
        t.plan.marketItemMacros(formatNumber(item.calories, locale), item.protein),
        item.portion.estimated ? t.plan.marketEstimatedPiece : '',
      ].filter(Boolean).join(' · '),
      amount: portionAmount(item.portion),
      amountDetail: t.plan.marketGrams(formatNumber(item.portion.grams, locale), item.portion.estimated),
      stores: item.product.stores.map((store) => {
        const label = t.plan.marketStores[store as StoreId] ?? store;
        return { id: store, label, accessibilityLabel: t.plan.marketStore(label) };
      }),
    };
  };
  /** A home dish lists what goes into the pan, at the portion offered. */
  const recipeItems = (mealId: string, scale: number): PlanOptionItem[] => (getRecipe(mealId, scale)?.ingredients ?? []).map((ingredient) => ({
    key: ingredient.key,
    name: ingredient.name,
    amount: `${formatNumber(Math.round(ingredient.grams), locale)} g`,
  }));
  const chosenPreferences = knownPreferences(profile.preferences);
  const preferenceSummary = chosenPreferences.length
    ? t.plan.adaptedTo(chosenPreferences.map((id) => t.plan.preferenceNames[id] ?? id).join(', '))
    : t.plan.adaptedNone;
  // Badges compare the three options as offered (the chosen portion included).
  const comboFits = optionFits(combos, availableCalories);
  const orderFits = optionFits(orders, availableCalories);
  const suggestionFits = optionFits(
    suggestions.map((suggestion) => suggestedNutrition(suggestion, chosen === suggestion.id ? portion : 1)),
    availableCalories,
  );

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

  /** A chain order opens the confirm screen prefilled with every menu item, like a basket. */
  const takeOrder = (order: ChainCombo, rank: number) => {
    if (!selected) return;
    void selectionHaptic();
    trackEvent('recommendation selected', { meal_context: selected, rank: rank as 1 | 2 | 3 });
    void recordRecommendationFeedback(selected, order.id, 'accepted').catch(() => undefined);
    startPlannedDraft(chainComboSearchEntries(order, (chain) => t.plan.chainSourceLabel(chain.name)));
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

          <Pressable
            accessibilityHint={t.plan.adaptedEditHint}
            accessibilityRole="button"
            onPress={() => router.push('/onboarding?edit=1&step=preferences' as never)}
            style={styles.adapted}
          >
            <Ionicons color={colors.accentText} name="options-outline" size={16} />
            <Text style={styles.adaptedText}>{preferenceSummary}</Text>
            <Text style={styles.adaptedEdit}>{t.plan.adaptedEdit}</Text>
          </Pressable>

          {chainMode ? orders.map((order, index) => (
            <ChainComboCard
              availableCalories={availableCalories}
              combo={order}
              fit={orderFits[index]}
              key={order.id}
              onTake={() => takeOrder(order, index + 1)}
              rank={index + 1}
            />
          )) : marketMode ? combos.map((combo, index) => (
            <PlanOptionCard
              footer={{
                action: { icon: 'basket-outline', label: t.plan.marketTake, onPress: () => takeCombo(combo, index + 1) },
                availableCalories,
                calories: combo.calories,
                carbs: combo.carbs,
                estimated: combo.items.some((item) => item.portion.estimated),
                fat: combo.fat,
              }}
              header={{
                calories: combo.calories,
                estimated: combo.items.some((item) => item.portion.estimated),
                fit: comboFits[index],
                protein: combo.protein,
                rank: index + 1,
                title: comboTitle(combo),
              }}
              items={combo.items.map(comboItem)}
              key={combo.id}
            />
          )) : suggestions.map((suggestion, index) => {
            const isChosen = chosen === suggestion.id;
            const relativePortion = isChosen ? portion : 1;
            const nutrition = suggestedNutrition(suggestion, relativePortion);
            const recipeScale = (suggestion.portionScale ?? 1) * relativePortion;
            return (
              <PlanOptionCard
                chosen={isChosen}
                footer={{
                  action: {
                    icon: isChosen ? 'chevron-up' : 'arrow-forward',
                    label: isChosen ? t.plan.dropIt : t.plan.take,
                    onPress: () => chooseMeal(suggestion.id),
                    variant: isChosen ? 'ghost' : 'secondary',
                  },
                  availableCalories,
                  calories: nutrition.calories,
                  carbs: nutrition.carbs,
                  estimated: true,
                  fat: nutrition.fat,
                  macroExtra: suggestion.source?.label,
                  notes: recipeScale !== 1 ? [t.plan.portionOfStandard(formatNumber(Math.round(recipeScale * 100), locale))] : [],
                }}
                header={{
                  calories: nutrition.calories,
                  estimated: true,
                  fit: suggestionFits[index],
                  meta: suggestion.time,
                  protein: nutrition.protein,
                  rank: index + 1,
                  subtitle: suggestion.detail,
                  title: suggestion.title,
                }}
                items={recipeItems(suggestion.id, recipeScale)}
                key={suggestion.id}
                moreLabel={t.plan.moreIngredients}
              >
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
              </PlanOptionCard>
            );
          })}

          {chainMode ? (
            <Text style={styles.catalogNote}>{t.plan.chainNote}</Text>
          ) : marketMode ? (
            <>
              <Text style={styles.catalogNote}>{t.plan.marketNote}</Text>
              <Text style={styles.catalogNote}>{t.plan.marketAttribution(formatDataDate(SUPERMARKET_DATA.fetchedAt, locale))}</Text>
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
  results: { gap: 14 },
  resultsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  resultsTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  resultsMeta: { ...typeScale.caption, color: colors.muted, marginTop: 4 },
  adapted: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radii.input, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  adaptedText: { ...typeScale.footnote, color: colors.text, flex: 1 },
  adaptedEdit: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
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
