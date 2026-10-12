import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
// Instant on-device suggestions, local description parsing and own foods.
// Real modules with the real BLS snapshot; dictionary/meal mapping mocked; zero HTTP.
globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const bls = await import(new URL('../supabase/functions/_shared/bls-search-data.mjs', import.meta.url));
const references = await import(new URL('../supabase/functions/_shared/bls-reference.mjs', import.meta.url));
const catalogue = await import(new URL('../supabase/functions/_shared/bls-search.mjs', import.meta.url));
const synonyms = await import(new URL('../supabase/functions/_shared/food-synonyms.mjs', import.meta.url));
const labels = { portionPiece: '1 Stück', portionSlice: '1 Scheibe', portionGlass: '1 Glas', portionCup: '1 Tasse', portionPot: '1 Becher', portionCan: '1 Dose', portionBottle: '1 Flasche', portionTbsp: '1 EL', portionTsp: '1 TL', portionServing: '1 Portion', portionFillet: '1 Filet', portionBall: '1 Kugel', portionEgg: '1 Ei', portionHalf: '½ Stück' };
let language = 'de';
const active = { getDictionary: () => ({ scan: labels, errors: { warnAmountEstimated: 'estimated', warnGenericReference: 'generic', warnUnmatched: 'unmatched', sourceUnmatched: 'no reference' } }), getLanguage: () => language };
function load(path, deps) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(id => { if (id.endsWith('bls-search-data.mjs')) return bls; if (id.endsWith('bls-reference.mjs')) return references; if (id.endsWith('bls-search.mjs')) return catalogue; if (id.endsWith('food-synonyms.mjs')) return synonyms; if (id.endsWith('.json') && id.startsWith('../data/')) return JSON.parse(fs.readFileSync(new URL(`../src/data/${id.slice(8)}`, import.meta.url), 'utf8')); assert.ok(id in deps, `Unmocked dependency ${id}`); return deps[id]; }, module, module.exports);
  return module.exports;
}
const suggest = load('src/services/foodSuggest.ts', { '@/i18n/active': active });
const mealFromSearch = (result, grams) => ({ items: [{ id: `search-${result.id}`, name: result.name, amountG: grams, calories: Math.round(result.per100g.calories * grams / 100), source: result.source }] });
const local = load('src/services/localDescription.ts', { '@/i18n/active': active, '@/services/foodSuggest': suggest, '@/services/mealAnalysis': { mealFromSearch }, '@/utils/ingredientCorrection': load('src/utils/ingredientCorrection.ts', {}) });
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const top = (query, usage) => suggest.suggestFoods(query, usage)[0]?.source.referenceId;

await test('typing a prefix suggests the everyday food first, offline and fast', () => {
  const cases = { ha: 'C133000', haf: 'C133000', bana: 'F503100', ap: 'F110100', mil: 'M111200', ei: 'E111132', bro: 'B101000', nud: 'E401032', reis: 'C352032', kaf: 'N410100', tee: 'N630000', was: 'N110000', jog: 'M141300', sk: 'M710100', toa: 'B314000', 'häh': 'V416172', cola: 'N330000' };
  for (const [query, code] of Object.entries(cases)) assert.equal(top(query), code, query);
  // Generic words mean the plain food, not a dish or a lookalike (Wein ≠ Weintraube).
  const plain = { wein: 'P2A3000', weisswein: 'P210000', salat: 'X201160', paprika: 'G543100', 'eiweiß': 'E113100', 'ei weiß': 'E113100', putenbr: 'V486182', gurke: 'G520100' };
  for (const [query, code] of Object.entries(plain)) assert.equal(top(query), code, query);
  // Everyday dishes resolve to the dish with a realistic serving, not to a component.
  // BLS has no combined dish: pasta and the meat sauce are the top two.
  assert.deepEqual(suggest.suggestFoods('spaghetti bolognese').slice(0, 2).map(r => r.source.referenceId).sort(), ['E401032', 'Y038213']);
  const dishes = { lasagne: 'X730033', pizza: 'X912033', 'döner': 'Y921162', currywurst: 'Y943032', 'chili con': 'X469753' };
  for (const [query, code] of Object.entries(dishes)) assert.equal(top(query), code, query);
  assert.equal(suggest.suggestFoods('lasagne')[0].portions?.[0]?.grams, 350, 'lasagne has a serving');
  const started = performance.now();
  for (let i = 0; i < 50; i++) suggest.suggestFoods('kart');
  assert.ok((performance.now() - started) / 50 < 40, 'suggestions stay interactive');
  assert.deepEqual(suggest.suggestFoods('h'), []);
});

