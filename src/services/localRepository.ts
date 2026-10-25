import { normalizePersonalGoal } from '@/services/personalGoal';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PendingAnalysis } from '@/services/contracts';
import { DEFAULT_PROFILE, isBiologicalSex } from '@/services/personalization';
import { Meal, MealItem, MealSync, UserProfile, WeightEntry } from '@/types/nutrition';
import type { FavoriteMeal } from '@/services/repeatMeals';
import { localDateKey } from '@/utils/date';
import { defaultUnitSystem, isUnitSystem } from '@/utils/units';
import { isAnalysisRequestId, newAnalysisRequestId } from '@/utils/requestId';

const MEALS_KEY = '@kandro/meals:v1';
const QUEUE_KEY = '@kandro/analysis-queue:v1';
const PROFILE_KEY = '@kandro/profile:v1';
const WEIGHTS_KEY = '@kandro/weight-entries:v1';
const LIFETIME_SCANS_KEY = '@kandro/lifetime-scans:v1';
const COUNTED_SCAN_IDS_KEY = '@kandro/counted-analysis-ids:v1';
const DELETED_MEALS_KEY = '@kandro/deleted-meals:v1';
const ACCOUNT_SWITCH_PENDING_KEY = '@kandro/account-switch-pending:v1';
const FAVORITES_KEY = '@kandro/favorite-meals:v1';
// "Mein Produkt" foods (nutrition-label scans and own products), per account.
const CUSTOM_FOODS_KEY = '@kandro/custom-foods:v1';
let scanCountMutation: Promise<number> = Promise.resolve(0);
let localGeneration = 0;
export const getLocalDataGeneration = () => localGeneration;
const privateInvalidators = new Set<() => Promise<unknown>>();
export function subscribePrivateDataInvalidation(callback: () => Promise<unknown>) {
  privateInvalidators.add(callback); return () => { privateInvalidators.delete(callback); };
}
export async function invalidatePrivateData() { await Promise.all([...privateInvalidators].map(callback => callback())); }

const mealListeners = new Set<() => void>();
export function subscribeLocalMeals(listener: () => void) { mealListeners.add(listener); return () => { mealListeners.delete(listener); }; }
function notifyMeals() { mealListeners.forEach((listener) => listener()); }

/** Origins that count as "the user ate this". 'seed' is demo filler and never persists. */
const LOGGED_ORIGINS = new Set(['scan', 'plan']);

function isLogged(meal: Meal) {
  return LOGGED_ORIGINS.has(meal.origin ?? '');
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  // A failed read or damaged record is not evidence of an empty account.
  // Callers surface a recovery error and leave the original bytes untouched.
  const stored = await AsyncStorage.getItem(key);
  return stored === null ? fallback : JSON.parse(stored) as T;
}

let auxiliaryMutation: Promise<unknown> = Promise.resolve();
function mutateAuxiliary<T>(operation: () => Promise<T>): Promise<T> {
  const generation = localGeneration;
  const run = () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    return operation();
  };
  const result = auxiliaryMutation.then(run, run);
  auxiliaryMutation = result.catch(() => undefined);
  return result;
}

export async function loadMeals(): Promise<Meal[]> {
  const date = localDateKey();
  return loadStoredScans(date);
}

export async function loadStoredScans(date = localDateKey()): Promise<Meal[]> {
  const stored = await readVisibleMeals();
  return stored.filter((meal) => isLogged(meal) && meal.date === date);
}

export async function loadAllStoredScans(): Promise<Meal[]> {
  const stored = await readVisibleMeals();
  return stored
    .filter(isLogged)
    .sort((a, b) => (a.savedAt ?? '').localeCompare(b.savedAt ?? ''));
}

// The durable deletion marker is authoritative even if the following diary
// write was interrupted. Never resurrect that meal during local-only hydration.
async function readVisibleMeals(): Promise<Meal[]> {
  const [meals, deleted] = await Promise.all([readMealsForMutation(), readDeleted()]);
  const ids = new Set(deleted.map((entry) => entry.id));
  return meals.filter((meal) => !ids.has(meal.id));
}

