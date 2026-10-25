import productData from '@/data/supermarketProducts.json';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import { meetsDiet, preferenceBonus } from '@/services/preferences';
import type { Nutrition } from '@/types/nutrition';
import { suggestionBudget, suggestionCalorieTarget } from '@/utils/mealSuggestions';

/**
 * Plan → Supermarkt: three concrete shopping baskets of real products.
 *
 * Every product comes from the bundled Open Food Facts snapshot
 * (src/data/supermarketProducts.json, built by
 * scripts/build-supermarket-products.mjs); loose fruit comes from BLS 4.0.
 * The engine only picks products and whole-package-like amounts (1 pack,
 * ½ pack, 1–2 cups of a multipack, the label's own serving). It never changes
 * a nutrient value, so a card shows exactly what the label says for that
 * amount, and the logged meal is the same numbers (rounded per item, like a
 * search result).
 *
 * Deterministic: no clock, no randomness; ties break on ids.
 */

export type SupermarketCategory =
  | 'skyr' | 'quark' | 'cottage-cheese' | 'pudding' | 'yogurt' | 'tuna' | 'fish' | 'poultry' | 'jerky' | 'eggs'
  | 'protein-bar' | 'tofu' | 'legumes' | 'wrap' | 'sandwich' | 'salad' | 'ready-meal' | 'cheese' | 'hummus'
  | 'nuts' | 'bread' | 'fruit-puree' | 'fruit' | 'vegetable';

export type SupermarketProduct = {
  /** Barcode for Open Food Facts rows, `bls-<code>` for loose produce. */
  id: string;
  name: string;
  /** Only loose produce has an English name; packaged products keep their German label name. */
  nameEn?: string;
  brand: string;
  /** Only from the product's own Open Food Facts stores tag. Empty = unknown. */
  stores: string[];
  packageG?: number;
  /** Multipack cup or piece weight from the label; `estimated` for loose produce. */
  unit?: { g: number; count: number; estimated?: boolean };
  /** The label's own serving, when it is a real part of the package. */
  servingG?: number;
  per100g: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number };
  category: SupermarketCategory;
  diet: string[];
  src: 'off' | 'bls';
  fetched: string;
};

export type SupermarketDataset = {
  sources: Record<'off' | 'bls', { name: string; url: string; license: string }>;
  attribution: string;
  fetchedAt: string;
  products: SupermarketProduct[];
};

export type PortionContainer = 'cup' | 'can' | 'bar' | 'piece' | 'tray' | 'pack' | 'egg' | 'serving';

export type ComboPortion = {
  kind: 'pack' | 'half' | 'unit' | 'serving';
  count: number;
  grams: number;
  container: PortionContainer;
  /** Piece weight of loose produce: a typical value, not a label. */
  estimated: boolean;
};

export type ComboItem = Nutrition & { product: SupermarketProduct; portion: ComboPortion };

export type SupermarketCombo = Nutrition & {
  id: string;
  items: ComboItem[];
  score: number;
};

export const SUPERMARKET_DATA = productData as unknown as SupermarketDataset;

/** Store ids the data may carry; display names live in the dictionaries (plan.marketStores). */
export const STORE_IDS = ['lidl', 'aldi', 'aldi-nord', 'aldi-sued', 'rewe', 'edeka', 'kaufland', 'dm', 'penny', 'netto', 'rossmann'] as const;
export type StoreId = (typeof STORE_IDS)[number];

type Role = 'sweet' | 'savory' | 'meal' | 'bar';
/** Drained fish as a share of the can's net weight (typical German tuna cans: 195 g → ~140 g). */
export const TUNA_DRAINED_SHARE = 0.72;