await test('foods the user logged before rank first and remember the last amount', () => {
  const history = [{ id: 'm1', savedAt: '2026-10-03T08:00:00Z', items: [{ included: true, amountG: 60, name: 'Hafer Flocken', source: { provider: 'bls', referenceId: 'C660000', label: 'BLS' } }] }];
  const usage = suggest.foodUsage(history);
  assert.equal(top('haf', usage), 'C660000');
  assert.equal(suggest.suggestFoods('haf', usage)[0].lastGrams, 60);
  const recents = suggest.recentFoods([...history, { id: 'm2', savedAt: '2026-10-03T09:00:00Z', items: [{ included: true, amountG: 150, name: 'Omas Zupfkuchen', nutritionPer100g: { calories: 253, protein: 5, carbs: 0, fat: 0 }, source: { provider: 'manual', referenceId: 'manual-1', label: 'Eigene Angabe' } }] }]);
  // BLS rows carry their everyday name; the official label stays visible as officialName.
  assert.deepEqual(recents.map(food => food.name), ['Omas Zupfkuchen', 'Haferdrink']);
  assert.equal(recents[1].officialName, 'Haferdrink ungesüßt');
  assert.equal(recents[0].lastGrams, 150);
});

await test('suggestions carry editable typical portions; local rows win over duplicate gateway rows', () => {
  const banana = suggest.suggestFoods('banane')[0];
  assert.deepEqual(banana.portions.map(portion => [portion.grams, portion.estimated]), [[120, true]]);
  const merged = suggest.mergeSuggestions([banana], [{ ...banana, id: 'bls-dup' }, { id: 'off-1', name: 'Bananenchips Marke', per100g: banana.per100g, defaultGrams: 100, source: { provider: 'open-food-facts', referenceId: '1', label: 'OFF' } }]);
  assert.deepEqual(merged.map(row => row.id), [banana.id, 'off-1']);
});

await test('audit search cases: preparation, typos, plurals, plant drinks and no fragment false hits', () => {
  // Ranking is checked against the official BLS label; the everyday title is checked below.
  const label = food => food?.officialName ?? food?.name;
  const first = (query, lang = 'de') => { language = lang; try { return label(suggest.suggestFoods(query)[0]); } finally { language = 'de'; } };
  assert.match(first('ei gekocht'), /^Eier gekocht|^Hühnerei gekocht/);
  for (const [query, lang] of [['egg', 'en'], ['eggs', 'en'], ['ei', 'de'], ['eier', 'de']]) {
    language = lang;
    const names = suggest.suggestFoods(query).slice(0, 3).map(label);
    language = 'de';
    assert.match(names[0], /gekocht|boiled/i, `${query}: boiled egg first`);
    assert.ok(!names.some(name => /egg-free|eifrei|Eierkuchen|Pfannkuchen/i.test(name)), `${query}: ${names.join(' | ')}`);
  }
  assert.match(first('gekochtes ei'), /gekocht/);
  assert.equal(first('haferfloken'), 'Haferflocken');
  assert.match(first('rosinen'), /^Rosine/);
  assert.match(first('milchreis'), /^Milchreis mit Milch/);
  assert.match(first('mandelmilch'), /^Mandeldrink/);
  assert.equal(first('mandeln'), 'Mandel süß');
  assert.equal(suggest.suggestFoods('mandeln')[0].name, 'Mandeln', 'the everyday name is the title');
  assert.match(first('oat milk', 'en'), /^Oat drink/);
  assert.match(first('oil', 'en'), /oil/i);
  assert.ok(!/rice/i.test(first('oil', 'en')), 'oil must not match inside boiled');
  assert.match(first('hänchen'), /^Hähnchen/);
  assert.match(first('milch 1,5'), /1,5 % Fett/);
  // Brands are not invented locally; the gateway/Open Food Facts answers them.
  assert.equal(suggest.suggestFoods('milka').length, 0);
});

await test('simple descriptions resolve locally with sensible amounts', () => {
  const grams = text => local.parseLocalDescription(text)?.items.map(item => [item.source.referenceId, item.amountG]);
  assert.deepEqual(grams('3l Milch und 2 Toast'), [['M111300', 3090], ['B314000', 50]]);
  assert.deepEqual(grams('2 Toast und 300 ml Milch'), [['B314000', 50], ['M111300', 309]]);
  assert.deepEqual(grams('2 Bananen'), [['F503100', 240]]);
  assert.deepEqual(grams('eine Banane'), [['F503100', 120]]);
  assert.deepEqual(grams('150 g Reis mit 120 g Hähnchenbrust'), [['C352032', 150], ['V416172', 120]]);
  // Audit 6.2: decimal comma stays with its own food; nothing is re-estimated.
  assert.deepEqual(grams('100,5 g Haferflocken und 3 g Olivenöl'), [['C133000', 100.5], ['Q120000', 3]]);
  assert.deepEqual(grams('1,5 Bananen'), [['F503100', 180]]);
  assert.deepEqual(grams('3 Kartoffeln'), [['X6A1010', 240]]);
  assert.deepEqual(grams('Kartoffeln'), [['X6A1010', 200]]);
  assert.deepEqual(grams('1 Dose Cola Zero'), [['N331000', 330]]);
  assert.deepEqual(grams('etwa 200 g Reis'), [['C352032', 200]]);
  assert.deepEqual(grams('2 Eier'), [['E111132', 116]]);
  const result = local.parseLocalDescription('2 Toast');
  assert.equal(result.confidence, 'medium');
  assert.ok(result.items.every(item => item.confidence === 'medium'));
});

