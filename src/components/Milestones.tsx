import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useLanguage } from '@/i18n/LanguageProvider';
import { successHaptic } from '@/services/haptics';
import { weeklyLoggingGoal } from '@/services/consistency';
import { claimFirstMealCelebration, markFirstMealCelebrated, markThreeDayMilestone, scheduleThreeDayMilestone } from '@/services/reminders';
import type { Meal } from '@/types/nutrition';
import { localDateKey } from '@/utils/date';
import { formatNumber } from '@/utils/format';
import { typeScale } from '@/constants/theme';

/** Real logged days (no seed/demo), with their calorie totals. */
export function loggedDays(meals: Meal[]) {
  const days = new Map<string, number>();
  const seen = new Set<string>();
  for (const meal of meals) {
    if (seen.has(meal.id) || meal.origin === 'seed' || !meal.date || !Number.isFinite(meal.calories)) continue;
    seen.add(meal.id);
    days.set(meal.date, (days.get(meal.date) ?? 0) + meal.calories);
  }
  return days;
}

/**
 * Two moments that make progress felt:
 * - the very first logged meal gets a short celebration with today's balance;
 * - the third distinct logging day schedules a true summary for next morning,
 *   framed as the weekly goal (days logged of the last seven), not a streak.
 * Long-time users are marked as done silently and never see either late.
 */
export function Milestones() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const { consumed, hydrationReady, mealHistory, profile, targets } = useApp();
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  // Shown on Today, after the ring has visibly filled, not mid-save.
  const focused = useIsFocused();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending || !focused) return;
    const timer = setTimeout(() => { setPending(false); void successHaptic(); setVisible(true); }, reduceMotion ? 0 : 1000);
    return () => clearTimeout(timer);
  }, [pending, focused, reduceMotion]);
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.4)).current;
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    if (!hydrationReady || !profile.completedAt) return;
    const days = loggedDays(mealHistory);
    const count = days.size;
    const meals = mealHistory.filter(meal => meal.origin !== 'seed').length;
    // The first value seen after hydration is the baseline: celebrate only a
    // meal logged while the app is in use, never history loaded on start.
    if (baseline.current === null) {
      baseline.current = meals;
      if (meals > 1) void markFirstMealCelebrated();
      if (count > 3) void markThreeDayMilestone();
      return;
    }
    if (baseline.current === 0 && meals >= 1) {
      baseline.current = meals;
      void claimFirstMealCelebration().then(first => {
        if (first) setPending(true);
      });
    }
    baseline.current = Math.max(baseline.current, meals);
    if (count === 3 && days.has(localDateKey())) {
      const average = Math.round([...days.values()].reduce((sum, value) => sum + value, 0) / count);
      const week = weeklyLoggingGoal(mealHistory);
      void scheduleThreeDayMilestone(average, Math.round(targets.calories), week.logged, week.goal);
    } else if (count > 3) void markThreeDayMilestone();
  }, [hydrationReady, mealHistory, profile.completedAt, targets.calories]);

  useEffect(() => {
    if (!visible || reduceMotion) return;
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [visible, reduceMotion, scale]);

  const left = Math.round(targets.calories - consumed.calories);
  return (
    <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.card}>
          <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
            <Ionicons color={colors.onAccent} name="checkmark" size={44} />
          </Animated.View>
          <Text accessibilityRole="header" style={styles.title}>{t.milestones.firstTitle}</Text>
          <Text style={styles.body}>{left >= 0 ? t.milestones.firstLeft(formatNumber(left, locale)) : t.milestones.firstOver(formatNumber(-left, locale))}</Text>
          <View style={styles.pill}>
            <View style={[styles.dot, { backgroundColor: colors.macroProtein }]} />
            <Text style={styles.pillText}>{t.milestones.firstProtein(Math.round(consumed.protein), Math.round(targets.protein))}</Text>
          </View>
          <PrimaryButton icon="arrow-forward" label={t.milestones.firstCta} onPress={() => setVisible(false)} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 28, padding: 26, alignItems: 'center', gap: 14 },
  badge: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' },
  body: { ...typeScale.body, color: colors.muted, textAlign: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.neutralSoft, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
});