// Serialize read/modify/write operations so two quick saves cannot erase one
// another. A failed read must never be treated as an empty diary for a write.
let mealMutation: Promise<unknown> = Promise.resolve();
function mutateMeals<T>(operation: () => Promise<T>): Promise<T> {
  const result = mealMutation.then(operation, operation);
  mealMutation = result.catch(() => undefined);
  void result.then(notifyMeals, () => undefined);
  return result;
}
async function readMealsForMutation(): Promise<Meal[]> {
  const raw = await AsyncStorage.getItem(MEALS_KEY);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((meal) => !meal || typeof meal.id !== 'string')) {
    throw new Error('invalid_local_meals');
  }
  return parsed as Meal[];
}

/** Ignore transport metadata and display-only timestamps when comparing a save. */
export function mealContent(meal: Meal, includeReferences = true) {
  return JSON.stringify({
    id: meal.id, title: meal.title, type: meal.type, date: meal.date, origin: meal.origin,
    calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, fiber: meal.fiber ?? 0,
    confidence: meal.confidence,
    items: meal.items.map((i) => ({
      id: i.id, name: i.name, amountG: i.amountG, baseAmountG: i.baseAmountG, portionFactor: i.portionFactor,
      calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat, fiber: i.fiber ?? 0,
      confidence: i.confidence, included: i.included, optional: Boolean(i.optional),
      source: { provider: i.source.provider, referenceId: i.source.referenceId, label: i.source.label,
        ...(includeReferences ? { estimatedReference: Boolean(i.source.estimatedReference) } : {}) },
      ...(includeReferences ? { nutritionPer100g: i.nutritionPer100g, portions: i.portions } : {}),
    })),
  });
}

/** Old cloud rows rounded factors to three decimals and had no item order.
 * Compare only those transport differences tolerantly; actual food, amounts,
 * nutrition and inclusion flags still have to match exactly. Normal saves and
 * pending edits keep their strict comparison and revision checks.
 */
function legacyMealMatches(local: Meal, cloud: Meal, includeReferences = true) {
  const byId = (a: MealItem, b: MealItem) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const localItems = [...local.items].sort(byId);
  const cloudItems = [...cloud.items].sort(byId);
  if (localItems.length !== cloudItems.length) return false;
  const comparableItems = cloudItems.map((item, index) => {
    const previous = localItems[index];
    const roundedOnly = previous.id === item.id
      && Number.isFinite(previous.portionFactor) && Number.isFinite(item.portionFactor)
      && Math.abs(previous.portionFactor - item.portionFactor) <= 0.0005 + Number.EPSILON * 20;
    return roundedOnly ? { ...item, portionFactor: previous.portionFactor } : item;
  });
  return mealContent({ ...local, items: localItems }, includeReferences)
    === mealContent({ ...cloud, items: comparableItems }, includeReferences);
}

export function saveMealWithOutcome(meal: Meal, ownerId?: string) {
  const generation = localGeneration;
  return mutateMeals(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readMealsForMutation();
    const previous = current.find((entry) => entry.id === meal.id);
    const base = previous?.sync ?? (meal.sync?.mealId === meal.id ? meal.sync : undefined);
    if (base?.ownerId && ownerId && base.ownerId !== ownerId) throw new Error('cloud_identity_changed');
    const outcome = !previous ? 'created' as const
      : mealContent(previous) === mealContent(meal) ? 'unchanged' as const : 'updated' as const;
    const storedMeal: Meal = outcome === 'unchanged' ? previous! : { ...meal, savedAt: meal.savedAt ?? previous?.savedAt ?? new Date().toISOString(), sync: {
      mealId: meal.id, ownerId: ownerId ?? base?.ownerId, revision: base?.revision ?? 0,
      mutationId: newAnalysisRequestId(),
      ancestors: [...(base?.ancestors ?? []), ...(base?.status !== 'synced' && base?.mutationId ? [base.mutationId] : [])].slice(-64),
      status: base?.status === 'conflict' ? 'conflict' : 'pending',
    } };
    const next = outcome === 'unchanged' ? current
      : [...current.filter((entry) => isLogged(entry) && entry.id !== meal.id), storedMeal];
    if (outcome !== 'unchanged') await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(next));
    return { meals: next.filter((entry) => isLogged(entry) && entry.date === localDateKey()), storedMeal, outcome };
  });
}

export async function saveMeal(meal: Meal): Promise<Meal[]> {
  return (await saveMealWithOutcome(meal)).meals;
}

