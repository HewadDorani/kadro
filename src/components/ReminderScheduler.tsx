import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useAccess } from '@/context/AccessContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { setReminderDayStatus, syncEveningReminder, syncReengagementReminder } from '@/services/reminders';
import { lastMealSavedAt } from '@/services/consistency';

/**
 * Keeps local notifications in step with the diary. Every saved or removed
 * meal changes today's totals, which re-plans today's remaining meal reminders
 * with the real numbers and moves the single re-engagement note. A store
 * subscription instead of hooks in each save path: all of them end here.
 */
export function ReminderScheduler() {
  const { consumed, hydrationReady, mealHistory, meals, targets, wellnessConsentGranted } = useApp();
  const { canUse } = useAccess();
  const day = useLocalDay();
  const loggedTypes = useMemo(() => [...new Set(meals.map((meal) => meal.type))].sort().join(','), [meals]);
  const lastSavedAt = useMemo(() => lastMealSavedAt(mealHistory), [mealHistory]);
  const firstWeek = useMemo(() => {
    const first = Math.min(...mealHistory.map(meal => Date.parse(meal.savedAt ?? '')).filter(Number.isFinite));
    return Number.isFinite(first) && Date.now() - first < 7 * 86_400_000;
  }, [mealHistory]);
  const remainingCalories = Math.round(targets.calories - consumed.calories);
  const remainingProtein = Math.round(targets.protein - consumed.protein);
  useEffect(() => {
    if (!hydrationReady || !wellnessConsentGranted) return;
    setReminderDayStatus({ day, remainingCalories, remainingProtein, loggedTypes: loggedTypes ? loggedTypes.split(',') : [] });
    const refresh = () => {
      void syncEveningReminder().catch(() => undefined);
      void syncReengagementReminder(lastSavedAt, firstWeek).catch(() => undefined);
    };
    // Hydration and a save can change several values in a row; plan once.
    const timer = setTimeout(refresh, 400);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [hydrationReady, wellnessConsentGranted, canUse, day, remainingCalories, remainingProtein, loggedTypes, lastSavedAt, firstWeek]);
  return null;
}
