import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

// Only synthetic storage and billing adapters. No provider SDK is initialized.
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const load = (file, mocks) => {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/services/personalGoal') return load('src/services/personalGoal.ts', {});
    assert.ok(id in mocks, 'Unexpected dependency: ' + id);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', reason: error.message }); }
}
function localFixture() {
  const values = new Map();
  const storage = {
    getItem: async (k) => values.get(k) ?? null,
    setItem: async (k, v) => { values.set(k, v); },
    removeItem: async (k) => { values.delete(k); },
    multiSet: async (pairs) => { pairs.forEach(([k, v]) => values.set(k, v)); },
    multiRemove: async (keys) => { keys.forEach((k) => values.delete(k)); },
  };
  const local = load('src/services/localRepository.ts', {
    '@react-native-async-storage/async-storage': { default: storage },
    '@/services/personalization': { DEFAULT_PROFILE: {}, isBiologicalSex: () => true },
    '@/utils/date': { localDateKey: () => '2026-09-26' },
    '@/utils/units': { defaultUnitSystem: () => 'metric', isUnitSystem: () => true },
    '@/utils/requestId': { isAnalysisRequestId: () => true, newAnalysisRequestId: randomUUID },
  });
  return { values, storage, local };
}
await test('Corrupt meals are an explicit read failure, not an empty diary', async () => {
  const { values, local } = localFixture(); values.set('@kandro/meals:v1', '{broken');
  await assert.rejects(local.loadAllStoredScans());
  assert.equal(values.get('@kandro/meals:v1'), '{broken');
});
await test('Corrupt weights cannot be overwritten by a new entry', async () => {
  const { values, local } = localFixture(); values.set('@kandro/weight-entries:v1', '{broken');
  await assert.rejects(local.saveWeightEntry({ date: '2026-09-26', weightKg: 80 }));
  assert.equal(values.get('@kandro/weight-entries:v1'), '{broken');
});
await test('Concurrent weight writes retain both dates', async () => {
  const { local } = localFixture();
  await Promise.all([local.saveWeightEntry({ date: '2026-09-25', weightKg: 80 }), local.saveWeightEntry({ date: '2026-09-26', weightKg: 81 })]);
  assert.equal((await local.loadWeightEntries()).length, 2);
});
await test('Delayed weight write cannot enter the replacement account', async () => {
  const { values, storage, local } = localFixture(); const gate = deferred(), started = deferred();
  storage.getItem = async (key) => {
    const old = values.get(key) ?? null;
    if (key === '@kandro/weight-entries:v1') { started.resolve(); await gate.promise; }
    return old;
  };
  const pending = local.saveWeightEntry({ date: '2026-09-26', weightKg: 80 });
  const outcome = pending.catch(() => undefined);
  await started.promise;
  const switching = local.replaceLocalAccountData({}, [], 0);
  gate.resolve(); await Promise.all([outcome, switching]);
  assert.equal(values.has('@kandro/weight-entries:v1'), false);
});

