import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

const load = (file, mocks) => {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', '__DEV__', code)((id) => {
    if (id === '@/services/personalGoal') return load('src/services/personalGoal.ts', {});
    if (id === '@/services/crashReporting') return { reportError() {}, crashReportingEnabled: false, wrapRoot: x => x };
    if (!(id in mocks)) throw Error(`Unexpected module ${id}`);
    return mocks[id];
  }, module, module.exports, true);
  return module.exports;
};
const values = new Map();
let failRead = false, failWrite = false;
const storage = {
  getItem: async (key) => { if (failRead) throw Error('disk read failed'); return values.get(key) ?? null; },
  setItem: async (key, value) => { if (failWrite) throw Error('disk full'); await Promise.resolve(); values.set(key, value); },
  removeItem: async (key) => values.delete(key),
  multiRemove: async (keys) => keys.forEach((key) => values.delete(key)),
};
const local = load('src/services/localRepository.ts', {
  '@react-native-async-storage/async-storage': { default: storage },
  '@/services/personalization': { DEFAULT_PROFILE: {}, isBiologicalSex: () => true },
  '@/utils/date': { localDateKey: () => '2026-09-18' },
  '@/utils/units': { defaultUnitSystem: () => 'metric', isUnitSystem: () => true },
  '@/utils/requestId': { isAnalysisRequestId: () => true, newAnalysisRequestId: randomUUID },
});
const meal = (id) => ({ id, origin: 'plan', date: '2026-09-18', items: [], calories: 100, savedAt: 'one' });
await Promise.all(Array.from({ length: 20 }, (_, i) => local.saveMeal(meal(String(i)))));
assert.equal((await local.loadAllStoredScans()).length, 20, 'concurrent saves preserve every meal');
const first = await local.saveMealWithOutcome(meal('unique'));
assert.equal(first.outcome, 'created');
assert.equal((await local.saveMealWithOutcome({ ...meal('unique'), savedAt: 'two' })).outcome, 'unchanged');
assert.equal((await local.saveMealWithOutcome({ ...meal('unique'), calories: 120 })).outcome, 'updated');
const beforeFailure = values.get('@kandro/meals:v1');
failRead = true;
await assert.rejects(local.saveMeal(meal('bad-read')));
failRead = false;
assert.equal(values.get('@kandro/meals:v1'), beforeFailure);
failWrite = true;
await assert.rejects(local.saveMeal(meal('bad-write')));
failWrite = false;
await local.saveMeal(meal('recovered'));
values.set('@kandro/meals:v1', '{broken');
await assert.rejects(local.saveMeal(meal('corrupt')));
assert.equal(values.get('@kandro/meals:v1'), '{broken', 'corrupt history is never overwritten');
values.set('@kandro/meals:v1', beforeFailure);

const events = [];
let cloudFail = false;
const sync = load('src/services/syncRepository.ts', {
  '@/services/appAccess': { authorizeMealCreate: async () => undefined }, '@/services/hardWall': { markHardWallUsed: async () => undefined },
  '@/services/localRepository': local,
  '@/services/supabaseClient': { getCurrentSessionUserId: async () => 'one' },
  '@/services/cloudRepository': { saveCloudMeal: async () => { if (cloudFail) throw Error('network'); return true; } },
  '@/services/telemetry': { trackEvent: (name, props) => events.push({ name, props }), captureOperationalError: () => {} },
  '@/services/mockNutrition': {}, '@/services/personalization': {}, '@/utils/date': { localDateKey: () => '2026-09-18' },
});
await Promise.all([sync.saveSyncedMeal(meal('canonical'), 'search'), sync.saveSyncedMeal(meal('canonical'), 'search')]);
assert.equal(events.filter((e) => e.name === 'meal saved').length, 1, 'double tap counts one created meal');
await sync.saveSyncedMeal({ ...meal('canonical'), calories: 200 }, 'edit');
assert.equal(events.filter((e) => e.name === 'meal saved').length, 1, 'corrections are not new meals');
assert.equal(events.filter((e) => e.name === 'meal updated').length, 1);
failWrite = true;
await assert.rejects(sync.saveSyncedMeal(meal('failure'), 'recommendation'));
failWrite = false;
assert.equal(events.filter((e) => e.name === 'meal save failed').length, 1);
assert.equal(events.filter((e) => e.name === 'meal saved').length, 1);
cloudFail = true;
await sync.saveSyncedMeal(meal('offline'), 'repeat');
await new Promise((resolve) => setImmediate(resolve));
assert.ok((await local.loadAllStoredScans()).some((m) => m.id === 'offline'));
assert.ok(events.some((e) => e.name === 'cloud sync failed'));

