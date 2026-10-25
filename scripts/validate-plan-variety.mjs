import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
// Three ideas must be three different choices: the actual ranking with the real catalogues.
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
function load(path, deps) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(id => { assert.ok(id in deps, `Unmocked dependency ${id}`); return deps[id]; }, module, module.exports);
  return module.exports;
}
let language = 'de';
const recommendations = load('src/services/recommendations.ts', {
  '@/data/dietaryTerms.json': json('src/data/dietaryTerms.json'), '@/data/ingredientDiet.json': json('src/data/ingredientDiet.json'),
  '@/data/recipes.json': json('src/data/recipes.json'), '@/data/mealCatalog.de.json': json('src/data/mealCatalog.de.json'), '@/data/mealCatalog.en.json': json('src/data/mealCatalog.en.json'),
  '@/i18n/active': { getLanguage: () => language, getDictionary: () => ({ errors: { catalogSourceLabel: 'Kandro' } }) },
  '@/utils/mealSuggestions': load('src/utils/mealSuggestions.ts', {}),
  '@/services/preferences': load('src/services/preferences.ts', {}),
});
const de = json('src/data/mealCatalog.de.json');
const source = id => { const entry = de.find(item => item.id === id); return (`${entry.title} ${entry.detail}`.match(/(puten|hähnchen|rind|schwein|lachs|thunfisch|kabeljau|seelachs|fisch|tofu|linsen|kichererbse|bohnen|quark|skyr|joghurt|eier|ei\b)/i)?.[1] ?? id).toLowerCase(); };
let checked = 0;
for (const remaining of [{ calories: -241, protein: 29, carbs: 20, fat: 0 }, { calories: 600, protein: 60, carbs: 60, fat: 20 }, { calories: 900, protein: 50, carbs: 100, fat: 30 }]) {
  for (const preferences of [['high-protein'], []]) {
    for (const context of ['home', 'supermarket', 'eating-out']) {
      for (const lang of ['de', 'en']) {
        language = lang;
        const ideas = recommendations.recommendMeals(context, remaining, preferences);
        assert.equal(ideas.length, 3);
        assert.equal(new Set(ideas.map(idea => source(idea.id))).size, 3, `${context} ${lang} ${preferences}: ${ideas.map(idea => idea.title).join(' | ')}`);
        checked++;
      }
    }
  }
}
// The owner-reported case: three turkey dishes at home after an over-target day.
language = 'de';
assert.notDeepEqual(recommendations.recommendMeals('home', { calories: -241, protein: 29, carbs: 20, fat: 0 }, ['high-protein']).map(idea => source(idea.id)), ['puten', 'puten', 'puten']);
console.log(`Plan variety passed: ${checked} DE/EN context/budget/preference sets have three different main protein sources.`);