// Minimal React hook adapter: runs the real provider and effect cleanup/state
// transitions. This is a controller test, not evidence of native rendering.
function hooks() {
  const slots = []; let cursor = 0, effects = [], Provider;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) { const n = cursor++; if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[n].value, (v) => { slots[n].value = typeof v === 'function' ? v(slots[n].value) : v; }]; },
    useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useMemo(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) slots[n] = { value: fn(), deps }; return slots[n].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn(); }); } },
  };
  return { react, setProvider(p) { Provider = p; }, render() { cursor = 0; const value = Provider({ children: null }).props.value; const pending = effects; effects = []; pending.forEach((f) => f()); return value; } };
}
function subscriptionFixture() {
  const h = hooks(); let authCallback; const reminderCalls = [];
  const plan = { id: 'monthly' };
  const responses = { sdkActive: false, serverActive: false, serverError: false, trial: null, readTrial: null, purchase: async () => true, restore: async () => true };
  const dictionary = { errors: { packageUnavailable: 'unavailable', entitlementConfirmationPending: 'pending', entitlementStatusUnavailable: 'status unavailable', purchasePending: 'store pending' }, paywall: { entitlementMissing: 'pending' } };
  const service = {
    loadSubscriptionSnapshot: async () => ({ configured: true, mode: 'native-store', entitlementActive: responses.sdkActive, currentTrial: responses.trial, plans: { monthly: plan, yearly: null } }),
    loadSubscriptionTrial: async () => responses.readTrial ? responses.readTrial() : responses.trial,
    purchaseSubscription: (...args) => responses.purchase(...args), restoreSubscription: () => responses.restore(),
    subscriptionErrorMessage: (e) => e.message,
    isSubscriptionPurchaseCancelled: (e) => e.code === 'cancelled',
    isSubscriptionPurchasePending: (e) => e.code === 'pending',
  };
  const provider = load('src/context/SubscriptionContext.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@/services/subscription': service,
    '@/services/reminders': { scheduleTrialEndingReminder: async (trial, isCurrent) => { if (isCurrent()) reminderCalls.push(trial); return Boolean(trial?.willRenew); }, scheduleCancelledTrialNotice: async () => false },
    '@/services/retention': { mealsSince: () => 0 },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/services/supabaseClient': { supabase: { auth: { onAuthStateChange: (callback) => { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; } } } },
    '@/services/serverEntitlement': { refreshServerEntitlement: async () => { if (responses.serverError) throw new Error('timeout'); return responses.serverActive; } },
    '@/services/entitlementConfirmation': { confirmServerEntitlementWithRetry: async (probe) => probe() },
    '@/services/telemetry': { captureOperationalError() {} },
    '@/i18n/active': { getDictionary: () => dictionary },
    '@/context/AppContext': { useApp: () => ({ hydrationReady: false, wellnessConsentGranted: true }) },
  });
  h.setProvider(provider.SubscriptionProvider); h.render();
  return { ...h, responses, reminderCalls, async ready() { await h.render().refresh(); return h.render(); }, switchAccount() { authCallback('SIGNED_IN', { user: { id: 'B' } }); } };
}
await test('Server-confirmed Pro survives an SDK Free snapshot', async () => {
  const f = subscriptionFixture(); f.responses.serverActive = true;
  const v = await f.ready(); assert.equal(v.status, 'active'); assert.equal(v.snapshot.entitlementActive, true);
});
await test('Subscription refresh and Restore reconcile the real current trial without altering purchase rights', async () => {
  const f = subscriptionFixture();
  f.responses.trial = { productId: 'annual', expiresAt: '2026-10-11T12:00:00Z', startedAt: '2026-10-04T12:00:00Z', willRenew: true };
  const v = await f.ready();
  assert.deepEqual(f.reminderCalls.at(-1), f.responses.trial);
  f.responses.serverActive = true;
  assert.equal(await v.restore(), 'active');
  await Promise.resolve();
  assert.deepEqual(f.render().snapshot.currentTrial, f.responses.trial);
  f.responses.trial = { ...f.responses.trial, willRenew: false };
  await f.render().syncTrialReminder();
  assert.equal(f.reminderCalls.at(-1).willRenew, false);
  assert.equal(f.render().status, 'active');
});
await test('A late trial lookup cannot update or schedule for a switched account', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); const gate = deferred();
  f.responses.readTrial = () => gate.promise;
  const before = f.reminderCalls.length;
  const reminder = v.syncTrialReminder(); f.switchAccount();
  gate.resolve({ productId: 'old', expiresAt: '2026-10-11T12:00:00Z', startedAt: null, willRenew: true });
  assert.equal(await reminder, false);
  assert.ok(!f.reminderCalls.slice(before).some(trial => trial?.productId === 'old'));
  assert.notEqual(f.render().snapshot?.currentTrial?.productId, 'old');
});
await test('Positive store purchase awaiting server is pending, never a failed purchase', async () => {
  const f = subscriptionFixture(); const v = await f.ready();
  assert.equal(await v.purchase('monthly'), 'pending'); assert.equal(f.render().status, 'pending');
});
await test('Positive restore awaiting server does not report no purchase', async () => {
  const f = subscriptionFixture(); const v = await f.ready();
  assert.equal(await v.restore(), 'pending'); assert.equal(f.render().status, 'pending');
});
await test('Late purchase result after account switch cannot activate new account', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); const gate = deferred();
  f.responses.purchase = () => gate.promise;
  const purchase = v.purchase('monthly'); f.switchAccount();
  await f.ready(); f.responses.serverActive = true; gate.resolve(true);
  assert.equal(await purchase, 'interrupted'); assert.notEqual(f.render().status, 'active');
});
await test('Store payment pending is distinct from cancellation and failure', async () => {
  const f = subscriptionFixture(); const v = await f.ready();
  f.responses.purchase = async () => { throw { code: 'pending' }; };
  assert.equal(await v.purchase('monthly'), 'pending');
});
await test('Immediate double purchase dispatch invokes SDK once', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); const gate = deferred(); let calls = 0;
  f.responses.purchase = async () => { calls++; return gate.promise; };
  const one = v.purchase('monthly'), two = v.purchase('monthly'); gate.resolve(false);
  await Promise.all([one, two]); assert.equal(calls, 1);
});
await test('Cancellation does not activate Pro or become a failure', async () => {
  const f = subscriptionFixture(); const v = await f.ready();
  f.responses.purchase = async () => { throw { code: 'cancelled' }; };
  assert.equal(await v.purchase('monthly'), 'cancelled'); assert.equal(f.render().status, 'ready');
});
await test('Missing product never invokes a purchase', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); let calls = 0;
  f.responses.purchase = async () => { calls++; return true; };
  assert.equal(await v.purchase('yearly'), 'failed'); assert.equal(calls, 0);
});
await test('Store and server confirmation activate purchase and restore', async () => {
  for (const operation of ['purchase', 'restore']) {
    const f = subscriptionFixture(); const v = await f.ready(); f.responses.serverActive = true;
    assert.equal(await v[operation]('monthly'), 'active'); assert.equal(f.render().status, 'active');
  }
});
await test('Restore timeout cannot be reported as no existing purchase', async () => {
  const f = subscriptionFixture(); const v = await f.ready();
  f.responses.restore = async () => false; f.responses.serverError = true;
  assert.equal(await v.restore(), 'failed'); assert.equal(f.render().status, 'error');
});
await test('Confirmed inactive SDK and server restore returns none', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); f.responses.restore = async () => false;
  assert.equal(await v.restore(), 'none'); assert.equal(f.render().status, 'ready');
});
await test('Refresh failure does not retain an unverified active flag', async () => {
  const f = subscriptionFixture(); f.responses.serverActive = true; await f.ready();
  f.responses.serverError = true; await f.render().refresh();
  assert.equal(f.render().status, 'error'); assert.equal(f.render().snapshot.entitlementActive, false);
});
await test('Expired server right is not replaced by stale SDK Pro', async () => {
  const f = subscriptionFixture(); f.responses.sdkActive = true; const v = await f.ready();
  assert.notEqual(v.status, 'active'); assert.equal(v.snapshot.entitlementActive, false);
});
await test('Late restore result after account switch is ignored', async () => {
  const f = subscriptionFixture(); const v = await f.ready(); const gate = deferred();
  f.responses.restore = () => gate.promise; const pending = v.restore();
  f.switchAccount(); await f.ready(); f.responses.serverActive = true; gate.resolve(true);
  assert.equal(await pending, 'interrupted'); assert.notEqual(f.render().status, 'active');
});
await test('Concurrent analysis queue writes retain stable request IDs', async () => {
  const { local } = localFixture(); const ids = [randomUUID(), randomUUID(), randomUUID()];
  await Promise.all(ids.map(id => local.queueAnalysis({ id, attempts: 1 })));
  assert.deepEqual((await local.loadAnalysisQueue()).map(x => x.id).sort(), ids.sort());
  await local.queueAnalysis({ id: ids[0], attempts: 2 }); assert.equal((await local.loadAnalysisQueue()).length, 3);
});
await test('Storage read failure preserves data and later retry recovers', async () => {
  const { values, local, storage } = localFixture(); const raw = JSON.stringify([{date:'2026-09-25',weightKg:80}]);
  values.set('@kandro/weight-entries:v1', raw); const read = storage.getItem;
  storage.getItem = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(local.saveWeightEntry({date:'2026-09-26',weightKg:81}));
  assert.equal(values.get('@kandro/weight-entries:v1'), raw); storage.getItem = read;
  await local.saveWeightEntry({date:'2026-09-26',weightKg:81}); assert.equal((await local.loadWeightEntries()).length, 2);
});

