import {offMassNutrition,offMassPortions,OFF_PRODUCT_FIELDS,offBarcodeCandidates,offBrand,offPackageGrams} from '../supabase/functions/_shared/off-product.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { openFoodFactsNutrition } from '../server/core.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const compile = (source, dependencies = {}) => {
  const module = { exports: {} };
  const require = (name) => {
    if (!(name in dependencies)) throw Error(`Unmocked dependency ${name}`);
    return dependencies[name];
  };
  new Function('module', 'exports', 'require', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(module, module.exports, require);
  return module.exports;
};
const units = compile(read('src/utils/units.ts'), {
  '@/i18n/active': { getLocale: () => 'en-US' }, '@/i18n': { deviceRegion: () => 'US' },
});
const label = { 'energy-kcal_100g': 123.4, proteins_100g: 2.3, carbohydrates_100g: 18.7, fat_100g: 4.2 };
assert.deepEqual(openFoodFactsNutrition(label), { calories: 123.4, protein: 2.3, carbs: 18.7, fat: 4.2 });
for (const key of Object.keys(label)) {
  for (const invalid of [undefined, null, '', ' ', false, NaN, Infinity, -1, 'unknown']) {
    assert.equal(openFoodFactsNutrition({ ...label, [key]: invalid }), null, `${key}: ${invalid}`);
  }
}
assert.deepEqual(openFoodFactsNutrition(Object.fromEntries(Object.keys(label).map(k => [k, 0]))),
  { calories: 0, protein: 0, carbs: 0, fat: 0 }, 'true zeros remain valid');
assert.equal(openFoodFactsNutrition({ ...label, 'energy-kcal_100g': 0 }), null);
for (const p of ['server/index.mjs', 'supabase/functions/nutrition/index.ts']) {
  assert.match(read(p), /const per100g = offMassNutrition\(product\)/);
  assert.doesNotMatch(read(p), /NUTRIMENT_KEYS\.some/);
}

// Run the actual handlers with a partial upstream record. The parser being
// correct is insufficient if a handler forgets to call it.
function loadFunction(path, name, dependencies) {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  const compiled = ts.transpileModule(node.getText(ast).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), compiled + `\nreturn ${name};`)(...Object.values(dependencies));
}
for (const path of ['server/index.mjs', 'supabase/functions/nutrition/index.ts']) {
  let nutriments = { ...label, 'energy-kcal_100g': undefined };
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ product: { nutriments } }) });
  const gateway = path.endsWith('index.ts');
  // The hosted gateway reads the shared OFF cache first and tries v2, then v0,
  // through small helpers; run those actual helpers with a cold cache.
  const lookup = loadFunction(path, 'lookupBarcode', gateway ? {
    // No product-index row: the lookup must reach Open Food Facts as before.
    readProductIndex: async () => null,
    readOffCache: async () => null, writeOffCache: async () => {}, offBarcodeCandidates, ModelError: Error,
    fetchOffProduct: loadFunction(path, 'fetchOffProduct', {
      OFF_PRODUCT_FIELDS, ProviderQuotaError: class extends Error {},
      offProductRequest: loadFunction(path, 'offProductRequest', { fetch, AbortSignal }),
      offCacheable: loadFunction(path, 'offCacheable', { OFF_PRODUCT_FIELDS }),
    }),
    barcodeResult: loadFunction(path, 'barcodeResult', {
      offMassNutrition, localizedProductName: () => 'Fixture', offBrand, offPackageGrams, servingPortion: () => [],
    }),
  } : {
    fetch, offMassNutrition,offMassPortions,openFoodFactsNutrition, localizedProductName: () => 'Fixture', servingPortion: () => [],
  });
  assert.equal((await lookup('8000500310427', 'de')).status, 422);
  nutriments = label;
  assert.equal((await lookup('8000500310427', 'de')).body.per100g.protein, 2.3);
}
class AnalysisError extends Error {}
let barcodeNutrition;
const barcode = loadFunction('src/services/mealAnalysis.ts', 'analyzeBarcode', {
  gatewayFetch: async () => ({ ok: true, json: async () => ({ barcode:'8000500310427',name: 'Fixture', per100g: barcodeNutrition,source:{provider:'open-food-facts',referenceId:'8000500310427',label:'Synthetic fixture'} }) }),
  getLanguage: () => 'de', getDictionary: () => ({ errors: { portionStartValue: '100 g' } }),
  // No own product ("Mein Produkt") for this barcode: the gateway answers.
  findCustomFoodByBarcode: async () => null,
  gatewayMessage: () => 'missing_nutrition', MealAnalysisError: AnalysisError,
  validSearchResult:loadFunction('src/services/mealAnalysis.ts','validSearchResult',{}),
});
barcodeNutrition = { protein: 10, carbs: 20, fat: 5 };
await assert.rejects(() => barcode('8000500310427'), AnalysisError);
barcodeNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };
assert.equal((await barcode('8000500310427')).items[0].calories, 0);
barcodeNutrition = openFoodFactsNutrition(label);
assert.equal((await barcode('8000500310427')).items[0].nutritionPer100g.protein, 2.3);

