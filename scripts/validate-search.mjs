/**
 * Food search is the cheap path: no model call, so it costs the user no free
 * meal and costs us no credit. That only holds if it stays wired that way.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(resolve(projectRoot, relative), 'utf8');

const gateway = await read('supabase/functions/nutrition/index.ts');
const service = await read('src/services/mealAnalysis.ts');
const screen = await read('src/app/(tabs)/scan.tsx');
const context = await read('src/context/AppContext.tsx');
const confirm = await read('src/app/confirm.tsx');

// --- No model call, and outside the paid quota -----------------------------
const searchFn = gateway.slice(gateway.indexOf('async function searchFoods'), gateway.indexOf('async function usdaRows'));
assert.ok(searchFn.length > 100, 'could not locate the search handler');
assert.ok(!/requestDetection|openrouter|gpt-/i.test(searchFn), 'search must not call the model');
assert.ok(!/consume_analysis_quota/.test(searchFn), 'search must not consume the analysis quota');
// The quota is charged on the POST path; search is a GET, like the barcode.
const getBlock = gateway.slice(gateway.indexOf("if (request.method === 'GET')"), gateway.indexOf("if (request.method !== 'POST')"));
assert.match(getBlock, /route === '\/v1\/search'/, 'search must be served on the free GET path');

// --- The client must not spend a free meal on it ---------------------------
const addFn = screen.slice(screen.indexOf('const addSearchResult'), screen.indexOf('const submitDescription'));
assert.ok(addFn.length > 50, 'could not locate the add-from-search handler');
assert.ok(!addFn.includes('hasScanAccess'), 'adding a searched food must not spend a free meal');
assert.ok(context.includes('applySearchResult'), 'the context must accept a resolved search result');
const applyFn = context.slice(context.indexOf('const applySearchResult'), context.indexOf('const startBarcodeScan'));
assert.ok(!/analyzeDescription|analyzePreparedPhoto|analyzeBarcode/.test(applyFn), 'a searched food is already resolved');

// --- Typing must not fire a request per keystroke --------------------------
const runFn = screen.slice(screen.indexOf('const runSearch'), screen.indexOf('const addSearchResult'));
assert.match(runFn, /setTimeout\(/, 'search must be debounced');
assert.match(runFn, /clearTimeout\(searchTimer\.current\)/, 'a pending search must be cancelled');
// A slow early response must not overwrite a later, better one.
assert.match(runFn, /latestSearch\.current !== request/, 'stale responses must be discarded');
assert.match(runFn, /term\.length < 2/, 'a one-letter query must not be sent');

// --- A searched food must never spend a free analysis ----------------------
// The server charges a successful AI result before Confirm. Search is already
// resolved data, so it must be excluded at that exact success boundary.
assert.match(context, /FREE_ANALYSIS_MODES/, 'the free inputs must be named somewhere');
const modes = context.match(/FREE_ANALYSIS_MODES = new Set<ScanMode>\(\[([^\]]*)\]\)/);
assert.ok(modes, 'could not read the free input list');
for (const mode of ['search', 'demo', 'barcode']) {
  assert.ok(modes[1].includes(`'${mode}'`), `${mode} must not spend a free meal`);
}
for (const mode of ['live', 'description']) {
  assert.ok(!modes[1].includes(`'${mode}'`), `${mode} costs an analysis and must be charged`);
}
const logging = context.slice(context.indexOf('const logScannedMeal'), context.indexOf('const logPlannedMeal'));
const analyzing = context.slice(context.indexOf('const analyzeCurrentPhoto'), context.indexOf('const resumeLatestAnalysis'));
assert.match(
  analyzing,
  /!FREE_ANALYSIS_MODES\.has\(activeScanMode\)[\s\S]*countLifetimeScanOnce\(invocationScanId\)/,
  'only a successful input that reached the model may spend an analysis',
);
assert.doesNotMatch(logging, /countLifetimeScanOnce/,
  'saving or abandoning Confirm must not change an already decided allowance');
// The allowance is also derived from how many stored meals carry origin
// 'scan', so incrementing a counter is not enough on its own.
assert.match(
  logging,
  /origin: costsAnalysis \? 'scan' : 'plan'/,
  'a searched food must not be stored as a scan, or the count re-inflates from history',
);
assert.match(context, /origin === 'scan'/, 'the scan count is derived from the stored origin');
// The database only accepts these two values.
assert.ok(!/origin: 'search'/.test(context), "the meals table constrains origin to 'scan' and 'plan'");

// --- The result must carry its source --------------------------------------
const mealFn = service.slice(service.indexOf('export function mealFromSearch'));
assert.match(mealFn, /source: result\.source/, 'a logged food must keep the reference it came from');
assert.match(mealFn, /grams \/ 100/, 'values must scale from per-100g to the chosen amount');

// --- Both languages offer it ----------------------------------------------
for (const file of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
  const dictionary = await read(file);
  for (const key of ['modeSearch', 'searchTitle', 'searchEmpty', 'searchFree', 'searchAgain']) {
    assert.ok(dictionary.includes(`${key}:`), `${file} is missing ${key}`);
  }
}

// A database search has no photo to retake. Its secondary action must return
// to an already-open search sheet and say what will actually happen.
assert.match(confirm, /scanMode === 'search' \? t\.confirm\.searchAgain : scanMode === 'description' \? t\.confirm\.editDescription : scanMode === 'barcode' \? t\.confirm\.scanAgain : t\.confirm\.retake/,
  'search confirmation must not offer to retake a photo');
assert.match(confirm, /router\.dismissTo\('\/\(tabs\)\/scan\?mode=description'\)/,
  'description confirmation must return to text entry, not the camera');
const changeInput = confirm.slice(confirm.indexOf('const changeInput'), confirm.indexOf('const confirm'));
assert.match(changeInput, /scanMode === 'search'/, 'the change-input action must distinguish a search result');
assert.match(changeInput, /router\.dismissTo\('\/\(tabs\)\/scan\?mode=search'\)/,
  'choosing another searched food must reopen the search sheet');
// German search leans on the BLS dish names, because USDA is English only.
const bls = await read('supabase/functions/_shared/bls-reference.mjs');
assert.ok(bls.includes('export function searchBlsReferences'), 'German search needs the dish references');
assert.match(searchFn, /language === 'de'/, 'the German dish names must only be offered to German readers');

// --- Database gap: German synonyms, dedupe, source badges, empty-field picks ---
// Local first (own products, then the on-device BLS catalogue), remote after the debounce.
assert.match(runFn, /const local = mergeSuggestions\(matchCustomFoods\(term, customFoods\), suggestFoods\(term, usage\)\);[\s\S]*setSearchResults\(local\);[\s\S]*searchTimer\.current = setTimeout\(/,
  'own products and on-device suggestions must show before the debounced gateway search');
assert.match(screen, /const generic = mergeSuggestions\(local, results\.generic\);\s*setSearchResults\(generic\);/, 'gateway rows are merged without duplicates');
assert.match(screen, /setProductResults\(mergeSuggestions\(generic, results\.products\)\.slice\(generic\.length\)\)/, 'a product that is also a generic row is shown once');
assert.match(screen, /foodSourceBadge\(result\)/, 'every row shows where its values come from');
assert.match(screen, /myProducts\.map\(renderResult\)[\s\S]*frequent\.map\(renderResult\)[\s\S]*recents\.map\(renderResult\)/,
  'an empty field lists own products, then frequent, then recent foods');
assert.match(screen, /t\.scan\.quickAddCta/, 'quick add must be offered when nothing fits');
assert.match(screen, /openLabelScan\(\)/, 'the search must offer the nutrition-label scan');
for (const file of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
  const dictionary = await read(file);
  for (const key of ['badgeBls', 'badgeOff', 'badgeCustom', 'frequentTitle', 'myProductsTitle', 'quickAddTitle']) assert.ok(dictionary.includes(`${key}:`), `${file} is missing ${key}`);
}
assert.match(await read('src/i18n/de.ts'), /badgeOff: 'Open Food Facts', badgeUsda: 'USDA', badgeCustom: 'Mein Produkt'/);
const suggestSource = await read('src/services/foodSuggest.ts');
assert.match(suggestSource, /const tokens = fold\(applyFoodSynonyms\(typed\.join\(' '\), language\)\)/, 'on-device suggestions must use the shared synonym table');
assert.match(await read('supabase/functions/_shared/bls-search.mjs'), /searchFold\(applyFoodSynonyms\(fold\(query\), language\)\)/, 'the gateway catalogue must use the shared synonym table');

// Runtime: the actual merge, badge and frequent-food helpers.
const ts = (await import('typescript')).default;
const shared = (name) => import(new URL(`../supabase/functions/_shared/${name}`, import.meta.url));
const modules = { 'bls-search-data.mjs': await shared('bls-search-data.mjs'), 'bls-reference.mjs': await shared('bls-reference.mjs'), 'bls-search.mjs': await shared('bls-search.mjs'), 'food-synonyms.mjs': await shared('food-synonyms.mjs') };
const loaded = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(suggestSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
  (id) => id === '@/i18n/active' ? { getLanguage: () => 'de', getDictionary: () => ({ scan: new Proxy({}, { get: () => '1 Portion' }) }) } : id.endsWith('.json') ? JSON.parse(readFileSync(resolve(projectRoot, 'src/data', id.split('/').pop()), 'utf8')) : modules[id.split('/').pop()],
  loaded, loaded.exports);
const suggest = loaded.exports;
const per100g = { calories: 63, protein: 11, carbs: 4, fat: 0.2 };
const own = { id: 'custom-1', name: 'Skyr Natur (Ehrmann)', per100g, defaultGrams: 150, barcode: '4002971104202', source: { provider: 'manual', referenceId: 'custom-1', label: 'Mein Produkt' } };
const off = { id: 'off-4002971104202', name: 'Skyr (Ehrmann)', per100g, defaultGrams: 100, source: { provider: 'open-food-facts', referenceId: '4002971104202', label: 'Open Food Facts 4002971104202' } };
const pudding = { id: 'off-111', name: 'Protein Pudding (Ehrmann)', per100g: { ...per100g, calories: 80 }, defaultGrams: 100, source: { provider: 'open-food-facts', referenceId: '111', label: 'Open Food Facts 111' } };
const puddingTwin = { ...pudding, id: 'off-222', source: { ...pudding.source, referenceId: '222' } };
const skyr = suggest.suggestFoods('skyr')[0];
const merged = suggest.mergeSuggestions([own, skyr], [off, pudding, puddingTwin, { ...skyr, id: 'bls-dup' }]);
assert.deepEqual(merged.map((row) => row.id), [own.id, skyr.id, pudding.id], 'same barcode (own product = OFF record), same reference or same name+energy is one row');
assert.deepEqual([own, skyr, off].map(suggest.foodSourceBadge), ['custom', 'bls', 'off']);
assert.equal(suggest.foodSourceBadge({ source: { provider: 'manual', referenceId: 'manual-1' } }), 'own');
const meal = (id, at, items) => ({ id, savedAt: at, items: items.map((item) => ({ included: true, amountG: 100, ...item })) });
const history = [
  meal('a', '2026-10-01T08:00:00Z', [{ name: 'Skyr', source: { provider: 'bls', referenceId: 'M710100', label: 'BLS' } }]),
  meal('b', '2026-10-02T08:00:00Z', [{ name: 'Skyr', source: { provider: 'bls', referenceId: 'M710100', label: 'BLS' } }, { name: 'Riegel', nutritionPer100g: per100g, source: { provider: 'open-food-facts', referenceId: '400', label: 'OFF' } }]),
  meal('c', '2026-10-03T08:00:00Z', [{ name: 'Riegel', nutritionPer100g: per100g, source: { provider: 'open-food-facts', referenceId: '400', label: 'OFF' } }, { name: 'Apfel', source: { provider: 'bls', referenceId: 'F110100', label: 'BLS' } }]),
  meal('d', '2026-10-04T08:00:00Z', [{ name: 'Riegel', nutritionPer100g: per100g, source: { provider: 'open-food-facts', referenceId: '400', label: 'OFF' } }]),
];
assert.deepEqual(suggest.frequentFoods(history).map((row) => row.source.referenceId), ['400', 'M710100'], 'frequent foods: most often first, any source, eaten at least twice');

console.log('Validated search: no model call, no quota, no free meal spent, debounced, stale responses discarded; own products and synonyms first, cross-source dedupe, source badges, frequent/recent picks and quick add.');
