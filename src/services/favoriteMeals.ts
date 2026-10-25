import { getLocalDataGeneration, loadFavoriteMeals, saveFavoriteMeals, subscribePrivateDataInvalidation } from '@/services/localRepository';
import { favoriteKey, FavoriteMeal, favoriteSnapshot, MAX_FAVORITE_TITLE, MAX_FAVORITES, visibleFavorites } from '@/services/repeatMeals';
import { ensureSupabaseUser, isSupabaseConfigured, supabase } from '@/services/supabaseClient';
import type { Meal, MealItem } from '@/types/nutrition';
import { newAnalysisRequestId } from '@/utils/requestId';

/**
 * Favourite meals ("Zu Favoriten hinzufügen"), offline first.
 *
 * The device copy is the source of truth for the screen. With wellness
 * consent and a configured cloud, every change is written through to
 * public.meal_favorites (owner-only RLS, max 100, deleted with the account);
 * a failed write stays local and is retried by the next sync. Newest change
 * wins per favourite; a favourite deleted on another device disappears here.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEAL_TYPES: Meal['type'][] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const bounded = (value: unknown, max: number, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** The same limits the cloud trigger enforces; damaged records are dropped, never repaired. */
export function isValidFavoriteItem(item: unknown): item is MealItem {
  const value = item as MealItem | null;
  return Boolean(value) && typeof value === 'object'
    && typeof value!.id === 'string' && value!.id.length > 0 && value!.id.length <= 200
    && typeof value!.name === 'string' && value!.name.trim().length > 0 && value!.name.length <= 160
    && bounded(value!.amountG, 5000, 0.1)
    && bounded(value!.calories, 10000) && bounded(value!.protein, 1000) && bounded(value!.carbs, 1000) && bounded(value!.fat, 1000)
    && (value!.fiber === undefined || bounded(value!.fiber, 1000))
    && Boolean(value!.source) && typeof value!.source === 'object' && typeof value!.source.provider === 'string'
    && value!.source.code !== 'unmatched';
}

export function isValidFavorite(entry: unknown): entry is FavoriteMeal {
  const value = entry as FavoriteMeal | null;
  if (!value || typeof value !== 'object' || typeof value.key !== 'string' || !value.key) return false;
  if (value.id !== undefined && (typeof value.id !== 'string' || !UUID.test(value.id))) return false;
  const meal = value.meal;
  if (!meal || typeof meal.title !== 'string' || !meal.title.trim() || meal.title.length > MAX_FAVORITE_TITLE) return false;
  if (!Array.isArray(meal.items) || meal.items.length < 1 || meal.items.length > 40 || !meal.items.every(isValidFavoriteItem)) return false;
  return [meal.calories, meal.protein, meal.carbs, meal.fat].every((number) => bounded(number, 20000));
}

let favorites: FavoriteMeal[] | null = null;
let loading: Promise<FavoriteMeal[]> | null = null;
let snapshot: FavoriteMeal[] = [];
let cloudEnabled = false;
const listeners = new Set<() => void>();
const notify = () => {
  snapshot = visibleFavorites(favorites ?? []);
  listeners.forEach((listener) => listener());
};

subscribePrivateDataInvalidation(async () => {
  // Account switch, reset or deletion: never show the previous account's favourites.
  favorites = null;
  loading = null;
  notify();
});

