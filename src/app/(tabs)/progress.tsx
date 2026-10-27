import { KeyboardBackfill } from '@/components/KeyboardBackfill';
import { WeeklyReviewCard } from '@/components/WeeklyReviewCard';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Card, EmptyIllustration, Eyebrow, IconCircle, PageTitle, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { HERO_MAX_FONT_SCALE, radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatNumber } from '@/utils/format';
import { useLanguage } from '@/i18n/LanguageProvider';
import { proteinConsistency, weeklyLoggingGoal } from '@/services/consistency';
import { progressPresentation, weightChartLayout } from '@/utils/progressPresentation';
import { useLocalDay } from '@/hooks/useLocalDay';
import { formatWeight, formatWeightDelta, kgToStoneParts, parseStoneInput, parseWeightInput, weightInputUnit, weightInputValue } from '@/utils/units';
import { formatDateParts } from '@/utils/format';



export default function ProgressScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, t } = useLanguage();
  const { addWeightEntry, mealHistory, profile, targets, weightEntries } = useApp();
  const [showWeightEntry, setShowWeightEntry] = useState(false);
  const units = profile.unitSystem;
  const [weightInput, setWeightInput] = useState(() => weightInputValue(profile.weightKg, units, locale));
  // Nobody says "13.2 stone", so the UK entry is two fields rather than one.
  const [stoneInput, setStoneInput] = useState(() => String(kgToStoneParts(profile.weightKg).stone));
  const [stonePounds, setStonePounds] = useState(() => String(kgToStoneParts(profile.weightKg).pounds));
  const [weightError, setWeightError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentDay = useLocalDay();

  const { context, visibleWeights, chartWeights, visibleMeals, currentWeight, weightChange } = useMemo(
    () => progressPresentation(profile, mealHistory, weightEntries, currentDay),
    [profile, mealHistory, weightEntries, currentDay],
  );

  const consistency = useMemo(
    () => proteinConsistency(mealHistory, targets.protein),
    [currentDay, locale, mealHistory, targets.protein],
  );
  // A forgiving weekly goal, not a streak: a missed day never resets anything.
  const weekGoal = useMemo(() => weeklyLoggingGoal(mealHistory), [currentDay, mealHistory]);
  // Calories per weekday, same seven days as the protein strip. A day without
  // a logged meal stays empty ("not logged"), never a false 0 kcal success.
  const calorieWeek = useMemo(() => consistency.days.map((day) => {
    const dayMeals = mealHistory.filter((meal) => meal.date === day.key);
    const calories = dayMeals.reduce((sum, meal) => sum + meal.calories, 0);
    return { key: day.key, label: day.label, today: day.today, logged: dayMeals.length > 0, calories };
  }), [consistency.days, mealHistory]);
  const loggedCalorieDays = calorieWeek.filter((day) => day.logged);
  const averageCalories = loggedCalorieDays.length ? Math.round(loggedCalorieDays.reduce((sum, day) => sum + day.calories, 0) / loggedCalorieDays.length) : 0;
  const withinCalories = loggedCalorieDays.filter((day) => Math.abs(day.calories - targets.calories) <= targets.calories * 0.1).length;
  const { averageProtein, loggedCount: trackedDays, reachedCount } = consistency;
  const showsScore = trackedDays >= 3;

  const openWeightEntry = () => {
    setWeightInput(weightInputValue(currentWeight, units, locale));
    const parts = kgToStoneParts(currentWeight);
    setStoneInput(String(parts.stone));
    setStonePounds(String(parts.pounds));
    setWeightError(null);
    setShowWeightEntry(true);
  };

  const saveWeight = async () => {
    // Parsed back into kilograms: the entry is stored metric whatever the
    // user typed, so switching units never rewrites their history.
    const value = units === 'uk'
      ? parseStoneInput(stoneInput, stonePounds)
      : parseWeightInput(weightInput, units);
    if (value === null) {
      setWeightError(t.progress.weightError);
      return;
    }
    setSaving(true);
    try {
      await addWeightEntry(value);
      setShowWeightEntry(false);
    } catch {
      setWeightError(t.progress.weightError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Eyebrow>{t.progress.eyebrow}</Eyebrow>
          <PageTitle>{context === 'teen' ? t.progress.title : t.progress.goalTitle[context]}</PageTitle>
          <Text style={styles.subtitle}>{context === 'teen' ? t.progress.teenContext : t.progress.goalContext[context]}</Text>
        </View>
        <IconCircle name="trending-up" size={48} />
      </View>

      {/* The week at a glance: seven bars against the goal line, the average,
          protein days and the forgiving weekly goal in one card. */}
      <Card style={styles.consistencyHero}>
        <Text style={styles.heroLabel}>{t.progress.weekTitle}</Text>
        <View style={styles.heroValueRow}>
          <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={[styles.heroValue, !loggedCalorieDays.length && styles.heroValueEmpty]}>{loggedCalorieDays.length ? formatNumber(averageCalories, locale) : '0'}</Text>
          <Text style={styles.heroOf}>{t.progress.caloriesAverage(formatNumber(Math.round(targets.calories), locale))}</Text>
        </View>
        {loggedCalorieDays.length ? (
          <WeekBars days={calorieWeek} target={targets.calories} />
        ) : (
          <View style={styles.emptyWeek}>
            <EmptyIllustration icon="calendar-outline" size={88} />
          </View>
        )}
        <Text style={styles.heroFoot}>{loggedCalorieDays.length ? t.progress.caloriesFoot(withinCalories, loggedCalorieDays.length) : t.progress.caloriesEmpty}</Text>
        <View style={styles.weekTiles}>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileValue}>{trackedDays ? t.progress.proteinDaysValue(reachedCount, trackedDays) : t.progress.noLoggedProtein}</Text>
            <Text style={styles.weekTileLabel}>{t.progress.proteinDays}</Text>
          </View>
          <View style={styles.weekTileDivider} />
          <View style={styles.weekTile}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.weekGoalDots}>
              {weekGoal.days.map((day) => (
                <View key={day.key} style={[styles.weekGoalDot, day.logged && styles.weekGoalDotLogged, day.today && styles.weekGoalDotToday]} />
              ))}
            </View>
            <Text style={styles.weekTileLabel}>{t.progress.weekGoalShort}</Text>
          </View>
        </View>
        <View accessible accessibilityLabel={`${t.progress.weekGoal(weekGoal.logged, weekGoal.goal)}. ${weekGoal.reached ? t.progress.weekGoalReached : t.progress.weekGoalOpen}`} style={styles.weekGoalBody}>
          <Text style={styles.weekGoalTitle}>{t.progress.weekGoal(weekGoal.logged, weekGoal.goal)}</Text>
          <Text style={styles.weekGoalText}>{weekGoal.reached ? t.progress.weekGoalReached : t.progress.weekGoalOpen}</Text>
        </View>
      </Card>

      <Card style={styles.weightCard}>
        <View style={styles.weightTop}>
          <View>
            <Text style={styles.cardLabel}>{visibleWeights.length ? t.progress.currentWeight : t.progress.profileWeight}</Text>
            <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.currentWeight}>{formatWeight(currentWeight, units, locale)}</Text>
          </View>
          {visibleWeights.length > 1 ? (
            <View style={styles.changePill}>
              <Ionicons color={colors.accentText} name={weightChange > 0 ? 'arrow-up' : weightChange < 0 ? 'arrow-down' : 'remove'} size={15} />
              <Text style={styles.changeText}>{formatWeightDelta(Math.abs(weightChange), units, locale)}</Text>
            </View>
          ) : (
            <View style={styles.firstPill}><Text style={styles.firstPillText}>{visibleWeights.length ? t.progress.firstValue : t.progress.noMeasurement}</Text></View>
          )}
        </View>
        <Text style={styles.heroFoot}>{t.progress.weightWindow}</Text>
        <WeightChart entries={chartWeights} />
        {visibleWeights.length > 1 ? (
          <View style={styles.chartLabels}>
            <Text style={styles.chartLabel}>{formatDateParts(chartWeights[0].date, { day: 'numeric', month: 'short' }, locale)}</Text>
            <Text style={styles.chartLabel}>{formatDateParts(chartWeights.at(-1)?.date ?? '', { day: 'numeric', month: 'short' }, locale)}</Text>
          </View>
        ) : null}
        {chartWeights.length > 1 ? <Text style={styles.heroFoot}>{t.progress.timeScaled}</Text> : null}
        <PrimaryButton haptic icon="add" label={t.progress.logWeight} onPress={openWeightEntry} variant="secondary" />
        <Text style={styles.heroFoot}>{t.progress.localWeightNote}</Text>
      </Card>

      {/* Protein is the thing this audience controls day to day; weight swings on
          water and inverts when someone is building. It leads for a reason. */}
      <Card style={styles.consistencyHero}>
        {/* A ratio needs enough days to mean anything. Scoring someone "0 von 1"
            on their first day is a verdict on a single data point, and this app
            does not do verdicts. Below three tracked days the average leads. */}
        <Text style={styles.heroLabel}>{showsScore ? t.progress.proteinReached : trackedDays > 0 ? t.progress.proteinAverage : t.progress.proteinTarget}</Text>
        <View style={styles.heroValueRow}>
          {showsScore ? (
            <>
              <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.heroValue}>{reachedCount}</Text>
              <Text style={styles.heroOf}>{t.progress.outOfTracked(trackedDays)}</Text>
            </>
          ) : (
            <>
              <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.heroValue}>{trackedDays > 0 ? averageProtein : targets.protein}</Text>
              <Text style={styles.heroOf}>{trackedDays > 0 ? t.progress.goalSuffix(targets.protein) : t.progress.perDayGoal}</Text>
            </>
          )}
        </View>
        <View style={styles.strip}>
          {consistency.days.map((day) => (
            <View key={day.key} style={styles.stripDay}>
              <View style={styles.stripTrack}>
                <View
                  style={[
                    styles.stripFill,
                    { height: `${Math.max(6, Math.round((day.ratio / 1.2) * 100))}%` },
                    day.logged && styles.stripFillLogged,
                    day.reached && styles.stripFillReached,
                  ]}
                />
              </View>
              <Text style={[styles.stripLabel, day.today && styles.stripLabelToday]}>{day.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.heroFoot}>
          {showsScore
            ? t.progress.footScored(averageProtein, targets.protein)
            : trackedDays > 0
              ? t.progress.footBuilding(trackedDays)
              : t.progress.footEmpty}
        </Text>
        <Text style={styles.heroFoot}>{t.progress.currentTargetNote}</Text>
      </Card>

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <IconCircle name="barbell-outline" size={38} tone="neutral" />
          <Text style={styles.statValue}>{trackedDays ? `${averageProtein} g` : t.progress.noLoggedProtein}</Text>
          <Text style={styles.statLabel}>{t.progress.avgProtein}</Text>
        </Card>
        <Card style={styles.statCard}>
          <IconCircle name="camera-outline" size={38} tone="neutral" />
          <Text style={styles.statValue}>{visibleMeals.length}</Text>
          <Text style={styles.statLabel}>{t.progress.meals}</Text>
        </Card>
      </View>

      <WeeklyReviewCard />

      <View style={styles.section}>
        <SectionTitle>{t.progress.insight}</SectionTitle>
        <Card style={styles.insightCard}>
          {visibleMeals.length >= 3 && trackedDays > 0 ? (
            <View style={styles.insightIcon}>
              <Ionicons color={colors.onAccent} name="sparkles" size={22} />
            </View>
          ) : <EmptyIllustration icon="leaf-outline" size={64} />}
          <View style={styles.insightCopy}>
            <Text style={styles.insightTitle}>{visibleMeals.length >= 3 && trackedDays > 0 ? t.progress.insightBuilding : t.progress.insightStart}</Text>
            <Text style={styles.insightText}>
              {visibleMeals.length >= 3 && trackedDays > 0
                ? t.progress.insightBuildingText(visibleMeals.length, averageProtein)
                : t.progress.insightStartText}
            </Text>
          </View>
        </Card>
      </View>

      <Modal animationType="fade" onRequestClose={() => setShowWeightEntry(false)} transparent visible={showWeightEntry}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalScrim}>
          <KeyboardBackfill color={colors.surface} />
          <ScrollView accessibilityViewIsModal keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={styles.modalScroll} contentContainerStyle={[styles.modalCard, { paddingBottom: insets.bottom + 22 }]}>
            <Text accessibilityRole="header" style={styles.modalTitle}>{t.progress.weightModalTitle}</Text>
            <Text style={styles.modalText}>{t.progress.weightModalText}</Text>
            {units === 'uk' ? (
              <View style={styles.weightInputRow}>
                <TextInput
                  accessibilityLabel={t.progress.weightLabel(t.progress.unitStone)}
                  autoFocus
                  keyboardType="number-pad"
                  onChangeText={setStoneInput}
                  selectTextOnFocus
                  style={[styles.weightInput, styles.weightInputSplit]}
                  value={stoneInput}
                />
                <Text style={styles.weightUnit}>st</Text>
                <TextInput
                  accessibilityLabel={t.progress.weightLabel(t.progress.unitPounds)}
                  keyboardType="decimal-pad"
                  onChangeText={setStonePounds}
                  selectTextOnFocus
                  style={[styles.weightInput, styles.weightInputSplit]}
                  value={stonePounds}
                />
                <Text style={styles.weightUnit}>lb</Text>
              </View>
            ) : (
              <View style={styles.weightInputRow}>
                <TextInput
                  accessibilityLabel={t.progress.weightLabel(
                    units === 'metric' ? t.progress.unitKilograms : t.progress.unitPounds,
                  )}
                  autoFocus
                  keyboardType="decimal-pad"
                  onChangeText={setWeightInput}
                  selectTextOnFocus
                  style={styles.weightInput}
                  value={weightInput}
                />
                <Text style={styles.weightUnit}>{weightInputUnit(units)}</Text>
              </View>
            )}
            {weightError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{weightError}</Text> : null}
            <PrimaryButton disabled={saving} haptic label={saving ? t.common.saving : t.common.save} onPress={() => void saveWeight()} />
            <PrimaryButton disabled={saving} label={t.common.cancel} onPress={() => setShowWeightEntry(false)} variant="ghost" />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const WEIGHT_CHART_HEIGHT = 150;

function WeightChart({ entries }: { entries: { date: string; weightKg: number }[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const [width, setWidth] = useState(0);
  if (entries.length < 2) {
    return (
      <View style={styles.emptyChart}>
        <EmptyIllustration icon="analytics-outline" size={80} />
        <Text style={styles.emptyChartText}>{t.progress.emptyChart}</Text>
      </View>
    );
  }
  const shown = entries.slice(-12);
  // Time-scaled: readings sit where they happened, not one per slot.
  const { points } = weightChartLayout(shown, width, WEIGHT_CHART_HEIGHT);
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const last = points.at(-1);
  return (
    <View
      accessibilityLabel={t.progress.weightChartLabel(shown.length)}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={styles.chart}
    >
      {width > 0 && last ? (
        <Svg height={WEIGHT_CHART_HEIGHT} width={width}>
          {[0, 1, 2].map((row) => {
            const y = 14 + row * ((WEIGHT_CHART_HEIGHT - 28) / 2);
            return <Line key={row} stroke={colors.border} strokeWidth={1} x1={0} x2={width} y1={y} y2={y} />;
          })}
          {points.map((point) => (
            <Rect fill={colors.border} height={6} key={`tick-${point.date}`} rx={1} width={2} x={point.x - 1} y={WEIGHT_CHART_HEIGHT - 6} />
          ))}
          <Path d={line} fill="none" stroke={colors.accentText} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} />
          {points.slice(0, -1).map((point) => (
            <Circle cx={point.x} cy={point.y} fill={colors.surface} key={point.date} r={3.5} stroke={colors.accentText} strokeWidth={2} />
          ))}
          <Circle cx={last.x} cy={last.y} fill={colors.surface} r={9} />
          <Circle cx={last.x} cy={last.y} fill={colors.accentText} r={6} />
        </Svg>
      ) : null}
    </View>
  );
}

/** Seven days against the goal line. An empty day is a stub, never a 0 kcal success. */
function WeekBars({ days, target }: { days: { key: string; label: string; today: boolean; logged: boolean; calories: number }[]; target: number }) {
  const { colors, mode } = useTheme();
  // Moss on dark surfaces nearly disappears, so dark mode swaps the two greens:
  // "close to target" stays the stronger mark in both themes.
  const loggedFill = mode === 'dark' ? colors.accentDeep : colors.accent;
  const withinFill = mode === 'dark' ? colors.accent : colors.accentDeep;
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const [width, setWidth] = useState(0);
  const height = 112;
  const top = 18;
  const ceiling = Math.max(target * 1.3, ...days.map((day) => day.calories), 1);
  const scale = (value: number) => top + (1 - Math.min(1, value / ceiling)) * (height - top);
  const goalY = scale(target);
  const slot = width / Math.max(1, days.length);
  const barWidth = Math.min(28, slot * 0.56);
  const logged = days.filter((day) => day.logged);
  const average = logged.length ? Math.round(logged.reduce((sum, day) => sum + day.calories, 0) / logged.length) : 0;
  return (
    <View accessible accessibilityLabel={t.progress.weekChartLabel(formatNumber(average, locale), formatNumber(Math.round(target), locale), logged.length)}>
      <View onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} style={{ height }}>
        {width > 0 ? (
          <Svg height={height} width={width}>
            {days.map((day, index) => {
              const within = day.logged && target > 0 && Math.abs(day.calories / target - 1) <= 0.1;
              const y = day.logged ? Math.min(height - 6, scale(day.calories)) : height - 6;
              return (
                <Rect
                  fill={!day.logged ? colors.neutralSoft : within ? withinFill : loggedFill}
                  height={height - y}
                  key={day.key}
                  rx={Math.min(8, barWidth / 2)}
                  width={barWidth}
                  x={index * slot + (slot - barWidth) / 2}
                  y={y}
                />
              );
            })}
            {target > 0 ? <Line stroke={colors.text} strokeDasharray="4 5" strokeWidth={1.5} x1={0} x2={width} y1={goalY} y2={goalY} /> : null}
          </Svg>
        ) : null}
        {target > 0 && width > 0 ? (
          <Text style={[styles.goalLineLabel, { top: Math.max(0, goalY - 20) }]}>{t.progress.goalLine(formatNumber(Math.round(target), locale))}</Text>
        ) : null}
      </View>
      <View style={styles.weekLabels}>
        {days.map((day) => (
          <Text key={day.key} style={[styles.stripLabel, styles.weekLabel, day.today && styles.stripLabelToday]}>{day.label}</Text>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  headerCopy: { flex: 1, gap: 8 },
  subtitle: { ...typeScale.callout, color: colors.muted },
  heroValueEmpty: { color: colors.border },
  consistencyHero: { padding: 20, gap: 14 },
  heroLabel: { ...typeScale.eyebrow, color: colors.muted },
  heroValueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  heroValue: { color: colors.text, fontSize: 46, lineHeight: 50, fontWeight: '700', letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
  heroOf: { ...typeScale.callout, color: colors.muted },
  strip: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  stripDay: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  stripTrack: { width: '100%', height: 64, borderRadius: 8, backgroundColor: colors.neutralSoft, justifyContent: 'flex-end', overflow: 'hidden' },
  // Three readable states: untouched, tracked, target reached.
  stripFill: { width: '100%', borderRadius: 8, backgroundColor: colors.border },
  stripFillLogged: { backgroundColor: colors.accent },
  stripFillReached: { backgroundColor: colors.accentDeep },
  stripLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '600' },
  stripLabelToday: { color: colors.text, fontWeight: '800' },
  heroFoot: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  weightCard: { padding: 20, gap: 16 },
  weightTop: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLabel: { ...typeScale.eyebrow, color: colors.muted },
  currentWeight: { color: colors.text, fontSize: 42, lineHeight: 49, fontWeight: '700', letterSpacing: -1.4, marginTop: 4, fontVariant: ['tabular-nums'] },
  kg: { ...typeScale.headline, fontWeight: '600' },
  changePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.neutralSoft, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 7 },
  changeText: { ...typeScale.caption, color: colors.accentText, fontWeight: '700' },
  firstPill: { backgroundColor: colors.neutralSoft, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 7 },
  firstPillText: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 0.7 },
  chart: { height: WEIGHT_CHART_HEIGHT, overflow: 'hidden' },
  emptyChart: { minHeight: 150, borderRadius: radii.input, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 },
  emptyWeek: { minHeight: 112, alignItems: 'center', justifyContent: 'center' },
  goalLineLabel: { ...typeScale.caption, position: 'absolute', right: 0, color: colors.muted, fontWeight: '700', fontVariant: ['tabular-nums'], backgroundColor: colors.surface, paddingLeft: 6 },
  weekLabels: { flexDirection: 'row', marginTop: 8 },
  weekLabel: { flex: 1, textAlign: 'center' },
  weekTiles: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  weekTile: { flex: 1, gap: 6 },
  weekTileDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 14 },
  weekTileValue: { color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weekTileLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '600' },
  emptyChartText: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  chartLabel: { ...typeScale.caption, color: colors.muted },
  weekGoalBody: { gap: 4 },
  weekGoalTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weekGoalDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, minHeight: 24, alignItems: 'center' },
  // Logged days fill in; empty days stay a quiet outline, never a warning colour.
  weekGoalDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  weekGoalDotLogged: { backgroundColor: colors.accent, borderColor: colors.accent },
  weekGoalDotToday: { borderColor: colors.accentText },
  weekGoalText: { ...typeScale.footnote, color: colors.muted },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flexGrow: 1, flexBasis: 95, padding: 14, borderRadius: radii.card, gap: 4 },
  statValue: { ...typeScale.headline, color: colors.text, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  statLabel: { ...typeScale.caption, color: colors.muted },
  // 32 pt above a section header (20 pt screen gap + 12), 12 pt below it.
  section: { gap: 12, marginTop: 12 },
  insightCard: { flexDirection: 'row', gap: 14, backgroundColor: colors.accentSoft, borderColor: colors.accent },
  insightIcon: { width: 46, height: 46, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  insightCopy: { flex: 1, gap: 6 },
  insightTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  insightText: { ...typeScale.footnote, color: colors.muted },
  modalScrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.42)', justifyContent: 'flex-end' },
  modalScroll: { flexGrow: 0, maxHeight: '100%', borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface },
  modalCard: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface, paddingHorizontal: 24, paddingTop: 24, gap: 12 },
  modalTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  modalText: { ...typeScale.footnote, color: colors.muted },
  weightInputRow: { minHeight: 64, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  weightInputSplit: { minWidth: 76, flex: 0 },
  weightInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weightUnit: { ...typeScale.label, color: colors.muted, fontWeight: '600' },
  error: { ...typeScale.caption, color: colors.attentionText },
});