process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = 'test-token';
process.env.EXPO_PUBLIC_POSTHOG_ENABLED = 'true';
const emitted = [], clients = [];
class FakePostHog {
  constructor(token, options) { this.options = options; this.queues = new Map(); clients.push(this); }
  async ready() {} async optIn() {} async optOut() {} async flushStorage() {} reset() {}
  setPersistedProperty(key, value) { this.queues.set(key, value); }
  capture(event, properties) { const sanitized = this.options.before_send({ event, properties }); if (sanitized) emitted.push(sanitized); }
  captureException() {}
}
const telemetry = load('src/services/telemetry.ts', {
  'expo-application': { nativeApplicationVersion: '1.0.1', nativeBuildVersion: '18' },
  'react-native': { Platform: { OS: 'ios' } },
  '@react-native-async-storage/async-storage': { default: storage },
  'expo-file-system': { File: class { exists = false; }, Paths: { document: '' } },
  'posthog-react-native': { default: FakePostHog, PostHogPersistedProperty: { Queue: 'queue', AiQueue: 'ai', AiCaptureQueue: 'ai_capture', LogsQueue: 'logs' } },
});
telemetry.trackEvent('meal saved', { source: 'search' });
assert.equal(clients.length, 0);
await telemetry.applyAnalyticsAgePolicy(25);
assert.equal(clients.length, 0, 'adult age alone must not contact analytics');
await telemetry.setAnalyticsCollectionEnabled(true);
assert.equal(clients.length, 1);
telemetry.trackEvent('meal saved', { source: 'search', email: 'private@example.com', calories: 200, description: 'private' });
const captured = emitted.at(-1);
assert.deepEqual(Object.keys(captured.properties).sort(), ['analytics_schema', 'app_build', 'app_environment', 'app_platform', 'app_version', 'source']);
assert.equal(captured.properties.app_build, '18');
assert.equal(captured.properties.analytics_schema, 2);
assert.deepEqual(telemetry.sanitizeProductProperties({ source: 'secret', rank: 'secret', duration: 'secret' }), {});
assert.deepEqual(telemetry.sanitizeProductProperties({ meal_context: 'eating-out' }), { meal_context: 'eating-out' });
await telemetry.setAnalyticsCollectionEnabled(false);
const count = emitted.length;
telemetry.trackEvent('meal saved', { source: 'search' });
assert.equal(emitted.length, count);
await telemetry.applyAnalyticsAgePolicy(17);
assert.equal(await telemetry.setAnalyticsCollectionEnabled(true), false);
telemetry.trackEvent('app active', { entry: 'launch' });
assert.equal(emitted.length, count, 'minors cannot enable or emit analytics');
console.log('Observability runtime tests passed: concurrent saves, failed reads/writes, corrupted storage, save deduplication, edits, offline cloud failure, consent/minor gates, and PII allowlist.');

