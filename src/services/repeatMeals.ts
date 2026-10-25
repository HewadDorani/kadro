import type { Meal } from '@/types/nutrition';

export type RepeatCandidate = {
  /** Stable key across days: same title and roughly the same size. */
  key: string;
  title: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  count: number;
  lastEatenAt: string;
  source: Meal;
  /** Starred by the user; shown first and kept even when already eaten today. */
  favorite?: boolean;
};

/**
 * A starred meal: exactly the meal as it was logged (items and grams), so it
 * re-logs 1:1. Stored on the device first and, with wellness consent and an
 * active cloud, written through to public.meal_favorites.
 */
export type FavoriteMeal = {
  /** UUID; older device-only entries get one on first load. */
  id?: string;
  /** favoriteKey(meal.title); the star state of a logged meal matches on it. */
  key: string;
  meal: Meal;
  starredAt: string;
  /** Last local change (add, rename); the newest change wins on sync. */
  updatedAt?: string;
  /** Last confirmed cloud write; absent while the change is only local. */
  syncedAt?: string;
  /** Removed on this device; the cloud delete is retried on the next sync. */
  pendingDelete?: boolean;
};

/** A personal shortlist, not a second diary. */
export const MAX_FAVORITES = 100;
export const MAX_FAVORITE_TITLE = 160;

function bucket(calories: number) {
  // 50 kcal buckets, so "Skyr mit Beeren" at 340 and 355 is one entry rather
  // than two, while a genuinely different portion stays separate.
  return Math.round(calories / 50);
}

function keyOf(meal: Meal) {
  // Invariant: this is a grouping key, so it must not shift with the
  // interface language or the same meal would stop matching itself.
  return `${meal.title.trim().toLowerCase()}|${bucket(meal.calories)}`;
}

/**
 * The meals worth offering as one tap.
 *
 * People eat the same fifteen things. Repeating one costs no analysis call and
 * no waiting, which beats a larger food database for everyday use. Ordering
 * puts frequency first and recency second, so a daily breakfast outranks
 * yesterday's one-off.
 */
export function repeatCandidates(history: Meal[], limit = 8): RepeatCandidate[] {
  const groups = new Map<string, RepeatCandidate>();

  for (const meal of history) {
    if (meal.origin !== 'scan' && meal.origin !== 'plan') continue;
    if (!meal.title?.trim()) continue;

    const key = keyOf(meal);
    const savedAt = meal.savedAt ?? '';
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        title: meal.title.trim(),
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
        fiber: meal.fiber ?? 0,
        count: 1,
        lastEatenAt: savedAt,
        source: meal,
      });
      continue;
    }

    existing.count += 1;
    if (savedAt > existing.lastEatenAt) {
      // Keep the most recent version's numbers: a corrected portion should win.
      existing.lastEatenAt = savedAt;
      existing.calories = meal.calories;
      existing.protein = meal.protein;
      existing.carbs = meal.carbs;
      existing.fat = meal.fat;
      existing.fiber = meal.fiber ?? 0;
      existing.source = meal;
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastEatenAt.localeCompare(a.lastEatenAt))
    .slice(0, limit);
}

/** Candidates not already logged today, so the list never suggests a duplicate. */
export function availableRepeats(history: Meal[], today: Meal[], limit = 8) {
  const eatenToday = new Set(today.map(keyOf));
  return repeatCandidates(history, limit + eatenToday.size)
    .filter((candidate) => !eatenToday.has(candidate.key))
    .slice(0, limit);
}

/** Yesterday's actual breakfast, including foods saved individually by search.
 * Reuse the ordinary repeat save path; never analyse or modify historical data.
 * Hide once any breakfast is logged today, including a corrected repeat.
 */