const ANCHOR_ROLE: Partial<Record<SupermarketCategory, Role>> = {
  skyr: 'sweet', quark: 'sweet', yogurt: 'sweet', pudding: 'sweet',
  'cottage-cheese': 'savory', tuna: 'savory', fish: 'savory', poultry: 'savory', jerky: 'savory', eggs: 'savory',
  tofu: 'savory', legumes: 'savory', cheese: 'savory',
  wrap: 'meal', sandwich: 'meal', salad: 'meal', 'ready-meal': 'meal',
  'protein-bar': 'bar',
};
/** What reasonably goes with what: skyr and a banana, tuna and crispbread, not skyr and hummus. */
const PAIRING: Record<Role, { carb: SupermarketCategory[]; extra: SupermarketCategory[] }> = {
  sweet: { carb: ['fruit', 'fruit-puree'], extra: ['nuts'] },
  savory: { carb: ['bread', 'fruit'], extra: ['vegetable', 'hummus'] },
  meal: { carb: ['fruit'], extra: ['vegetable'] },
  bar: { carb: ['fruit'], extra: [] },
};
const CONTAINER: Record<SupermarketCategory, PortionContainer> = {
  skyr: 'cup', quark: 'cup', 'cottage-cheese': 'cup', pudding: 'cup', yogurt: 'cup', hummus: 'cup', 'fruit-puree': 'cup',
  tuna: 'can', legumes: 'pack', fish: 'pack', poultry: 'pack', jerky: 'pack', eggs: 'egg', tofu: 'pack', cheese: 'pack',
  'protein-bar': 'bar', wrap: 'piece', sandwich: 'piece', salad: 'tray', 'ready-meal': 'tray',
  nuts: 'pack', bread: 'pack', fruit: 'piece', vegetable: 'pack',
};
/** Categories where half a package is a normal amount to eat. */
const HALVES = new Set<SupermarketCategory>(['skyr', 'quark', 'cottage-cheese', 'yogurt', 'tofu', 'legumes', 'poultry', 'fish', 'cheese', 'hummus', 'vegetable', 'salad', 'fruit-puree']);
/** More than this is not "a portion" of anything, however few kcal it has (1 kg carrots). */
const MAX_PORTION_G = 550;
/** A side stays a side: half a bag of tomatoes, not the whole 500 g. */
const MAX_SIDE_G = 300;
const SIDES = new Set<SupermarketCategory>(['fruit', 'fruit-puree', 'bread', 'vegetable', 'nuts', 'hummus']);
/** Herb quark or paprika skyr goes with bread and vegetables, not with a banana. */
const SAVORY_NAME = /kräuter|frühlings|paprika|knoblauch|schnittlauch|herzhaft|gurke|tomate/i;

function roleOf(product: SupermarketProduct): Role {
  const role = ANCHOR_ROLE[product.category] ?? 'savory';
  return role === 'sweet' && SAVORY_NAME.test(product.name) ? 'savory' : role;
}

function itemNutrition(product: SupermarketProduct, grams: number): Nutrition {
  // Same rounding as mealFromSearch, so the card and the logged meal agree.
  const factor = grams / 100;
  const n = product.per100g;
  return {
    calories: Math.round(n.kcal * factor),
    protein: Math.round(n.protein * factor),
    carbs: Math.round(n.carbs * factor),
    fat: Math.round(n.fat * factor),
    ...(n.fiber === undefined ? {} : { fiber: Math.round(n.fiber * factor) }),
  };
}

