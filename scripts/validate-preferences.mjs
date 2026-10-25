#!/usr/bin/env node
/**
 * A dietary preference is a promise, and the recipes broke it.
 *
 * Filtering read the dish description, which four dishes did not mention the
 * yoghurt, parmesan or cream cheese their recipes contained — a lactose-free
 * reader was offered all four, and a bowl labelled vegan, whose description
 * says "vegan dip", used yoghurt. So: the ingredient list decides, and every
 * tag, description and ingredient list has to agree with the other two.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import ts from 'typescript';

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const recipes = read('recipes.json');
const ingredients = read('ingredients.json');
const names = read('ingredientNames.json');
const diet = read('ingredientDiet.json');
const terms = read('dietaryTerms.json');
const catalogs = { de: read('mealCatalog.de.json'), en: read('mealCatalog.en.json') };

const problems = [];
const classes = ['meat', 'fish', 'vegetarian', 'vegan'];

// --- Every ingredient is classified, exactly once ---------------------------
const seen = new Map();
for (const name of classes) {
  for (const key of diet.diet[name]) {
    if (seen.has(key)) problems.push(`${key}: classified as both ${seen.get(key)} and ${name}`);
    seen.set(key, name);
    if (!ingredients[key]) problems.push(`${key}: classified but not a sourced ingredient`);
  }
}
for (const key of Object.keys(ingredients)) {
  if (!seen.has(key)) problems.push(`${key}: not classified, so no preference can be honoured for it`);
}
for (const key of [...diet.lactose, ...diet.pork]) {
  if (!ingredients[key]) problems.push(`${key}: listed as lactose or pork but not a sourced ingredient`);
}
// Nothing vegan may be lactose-bearing, and vice versa.
for (const key of diet.lactose) {
  if (seen.get(key) === 'vegan') problems.push(`${key}: called vegan and lactose-bearing at once`);
}
// An ingredient that reads like pork must be declared as pork; otherwise a
// bacon entry added later would pass the pork-free filter in silence.
const porkWords = new RegExp(terms.pork.join('|'), 'i');
for (const [key, record] of Object.entries(ingredients)) {
  const looksLikePork = porkWords.test(`${key} ${record.name} ${names[key]?.de ?? ''} ${names[key]?.en ?? ''}`);
  if (looksLikePork && !diet.pork.includes(key)) {
    problems.push(`${key}: reads like pork but is not on the pork list`);
  }
}

// --- Tag, description and ingredients say the same thing --------------------
const negated = /\b(?:ohne|without|no)\s+\S+/gi;
const lactoseWords = new RegExp(terms.lactose.join('|'), 'i');

for (const meal of catalogs.de.filter((entry) => entry.context === 'home')) {
  const recipe = recipes[meal.id];
  if (!recipe) continue;
  const keys = recipe.ingredients.map((item) => item.key);
  const has = (name) => keys.some((key) => seen.get(key) === name);
  const tag = meal.tags[0];

  if (tag === 'vegan' && (has('meat') || has('fish') || has('vegetarian'))) {
    problems.push(`${meal.id}: tagged vegan but cooks with ${keys.filter((key) => seen.get(key) !== 'vegan').join(', ')}`);
  }
  if (tag === 'vegetarian' && (has('meat') || has('fish'))) {
    problems.push(`${meal.id}: tagged vegetarian but cooks with ${keys.filter((key) => ['meat', 'fish'].includes(seen.get(key))).join(', ')}`);
  }
  if (tag === 'pescetarian' && has('meat')) {
    problems.push(`${meal.id}: tagged pescetarian but cooks with ${keys.filter((key) => seen.get(key) === 'meat').join(', ')}`);
  }

  // Dairy in the pan must be dairy in the description: someone scanning the
  // list decides from the line under the title.
  const dairy = keys.filter((key) => diet.lactose.includes(key));
  for (const [language, catalog] of Object.entries(catalogs)) {
    const entry = catalog.find((item) => item.id === meal.id);
    const copy = `${entry.title} ${entry.detail}`.replace(negated, ' ');
    if (dairy.length && !lactoseWords.test(copy)) {
      problems.push(`${meal.id} (${language}): "${entry.detail}" never mentions the ${dairy.join(', ')} in the recipe`);
    }
  }
}

// --- The filter actually uses the ingredients -------------------------------
const service = readFileSync(new URL('../src/services/recommendations.ts', import.meta.url), 'utf8');
const preferencesModule = readFileSync(new URL('../src/services/preferences.ts', import.meta.url), 'utf8');
const filter = service.slice(service.indexOf('export function catalogDietTags'), service.indexOf('function score('));
assert.match(filter, /const recipe = recipes\[entry\.id\];/, 'the filter no longer looks at the recipe');
assert.match(filter, /return meetsDiet\(catalogDietTags\(entry\), preferences\)/, 'the catalogue filter bypasses the shared preference mapping');
if (!/keys\.every\(\(key\) => veganIngredients\.has\(key\)\)\) tags\.push\('vegan'\)/.test(filter)) {
  problems.push('recommendations.ts: vegan is not established from every recipe ingredient');
}
for (const [preference, set] of [['vegetarian', 'meatIngredients'], ['pork-free', 'porkIngredients'], ['lactose-free', 'lactoseIngredients']]) {
  const pattern = new RegExp(`!keys\\.some\\(\\(key\\) => ${set}\\.has\\(key\\)\\)\\) tags\\.push\\('${preference}'\\)`);
  if (!pattern.test(filter)) problems.push(`recommendations.ts: ${preference} is not established from the ingredient list`);
}

// --- The shipped recommender, actually run ---------------------------------
/**
 * Every check above reads files. This one runs the real recommendMeals over
 * every preference combination, because nothing did before — the ranking was
 * reimplemented in the catalogue check, so the code that actually decides what
 * a vegetarian is offered had never been executed by a test.
 */
