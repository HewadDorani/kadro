import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { DeletedMeal, getLocalDataGeneration, loadAllStoredScans, loadDeletedMeals, loadLocalAccountSwitch, subscribeLocalMeals } from '@/services/localRepository';
import { resolveMealDeletionConflict, resolveMealSyncConflict } from '@/services/syncRepository';
import { Meal } from '@/types/nutrition';
import { typeScale } from '@/constants/theme';

/** Local acknowledgement and cloud acknowledgement deliberately have different copy. */
export function MealSyncStatus() {
  const { hydrationReady, wellnessConsentGranted, refreshCloudState, syncMode } = useApp();
  const { colors } = useTheme();
  const { t } = useLanguage();
  const latestRead = useRef(0);
  const [pending, setPending] = useState<Meal[]>([]);
  const [deleted, setDeleted] = useState<DeletedMeal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    const request = ++latestRead.current;
    const generation = getLocalDataGeneration();
    try {
      const [meals, deletions, switching] = await Promise.all([loadAllStoredScans(), loadDeletedMeals(), loadLocalAccountSwitch()]);
      if (request !== latestRead.current || generation !== getLocalDataGeneration() || switching) return;
      setPending(meals.filter((meal) => meal.sync?.status !== 'synced'));
      setDeleted(deletions);
    } catch { setError(true); }
  }, []);
  useEffect(() => {
    if (!hydrationReady || !wellnessConsentGranted) { setPending([]); setDeleted([]); return; }
    let active = true;
    const listener = () => { if (active) void reload(); };
    listener();
    const unsubscribe = subscribeLocalMeals(listener);
    return () => { active = false; latestRead.current++; unsubscribe(); };
  }, [hydrationReady, wellnessConsentGranted, reload]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await operation(); await refreshCloudState(); await reload(); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  // Local-only mode (no cloud configured, or cloud disabled after account
  // deletion) has nothing that could ever be confirmed: no pending notice.
  if (!hydrationReady || !wellnessConsentGranted || syncMode === 'local' || (!pending.length && !deleted.length && !error)) return null;
  const conflict = pending.find((meal) => meal.sync?.status === 'conflict');
  const deletion = deleted.find((meal) => meal.sync.status === 'conflict');
  const resolve = () => {
    if (conflict) Alert.alert(t.mealSync.conflictTitle, t.mealSync.conflictBody(conflict.title), [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.mealSync.useCloud, onPress: () => void run(() => resolveMealSyncConflict(conflict.id, false)) },
      { text: t.mealSync.useLocal, onPress: () => void run(() => resolveMealSyncConflict(conflict.id, true)) },
    ]);
    else if (deletion) Alert.alert(t.mealSync.conflictTitle, t.mealSync.deleteBody, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.mealSync.keepCloud, onPress: () => void run(() => resolveMealDeletionConflict(deletion.id, false)) },
      { text: t.mealSync.deleteCloud, style: 'destructive', onPress: () => void run(() => resolveMealDeletionConflict(deletion.id, true)) },
    ]);
    else void run(async () => {});
  };
  return <View style={{ padding: 16, gap: 4, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
    <Text style={{ ...typeScale.subhead, color: colors.text, fontWeight: '700' }}>{conflict || deletion ? t.mealSync.conflictTitle : t.mealSync.localTitle}</Text>
    <Text style={{ ...typeScale.footnote, color: colors.muted }}>{error ? t.mealSync.failed : conflict || deletion ? t.mealSync.conflictHint : t.mealSync.pending}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={resolve} style={{ minHeight: 44, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
      <Text style={{ ...typeScale.subhead, color: colors.text, fontWeight: '700' }}>{busy ? t.mealSync.working : conflict || deletion ? t.mealSync.choose : t.mealSync.retry}</Text>
    </Pressable>
  </View>;
}