let currentUser = 'one';
const writes = [];
let releaseFirst;
const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
let firstStarted;
const started = new Promise((resolve) => { firstStarted = resolve; });
const fakeCloud = {
  rpc: async (name, args) => {
    assert.equal(name, 'mutate_meal_v2');
    writes.push(args.operation === 'delete' ? 'delete' : `save:${args.meal.calories}`);
    if (args.operation === 'save' && args.meal.calories === 101) { firstStarted(); await firstWrite; }
    return { error: null, data: { revision: writes.length, deleted: args.operation === 'delete' } };
  },
};
const cloud = load('src/services/cloudRepository.ts', {
  './supabaseClient': { supabase: fakeCloud, isSupabaseConfigured: true, ensureSupabaseUser: async () => ({ id: currentUser }), getCurrentSessionUserId: async () => currentUser },
  './localRepository': local, '@/utils/requestId': { newAnalysisRequestId: randomUUID },
  '@/utils/date': { localDateKey: () => '2026-09-18' }, '@/utils/units': {}, '@/services/personalization': {}, '@/utils/format': {},
});
await local.saveMealWithOutcome({ ...meal('ordered'), calories: 101 }, 'one');
const c1 = cloud.saveCloudMeal(meal('ordered'));
await started;
await local.saveMealWithOutcome({ ...meal('ordered'), calories: 102 }, 'one');
const c2 = cloud.saveCloudMeal(meal('ordered'));
await local.deleteMeal('ordered', 'one');
const c3 = cloud.deleteCloudMeal('ordered');
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(writes, ['save:101'], 'later save/delete wait for earlier server write');
releaseFirst();
await Promise.all([c1, c2, c3]);
assert.deepEqual(writes, ['save:101', 'delete'], 'superseded edit is coalesced and deletion stays last');
assert.ok(!(await local.loadAllStoredScans()).some((m) => m.id === 'ordered'));
assert.ok(!(await local.loadDeletedMealIds()).includes('ordered'));
// Sentry: 10% traces, but spans and transactions keep the privacy scrubbing.
{
  let sentryOptions = null;
  const previousDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@o1.ingest.de.sentry.io/1';
  load('src/services/crashReporting.ts', { '@sentry/react-native': { init(options) { sentryOptions = options; }, captureException() {}, wrap: x => x } });
  if (previousDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN; else process.env.EXPO_PUBLIC_SENTRY_DSN = previousDsn;
  assert.equal(sentryOptions.tracesSampleRate, 0.1);
  assert.deepEqual(sentryOptions.tracePropagationTargets, []);
  assert.equal(sentryOptions.sendDefaultPii, false);
  assert.equal(sentryOptions.attachScreenshot, false);
  const span = sentryOptions.beforeSendSpan({ description: 'GET https://x.supabase.co/rest/v1/meals?user_id=eq.abc', data: { url: 'https://x.supabase.co/rest/v1/meals?id=eq.m1', 'http.query': '?user_id=eq.abc', 'http.method': 'GET', meal_title: 'x' } });
  assert.equal(span.description, 'GET https://x.supabase.co/rest/v1/meals');
  assert.equal(span.data.url, 'https://x.supabase.co/rest/v1/meals');
  assert.equal(span.data['http.method'], 'GET');
  assert.ok(!('http.query' in span.data) && !('meal_title' in span.data));
  const transaction = sentryOptions.beforeSendTransaction({ user: { id: 'u' }, transaction: '/meal?id=1', request: { url: 'https://a/b?c=d', query_string: 'c=d', data: '{}' } });
  assert.equal(transaction.user, undefined);
  assert.equal(transaction.transaction, '/meal');
  assert.deepEqual(transaction.request, { url: 'https://a/b' });
  assert.equal(sentryOptions.beforeSend({ contexts: { device: { simulator: true } }, exception: {} }), null, 'simulator events are dropped');
  const deviceEvent = sentryOptions.beforeSend({ contexts: { device: { simulator: false } }, user: { id: 'u' }, exception: {} });
  assert.ok(deviceEvent && deviceEvent.user === undefined, 'device events are kept without user');
}
console.log('Cloud ordering passed: delayed earlier writes cannot overtake a correction or resurrect a deleted meal.');