export function productPortions(product: SupermarketProduct): ComboPortion[] {
  const container = CONTAINER[product.category];
  const portions: ComboPortion[] = [];
  const estimated = Boolean(product.unit?.estimated);
  if (product.category === 'eggs' && !product.unit && product.servingG && product.servingG <= 70) {
    // Boiled-egg packs label one egg as the serving.
    for (let count = 1; count <= 3; count += 1) {
      portions.push({ kind: 'unit', count, grams: product.servingG * count, container: 'egg', estimated: false });
    }
    return portions;
  }
  if (product.unit) {
    const max = product.category === 'eggs' ? Math.min(3, product.unit.count) : Math.min(2, Math.max(1, product.unit.count));
    for (let count = 1; count <= max; count += 1) {
      portions.push({ kind: 'unit', count, grams: product.unit.g * count, container, estimated });
    }
  } else if (product.packageG && product.category === 'tuna' && !product.servingG) {
    // Canned tuna labels refer to the drained fish, but the pack weight
    // includes oil or brine. Without a labelled serving, use the typical
    // drained share (~72 %) of the can and mark it as an estimate.
    portions.push({ kind: 'pack', count: 1, grams: Math.round(product.packageG * TUNA_DRAINED_SHARE), container, estimated: true });
  } else if (product.packageG && !(product.category === 'tuna' && product.servingG)) {
    // Where a tuna label names its drained serving, that serving (below) is the amount.
    portions.push({ kind: 'pack', count: 1, grams: product.packageG, container, estimated: false });
    if (HALVES.has(product.category) && product.packageG >= 200) {
      portions.push({ kind: 'half', count: 1, grams: Math.round(product.packageG / 2), container, estimated: false });
    }
  }
  if (product.servingG) {
    portions.push({ kind: 'serving', count: 1, grams: product.servingG, container: 'serving', estimated: false });
    if (product.category === 'bread' && product.servingG * 2 < (product.packageG ?? Infinity)) {
      portions.push({ kind: 'serving', count: 2, grams: product.servingG * 2, container: 'serving', estimated: false });
    }
  }
  return portions.filter((portion) => portion.grams <= MAX_PORTION_G);
}

type Candidate = ComboItem & { key: string };
const portionCache = new WeakMap<SupermarketProduct[], Candidate[]>();
function allCandidates(products: SupermarketProduct[]) {
  let cached = portionCache.get(products);
  if (!cached) {
    cached = products.flatMap((product) => productPortions(product).map((portion) => ({
      product,
      portion,
      ...itemNutrition(product, portion.grams),
      key: `${product.id}:${portion.kind}${portion.count}`,
    })));
    portionCache.set(products, cached);
  }
  return cached;
}

/** Diet preferences are hard filters via the shared mapping; a product without the tag is unknown and excluded. */
export function matchesPreferences(product: SupermarketProduct, preferences: string[]) {
  return meetsDiet(product.diet, preferences);
}

/** Nothing in a basket needs cooking, so every basket counts as quick. */
const BASKET_TAGS = ['quick'];

export type ComboBudget = { target: number; max: number; min: number; protein: number; fatCap: number };

export function comboBudget(remaining: Nutrition): ComboBudget {
  const budget = suggestionBudget(remaining.calories);
  const target = suggestionCalorieTarget(remaining.calories);
  return {
    target,
    // Never more than 10 % above what is left (or the 200 kcal small meal).
    max: Math.floor(budget * 1.1),
    min: Math.round(target * 0.5),
    // Same aim as the dish suggestions, capped by what a portion of this size
    // can carry (≈ skyr density), so a 200 kcal snack is not "too low".
    protein: Math.round(Math.min(45, Math.max(20, remaining.protein * 0.48), target * 0.14)),
    fatCap: Math.max(12, Math.round(remaining.fat * 0.4)),
  };
}

