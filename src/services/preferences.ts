/**
 * One mapping from the food preferences a person picks (onboarding, and later
 * Du → Plan bearbeiten) to what every Plan situation does with them.
 *
 * Zuhause and Unterwegs (catalogue dishes), Supermarkt (real products) and
 * any later engine (restaurant chains) describe an option with the same
 * vocabulary: diet tags derived from their own data, plus its nutrition.
 * They then ask this module two questions and nothing else:
 *
 *   meetsDiet(tags, preferences)            hard filter, unknown = excluded
 *   preferenceBonus(nutrition, tags, prefs) ranking bonus, higher is better
 *
 * Diet preferences are promises (vegetarian, vegan, no pork, lactose free):
 * an option is offered only when its data says it complies. Missing data is
 * never read as "probably fine". Goal preferences (high protein, low carb,
 * quick) only move options up; they never hide one.
 *
 * Gluten free is deliberately not offered: none of the three data sets
 * (recipes, catalogue, Open Food Facts snapshot) carries gluten information,
 * and a strict filter on unknown data would leave nothing to suggest.
 */
import type { Nutrition } from '@/types/nutrition';

export const PREFERENCE_IDS = ['high-protein', 'low-carb', 'vegetarian', 'vegan', 'pork-free', 'lactose-free', 'quick'] as const;
export type PreferenceId = (typeof PREFERENCE_IDS)[number];

/** Hard filters. An option must carry the tag (or one that implies it). */
export const DIET_PREFERENCES = ['vegan', 'vegetarian', 'pork-free', 'lactose-free'] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number];

/** Ranking only. */
export const SCORE_PREFERENCES = ['high-protein', 'low-carb', 'quick'] as const;

/** A vegan option is also vegetarian, pork free and lactose free. */
const IMPLIED: Partial<Record<string, DietPreference[]>> = {
  vegan: ['vegetarian', 'pork-free', 'lactose-free'],
  vegetarian: ['pork-free'],
};

/** The preferences Kandro knows, in a stable order, without duplicates. */
export function knownPreferences(preferences: readonly string[] = []): PreferenceId[] {
  return PREFERENCE_IDS.filter((id) => preferences.includes(id));
}

export function dietRequirements(preferences: readonly string[] = []): DietPreference[] {
  return DIET_PREFERENCES.filter((id) => preferences.includes(id));
}

/** Every diet tag an option's own tags establish, including the implied ones. */
export function dietTags(tags: readonly string[]): Set<string> {
  const set = new Set(tags);
  for (const tag of tags) for (const implied of IMPLIED[tag] ?? []) set.add(implied);
  return set;
}

/** Hard filter shared by every situation: all chosen diet preferences must be established by data. */
export function meetsDiet(tags: readonly string[], preferences: readonly string[] = []): boolean {
  const required = dietRequirements(preferences);
  if (!required.length) return true;
  const established = dietTags(tags);
  return required.every((preference) => established.has(preference));
}

/**
 * Ranking bonus in the engines' score units (an engine subtracts it from a
 * distance, so higher is better). The same weights everywhere, so "high
 * protein" means the same thing at home, in the supermarket and on the go.
 */
export function preferenceBonus(
  option: Pick<Nutrition, 'calories' | 'protein' | 'carbs'>,
  tags: readonly string[],
  preferences: readonly string[] = [],
): number {
  let bonus = 0;
  if (preferences.includes('high-protein')) bonus += Math.min(Math.max(0, option.protein), 60) / 8;
  if (preferences.includes('low-carb') && option.calories > 0) {
    // Share of energy from carbohydrate: 45 % and above earns nothing, a
    // carb-free option earns up to 3.6.
    const carbShare = Math.max(0, option.carbs) * 4 / option.calories;
    bonus += Math.max(0, 0.45 - carbShare) * 8;
  }
  if (preferences.includes('quick') && tags.includes('quick')) bonus += 1.5;
  return bonus;
}