const portionHelpers = readFileSync(new URL('../src/utils/mealSuggestions.ts', import.meta.url), 'utf8').replace(/^import[^;]+;$/gm, '');
const module = portionHelpers + preferencesModule.replace(/^import[^;]+;$/gm, '') + service
  .replace(/^import[^;]+;$/gm, '')
  .replace(
    'type CatalogEntry',
    [
      "const getDictionary = () => ({ errors: { catalogSourceLabel: 'catalogue' } });",
      "const getLanguage = () => 'de';",
      'type CatalogEntry',
    ].join('\n'),
  );
const { outputText } = ts.transpileModule(
  `const dietaryTerms = ${JSON.stringify(terms)};\n`
  + `const ingredientDiet = ${JSON.stringify(diet)};\n`
  + `const recipeStore = ${JSON.stringify(recipes)};\n`
  + `const catalogDe = ${JSON.stringify(catalogs.de)};\n`
  + `const catalogEn = ${JSON.stringify(catalogs.en)};\n`
  + module,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
);
const { recommendMeals } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`);

/** The same module again, answering as an English reader. */
const englishText = ts.transpileModule(
  `const dietaryTerms = ${JSON.stringify(terms)};\n`
  + `const ingredientDiet = ${JSON.stringify(diet)};\n`
  + `const recipeStore = ${JSON.stringify(recipes)};\n`
  + `const catalogDe = ${JSON.stringify(catalogs.de)};\n`
  + `const catalogEn = ${JSON.stringify(catalogs.en)};\n`
  + module.replace("const getLanguage = () => 'de';", "const getLanguage = () => 'en';"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const english = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(englishText)}`);

const byId = Object.fromEntries(catalogs.de.map((meal) => [meal.id, meal]));
const forbidden = {
  vegan: (meal) => {
    const recipe = recipes[meal.id];
    if (recipe) return recipe.ingredients.some(({ key }) => seen.get(key) !== 'vegan');
    return !meal.tags.includes('vegan');
  },
  vegetarian: (meal) => {
    const recipe = recipes[meal.id];
    if (recipe) return recipe.ingredients.some(({ key }) => ['meat', 'fish'].includes(seen.get(key)));
    return !meal.tags.some((tag) => tag === 'vegetarian' || tag === 'vegan');
  },
  'lactose-free': (meal) => {
    const recipe = recipes[meal.id];
    const copy = `${meal.title} ${meal.detail}`.replace(negated, ' ');
    return recipe
      ? recipe.ingredients.some(({ key }) => diet.lactose.includes(key))
      : lactoseWords.test(copy);
  },
  'pork-free': (meal) => {
    const recipe = recipes[meal.id];
    const copy = `${meal.title} ${meal.detail}`.replace(negated, ' ');
    return recipe
      ? recipe.ingredients.some(({ key }) => diet.pork.includes(key))
      : porkWords.test(copy);
  },
};

