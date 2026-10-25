#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
let language = 'de';
const cache = new Map();
// Execute the shipped modules and their actual data, rather than restating the
// recommender in this test. Only locale/time rendering is replaced here.
function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (path.endsWith('.json')) return JSON.parse(read(path));
  const module = { exports: {} };
  cache.set(path, module.exports);
  const require = (id) => {
    if (id === '@/i18n/active') return { getLanguage: () => language, getDictionary: () => load(`src/i18n/${language}.ts`)[language] };
    if (id === '@/utils/format') return { formatClockTime: () => '12:00' };
    assert.ok(id.startsWith('@/'), `Unexpected dependency: ${id}`);
    return load(`src/${id.slice(2)}${id.endsWith('.json') ? '' : '.ts'}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
const { recommendMeals, recommendationPreview } = load('src/services/recommendations.ts');
const { getRecipe } = load('src/services/recipes.ts');
const { createPlannedMeal } = load('src/services/mockNutrition.ts');
const { suggestedNutrition, recipePortion } = load('src/utils/mealSuggestions.ts');
const catalogs = JSON.parse(read('src/data/mealCatalog.de.json'));
const recipes = JSON.parse(read('src/data/recipes.json'));
const macros = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
const before = JSON.stringify(catalogs);
let checked = 0;
for (language of ['de', 'en']) {
  for (const calories of [-100, 0, 20, 149, 150, 199, 200, 201, 300, 450, 800, 1600]) {
    const remaining = { calories, protein: 20, carbs: 15, fat: 8 };
    for (const context of ['home', 'supermarket', 'eating-out']) {
      for (const preferences of [[], ['vegan'], ['vegetarian', 'lactose-free'], ['pork-free', 'high-protein']]) {
        const suggestions = recommendMeals(context, remaining, preferences);
        assert.equal(suggestions.length, 3, `${context}/${calories}/${preferences}: three usable choices`);
        assert.equal(new Set(suggestions.map(s => s.id)).size, 3);
        for (const suggestion of suggestions) {
          assert.ok(suggestion.calories <= Math.max(200, calories), `Default serving exceeds available budget: ${calories} / ${suggestion.calories}`);
          if (calories <= 200) assert.equal(suggestion.calories, 200, 'Small remainder offers a real 200 kcal portion, never a 20 kcal meal');
          assert.ok(suggestion.portionScale > 0 && suggestion.portionScale <= 1);
          const base = catalogs.find(s => s.id === suggestion.id);
          for (const portion of [0.7, 1, 1.4]) {
            const preview = suggestedNutrition(suggestion, portion);
            const logged = createPlannedMeal(suggestion, portion, 'test-meal');
            for (const key of macros) {
              const expected = Math.round((base[key] ?? 0) * (suggestion.portionScale * portion));
              assert.equal(preview[key], expected, `Preview ${key} uses original reference`);
              assert.equal(logged[key], expected, `Logged ${key} matches preview`);
            }
            if (context === 'home') {
              const recipe = getRecipe(suggestion.id, suggestion.portionScale * portion);
              for (const key of macros) assert.equal(recipe.nutrition[key], preview[key], 'Recipe and displayed/logged nutrients agree');
              recipe.ingredients.forEach((item, index) => {
                assert.ok(Math.abs(item.grams - recipes[suggestion.id].ingredients[index].grams * suggestion.portionScale * portion) <= 0.051);
              });
            }
            checked++;
          }
          // Keep the overage truthful even if the user has already gone over.
          if (calories === 20) assert.equal(suggestion.calories - calories, 180);
          if (calories === -100) assert.equal(suggestion.calories - calories, 300);
        }
      }
    }
    for (const preferences of [[], ['vegan']]) {
      const summary = recommendationPreview(remaining, preferences);
      const options = ['home', 'supermarket', 'eating-out'].flatMap(context => recommendMeals(context, remaining, preferences));
      for (const key of ['calories', 'protein']) {
        assert.deepEqual(summary[key], [Math.min(...options.map(s => s[key])), Math.max(...options.map(s => s[key]))], 'Dashboard preview describes actual available portions');
      }
      assert.ok(summary.calories[1] <= Math.max(200, calories));
    }
  }
}
assert.equal(JSON.stringify(JSON.parse(read('src/data/mealCatalog.de.json'))), before, 'No catalogue mutation');
for (const value of ['', 'oops', -1, 0, 99, Number.NaN, ['0.5']]) assert.equal(recipePortion(value), 1);
assert.equal(recipePortion('0.5'), 0.5);
language = 'en';
assert.ok(getRecipe('home-24', 0.5).steps.some(s => s.includes('200 ml') && s.includes('12 minutes')), 'Cooking liquid scales, cooking time does not');
language = 'de';
assert.ok(getRecipe('home-06', 0.5).steps.some(s => s.includes('1,5 EL')), 'German recipe quantities retain decimal comma');
assert.ok(getRecipe('home-24', 0.5).steps.some(s => s.includes('200 ml') && s.includes('12 Minuten')));
assert.equal(getRecipe('not-a-recipe', 0.5), null);

const plan = read('src/app/(tabs)/plan.tsx');
assert.match(plan, /availableCalories = targets.calories - consumed.calories/, 'Overage uses unclamped remaining calories');
assert.match(read('src/components/PlanOptionCard.tsx'), /t\.plan\.afterOver/, 'Option cards disclose an overage');
assert.match(plan, /availableCalories,\n\s*calories: nutrition\.calories/, 'The after-meal line uses the chosen portion against unclamped calories');
assert.match(plan, /suggestedNutrition\(suggestion, relativePortion\)/);
assert.match(plan, /portion=\$\{recipeScale\}/, 'Recipe receives the actual chosen portion');
assert.match(read('src/app/recipe.tsx'), /getRecipe\(id, portionScale\)/);
const paywall = read('src/app/paywall.tsx');
assert.doesNotMatch(paywall, /t.paywall.benefit[34]/, 'Free plan/history must not be presented as paid benefits');
assert.match(paywall, /t.paywall.freeTitle/);
console.log(`Recommendation budget: ${checked} real preview/recipe/save combinations passed, including 20 → 200 kcal with explicit 180 kcal overage.`);