export type DeletedMeal = { id: string; sync: MealSync };
let deletionMutation: Promise<unknown> = Promise.resolve();
function mutateDeleted<T>(operation: () => Promise<T>) {
  const result = deletionMutation.then(operation, operation);
  deletionMutation = result.catch(() => undefined);
  return result;
}
async function readDeleted(): Promise<DeletedMeal[]> {
  const raw = await AsyncStorage.getItem(DELETED_MEALS_KEY);
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('invalid_local_deletions');
  return parsed.map((entry): DeletedMeal => {
    if (typeof entry === 'string') return { id: entry, sync: { mealId: entry, revision: 0, status: 'pending', mutationId: newAnalysisRequestId() } };
    if (!entry || typeof entry.id !== 'string' || !entry.sync) throw new Error('invalid_local_deletions');
    return entry;
  });
}
export async function loadDeletedMeals() {
  return mutateDeleted(async () => {
    const entries = await readDeleted();
    // Persist legacy string tombstones as stable, retryable mutation IDs once.
    await AsyncStorage.setItem(DELETED_MEALS_KEY, JSON.stringify(entries));
    return entries;
  });
}
export async function loadDeletedMealIds(): Promise<string[]> { return (await loadDeletedMeals()).map((entry) => entry.id); }
export async function rememberDeletedMeal(id: string, base?: MealSync, ownerId?: string) {
  return mutateDeleted(async () => {
    const current = await readDeleted();
    if (current.some((entry) => entry.id === id)) return;
    const sync: MealSync = { mealId: id, ownerId: ownerId ?? base?.ownerId, revision: base?.revision ?? 0,
      mutationId: newAnalysisRequestId(), status: 'pending',
      ancestors: [...(base?.ancestors ?? []), ...(base?.mutationId && base.status !== 'synced' ? [base.mutationId] : [])].slice(-64) };
    await AsyncStorage.setItem(DELETED_MEALS_KEY, JSON.stringify([...current, { id, sync }]));
  });
}
export async function markDeletedMealConflict(id: string, ownerId: string) {
  return mutateDeleted(async () => {
    const current = await readDeleted();
    await AsyncStorage.setItem(DELETED_MEALS_KEY, JSON.stringify(current.map((entry) => entry.id === id && (!entry.sync.ownerId || entry.sync.ownerId === ownerId)
      ? { ...entry, sync: { ...entry.sync, ownerId, status: 'conflict' } } : entry)));
    notifyMeals();
  });
}
export async function rebaseDeletedMeal(id: string, ownerId: string, revision: number, generation: number) {
  return mutateDeleted(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readDeleted();
    const entry = current.find((m) => m.id === id);
    if (!entry || entry.sync.ownerId !== ownerId || entry.sync.status !== 'conflict') throw new Error('meal_conflict_changed');
    await AsyncStorage.setItem(DELETED_MEALS_KEY, JSON.stringify(current.map((m) => m.id === id
      ? { ...m, sync: { ...m.sync, revision, mutationId: newAnalysisRequestId(), ancestors: [], status: 'pending' } } : m)));
    notifyMeals();
  });
}
export async function forgetDeletedMeal(id: string, mutationId?: string, ownerId?: string) {
  return mutateDeleted(async () => {
    const current = await readDeleted();
    await AsyncStorage.setItem(DELETED_MEALS_KEY, JSON.stringify(current.filter((entry) =>
      entry.id !== id || (mutationId && entry.sync.mutationId !== mutationId) || (ownerId && entry.sync.ownerId && entry.sync.ownerId !== ownerId))));
    notifyMeals();
  });
}
export async function deleteMeal(id: string, ownerId?: string): Promise<Meal[]> {
  const generation = localGeneration;
  return mutateMeals(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readMealsForMutation();
    const original = current.find((meal) => meal.id === id);
    if (original?.sync?.ownerId && ownerId && original.sync.ownerId !== ownerId) throw new Error('cloud_identity_changed');
    await rememberDeletedMeal(id, original?.sync, ownerId);
    const next = current.filter((meal) => meal.id !== id);
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(next));
    return next.filter((meal) => isLogged(meal) && meal.date === localDateKey());
  });
}

