import type { FoodSearchResult } from '@/services/mealAnalysis';
import type { Nutrition } from '@/types/nutrition';

export type MenuDish = { name: string; grams: number; calories: number; protein: number; carbs: number; fat: number; vegetarian: boolean; vegan: boolean };
export type MenuPick = MenuDish & { fits: boolean; left: number };

/** Below this share of what is left, a dish is a snack, not the meal someone is deciding on. */
const MIN_SHARE = 0.35;

/**
 * The three dishes of a photographed menu that suit what is left of the day.
 * Dishes that fit come first, those filling the budget with the most protein
 * ahead. When nothing fits, the smallest ones are shown and marked as over.
 * Pure and deterministic; ties break on the name.
 */
export function menuPicks(dishes: readonly MenuDish[], remaining: Pick<Nutrition, 'calories' | 'protein'>, preferences: readonly string[] = []): MenuPick[] {
  const vegan = preferences.includes('vegan');
  const vegetarian = vegan || preferences.includes('vegetarian');
  const allowed = dishes.filter((dish) => (vegan ? dish.vegan : vegetarian ? dish.vegetarian : true));
  const budget = Math.max(0, remaining.calories);
  const score = (dish: MenuDish) => {
    const proteinShare = remaining.protein > 0 ? Math.min(1, dish.protein / remaining.protein) : 0;
    return proteinShare * 2 + Math.min(1, dish.calories / Math.max(1, budget));
  };
  const ranked = [...allowed].sort((a, b) => {
    const fitA = a.calories <= budget ? 1 : 0;
    const fitB = b.calories <= budget ? 1 : 0;
    if (fitA !== fitB) return fitB - fitA;
    if (!fitA) return a.calories - b.calories || a.name.localeCompare(b.name);
    const fullA = a.calories >= budget * MIN_SHARE ? 1 : 0;
    const fullB = b.calories >= budget * MIN_SHARE ? 1 : 0;
    return fullB - fullA || score(b) - score(a) || a.name.localeCompare(b.name);
  });
  return ranked.slice(0, 3).map((dish) => ({ ...dish, fits: dish.calories <= budget, left: budget - dish.calories }));
}

/** A picked dish as a food: an estimate, so the confirm screen can still change everything. */
export function menuDishFood(dish: MenuDish, estimateLabel: string): FoodSearchResult {
  const factor = 100 / dish.grams;
  return {
    id: `menu-${dish.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    name: dish.name,
    per100g: { calories: dish.calories * factor, protein: dish.protein * factor, carbs: dish.carbs * factor, fat: dish.fat * factor },
    defaultGrams: dish.grams,
    portions: [{ label: estimateLabel, grams: dish.grams, estimated: true }],
    source: { provider: 'kandro-catalog', referenceId: 'ai-estimate', label: 'Kandro AI estimate', estimatedReference: true },
  };
}
