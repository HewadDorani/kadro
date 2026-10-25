import deChains from '@/data/chains/de.json';
import gbChains from '@/data/chains/gb.json';
import usChains from '@/data/chains/us.json';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import { DIET_PREFERENCES, meetsDiet, preferenceBonus } from '@/services/preferences';
import type { MarketRegion } from '@/services/region';
import { comboBudget, type ComboBudget } from '@/services/supermarketCombos';
import type { Nutrition } from '@/types/nutrition';

/**
 * Plan → Unterwegs: three orders from real restaurant and fast-food chains of
 * the person's market that fit what is left of the day.
 *
 * Every value is what the chain itself publishes for that market
 * (src/data/chains/<market>.json, one `source` URL and `checked` date per
 * item). The engine only picks menu items and whole servings (a burger, two
 * pieces of chicken, a 15 cm sub); it never changes a nutrient value, so a
 * card shows exactly the chain's numbers and the logged meal is the same.
 * Build-your-own chains (Chipotle) publish components only; their standard
 * builds in the data list the components, and the card and the meal list
 * each component with its own published values.
 *
 * Region isolation: a market only ever sees its own file. No German chain in
 * the UK, no Greggs in Germany.
 *
 * Deterministic: no clock (the caller passes the hour), no randomness; ties
 * break on ids.
 */

export type ChainCategory =
  | 'burger' | 'wrap' | 'bowl' | 'salad' | 'sandwich' | 'pizza' | 'sushi' | 'soup' | 'side' | 'drink'
  | 'dessert' | 'breakfast' | 'coffee' | 'snack' | 'bakery';

export type ChainItem = {
  id: string;
  chain: string;
  market: MarketRegion;
  /** As the chain names it in that market. */
  name: string;
  category: ChainCategory;
  /** "1 Burger", "15 cm", "Medium (16 fl oz)". */
  servingLabel: string;
  /** Grams (ml for drinks) per serving, only when the chain publishes it. */
  servingG?: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  tags: string[];
  /** Part of a build-your-own meal; never offered on its own. */
  component?: boolean;
  computedFromPer100g?: boolean;
  computedFromKj?: boolean;
  source: string;
  checked: string;
};

export type ChainInfo = {
  id: string;
  name: string;
  sourceTitle: string;
  sources: string[];
  checked: string;
  items: number;
  notes?: string;
};

export type ChainBuild = { id: string; chain: string; name: string; components: string[] };

export type ChainDataset = {
  market: MarketRegion;
  attribution: string;
  checked: string;
  chains: ChainInfo[];
  builds: ChainBuild[];
  items: ChainItem[];
};

export type ChainComboItem = Nutrition & { item: ChainItem; count: number };

export type ChainCombo = Nutrition & {
  id: string;
  chain: ChainInfo;
  /** The main dish: a menu item, or the name of a standard build. */
  title: string;
  items: ChainComboItem[];
  /** Latest `checked` date of the items shown. */
  checked: string;
  score: number;
};

export const CHAIN_DATA: Record<MarketRegion, ChainDataset> = {
  de: deChains as unknown as ChainDataset,
  gb: gbChains as unknown as ChainDataset,
  us: usChains as unknown as ChainDataset,
};

export type ChainComboOptions = {
  market: MarketRegion;
  /** Local hour 0–23; breakfast items before 11, never after. */
  hour: number;
  preferences?: string[];
  /** Tests only: a different dataset for the market. */
  data?: ChainDataset;
};

const MAIN_CATEGORIES = new Set<ChainCategory>(['burger', 'wrap', 'bowl', 'salad', 'sandwich', 'pizza', 'sushi', 'soup', 'breakfast', 'snack', 'bakery']);
/** What may come with a main: a side, a small bakery item, or a drink that brings protein (a latte, milk). */
const EXTRA_CATEGORIES = new Set<ChainCategory>(['side', 'bakery', 'drink', 'coffee']);
/** A soft drink or a syrup coffee never fills a calorie gap; a latte or a glass of milk may. */
const MIN_DRINK_EXTRA_PROTEIN = 5;
/** Snacks and bakery items lead an order only with real protein (chicken pieces, a sausage roll), not a pretzel. */
const MIN_MAIN_PROTEIN: Partial<Record<ChainCategory, number>> = { snack: 10, bakery: 10 };
/** "10 wings (serves 2-3)" is not one person's meal. */
const SHARING = /\bserves\b|sharing|zum teilen|family|bucket/i;
const BREAKFAST_END_HOUR = 11;
/** One serving of a single piece of chicken or fish (a thigh, a tender) may be ordered several times. */
const PIECE_LABEL = /^1\s*(stück|piece|pc)\b/i;
const MAX_PIECES = 6;
const MAX_PIECE_ORDER_KCAL = 700;
const ZERO_KCAL = 5;

