import type { MealSuggestion, Nutrition } from '@/types/nutrition';

// A tiny remainder is not a reason to suggest a 20 kcal "meal". Offer a
// practical small portion instead; the UI must disclose any target overage.
export const SMALL_MEAL_CALORIES = 200;

export function suggestionBudget(remainingCalories: number) {
  return Math.max(SMALL_MEAL_CALORIES, Number.isFinite(remainingCalories) ? remainingCalories : 0);
}

export function suggestionCalorieTarget(remainingCalories: number) {
  const budget = suggestionBudget(remainingCalories);
  const remaining = Number.isFinite(remainingCalories) ? Math.max(0, remainingCalories) : 0;
  return Math.min(budget, 550, Math.max(380, remaining * 0.38));
}

export function scaleSuggestedNutrition(nutrition: Nutrition, factor: number): Nutrition {
  return {
    calories: Math.round(nutrition.calories * factor),
    protein: Math.round(nutrition.protein * factor),
    carbs: Math.round(nutrition.carbs * factor),
    fat: Math.round(nutrition.fat * factor),
    fiber: Math.round((nutrition.fiber ?? 0) * factor),
  };
}

// Always scale the original catalogue values, including when the user changes
// the proposed portion. This keeps recipe, preview and saved meal identical.
export function suggestedNutrition(suggestion: MealSuggestion, relativePortion = 1): Nutrition {
  return scaleSuggestedNutrition(suggestion.referenceNutrition ?? suggestion, (suggestion.portionScale ?? 1) * relativePortion);
}

export function recipePortion(value: unknown) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0.1 && number <= 2 ? number : 1;
}

export type OptionFit = 'exact' | 'protein' | 'light';

/**
 * The one-word reason to pick each of the three Plan options, at most once
 * per set, so the badges tell the options apart instead of all saying the
 * same thing (every engine aims at the same target):
 *
 *   "Passt genau"  the option closest to the meal-sized target, within 15 %
 *   "Proteinreich" of the rest, the highest protein share, at least 25 % of energy
 *   "Leicht"       of the rest, the smallest, under 85 % of the target
 *
 * An option above what is left gets no badge; its after-meal line says so.
 */
export function optionFits(options: Pick<Nutrition, 'calories' | 'protein'>[], remainingCalories: number): (OptionFit | null)[] {
  const left = Number.isFinite(remainingCalories) ? Math.max(0, remainingCalories) : 0;
  const target = suggestionCalorieTarget(remainingCalories);
  const fits: (OptionFit | null)[] = options.map(() => null);
  const open = () => options
    .map((option, index) => ({ option, index }))
    .filter(({ option, index }) => !fits[index] && option.calories > 0 && option.calories <= left);
  const best = (candidates: ReturnType<typeof open>, key: (option: Pick<Nutrition, 'calories' | 'protein'>) => number) => candidates
    .reduce<ReturnType<typeof open>[number] | null>((winner, entry) => (!winner || key(entry.option) < key(winner.option) ? entry : winner), null);

  const exact = best(open().filter(({ option }) => Math.abs(option.calories - target) <= target * 0.15), (option) => Math.abs(option.calories - target));
  if (exact) fits[exact.index] = 'exact';
  const share = (option: Pick<Nutrition, 'calories' | 'protein'>) => (option.protein * 4) / option.calories;
  const protein = best(open().filter(({ option }) => share(option) >= 0.25), (option) => -share(option));
  if (protein) fits[protein.index] = 'protein';
  const light = best(open().filter(({ option }) => option.calories < target * 0.85), (option) => option.calories);
  if (light) fits[light.index] = 'light';
  return fits;
}
