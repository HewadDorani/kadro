import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MealDetailSheet, loggedAmountLabel } from '@/components/MealDetailSheet';
import { Card, PressableScale, PrimaryButton, Screen } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useLanguage } from '@/i18n/LanguageProvider';
import { selectionHaptic, warningHaptic } from '@/services/haptics';
import { usePresentationBlock } from '@/services/presentation';
import { sumMeals } from '@/services/mockNutrition';
import type { CaptureMode } from '@/services/captureIntents';
import { Meal } from '@/types/nutrition';
import { displayClockTime, formatDayLabel, formatNumber, mealTypeIcon, mealTypeLabel } from '@/utils/format';
import { isMealSlot, slotTarget } from '@/utils/mealSlots';

const ADD_WAYS: { mode: CaptureMode; icon: keyof typeof Ionicons.glyphMap; label: 'photo' | 'describe' | 'search' | 'barcode' }[] = [
  { mode: 'photo', icon: 'camera-outline', label: 'photo' },
  { mode: 'description', icon: 'mic-outline', label: 'describe' },
  { mode: 'search', icon: 'search-outline', label: 'search' },
  { mode: 'barcode', icon: 'barcode-outline', label: 'barcode' },
];

/**
 * One meal of the day as a page: what this slot holds against its share of
 * the day, every food in it with its amount, and the four ways to add more.
 * Heute shows only the four slot rows, so the day stays one short screen
 * however much is logged.
 */
export default function MealSlotScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; date?: string }>();
  const { mealHistory, meals, removeLoggedItem, resetScan, setPlannedMealDate, setPlannedMealType, targets } = useApp();
  const { locale, t } = useLanguage();
  const today = useLocalDay();
  const type: Meal['type'] = isMealSlot(params.type) ? params.type : 'Breakfast';
  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const isToday = date === today;
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [busy, setBusy] = useState(false);
  usePresentationBlock(Boolean(openMeal));

  const slotMeals = useMemo(() => (isToday ? meals : mealHistory.filter((meal) => meal.date === date))
    .filter((meal) => meal.type === type)
    .sort((a, b) => a.time.localeCompare(b.time)), [date, isToday, mealHistory, meals, type]);
  const eaten = useMemo(() => sumMeals(slotMeals), [slotMeals]);
  const target = slotTarget(type, targets);
  const label = mealTypeLabel(type, t.common);
  const rows = slotMeals.flatMap((meal) => meal.items.filter((item) => item.included).map((item) => ({ meal, item })));

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/today'));

  const add = (mode: CaptureMode) => {
    void selectionHaptic();
    resetScan();
    // resetScan clears any earlier choice, so slot and day are set after it.
    setPlannedMealType(type);
    if (!isToday) setPlannedMealDate(date);
    router.navigate({ pathname: '/(tabs)/scan', params: { mode } });
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

  const tiles = [
    { key: 'calories', value: `${formatNumber(eaten.calories, locale)} kcal`, detail: t.mealSlot.of(`${formatNumber(target.calories, locale)} kcal`) },
    { key: 'protein', value: `${formatNumber(eaten.protein, locale)} g`, detail: `${t.common.protein} · ${t.mealSlot.of(`${target.protein} g`)}` },
    { key: 'carbs', value: `${formatNumber(eaten.carbs, locale)} g`, detail: `${t.common.carbs} · ${t.mealSlot.of(`${target.carbs} g`)}` },
    { key: 'fat', value: `${formatNumber(eaten.fat, locale)} g`, detail: `${t.common.fat} · ${t.mealSlot.of(`${target.fat} g`)}` },
  ];

  return (
    <Screen>
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

      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <View key={tile.key} style={styles.tile}>
            <Text style={styles.tileValue}>{tile.value}</Text>
            <Text style={styles.tileDetail}>{tile.detail}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>{t.mealSlot.shareNote}</Text>

      <Text style={styles.sectionTitle}>{t.mealSlot.logged}</Text>
      <Card style={styles.listCard}>
        {!rows.length ? <Text style={styles.empty}>{t.mealSlot.empty}</Text> : null}
        {rows.map(({ meal, item }, index) => (
          <View key={`${meal.id}-${item.id}`}>
            {index ? <View style={styles.divider} /> : null}
            <View style={styles.itemRow}>
              <Pressable
                accessibilityHint={t.common.mealHint}
                accessibilityRole="button"
                onPress={() => setOpenMeal(meal)}
                style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}
              >
                <View style={styles.itemCopy}>
                  <Text numberOfLines={1} style={styles.itemName}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.itemAmount}>{loggedAmountLabel(item, locale)} · {displayClockTime(meal.time, locale)}</Text>
                </View>
                <Text style={styles.itemCalories}>{formatNumber(item.calories, locale)} kcal</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t.mealSheet.removeItemTitle(item.name)}
                accessibilityRole="button"
                disabled={busy}
                hitSlop={8}
                onPress={() => remove(meal, item.id, item.name)}
                style={styles.trash}
              >
                <Ionicons color={colors.muted} name="trash-outline" size={19} />
              </Pressable>
            </View>
          </View>
        ))}
      </Card>

      <Text style={styles.sectionTitle}>{t.mealSlot.add}</Text>
      <View style={styles.ways}>
        {ADD_WAYS.map((way) => (
          <PressableScale accessibilityLabel={`${t.mealSlot[way.label]}: ${t.today.addTo(label)}`} accessibilityRole="button" key={way.mode} onPress={() => add(way.mode)} style={styles.way}>
            <View style={styles.wayIcon}><Ionicons color={colors.text} name={way.icon} size={22} /></View>
            <Text numberOfLines={1} style={styles.wayLabel}>{t.mealSlot[way.label]}</Text>
          </PressableScale>
        ))}
      </View>

      <PrimaryButton label={t.mealSlot.done} onPress={back} variant="secondary" />
      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} />
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
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', gap: 2 },
  tileValue: { ...typeScale.headline, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tileDetail: { ...typeScale.footnote, color: colors.muted, textAlign: 'center' },
  note: { ...typeScale.caption, color: colors.muted, textAlign: 'center', marginTop: -8 },
  sectionTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700', marginBottom: -8 },
  listCard: { paddingVertical: 4, paddingHorizontal: 0 },
  empty: { ...typeScale.subhead, color: colors.muted, padding: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  itemMain: { flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingVertical: 10 },
  pressed: { opacity: 0.6 },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { ...typeScale.label, color: colors.text, fontWeight: '600' },
  itemAmount: { ...typeScale.footnote, color: colors.muted },
  itemCalories: { ...typeScale.subhead, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  trash: { width: 48, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  ways: { flexDirection: 'row', gap: 10 },
  way: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  wayIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  wayLabel: { ...typeScale.footnote, color: colors.text, fontWeight: '600' },
});