const isDrink = (item: ChainItem) => item.category === 'drink' || item.category === 'coffee';
const isZeroDrink = (item: ChainItem) => isDrink(item) && item.kcal <= ZERO_KCAL;
const isBreakfastOnly = (item: ChainItem) => item.category === 'breakfast' || item.tags.includes('breakfast');

function nutritionOf(item: ChainItem, count: number): Nutrition {
  // Whole numbers, like a search result logged at this amount.
  return {
    calories: Math.round(item.kcal * count),
    protein: Math.round(item.protein * count),
    carbs: Math.round(item.carbs * count),
    fat: Math.round(item.fat * count),
    ...(item.fiber === undefined ? {} : { fiber: Math.round(item.fiber * count) }),
  };
}

function sum(entries: ChainComboItem[]): Nutrition {
  return entries.reduce<Nutrition>((total, entry) => ({
    calories: total.calories + entry.calories,
    protein: total.protein + entry.protein,
    carbs: total.carbs + entry.carbs,
    fat: total.fat + entry.fat,
    fiber: (total.fiber ?? 0) + (entry.fiber ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

/** Counts a menu item can be ordered in: 1, or 1–6 single pieces up to a meal's worth. */
export function orderCounts(item: ChainItem): number[] {
  if (item.category !== 'snack' || !PIECE_LABEL.test(item.servingLabel) || item.kcal <= 0) return [1];
  if (!item.tags.includes('chicken') && !item.tags.includes('fish')) return [1];
  const max = Math.max(1, Math.min(MAX_PIECES, Math.floor(MAX_PIECE_ORDER_KCAL / item.kcal)));
  return Array.from({ length: max }, (_, index) => index + 1);
}

type Main = { key: string; title: string; entries: ChainComboItem[]; tags: string[]; breakfast: boolean };

/** Diet tags a build establishes (a diet only when every component establishes it), plus what it contains. */
function combinedTags(items: ChainItem[]) {
  const diets = DIET_PREFERENCES.filter((diet) => items.every((item) => meetsDiet(item.tags, [diet])));
  const contents = items.flatMap((item) => item.tags.filter((tag) => !(DIET_PREFERENCES as readonly string[]).includes(tag)));
  return [...new Set<string>([...diets, ...contents])];
}

function mainsFor(data: ChainDataset, chainId: string, hour: number, preferences: string[]): Main[] {
  const morning = hour < BREAKFAST_END_HOUR;
  const allowed = (item: ChainItem) => meetsDiet(item.tags, preferences) && (morning || !isBreakfastOnly(item));
  const mains: Main[] = [];
  for (const item of data.items) {
    if (item.chain !== chainId || item.component || !MAIN_CATEGORIES.has(item.category) || SHARING.test(`${item.name} ${item.servingLabel}`)) continue;
    if (item.protein < (MIN_MAIN_PROTEIN[item.category] ?? 0) || !allowed(item)) continue;
    for (const count of orderCounts(item)) {
      mains.push({
        key: count === 1 ? item.id : `${item.id}x${count}`,
        title: item.name,
        entries: [{ item, count, ...nutritionOf(item, count) }],
        tags: item.tags,
        breakfast: isBreakfastOnly(item),
      });
    }
  }
  const byId = new Map(data.items.map((item) => [item.id, item]));
  for (const build of data.builds) {
    if (build.chain !== chainId) continue;
    const components = build.components.map((id) => byId.get(id)).filter((item): item is ChainItem => Boolean(item));
    if (components.length !== build.components.length) continue;
    const tags = combinedTags(components);
    // A strict diet needs every component to establish it.
    if (!components.every((component) => meetsDiet(component.tags, preferences))) continue;
    mains.push({
      key: build.id,
      title: build.name,
      entries: components.map((item) => ({ item, count: 1, ...nutritionOf(item, 1) })),
      tags,
      breakfast: false,
    });
  }
  return mains;
}

type Scored = { main: Main; entries: ChainComboItem[]; total: Nutrition; score: number };

function scoreOf(total: Nutrition, main: Main, extras: number, budget: ComboBudget, preferences: string[], morning: boolean) {
  const calorieDistance = Math.abs(total.calories - budget.target) / 70;
  const proteinShort = Math.max(0, budget.protein - total.protein) / 5;
  const fatOver = Math.max(0, total.fat - budget.fatCap) / 8;
  // Same lean to protein as the supermarket baskets; the person's own goals
  // add the shared bonus on top.
  const baseProtein = preferences.includes('high-protein') ? 0 : Math.min(total.protein, 50) / 40;
  const breakfastFit = morning && main.breakfast ? 2.5 : 0;
  // A side is welcome when it closes a gap, not by default.
  const extraCost = extras * 0.25;
  return calorieDistance + proteinShort + fatOver + extraCost - baseProtein - breakfastFit
    - preferenceBonus(total, main.tags, preferences);
}

/** Water first, then a sugar-free soft drink, then tea or black coffee; coffee first in the morning. */
function zeroDrinkRank(item: ChainItem, morning: boolean) {
  const name = item.name.toLowerCase();
  const water = /wasser|water|vio\b/.test(name) ? 0 : /zero|diet|light|sugar.?free|zuckerfrei/.test(name) ? 1 : 2;
  const coffee = item.category === 'coffee' ? 0 : 1;
  return morning ? coffee * 10 + water : water * 10 + coffee;
}

function bestForChain(data: ChainDataset, chain: ChainInfo, budget: ComboBudget, hour: number, preferences: string[], relaxed: boolean): Scored[] {
  const morning = hour < BREAKFAST_END_HOUR;
  const chainItems = data.items.filter((item) => item.chain === chain.id && !item.component && meetsDiet(item.tags, preferences));
  const zero = chainItems
    .filter(isZeroDrink)
    .filter((item) => !SHARING.test(item.name))
    .sort((a, b) => zeroDrinkRank(a, morning) - zeroDrinkRank(b, morning) || a.kcal - b.kcal || a.id.localeCompare(b.id))[0];
  const extras = chainItems.filter((item) => EXTRA_CATEGORIES.has(item.category) && !isZeroDrink(item)
    && (!isDrink(item) || item.protein >= MIN_DRINK_EXTRA_PROTEIN)
    && !(item.category === 'bakery' && item.protein >= (MIN_MAIN_PROTEIN.bakery ?? 0))
    && (morning || !isBreakfastOnly(item)) && !SHARING.test(`${item.name} ${item.servingLabel}`));
  const results: Scored[] = [];
  for (const main of mainsFor(data, chain.id, hour, preferences)) {
    const base = sum(main.entries);
    if (base.calories > budget.max) continue;
    const evaluate = (entries: ChainComboItem[], extraCount: number): Scored | null => {
      const total = sum(entries);
      if (total.calories > budget.max) return null;
      if (!relaxed && total.calories < budget.min) return null;
      return { main, entries, total, score: scoreOf(total, main, extraCount, budget, preferences, morning) };
    };
    let best = evaluate(main.entries, 0);
    const mainIds = new Set(main.entries.map((entry) => entry.item.id));
    for (const extra of extras) {
      if (mainIds.has(extra.id) || base.calories + extra.kcal > budget.max) continue;
      const candidate = evaluate([...main.entries, { item: extra, count: 1, ...nutritionOf(extra, 1) }], 1);
      if (candidate && (!best || candidate.score < best.score || (candidate.score === best.score && candidate.entries.at(-1)!.item.id < best.entries.at(-1)!.item.id))) best = candidate;
    }
    if (!best) continue;
    // Water (or a Coke Zero) with it when the chain publishes one and nothing else to drink is in the order.
    if (zero && !best.entries.some((entry) => isDrink(entry.item))) {
      best = { ...best, entries: [...best.entries, { item: zero, count: 1, ...nutritionOf(zero, 1) }] };
      best.total = sum(best.entries);
    }
    results.push(best);
  }
  return results.sort((a, b) => a.score - b.score || comboKey(a).localeCompare(comboKey(b)));
}

function comboKey(entry: Scored) {
  return `chain-${entry.main.key}${entry.entries.filter((item) => !entry.main.entries.includes(item)).map((item) => `_${item.item.id}`).join('')}`;
}

/**
 * Three orders for the remaining day, each from a different chain when the
 * market's data allows (else a second dish from a chain already shown).
 * Fewer than three only when even that cannot fill the set; the screen then
 * falls back to the dish catalogue so there are always exactly three options.
 */
export function chainCombos(remaining: Nutrition, options: ChainComboOptions): ChainCombo[] {
  const data = options.data ?? CHAIN_DATA[options.market];
  if (!data || data.market !== options.market) return [];
  const preferences = options.preferences ?? [];
  const budget = comboBudget(remaining);
  const hour = Number.isFinite(options.hour) ? Math.max(0, Math.min(23, Math.floor(options.hour))) : 12;

  const rank = (relaxed: boolean) => data.chains
    .map((chain) => ({ chain, ranked: bestForChain(data, chain, budget, hour, preferences, relaxed) }))
    .filter((entry) => entry.ranked.length);

  const chosen: { chain: ChainInfo; entry: Scored }[] = [];
  const take = (perChain: ReturnType<typeof rank>) => {
    // First pass: the best order of each chain, best chains first.
    const firsts = perChain
      .map(({ chain, ranked }) => ({ chain, entry: ranked[0] }))
      .sort((a, b) => a.entry.score - b.entry.score || a.chain.id.localeCompare(b.chain.id));
    for (const pick of firsts) {
      if (chosen.length >= 3) break;
      if (chosen.some((existing) => existing.chain.id === pick.chain.id)) continue;
      chosen.push(pick);
    }
    // Second pass: another dish from a chain already shown, never the same main.
    if (chosen.length < 3) {
      const seconds = perChain
        .flatMap(({ chain, ranked }) => ranked.map((entry) => ({ chain, entry })))
        .filter((pick) => !chosen.some((existing) => existing.entry.main.key === pick.entry.main.key))
        .sort((a, b) => a.entry.score - b.entry.score || comboKey(a.entry).localeCompare(comboKey(b.entry)));
      for (const pick of seconds) {
        if (chosen.length >= 3) break;
        if (chosen.some((existing) => existing.entry.main.key === pick.entry.main.key)) continue;
        chosen.push(pick);
      }
    }
  };
  take(rank(false));
  // A small budget can leave fewer than three orders above the minimum; then
  // anything that fits under the maximum may fill the set.
  if (chosen.length < 3) take(rank(true));

  return chosen.slice(0, 3).map(({ chain, entry }) => ({
    id: comboKey(entry),
    chain,
    title: entry.main.title,
    items: entry.entries,
    ...entry.total,
    checked: entry.entries.map((item) => item.item.checked).sort().at(-1) ?? chain.checked,
    score: Math.round(entry.score * 1000) / 1000,
  }));
}

/** "Big Mac" or "2 × Original Hähnchenteil Brust". */
export function chainItemLabel(entry: ChainComboItem) {
  return entry.count > 1 ? `${entry.count} × ${entry.item.name}` : entry.item.name;
}

/**
 * The order as search results for the confirm screen, so the person can still
 * change anything before it is logged. Where the chain publishes the serving
 * weight, amounts are real grams. Where it does not, the serving is stored as
 * a 100 g stand-in marked `unitOnly`, and the app shows "1 × 1 Burger" instead
 * of a weight nobody published.
 */
export function chainComboSearchEntries(combo: ChainCombo, sourceLabel: (chain: ChainInfo) => string) {
  return combo.items.map(({ item, count }): { result: FoodSearchResult; grams: number } => {
    const serving = item.servingG && item.servingG >= 1 ? item.servingG : null;
    const unitGrams = serving ?? 100;
    const per = 100 / unitGrams;
    return {
      grams: Math.round(unitGrams * count * 10) / 10,
      result: {
        id: `chain-${item.id}`,
        name: `${combo.chain.name} ${item.name}`.slice(0, 160),
        per100g: {
          calories: item.kcal * per,
          protein: item.protein * per,
          carbs: item.carbs * per,
          fat: item.fat * per,
          ...(item.fiber === undefined ? {} : { fiber: item.fiber * per }),
        },
        defaultGrams: unitGrams,
        portions: [{ label: item.servingLabel, grams: unitGrams, ...(serving ? {} : { unitOnly: true }) }],
        source: { provider: 'kandro-catalog', referenceId: `chain:${item.id}`, label: sourceLabel(combo.chain) },
        productName: item.name,
        brand: combo.chain.name,
      },
    };
  });
}