// Execute actual callback declarations, not a reimplementation of their maths.
const app = read('src/context/AppContext.tsx');
const ast = ts.createSourceFile('AppContext.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['setUnitSystem', 'addWeightEntry', 'completeOnboarding'].includes(node.name.getText(ast))) {
    callbacks[node.name.getText(ast)] = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const makeCallback = (name, env) => {
  const source = ts.transpileModule(`const callback = ${callbacks[name]};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), source + '\nreturn callback;')(...Object.values(env));
};
let saved, entry;
const initial = { completedAt: '2026-09-01T10:00:00Z', weightKg: 80, unitSystem: 'metric' };
const profileRef = { current: initial };
let queuedState;
const env = {
  useCallback: callback => callback,
  profileRef, profile: initial, unitWritesInFlightRef: { current: 0 },
  normalizeWeightKg: units.normalizeWeightKg,
  setProfile: next => { assert.notEqual(typeof next, 'function'); profileRef.current = next; queuedState = next; },
  saveProfile: async next => { saved = next; },
  adoptProfile: async next => { saved = next; },
  saveWeightEntry: async next => { entry = next; return [next]; },
  calculateDailyTargets: p => ({ calories: p.weightKg * 20 }),
  localDateKey: () => '2026-09-05',
  setTargets: () => {}, setWeightEntries: () => {}, setHydrationReady: () => {},
  isSupabaseConfigured: false,
  getLocalDataGeneration: () => 0,
};
await makeCallback('setUnitSystem', env)('us');
assert.equal(saved.unitSystem, 'us', 'persistence must not depend on React processing its state queue');
assert.equal(queuedState.weightKg, 80);
assert.ok(Date.parse(saved.editedAt) > Date.parse(initial.completedAt));
const weight = makeCallback('addWeightEntry', env);
for (const lbs of [218.9, 219, 219.1, 219.2, 220.9]) {
  await weight(units.parseWeightInput(String(lbs), 'us'));
  assert.equal(units.weightInputValue(saved.weightKg, 'us'), lbs.toFixed(1));
  assert.equal(entry.weightKg, saved.weightKg);
  assert.ok(saved.editedAt);
}
for (const bad of [30, 351, NaN, Infinity]) await assert.rejects(() => weight(bad), /invalid_weight/);
for (let tenth = 800; tenth <= 7700; tenth++) {
  const lbs = tenth / 10;
  const kg = units.parseWeightInput(String(lbs), 'us');
  if (kg !== null) assert.equal(units.weightInputValue(kg, 'us'), lbs.toFixed(1));
}
assert.equal(units.parseWeightInput('30', 'metric'), null);
assert.equal(units.parseWeightInput('1e2', 'metric'), null);
assert.equal(units.parseStoneInput('12.5', '0'), null);
await makeCallback('completeOnboarding', env)({ ...initial, weightKg: 83 });
assert.equal(saved.completedAt, initial.completedAt);
assert.ok(Date.parse(saved.editedAt) > Date.parse(saved.completedAt));

let promoted;
const local = { ...initial, weightKg: 83, editedAt: '2026-09-05T12:00:00Z' };
const cloud = { profile: { ...initial, completedAt: '2026-09-04T12:00:00Z' }, ageDeclared: true, targets: {} };
const sync = compile(read('src/services/syncRepository.ts'), {
  '@/services/telemetry': { trackEvent: () => {}, captureOperationalError: () => {} },
  '@/services/supabaseClient': { getCurrentSessionUserId: async () => 'test' },
  '@/services/cloudRepository': {
    assertCloudOwner: async () => {}, loadCloudDeletedMealIds: async () => [],
    initializeCloudProfile: async () => cloud,
    saveCloudProfile: async profile => { promoted = profile; return true; },
    loadCloudMealHistory: async () => [], hasCloudAnalyzedMeal: async () => false,
  },
  '@/services/appAccess': { authorizeMealCreate: async () => undefined }, '@/services/hardWall': { markHardWallUsed: async () => undefined },
  '@/services/localRepository': { getLocalDataGeneration: () => 0, loadLocalAccountSwitch: async () => null, mergeCloudMealSnapshot: async (meals) => meals, loadProfile: async () => local, loadAllStoredScans: async () => [], loadDeletedMealIds: async () => [] },
  '@/services/mockNutrition': { DEFAULT_TARGETS: {} },
  '@/services/personalization': { calculateDailyTargets: p => ({ calories: p.weightKg * 20 }), DEFAULT_PROFILE: initial },
  '@/utils/date': { localDateKey: () => '2026-09-05' },
});
assert.equal((await sync.hydrateCloudState()).profile.weightKg, 83);
assert.equal(promoted, local, 'an offline edit must upload instead of adopting the older cloud profile');
cloud.ageDeclared = false; promoted = undefined;
await sync.hydrateCloudState();
assert.equal(promoted, undefined, 'missing cloud age must remain authoritative');
console.log('Review regressions passed: complete barcode labels, precise weights, deferred React state, offline edits and age guard.');