// Execute the current provider callbacks and pure portion function via TS AST.
// These are controller tests with synthetic persistence, not rendered UI.
const appSource = read('src/context/AppContext.tsx');
const appAst = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === name) found = node.initializer.getText(appAst);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(appAst);
    ts.forEachChild(node, visit);
  }
  visit(appAst); assert.ok(found, name); return found;
}
function evaluate(source, env) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), code)(...Object.values(env));
}
const portions = load('src/utils/portions.ts', {});
const correction = load('src/utils/ingredientCorrection.ts', {});
const daypart = load('src/utils/daypart.ts', {});
const mealDay = load('src/utils/mealDay.ts', { '@/utils/date': load('src/utils/date.ts', {}), '@/utils/daypart': daypart });
const scaleItem = evaluate(declaration('scaleItem') + '\nreturn scaleItem;', { ...portions, ...correction });
const countScans = evaluate(declaration('countScans') + '\nreturn countScans;', {});
const callback = (name, env) => evaluate(`return (${declaration(name)});`, { useCallback: x => x, ...env });
const item = grams => scaleItem({ id: 'food', name: 'Synthetic food', amountG: grams, baseAmountG: grams,
  portionFactor: 1, included: true, calories: 100, protein: 10, carbs: 10, fat: 2, fiber: 0,
  nutritionPer100g: { calories: 100, protein: 10, carbs: 10, fat: 2, fiber: 0 },
  source: { provider: 'demo', label: 'Synthetic QA' }, confidence: 'high' }, grams);
