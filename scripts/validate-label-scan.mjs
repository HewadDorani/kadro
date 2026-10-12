#!/usr/bin/env node
/**
 * "Nährwerttabelle fotografieren" and "Mein Produkt".
 *
 * A product the databases do not know is read from the label the user
 * photographed. That is only honest if (1) the read passes deterministic
 * plausibility checks, (2) the user confirms every value, (3) it runs behind
 * the same auth/consent/paywall/quota/refund path as a meal photo, and (4) the
 * saved product is the user's own data: owner-only RLS, deleted with the
 * account, removed locally on reset/switch. This pins all four with the real
 * shared modules, the real Edge handler (synthetic Auth/RPC/transport) and the
 * real client services (mocked native boundaries). Zero external HTTP.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID, webcrypto } from 'node:crypto';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const label = await import('../supabase/functions/_shared/label-facts.mjs');
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log('PASS', name); };

// --- 1. Plausibility checker ------------------------------------------------
const read100 = { readable: true, basis: 'per_100g', productName: 'Skyr Natur', brand: 'Ehrmann', energyKcal: 63, energyKj: 267, fat: 0.2, saturatedFat: 0.1, carbs: 4, sugar: 4, fiber: null, protein: 11, salt: 0.1, servingSizeG: 150, servingLabel: '1 Becher', packageSizeG: 450 };
await test('a per-100 g label passes Atwater and keeps every printed value', () => {
  const out = label.normalizeLabelRead(label.validateLabelRead(structuredClone(read100)));
  assert.deepEqual(out.values, { calories: 63, protein: 11, carbs: 4, sugar: 4, fat: 0.2, saturatedFat: 0.1, fiber: null, salt: 0.1 });
  assert.deepEqual(out.missing, []);
  assert.equal(out.plausibility.plausible, true, JSON.stringify(out.plausibility));
  assert.equal(out.plausibility.atwaterKcal, 62);
  assert.deepEqual(out.serving, { grams: 150, label: '1 Becher' });
  assert.equal(out.packageG, 450);
  assert.equal(out.name, 'Skyr Natur');
});
await test('per-serving tables are converted to 100 g; kJ-only energy is converted (÷ 4.184), never guessed', () => {
  const serving = label.normalizeLabelRead({ ...read100, basis: 'per_serving', servingSizeG: 40, energyKcal: 180, protein: 8, carbs: 20, sugar: 6, fat: 7, saturatedFat: 1, fiber: 2, salt: 0.2 });
  assert.deepEqual([serving.values.calories, serving.values.protein, serving.values.fat], [450, 20, 17.5]);
  assert.equal(label.normalizeLabelRead({ ...read100, basis: 'per_serving', servingSizeG: null }).code, 'label_unreadable');
  const kj = label.normalizeLabelRead({ ...read100, energyKcal: null, energyKj: 418.4 });
  assert.equal(kj.values.calories, 100); assert.equal(kj.energyFromKj, true);
});
await test('volume-based, unreadable and incomplete tables are never turned into a fabricated product', () => {
  assert.equal(label.normalizeLabelRead({ ...read100, basis: 'per_100ml' }).code, 'label_volume_basis');
  assert.equal(label.normalizeLabelRead({ ...read100, readable: false }).code, 'label_unreadable');
  assert.equal(label.normalizeLabelRead({ ...read100, basis: 'unclear' }).code, 'label_unreadable');
  assert.deepEqual(label.normalizeLabelRead({ ...read100, protein: null, fat: null }).missing, ['protein', 'fat']);
  for (const broken of [{ ...read100, protein: -1 }, { ...read100, basis: 'per_kg' }, { ...read100, fat: '3' }, { ...read100, brand: 5 }, null, []]) {
    assert.throws(() => label.validateLabelRead(broken), /provider_response_invalid/);
  }
});
await test('Atwater mismatch warns; impossible values block saving', () => {
  const mismatch = label.labelPlausibility({ calories: 400, protein: 10, carbs: 10, fat: 1 });
  assert.deepEqual(mismatch.issues, ['energy_macro_mismatch']); assert.deepEqual(mismatch.blocking, []);
  // Small foods: absolute tolerance (rounded labels), e.g. a 15 kcal drink.
  assert.equal(label.labelPlausibility({ calories: 15, protein: 0, carbs: 0.5, fat: 0 }).plausible, true);
  // Fibre counts 2 kcal/g (EU 1169/2011 Annex XIV).
  assert.equal(label.labelPlausibility({ calories: 370, protein: 13, carbs: 59, fat: 7, fiber: 10 }).plausible, true);
  const cases = { sugar_exceeds_carbs: { calories: 100, protein: 0, carbs: 5, sugar: 9, fat: 0 }, saturated_exceeds_fat: { calories: 100, protein: 0, carbs: 20, fat: 2, saturatedFat: 4 },
    mass_exceeds_100g: { calories: 900, protein: 50, carbs: 40, fat: 30 }, energy_too_high: { calories: 1200, protein: 0, carbs: 0, fat: 100 } };
  for (const [code, values] of Object.entries(cases)) assert.ok(label.labelPlausibility(values).blocking.includes(code), code);
  assert.deepEqual(label.labelPlausibility({ calories: 100, energyKj: 900, protein: 5, carbs: 15, fat: 2 }).issues, ['energy_units_mismatch']);
});

// --- 2. Form defaults and confirmation ---------------------------------------
await test('form defaults: German decimal comma, linked barcode, empty unknowns; confirmation parses "<0,5" and commas', () => {
  const defaults = label.labelFormDefaults(label.normalizeLabelRead(read100), { barcode: '4002971104202', language: 'de' });
  assert.equal(defaults.fat, '0,2'); assert.equal(defaults.calories, '63'); assert.equal(defaults.fiber, '');
  assert.equal(defaults.servingG, '150'); assert.equal(defaults.packageG, '450'); assert.equal(defaults.barcode, '4002971104202');
  assert.equal(label.labelFormDefaults(label.normalizeLabelRead(read100), { barcode: 'abc', language: 'en' }).barcode, '');
  assert.equal(label.labelFormDefaults(label.normalizeLabelRead(read100), { language: 'en' }).fat, '0.2');
  assert.equal(label.parseLabelNumber('<0,5'), 0.5); assert.equal(label.parseLabelNumber(''), null); assert.ok(Number.isNaN(label.parseLabelNumber('zwölf')));
  const ok = label.customFoodFromForm({ ...defaults, salt: '<0,1' });
  assert.equal(ok.food.per100g.salt, 0.1); assert.equal(ok.food.barcode, '4002971104202'); assert.equal(ok.food.servingG, 150);
  assert.deepEqual(label.customFoodFromForm({ ...defaults, name: ' ', protein: '' }).errors, ['name', 'protein']);
  assert.ok(label.customFoodFromForm({ ...defaults, sugar: '9' }).errors.includes('sugar_exceeds_carbs'));
  assert.ok(label.customFoodFromForm({ ...defaults, servingG: '0' }).errors.includes('servingG'));
});

// --- 3. Migration: owner RLS, revoked anon, account cascade ------------------
const migration = read('supabase/migrations/20261010130000_custom_foods_and_off_cache.sql');
await test('custom_foods migration: owner-only RLS, revoked anon/public, FK cascade, physical checks; OFF cache service-only', () => {
  assert.match(migration, /create table public\.custom_foods \(\s*user_id uuid not null references auth\.users \(id\) on delete cascade/);
  assert.match(migration, /alter table public\.custom_foods enable row level security/);
  assert.match(migration, /revoke all on table public\.custom_foods from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.custom_foods to authenticated/);
  for (const action of ['select', 'insert', 'update', 'delete']) {
    assert.match(migration, new RegExp(`create policy custom_foods_${action}_own on public\\.custom_foods\\s+for ${action} to authenticated\\s+(using|with check) \\(\\(select auth\\.uid\\(\\)\\) is not null and \\(select auth\\.uid\\(\\)\\) = user_id\\)`));
  }
  assert.ok(!/to anon|to public/i.test(migration.replace(/--[^\n]*/g, '')), 'nothing may be granted to anon/public');
  for (const check of ['sugar <= carbs + 0.5', 'saturated_fat <= fat + 0.5', 'calories between 0 and 950', "barcode ~ '^[0-9]{7,14}$'"]) assert.ok(migration.includes(check), check);
  assert.match(migration, /custom_foods_user_barcode_idx on public\.custom_foods \(user_id, barcode\) where barcode is not null/);
  assert.match(migration, /create table public\.off_product_cache[\s\S]*alter table public\.off_product_cache enable row level security;\s*revoke all on table public\.off_product_cache from public, anon, authenticated;/);
  assert.ok(!/grant [^;]* on table public\.off_product_cache/i.test(migration), 'the OFF cache is service-role only');
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
});
await test('account deletion and switching remove own products everywhere', () => {
  const local = read('src/services/localRepository.ts');
  const clear = local.slice(local.indexOf('export async function clearLocalKandroData'), local.indexOf('export type PendingLocalAccountSwitch'));
  assert.match(clear, /CUSTOM_FOODS_KEY/, 'reset/deletion must remove local own products');
  const replace = local.slice(local.indexOf('export function replaceLocalAccountData'));
  assert.match(replace, /CUSTOM_FOODS_KEY/, 'switching accounts must remove the previous account\'s products');
  const service = read('src/services/customFoods.ts');
  assert.match(service, /subscribePrivateDataInvalidation\(async \(\) => \{[\s\S]*foods = null;/, 'the in-memory list must be dropped on invalidation');
  // Server side: FK cascade (asserted above) plus the delete-account function deleting the auth user.
  assert.match(read('supabase/functions/delete-account/index.ts'), /auth\.admin\.deleteUser\(data\.user\.id\)/);
});

// --- 4. The real Edge handler: /v1/label behind the analysis path ------------
const source = read('supabase/functions/nutrition/index.ts');
let appAccess = { hard: false, access: 'free', variant: 'excluded' };
let consented = true; let rpcCalls = []; let providerCalls = 0; let lastBody = null;
let modelOutput = read100;
const rpc = async (name) => {
  rpcCalls.push(name);
  if (['record_paywall_prior_use_v1', 'resolve_paywall_access_v1'].includes(name)) return { data: appAccess, error: null };
  const statuses = { lookup_capture_operation: 'missing', reserve_capture_operation: 'claimed', reserve_analysis_access: 'reserved', consume_global_analysis_quota: 'allowed', mark_analysis_request_started: 'started', finish_capture_operation: 'completed', complete_analysis_request: 'completed' };
  return { data: name === 'consume_analysis_quota' ? 1 : { status: statuses[name] ?? 'allowed' }, error: null };
};
const query = { abortSignal() { return this; }, select() { return this; }, eq() { return this; }, in() { return this; }, upsert() { return this; },
  async maybeSingle() { return { data: { age: 30, privacy_version: consented ? '2026-10-09-ai-v3' : 'old', wellness_consent_at: 'synthetic' }, error: null }; },
  then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
const context = { supabase: { auth: { getUser: async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000001' } }, error: null }) }, from: () => query, rpc }, supabaseAdmin: { from: () => query, rpc } };
const imports = {};
for (const [, id] of source.matchAll(/from '([^']+)'/g)) imports[id] = id.startsWith('npm:') ? { withSupabase: (_o, fn) => (request) => fn(request, context) } : await import(new URL('../supabase/functions/nutrition/' + id, import.meta.url));
const fakeFetch = async (url, init) => {
  providerCalls += 1;
  assert.match(String(url), /^https:\/\/openrouter\.ai\/api\/v1\/responses$/, 'label reads use the disclosed default route only');
  lastBody = JSON.parse(init.body);
  return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(modelOutput) }));
};
const module = { exports: {} };
const env = { OPENROUTER_API_KEY: 'synthetic', NUTRITION_RATE_LIMIT_SALT: 'synthetic-local-test-only-salt-long-enough' };
new Function('require', 'module', 'exports', 'Deno', 'crypto', 'fetch', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((id) => imports[id], module, module.exports, { env: { get: (key) => env[key] } }, webcrypto, fakeFetch);
globalThis.fetch = fakeFetch;
const gateway = module.exports.default;
// Smallest structurally valid JPEG framing the gateway accepts (base64 of FFD8FF … FFD9).
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 1), Buffer.from([0xff, 0xd9])]).toString('base64');
const post = async (body) => {
  const response = await gateway.fetch(new Request('http://localhost/nutrition/v1/label', { method: 'POST', headers: { 'x-real-ip': '127.0.0.1' }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};
const request = (extra = {}) => ({ imageBase64: jpeg, mimeType: 'image/jpeg', language: 'de', requestId: randomUUID(), captureProtocol: 2, ...extra });

await test('/v1/label: a readable table costs one analysis through the shared reserve/quota/complete path', async () => {
  rpcCalls = []; const before = providerCalls;
  const result = await post(request({ barcode: '4002971104202' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.label.values.protein, 11); assert.equal(result.body.label.barcode, '4002971104202');
  assert.equal(result.body.correctionRequired, undefined);
  assert.equal(providerCalls, before + 1);
  for (const name of ['record_paywall_prior_use_v1', 'reserve_analysis_access', 'consume_analysis_quota', 'consume_global_analysis_quota', 'mark_analysis_request_started', 'complete_analysis_request']) assert.ok(rpcCalls.includes(name), name);
  assert.ok(!rpcCalls.includes('refund_analysis_request'));
  assert.equal(lastBody.model, 'openai/gpt-4.1-mini'); assert.equal(lastBody.store, false);
  assert.deepEqual(lastBody.provider, { data_collection: 'deny', only: ['azure'], allow_fallbacks: false, zdr: true });
  assert.equal(lastBody.text.format.name, 'kandro_label_read'); assert.equal(lastBody.text.format.strict, true);
});
await test('/v1/label: unreadable or per-100 ml tables are refunded; an incomplete read returns values to complete and is refunded', async () => {
  for (const [output, code] of [[{ ...read100, readable: false }, 'label_unreadable'], [{ ...read100, basis: 'per_100ml' }, 'label_volume_basis']]) {
    modelOutput = output; rpcCalls = [];
    const result = await post(request());
    assert.equal(result.status, 422); assert.equal(result.body.code, code);
    assert.ok(rpcCalls.includes('refund_analysis_request'), code);
  }
  modelOutput = { ...read100, fat: null }; rpcCalls = [];
  const partial = await post(request());
  assert.equal(partial.status, 200); assert.equal(partial.body.correctionRequired, true); assert.deepEqual(partial.body.label.missing, ['fat']);
  assert.ok(rpcCalls.includes('refund_analysis_request'));
  modelOutput = read100;
});
await test('/v1/label: invalid photos, barcodes and oversize fronts never reach the model or the quota', async () => {
  const before = providerCalls; rpcCalls = [];
  for (const body of [request({ imageBase64: 'abcd' }), request({ mimeType: 'image/png' }), request({ barcode: '12' }), request({ frontImageBase64: 'x'.repeat(1_600_000) })]) {
    const result = await post(body);
    assert.ok([400, 413].includes(result.status), JSON.stringify(result.body));
  }
  assert.equal(providerCalls, before); assert.ok(!rpcCalls.includes('reserve_analysis_access'));
});
await test('/v1/label: hard paywall and missing consent stop it before any reservation (existing access rules unchanged)', async () => {
  appAccess = { hard: true, access: 'inactive', variant: 'B' }; rpcCalls = [];
  const blocked = await post(request());
  assert.equal(blocked.status, 402); assert.equal(blocked.body.code, 'paywall_access_required');
  assert.ok(!rpcCalls.includes('reserve_analysis_access'));
  appAccess = { hard: false, access: 'free', variant: 'excluded' };
  consented = false; assert.equal((await post(request())).status, 403); consented = true;
  // The candidate model switch is ignored for labels.
  const candidate = await post(request({ analysisProvider: 'google/gemini-3.8-flash' }));
  assert.equal(candidate.status, 200); assert.equal(lastBody.model, 'openai/gpt-4.1-mini');
});
await test('/v1/label is not on the free GET path and reuses the shared POST pipeline', () => {
  const getBlock = source.slice(source.indexOf("if (request.method === 'GET') {"), source.indexOf("if (request.method !== 'POST')"));
  assert.ok(!getBlock.includes('/v1/label'));
  assert.match(source, /route !== '\/v1\/analyze' && route !== '\/v1\/describe' && route !== '\/v1\/label'/);
  assert.match(source, /result = route === '\/v1\/label'\s*\? await analyzeLabel\(payload, request\.signal\)/);
});

// --- 5. Client: own products, barcode link, quick add -------------------------
const storage = new Map();
let generation = 0; const invalidators = new Set();
const localRepository = {
  getLocalDataGeneration: () => generation,
  loadStoredCustomFoods: async () => JSON.parse(storage.get('custom') ?? '[]'),
  saveStoredCustomFoods: async (foods) => { storage.set('custom', JSON.stringify(foods)); },
  subscribePrivateDataInvalidation: (fn) => { invalidators.add(fn); return () => invalidators.delete(fn); },
};
const dictionary = { labelScan: { sourceLabel: 'Mein Produkt (Nährwerttabelle)', portionServing: (g) => `1 Portion (${g} g)`, portionPackage: (g) => `1 Packung (${g} g)` }, scan: {} };
function load(path, deps) {
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.endsWith('label-facts.mjs')) return label;
    assert.ok(id in deps, `Unmocked dependency ${id}`); return deps[id];
  }, mod, mod.exports);
  return mod.exports;
}
const requestId = load('src/utils/requestId.ts', {});
const custom = load('src/services/customFoods.ts', {
  '@/i18n/active': { getDictionary: () => dictionary }, '@/services/localRepository': localRepository,
  '@/services/supabaseClient': { supabase: null, isSupabaseConfigured: false, ensureSupabaseUser: async () => null }, '@/utils/requestId': requestId,
});
await test('Mein Produkt: saved locally, found by barcode and search, re-scan replaces, delete and invalidation remove it', async () => {
  const draft = { ...label.customFoodFromForm(label.labelFormDefaults(label.normalizeLabelRead(read100), { barcode: '4002971104202', language: 'de' })).food, origin: 'label' };
  const { food, cloud } = await custom.saveCustomFood(draft);
  assert.equal(cloud, false, 'without the cloud it stays a local product');
  assert.equal((await custom.findCustomFoodByBarcode('4002971104202')).id, food.id);
  const result = custom.customFoodResult(food);
  assert.equal(result.source.provider, 'manual'); assert.equal(result.source.referenceId, `custom-${food.id}`);
  assert.equal(result.name, 'Skyr Natur (Ehrmann)'); assert.equal(result.defaultGrams, 150);
  assert.deepEqual(result.portions.map((p) => p.grams), [150, 450]); assert.equal(result.barcode, '4002971104202');
  assert.equal(custom.matchCustomFoods('ehrm sky', custom.getCustomFoodsSnapshot())[0].id, result.id);
  assert.deepEqual(custom.matchCustomFoods('banane', custom.getCustomFoodsSnapshot()), []);
  const again = await custom.saveCustomFood({ ...draft, name: 'Skyr Natur 0,2 %' });
  assert.equal(again.food.id, food.id, 'a re-scanned barcode updates the same product');
  assert.equal(custom.getCustomFoodsSnapshot().length, 1);
  await assert.rejects(() => custom.saveCustomFood({ ...draft, per100g: { ...draft.per100g, sugar: 50 } }), /invalid_custom_food/);
  await custom.deleteCustomFood(food.id);
  assert.equal(await custom.findCustomFoodByBarcode('4002971104202'), null);
  await custom.saveCustomFood(draft);
  for (const fn of invalidators) await fn();
  assert.deepEqual(custom.getCustomFoodsSnapshot(), [], 'an account switch/reset never shows the previous products');
});
await test('barcode scans check the own product first; unknown barcodes offer the label scan', () => {
  const service = read('src/services/mealAnalysis.ts');
  const barcodeFn = service.slice(service.indexOf('export async function analyzeBarcode'), service.indexOf('export type FoodSearchResult'));
  assert.ok(barcodeFn.indexOf('findCustomFoodByBarcode(barcode)') < barcodeFn.indexOf('gatewayFetch('), 'own products answer before the network');
  assert.match(service, /gatewayFetch\('\/v1\/label', \{\s*method: 'POST'/);
  const analyzing = read('src/app/analyzing.tsx');
  assert.match(analyzing, /analysisError === 'product-not-found' && scanMode === 'barcode' \? <PrimaryButton[\s\S]*labelScanInstead/);
  const screen = read('src/app/label-scan.tsx');
  assert.match(screen, /if \(step === 'table' && !hasAccess\) \{ router\.push\('\/paywall\?reason=blocked'\)/, 'the read follows the meal-photo access gate');
  assert.match(screen, /if \(!correctionRequired\) await countLifetimeScanOnce\(requestId\)/, 'a complete read spends exactly one local analysis');
  assert.match(screen, /deleteTemporaryPhoto\(preview\);\s*forgetPhotos\(\);/, 'label photos are temporary like meal photos');
  for (const file of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
    const dictionaryText = read(file);
    for (const key of ['labelScanInstead', 'errProductTitle', 'reviewTitle', 'warnMismatch', 'gatewayLabelUnreadable', 'gatewayLabelVolume', 'quickAddCta', 'labelScanCta']) assert.ok(dictionaryText.includes(`${key}:`), `${file}: ${key}`);
  }
  assert.match(read('src/i18n/de.ts'), /errProductTitle: 'Produkt nicht gefunden'/);
});
await test('quick add: kcal 1–5000, protein optional and never more energy than the total', () => {
  const quick = load('src/components/QuickAddForm.tsx', {
    react: { useState: (v) => [v, () => {}] }, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null }, 'react-native': {},
    '@/components/ui': {}, '@/constants/theme': { typeScale: {} }, '@/context/ThemeContext': {}, '@/i18n/LanguageProvider': {}, '@/utils/requestId': requestId,
  });
  const labels = { defaultName: 'Schnelleintrag', source: 'Schnell eingetragen', portion: '1 Portion' };
  const food = quick.quickAddFood({ name: '', kcal: '450', protein: '25,5' }, labels);
  assert.equal(food.name, 'Schnelleintrag'); assert.equal(food.per100g.calories, 450); assert.equal(food.per100g.protein, 25.5);
  assert.equal(food.defaultGrams, quick.QUICK_ADD_GRAMS); assert.equal(food.source.provider, 'manual'); assert.ok(quick.isQuickAddResult(food));
  for (const input of [{ kcal: '' }, { kcal: '0' }, { kcal: '6000' }, { kcal: 'viel' }, { kcal: '100', protein: '40' }]) assert.equal(quick.quickAddFood({ name: '', protein: '', ...input }, labels), null, JSON.stringify(input));
  const scan = read('src/app/(tabs)/scan.tsx');
  assert.match(scan, /setQuickAddFor\(searchQuery\.trim\(\)\)/); assert.match(scan, /<QuickAddForm initialName=\{quickAddFor\}/);
});

globalThis.fetch = originalFetch;
console.log(JSON.stringify({ passed, scope: 'label plausibility, form defaults, RLS migration, deletion cascade, real Edge /v1/label path, own products, quick add; zero external HTTP' }));
