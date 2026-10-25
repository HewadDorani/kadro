import dietaryTerms from '@/data/dietaryTerms.json';
import ingredientDiet from '@/data/ingredientDiet.json';
import recipeStore from '@/data/recipes.json';
import catalogDe from '@/data/mealCatalog.de.json';
import catalogEn from '@/data/mealCatalog.en.json';
import { getDictionary, getLanguage } from '@/i18n/active';
import { meetsDiet, preferenceBonus } from '@/services/preferences';
import { MealContext, MealSuggestion, Nutrition } from '@/types/nutrition';
import { scaleSuggestedNutrition, suggestionBudget, suggestionCalorieTarget } from '@/utils/mealSuggestions';

type CatalogEntry = Omit<MealSuggestion, 'contexts' | 'preferences' | 'source'> & {
  context: MealContext;
  tags: string[];
};

/**
 * The dietary words live in a shared file because both catalogues describe the
 * same 200 meals and must filter identically. A German-only word list silently
 * stopped excluding pork and dairy the moment the app also spoke English.
 */
const recipes = recipeStore as Record<string, { ingredients: { key: string; grams: number }[] }>;
const porkWords = new RegExp(dietaryTerms.pork.join('|'), 'i');
const lactoseWords = new RegExp(dietaryTerms.lactose.join('|'), 'i');
/** "without cheese" names an absence; matching it would hide a safe meal. */
const negated = /\b(?:ohne|without|no)\s+\S+/gi;

const diet = ingredientDiet as {
  diet: { meat: string[]; fish: string[]; vegetarian: string[]; vegan: string[] };
  lactose: string[];
  pork: string[];
};
const lactoseIngredients = new Set(diet.lactose);
const porkIngredients = new Set(diet.pork);
const meatIngredients = new Set([...diet.diet.meat, ...diet.diet.fish]);
const veganIngredients = new Set(diet.diet.vegan);

/**
 * The ingredient list, when there is one, beats the description.
 *
 * Reading the prose was all there was before recipes existed, and it let four
 * dishes through whose descriptions never mentioned the yoghurt, parmesan or
 * cream cheese their recipes contain: a lactose-free reader was offered all
 * four. Where a recipe exists it is what the person will actually cook, so it
 * is what gets checked; the prose stays the answer for bought food.
 *
 * The result is the dish's diet tags in the shared vocabulary of
 * services/preferences.ts, which Supermarkt and Unterwegs use as well.
 */
export function catalogDietTags(entry: Pick<CatalogEntry, 'id' | 'title' | 'detail' | 'tags'>): string[] {
  const recipe = recipes[entry.id];
  const tags: string[] = [];
  if (recipe) {
    const keys = recipe.ingredients.map((item) => item.key);
    if (keys.every((key) => veganIngredients.has(key))) tags.push('vegan');
    if (!keys.some((key) => meatIngredients.has(key))) tags.push('vegetarian');
    if (!keys.some((key) => porkIngredients.has(key))) tags.push('pork-free');
    if (!keys.some((key) => lactoseIngredients.has(key))) tags.push('lactose-free');
    return tags;
  }
  const copy = `${entry.title} ${entry.detail}`.replace(negated, ' ');
  // Bought food: the editorial tag is the only vegan/vegetarian evidence.
  if (entry.tags.includes('vegan')) tags.push('vegan');
  if (entry.tags.includes('vegan') || entry.tags.includes('vegetarian')) tags.push('vegetarian');
  if (!porkWords.test(copy)) tags.push('pork-free');
  if (!lactoseWords.test(copy)) tags.push('lactose-free');
  return tags;
}

function matchesDietaryConstraints(entry: CatalogEntry, preferences: string[]) {
  return meetsDiet(catalogDietTags(entry), preferences);
}

function score(entry: CatalogEntry, remaining: Nutrition, preferences: string[]) {
  const calorieTarget = suggestionCalorieTarget(remaining.calories);
  const proteinTarget = Math.min(45, Math.max(28, remaining.protein * 0.48));
  const macroDistance = Math.abs(entry.calories - calorieTarget) / 80
    + Math.abs(entry.protein - proteinTarget) / 12
    + Math.max(0, entry.fat - remaining.fat * 0.35) / 10;
  // Shared weights (services/preferences.ts): protein from the offered
  // portion, low carb from its energy split, 'quick' from the tag rather than
  // the localised time string, which only ever matched German.
  return macroDistance - preferenceBonus(entry, entry.tags, preferences);
}