const meal = grams => ({ id: 'synthetic-meal', title: 'Synthetic QA', type: 'Lunch', origin: 'scan',
  date: '2026-09-25', time: '12:00', items: [item(grams)], ...item(grams), id: 'synthetic-meal' });
function mealCallbacks() {
  let meals = [meal(100.5)], persisted = [], generation = 0;
  const env = {
    mealHistory: meals, meals, scaleItem, getLocalDataGeneration: () => generation,
    repeatInFlightRef: { current: new Map() },
    consumePlannedMealType: () => null, consumePlannedMealDate: () => null, formatClockTime: () => '12:00', localDateKey: () => '2026-09-26',
    mealTypeForHour: daypart.mealTypeForHour, mealMoment: mealDay.mealMoment,
    saveSyncedMeal: async m => { persisted.push(m); },
    nutritionFromItems: items => Object.fromEntries(['calories','protein','carbs','fat','fiber'].map(k => [k,items.filter(x => x.included).reduce((sum,x) => sum+(x[k]??0),0)])),
    setMeals: fn => { meals = fn(meals); }, setMealHistory: () => {},
  };
  return { env, persisted, current: () => meals, switchAccount() { generation++; meals = []; } };
}
await test('Same draft portion preserves 3 g and 100.5 g ingredients', () => {
  let items = [item(3), item(100.5)];
  const set = callback('setMealPortion', { scaleItem, setMealPortionState() {}, setPortionEstimated() {}, setDetectedItems: fn => { items = fn(items); } });
  const original = structuredClone(items); set(1); assert.deepEqual(items, original);
});
await test('Logged portion round-trip preserves decimal base and nutrition reference', async () => {
  const f = mealCallbacks(); const edit = callback('adjustLoggedMealPortion', f.env);
  await edit('synthetic-meal', 0.7); await edit('synthetic-meal', 1.4); await edit('synthetic-meal', 1);
  assert.equal(f.persisted.at(-1).items[0].amountG, 100.5);
  assert.deepEqual(f.persisted.at(-1).items[0], item(100.5));
});
await test('Repeat of an AI meal stays free after history reload', async () => {
  const f = mealCallbacks(); const repeat = callback('logRepeatMeal', f.env);
  const source = meal(100.5); const result = await repeat({ key: 'synthetic', source });
  assert.equal(result.origin, 'plan'); assert.equal(countScans([source, result]), 1);
});
await test('Immediate duplicate repeat dispatch persists exactly once', async () => {
  const f = mealCallbacks(); const gate = deferred();
  f.env.saveSyncedMeal = async m => { f.persisted.push(m); await gate.promise; };
  const repeat = callback('logRepeatMeal', f.env), candidate = { key: 'synthetic', source: meal(100.5) };
  const first = repeat(candidate), second = repeat(candidate); gate.resolve(); await Promise.all([first, second]);
  assert.equal(f.persisted.length, 1);
});
await test('Late portion-save response cannot repopulate another account UI', async () => {
  const f = mealCallbacks(), gate = deferred(); f.env.saveSyncedMeal = () => gate.promise;
  const pending = callback('adjustLoggedMealPortion', f.env)('synthetic-meal', 0.7);
  f.switchAccount(); gate.resolve(); await pending.catch(() => undefined); assert.deepEqual(f.current(), []);
});
await test('Account switch during delete ownership lookup prevents local deletion', async () => {
  let generation = 0, calls = 0; const gate = deferred(), started = deferred();
  const sync = load('src/services/syncRepository.ts', {
    '@/services/telemetry': { trackEvent() {}, captureOperationalError() {} },
    '@/services/cloudRepository': { deleteCloudMeal: async () => false },
    '@/services/appAccess': { authorizeMealCreate: async () => undefined }, '@/services/hardWall': { markHardWallUsed: async () => undefined },
  '@/services/localRepository': { getLocalDataGeneration: () => generation, loadLocalAccountSwitch: async () => null, deleteMeal: async () => { calls++; return []; } },
    '@/services/supabaseClient': { getCurrentSessionUserId: async () => { started.resolve(); return gate.promise; } },
    '@/services/mockNutrition': {}, '@/services/personalization': {}, '@/utils/date': {},
  });
  const pending = sync.deleteSyncedMeal('synthetic-meal'); await started.promise;
  generation++; gate.resolve('B');
  await assert.rejects(pending, /identity_changed/); assert.equal(calls, 0);
});

