#!/usr/bin/env node
/**
 * Plan → "3 Optionen für heute": one preference mapping and one card for
 * every situation.
 *
 * 1. Preferences: Zuhause and Unterwegs (catalogue) and Supermarkt (products)
 *    filter and rank through services/preferences.ts only. Diet choices are
 *    hard filters checked here against the raw data, goal choices visibly move
 *    the ranking, and every combination still yields exactly three options.
 * 2. Cards: all three situations render through components/PlanOptionCard,
 *    whose header leads with kcal and protein, then title and fit badge, then
 *    at most three rows, then fine print and one action.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
let language = 'de';
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (path.endsWith('.json')) return JSON.parse(read(path));
  const module = { exports: {} };
  cache.set(path, module.exports);
  const require = (id) => {
    if (id === '@/i18n/active') return { getLanguage: () => language, getDictionary: () => ({ errors: { catalogSourceLabel: 'catalogue' } }) };
    assert.ok(id.startsWith('@/'), `Unexpected dependency: ${id}`);
    return load(`src/${id.slice(2)}${id.endsWith('.json') ? '' : '.ts'}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const problems = [];
const preferencesModule = load('src/services/preferences.ts');
const { PREFERENCE_IDS, DIET_PREFERENCES, SCORE_PREFERENCES, meetsDiet, preferenceBonus } = preferencesModule;
const { recommendMeals, catalogDietTags } = load('src/services/recommendations.ts');
const { supermarketCombos } = load('src/services/supermarketCombos.ts');
const { optionFits } = load('src/utils/mealSuggestions.ts');

// --- One mapping ------------------------------------------------------------
assert.deepEqual([...DIET_PREFERENCES].sort(), ['lactose-free', 'pork-free', 'vegan', 'vegetarian']);
assert.deepEqual([...SCORE_PREFERENCES].sort(), ['high-protein', 'low-carb', 'quick']);
assert.deepEqual([...PREFERENCE_IDS].sort(), [...DIET_PREFERENCES, ...SCORE_PREFERENCES].sort(), 'every preference is either a filter or a score');
assert.equal(meetsDiet([], ['vegan']), false, 'unknown data never satisfies a diet');
assert.equal(meetsDiet(['vegan'], ['vegetarian', 'lactose-free', 'pork-free']), true, 'vegan implies the other diets');
assert.equal(meetsDiet(['vegetarian'], ['lactose-free']), false, 'vegetarian does not imply lactose free');
assert.equal(meetsDiet([], ['high-protein', 'quick', 'low-carb']), true, 'goal preferences never filter');
assert.ok(preferenceBonus({ calories: 400, protein: 40, carbs: 10 }, [], ['low-carb']) > preferenceBonus({ calories: 400, protein: 40, carbs: 60 }, [], ['low-carb']));
assert.equal(preferenceBonus({ calories: 400, protein: 40, carbs: 10 }, [], []), 0);

for (const [path, label] of [['src/services/recommendations.ts', 'Zuhause/Unterwegs catalogue'], ['src/services/supermarketCombos.ts', 'Supermarkt']]) {
  const source = read(path);
  if (!/import \{[^}]*meetsDiet[^}]*preferenceBonus[^}]*\} from '@\/services\/preferences'/.test(source)) {
    problems.push(`${label}: does not filter and rank through services/preferences.ts`);
  }
  if (/DIET_PREFERENCES\s*=|includes\('high-protein'\)\s*\?\s*Math\.min\(entry/.test(source)) {
    problems.push(`${label}: keeps its own preference list or weights`);
  }
}
const chains = ['src/services/chainCombos.ts', 'src/services/restaurantChains.ts'].filter((path) => existsSync(resolve(root, path)));
for (const path of chains) {
  if (!read(path).includes("from '@/services/preferences'")) problems.push(`${path}: Unterwegs chains must use the shared preference mapping`);
}

// --- Exactly three, and every diet honoured, in all three situations --------
const products = load('src/data/supermarketProducts.json').products;
const catalog = load('src/data/mealCatalog.de.json');
const recipes = load('src/data/recipes.json');
const diet = load('src/data/ingredientDiet.json');
const byId = new Map(catalog.map((entry) => [entry.id, entry]));
const ingredientClass = new Map(Object.entries(diet.diet).flatMap(([name, keys]) => keys.map((key) => [key, name])));
/** Independent of the app's mapping: what the raw data says about a dish. */
function catalogBreaks(entry, preference) {
  const recipe = recipes[entry.id];
  if (recipe) {
    const keys = recipe.ingredients.map((item) => item.key);
    if (preference === 'vegan') return keys.some((key) => ingredientClass.get(key) !== 'vegan');
    if (preference === 'vegetarian') return keys.some((key) => ['meat', 'fish'].includes(ingredientClass.get(key)));
    if (preference === 'lactose-free') return keys.some((key) => diet.lactose.includes(key));
    if (preference === 'pork-free') return keys.some((key) => diet.pork.includes(key));
  }
  const tags = catalogDietTags(entry);
  if (preference === 'vegan') return !entry.tags.includes('vegan');
  if (preference === 'vegetarian') return !entry.tags.some((tag) => tag === 'vegan' || tag === 'vegetarian');
  return !meetsDiet(tags, [preference]);
}
const productBreaks = (product, preference) => {
  const tags = new Set(product.diet);
  if (tags.has('vegan')) return false;
  if (preference === 'pork-free' && tags.has('vegetarian')) return false;
  return !tags.has(preference);
};