function sum(items: ComboItem[]): Nutrition {
  return items.reduce<Nutrition>((total, item) => ({
    calories: total.calories + item.calories,
    protein: total.protein + item.protein,
    carbs: total.carbs + item.carbs,
    fat: total.fat + item.fat,
    fiber: (total.fiber ?? 0) + (item.fiber ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

function scoreOf(total: Nutrition, items: ComboItem[], budget: ComboBudget, preferences: string[]) {
  const calorieDistance = Math.abs(total.calories - budget.target) / 70;
  const proteinShort = Math.max(0, budget.protein - total.protein) / 5;
  const fatOver = Math.max(0, total.fat - budget.fatCap) / 8;
  // A can of tuna on its own is not a meal; a cup of skyr or a wrap is.
  const bareSavory = items.length === 1 && roleOf(items[0].product) === 'savory' ? 0.8 : 0;
  const extraItems = items.length === 3 ? 0.2 : 0;
  const storeKnown = items.some((item) => item.product.stores.length) ? 0.15 : 0;
  // Baskets lean to protein by design; the person's own preferences add the
  // same bonus they earn for a dish at home or on the go.
  const baseProtein = preferences.includes('high-protein') ? 0 : Math.min(total.protein, 50) / 40;
  return calorieDistance + proteinShort + fatOver + bareSavory + extraItems - storeKnown - baseProtein
    - preferenceBonus(total, BASKET_TAGS, preferences);
}

function comboId(items: ComboItem[]) {
  return `market-${items.map((item) => `${item.product.id}-${item.portion.kind[0]}${item.portion.count}`).join('_')}`;
}

type Scored = { items: Candidate[]; total: Nutrition; score: number };

function bestForAnchor(anchor: Candidate, carbs: Candidate[], extras: Candidate[], budget: ComboBudget, preferences: string[], relaxed: boolean): Scored | null {
  const role = roleOf(anchor.product);
  const pairing = PAIRING[role];
  const evaluate = (items: Candidate[]): Scored | null => {
    const total = sum(items);
    if (total.calories > budget.max) return null;
    if (!relaxed && total.calories < budget.min) return null;
    return { items, total, score: scoreOf(total, items, budget, preferences) };
  };
  const better = (a: Scored | null, b: Scored | null) => (!a ? b : !b ? a : b.score < a.score ? b : a);
  let best = evaluate([anchor]);
  const fits = (side: Candidate) => side.product.id !== anchor.product.id && anchor.calories + side.calories <= budget.max;
  const top = (pool: Candidate[], allowed: SupermarketCategory[]) => pool
    .filter((side) => allowed.includes(side.product.category) && fits(side))
    .map((side) => evaluate([anchor, side]))
    .filter((entry): entry is Scored => Boolean(entry))
    .sort((a, b) => a.score - b.score || a.items[1].key.localeCompare(b.items[1].key))
    .slice(0, 3);
  const withCarb = top(carbs, pairing.carb);
  const withExtra = top(extras, pairing.extra);
  for (const entry of [...withCarb, ...withExtra]) best = better(best, entry);
  for (const carb of withCarb) {
    for (const extra of withExtra) {
      best = better(best, evaluate([anchor, carb.items[1], extra.items[1]]));
    }
  }
  return best;
}

/**
 * Three baskets for the remaining day: one protein anchor plus an optional
 * carb (fruit, bread) and an optional extra (vegetables, nuts, hummus).
 * Three different anchor products always; different anchor categories
 * (not three skyrs) whenever the data allows.
 */
export function supermarketCombos(
  remaining: Nutrition,
  preferences: string[] = [],
  products: SupermarketProduct[] = SUPERMARKET_DATA.products,
): SupermarketCombo[] {
  const budget = comboBudget(remaining);
  const pool = allCandidates(products).filter((candidate) => matchesPreferences(candidate.product, preferences) && candidate.calories <= budget.max);
  const sides = pool.filter((candidate) => SIDES.has(candidate.product.category) && candidate.portion.grams <= MAX_SIDE_G);
  const carbs = sides.filter((candidate) => ['fruit', 'fruit-puree', 'bread'].includes(candidate.product.category));
  const extras = sides.filter((candidate) => ['vegetable', 'nuts', 'hummus'].includes(candidate.product.category));

  const rank = (relaxed: boolean) => {
    const anchors = pool.filter((candidate) => relaxed
      ? true
      : ANCHOR_ROLE[candidate.product.category] && candidate.protein >= 10);
    const bestByProduct = new Map<string, Scored>();
    for (const anchor of anchors) {
      const best = bestForAnchor(anchor, carbs, extras, budget, preferences, relaxed);
      if (!best) continue;
      const current = bestByProduct.get(anchor.product.id);
      if (!current || best.score < current.score) bestByProduct.set(anchor.product.id, best);
    }
    return [...bestByProduct.values()].sort((a, b) => a.score - b.score || comboId(a.items).localeCompare(comboId(b.items)));
  };

  const pick = (ranked: Scored[], chosen: Scored[] = []) => {
    const remainingPool = ranked.filter((entry) => !chosen.some((picked) => picked.items[0].product.id === entry.items[0].product.id));
    while (chosen.length < 3 && remainingPool.length) {
      const categories = new Set(chosen.map((entry) => entry.items[0].product.category));
      const roles = new Set(chosen.map((entry) => roleOf(entry.items[0].product)));
      const sides = new Set(chosen.flatMap((entry) => entry.items.slice(1).map((item) => item.product.id)));
      let bestIndex = 0;
      let bestScore = Infinity;
      remainingPool.forEach((entry, index) => {
        const adjusted = entry.score
          + (categories.has(entry.items[0].product.category) ? 4 : 0)
          // Something sweet, something savoury, something to go, when it fits.
          + (roles.has(roleOf(entry.items[0].product)) ? 1.2 : 0)
          + entry.items.slice(1).filter((item) => sides.has(item.product.id)).length * 0.8;
        if (adjusted < bestScore) { bestScore = adjusted; bestIndex = index; }
      });
      chosen.push(remainingPool.splice(bestIndex, 1)[0]);
    }
    return chosen;
  };

  let chosen = pick(rank(false));
  // Very small budgets or strict preferences can leave fewer than three
  // protein anchors; then any fitting product may lead a basket.
  if (chosen.length < 3) chosen = pick(rank(true), chosen);

  return chosen.map((entry) => ({
    id: comboId(entry.items),
    items: entry.items.map(({ key: _key, ...item }) => item),
    ...entry.total,
    score: Math.round(entry.score * 1000) / 1000,
  }));
}

/** The product's own name in the reader's language, without the brand. */
export function productName(product: SupermarketProduct, language: string) {
  return language === 'en' && product.nameEn ? product.nameEn : product.name;
}

/** "Milbona Skyr natur"; the brand is not repeated when the name already starts with it. */
export function productDisplayName(product: SupermarketProduct, language: string) {
  const name = productName(product, language);
  if (!product.brand || name.toLowerCase().includes(product.brand.toLowerCase())) return name;
  return `${product.brand} ${name}`;
}

/**
 * The combo as search results for the confirm screen, so the user can still
 * change every amount before logging. The portion offered first is the one
 * the card showed.
 */
export function comboSearchEntries(combo: SupermarketCombo, language: string, portionLabel: (portion: ComboPortion) => string) {
  return combo.items.map((item): { result: FoodSearchResult; grams: number } => {
    const { product, portion } = item;
    const bls = product.src === 'bls';
    const code = bls ? product.id.replace(/^bls-/, '') : product.id;
    const portions = [{ label: portionLabel(portion), grams: portion.grams, ...(portion.estimated ? { estimated: true } : {}) }];
    if (product.packageG && product.packageG !== portion.grams && product.category !== 'tuna') {
      portions.push({ label: portionLabel({ kind: 'pack', count: 1, grams: product.packageG, container: CONTAINER[product.category], estimated: false }), grams: product.packageG });
    }
    return {
      grams: portion.grams,
      result: {
        id: bls ? `bls-${code}` : `off-${code}`,
        name: productDisplayName(product, language),
        per100g: {
          calories: product.per100g.kcal,
          protein: product.per100g.protein,
          carbs: product.per100g.carbs,
          fat: product.per100g.fat,
          ...(product.per100g.fiber === undefined ? {} : { fiber: product.per100g.fiber }),
        },
        defaultGrams: portion.grams,
        portions,
        source: bls
          ? { provider: 'bls', referenceId: code, label: `BLS 4.0 ${code}` }
          : { provider: 'open-food-facts', referenceId: code, label: `Open Food Facts ${code}` },
      },
    };
  });
}