// Main protein source, read from the German catalogue (stable across languages).
const PROTEIN_SOURCES = /(puten|truthahn|hähnchen|huhn|rind|kalb|schwein|lachs|thunfisch|kabeljau|seelachs|garnele|fisch|tofu|tempeh|seitan|linsen|kichererbse|bohnen|halloumi|feta|mozzarella|quark|skyr|hüttenkäse|joghurt|eier|ei\b)/i;
const proteinKeyById = new Map((catalogDe as CatalogEntry[]).map((entry) => [entry.id, (`${entry.title} ${entry.detail}`.match(PROTEIN_SOURCES)?.[1] ?? entry.id).toLowerCase()]));

/**
 * Three ideas should be three different choices. Greedily take the best match,
 * then let a dish built on an already chosen protein compete with a penalty,
 * so "Puten-Chili, Puten-Taler, Puten-Paprika" becomes turkey, fish, lentils
 * whenever comparable alternatives exist. Order and nutrition stay deterministic.
 */
function pickVaried<T extends { entry: CatalogEntry; score: number }>(ranked: T[], count = 3) {
  const chosen: T[] = [];
  const pool = [...ranked];
  while (chosen.length < count && pool.length) {
    const used = new Set(chosen.map((item) => proteinKeyById.get(item.entry.id)));
    let bestIndex = 0;
    let best = Infinity;
    pool.forEach((item, index) => {
      const adjusted = item.score + (used.has(proteinKeyById.get(item.entry.id)) ? 2.5 : 0);
      if (adjusted < best) { best = adjusted; bestIndex = index; }
    });
    chosen.push(pool.splice(bestIndex, 1)[0]);
  }
  return chosen;
}

/** The dish name in the reader's language, for screens that only have an id. */
export function recipeTitle(mealId: string) {
  const catalog = getLanguage() === 'de' ? catalogDe : catalogEn;
  return (catalog as CatalogEntry[]).find((entry) => entry.id === mealId)?.title ?? '';
}

export function recommendMeals(
  context: MealContext,
  remaining: Nutrition,
  preferences: string[] = [],
): MealSuggestion[] {
  const catalog = (getLanguage() === 'de' ? catalogDe : catalogEn) as CatalogEntry[];
  const ranked = catalog
    .filter((entry) => entry.context === context)
    .filter((entry) => matchesDietaryConstraints(entry, preferences))
    .map((entry) => {
      const portionScale = Math.min(1, suggestionBudget(remaining.calories) / entry.calories);
      const referenceNutrition: Nutrition = {
        calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat, fiber: entry.fiber,
      };
      return { ...entry, ...scaleSuggestedNutrition(referenceNutrition, portionScale), portionScale, referenceNutrition };
    })
    .map((entry) => ({ entry, score: score(entry, remaining, preferences) }))
    .sort((a, b) => a.score - b.score || a.entry.id.localeCompare(b.entry.id));
  return pickVaried(ranked)
    .map(({ entry }) => ({
      ...entry,
      contexts: [entry.context],
      preferences: entry.tags,
      // These are hand-built typical values, not sourced measurements. Calling
      // them "geprüft" claimed a provenance the catalog does not have.
      source: { provider: 'kandro-catalog', label: getDictionary().errors.catalogSourceLabel },
    }));
}

// Before a context is selected, preview the actual available suggestions,
// including their scaled portions, rather than promising a fixed macro range.
export function recommendationPreview(remaining: Nutrition, preferences: string[] = []) {
  const suggestions = (['home', 'supermarket', 'eating-out'] as const)
    .flatMap((context) => recommendMeals(context, remaining, preferences));
  const range = (key: 'calories' | 'protein'): [number, number] => {
    const values = suggestions.map((suggestion) => suggestion[key]);
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  };
  return { calories: range('calories'), protein: range('protein') };
}