/** Metadata-only acknowledgement; a newer local edit keeps its own content. */
export async function acknowledgeMealSync(id: string, mutationId: string, revision: number, ownerId: string) {
  const generation = localGeneration;
  return mutateMeals(async () => {
    if (generation !== localGeneration) return;
    const current = await readMealsForMutation();
    const next = current.map((meal) => {
      const sync = meal.sync;
      if (meal.id !== id || !sync || sync.ownerId !== ownerId) return meal;
      if (sync.mutationId === mutationId) return { ...meal, sync: { ...sync, revision, ancestors: [], status: 'synced' as const } };
      const position = sync.ancestors?.indexOf(mutationId) ?? -1;
      return position < 0 ? meal : { ...meal, sync: { ...sync, revision: Math.max(sync.revision, revision), ancestors: sync.ancestors!.slice(position + 1) } };
    });
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(next));
  });
}
export async function markMealConflict(id: string, ownerId: string) {
  return mutateMeals(async () => {
    const current = await readMealsForMutation();
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(current.map((meal) => meal.id === id && meal.sync?.ownerId === ownerId
      ? { ...meal, sync: { ...meal.sync, status: 'conflict' } } : meal)));
  });
}
export async function pendingMealForSync(id: string, ownerId: string, generation = localGeneration): Promise<Meal | null> {
  return mutateMeals(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readMealsForMutation();
    if ((await loadDeletedMealIds()).includes(id)) return null;
    const meal = current.find((entry) => entry.id === id);
    if (!meal || meal.sync?.status === 'synced') return null;
    if (meal.sync?.status === 'conflict') throw new Error('meal_revision_conflict');
    if (meal.sync?.ownerId && meal.sync.ownerId !== ownerId) throw new Error('cloud_identity_changed');
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const bound: Meal = { ...meal, savedAt: meal.savedAt ?? new Date().toISOString(), sync: { mealId: id, revision: 0, mutationId: newAnalysisRequestId(), status: 'pending', ...meal.sync, ownerId } };
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(current.map((entry) => entry.id === id ? bound : entry)));
    return bound;
  });
}

/** Remote snapshots never replace a pending edit; older restored local copies never overwrite the server. */
export async function mergeCloudMealSnapshot(remote: Meal[], deletedIds: string[], ownerId: string, generation: number) {
  return mutateMeals(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readMealsForMutation();
    const deleted = new Set(deletedIds);
    const localDeleted = new Set(await loadDeletedMealIds());
    const merged = new Map(remote.filter((m) => !localDeleted.has(m.id)).map((m) => [m.id, m]));
    for (const meal of current) {
      if (!isLogged(meal) || localDeleted.has(meal.id)) continue;
      if (meal.sync?.ownerId && meal.sync.ownerId !== ownerId) throw new Error('cloud_identity_changed');
      const cloud = merged.get(meal.id);
      if (deleted.has(meal.id)) {
        if (meal.sync?.status === 'pending' || meal.sync?.status === 'conflict') {
          merged.set(meal.id, { ...meal, sync: { ...meal.sync, ownerId, status: 'conflict' } });
        }
        continue;
      }
      // Build 19 may already have flagged an untouched legacy copy. Such a
      // conflict has no local mutation ID; a real pending edit always has one.
      const legacy = !meal.sync || (meal.sync.status === 'conflict' && !meal.sync.mutationId);
      if (!legacy && (meal.sync?.status === 'pending' || meal.sync?.status === 'conflict')) { merged.set(meal.id, meal); continue; }
      if (cloud && legacy && !legacyMealMatches(meal, cloud, false)) {
        merged.set(meal.id, { ...meal, sync: { mealId: meal.id, ownerId, revision: cloud.sync?.revision ?? 0, status: 'conflict' } });
      } else if (cloud && legacy && !legacyMealMatches(meal, cloud)) {
        const enriched = { ...cloud, items: cloud.items.map((item) => {
          const local = meal.items.find((candidate) => candidate.id === item.id);
          return { ...item, nutritionPer100g: item.nutritionPer100g ?? local?.nutritionPer100g,
            portions: item.portions ?? local?.portions,
            source: { ...item.source, estimatedReference: item.source.estimatedReference ?? local?.source.estimatedReference } };
        }), sync: { ...cloud.sync!, mutationId: newAnalysisRequestId(), ancestors: [], status: 'pending' as const } };
        merged.set(meal.id, enriched);
      } else if (!cloud) merged.set(meal.id, meal);
    }
    const values = [...merged.values()].sort((a,b) => (a.savedAt ?? '').localeCompare(b.savedAt ?? ''));
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(values));
    return values;
  });
}

