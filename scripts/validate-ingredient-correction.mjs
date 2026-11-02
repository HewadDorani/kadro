import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildMealItem, buildAccuracyWarnings, incompleteNutritionError, ingredientCorrectionDraft } from '../server/core.mjs';
import * as bls from '../supabase/functions/_shared/bls-reference.mjs';
import { canonicalFoodQuery } from '../supabase/functions/_shared/food-query.mjs';
import { isUsableSearchTerm } from '../server/core.mjs';
import { searchBlsCatalog } from '../supabase/functions/_shared/bls-search.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = source => {
  const module = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
  return module.exports;
};
const correction = compile(read('src/utils/ingredientCorrection.ts'));
const { needsIngredientCorrection, canSaveMealDraft, replaceMealIngredient } = correction;
const facts = { calories: 200, protein: 10, carbs: 30, fat: 4, provider: 'usda', referenceId: 'fixture', label: 'Fixture' };
const known = buildMealItem({ name: 'Chips', estimatedGrams: 50, confidence: 'high' }, facts, 0);
const unknown = buildMealItem({ name: 'Unmatched ingredient', estimatedGrams: 100 }, null, 1);
const detection = { title: 'Fixture mixed meal', confidence: 'high', items: [{ estimatedGrams: 50 }, { estimatedGrams: 100 }] };
const items = [known, unknown];
const inputSnapshot = JSON.stringify(items);
assert.equal(known.portions, undefined, 'the chips fixture has no countable portion');
assert.equal(needsIngredientCorrection(known), false);
assert.equal(needsIngredientCorrection(unknown), true);
assert.equal(canSaveMealDraft(items), false);
assert.equal(canSaveMealDraft(items.map(item => ({ ...item, included: true }))), false);
assert.equal(canSaveMealDraft(items.map(item => ({ ...item, included: false }))), false);
assert.equal(canSaveMealDraft([]), false);
assert.equal(canSaveMealDraft([known]), true);
assert.equal(canSaveMealDraft([{ ...known, calories: 0, protein: 10 }]), false);
for (const bad of [NaN, Infinity, -1, undefined]) assert.equal(canSaveMealDraft([{ ...known, calories: bad }]), false);

const replacement = buildMealItem({ name: 'Apple', estimatedGrams: 150, confidence: 'high' }, facts, 9);
const repaired = replaceMealIngredient(items, unknown.id, replacement);
assert.equal(repaired.length, 2);
assert.equal(repaired[0], known, 'replacing fruit must not change chips');
assert.equal(repaired[1].id, unknown.id, 'ingredient identity stays stable');
assert.equal(repaired[1].name, 'Apple');
assert.equal(repaired[1].source.code, undefined, 'unmatched marker is removed');
assert.equal(canSaveMealDraft(repaired), true);
assert.equal(JSON.stringify(items), inputSnapshot, 'no mutation of the old draft');
assert.equal(replaceMealIngredient(items, unknown.id, unknown), items);
assert.equal(replaceMealIngredient(items, unknown.id, { ...replacement, amountG: NaN }), items);
assert.deepEqual(replaceMealIngredient(items, 'stale-id', replacement), items);

// The shared protocol helper, not a hand-written mock of its decision.
for (const protocol of [undefined, null, false, true, '1', 0, 2]) {
  assert.equal(ingredientCorrectionDraft(detection, items, protocol), null, `legacy/unknown protocol ${protocol}`);
}
assert.equal(incompleteNutritionError(items).status, 422);
const draft = ingredientCorrectionDraft(detection, items, 1);
assert.equal(draft.status, 200);
assert.equal(draft.body.correctionRequired, true);
assert.equal(draft.body.items.length, 2);
assert.equal(draft.body.confidence, 'medium');
assert.equal(ingredientCorrectionDraft(detection, [known], 1), null);
assert.equal(ingredientCorrectionDraft(detection, [], 1), null);
assert.equal(ingredientCorrectionDraft(detection, [{ ...known, protein: NaN }, unknown], 1), null);