await test('anything unclear still goes to the AI analysis instead of guessing', () => {
  for (const text of ['Kaffee mit Milch', '150 g Reis mit Hähnchenbrust', 'Hähnchen ohne Sauce', 'Pizza', 'Döner', 'Spaghetti Bolognese', 'Nudeln mit Tomatensoße', '2 Eier ohne Butter', 'Reis oder Nudeln', 'halbe Portion Lasagne', '200 ml Öl', 'Salat mit Hähnchen', 'x', '?']) {
    assert.equal(local.parseLocalDescription(text), null, text);
  }
  // "Brot" never becomes "Brotfrucht"; whole words only.
  assert.notEqual(suggest.matchFood('brot')?.source.referenceId, suggest.suggestFoods('brotfrucht')[0]?.source.referenceId);
});

await test('English input works the same way', () => {
  language = 'en';
  try {
    assert.equal(top('oat'), 'C133000');
    assert.deepEqual(local.parseLocalDescription('2 eggs and a banana')?.items.map(item => item.source.referenceId), ['E111132', 'F503100']);
  } finally { language = 'de'; }
});

await test('own foods and direct logging are wired end to end', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261004130000_manual_food_source.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("'manual'") && sql.includes("'bls'") && sql.includes("'open-food-facts'"));
  const analysis = fs.readFileSync(new URL('../src/services/mealAnalysis.ts', import.meta.url), 'utf8');
  assert.ok(analysis.includes("['bls','usda','open-food-facts','manual','kandro-catalog']"), 'manual entries and Kandro estimates pass the search-result guard');
  const form = fs.readFileSync(new URL('../src/components/ManualFoodForm.tsx', import.meta.url), 'utf8');
  assert.ok(form.includes("provider: 'manual', referenceId: id"));
  const scan = fs.readFileSync(new URL('../src/app/(tabs)/scan.tsx', import.meta.url), 'utf8');
  // Everything picked in one open search sheet is saved together as ONE meal.
  assert.ok(scan.includes('await logFoodsDirect(added.map(entry => ({ result: entry.food, grams: entry.grams })))') && scan.includes('suggestFoods(term, usage)') && scan.includes('parseLocalDescription(value, usage)'));
  assert.ok(scan.includes('t.scan.saveAs(mealTypeLabel(saveSlot, t.common))'), 'the save button names the slot');
  const context = fs.readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
  assert.ok(/&& !localDescription\s*&& result\.correctionRequired/.test(context), 'local descriptions never spend a free analysis');
});

await test('amount unclear is never a dead end: recognised foods come back at a typical portion', () => {
  const estimate = local.estimateDescriptionPortions('200 ml Reis mit Hähnchenbrust');
  assert.ok(estimate, 'recognised foods must produce a draft');
  assert.equal(estimate.estimatedPortion, true);
  assert.equal(estimate.correctionRequired, true, 'stays in the free (refunded) bucket');
  assert.equal(estimate.items.length, 2);
  assert.ok(estimate.items.every(item => item.amountG >= 1 && item.amountG <= 5000 && item.confidence === 'medium'));
  assert.deepEqual(estimate.warnings, ['estimated']);
  const partial = local.estimateDescriptionPortions('Reis und Zauberbrei vom Mond');
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items[1].source.code, 'unmatched', 'an unknown food is left for the user to pick, never dropped');
  assert.deepEqual(partial.warnings, ['estimated', 'unmatched']);
  assert.equal(local.estimateDescriptionPortions('Zauberbrei vom Mond'), null, 'nothing recognisable keeps the error');
});

await test('an unpriced ingredient is matched on the device at its detected amount and flagged', () => {
  const unmatched = (id, name, amountG) => ({ id, name, amountG, baseAmountG: amountG, portionFactor: 1, calories: 0, protein: 0, carbs: 0, fat: 0, included: true, confidence: 'medium', source: { code: 'unmatched', provider: 'kandro-catalog', label: 'x' } });
  const priced = { ...unmatched('rice', 'Reis', 150), calories: 195, source: { provider: 'bls', label: 'BLS' } };
  const { items, matchedIds } = local.resolveUnmatchedItems([priced, unmatched('banana', 'Banane', 118), unmatched('moon', 'Zauberbrei vom Mond', 80)]);
  assert.deepEqual(matchedIds, ['banana']);
  assert.equal(items[0], priced, 'resolved rows are untouched');
  assert.equal(items[1].id, 'banana'); assert.equal(items[1].amountG, 118); assert.equal(items[1].source.referenceId, 'F503100');
  assert.equal(items[1].confidence, 'medium');
  assert.equal(items[2].source.code, 'unmatched', 'no guess for an unknown food');
});

console.log(JSON.stringify({ passed, scope: 'instant suggestions, recents, local descriptions, own foods; real BLS snapshot; zero external HTTP' }));
