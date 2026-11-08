import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MealDetailSheet, loggedAmountLabel } from '@/components/MealDetailSheet';
import { foodKey, MealFoodPicker, quickGrams } from '@/components/MealFoodPicker';
import { PortionSheet } from '@/components/PortionSheet';
import { useToast } from '@/components/Toast';
import { Card, PressableScale, PrimaryButton, Screen } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { CaptureMode } from '@/services/captureIntents';
import { selectionHaptic, successHaptic, warningHaptic } from '@/services/haptics';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import { sumMeals } from '@/services/mockNutrition';
import { pieceKey, piecePortions } from '@/services/pieceWeights';
import { usePresentationBlock } from '@/services/presentation';
import { Meal } from '@/types/nutrition';
import { displayClockTime, formatDayLabel, formatNumber, mealTypeIcon, mealTypeLabel } from '@/utils/format';
import { isMealSlot, slotTarget } from '@/utils/mealSlots';
import { itemNutritionPer100g } from '@/utils/portions';

/**
 * Photo, voice and barcode open the scan tab filed into this slot; search is
 * this page. The photo comes first and filled: it is what people pay for, so
 * it is never behind the list.
 */
const OTHER_WAYS: { mode: CaptureMode; icon: keyof typeof Ionicons.glyphMap; label: 'photo' | 'describe' | 'barcode' }[] = [
  { mode: 'photo', icon: 'camera-outline', label: 'photo' },
  { mode: 'description', icon: 'mic-outline', label: 'describe' },
  { mode: 'barcode', icon: 'barcode-outline', label: 'barcode' },
];

type Pick = { key: string; food: FoodSearchResult; grams: number };
/** The picker's search field, focused by the Suche tile. */
type SearchField = TextInput;

/**
 * One meal of the day, and the place to add to it (Yazio-style, 08.11.2026):
 * what the slot holds against its share of the day, the foods already in it
 * behind "Eingetragen (n)", the ways in, and the food list itself. A + adds a
 * food at once with its last amount; tapping the row asks for the amount.
 * "Fertig" saves every pick as one meal in this slot and day.
 */