function loadFunction(path, name, dependencies) {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = { ...bls, aiEstimateFacts: () => null, ...dependencies };
  return new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope));
}
// Execute both shipped resolvers; one missing lookup does not drop the others.
for (const path of ['server/index.mjs', 'supabase/functions/nutrition/index.ts']) {
  const resolve = loadFunction(path, 'resolveDetection', {
    classifyDetection: () => null, resolveItem: async (_, i) => items[i],
    resolveBlsFacts: () => null, canonicalFoodQuery: x => x,
    isUsableSearchTerm: () => false, resolveFacts: async () => new Map(),
    buildMealItem: (_, __, i) => items[i], incompleteNutritionError,
    ingredientCorrectionDraft, buildAccuracyWarnings,
  });
  const call = protocol => path.startsWith('server/')
    ? resolve(detection, 'text', protocol)
    : resolve(detection, {}, 'text', undefined, protocol);
  assert.equal((await call(undefined)).status, 422, `${path}: old builds must fail closed`);
  assert.deepEqual(await call(1), draft, `${path}: new builds receive the intact correction draft`);
}

// A rejected identity must stay unresolved across database fallback and even
// when another ingredient legitimately looks up the same English query.
for (const path of ['server/index.mjs', 'supabase/functions/nutrition/index.ts']) {
  const requested = [];
  const resolveItem = loadFunction('server/index.mjs', 'resolveItem', {
    buildMealItem,
    resolveUsdaItem: async (item, index) => {
      requested.push(canonicalFoodQuery(item.searchTermEn));
      return buildMealItem(item, facts, index);
    },
  });
  const resolve = loadFunction(path, 'resolveDetection', {
    classifyDetection: () => null, resolveItem, canonicalFoodQuery,
    isUsableSearchTerm, buildMealItem, incompleteNutritionError,
    ingredientCorrectionDraft, buildAccuracyWarnings,
    resolveFacts: async terms => {
      requested.push(...terms);
      return new Map(terms.map(term => [term, facts]));
    },
  });
  const conflicting = { name: 'Knuspriges Müsli', searchTermEn: 'muesli with yogurt', referenceKey: 'other', estimatedGrams: 100, confidence: 'high' };
  const mixed = { title: 'Identity regression', confidence: 'high', items: [
    conflicting,
    { ...conflicting, name: 'Müsli mit Joghurt', estimatedGrams: 200 },
    { ...conflicting, name: 'Knuspermüsli zuckerfrei', searchTermEn: 'crunchy muesli', estimatedGrams: 50 },
    { ...conflicting, searchTermEn: 'crunchy muesli' },
  ] };
  const call = (value, protocol) => path.startsWith('server/')
    ? resolve(value, 'text', protocol)
    : resolve(value, {}, 'text', undefined, protocol);
  const result = await call(mixed, 1);
  assert.equal(result.body.correctionRequired, true, `${path}: identity conflicts must survive USDA fallback`);
  assert.equal(needsIngredientCorrection(result.body.items[0]), true, `${path}: same-query facts cannot fill a conflicting item`);
  assert.equal(needsIngredientCorrection(result.body.items[2]), true, `${path}: sugar-free modifier cannot be lost`);
  assert.equal(result.body.items[1].calories, 400, `${path}: unrelated valid fallback still scales correctly`);
  assert.equal(result.body.items[3].source.referenceId, 'C514200');
  assert.deepEqual(requested, ['muesli with yogurt'], `${path}: only eligible ingredients may query USDA`);
  requested.length = 0;
  const conflictsOnly = { ...mixed, items: [conflicting, mixed.items[2]] };
  assert.equal((await call(conflictsOnly, undefined)).status, 422, `${path}: legacy clients fail closed`);
  assert.deepEqual(requested, [], `${path}: identity conflicts do not consume USDA calls`);
}

class AnalysisError extends Error {}
const readResponse = loadFunction('src/services/mealAnalysis.ts', 'readAnalysisResponse', {
  needsIngredientCorrection, MealAnalysisError: AnalysisError,
  validSearchResult: loadFunction('src/services/mealAnalysis.ts', 'validSearchResult', {}),
  getDictionary: () => ({ errors: { noClearMeal: 'unclear', gatewayMissingNutrition: 'missing' } }),
  gatewayMessage: () => 'error', localizeResult: value => value,
});
const response = body => ({ ok: true, json: async () => body });
await assert.rejects(() => readResponse(response({ items })), AnalysisError);
assert.equal((await readResponse(response(draft.body))).items.length, 2);
await assert.rejects(() => readResponse(response({ ...draft.body, items: [{ ...known, calories: NaN }, unknown] })), AnalysisError);

