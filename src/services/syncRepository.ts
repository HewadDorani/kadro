import { markMealCaptured } from '@/services/usageSignals';
import { authorizeMealCreate } from '@/services/appAccess';
import { markHardWallUsed } from '@/services/hardWall';
import { captureOperationalError, MealSaveSource, trackEvent } from '@/services/telemetry';
import { assertCloudOwner, deleteCloudMeal, loadCloudDeletedMealIds, loadCloudMealById, hasCloudAnalyzedMeal, initializeCloudProfile, loadCloudMealHistory, saveCloudMeal, saveCloudProfile } from '@/services/cloudRepository';
import {
  deleteMeal as deleteLocalMeal,
  forgetDeletedMeal, rebaseDeletedMeal,
  getLocalDataGeneration,
  mergeCloudMealSnapshot,
  resolveLocalMealConflict,
  loadLocalAccountSwitch,
  loadAllStoredScans,
  loadDeletedMealIds,
  loadProfile,
  saveMealWithOutcome,
} from '@/services/localRepository';
import { DEFAULT_TARGETS } from '@/services/mockNutrition';
import { calculateDailyTargets, DEFAULT_PROFILE } from '@/services/personalization';
import { DailyTargets, Meal, UserProfile } from '@/types/nutrition';
import { localDateKey } from '@/utils/date';
import { getCurrentSessionUserId } from '@/services/supabaseClient';

type SavedMealEvent = { id: string; source: MealSaveSource; generation: number };
const saveListeners = new Set<(event: SavedMealEvent) => void>();
export function subscribeSuccessfulMealCreates(listener: (event: SavedMealEvent) => void) {
  saveListeners.add(listener); return () => { saveListeners.delete(listener); };
}

export type SyncMode = 'local' | 'syncing' | 'cloud' | 'error';

export type HydratedCloudState = {
  meals: Meal[];
  mealHistory: Meal[];
  hasEverLoggedScan: boolean;
  targets: DailyTargets;
  profile: UserProfile;
  hasPendingChanges?: boolean;
};

export function hasAnalyzedMeal(meals: Meal[]) {
  return meals.some((meal) => meal.origin === 'scan');
}

export function shouldPromoteLocalProfile(
  localCompletedAt: string | null,
  cloudCompletedAt: string | null,
  cloudAgeDeclared: boolean,
) {
  return Boolean(
    localCompletedAt
    && cloudAgeDeclared
    && (!cloudCompletedAt || new Date(localCompletedAt) > new Date(cloudCompletedAt)),
  );
}

export async function hydrateCloudState(): Promise<HydratedCloudState | null> {
  const generation = getLocalDataGeneration();
  if (await loadLocalAccountSwitch()) throw new Error('cloud_identity_changed');
  const expectedUserId = await getCurrentSessionUserId();
  const localProfile = await loadProfile();
  const initialTargets = localProfile.completedAt ? calculateDailyTargets(localProfile) : DEFAULT_TARGETS;
  let cloud = await initializeCloudProfile(localProfile, initialTargets, false, { userId: expectedUserId, generation });
  if (!cloud) return null;

  const localIsNewer = shouldPromoteLocalProfile(
    localProfile.completedAt ? localProfile.editedAt ?? localProfile.completedAt : null,
    cloud.profile.completedAt,
    cloud.ageDeclared,
  );
  // A missing cloud age is authoritative. In particular, the release migration
  // deliberately clears ambiguous age=18 rows that may really have been 16/17
  // before an older schema rewrite. Never "heal" that safety marker from a
  // completed local copy. By contrast, age present + missing height/weight is
  // a normal interrupted onboarding and the completed local profile may repair
  // it without making the user answer everything twice.
  if (localIsNewer) {
    await saveCloudProfile(localProfile, initialTargets);
    cloud = { ...cloud, profile: localProfile, targets: initialTargets };
  }

  await assertCloudOwner(cloud.userId, generation);
  const localScans = await loadAllStoredScans();
  const [remote, deletedIds] = await Promise.all([
    loadCloudMealHistory(), loadCloudDeletedMealIds(localScans.map((meal) => meal.id), cloud.userId),
  ]);
  await assertCloudOwner(cloud.userId, generation);
  const before = await mergeCloudMealSnapshot(remote, deletedIds, cloud.userId, generation);
  let failed = false;
  for (const id of await loadDeletedMealIds()) {
    await assertCloudOwner(cloud.userId, generation);
    try { await deleteCloudMeal(id); } catch { failed = true; }
  }
  for (const meal of before.filter((m) => !m.sync || m.sync.status === 'pending')) {
    await assertCloudOwner(cloud.userId, generation);
    try { await syncCloudMeal(meal); } catch { failed = true; }
  }
  const [cloudMeals, cloudHasAnalyzedMeal] = await Promise.all([loadCloudMealHistory(), hasCloudAnalyzedMeal()]);
  await assertCloudOwner(cloud.userId, generation);
  const merged = await mergeCloudMealSnapshot(cloudMeals, deletedIds, cloud.userId, generation);
  const today = localDateKey();

  return {
    meals: merged.filter((meal) => meal.date === today),
    mealHistory: merged,
    hasEverLoggedScan: cloudHasAnalyzedMeal || hasAnalyzedMeal(localScans),
    targets: cloud.targets,
    profile: cloud.profile,
    hasPendingChanges: failed || merged.some((m) => m.sync?.status !== 'synced'),
  };
}

