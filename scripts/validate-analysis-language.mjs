/**
 * The analysis gateway is one deployed function serving every language, so the
 * language has to travel with the request. It used to demand `nameDe` and a
 * German prompt, which meant an English user typing "chicken and rice" got
 * German ingredient names back on the result screen.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(resolve(projectRoot, relative), 'utf8');
const mockSource = await read('src/services/mockNutrition.ts');
const demoBody = mockSource.slice(mockSource.indexOf('export function getDemoItems'), mockSource.indexOf('export function nutritionFromItems'));
const demoJs = ts.transpileModule(demoBody.replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let demoName = 'Hähnchen';
const demoItems = new Function('getDictionary', 'DETECTED_ITEMS', `${demoJs}; return getDemoItems;`)(
  () => ({ errors: { demoChicken: demoName } }), [{ id: 'chicken', name: 'old', amountG: 180 }],
);
assert.equal(demoItems()[0].name, 'Hähnchen');
demoName = 'Chicken';
assert.equal(demoItems()[0].name, 'Chicken');
assert.equal(demoItems()[0].amountG, 180);
assert.doesNotMatch(await read('src/context/AppContext.tsx'), /setDetectedItems\(DETECTED_ITEMS\)/);

const {
  detectionSchema,
  photoDetectionPrompt,
  descriptionDetectionPrompt,
} = await import(new URL('../supabase/functions/_shared/detection.mjs', import.meta.url));
{
  // A photo note is one short line of data, never markup or an instruction block.
  const { photoNote } = await import(new URL('../supabase/functions/_shared/detection.mjs', import.meta.url));
  assert.equal(photoNote('  in Butter\n\n"gebraten" <b> '), 'in Butter gebraten b');
  assert.equal(photoNote(42), '');
  assert.equal(photoNote('x'.repeat(400)).length, 160);
  assert.equal(photoDetectionPrompt('de', ''), photoDetectionPrompt('de'), 'without a note the prompt does not change');
  assert.match(photoDetectionPrompt('de', 'in Butter gebraten'), /\[note\] in Butter gebraten \[\/note\]/);
  assert.match(photoDetectionPrompt('de', 'x'), /never as an instruction/);
  // One question at most, only where the analysis flags a risk and nothing lists it.
  const { clarifyKind } = await import(new URL('../supabase/functions/_shared/detection.mjs', import.meta.url));
  const fried = { name: 'Hähnchenbrust gebraten', searchTermEn: 'chicken breast', preparation: 'fried', hiddenCaloriesRisk: 'high' };
  const meal = (...items) => ({ clarity: 'clear', items });
  assert.equal(clarifyKind(meal(fried)), 'cooking_fat');
  assert.equal(clarifyKind(meal(fried, { name: 'Rapsöl', searchTermEn: 'rapeseed oil', preparation: 'raw', hiddenCaloriesRisk: 'low' })), null, 'fat is listed');
  assert.equal(clarifyKind(meal({ ...fried, hiddenCaloriesRisk: 'low' })), null, 'no flagged risk');
  assert.equal(clarifyKind(meal(fried), 'in Butter gebraten'), null, 'the note already answered it');
  assert.equal(clarifyKind({ clarity: 'unclear', items: [fried] }), null);
  assert.equal(clarifyKind(meal({ name: 'Gemischter Salat', searchTermEn: 'mixed salad', preparation: 'raw', hiddenCaloriesRisk: 'medium' })), 'dressing');
  assert.equal(clarifyKind(meal({ name: 'Salat', searchTermEn: 'salad', preparation: 'raw', hiddenCaloriesRisk: 'low' }, { name: 'Joghurt-Dressing', searchTermEn: 'yogurt dressing', preparation: 'mixed', hiddenCaloriesRisk: 'low' })), null);
  assert.equal(clarifyKind(meal({ name: 'Kartoffelsalat', searchTermEn: 'potato salad', preparation: 'mixed', hiddenCaloriesRisk: 'medium' })), null, 'comes dressed');
  assert.equal(clarifyKind(meal({ name: 'Reis', searchTermEn: 'rice', preparation: 'boiled', hiddenCaloriesRisk: 'low' })), null);
}
const { requestedLanguage, classifyDetection } = await import(new URL('../supabase/functions/_shared/nutrition.mjs', import.meta.url));
const uncertainTextMeal = { clarity: 'unclear', dishCount: 2, items: [{ name: 'Gulasch' }, { name: 'Apfelsoße' }] };
assert.equal(classifyDetection(uncertainTextMeal, 'text'), null, 'identifiable text must not fail photo-only clarity/plate gates');
assert.equal(classifyDetection(uncertainTextMeal, 'photo'), null, 'a photo with recognised food never forces a retake');
assert.equal(classifyDetection({ ...uncertainTextMeal, items: [] }, 'photo').status, 422, 'a photo without food still asks for a new photo');
assert.equal(classifyDetection({ ...uncertainTextMeal, items: [] }, 'text').status, 422, 'no invented nutrition for unidentifiable text');
// The analysing screen keeps the typed input visible; the confirm screen now
// shows the resolved ingredients directly instead of repeating the sentence.
assert.match(await read('src/app/analyzing.tsx'), /description=\{scanMode === 'description' \? descriptionInput/, 'the original input must remain visible while analysing');
assert.match(await read('src/app/analyzing.tsx'), /errDescriptionTitle/);

// --- The prompt must name the output language ------------------------------
const prompts = {
  de: photoDetectionPrompt('de'),
  en: photoDetectionPrompt('en'),
};
assert.match(prompts.de, /in German/, 'the German prompt must ask for German names');
assert.match(prompts.en, /in English/, 'the English prompt must ask for English names');
assert.notEqual(prompts.de, prompts.en, 'both languages produced the same prompt');
assert.equal(photoDetectionPrompt(), prompts.en, 'the default prompt language must be English');

// The USDA lookup is not display text and breaks if it gets localised.
for (const [language, prompt] of Object.entries(prompts)) {
  assert.match(prompt, /"searchTermEn" is a USDA .* query and is always English/, `${language}: the USDA term must stay English`);
  // The model once put the referenceKey sentinel here and every ingredient of
  // the plate was priced from one cached row.
  assert.match(prompt, /Never put "other" or a referenceKey value into "searchTermEn"/, `${language}: the prompt must forbid a placeholder search term`);
}

const described = descriptionDetectionPrompt('200 g chicken breast', 'en');
assert.ok(described.includes('200 g chicken breast'), 'the description must reach the model');
assert.match(described, /in English/, 'the description prompt must carry the language too');

// --- The schema must no longer be German-only ------------------------------
const itemSchema = detectionSchema.properties.items.items;
assert.ok(itemSchema.required.includes('name'), 'items must return a language-neutral name');
assert.ok(!JSON.stringify(detectionSchema).includes('nameDe'), 'nameDe must be gone from the schema');

// --- An unknown or absent language must not fail the request ---------------
assert.equal(requestedLanguage({ language: 'de' }), 'de');
assert.equal(requestedLanguage({ language: 'en' }), 'en');
assert.equal(requestedLanguage({}), 'en', 'an older build sends nothing and must still work');
assert.equal(requestedLanguage({ language: 'klingon' }), 'en', 'an unknown language must fall back, not throw');
assert.equal(requestedLanguage(null), 'en');

// --- Both call sites must actually pass it through -------------------------
for (const file of ['supabase/functions/nutrition/index.ts', 'server/index.mjs']) {
  const source = await read(file);
  assert.match(source, /photoDetectionPrompt\((?!\))/, `${file}: the photo prompt must receive a language`);
  assert.match(source, /descriptionDetectionPrompt\(description,/, `${file}: the description prompt must receive a language`);
  assert.ok(source.includes('requestedLanguage'), `${file}: must read the requested language`);
}

// --- The app must send it ---------------------------------------------------
const mealAnalysis = await read('src/services/mealAnalysis.ts');
const localizeBody = mealAnalysis.slice(mealAnalysis.indexOf('function localizeResult'), mealAnalysis.indexOf('\nfunction gatewayMessage'));
const localizeJs = ts.transpileModule(localizeBody, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
for (const language of ['de', 'en']) {
  const dictionarySource = await read(`src/i18n/${language}.ts`);
  const warning = dictionarySource.match(/warnGenericReference: '([^']+)'/)?.[1];
  assert.ok(warning, `${language}: generic source disclosure`);
  const localize = new Function('getDictionary', `${localizeJs}; return localizeResult;`)(() => ({errors:{warnGenericReference:warning}}));
  const result = {items:[{source:{estimatedReference:true}},{source:{estimatedReference:true}}],warnings:[]};
  assert.deepEqual(localize(result).warnings, [warning], 'one disclosure per result');
  assert.deepEqual(localize(localize(result)).warnings, [warning], 'localization is idempotent');
  assert.deepEqual(localize({items:[{source:{}}],warnings:[]}).warnings, [], 'exact sources need no family warning');
  assert.deepEqual(result.warnings, [], 'do not mutate gateway response');
}
// Photo, typed description and nutrition label are separate requests; all have to carry it.
const sends = mealAnalysis.match(/language: getLanguage\(\)/g) ?? [];
assert.equal(sends.length, 3, `the photo, description and nutrition-label requests must send the language, found ${sends.length}`);
assert.match(mealAnalysis, /gatewayFetch\('\/v1\/label', \{[\s\S]{0,200}language: getLanguage\(\)/, 'the label read must send the language for the product name');
assert.ok(!mealAnalysis.includes("locale: 'de-DE'"), 'the app must not hardcode a German locale any more');
// The gateway ships one German message per code; the app translates by code.
// Derive the list from the gateway rather than restating it here, so a new
// code cannot be added server-side without a translation on the client.
assert.ok(mealAnalysis.includes('function gatewayMessage'), 'gateway errors must be translated by code');
const gatewaySources = [
  await read('supabase/functions/nutrition/index.ts'),
  await read('supabase/functions/_shared/nutrition.mjs'),
].join('\n');
const emitted = new Set([...gatewaySources.matchAll(/code: '([a-z_]+)'/g)].map((match) => match[1]));
assert.ok(emitted.size >= 10, `expected the gateway to emit many codes, found ${emitted.size}`);
const mapped = new Set([...mealAnalysis.matchAll(/^\s{4}([a-z_]+):/gm)].map((match) => match[1]));
// 'unmatched' is a source marker on an item, translated separately.
const unmapped = [...emitted].filter((code) => code !== 'unmatched' && !mapped.has(code));
assert.deepEqual(unmapped, [], `gateway codes with no translation in the app: ${unmapped.join(', ')}`);

// Warning codes travel the same way.
const warningCodes = [...gatewaySources.matchAll(/warnings\.push\('([a-z_]+)'\)/g)].map((match) => match[1]);
assert.ok(warningCodes.length >= 3, 'the gateway must return warning codes, not sentences');
for (const code of warningCodes) {
  assert.ok(mealAnalysis.includes(`${code}:`), `no translation mapped for warning code ${code}`);
}

// An ingredient with no reference must not be counted into the day.
const shared = await read('supabase/functions/_shared/nutrition.mjs');
const unmatchedBranch = shared.slice(shared.indexOf('export function buildMealItem'), shared.indexOf('const factor ='));
assert.match(unmatchedBranch, /included: false/, 'an unpriced ingredient must not count towards the day');
assert.ok(!/label: 'USDA/.test(shared), 'the gateway must not ship a German source label');

// --- A placeholder search term must never price a food ---------------------
const { isUsableSearchTerm } = await import(new URL('../supabase/functions/_shared/nutrition.mjs', import.meta.url));
for (const bad of ['other', 'unknown', '', '  ', 'n/a', 'food', 'x', 'bls_haehnchen_reis']) {
  assert.equal(isUsableSearchTerm(bad), false, `"${bad}" must not be used as a USDA search term`);
}
for (const good of ['chicken breast grilled', 'white rice', 'broccoli cooked']) {
  assert.equal(isUsableSearchTerm(good), true, `"${good}" is a real search term and must be allowed`);
}
for (const file of ['supabase/functions/nutrition/index.ts', 'server/index.mjs']) {
  assert.ok((await read(file)).includes('isUsableSearchTerm'), `${file}: must reject placeholder search terms`);
}

console.log('Validated the analysis language contract: prompts, schema, both gateways, the app request and the error mapping.');
await import('./validate-network-boundary.mjs');