const combinations = [
  [], ['vegan'], ['vegetarian'], ['lactose-free'], ['pork-free'], ['high-protein'], ['quick'], ['low-carb'],
  ['vegan', 'low-carb'], ['vegetarian', 'lactose-free', 'low-carb', 'high-protein'],
  ['vegan', 'quick'], ['vegan', 'high-protein'],
  ['vegetarian', 'lactose-free'], ['vegetarian', 'pork-free'], ['lactose-free', 'pork-free'],
  ['vegetarian', 'lactose-free', 'pork-free'], ['vegetarian', 'lactose-free', 'quick', 'high-protein'],
];
let checked = 0;
let empty = 0;
for (const context of ['home', 'supermarket', 'eating-out']) {
  for (const calories of [2400, 1800, 1200, 800, 500, 300]) {
    for (const preferences of combinations) {
      const remaining = { calories, protein: Math.round(calories * 0.09), carbs: Math.round(calories * 0.11), fat: Math.round(calories * 0.03) };
      const suggestions = recommendMeals(context, remaining, preferences);
      if (!suggestions.length) empty += 1;
      for (const suggestion of suggestions) {
        checked += 1;
        const meal = byId[suggestion.id];
        for (const preference of preferences) {
          if (forbidden[preference]?.(meal)) {
            problems.push(`recommendMeals(${context}, ${calories} kcal, [${preferences}]) offered "${meal.title}", which breaks ${preference}`);
          }
        }
      }
    }
  }
}
// --- The two languages must answer identically -----------------------------
/**
 * Quickness used to be read out of the localised time string with a
 * German-only word list, so "Ohne Kochen" counted and "No cooking" did not:
 * the same person with the same data was handed different meals depending on
 * their phone's language. Nothing but the words may differ.
 */
let compared = 0;
for (const context of ['home', 'supermarket', 'eating-out']) {
  // A coarse grid proves nothing: a weak bonus can fail to reorder the top
  // three at three sample points and still be language-dependent.
  for (let calories = 400; calories <= 2600; calories += 100) {
    for (const preferences of combinations) {
      compared += 1;
      const remaining = { calories, protein: Math.round(calories * 0.09), carbs: Math.round(calories * 0.11), fat: Math.round(calories * 0.03) };
      const germanIds = recommendMeals(context, remaining, preferences).map((meal) => meal.id);
      const englishIds = english.recommendMeals(context, remaining, preferences).map((meal) => meal.id);
      if (germanIds.join() !== englishIds.join()) {
        problems.push(`${context} / ${calories} kcal / [${preferences}]: German offers ${germanIds}, English offers ${englishIds}`);
      }
    }
  }
}

// --- A preference must visibly change what is offered ----------------------
/**
 * A bonus too small to move the top three is a preference the user chose and
 * the app ignored.
 */
const pick = (preferences, context = 'home') => {
  const ids = [];
  for (const calories of [2000, 1500, 1000, 700]) {
    const remaining = { calories, protein: Math.round(calories * 0.09), carbs: 0, fat: 60 };
    ids.push(...recommendMeals(context, remaining, preferences).map((meal) => meal.id));
  }
  return ids.map((id) => byId[id]);
};
{
  const baseline = pick([]);
  const quick = pick(['quick']);
  const quickShare = (meals) => meals.filter((meal) => meal.tags.includes('quick')).length / meals.length;
  if (quickShare(quick) <= quickShare(baseline)) {
    problems.push(`choosing "quick" did not raise the share of quick meals (${quickShare(baseline)} to ${quickShare(quick)})`);
  }
  if (quickShare(quick) < 0.9) {
    problems.push(`choosing "quick" still leaves ${Math.round((1 - quickShare(quick)) * 100)}% slow meals in the top three`);
  }

  const protein = (meals) => meals.reduce((total, meal) => total + meal.protein, 0) / meals.length;
  const highProtein = pick(['high-protein']);
  if (protein(highProtein) <= protein(baseline) + 1) {
    problems.push(`choosing "high-protein" raised average protein by less than 1 g (${protein(baseline).toFixed(1)} to ${protein(highProtein).toFixed(1)})`);
  }

  // Every context must have something to offer for every preference.
  for (const context of ['home', 'supermarket', 'eating-out']) {
    for (const preference of ['quick', 'high-protein', 'vegetarian', 'vegan']) {
      const offered = pick([preference], context);
      if (!offered.some((meal) => meal.tags.includes(preference))) {
        problems.push(`${context}: choosing "${preference}" offers nothing tagged ${preference}`);
      }
    }
  }
}

// A filter that answers "nothing" is technically safe and practically useless.
if (empty) problems.push(`${empty} preference and context combinations returned no suggestion at all`);
if (checked < 400) problems.push(`only ${checked} suggestions were checked, which is too few to mean anything`);

if (problems.length) {
  console.error('Preference check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Preferences honoured: ${Object.keys(ingredients).length} ingredients classified, ${checked} suggestions from the real recommender broke none of them, and ${compared} German and English answers matched exactly.`);
