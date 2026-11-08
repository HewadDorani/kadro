import type { Meal, Nutrition } from '@/types/nutrition';

export type MealSlot = Meal['type'];

/** Four slots, always all four, in the order a day happens. */
export const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const satisfies readonly MealSlot[];

/**
 * How the day's target is shared between the slots on Heute and the slot
 * page. A guide for one meal, not a rule: the day's remaining budget and the
 * three ideas still come from the whole day.
 */
export const SLOT_SHARE: Record<MealSlot, number> = { Breakfast: 0.25, Lunch: 0.35, Dinner: 0.3, Snack: 0.1 };

export function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === 'string' && (MEAL_SLOTS as readonly string[]).includes(value);
}

/** The slot's share of the day's targets; calories to 10 kcal, macros to 1 g. */
export function slotTarget(slot: MealSlot, targets: Nutrition): Nutrition {
  const share = SLOT_SHARE[slot];
  return {
    calories: Math.round((targets.calories * share) / 10) * 10,
    protein: Math.round(targets.protein * share),
    carbs: Math.round(targets.carbs * share),
    fat: Math.round(targets.fat * share),
  };
}