export default function MealSlotScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string; date?: string }>();
  const { logFoodsDirect, mealHistory, meals, remaining, removeLoggedItem, resetScan, setPlannedMealDate, setPlannedMealType, targets } = useApp();
  const { locale, t } = useLanguage();
  const { toast, show: showToast } = useToast();
  const today = useLocalDay();
  const type: Meal['type'] = isMealSlot(params.type) ? params.type : 'Breakfast';
  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const isToday = date === today;
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [loggedOpen, setLoggedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [amountFor, setAmountFor] = useState<FoodSearchResult | null>(null);
  const searchRef = useRef<SearchField>(null);
  usePresentationBlock(Boolean(openMeal || amountFor));

  const slotMeals = useMemo(() => (isToday ? meals : mealHistory.filter((meal) => meal.date === date))
    .filter((meal) => meal.type === type)
    .sort((a, b) => a.time.localeCompare(b.time)), [date, isToday, mealHistory, meals, type]);
  const eaten = useMemo(() => sumMeals(slotMeals), [slotMeals]);
  const target = slotTarget(type, targets);
  const label = mealTypeLabel(type, t.common);
  const rows = slotMeals.flatMap((meal) => meal.items.filter((item) => item.included).map((item) => ({ meal, item })));
  const pickedKcal = picks.reduce((sum, pick) => sum + Math.round(pick.food.per100g.calories * pick.grams / 100), 0);
  const shownKcal = eaten.calories + pickedKcal;
  const share = target.calories > 0 ? Math.min(1, shownKcal / target.calories) : 0;
  const pickedKeys = useMemo(() => new Set(picks.map((pick) => pick.key)), [picks]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/today'));
  const withPieces = (food: FoodSearchResult) => ({ ...food, portions: piecePortions(food.name, food.portions, pieceKey(food.name, food.source.referenceId)) });

  const add = (mode: CaptureMode) => {
    void selectionHaptic();
    resetScan();
    // resetScan clears any earlier choice, so slot and day are set after it.
    setPlannedMealType(type);
    if (!isToday) setPlannedMealDate(date);
    router.navigate({ pathname: '/(tabs)/scan', params: { mode } });
  };

  const setPick = (food: FoodSearchResult, grams: number) => {
    const key = foodKey(food);
    setPicks((list) => [...list.filter((pick) => pick.key !== key), { key, food: withPieces(food), grams }]);
  };
  const togglePick = (food: FoodSearchResult) => {
    const key = foodKey(food);
    if (pickedKeys.has(key)) setPicks((list) => list.filter((pick) => pick.key !== key));
    else setPick(food, quickGrams(food));
  };
  // A favourite meal adds all its foods with their saved amounts.
  const addFavorite = (meal: Meal) => {
    for (const item of meal.items.filter((entry) => entry.included)) {
      setPick({ id: `fav-${meal.id}-${item.id}`, name: item.name, per100g: itemNutritionPer100g(item), defaultGrams: item.amountG, portions: item.portions ?? [], source: item.source, lastGrams: item.amountG }, item.amountG);
    }
  };

  const finish = async () => {
    if (!picks.length) { back(); return; }
    if (busy) return;
    setBusy(true);
    Keyboard.dismiss();
    // logFoodsDirect files into the planned slot and day.
    setPlannedMealType(type);
    setPlannedMealDate(isToday ? null : date);
    const left = Math.max(0, remaining.calories - pickedKcal);
    try {
      await logFoodsDirect(picks.map((pick) => ({ result: pick.food, grams: pick.grams })));
      void successHaptic();
      setPicks([]);
      // What fits next stays Kandro's answer: the day's rest, right after saving.
      showToast(isToday ? t.mealSlot.savedLeft(formatNumber(left, locale)) : t.mealSlot.saved);
    } catch (error) {
      Alert.alert(t.result.saveFailed, error instanceof Error ? error.message : undefined);
    } finally {
      setPlannedMealType(null);
      setPlannedMealDate(null);
      setBusy(false);
    }
  };

  const remove = (meal: Meal, itemId: string, name: string) => {
    if (busy) return;
    void warningHaptic();
    Alert.alert(t.mealSheet.removeItemTitle(name), undefined, [
      { text: t.common.keep, style: 'cancel' },
      {
        text: t.mealSheet.removeItem,
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void removeLoggedItem(meal.id, itemId).finally(() => setBusy(false));
        },
      },
    ]);
  };

  const footer = (
    <View pointerEvents="box-none" style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      <PrimaryButton
        disabled={busy}
        icon={picks.length ? 'checkmark' : undefined}
        label={picks.length ? t.mealSlot.doneWith(formatNumber(pickedKcal, locale)) : t.mealSlot.done}
        onPress={() => void finish()}
        variant={picks.length ? 'primary' : 'secondary'}
      />
    </View>
  );

  return (
    <Screen overlay={<>{footer}{toast}</>}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" hitSlop={8} onPress={back} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Ionicons color={colors.text} name={mealTypeIcon(type)} size={20} />
            <Text accessibilityRole="header" style={styles.title}>{label}</Text>
          </View>
          {!isToday ? <Text style={styles.day}>{formatDayLabel(date, today, t.today, locale)}</Text> : null}
        </View>
        <View style={styles.backButtonSpacer} />
      </View>

      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <Text style={styles.summaryKcal}>{formatNumber(shownKcal, locale)} / {formatNumber(target.calories, locale)} kcal</Text>
          {rows.length ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: loggedOpen }} hitSlop={8} onPress={() => setLoggedOpen((open) => !open)} style={styles.loggedToggle}>
              <Text style={styles.loggedToggleText}>{t.mealSlot.loggedCount(rows.length)}</Text>
              <Ionicons color={colors.muted} name={loggedOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} /></View>
        <Text style={styles.macros}>{t.common.protein} {formatNumber(eaten.protein, locale)}/{target.protein} g · {t.common.carbs} {formatNumber(eaten.carbs, locale)}/{target.carbs} g · {t.common.fat} {formatNumber(eaten.fat, locale)}/{target.fat} g</Text>
        {loggedOpen ? rows.map(({ meal, item }) => (
          <View key={`${meal.id}-${item.id}`} style={styles.itemRow}>
            <Pressable accessibilityHint={t.common.mealHint} accessibilityRole="button" onPress={() => setOpenMeal(meal)} style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}>
              <View style={styles.itemCopy}>
                <Text numberOfLines={1} style={styles.itemName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.itemAmount}>{loggedAmountLabel(item, locale)} · {displayClockTime(meal.time, locale)}</Text>
              </View>
              <Text style={styles.itemCalories}>{formatNumber(item.calories, locale)} kcal</Text>
            </Pressable>
            <Pressable accessibilityLabel={t.mealSheet.removeItemTitle(item.name)} accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => remove(meal, item.id, item.name)} style={styles.trash}>
              <Ionicons color={colors.muted} name="trash-outline" size={19} />
            </Pressable>
          </View>
        )) : null}
      </Card>

      <View style={styles.ways}>
        {OTHER_WAYS.map((way) => {
          const primary = way.mode === 'photo';
          return (
            <PressableScale accessibilityLabel={`${t.mealSlot[way.label]}: ${t.today.addTo(label)}`} accessibilityRole="button" key={way.mode} onPress={() => add(way.mode)} style={[styles.way, primary && styles.wayPrimary]}>
              <Ionicons color={primary ? colors.onAccent : colors.text} name={way.icon} size={20} />
              <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.wayLabel, primary && styles.wayLabelPrimary]}>{t.mealSlot[way.label]}</Text>
            </PressableScale>
          );
        })}
        <PressableScale accessibilityRole="button" onPress={() => searchRef.current?.focus()} style={styles.way}>
          <Ionicons color={colors.text} name="search" size={20} />
          <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.wayLabel}>{t.mealSlot.search}</Text>
        </PressableScale>
      </View>

      <MealFoodPicker
        onDetail={(food) => { Keyboard.dismiss(); setAmountFor(withPieces(food)); }}
        onFavorite={addFavorite}
        onMoreOptions={() => add('search')}
        onToggle={togglePick}
        picked={pickedKeys}
        placeholder={t.mealSlot.placeholder(label)}
        ref={searchRef}
      />
      <View style={styles.footerSpace} />

      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} />
      {amountFor ? (
        <PortionSheet
          key={amountFor.id}
          onCancel={() => setAmountFor(null)}
          onConfirm={(grams) => { setPick(amountFor, grams); setAmountFor(null); }}
          target={{ name: amountFor.name, per100g: amountFor.per100g, defaultGrams: quickGrams(amountFor), amountIsChosen: Boolean(amountFor.lastGrams), adding: true, portions: amountFor.portions, sourceLabel: amountFor.source.label, pieceKey: pieceKey(amountFor.name, amountFor.source.referenceId) }}
          visible
        />
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backButtonSpacer: { width: 44 },
  titleBlock: { flex: 1, alignItems: 'center', gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  day: { ...typeScale.footnote, color: colors.muted },
  summary: { gap: 8, paddingVertical: 14 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryKcal: { ...typeScale.headline, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  loggedToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  loggedToggleText: { ...typeScale.footnote, color: colors.muted, fontWeight: '600' },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  macros: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  itemRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemMain: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  pressed: { opacity: 0.6 },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  itemAmount: { ...typeScale.caption, color: colors.muted },
  itemCalories: { ...typeScale.footnote, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  trash: { width: 40, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  ways: { flexDirection: 'row', gap: 8 },
  way: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  // Pistachio fill is the scan action's colour; the photo tile is that action.
  wayPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
  wayLabel: { ...typeScale.caption, color: colors.text, fontWeight: '600' },
  wayLabelPrimary: { color: colors.onAccent },
  footer: { position: 'absolute', left: 20, right: 20, bottom: 0 },
  footerSpace: { height: 72 },
});