export function subscribeFavoriteMeals(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Synchronous snapshot for render; empty until the first load finished. */
export function getFavoriteMealsSnapshot(): FavoriteMeal[] {
  return snapshot;
}

/**
 * Favourites are wellness data: they reach the cloud only with consent, like
 * the diary. The app context switches this with the consent state.
 */
export function setFavoriteCloudEnabled(enabled: boolean) {
  cloudEnabled = enabled;
}

/** Older device-only entries (before ids) get a stable id once. */
function migrate(entry: FavoriteMeal): FavoriteMeal {
  return entry.id ? entry : { ...entry, id: newAnalysisRequestId(), updatedAt: entry.updatedAt ?? entry.starredAt };
}

export async function loadFavorites(): Promise<FavoriteMeal[]> {
  if (favorites) return visibleFavorites(favorites);
  const generation = getLocalDataGeneration();
  loading ??= loadFavoriteMeals()
    .then((stored) => stored.filter(isValidFavorite))
    .catch(() => [] as FavoriteMeal[]);
  const loaded = await loading;
  if (generation === getLocalDataGeneration() && !favorites) {
    const migrated = loaded.map(migrate);
    favorites = migrated;
    notify();
    if (migrated.some((entry, index) => entry !== loaded[index])) await saveFavoriteMeals(migrated).catch(() => undefined);
  }
  return visibleFavorites(favorites ?? loaded);
}

async function persist(next: FavoriteMeal[], generation: number) {
  if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
  favorites = next;
  notify();
  await saveFavoriteMeals(next);
}

type CloudRow = {
  id: string; title: string; meal_type: Meal['type']; confidence: Meal['confidence']; items: unknown;
  calories: number | string; protein: number | string; carbs: number | string; fat: number | string; fiber: number | string | null;
  starred_at: string; updated_at: string;
};

/** Only what re-logging needs; never a photo, a day or a sync identity. */
function cloudItem(item: MealItem) {
  return {
    id: item.id, name: item.name, amountG: item.amountG, baseAmountG: item.baseAmountG, portionFactor: item.portionFactor,
    calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat, fiber: item.fiber ?? 0,
    ...(item.nutritionPer100g ? { nutritionPer100g: item.nutritionPer100g } : {}),
    confidence: item.confidence, included: true,
    ...(item.portions?.length ? { portions: item.portions.slice(0, 12) } : {}),
    source: item.source,
  };
}

function toRow(entry: FavoriteMeal, userId: string) {
  const meal = entry.meal;
  return {
    user_id: userId, id: entry.id, title: meal.title.trim(), meal_type: meal.type, confidence: meal.confidence,
    items: meal.items.filter((item) => item.included).map(cloudItem),
    calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, fiber: meal.fiber ?? 0,
    starred_at: entry.starredAt, updated_at: entry.updatedAt ?? entry.starredAt,
  };
}

function fromRow(row: CloudRow, syncedAt: string): FavoriteMeal | null {
  const items = Array.isArray(row.items) ? row.items as MealItem[] : [];
  const meal: Meal = {
    id: `favorite-${row.id}`,
    title: row.title,
    type: MEAL_TYPES.includes(row.meal_type) ? row.meal_type : 'Snack',
    time: '',
    confidence: row.confidence === 'high' ? 'high' : 'medium',
    items: items.map((item) => ({ ...item, included: true, baseAmountG: item.baseAmountG > 0 ? item.baseAmountG : item.amountG, portionFactor: item.portionFactor > 0 ? item.portionFactor : 1, confidence: item.confidence === 'high' ? 'high' : 'medium' })),
    origin: 'plan',
    calories: Number(row.calories), protein: Number(row.protein), carbs: Number(row.carbs), fat: Number(row.fat), fiber: Number(row.fiber ?? 0),
  };
  const entry: FavoriteMeal = { id: row.id, key: favoriteKey(meal), meal, starredAt: row.starred_at, updatedAt: row.updated_at, syncedAt };
  return isValidFavorite(entry) ? entry : null;
}

async function cloudUser(generation: number) {
  if (!cloudEnabled || !supabase || !isSupabaseConfigured) return null;
  const user = await ensureSupabaseUser().catch(() => null);
  if (!user || generation !== getLocalDataGeneration()) return null;
  return user;
}

async function push(entry: FavoriteMeal, generation: number): Promise<boolean> {
  const user = await cloudUser(generation);
  if (!user || !supabase || !entry.id) return false;
  const { error } = entry.pendingDelete
    ? await supabase.from('meal_favorites').delete().eq('user_id', user.id).eq('id', entry.id)
    : await supabase.from('meal_favorites').upsert(toRow(entry, user.id), { onConflict: 'user_id,id' });
  return !error && generation === getLocalDataGeneration();
}

async function markSynced(id: string, updatedAt: string | undefined, generation: number) {
  if (!favorites || generation !== getLocalDataGeneration()) return;
  await persist(favorites.map((entry) => (entry.id === id && entry.updatedAt === updatedAt ? { ...entry, syncedAt: new Date().toISOString() } : entry)), generation);
}

async function writeThrough(entry: FavoriteMeal, generation: number) {
  const cloud = await push(entry, generation).catch(() => false);
  if (!cloud || !favorites || generation !== getLocalDataGeneration()) return;
  if (entry.pendingDelete) await persist(favorites.filter((item) => item.id !== entry.id), generation);
  else await markSynced(entry.id!, entry.updatedAt, generation);
}

/**
 * Stars a meal exactly as logged. Starring a name that is already a favourite
 * replaces its stored portion with this one (same id), so the newest explicit
 * "Zu Favoriten hinzufügen" is what repeats.
 */
export async function addFavorite(meal: Meal): Promise<FavoriteMeal> {
  const generation = getLocalDataGeneration();
  await loadFavorites();
  const all = favorites ?? [];
  const key = favoriteKey(meal);
  if (!key) throw new Error('favorite_without_title');
  const visible = visibleFavorites(all);
  const existing = visible.find((entry) => entry.key === key);
  if (!existing && visible.length >= MAX_FAVORITES) throw new Error('favorite_limit_reached');
  const now = new Date().toISOString();
  const entry: FavoriteMeal = {
    id: existing?.id ?? newAnalysisRequestId(),
    key,
    meal: favoriteSnapshot(meal),
    starredAt: existing?.starredAt ?? now,
    updatedAt: now,
    ...(existing?.syncedAt ? { syncedAt: existing.syncedAt } : {}),
  };
  if (!isValidFavorite(entry)) throw new Error('invalid_favorite');
  await persist([entry, ...all.filter((item) => item.id !== entry.id && !(item.key === key && !item.pendingDelete))], generation);
  void writeThrough(entry, generation);
  return entry;
}

export async function removeFavorite(id: string) {
  const generation = getLocalDataGeneration();
  await loadFavorites();
  const target = favorites?.find((entry) => entry.id === id);
  if (!target || !favorites) return;
  if (!target.syncedAt) {
    // Never uploaded: nothing to delete in the cloud.
    await persist(favorites.filter((entry) => entry.id !== id), generation);
    return;
  }
  const tombstone: FavoriteMeal = { ...target, pendingDelete: true, updatedAt: new Date().toISOString() };
  await persist(favorites.map((entry) => (entry.id === id ? tombstone : entry)), generation);
  void writeThrough(tombstone, generation);
}

/** Renames a favourite; the new name is what a re-logged meal is called. */
export async function renameFavorite(id: string, title: string) {
  const generation = getLocalDataGeneration();
  await loadFavorites();
  const next = title.trim().replace(/\s+/g, ' ').slice(0, MAX_FAVORITE_TITLE);
  const key = favoriteKey({ title: next });
  if (!key) throw new Error('favorite_without_title');
  const all = favorites ?? [];
  const target = all.find((entry) => entry.id === id && !entry.pendingDelete);
  if (!target) return;
  if (all.some((entry) => entry.id !== id && !entry.pendingDelete && entry.key === key)) throw new Error('favorite_name_taken');
  const entry: FavoriteMeal = { ...target, key, meal: { ...target.meal, title: next }, updatedAt: new Date().toISOString() };
  await persist(all.map((item) => (item.id === id ? entry : item)), generation);
  void writeThrough(entry, generation);
}

/**
 * Pulls the account's favourites and pushes local-only changes. Silently
 * local-only without consent or cloud. Two favourites with the same name
 * (starred on two devices before a sync) collapse into the newer one.
 */
export async function syncFavorites(): Promise<void> {
  const generation = getLocalDataGeneration();
  await loadFavorites();
  const user = await cloudUser(generation);
  if (!user || !supabase) return;
  const { data, error } = await supabase.from('meal_favorites')
    .select('id,title,meal_type,confidence,items,calories,protein,carbs,fat,fiber,starred_at,updated_at')
    .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(MAX_FAVORITES);
  if (error || !Array.isArray(data) || generation !== getLocalDataGeneration() || !favorites) return;
  const syncedAt = new Date().toISOString();
  const remote = new Map((data as CloudRow[]).map((row) => [row.id, fromRow(row, syncedAt)]).filter((pair): pair is [string, FavoriteMeal] => Boolean(pair[1])));
  const merged: FavoriteMeal[] = [];
  const pending: FavoriteMeal[] = [];
  for (const local of favorites) {
    const cloud = local.id ? remote.get(local.id) : undefined;
    if (local.id) remote.delete(local.id);
    if (!cloud) {
      if (local.syncedAt && !local.pendingDelete) continue; // deleted on another device
      if (local.pendingDelete && !local.syncedAt) continue;
      merged.push(local);
      pending.push(local);
    } else if (local.pendingDelete || (local.updatedAt ?? '') > (cloud.updatedAt ?? '')) {
      merged.push(local);
      pending.push(local);
    } else {
      merged.push(cloud);
    }
  }
  merged.push(...remote.values());
  // Same name twice: keep the newest change, delete the other one everywhere.
  const byKey = new Map<string, FavoriteMeal>();
  const result: FavoriteMeal[] = [];
  for (const entry of [...merged].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))) {
    if (entry.pendingDelete) { result.push(entry); continue; }
    if (byKey.has(entry.key)) {
      if (entry.syncedAt) {
        const tombstone = { ...entry, pendingDelete: true };
        result.push(tombstone);
        pending.push(tombstone);
      }
      continue;
    }
    byKey.set(entry.key, entry);
    result.push(entry);
  }
  const ordered = result.sort((a, b) => b.starredAt.localeCompare(a.starredAt));
  await persist(ordered, generation);
  for (const entry of pending) {
    const latest = favorites?.find((item) => item.id === entry.id);
    if (!latest || latest.updatedAt !== entry.updatedAt || latest.pendingDelete !== entry.pendingDelete) continue;
    await writeThrough(latest, generation);
    if (generation !== getLocalDataGeneration()) return;
  }
}