// Execute the actual summing function for 1-12 ingredients, with uncountable
// chips as item zero. Counting and nutrient arithmetic must be independent.
const sum = loadFunction('src/services/mockNutrition.ts', 'nutritionFromItems', {});
for (let count = 1; count <= 12; count++) {
  const meal = Array.from({ length: count }, (_, i) => ({ ...known, id: String(i), calories: 100 + i }));
  assert.equal(sum(meal).calories, count * 100 + count * (count - 1) / 2);
  assert.equal(sum(meal.map((item, i) => i === 0 ? { ...item, included: false } : item)).calories, sum(meal).calories - 100);
}
const confirm = read('src/app/confirm.tsx');
assert.doesNotMatch(confirm, /filter\([^\n]*portions\?\.length/);
assert.match(confirm, /detectedItems\.map[\s\S]*key=\{`ingredient-/);
assert.match(confirm, /correctionRequired \? <Card[\s\S]*t\.confirm\.incompleteTotal[\s\S]*: <Card style=\{styles\.estimateCard\}/);
assert.match(confirm, /disabled=\{!canConfirm\}/);
const app = read('src/context/AppContext.tsx');
assert.match(app, /if \(!canSaveMealDraft\(detectedItems\)\) throw/);
assert.match(app, /result\.correctionRequired !== true[\s\S]*countLifetimeScanOnce/);
assert.match(app, /correctionDraftRef\.current = result\.correctionRequired === true/);
assert.match(app, /const costsAnalysis = !FREE_ANALYSIS_MODES\.has\(scanModeRef\.current\) && !correctionDraftRef\.current/);
assert.match(app, /origin: costsAnalysis \? 'scan' : 'plan'/,
  'a refunded/manual repair must not spend a credit on the next history hydration');
const guard = read('src/components/AppRouteGuard.tsx');
assert.match(guard, /segments\[0\] === 'result'[\s\S]*!canSaveMealDraft\(detectedItems\)/);
assert.match(guard, /const gated = [^\n]*missingMealDraft \|\| incompleteResult/);
assert.match(read('supabase/functions/nutrition/index.ts'), /result\.body\.correctionRequired === true\) \{\s*await refundAnalysis/);
for (const route of ['photo', 'text']) assert.ok(read('supabase/functions/nutrition/index.ts').includes(`'${route}', claimUsda, input.ingredientCorrection`));
const search = read('src/app/correct-food.tsx');
assert.match(search, /current !== generation\.current/);
assert.match(search, /useFocusEffect/);
assert.match(search, /replaceDetectedItem\(item\.id, pendingFood, grams\)/);
assert.doesNotMatch(search, /applySearchResult|startBarcodeScan|setCapturedPhoto/);

// Reported typo: the exact query has no source row. Suggestions keep source
// nutrients and require an explicit selection; they do not "repair" the fat %.
const { milkCorrectionQuery } = compile(read('src/utils/foodCorrectionQuery.ts'));
assert.deepEqual(searchBlsCatalog('45% Milch', 'de', 15), []);
for (const name of ['45% Milch', 'Milch 45 % Fett', 'Milch (45% Fettanteil)', 'Kuhmilch mit 45 % Fett', '1,5% Milch']) {
  assert.equal(milkCorrectionQuery(name), 'Milch', name);
}
for (const name of ['45% milk', 'Milk (45 % fat)', "cow's milk with 45% fat"]) {
  assert.equal(milkCorrectionQuery(name), 'milk', name);
}
for (const name of ['Milch', 'Milchreis 45%', '45% Hafermilch', '45% soy milk', '45% goat milk',
  '45% laktosefreie Milch', '45% lactose-free milk', '45% condensed milk', '45% Milchpulver',
  '45% Schokomilch', '45% Milch mit Kaffee', '45% Milch und Banane', '3,5% / 1,5% Milch', '45%% Milch']) {
  assert.equal(milkCorrectionQuery(name), null, `${name}: qualifiers must not be silently discarded`);
}
for (const language of ['de', 'en']) {
  const suggestions = searchBlsCatalog(language === 'de' ? 'Milch' : 'milk', language, 3);
  assert.deepEqual(suggestions.slice(0, 2).map(row => row.code), ['M111200', 'M111300']);
  for (const row of suggestions) {
    const chosen = buildMealItem({ name: language === 'de' ? row.nameDe : row.nameEn, estimatedGrams: 101.3, confidence: 'high' },
      { ...row.per100g, provider: 'bls', referenceId: row.code, label: 'BLS 4.0' }, 0);
    const corrected = replaceMealIngredient(items, unknown.id, chosen);
    assert.equal(corrected[0], known);
    assert.equal(corrected[1].id, unknown.id);
    assert.equal(corrected[1].amountG, 101.3);
    assert.equal(corrected[1].source.referenceId, row.code);
    assert.equal(canSaveMealDraft(corrected), true);
  }
}
assert.equal(JSON.stringify(items), inputSnapshot, 'suggestions must never mutate the initial meal');
assert.match(search, /needsIngredientCorrection\(item\) \? milkCorrectionQuery\(item.name\)/);
assert.match(search, /void search\(suggestionQuery\)/);
assert.match(search, /defaultGrams: item.amountG, amountIsChosen: true/);
console.log('PASS: correction protocol, legacy rejection, replacement isolation, save/route guards, 1-12 ingredient sums, no silent missing values, free lookup repair.');

// Owner report 04.10.: "Frikadellen mit Tomatensauce" had no database row and
// became a dead end with an unrelated suggestion. The model's own per-100 g
// estimate now prices a clearly identified food; unknown names stay unresolved.
{
  const { aiEstimateFacts } = await import('../server/core.mjs');
  const frikadellen = { name: 'Frikadellen mit Tomatensauce', searchTermEn: 'meatballs in tomato sauce', estimatedGrams: 250, confidence: 'medium', optional: false,
    estimatedPer100g: { calories: 190, protein: 12, carbs: 6, fat: 13 } };
  const priced = buildMealItem(frikadellen, aiEstimateFacts(frikadellen), 0);
  assert.equal(needsIngredientCorrection(priced), false, 'an identified dish without database row is still counted');
  assert.equal(priced.included, true);
  assert.equal(priced.calories, 475);
  assert.equal(priced.source.provider, 'kandro-catalog');
  assert.equal(aiEstimateFacts({ ...frikadellen, searchTermEn: 'unknown' }), null, 'an unknown name never gets an invented value');
  assert.equal(aiEstimateFacts({ ...frikadellen, estimatedPer100g: { calories: 40, protein: 12, carbs: 6, fat: 13 } }), null, 'energy must agree with macros');
  assert.equal(aiEstimateFacts({ ...frikadellen, estimatedPer100g: undefined }), null, 'older providers without estimate stay unchanged');
  console.log('PASS: identified dishes without database rows are priced from the checked model estimate; unknown names stay unresolved.');
}

// Regression 04.10.: an estimate reached a client that only accepts database
// providers and the whole description failed as "invalid". Old clients now
// keep the correction flow; new clients announce estimates and accept them.
{
  const { forEstimateProtocol } = await import('../server/core.mjs');
  const detection = { title: 'Frühstück', items: [{ name: 'Chiasamen-Pudding', searchTermEn: 'chia pudding', estimatedPer100g: { calories: 150, protein: 5, carbs: 12, fat: 9 } }] };
  assert.equal(forEstimateProtocol(detection, {}).items[0].estimatedPer100g, undefined, 'legacy clients never receive estimate-priced items');
  assert.ok(forEstimateProtocol(detection, { estimates: 1 }).items[0].estimatedPer100g, 'estimate-capable clients keep the estimate');
  const client = readFileSync(new URL('../src/services/mealAnalysis.ts', import.meta.url), 'utf8');
  assert.match(client, /\['bls','usda','open-food-facts','manual','kandro-catalog'\]\.includes\(result\.source\?\.provider\)/, 'the app accepts Kandro estimates');
  assert.equal((client.match(/captureProtocol: 2, estimates: 1/g) ?? []).length, 2, 'photo and description announce the estimate protocol');
  console.log('PASS: estimate protocol is negotiated; legacy clients keep correction drafts, new clients accept estimates.');
}

// "Amount unclear" is no longer a dead end (owner goal: AI success > 85 %).
// The gateway answers amount ambiguity with the recognised foods at typical
// grams, flagged estimatedPortion and still refunded; the app lands on Confirm
// with "Portion geschätzt" and a three-state confidence badge.
{
  const { analysisResultBody } = await import('../server/core.mjs');
  const detection = { title: 'Reis mit Hähnchen', confidence: 'high', amountFallback: true, items: [] };
  const body = analysisResultBody(detection, [known], ['amount_estimated'], 1);
  assert.equal(body.estimatedPortion, true);
  assert.equal(body.correctionRequired, true, 'correction-capable clients keep the refunded (free) bucket');
  assert.equal(body.confidence, 'medium');
  assert.equal(analysisResultBody(detection, [known], [], undefined).correctionRequired, undefined, 'legacy clients never receive a correction flag');
  assert.equal(analysisResultBody({ ...detection, amountFallback: false }, [known], [], 1).estimatedPortion, undefined, 'a bound amount is not an estimate');
  const edge = read('supabase/functions/nutrition/index.ts');
  assert.match(edge, /body: analysisResultBody\(detection, items, warnings, correctionProtocol\)/, 'the edge function uses the shared shaping');
  assert.match(read('server/index.mjs'), /body: analysisResultBody\(detection, items, warnings, correctionProtocol\)/, 'the local gateway uses the shared shaping');

  const context = read('src/context/AppContext.tsx');
  assert.match(context, /AMOUNT_ERROR_CODES = new Set\(\['mass_required', 'amount_ambiguous', 'amount_out_of_range'\]\)/);
  assert.match(context, /activeScanMode === 'description' && AMOUNT_ERROR_CODES\.has\(failure\.code \?\? ''\)\s*\? estimateDescriptionPortions\(descriptionInput/, 'an older gateway 422 still lands on Confirm');
  assert.match(context, /resolveUnmatchedItems\(result\.items, foodUsage\(mealHistory\)\)/, 'unpriced rows are matched on the device');
  assert.match(context, /setPortionEstimated\(result\.estimatedPortion === true/);

  const { draftConfidence } = compile(read('src/utils/ingredientCorrection.ts').replace(/^import[^;]+;$/gm, '') + read('src/utils/confidence.ts').replace(/^import[^;]+;$/gm, ''));
  const sure = { ...known, confidence: 'high', included: true };
  assert.equal(draftConfidence([sure]), 'sure');
  assert.equal(draftConfidence([sure], { portionEstimated: true }), 'estimated');
  assert.equal(draftConfidence([{ ...sure, confidence: 'medium' }]), 'estimated');
  assert.equal(draftConfidence([sure], { uncertainHint: true }), 'estimated', 'a wide portion range is an estimate');
  assert.equal(draftConfidence([sure, unknown]), 'check');
  assert.equal(draftConfidence([sure], { autoMatchedIds: [sure.id] }), 'check', 'a row Kandro matched itself asks for a glance');
  assert.equal(draftConfidence([{ ...unknown, included: false }, sure]), 'check', 'an excluded unresolved row still blocks saving');
  assert.equal(draftConfidence([{ ...sure, id: 'off', confidence: 'medium', included: false }, sure]), 'sure', 'an excluded estimate does not count');

  const confirm = read('src/app/confirm.tsx');
  assert.match(confirm, /t\.confirm\.portionEstimated/);
  for (const hint of ['warnWidePortion', 'warnAmountEstimated', 'warnMilkVolume', 'warnDrinkVolume']) {
    assert.ok(confirm.includes(`t.errors.${hint}`), `confirm shows ${hint}`);
  }
  for (const [file, dictionary] of [['de', /confidenceSure: 'Sicher'[\s\S]*confidenceEstimated: 'Geschätzt'[\s\S]*confidenceCheck: 'Bitte prüfen'[\s\S]*portionEstimated: 'Portion geschätzt – tippe zum Anpassen'/], ['en', /confidenceSure: 'Confident'[\s\S]*portionEstimated: 'Portion estimated – tap to adjust'/]]) {
    assert.match(read(`src/i18n/${file}.ts`), dictionary);
  }

  const analyzing = read('src/app/analyzing.tsx');
  assert.doesNotMatch(analyzing, /stage1|setVisible/, 'no fake step progress');
  assert.match(analyzing, /const SLOW_AFTER_MS = 15_000;/);
  assert.match(analyzing, /t\.analyzing\.cancelDescribe/);
  assert.match(analyzing, /analysisError === 'unclear-image' && scanMode !== 'description'[\s\S]{0,400}t\.analyzing\.retakePhoto[\s\S]{0,300}t\.analyzing\.describeInstead/, 'an unclear photo offers retake and describe');
  assert.match(read('src/services/mealAnalysis.ts'), /}, 90_000\);/, 'the 90 s request deadline is unchanged');
  console.log('PASS: amount ambiguity returns estimated portions; three-state confidence; honest analysis progress.');
}