/**
 * Loads an account that already existed before this device signed in.
 *
 * This path is deliberately cloud-authoritative. The regular hydration path
 * uploads local meals and may promote a newer local profile, which is correct
 * for one account recovering from offline use but would disclose one person's
 * wellness data to another account after a credential sign-in.
 */
export async function hydrateExistingCloudAccount(): Promise<HydratedCloudState | null> {
  const generation = getLocalDataGeneration();
  const cloud = await initializeCloudProfile(DEFAULT_PROFILE, DEFAULT_TARGETS, true);
  if (!cloud) return null;

  const [cloudMeals, cloudHasAnalyzedMeal] = await Promise.all([
    loadCloudMealHistory(),
    hasCloudAnalyzedMeal(),
  ]);
  await assertCloudOwner(cloud.userId, generation);
  const mealHistory = cloudMeals
    .filter((meal, index, meals) => meals.findIndex((candidate) => candidate.id === meal.id) === index)
    .sort((a, b) => (a.savedAt ?? '').localeCompare(b.savedAt ?? ''));
  const today = localDateKey();

  return {
    meals: mealHistory.filter((meal) => meal.date === today),
    mealHistory,
    hasEverLoggedScan: cloudHasAnalyzedMeal,
    targets: cloud.targets,
    profile: cloud.profile,
  };
}

export async function syncUserSetup(profile: UserProfile, targets: DailyTargets) {
  return saveCloudProfile(profile, targets);
}

export async function deleteSyncedMeal(id: string): Promise<Meal[]> {
  const generation = getLocalDataGeneration();
  if (await loadLocalAccountSwitch()) throw new Error('cloud_identity_changed');
  const ownerId = await getCurrentSessionUserId();
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  const localMeals = await deleteLocalMeal(id, ownerId ?? undefined);
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  void deleteCloudMeal(id)
    .then((removed) => {
      trackEvent('cloud sync completed', { operation: 'delete', outcome: removed ? 'synced' : 'local_only' });
      return removed;
    })
    .catch(() => {
      trackEvent('cloud sync failed', { operation: 'delete' });
      // Retried on the next hydration; the tombstone keeps it off screen meanwhile.
    });
  trackEvent('meal deleted', {});
  return localMeals;
}

export async function saveSyncedMeal(meal: Meal, source: MealSaveSource = 'edit'): Promise<Meal[]> {
  const generation = getLocalDataGeneration();
  if (await loadLocalAccountSwitch()) throw new Error('cloud_identity_changed');
  const ownerId = await getCurrentSessionUserId();
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  if (!(await loadAllStoredScans()).some(existing => existing.id === meal.id)) await authorizeMealCreate(meal.id);
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  trackEvent('meal save attempted', { source });
  let result: Awaited<ReturnType<typeof saveMealWithOutcome>>;
  try {
    result = await saveMealWithOutcome(meal, ownerId ?? undefined);
  } catch (error) {
    trackEvent('meal save failed', { source, failure_reason: 'local_storage' });
    captureOperationalError(error, { area: 'storage', operation: 'save_meal', code: 'local_storage' });
    throw error;
  }
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  trackEvent('meal save completed', { source, outcome: result.outcome });
  if (result.outcome === 'created') {
    trackEvent('meal saved', { source });
    markMealCaptured(source);
    // A hard-wall install's one free meal is now used (sticky, before sync).
    await markHardWallUsed();
    for (const listener of saveListeners) { try { listener({ id: meal.id, source, generation }); } catch { /* Optional local companions never fail a completed save. */ } }
  }
  if (result.outcome === 'updated') trackEvent('meal updated', { source });
  // An unchanged save may still retry an earlier failed cloud upload.
  void syncCloudMeal(result.storedMeal).catch(() => undefined);
  return result.meals;
}

async function syncCloudMeal(meal: Meal) {
  try {
    const synced = await saveCloudMeal(meal);
    trackEvent('cloud sync completed', { operation: 'save', outcome: synced ? 'synced' : 'local_only' });
    return synced;
  } catch (error) {
    trackEvent('cloud sync failed', { operation: 'save' });
    captureOperationalError(error, { area: 'cloud_sync', operation: 'save_meal', code: 'cloud_write' });
    throw error;
  }
}

export async function resolveMealSyncConflict(id: string, keepLocal: boolean) {
  const generation = getLocalDataGeneration();
  const ownerId = await getCurrentSessionUserId();
  if (!ownerId || await loadLocalAccountSwitch()) throw new Error('cloud_identity_changed');
  const remote = await loadCloudMealById(id, ownerId);
  await assertCloudOwner(ownerId, generation);
  const replacement = await resolveLocalMealConflict(id, remote, keepLocal, ownerId, generation);
  if (replacement?.sync?.status === 'pending') await syncCloudMeal(replacement);
}

export async function resolveMealDeletionConflict(id: string, keepDeletion: boolean) {
  const generation = getLocalDataGeneration();
  const ownerId = await getCurrentSessionUserId();
  if (!ownerId || await loadLocalAccountSwitch()) throw new Error('cloud_identity_changed');
  const remote = await loadCloudMealById(id, ownerId);
  await assertCloudOwner(ownerId, generation);
  if (!keepDeletion || !remote) { await forgetDeletedMeal(id, undefined, ownerId); return; }
  await rebaseDeletedMeal(id, ownerId, remote.sync!.revision, generation);
  await deleteCloudMeal(id);
}