/** Explicit conflict choice after showing the user which copy will be used. */
export async function resolveLocalMealConflict(id: string, remote: Meal | null, keepLocal: boolean, ownerId: string, generation: number) {
  return mutateMeals(async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const current = await readMealsForMutation();
    const meal = current.find((m) => m.id === id);
    if (!meal || meal.sync?.ownerId !== ownerId || meal.sync.status !== 'conflict') throw new Error('meal_conflict_changed');
    let replacement: Meal | null = remote;
    if (keepLocal) {
      const targetId = remote ? id : `copy-${newAnalysisRequestId()}`; // A deletion can only be restored as a new entry.
      replacement = { ...meal, id: targetId, sync: { mealId: targetId, ownerId, revision: remote?.sync?.revision ?? 0,
        mutationId: newAnalysisRequestId(), ancestors: [], status: 'pending' } };
    }
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify([...current.filter((m) => m.id !== id), ...(replacement ? [replacement] : [])]));
    return replacement;
  });
}

async function readAnalysisQueue(): Promise<PendingAnalysis[]> {
  const stored = await readJson<PendingAnalysis[]>(QUEUE_KEY, []);
  if (!Array.isArray(stored) || stored.some((job) => !job || typeof job !== 'object')) throw new Error('invalid_local_queue');
  let migrated = false;
  const queue = stored.map((job) => {
    if (isAnalysisRequestId(job.id)) return job;
    migrated = true;
    return { ...job, id: newAnalysisRequestId() };
  }).slice(-3);
  // Builds created before the server ledger used `scan-<timestamp>`. Persist a
  // UUID once so every later retry reaches the same idempotent reservation.
  if (migrated) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queue;
}

export function loadAnalysisQueue(): Promise<PendingAnalysis[]> {
  return mutateAuxiliary(readAnalysisQueue);
}

export async function queueAnalysis(job: PendingAnalysis): Promise<number> {
  return mutateAuxiliary(async () => {
    const current = await readAnalysisQueue();
    const next = [...current.filter((entry) => entry.id !== job.id), job].slice(-3);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    return next.length;
  });
}

export async function removeQueuedAnalysis(id: string): Promise<number> {
  return mutateAuxiliary(async () => {
    const current = await readAnalysisQueue();
    const next = current.filter((entry) => entry.id !== id);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    return next.length;
  });
}

export async function clearAnalysisQueue() {
  await mutateAuxiliary(() => AsyncStorage.removeItem(QUEUE_KEY));
}

/**
 * Monotonic count of successful AI results on this device. Meal history is
 * pruned and a user may abandon Confirm, so the allowance cannot be derived
 * from saved meals alone.
 */
export async function loadLifetimeScanCount(): Promise<number> {
  const [stored, ledger] = await Promise.all([
    readJson<unknown>(LIFETIME_SCANS_KEY, 0),
    readJson<unknown>(COUNTED_SCAN_IDS_KEY, []),
  ]);
  const storedValue = Number(stored);
  const ledgerValue = ledger && typeof ledger === 'object' && !Array.isArray(ledger)
    ? Number((ledger as { count?: unknown }).count)
    : 0;
  return Math.max(
    Number.isFinite(storedValue) && storedValue > 0 ? Math.floor(storedValue) : 0,
    Number.isFinite(ledgerValue) && ledgerValue > 0 ? Math.floor(ledgerValue) : 0,
  );
}