const subsets = [];
for (let mask = 0; mask < 16; mask += 1) subsets.push(DIET_PREFERENCES.filter((_, index) => mask & (1 << index)));
let checked = 0;
for (const lang of ['de', 'en']) {
  language = lang;
  for (const goals of [[], ['high-protein'], ['low-carb'], ['quick'], ['high-protein', 'low-carb']]) {
    for (const diets of subsets) {
      const preferences = [...diets, ...goals];
      for (const calories of [2400, 1100, 600, 150, -300]) {
        const remaining = { calories, protein: 70, carbs: 120, fat: 35 };
        for (const context of ['home', 'supermarket', 'eating-out']) {
          const options = recommendMeals(context, remaining, preferences);
          if (options.length !== 3) problems.push(`${lang} ${context} [${preferences}] ${calories} kcal: ${options.length} options instead of 3`);
          for (const option of options) {
            for (const preference of diets) {
              if (catalogBreaks(byId.get(option.id), preference)) problems.push(`${context} [${preferences}]: "${byId.get(option.id).title}" breaks ${preference}`);
            }
          }
          checked += 1;
        }
        if (lang === 'de') {
          const combos = supermarketCombos(remaining, preferences);
          if (combos.length !== 3) problems.push(`Supermarkt [${preferences}] ${calories} kcal: ${combos.length} baskets instead of 3`);
          for (const combo of combos) {
            for (const item of combo.items) {
              for (const preference of diets) {
                if (productBreaks(item.product, preference)) problems.push(`Supermarkt [${preferences}]: ${item.product.name} breaks ${preference}`);
              }
            }
          }
          checked += 1;
        }
      }
    }
  }
}
language = 'de';

// --- Goal preferences move every situation the same way ----------------------
const budgets = [2000, 1500, 1000, 700].map((calories) => ({ calories, protein: 80, carbs: 150, fat: 50 }));
const average = (list, pick) => list.reduce((sum, item) => sum + pick(item), 0) / list.length;
const carbShare = (option) => (option.carbs * 4) / Math.max(1, option.calories);
const situations = {
  Zuhause: (preferences) => budgets.flatMap((remaining) => recommendMeals('home', remaining, preferences)),
  Unterwegs: (preferences) => budgets.flatMap((remaining) => recommendMeals('eating-out', remaining, preferences)),
  Supermarkt: (preferences) => budgets.flatMap((remaining) => supermarketCombos(remaining, preferences)),
};
for (const [name, offer] of Object.entries(situations)) {
  const plain = offer([]);
  if (average(offer(['low-carb']), carbShare) >= average(plain, carbShare)) problems.push(`${name}: "low-carb" does not lower the carb share`);
  if (average(offer(['high-protein']), (option) => option.protein) < average(plain, (option) => option.protein)) problems.push(`${name}: "high-protein" lowers protein`);
}

// --- Fit badge --------------------------------------------------------------
// Three options aimed at the same target must not all say the same thing.
assert.deepEqual(optionFits([{ calories: 534, protein: 66 }, { calories: 511, protein: 40 }, { calories: 380, protein: 20 }], 1400), ['exact', 'protein', 'light']);
assert.deepEqual(optionFits([{ calories: 300, protein: 8 }, { calories: 900, protein: 30 }], 1400), ['light', null], 'nothing within 15 % of the target: no "Passt genau"');
assert.deepEqual(optionFits([{ calories: 600, protein: 40 }], 400), [null], 'over what is left: no badge, the after line says so');
for (const remaining of budgets) {
  for (const offer of [recommendMeals('home', remaining, ['high-protein']), supermarketCombos(remaining, [])]) {
    const fits = optionFits(offer, remaining.calories).filter(Boolean);
    if (new Set(fits).size !== fits.length) problems.push(`the same badge appears twice in one set (${fits})`);
  }
}
if (!/fit: comboFits\[index\]/.test(read('src/app/(tabs)/plan.tsx')) || !/fit: suggestionFits\[index\]/.test(read('src/app/(tabs)/plan.tsx'))) problems.push('Plan cards do not show the set-wide fit badge');

