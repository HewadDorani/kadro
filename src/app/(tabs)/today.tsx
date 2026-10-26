import { Milestones } from '@/components/Milestones';
import { TrialActivationCard } from '@/components/TrialActivationCard';
import { usePresentationBlock } from '@/services/presentation';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { MealSyncStatus } from '@/components/MealSyncStatus';
import { BillingIssueBanner } from '@/components/BillingIssueBanner';
import { TrialEndingCard } from '@/components/TrialEndingCard';
import { CalorieRing, overBudgetLevel } from '@/components/CalorieRing';
import { MealDetailSheet } from '@/components/MealDetailSheet';
import { FavoriteLogSheet } from '@/components/FavoriteLogSheet';
import { useToast } from '@/components/Toast';
import { Card, Eyebrow, IconCircle, MacroCard, PressableScale, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { ShareDayModal } from '@/components/ShareDayModal';
import { HERO_MAX_FONT_SCALE, radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { recommendationPreview } from '@/services/recommendations';
import { Meal } from '@/types/nutrition';
import { useLanguage } from '@/i18n/LanguageProvider';
import { formatDateParts, formatDayLabel, formatNumber, mealTypeIcon, mealTypeLabel } from '@/utils/format';
import { greetingForHour, mealTypeForHour } from '@/utils/daypart';
import { availableRepeats, RepeatCandidate, withFavorites, yesterdayBreakfast } from '@/services/repeatMeals';
import { useLocalDay } from '@/hooks/useLocalDay';
import { sumMeals } from '@/services/mockNutrition';
import { MAX_BACKDATE_DAYS, shiftDateKey } from '@/utils/mealDay';
import { latestMainSlot, nextMealSlot } from '@/services/shareDay';

const REPEAT_CARD_WIDTH = 152;
const REPEAT_GAP = 10;

export default function TodayScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { consumed: consumedToday, favoriteMeals, hasLoggedScan, mealHistory, meals, pendingAnalysisCount, profile, refreshCloudState, remaining, repeatMeals, resetScan, resumeLatestAnalysis, setPlannedMealDate, setPlannedMealType, syncMode, targets, userName } = useApp();
  // "Nochmal essen" asks which slot ("Als … eintragen") instead of guessing it from the clock.
  const [choosing, setChoosing] = useState<{ candidate: RepeatCandidate; slot: Meal['type'] } | null>(null);
  const repeating = choosing?.candidate.key ?? null;
  const { toast, show: showToast } = useToast();
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  usePresentationBlock(Boolean(openMeal || repeating));
  const { language, locale, t } = useLanguage();
  const day = useLocalDay();
  // Days back from today, not a date: a screen left on "Heute" follows midnight.
  const [dayOffset, setDayOffset] = useState(0);
  const isToday = dayOffset === 0;
  const viewDay = isToday ? day : shiftDateKey(day, -dayOffset);
  const showDay = (offset: number) => setDayOffset(Math.min(MAX_BACKDATE_DAYS, Math.max(0, offset)));
  // A horizontal swipe over the day header moves between days; vertical
  // scrolling and the "Nochmal essen" carousel keep their own gestures.
  const offsetRef = useRef(dayOffset);
  offsetRef.current = dayOffset;
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx > 60) showDay(offsetRef.current + 1);
      else if (gesture.dx < -60) showDay(offsetRef.current - 1);
    },
  })).current;
  const dayMeals = useMemo(() => isToday ? meals : mealHistory.filter((meal) => meal.date === viewDay), [isToday, mealHistory, meals, viewDay]);
  // Totals always come from the shown day's meals; today keeps the context's numbers.
  const consumed = useMemo(() => isToday ? consumedToday : sumMeals(dayMeals), [consumedToday, dayMeals, isToday]);
  const yesterday = useMemo(() => isToday ? yesterdayBreakfast(mealHistory, meals, day) : null, [isToday, mealHistory, meals, day]);
  // Favourites first, then yesterday's breakfast, then the usual repeats.
  const repeatChoices = useMemo(() => {
    const base = isToday ? repeatMeals : availableRepeats(mealHistory, dayMeals);
    const ordered = yesterday ? [yesterday, ...base.filter(candidate => candidate.key !== yesterday.key)] : base;
    return withFavorites(ordered, favoriteMeals, mealHistory);
  }, [dayMeals, favoriteMeals, isToday, mealHistory, repeatMeals, yesterday]);
  const dateLabel = formatDateParts(new Date(), { weekday: 'short', day: 'numeric', month: 'long' }, locale);
  // The greeting was hard-coded to "Guten Morgen", so the app said good morning
  // at 22:00.
  // Same clock as the default meal slot (utils/daypart), so a "Guten Abend"
  // never sits next to a meal filed as lunch.
  const hour = new Date().getHours();
  const daypart = { morning: t.today.goodMorning, day: t.today.goodDay, evening: t.today.goodEvening }[greetingForHour(hour)];
  const eveningReady = hour >= 18;
  const greeting = userName.trim() ? `${daypart}, ${userName}` : daypart;
  // Keep the target status visible while still offering optional small meals.
  const dayIsDone = remaining.calories < 200;
  const overBudget = consumed.calories > targets.calories;
  const overLevel = overBudgetLevel(consumed.calories, targets.calories);
  const nextMeal = useMemo(() => recommendationPreview(remaining, profile.preferences), [language, remaining, profile.preferences]);
  const [calorieLow, calorieHigh] = nextMeal.calories;
  const calorieRange = calorieLow === calorieHigh ? `${calorieLow}` : `${calorieLow}–${calorieHigh}`;
  const [proteinLow, proteinHigh] = nextMeal.protein;
  const proteinRange = proteinLow === proteinHigh ? `${proteinLow}` : `${proteinLow}–${proteinHigh}`;
  // The ideas are for the slot after the latest meal today, or the clock's.
  const shareSlot = nextMealSlot(latestMainSlot(meals.map((meal) => meal.type)), hour);

  // Pull to refresh only where there is something to refresh: the cloud copy.
  const canRefresh = syncMode !== 'local';
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshCloudState();
    } catch {
      // MealSyncStatus shows the failed sync with its own retry.
    } finally {
      setRefreshing(false);
    }
  };

  const startScan = (slot?: Meal['type']) => {
    resetScan();
    // resetScan clears any previous choice, so the slot is set after it.
    if (slot) setPlannedMealType(slot);
    // Logging while looking at an earlier day files the meal on that day.
    if (!isToday) setPlannedMealDate(viewDay);
    router.navigate('/(tabs)/scan');
  };

  /**
   * Four slots, always all four, in the order a day happens.
   *
   * A flat list left "add a meal" as one button at the bottom and made the
   * app guess from the clock which meal it was: a late breakfast filed as
   * lunch, and no way to say otherwise before logging.
   */
  const slots = useMemo(() => (['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const).map((type) => {
    const entries = dayMeals.filter((meal) => meal.type === type);
    return { type, entries, calories: entries.reduce((total, meal) => total + meal.calories, 0) };
  }), [dayMeals]);

  const resumePending = async () => {
    if (await resumeLatestAnalysis()) router.push('/analyzing');
  };

  // People eat the same things over and over. One tap beats a new scan, costs
  // no analysis call and no waiting. The tap opens "Als … eintragen" with the
  // four slots, preselected by the clock (yesterday's breakfast: Breakfast),
  // so a late breakfast is not filed as lunch. Logging happens in the sheet,
  // on the day shown (the day switcher), never on a stale slot chosen earlier.
  const repeat = (key: string) => {
    const candidate = repeatChoices.find((entry) => entry.key === key);
    if (!candidate || repeating) return;
    setChoosing({ candidate, slot: candidate === yesterday ? 'Breakfast' : mealTypeForHour(new Date().getHours()) });
  };
  const repeatDate = isToday ? null : viewDay;

  const { width } = useWindowDimensions();
  return (
    <Screen overlay={toast} refreshControl={canRefresh ? <RefreshControl colors={[colors.accentText]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={colors.muted} /> : undefined}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.date}>{isToday ? dateLabel : formatDateParts(viewDay, { weekday: 'short', day: 'numeric', month: 'long' }, locale)}</Text>
          <Text style={styles.greeting}>{greeting}</Text>
        </View>
        <Pressable accessibilityLabel={t.common.openProfile} onPress={() => router.push('/(tabs)/profile')} style={styles.avatar}>
          <Text style={styles.avatarText}>{userName.trim().charAt(0).toUpperCase() || 'K'}</Text>
        </Pressable>
      </View>

      <View {...swipe.panHandlers} style={styles.daySwitcher}>
        <Pressable
          accessibilityLabel={t.today.previousDay}
          accessibilityRole="button"
          accessibilityState={{ disabled: dayOffset >= MAX_BACKDATE_DAYS }}
          disabled={dayOffset >= MAX_BACKDATE_DAYS}
          hitSlop={6}
          onPress={() => showDay(dayOffset + 1)}
          style={[styles.dayChevron, dayOffset >= MAX_BACKDATE_DAYS && styles.dayChevronOff]}
        >
          <Ionicons color={colors.text} name="chevron-back" size={20} />
        </Pressable>
        <Pressable
          accessibilityHint={isToday ? undefined : t.today.backToToday}
          accessibilityLabel={formatDayLabel(viewDay, day, t.today, locale)}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          accessibilityState={{ disabled: isToday }}
          disabled={isToday}
          onPress={() => showDay(0)}
          style={styles.dayLabelWrap}
        >
          <Text style={styles.dayLabel}>{formatDayLabel(viewDay, day, t.today, locale)}</Text>
          {!isToday ? <Text style={styles.dayBack}>{t.today.backToToday}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityLabel={t.today.nextDay}
          accessibilityRole="button"
          accessibilityState={{ disabled: isToday }}
          disabled={isToday}
          hitSlop={6}
          onPress={() => showDay(dayOffset - 1)}
          style={[styles.dayChevron, isToday && styles.dayChevronOff]}
        >
          <Ionicons color={colors.text} name="chevron-forward" size={20} />
        </Pressable>
      </View>

      <MealSyncStatus />
      <BillingIssueBanner />
      <TrialEndingCard />

      {pendingAnalysisCount > 0 ? (
        <Pressable
          accessibilityHint={t.today.pendingHint}
          accessibilityLabel={pendingAnalysisCount === 1 ? t.today.pendingOne : t.today.pendingMany(pendingAnalysisCount)}
          accessibilityRole="button"
          onPress={resumePending}
          style={styles.pendingBanner}
        >
          <View style={styles.pendingIcon}><Ionicons color={colors.text} name="cloud-offline-outline" size={19} /></View>
          <View style={styles.pendingCopy}>
            <Text style={styles.pendingTitle}>
              {pendingAnalysisCount === 1 ? t.today.pendingOne : t.today.pendingMany(pendingAnalysisCount)}
            </Text>
            <Text style={styles.pendingText}>{t.today.pendingHint}</Text>
          </View>
          <Ionicons color={colors.text} name="refresh" size={19} />
        </Pressable>
      ) : null}

      <Card style={styles.heroCard}>
        <View {...swipe.panHandlers} style={styles.heroSwipe}>
        <View style={styles.heroTop}>
          <View style={styles.heroHeading}>
            <Eyebrow>{isToday ? t.today.status : t.today.pastDayStatus}</Eyebrow>
            <Text style={styles.onTrack}>
              {!isToday
                ? overLevel !== 'none' ? t.today.pastDayOver : dayMeals.length ? t.today.pastDayLogged : t.today.pastDayEmpty
                : overLevel === 'over'
                  ? t.today.dayOver
                  : overLevel === 'slight'
                    ? t.today.overToday
                    : hasLoggedScan ? t.today.onTrack : t.today.firstMove}
            </Text>
          </View>
          {isToday && dayMeals.length > 0 ? (
            <PressableScale
              accessibilityHint={t.shareDay.openHint}
              accessibilityLabel={t.shareDay.open}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => setSharing(true)}
              style={styles.shareButton}
            >
              <Ionicons color={colors.text} name="share-outline" size={18} />
            </PressableScale>
          ) : null}
        </View>
        <CalorieRing consumed={consumed.calories} proteinReached={targets.protein > 0 && consumed.protein >= targets.protein * 0.9} total={targets.calories} />
        {overLevel !== 'none' ? <Text style={styles.consumed}>{t.ring.tomorrowNew}</Text> : null}
        {width < 360 ? <Text style={styles.consumed}>{formatNumber(consumed.calories, locale)} {t.today.eaten} · {formatNumber(targets.calories, locale)} {t.today.goal}</Text> : null}
        </View>
      </Card>

      <View style={styles.macroRow}>
        <MacroCard current={consumed.protein} icon="barbell-outline" label={t.common.protein} minimum target={targets.protein} tint={colors.macroProtein} />
        <MacroCard current={consumed.carbs} icon="flash-outline" label={t.common.carbs} target={targets.carbs} tint={colors.macroCarbs} />
        <MacroCard current={consumed.fat} icon="water-outline" label={t.common.fat} target={targets.fat} tint={colors.macroFat} />
      </View>

      {/* Keep the target status visible; small meal ideas remain optional and
          disclose their projected overage before the user records a meal.
          "Was als Nächstes" is about today, so an earlier day only says where
          new entries go. */}
      {!isToday ? (
        <Card style={styles.pastCard}>
          <Ionicons color={colors.text} name="calendar-outline" size={20} />
          <Text style={styles.pastText}>{t.today.pastDayHint}</Text>
          <Pressable accessibilityLabel={t.today.backToToday} accessibilityRole="button" hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} onPress={() => showDay(0)}>
            <Text style={styles.pastAction}>{t.today.backToToday}</Text>
          </Pressable>
        </Card>
      ) : dayIsDone ? (
        <Card style={styles.nextCard}>
          <View style={styles.nextHeader}>
            <IconCircle name={overBudget ? 'information-circle' : 'checkmark'} size={48} tone={overBudget ? 'neutral' : 'accent'} />
            <View style={styles.nextHeading}>
              <Eyebrow>{t.today.nextMove}</Eyebrow>
              <Text style={styles.mealMoment}>{overBudget ? t.today.dayOver : t.today.dayComplete}</Text>
            </View>
          </View>
          <Text style={styles.dayDoneText}>{overBudget ? t.today.dayOverText : t.today.dayCompleteText}</Text>
          <PrimaryButton haptic icon="arrow-forward" label={t.plan.smallIdeas} onPress={() => router.push('/(tabs)/plan')} variant="secondary" />
          <PrimaryButton haptic icon="add" label={t.today.logAnyway} onPress={() => router.push('/(tabs)/scan')} variant="ghost" />
        </Card>
      ) : (
        <Card style={styles.nextCard}>
          <PressableScale
            accessibilityHint={t.today.showIdeas}
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/plan')}
            style={styles.nextHeader}
          >
            <IconCircle name="navigate" size={48} />
            <View style={styles.nextHeading}>
              <Eyebrow>{t.today.nextMove}</Eyebrow>
              <Text style={styles.mealMoment}>{hasLoggedScan ? t.today.nextMeal : t.today.firstMeal}</Text>
            </View>
            <Ionicons color={colors.text} name="arrow-forward" size={20} />
          </PressableScale>
          <View style={styles.targetRow}>
            <View style={styles.targetBlock}>
              <Text style={styles.targetLabel}>{t.today.targetRange}</Text>
              <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.targetValue}>{calorieRange} kcal</Text>
            </View>
            <View style={styles.targetDivider} />
            <View style={styles.targetBlock}>
              <Text style={styles.targetLabel}>{t.today.proteinLabel}</Text>
              <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.targetValue}>{proteinRange} g</Text>
            </View>
          </View>
          {/* The aha moment is the first logged meal, not a list of ideas:
              before it, the primary action opens capture directly. */}
          {!hasLoggedScan ? <PrimaryButton haptic icon="camera" label={t.today.logFirstMeal} onPress={() => router.push('/(tabs)/scan')} /> : null}
          <PrimaryButton haptic icon="arrow-forward" label={t.today.showIdeas} onPress={() => router.push('/(tabs)/plan')} variant={hasLoggedScan ? 'secondary' : 'ghost'} />
        </Card>
      )}

      {isToday ? <TrialActivationCard /> : null}
      {isToday ? <Milestones /> : null}

      {repeatChoices.length ? (
        <View style={styles.sectionBlock}>
          <SectionTitle action={favoriteMeals.length ? (
            <Pressable accessibilityLabel={t.today.allFavorites} accessibilityRole="button" hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} onPress={() => router.push('/saved-meals' as never)}>
              <Text style={styles.sectionAction}>{t.today.allFavorites}</Text>
            </Pressable>
          ) : undefined}>{t.today.eatAgain}</SectionTitle>
          <ScrollView
            contentContainerStyle={styles.repeatRow}
            decelerationRate="fast"
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToAlignment="start"
            snapToInterval={REPEAT_CARD_WIDTH + REPEAT_GAP}
            style={styles.repeatScroll}
          >
            {repeatChoices.map((candidate) => (
              <PressableScale
                accessibilityLabel={candidate === yesterday ? `${t.today.yesterdayBreakfast}: ${candidate.title}` : t.common.repeatLabel(candidate.title)}
                accessibilityHint={candidate === yesterday ? t.today.yesterdayBreakfastHint : undefined}
                accessibilityRole="button"
                accessibilityState={{ disabled: repeating !== null }}
                disabled={repeating !== null}
                key={candidate.key}
                onPress={() => repeat(candidate.key)}
                style={[styles.repeatCard, candidate.favorite && styles.repeatFavorite, repeating !== null && repeating !== candidate.key && styles.repeatBusy]}
              >
                <View style={styles.repeatTop}>
                  <View style={[styles.repeatIcon, candidate.favorite && styles.repeatIconFavorite]}>
                    <Ionicons accessibilityLabel={candidate.favorite ? t.today.favoriteLabel : undefined} color={candidate.favorite ? colors.onAccent : colors.text} name={candidate.favorite ? 'star' : 'refresh'} size={14} />
                  </View>
                  {candidate.count > 1 ? <Text style={styles.repeatCount}>{candidate.count}×</Text> : null}
                </View>
                {candidate === yesterday ? <Text style={styles.repeatYesterday}>{t.today.yesterdayBreakfast}</Text> : null}
                <Text numberOfLines={2} style={styles.repeatTitle}>{candidate.title}</Text>
                <Text style={styles.repeatMacros}>~{formatNumber(candidate.calories, locale)} kcal · {candidate.protein} g P</Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <SectionTitle>{isToday ? t.today.heading : t.today.pastHeading}</SectionTitle>
        {slots.map((slot) => (
          <Card key={slot.type} style={styles.slotCard}>
            <View style={styles.slotHeader}>
              <View style={styles.mealIcon}>
                <Ionicons color={colors.text} name={mealTypeIcon(slot.type)} size={20} />
              </View>
              <Text style={styles.slotTitle}>{mealTypeLabel(slot.type, t.common)}</Text>
              <Text style={styles.slotCalories}>
                {slot.calories ? `${formatNumber(slot.calories, locale)} kcal` : ''}
              </Text>
              <PressableScale
                accessibilityLabel={t.today.addTo(mealTypeLabel(slot.type, t.common))}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => startScan(slot.type)}
                style={styles.slotAdd}
              >
                <Ionicons color={colors.text} name="add" size={20} />
              </PressableScale>
            </View>
            {/* An empty slot says what goes there and opens the camera for it. */}
            {!slot.entries.length ? (
              <View>
                <View style={styles.rowDivider} />
                <Pressable
                  accessibilityHint={t.today.addTo(mealTypeLabel(slot.type, t.common))}
                  accessibilityLabel={t.today.logSlot(mealTypeLabel(slot.type, t.common))}
                  accessibilityRole="button"
                  onPress={() => startScan(slot.type)}
                  style={({ pressed }) => [styles.addMealRow, pressed && styles.mealRowPressed]}
                >
                  <View style={styles.addIcon}><Ionicons color={colors.muted} name="camera-outline" size={18} /></View>
                  <Text style={styles.addMealText}>{t.today.logSlot(mealTypeLabel(slot.type, t.common))}</Text>
                  <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                </Pressable>
              </View>
            ) : null}
            {slot.entries.map((meal) => (
              <View key={meal.id}>
                <View style={styles.rowDivider} />
                <Pressable
                  accessibilityHint={t.common.mealHint}
                  accessibilityLabel={t.common.mealLabel(mealTypeLabel(meal.type, t.common), meal.title, meal.calories)}
                  accessibilityRole="button"
                  onPress={() => setOpenMeal(meal)}
                  style={({ pressed }) => [styles.mealRow, pressed && styles.mealRowPressed]}
                >
                  <View style={styles.mealInfo}>
                    <Text numberOfLines={1} style={styles.mealName}>{meal.title}</Text>
                    <Text style={styles.mealTime}>{meal.time}</Text>
                  </View>
                  <View style={styles.mealNumbers}>
                    <Text style={styles.mealCalories}>~{formatNumber(meal.calories, locale)}</Text>
                    <Text style={styles.mealUnit}>kcal</Text>
                  </View>
                  <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                </Pressable>
              </View>
            ))}
          </Card>
        ))}
      </View>

      {eveningReady && isToday ? (
        <Pressable accessibilityHint={t.today.eveningText} accessibilityLabel={t.today.eveningTitle} accessibilityRole="button" onPress={() => router.push('/evening')} style={styles.eveningRow}>
          <View style={styles.eveningIcon}><Ionicons color={colors.text} name="moon-outline" size={19} /></View>
          <View style={styles.eveningCopy}>
            <Text style={styles.eveningTitle}>{t.today.eveningTitle}</Text>
            <Text style={styles.eveningText}>{t.today.eveningText}</Text>
          </View>
          <Ionicons color={colors.muted} name="chevron-forward" size={18} />
        </Pressable>
      ) : null}

      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} />
      <FavoriteLogSheet
        candidate={choosing?.candidate ?? null}
        date={repeatDate}
        defaultSlot={choosing?.slot ?? 'Snack'}
        onClose={() => setChoosing(null)}
        onLogged={(_meal, slot) => { setChoosing(null); showToast(t.favorites.loggedAs(mealTypeLabel(slot, t.common))); }}
        visible={choosing !== null}
      />
      {isToday ? (
        <ShareDayModal
          input={{
            consumedCalories: consumed.calories,
            targetCalories: targets.calories,
            consumedProtein: consumed.protein,
            targetProtein: targets.protein,
            next: nextMeal,
            slot: shareSlot,
          }}
          onClose={() => setSharing(false)}
          visible={sharing}
        />
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The greeting has to yield to the avatar: "Good afternoon, <name>" is far
  // longer than "Guten Tag" and ran underneath it.
  headerCopy: { flex: 1, paddingRight: 12 },
  date: { ...typeScale.footnote, color: colors.muted, fontWeight: '600' },
  daySwitcher: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
  dayChevron: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dayChevronOff: { opacity: 0.3 },
  dayLabelWrap: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dayLabel: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  dayBack: { ...typeScale.caption, color: colors.accentText, fontWeight: '600', marginTop: 1 },
  pastCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pastText: { ...typeScale.subhead, flex: 1, color: colors.text },
  pastAction: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  sectionAction: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  greeting: { ...typeScale.title1, color: colors.text, fontWeight: '700', marginTop: 5 },
  avatar: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typeScale.callout, color: colors.surface, fontWeight: '800' },
  pendingBanner: { minHeight: 66, borderRadius: radii.card, backgroundColor: colors.attentionSoft, borderWidth: 1, borderColor: colors.attention, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  pendingIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pendingCopy: { flex: 1, gap: 2 },
  pendingTitle: { ...typeScale.footnote, color: colors.text, fontWeight: '700' },
  pendingText: { ...typeScale.caption, color: colors.muted },
  heroCard: { gap: 18, paddingVertical: 22 },
  heroSwipe: { gap: 18 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  heroHeading: { flex: 1, minWidth: 0 },
  onTrack: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4, marginTop: 4 },
  shareButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  consumed: { ...typeScale.caption, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  macroRow: { flexDirection: 'row', gap: 8 },
  dayDoneText: { ...typeScale.subhead, color: colors.muted },
  nextCard: { backgroundColor: colors.accentSoft, borderColor: colors.accent, gap: 16 },
  nextHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextHeading: { flex: 1, gap: 2 },
  mealMoment: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  targetRow: { flexDirection: 'row', alignItems: 'center' },
  targetBlock: { flex: 1, gap: 4 },
  targetLabel: { ...typeScale.eyebrow, color: colors.muted },
  targetValue: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  targetDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.accent, marginHorizontal: 16 },
  // 32 pt above a section header (20 pt screen gap + 12), 12 pt below it.
  sectionBlock: { gap: 12, marginTop: 12 },
  slotCard: { padding: 6, gap: 0 },
  slotHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8 },
  slotTitle: { ...typeScale.callout, flex: 1, color: colors.text, fontWeight: '700' },
  slotCalories: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  slotAdd: { width: 44, height: 44, borderRadius: 17, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  timelineCard: { padding: 8 },
  mealRow: { minHeight: 72, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 12 },
  mealRowPressed: { backgroundColor: colors.background },
  mealIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.attentionSoft, alignItems: 'center', justifyContent: 'center' },
  mealIconLunch: { backgroundColor: colors.neutralSoft },
  mealInfo: { flex: 1, gap: 3 },
  mealMetaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  mealType: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  mealTime: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  mealName: { ...typeScale.caption, color: colors.muted },
  mealNumbers: { alignItems: 'flex-end' },
  mealCalories: { ...typeScale.label, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mealUnit: { ...typeScale.caption, color: colors.muted },
  rowDivider: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
  addMealRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 12 },
  addIcon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  addMealText: { ...typeScale.subhead, flex: 1, color: colors.text, fontWeight: '600' },
  repeatScroll: { marginHorizontal: -20 },
  repeatRow: { paddingHorizontal: 20, gap: REPEAT_GAP },
  repeatCard: { width: REPEAT_CARD_WIDTH, minHeight: 112, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 13, justifyContent: 'space-between' },
  repeatFavorite: { borderColor: colors.accent },
  repeatBusy: { opacity: 0.5 },
  repeatIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  repeatIconFavorite: { backgroundColor: colors.accent },
  repeatTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  repeatCount: { ...typeScale.caption, color: colors.muted, fontWeight: '800', fontVariant: ['tabular-nums'] },
  repeatYesterday: { ...typeScale.caption, color: colors.text, fontWeight: '700', marginTop: 6 },
  repeatTitle: { ...typeScale.footnote, color: colors.text, fontWeight: '600', marginTop: 6 },
  repeatMacros: { ...typeScale.caption, color: colors.muted, marginTop: 4, fontVariant: ['tabular-nums'] },
  eveningRow: { minHeight: 66, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  eveningIcon: { width: 40, height: 40, borderRadius: 15, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  eveningCopy: { flex: 1, minWidth: 0, gap: 2 },
  eveningTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  eveningText: { ...typeScale.caption, color: colors.muted },
});