export async function saveLifetimeScanCount(count: number): Promise<number> {
  const next = Math.max(0, Math.floor(count));
  await AsyncStorage.setItem(LIFETIME_SCANS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Spend an analysis credit exactly once for a request id. Count and recent IDs
 * share one AsyncStorage value, so a crash cannot persist one without the
 * other. The legacy count is mirrored for backward compatibility.
 */
export function countLifetimeScanOnce(scanId: string): Promise<number> {
  const generation = localGeneration;
  const mutate = async () => {
    if (generation !== localGeneration) throw new Error('cloud_identity_changed');
    const counted = await readJson<unknown>(COUNTED_SCAN_IDS_KEY, []);
    const rawIds = Array.isArray(counted)
      ? counted
      : counted && typeof counted === 'object' && Array.isArray((counted as { ids?: unknown }).ids)
        ? (counted as { ids: unknown[] }).ids
        : [];
    const ids = rawIds.filter((id): id is string => typeof id === 'string').slice(-199);
    const current = await loadLifetimeScanCount();
    if (ids.includes(scanId)) return current;
    const next = current + 1;
    await AsyncStorage.setItem(COUNTED_SCAN_IDS_KEY, JSON.stringify({
      version: 1,
      count: next,
      ids: [...ids, scanId],
    }));
    await saveLifetimeScanCount(next);
    return next;
  };
  const next = scanCountMutation.then(mutate, mutate);
  scanCountMutation = next.catch(() => loadLifetimeScanCount());
  return next;
}

/** Keeps a stored value only when it is one the app can actually compute with. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberInRange(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

export async function loadProfile(): Promise<UserProfile> {
  const stored = await readJson<Partial<UserProfile> | null>(PROFILE_KEY, null);
  if (!stored) return DEFAULT_PROFILE;
  if (typeof stored !== 'object' || Array.isArray(stored)) throw new Error('invalid_local_profile');
  // A stored value the app no longer knows: from an older build, a corrupted
  // write, or a cloud row written by a newer one: used to reach the target
  // maths unchecked and surface as "NaN kcal left" on the Today screen.
  const profile: UserProfile = {
    ...DEFAULT_PROFILE,
    ...stored,
    goal: oneOf(stored.goal, ['lose', 'maintain', 'gain'], DEFAULT_PROFILE.goal),
    activityLevel: oneOf(stored.activityLevel, ['low', 'light', 'high'], DEFAULT_PROFILE.activityLevel),
    age: numberInRange(stored.age, 14, 100, DEFAULT_PROFILE.age),
    heightCm: positiveNumber(stored.heightCm, DEFAULT_PROFILE.heightCm),
    weightKg: positiveNumber(stored.weightKg, DEFAULT_PROFILE.weightKg),
    // Profiles written before the rate existed must not deserialize as undefined.
    weeklyRateKg: stored.weeklyRateKg === 0.25 ? 0.25 : 0.5,
    // A profile written before units existed follows the device, so an
    // American upgrading the app is not suddenly asked to think in kilograms.
    unitSystem: isUnitSystem(stored.unitSystem) ? stored.unitSystem : defaultUnitSystem(),
    sex: isBiologicalSex(stored.sex) ? stored.sex : 'unspecified',
    preferences: Array.isArray(stored.preferences) ? stored.preferences.filter((item): item is string => typeof item === 'string') : [],
  };
  return { ...profile, ...normalizePersonalGoal(profile) };
}

export function saveProfile(profile: UserProfile) {
  return mutateAuxiliary(() => AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, ...normalizePersonalGoal(profile) })));
}

export async function loadWeightEntries(): Promise<WeightEntry[]> {
  const stored = await readJson<WeightEntry[]>(WEIGHTS_KEY, []);
  if (!Array.isArray(stored) || stored.some((entry) => !entry || typeof entry !== 'object')) throw new Error('invalid_local_weights');
  return stored
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.weightKg) && entry.weightKg >= 35 && entry.weightKg <= 350)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveWeightEntry(entry: WeightEntry): Promise<WeightEntry[]> {
  return mutateAuxiliary(async () => {
    const current = await loadWeightEntries();
    const next = [...current.filter((item) => item.date !== entry.date), entry]
      .sort((a, b) => a.date.localeCompare(b.date));
    await AsyncStorage.setItem(WEIGHTS_KEY, JSON.stringify(next));
    return next;
  });
}

/**
 * Starred meals, on this device (the cloud copy lives in
 * services/favoriteMeals). They are wellness data like the diary, so every
 * reset and account switch below removes them too. At most 100 (MAX_FAVORITES).
 */
export async function loadFavoriteMeals(): Promise<FavoriteMeal[]> {
  const stored = await readJson<unknown>(FAVORITES_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is FavoriteMeal => Boolean(entry)
    && typeof entry.key === 'string' && entry.key.length > 0
    && typeof entry.starredAt === 'string'
    && Boolean(entry.meal) && typeof entry.meal.title === 'string' && Array.isArray(entry.meal.items)
    && [entry.meal.calories, entry.meal.protein, entry.meal.carbs, entry.meal.fat].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0))
    .slice(0, 100);
}

export function saveFavoriteMeals(favorites: FavoriteMeal[]) {
  return mutateAuxiliary(() => AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.slice(0, 100))));
}