await test('Durable tombstone hides a meal after an interrupted deletion write', async () => {
  const f = localFixture(); await f.local.saveMeal(meal(100.5));
  const write = f.storage.setItem;
  f.storage.setItem = async (k, v) => { if (k === '@kandro/meals:v1') throw new Error('disk unavailable'); return write(k, v); };
  await assert.rejects(f.local.deleteMeal('synthetic-meal'));
  f.storage.setItem = write;
  assert.deepEqual(await f.local.loadAllStoredScans(), []);
  assert.deepEqual(await f.local.loadDeletedMealIds(), ['synthetic-meal']);
});
await test('Failed repeat unlocks and late account response cannot insert old meal', async () => {
  const f = mealCallbacks(); f.env.saveSyncedMeal = async () => { throw new Error('disk unavailable'); };
  const repeat = callback('logRepeatMeal', f.env), candidate = { key: 'synthetic', source: meal(100.5) };
  await assert.rejects(repeat(candidate)); assert.equal(f.env.repeatInFlightRef.current.size, 0);
  const gate = deferred(); f.env.saveSyncedMeal = () => gate.promise;
  // Re-extract after changing the adapter: the source callback captures its dependency.
  const pending = callback('logRepeatMeal', f.env)(candidate); f.switchAccount(); gate.resolve();
  await assert.rejects(pending, /identity_changed/); assert.deepEqual(f.current(), []);
});
await test('Rapid unit reversal persists the last choice during a delayed write', async () => {
  const f = localFixture(), gate = deferred(), started = deferred();
  const profileRef = { current: { unitSystem: 'metric', weightKg: 90.5, heightCm: 180 } };
  const write = f.storage.setItem; let writes = 0;
  f.storage.setItem = async (key, value) => {
    if (key === '@kandro/profile:v1' && ++writes === 1) { started.resolve(); await gate.promise; }
    return write(key, value);
  };
  const inFlight = { current: 0 };
  const set = callback('setUnitSystem', {
    profileRef, unitWritesInFlightRef: inFlight, getLocalDataGeneration: f.local.getLocalDataGeneration,
    saveProfile: f.local.saveProfile, setProfile: p => { profileRef.current = p; }, isSupabaseConfigured: false,
  });
  const us = set('us'); await started.promise;
  const metric = set('metric'); gate.resolve(); await Promise.all([us, metric]);
  assert.equal((await f.local.loadProfile()).unitSystem, 'metric');
  assert.equal(profileRef.current.unitSystem, 'metric');
  assert.equal(profileRef.current.weightKg, 90.5); assert.equal(inFlight.current, 0);
  f.storage.setItem = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(set('us')); assert.equal(inFlight.current, 0);
  assert.equal(profileRef.current.unitSystem, 'metric');
});
console.log(JSON.stringify({ method: 'real modules, synthetic storage and React/controller/SDK boundary adapters', results }, null, 2));
if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
