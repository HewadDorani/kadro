/**
 * Vision robustness contract: one automatic retry on transient provider
 * failures, tolerant JSON framing, no double charge of the user's allowance,
 * a stable output schema, faster lookups and a smaller client photo.
 *
 * Runs the shipped shared modules and the complete Edge handler with synthetic
 * Auth/RPC/transport. No external API is called.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID, webcrypto } from 'node:crypto';
import {
  AZURE_OPENAI_MODELS, CLAUDE_VISION_MODEL, DETECTION_MAX_OUTPUT_TOKENS, GEMINI_MODEL, ModelError,
  isRetryableModelError, modelRequest, parseModelJson, parseStructuredResponse,
  requestStructuredWithRetry, resolveFallbackModel,
} from '../supabase/functions/_shared/model-adapter.mjs';
import { detectionSchema, descriptionDetectionPrompt, photoDetectionPrompt, validateDetection } from '../supabase/functions/_shared/detection.mjs';
import { classifyDetection, mapBounded } from '../supabase/functions/_shared/nutrition.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
let count = 0;
const test = async (name, fn) => { await fn(); count++; console.log('PASS', name); };

const item = (name, grams = 100, extra = {}) => ({
  name, searchTermEn: name, referenceKey: 'other', estimatedGrams: grams, estimatedGramsLow: grams, estimatedGramsHigh: grams,
  preparation: 'raw', hiddenCaloriesRisk: 'low', confidence: 'medium', optional: false, pieceCount: null, pieceLabel: null,
  estimatedPer100g: { calories: 380, protein: 13, carbs: 60, fat: 7 }, ...extra,
});
const meal = { title: 'Synthetic meal', clarity: 'clear', dishCount: 1, confidence: 'medium', items: [item('oat flakes', 80)] };
const okResponse = (body = meal) => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(body) }));

await test('JSON framing repair: fences, trailing text, trailing commas; broken content still fails', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('```\n{"a":{"b":"}"}}\n```\nDone.'), { a: { b: '}' } });
  assert.deepEqual(parseModelJson('Here you go: {"a":[1,2,],}'), { a: [1, 2] });
  assert.deepEqual(parseModelJson('﻿{"a":"x, ]"} trailing words {"b":2}'), { a: 'x, ]' });
  for (const broken of ['', 'no json here', '{"a":', '{"a":1', '```json\n{"a":\n```', `${'x'.repeat(300)}{"a":1}`, '{"a":tru}', '[1, 2']) {
    assert.throws(() => parseModelJson(broken), /provider_response_invalid/, JSON.stringify(broken));
  }
  // Repair never relaxes the schema: a framed but invalid detection fails validation.
  const framed = parseStructuredResponse({ status: 'completed', output_text: '```json\n{}\n```' });
  assert.throws(() => validateDetection(framed), /provider_response_invalid/);
  assert.equal(validateDetection(parseStructuredResponse({ status: 'completed', output_text: '```json\n' + JSON.stringify(meal) + '\n```' })).title, meal.title);
  // Refusals and truncation are still classified before any parsing.
  assert.throws(() => parseStructuredResponse({ status: 'incomplete' }), /model_truncated/);
  assert.throws(() => parseStructuredResponse({ output: [{ content: [{ type: 'refusal' }] }] }), /model_refused/);
});

await test('fallback model stays on the Azure/ZDR route; Gemini can never be selected by secret', () => {
  assert.equal(resolveFallbackModel(undefined), null);
  assert.equal(resolveFallbackModel(''), null);
  assert.equal(resolveFallbackModel(GEMINI_MODEL), null);
  assert.equal(resolveFallbackModel('anthropic/claude-x'), null);
  assert.equal(resolveFallbackModel(' openai/gpt-4.1-nano '), 'openai/gpt-4.1-nano');
  for (const model of AZURE_OPENAI_MODELS) {
    const request = modelRequest({ model, content: [] });
    assert.deepEqual(request.body.provider, { data_collection: 'deny', only: ['azure'], allow_fallbacks: false, zdr: true });
    assert.equal(request.body.store, false);
    assert.equal(request.body.max_output_tokens, DETECTION_MAX_OUTPUT_TOKENS);
  }
  assert.ok(DETECTION_MAX_OUTPUT_TOKENS <= 1500 && DETECTION_MAX_OUTPUT_TOKENS >= 1400, 'cap sized to 12 schema items');
  assert.throws(() => modelRequest({ model: 'openai/gpt-5', content: [] }), /ai_provider_invalid/);
  assert.throws(() => modelRequest({ model: 'openai/gpt-4.1-nano', provider: 'openai', content: [] }), /ai_provider_invalid/);
  assert.throws(() => modelRequest({ content: [], maxOutputTokens: 50 }), /ai_provider_invalid/);
});

await test('retry classification: transient only, 429 only on a different model', () => {
  for (const code of ['provider_timeout', 'provider_error', 'provider_response_invalid', 'model_truncated']) assert.equal(isRetryableModelError(new ModelError(code)), true, code);
  for (const code of ['model_refused', 'ai_key_missing', 'ai_provider_invalid', 'ai_route_not_approved']) assert.equal(isRetryableModelError(new ModelError(code), true), false, code);
  assert.equal(isRetryableModelError(new ModelError('provider_rate_limited', 429)), false);
  assert.equal(isRetryableModelError(new ModelError('provider_rate_limited', 429), true), true);
  assert.equal(isRetryableModelError(new Error('provider_timeout')), false, 'only typed model errors');
});

const primary = { apiKey: 'synthetic', content: [{ type: 'input_text', text: 'p' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AA==', detail: 'high' }], model: 'openai/gpt-4.1-mini', timeoutMs: 1000 };
const retryOptions = { ...primary, content: [primary.content[0], { ...primary.content[1], detail: 'low' }], timeoutMs: 1000 };
const scripted = (...responses) => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  };
  return { bodies, fetchImpl };
};

await test('one automatic retry on the cheaper path; never a third attempt', async () => {
  let { bodies, fetchImpl } = scripted(new Response('{}', { status: 503 }), okResponse());
  let claims = 0;
  const attempts = [];
  const value = await requestStructuredWithRetry({
    primary: { ...primary, fetchImpl }, retry: { ...retryOptions, model: 'openai/gpt-4.1-nano', fetchImpl },
    beforeRetry: async () => { claims++; return true; }, onAttempt: (row) => attempts.push(row),
  });
  assert.equal(value.title, meal.title);
  assert.equal(bodies.length, 2);
  assert.equal(claims, 1, 'the retry claims the global breaker exactly once');
  assert.equal(bodies[0].input[0].content[1].detail, 'high');
  assert.equal(bodies[1].input[0].content[1].detail, 'low', 'retry sends the low-detail image');
  assert.equal(bodies[1].model, 'openai/gpt-4.1-nano');
  assert.deepEqual(bodies[1].provider.only, ['azure']);
  assert.deepEqual(attempts.map((row) => [row.attempt, row.outcome]), [[1, 'provider_error'], [2, 'ok']]);
  assert.ok(attempts.every((row) => Object.keys(row).sort().join() === 'attempt,model,ms,outcome'), 'timing rows carry fixed fields only');

  ({ bodies, fetchImpl } = scripted(new Response('{}', { status: 503 }), new Response('{}', { status: 502 }), okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl } }), /provider_error/);
  assert.equal(bodies.length, 2, 'at most two provider calls');

  // Framing slip on the first answer: fixed without any retry.
  ({ bodies, fetchImpl } = scripted(new Response(JSON.stringify({ status: 'completed', output_text: '```json\n' + JSON.stringify(meal) + '\n```' }))));
  claims = 0;
  await requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl }, beforeRetry: async () => { claims++; return true; } });
  assert.equal(bodies.length, 1); assert.equal(claims, 0);

  // Timeout on the first attempt is retried.
  ({ bodies, fetchImpl } = scripted(() => new Promise(() => {}), okResponse()));
  await requestStructuredWithRetry({ primary: { ...primary, timeoutMs: 5, fetchImpl }, retry: { ...retryOptions, fetchImpl } });
  assert.equal(bodies.length, 2);
});

await test('no retry when the breaker refuses, on refusals, on same-model 429, after abort or without time left', async () => {
  let { bodies, fetchImpl } = scripted(new Response('{}', { status: 503 }), okResponse());
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl }, beforeRetry: async () => false }), /provider_error/);
  assert.equal(bodies.length, 1, 'a refused global claim means no second provider call');
  ({ bodies, fetchImpl } = scripted(new Response('{}', { status: 503 }), okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl }, beforeRetry: async () => { throw new Error('rpc down'); } }), /provider_error/);
  assert.equal(bodies.length, 1, 'an unavailable breaker check also means no second call');

  ({ bodies, fetchImpl } = scripted(new Response(JSON.stringify({ output: [{ content: [{ type: 'refusal' }] }] })), okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl } }), /model_refused/);
  assert.equal(bodies.length, 1);

  ({ bodies, fetchImpl } = scripted(new Response('{}', { status: 429 }), okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl } }), /provider_rate_limited/);
  assert.equal(bodies.length, 1);
  ({ bodies, fetchImpl } = scripted(new Response('{}', { status: 429 }), okResponse()));
  await requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, model: 'openai/gpt-4o-mini', fetchImpl } });
  assert.equal(bodies.length, 2, '429 may move to the fallback deployment');

  const controller = new AbortController();
  ({ bodies, fetchImpl } = scripted(() => { controller.abort(); return new Response('{}', { status: 503 }); }, okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl }, signal: controller.signal }));
  assert.equal(bodies.length, 1, 'a cancelled request is not retried');

  let clock = 0;
  ({ bodies, fetchImpl } = scripted(() => { clock = 99_000; return new Response('{}', { status: 503 }); }, okResponse()));
  await assert.rejects(requestStructuredWithRetry({ primary: { ...primary, fetchImpl }, retry: { ...retryOptions, fetchImpl }, now: () => clock, deadline: 100_000 }), /provider_error/);
  assert.equal(bodies.length, 1, 'no retry with less than 4 s left');
});

await test('bounded parallel lookups keep order, respect the limit and stop on failure', async () => {
  let active = 0, peak = 0;
  const values = await mapBounded([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 8 - value));
    active--; return value * 10;
  });
  assert.deepEqual(values, [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapBounded([], 3, async () => 1), []);
  let started = 0;
  await assert.rejects(mapBounded([1, 2, 3, 4, 5, 6], 2, async (value) => { started++; if (value === 1) throw new Error('boom'); await new Promise((r) => setTimeout(r, 5)); }), /boom/);
  assert.ok(started <= 3, 'no new lookup starts after a failure');
});

await test('output schema stays stable; prompts carry portion, German dish, confidence and brand guidance', () => {
  assert.deepEqual(detectionSchema.required, ['title', 'clarity', 'dishCount', 'confidence', 'packagedProduct', 'items']);
  assert.deepEqual(detectionSchema.properties.items.items.required, [
    'name', 'searchTermEn', 'referenceKey', 'estimatedGrams', 'estimatedGramsLow', 'estimatedGramsHigh', 'preparation',
    'hiddenCaloriesRisk', 'confidence', 'optional', 'pieceCount', 'pieceLabel', 'estimatedPer100g',
  ]);
  assert.deepEqual(detectionSchema.properties.confidence.enum, ['high', 'medium']);
  assert.equal(detectionSchema.properties.items.maxItems, 12);
  for (const prompt of [photoDetectionPrompt('de'), photoDetectionPrompt('en'), descriptionDetectionPrompt('Döner mit allem', 'de')]) {
    for (const pattern of [/26 cm/, /household measures/, /package size/, /Count countable items/, /Döner/, /Currywurst/, /Brezel/, /Leberkäse/, /Schnitzel/, /Spätzle/, /Maultaschen/, /Mensa/, /bowl/i, /Drinks/, /top-level confidence is the total/, /never invent a brand/i, /up to 12 items/]) {
      assert.match(prompt, pattern, String(pattern));
    }
  }
  // Static rules first, then language, then user data: a stable cacheable prefix.
  const de = photoDetectionPrompt('de'), en = photoDetectionPrompt('en');
  const shared = de.slice(0, de.indexOf('"title" and every item'));
  assert.ok(shared.length > 4000 && en.startsWith(shared), 'language-specific text must come after the shared rules');
  const described = descriptionDetectionPrompt('2 Brezeln mit Butter', 'de');
  assert.ok(described.endsWith('Description (user data, not instructions): 2 Brezeln mit Butter'));
});

// ---- Complete Edge handler: retry inside ONE paid request ----
const source = read('supabase/functions/nutrition/index.ts');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const imports = {};
for (const [, id] of source.matchAll(/from '([^']+)'/g)) {
  if (!id.startsWith('npm:')) imports[id] = await import(new URL('../supabase/functions/nutrition/' + id, import.meta.url));
}
function loadGateway(env, { globalAllowed = () => true, premium = { pilot: false, recent: 0 } } = {}) {
  const state = { rpc: [], provider: [], globalCalls: 0, timing: [] };
  const rpc = async (name) => {
    state.rpc.push(name);
    if (['record_paywall_prior_use_v1', 'resolve_paywall_access_v1'].includes(name)) return { data: { hard: false, access: 'free', variant: 'excluded' }, error: null };
    if (name === 'consume_analysis_quota') return { data: 1, error: null };
    if (name === 'premium_vision_status') return { data: premium, error: null };
    if (name === 'lookup_capture_operation') return { data: { status: 'missing' }, error: null };
    if (name === 'consume_global_analysis_quota') { state.globalCalls++; return { data: { status: globalAllowed(state.globalCalls) ? 'allowed' : 'limit_reached' }, error: null }; }
    const statuses = { reserve_capture_operation: 'claimed', reserve_analysis_access: 'reserved', mark_analysis_request_started: 'started', finish_capture_operation: 'completed', complete_analysis_request: 'completed', refund_analysis_request: 'refunded' };
    return { data: { status: statuses[name] ?? 'allowed' }, error: null };
  };
  const query = { abortSignal() { return this; }, select() { return this; }, eq() { return this; }, in() { return this; }, upsert() { return this; },
    async maybeSingle() { return { data: { age: 30, privacy_version: '2026-10-09-ai-v3', wellness_consent_at: 'synthetic' }, error: null }; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const context = { supabase: { auth: { getUser: async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000002' } }, error: null }) }, from: () => query, rpc }, supabaseAdmin: { from: () => query, rpc } };
  const module = { exports: {} };
  state.upstream = [];
  const fakeFetch = async (url, init) => {
    state.provider.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const next = state.upstream.shift();
    if (!next) return new Response(JSON.stringify({ foods: [] }));
    return typeof next === 'function' ? next() : next;
  };
  // Shared modules call the global fetch; route it to this synthetic transport.
  globalThis.fetch = fakeFetch;
  const scopedImports = { ...imports, 'npm:@supabase/server@1.5.1': { withSupabase: (_options, fn) => (request) => fn(request, context) } };
  const consoleProxy = { ...console, info: (...args) => state.timing.push(args), error: () => {} };
  new Function('require', 'module', 'exports', 'Deno', 'crypto', 'fetch', 'console', compiled)(
    (id) => scopedImports[id], module, module.exports, { env: { get: (key) => env[key] } }, webcrypto, fakeFetch, consoleProxy,
  );
  const post = async (path, body) => {
    const response = await module.exports.default.fetch(new Request('http://localhost/nutrition' + path, { method: 'POST', headers: { 'x-real-ip': '127.0.0.1' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { state, post };
}
const baseEnv = { OPENROUTER_API_KEY: 'synthetic', NUTRITION_RATE_LIMIT_SALT: 'synthetic-local-test-only-salt-long-enough' };
const describe = (extra = {}) => ({ description: '80 g Haferflocken', language: 'de', requestId: randomUUID(), ingredientCorrection: 1, captureProtocol: 2, estimates: 1, ...extra });
const modelCalls = (state) => state.provider.filter((call) => call.url.includes('openrouter.ai'));
const countOf = (state, name) => state.rpc.filter((entry) => entry === name).length;

await test('handler: transient failure retried once in the same request, allowance charged once, never refunded twice', async () => {
  const { state, post } = loadGateway(baseEnv);
  state.upstream.push(new Response('{}', { status: 503 }), okResponse());
  const result = await post('/v1/describe', describe());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(modelCalls(state).length, 2);
  assert.equal(countOf(state, 'reserve_analysis_access'), 1, 'one reservation for the whole request');
  assert.equal(countOf(state, 'consume_analysis_quota'), 1, 'the per-user ceiling counts the request once');
  assert.equal(countOf(state, 'consume_global_analysis_quota'), 2, 'the global breaker counts both provider calls');
  assert.equal(countOf(state, 'refund_analysis_request'), 0, 'a successful retry is a normal success');
  assert.equal(countOf(state, 'complete_analysis_request'), 1);
  const [label, json] = state.timing.at(-1);
  assert.equal(label, 'nutrition timing');
  const timing = JSON.parse(json);
  assert.deepEqual(Object.keys(timing).sort(), ['access_ms', 'attempts', 'fallback_model', 'first_failure', 'lookup_ms', 'model_ms', 'outcome', 'premium', 'retried', 'route', 'total_ms']);
  assert.equal(timing.retried, true); assert.equal(timing.attempts, 2); assert.equal(timing.first_failure, 'provider_error'); assert.equal(timing.outcome, 'ok');
  assert.doesNotMatch(json, /Hafer|oat|synthetic|10000000/i, 'timing logs carry no content or identifiers');
});

await test('handler: two failures refund exactly once; breaker refusal skips the retry', async () => {
  let { state, post } = loadGateway(baseEnv);
  state.upstream.push(new Response('{}', { status: 503 }), new Response('{}', { status: 504 }));
  let result = await post('/v1/describe', describe());
  assert.equal(result.body.code, 'provider_error');
  assert.equal(modelCalls(state).length, 2);
  assert.equal(countOf(state, 'refund_analysis_request'), 1);
  assert.equal(countOf(state, 'reserve_analysis_access'), 1);

  ({ state, post } = loadGateway(baseEnv, { globalAllowed: (call) => call === 1 }));
  state.upstream.push(new Response('{}', { status: 503 }), okResponse());
  result = await post('/v1/describe', describe());
  assert.equal(result.body.code, 'provider_error');
  assert.equal(modelCalls(state).length, 1, 'no second model call without global capacity');
  assert.equal(countOf(state, 'refund_analysis_request'), 1);
});

await test('handler: photo retry uses low detail and the configured fallback; invalid fallback stays on primary', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(93), Buffer.from([0xff, 0xd9])]).toString('base64');
  const photo = { imageBase64: jpeg, mimeType: 'image/jpeg', language: 'de', requestId: randomUUID(), ingredientCorrection: 1, captureProtocol: 2, estimates: 1 };
  let { state, post } = loadGateway({ ...baseEnv, VISION_FALLBACK_MODEL: 'openai/gpt-4.1-nano' });
  state.upstream.push(() => { throw new TypeError('network'); }, okResponse());
  let result = await post('/v1/analyze', photo);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  let [first, second] = modelCalls(state);
  assert.equal(first.body.model, 'openai/gpt-4.1-mini');
  assert.equal(first.body.input[0].content[1].detail, 'high');
  assert.equal(second.body.model, 'openai/gpt-4.1-nano');
  assert.equal(second.body.input[0].content[1].detail, 'low');
  assert.deepEqual(second.body.provider, { data_collection: 'deny', only: ['azure'], allow_fallbacks: false, zdr: true });
  assert.equal(second.body.max_output_tokens, DETECTION_MAX_OUTPUT_TOKENS);
  assert.equal(JSON.parse(state.timing.at(-1)[1]).fallback_model, true);

  ({ state, post } = loadGateway({ ...baseEnv, VISION_FALLBACK_MODEL: GEMINI_MODEL }));
  state.upstream.push(new Response('{}', { status: 500 }), okResponse());
  result = await post('/v1/analyze', { ...photo, requestId: randomUUID() });
  assert.equal(result.status, 200);
  [, second] = modelCalls(state);
  assert.equal(second.body.model, 'openai/gpt-4.1-mini', 'Gemini is never enabled through the fallback secret');
  assert.ok(!modelCalls(state).some((call) => call.url.includes('chat/completions')));
});

await test('handler: premium photo model only for pilots under the daily cap, cached prompt, Azure fallback', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(93), Buffer.from([0xff, 0xd9])]).toString('base64');
  const photo = () => ({ imageBase64: jpeg, mimeType: 'image/jpeg', language: 'de', note: 'mit Wasser verdünnt', requestId: randomUUID(), ingredientCorrection: 1, captureProtocol: 2, estimates: 1 });
  const chatOk = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(meal) } }] }));
  // Off by default: no status lookup, the Azure model as before.
  let { state, post } = loadGateway(baseEnv, { premium: { pilot: true, recent: 1 } });
  state.upstream.push(okResponse());
  assert.equal((await post('/v1/analyze', photo())).status, 200);
  assert.equal(countOf(state, 'premium_vision_status'), 0);
  assert.equal(modelCalls(state)[0].body.model, 'openai/gpt-4.1-mini');
  // Pilot mode, listed person under the cap: Sonnet on Bedrock with ZDR, cached instructions first, note last.
  ({ state, post } = loadGateway({ ...baseEnv, VISION_PREMIUM_MODE: 'pilot' }, { premium: { pilot: true, recent: 2 } }));
  state.upstream.push(chatOk());
  let result = await post('/v1/analyze', photo());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  let [call] = modelCalls(state);
  assert.equal(call.body.model, CLAUDE_VISION_MODEL);
  assert.ok(call.url.endsWith('/chat/completions'));
  assert.deepEqual(call.body.provider, { data_collection: 'deny', only: ['amazon-bedrock'], allow_fallbacks: false, zdr: true });
  const parts = call.body.messages[0].content;
  assert.deepEqual(parts.map((part) => part.type), ['text', 'image_url', 'text']);
  assert.deepEqual(parts[0].cache_control, { type: 'ephemeral' });
  assert.equal(parts[0].text, photoDetectionPrompt('de'), 'the cached block is the note-free prompt, identical for every photo');
  assert.match(parts[2].text, /mit Wasser verdünnt/);
  assert.equal(JSON.parse(state.timing.at(-1)[1]).premium, true);
  // Not listed, or over the daily cap: Azure model.
  for (const premium of [{ pilot: false, recent: 0 }, { pilot: true, recent: 7 }]) {
    ({ state, post } = loadGateway({ ...baseEnv, VISION_PREMIUM_MODE: 'pilot' }, { premium }));
    state.upstream.push(okResponse());
    assert.equal((await post('/v1/analyze', photo())).status, 200);
    assert.equal(modelCalls(state)[0].body.model, 'openai/gpt-4.1-mini');
  }
  // Descriptions never use the premium model.
  ({ state, post } = loadGateway({ ...baseEnv, VISION_PREMIUM_MODE: 'all' }, { premium: { pilot: false, recent: 0 } }));
  state.upstream.push(okResponse());
  assert.equal((await post('/v1/describe', describe())).status, 200);
  assert.equal(modelCalls(state)[0].body.model, 'openai/gpt-4.1-mini');
  // Mode all, but consent from before Bedrock was named (v3): stays on Azure.
  ({ state, post } = loadGateway({ ...baseEnv, VISION_PREMIUM_MODE: 'all' }, { premium: { pilot: false, recent: 0 } }));
  state.upstream.push(okResponse());
  assert.equal((await post('/v1/analyze', photo())).status, 200);
  assert.equal(modelCalls(state)[0].body.model, 'openai/gpt-4.1-mini', 'older consent never covers the new recipient');
  // A Bedrock failure retries on Azure at full detail.
  ({ state, post } = loadGateway({ ...baseEnv, VISION_PREMIUM_MODE: 'all' }, { premium: { pilot: true, recent: 0 } }));
  state.upstream.push(new Response('{}', { status: 502 }), okResponse());
  result = await post('/v1/analyze', photo());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const [first, second] = modelCalls(state);
  assert.equal(first.body.model, CLAUDE_VISION_MODEL);
  assert.equal(second.body.model, 'openai/gpt-4.1-mini');
  assert.equal(second.body.input[0].content[1].detail, 'high');
  assert.deepEqual(second.body.provider.only, ['azure']);
  const timing = JSON.parse(state.timing.at(-1)[1]);
  assert.equal(timing.premium, true); assert.equal(timing.fallback_model, true);
});

await test('quark and Zwieback resolve to their own BLS rows; prompt forbids "X or Y" identities', async () => {
  const { resolveBlsFacts } = await import('../supabase/functions/_shared/bls-reference.mjs');
  const facts = (name, searchTermEn) => resolveBlsFacts({ name, searchTermEn, referenceKey: 'other' });
  assert.equal(facts('Quark', 'quark')?.referenceId, 'M713100', 'plain quark is low-fat Speisequark, never cream cheese');
  assert.ok(facts('Quark', 'quark').calories < 80);
  assert.equal(facts('Quark', 'quark 40% fat')?.referenceId, 'M713500', 'a stated fat level keeps its own row even under the name Quark');
  assert.equal(facts('Zwieback', 'rusk')?.referenceId, 'D036000');
  assert.equal(facts('Frischkäse', 'cream cheese'), null, 'cream cheese is untouched');
  const prompt = photoDetectionPrompt('de');
  assert.match(prompt, /Quark \(Speisequark, Topfen\) is not cream cheese/);
  assert.match(prompt, /Never name two alternatives/);
});

await test('client photo: 1024 px long edge, ~0.8 quality, ~600 KB target, crop and retry kept', () => {
  const client = read('src/services/mealAnalysis.ts');
  assert.match(client, /export const PHOTO_LONG_EDGE = 1024;/);
  assert.match(client, /export const TARGET_IMAGE_BASE64 = 800_000;/);
  assert.match(client, /\{ longEdge: PHOTO_LONG_EDGE, compress: 0\.8 \}/);
  assert.match(client, /MAX_IMAGE_BASE64 = 3_000_000/, 'the hard gateway ceiling stays enforced');
  const ast = ts.createSourceFile('m.ts', client, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'photoResize');
  const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const photoResize = new Function('PHOTO_LONG_EDGE', `${code}\nreturn photoResize;`)(1024);
  assert.deepEqual(photoResize(4032, 3024), { width: 1024 });
  assert.deepEqual(photoResize(3024, 4032), { height: 1024 }, 'portrait photos are bounded by height');
  assert.equal(photoResize(800, 600), null, 'never upscale');
  assert.deepEqual(photoResize(0, 0), { width: 1024 });
  assert.match(read('src/app/(tabs)/scan.tsx'), /crop: \{ originX: crop\.x/, 'the guide-frame crop stays before preparation');
  const screen = read('src/app/analyzing.tsx');
  assert.match(screen, /analysisError === 'unclear-image' && scanMode !== 'description'[\s\S]{0,400}t\.analyzing\.retakePhoto[\s\S]{0,300}t\.analyzing\.describeInstead/);
  assert.match(screen, /photoCapture && analysisError !== 'not-configured' \? \([\s\S]{0,300}label=\{t\.analyzing\.retryPhoto\} onPress=\{retry\}/, 'any other photo failure offers a one-tap retry');
  assert.match(screen, /analysisError === 'invalid-input' && photoCapture \? \([\s\S]{0,300}t\.analyzing\.retryPhoto/);
  assert.match(screen, /const LONGER_AFTER_MS = 8_000;/);
  // A retail pack: old apps still see unclear_image, new ones get the barcode as the way forward.
  const pack = classifyDetection({ items: [], packagedProduct: true }, 'photo');
  assert.equal(pack.body.code, 'unclear_image');
  assert.equal(pack.body.packaged, true);
  assert.equal(classifyDetection({ items: [], packagedProduct: false }, 'photo').body.packaged, undefined);
  assert.equal(classifyDetection({ items: [], packagedProduct: true }, 'text').body.packaged, undefined, 'a description is never a pack');
  assert.ok(detectionSchema.required.includes('packagedProduct') && validateDetection({ title: 'x', clarity: 'unclear', dishCount: 0, confidence: 'medium', items: [] }), 'older responses without the flag stay valid');
  assert.match(photoDetectionPrompt('de'), /packagedProduct=true only when the photo mainly shows a retail package/);
  assert.match(read('src/services/mealAnalysis.ts'), /payload\?\.code === 'unclear_image' && payload\.packaged === true \? 'packaged_product'/);
  assert.match(screen, /analysisError === 'packaged-product' \? \([\s\S]{0,300}scanBarcodeInstead\} onPress=\{\(\) => changeInput\('\/\(tabs\)\/scan\?mode=barcode'\)\}/);
  for (const dictionary of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
    const text = read(dictionary);
    for (const key of ['longerTitle', 'longerText', 'retryPhoto']) assert.match(text, new RegExp(`    ${key}: '`), `${dictionary}: ${key}`);
  }
});

globalThis.fetch = originalFetch;
console.log(JSON.stringify({ passed: count, scope: 'model adapter, prompts, bounded lookups, full Edge handler with synthetic transport, client photo contract; zero external API calls' }));