export function yesterdayBreakfast(history: Meal[], today: Meal[], day: string): RepeatCandidate | null {
  const logged = (meal: Meal) => meal.origin === 'scan' || meal.origin === 'plan';
  if (today.some(meal => logged(meal) && meal.type === 'Breakfast' && meal.date === day)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Calendar subtraction at local noon preserves the previous day over DST.
  const date = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  const yesterday = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const seen = new Set<string>();
  const breakfast = history.filter(meal => {
    if (!logged(meal) || meal.type !== 'Breakfast' || meal.date !== yesterday || !meal.title?.trim() || seen.has(meal.id)) return false;
    seen.add(meal.id); return true;
  }).sort((a, b) => (a.savedAt ?? a.time).localeCompare(b.savedAt ?? b.time) || a.id.localeCompare(b.id));
  if (!breakfast.length) return null;
  const totals = breakfast.reduce((sum, meal) => ({
    calories: sum.calories + meal.calories, protein: sum.protein + meal.protein,
    carbs: sum.carbs + meal.carbs, fat: sum.fat + meal.fat, fiber: sum.fiber + (meal.fiber ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const source: Meal = {
    ...breakfast[0], ...totals,
    id: `yesterday-breakfast-${yesterday}`,
    title: breakfast.map(meal => meal.title.trim()).join(' + '),
    confidence: breakfast.some(meal => meal.confidence === 'medium') ? 'medium' : 'high',
    items: breakfast.flatMap((meal, mealIndex) => meal.items.map((item, itemIndex) => ({ ...item, id: `repeat-${mealIndex}-${itemIndex}-${item.id}` }))),
    savedAt: breakfast[breakfast.length - 1].savedAt,
    sync: undefined,
  };
  return { key: keyOf(source), title: source.title, ...totals, count: 1, lastEatenAt: source.savedAt ?? '', source };
}

/** A favourite is the meal people name, not one exact portion of it. */
export function favoriteKey(meal: Pick<Meal, 'title'>) {
  return meal.title?.trim().toLowerCase() ?? '';
}

/**
 * What a favourite keeps: the meal exactly as logged (its included items with
 * their grams, sources and per-100 g references), never its sync identity,
 * day or clock time.
 */
export function favoriteSnapshot(meal: Meal, title = meal.title): Meal {
  const { sync: _sync, date: _date, savedAt: _savedAt, ...rest } = meal;
  const items = meal.items.filter((item) => item.included);
  return { ...rest, title: title.trim().slice(0, MAX_FAVORITE_TITLE), items, origin: 'plan' };
}

/** Favourites the user still sees (a pending cloud delete is already gone). */
export function visibleFavorites(favorites: FavoriteMeal[]) {
  return favorites.filter((entry) => !entry.pendingDelete);
}

/** The favourite a logged or drafted meal belongs to, by its name. */
export function findFavorite(favorites: FavoriteMeal[], meal: Pick<Meal, 'title'>) {
  const key = favoriteKey(meal);
  if (!key) return null;
  return favorites.find((entry) => !entry.pendingDelete && entry.key === key) ?? null;
}

/** One favourite as a repeat candidate: its stored snapshot, 1:1. */
export function favoriteCandidate(entry: FavoriteMeal, history: Meal[] = []): RepeatCandidate {
  const source = entry.meal;
  const count = history.filter((meal) => favoriteKey(meal) === entry.key).length;
  return {
    key: `favorite|${entry.id ?? entry.key}`,
    title: source.title.trim(),
    calories: source.calories,
    protein: source.protein,
    carbs: source.carbs,
    fat: source.fat,
    fiber: source.fiber ?? 0,
    count: Math.max(1, count),
    lastEatenAt: entry.starredAt,
    source,
    favorite: true,
  };
}

/**
 * Favourites first, then the usual repeats. A favourite repeats exactly what
 * was stored when it was starred (items and grams), not whatever portion was
 * logged last: "Zu Favoriten hinzufügen" promises that meal, 1:1.
 */
export function withFavorites(candidates: RepeatCandidate[], favorites: FavoriteMeal[], history: Meal[], limit = 8): RepeatCandidate[] {
  const shown = visibleFavorites(favorites);
  if (!shown.length) return candidates.slice(0, limit);
  const starred = new Set(shown.map((entry) => entry.key));
  const first = shown.map((entry) => favoriteCandidate(entry, history));
  return [...first, ...candidates.filter((candidate) => !starred.has(favoriteKey(candidate)))].slice(0, Math.max(limit, first.length));
}

const foldText = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

/** Favourites whose name or ingredients contain every typed word. */
export function filterFavoriteCandidates(candidates: RepeatCandidate[], query: string) {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return candidates;
  return candidates.filter((candidate) => {
    const haystack = foldText(`${candidate.title} ${candidate.source.items.map((item) => item.name).join(' ')}`);
    return words.every((word) => haystack.includes(word));
  });
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * "Weniger / Passt / Mehr" on a favourite, relative to the stored grams.
 * Each item is rescaled from its own per-100 g reference, so the totals stay
 * the sum of the items; 1x returns the stored meal unchanged.
 */
export function scaleMealPortion(meal: Meal, factor: number): Meal {
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0) return meal;
  const items = meal.items.map((item) => {
    if (!item.included || !(item.amountG > 0)) return item;
    const amountG = Math.min(5000, Math.max(1, round1(item.amountG * factor)));
    const reference = item.nutritionPer100g ?? {
      calories: item.calories * 100 / item.amountG,
      protein: item.protein * 100 / item.amountG,
      carbs: item.carbs * 100 / item.amountG,
      fat: item.fat * 100 / item.amountG,
      fiber: (item.fiber ?? 0) * 100 / item.amountG,
    };
    const ratio = amountG / 100;
    return {
      ...item,
      amountG,
      nutritionPer100g: reference,
      portionFactor: item.baseAmountG > 0 ? amountG / item.baseAmountG : 1,
      calories: Math.round(reference.calories * ratio),
      protein: Math.round(reference.protein * ratio),
      carbs: Math.round(reference.carbs * ratio),
      fat: Math.round(reference.fat * ratio),
      fiber: Math.round((reference.fiber ?? 0) * ratio),
    };
  });
  const totals = items.filter((item) => item.included).reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat,
    fiber: sum.fiber + (item.fiber ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  return { ...meal, items, ...totals };
}
