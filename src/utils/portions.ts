import type { MealItem, Nutrition } from '@/types/nutrition';

export function itemNutritionPer100g(item: MealItem): Nutrition {
  if (item.nutritionPer100g) return item.nutritionPer100g;
  const factor = item.amountG > 0 ? 100 / item.amountG : 0;
  return { calories: item.calories * factor, protein: item.protein * factor, carbs: item.carbs * factor, fat: item.fat * factor, fiber: (item.fiber ?? 0) * factor };
}

/**
 * `unitOnly`: the source publishes values per serving but no weight (most
 * restaurant chains); `grams` is then a 100 g stand-in for one serving and is
 * never shown as a weight.
 */
export type FoodPortion = { label: string; grams: number; estimated?: boolean; unitOnly?: boolean };

/**
 * A serving-only amount ("2 × 1 Burger") for items whose source publishes no
 * weight, or null when the item has real grams.
 */
export function servingOnlyAmount(item: { amountG: number; portions?: FoodPortion[] }): { count: number; label: string } | null {
  const portion = item.portions?.find((entry) => entry.unitOnly && entry.grams > 0);
  if (!portion) return null;
  return { count: Math.round((item.amountG / portion.grams) * 10) / 10, label: portion.label };
}

/** "250 g", or "1 Burger" / "2 × 1 Burger" when the source publishes no weight. */
export function formatItemAmount(item: { amountG: number; portions?: FoodPortion[] }, locale: string) {
  const serving = servingOnlyAmount(item);
  // Same output as utils/format formatNumber, without its UI imports.
  const number = (value: number) => { try { return value.toLocaleString(locale); } catch { return String(value); } };
  if (!serving) return `${number(item.amountG)} g`;
  return serving.count === 1 ? serving.label : `${number(serving.count)} × ${serving.label}`;
}

/** Wider than any real meal, narrow enough to catch a typed "1000000". */
export const MIN_PORTION_G = 1;
export const MAX_PORTION_G = 5000;

/**
 * Turn what the user typed into grams.
 *
 * German keyboards produce "1,5" and English ones "1.5" for the same half
 * portion, so both are accepted. A count is multiplied by the chosen portion
 * weight; with no portion chosen the number already is grams.
 */
export function resolveGrams(input: string, portion?: FoodPortion): number | null {
  const normalized = String(input).trim().replace(',', '.');
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const grams = Math.round((portion ? parsed * portion.grams : parsed) * 10) / 10;
  if (grams < MIN_PORTION_G || grams > MAX_PORTION_G) return null;
  return grams;
}

/** Per-100 g reference values scaled to an actual amount. */
export function scaleNutrition(per100g: Nutrition, grams: number): Nutrition {
  const scale = grams / 100;
  return {
    calories: Math.round(per100g.calories * scale),
    protein: Math.round(per100g.protein * scale),
    carbs: Math.round(per100g.carbs * scale),
    fat: Math.round(per100g.fat * scale),
    ...(per100g.fiber === undefined ? {} : {fiber: Math.round(per100g.fiber * scale)}),
  };
}

/**
 * Where the sheet should open.
 *
 * Two different situations, and treating them the same broke one of them
 * each way round. Picking a food from search opens on its friendliest unit :
 * "1 banana", not the database's generic 100 g. Re-opening an amount someone
 * already set has to show that amount: it reset to "1 × 1 banana", so a person
 * checking their 252 g was shown 126 g and had to set it again.
 */
export function initialSelection(
  grams: number,
  portions: FoodPortion[] = [],
  { chosen = false }: { chosen?: boolean } = {},
): { unitIndex: number; amount: string } {
  const amount = Math.round(grams * 10) / 10;
  if (!chosen) return portions.length ? { unitIndex: 0, amount: '1' } : { unitIndex: -1, amount: String(amount > 0 ? amount : 100) };
  if (!Number.isFinite(amount) || amount < MIN_PORTION_G) return { unitIndex: -1, amount: '100' };
  for (const [index, portion] of portions.entries()) {
    if (!portion.grams) continue;
    const count = amount / portion.grams;
    // Half steps only: 1.5 bananas is a portion, 1.37 is arithmetic.
    if (count >= 0.5 && count <= 99 && Math.abs(amount - Math.round(count * 2) / 2 * portion.grams) < 0.05) {
      return { unitIndex: index, amount: String(Math.round(count * 2) / 2) };
    }
  }
  return { unitIndex: -1, amount: String(amount) };
}