// --- Preferences are visible and editable from Plan --------------------------
const plan = read('src/app/(tabs)/plan.tsx');
const onboarding = read('src/app/onboarding.tsx');
const de = read('src/i18n/de.ts');
const en = read('src/i18n/en.ts');
if (!/knownPreferences\(profile\.preferences\)/.test(plan) || !/t\.plan\.adaptedTo\(/.test(plan)) problems.push('Plan does not say which preferences shaped the options');
if (!plan.includes("'/onboarding?edit=1&step=preferences'")) problems.push('Plan has no way to change the preferences');
if (!/params\.step === 'preferences'/.test(onboarding)) problems.push('the preference shortcut does not open the preference step');
const offered = [...onboarding.matchAll(/\{ id: '([a-z-]+)', label: t\.onboarding\.pref/g)].map((match) => match[1]).filter((id) => id !== 'none');
assert.deepEqual([...offered].sort(), [...PREFERENCE_IDS].sort(), 'onboarding offers exactly the preferences the mapping knows');
for (const [label, dictionary] of [['de', de], ['en', en]]) {
  const names = dictionary.slice(dictionary.indexOf('preferenceNames: {'), dictionary.indexOf('} as Record<string, string>', dictionary.indexOf('preferenceNames: {')));
  for (const id of PREFERENCE_IDS) {
    if (!new RegExp(`(?:'${id}'|\\b${id}): '`).test(names)) problems.push(`${label}: plan.preferenceNames misses ${id}`);
  }
}

// --- One card, readable hierarchy --------------------------------------------
const card = read('src/components/PlanOptionCard.tsx');
for (const name of ['PlanOptionCard', 'PlanOptionHeader', 'PlanFitBadge', 'PlanItemRows', 'PlanItemRow', 'PlanStoreChips', 'PlanMacroLine', 'PlanAfterHint', 'PlanOptionFooter']) {
  if (!new RegExp(`export function ${name}\\(`).test(card)) problems.push(`PlanOptionCard.tsx: ${name} is not exported for reuse`);
}
if (!/export const PLAN_VISIBLE_ITEMS = 3;/.test(card)) problems.push('more than three rows are visible before "+N weitere"');
const header = card.slice(card.indexOf('export function PlanOptionHeader'), card.indexOf('export function PlanStoreChips'));
const order = ['styles.kcal', 'styles.protein', 'styles.title'].map((key) => header.indexOf(key));
if (order.some((index) => index < 0) || order.some((index, i) => i && index < order[i - 1])) problems.push('the card header no longer leads with kcal and protein, then the title');
if (!/kcal: \{[^}]*fontVariant: \['tabular-nums'\]/.test(card)) problems.push('card figures are not tabular');
if (/fontSize:/.test(card)) problems.push('PlanOptionCard sets a raw fontSize instead of typeScale');
if (/shadow(?:Color|Opacity|Radius|Offset)|elevation:/.test(card)) problems.push('the only shadow belongs to the Scan button');
if (/linear-gradient|LinearGradient/.test(card)) problems.push('no gradients');
const uses = plan.match(/<PlanOptionCard\b/g)?.length ?? 0;
if (uses < 2) problems.push(`Plan renders ${uses} PlanOptionCard branches; catalogue and Supermarkt must both use it`);
if (/<Card key=\{(?:combo|suggestion)\.id\}/.test(plan)) problems.push('Plan still draws its own option card');
if (!/items=\{combo\.items\.map\(comboItem\)\}/.test(plan) || !/items=\{recipeItems\(suggestion\.id, recipeScale\)\}/.test(plan)) problems.push('option rows no longer come from the products and the recipe');
const chainCard = 'src/components/ChainComboCard.tsx';
if (existsSync(resolve(root, chainCard)) && !read(chainCard).includes("from '@/components/PlanOptionCard'")) {
  problems.push('ChainComboCard must compose the shared PlanOptionCard pieces');
}

if (problems.length) {
  console.error('Plan options check failed:');
  for (const problem of [...new Set(problems)].slice(0, 60)) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Plan options: ${checked} situation/preference/budget cases give exactly three options that honour every diet through one mapping; goal preferences move all three situations; one card for all.`);