/**
 * The user's own products. Account data like the diary: every reset and
 * account switch below removes them; the service validates each record.
 */
export async function loadStoredCustomFoods(): Promise<unknown[]> {
  const stored = await readJson<unknown>(CUSTOM_FOODS_KEY, []);
  return Array.isArray(stored) ? stored.slice(0, 500) : [];
}

export function saveStoredCustomFoods(foods: unknown[]) {
  return mutateAuxiliary(() => AsyncStorage.setItem(CUSTOM_FOODS_KEY, JSON.stringify(foods.slice(0, 500))));
}

export async function clearLocalKandroData() {
  localGeneration += 1;
  await invalidatePrivateData();
  await mealMutation;
  await deletionMutation;
  await auxiliaryMutation;
  await scanCountMutation.catch(() => undefined);
  await AsyncStorage.multiRemove([MEALS_KEY, QUEUE_KEY, PROFILE_KEY, WEIGHTS_KEY, LIFETIME_SCANS_KEY, COUNTED_SCAN_IDS_KEY, DELETED_MEALS_KEY]);
  await AsyncStorage.multiRemove([FAVORITES_KEY, CUSTOM_FOODS_KEY]);
}

export type PendingLocalAccountSwitch = {
  previousUserId: string;
  startedAt: string;
};

export async function beginLocalAccountSwitch(previousUserId: string) {
  if (!previousUserId) throw new Error('missing_previous_account_id');
  localGeneration += 1;
  await invalidatePrivateData();
  // Written before auth changes. If the process dies during sign-in, launch
  // recovery knows never to merge the old local data into the current session.
  await AsyncStorage.setItem(ACCOUNT_SWITCH_PENDING_KEY, JSON.stringify({
    previousUserId,
    startedAt: new Date().toISOString(),
  } satisfies PendingLocalAccountSwitch));
}

export async function loadLocalAccountSwitch(): Promise<PendingLocalAccountSwitch | null> {
  const stored = await readJson<Partial<PendingLocalAccountSwitch> | null>(ACCOUNT_SWITCH_PENDING_KEY, null);
  return stored
    && typeof stored.previousUserId === 'string'
    && stored.previousUserId.length > 0
    && typeof stored.startedAt === 'string'
    ? { previousUserId: stored.previousUserId, startedAt: stored.startedAt }
    : null;
}

export async function completeLocalAccountSwitch() {
  await AsyncStorage.removeItem(ACCOUNT_SWITCH_PENDING_KEY);
}

/**
 * Replaces every account-scoped local value after signing in to a different
 * existing account. It is serialized behind any scan-credit mutation already
 * in progress so a late result from the previous identity cannot overwrite
 * the replacement count.
 */
export function replaceLocalAccountData(
  profile: UserProfile,
  mealHistory: Meal[],
  lifetimeScanCount: number,
): Promise<number> {
  localGeneration += 1;
  const invalidation = invalidatePrivateData();
  const replace = () => mutateMeals(async () => {
    await invalidation;
    await auxiliaryMutation;
    await deletionMutation;
    const cleanMeals = mealHistory
      .filter(isLogged)
      .filter((meal, index, meals) => meals.findIndex((candidate) => candidate.id === meal.id) === index)
      .sort((a, b) => (a.savedAt ?? '').localeCompare(b.savedAt ?? ''));
    const count = Math.max(0, Math.floor(lifetimeScanCount));
    await AsyncStorage.multiSet([
      [MEALS_KEY, JSON.stringify(cleanMeals)],
      [PROFILE_KEY, JSON.stringify({ ...profile, ...normalizePersonalGoal(profile) })],
      [LIFETIME_SCANS_KEY, JSON.stringify(count)],
      [COUNTED_SCAN_IDS_KEY, JSON.stringify({ version: 1, count, ids: [] })],
    ]);
    await AsyncStorage.multiRemove([QUEUE_KEY, WEIGHTS_KEY, DELETED_MEALS_KEY]);
    await AsyncStorage.multiRemove([FAVORITES_KEY, CUSTOM_FOODS_KEY]);
    return count;
  });

  const next = scanCountMutation.then(replace, replace);
  scanCountMutation = next.catch(() => loadLifetimeScanCount());
  return next;
}
