import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

function load(file, deps = {}, dev = false) {
  const module = { exports: {} };
  const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', '__DEV__', js)(name => {
    assert.ok(name in deps, 'Unmocked ' + name); return deps[name];
  }, module, module.exports, dev);
  return module.exports;
}
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const policy = load('src/services/revenueCatExperimentPolicy.ts');
const access = { experiment: 'paywall_access_v1', variant: 'A', source: 'public', environment: 'production', hard: false, access: 'free', validUntil: null };
const eligible = { consent: true, age: 25, record: access, origin: 'production', originalVariant: null };
assert.deepEqual(policy.experimentAttributes(eligible), { kandro_experiment: 'paywall_access_v1', kandro_variant: 'A', kandro_measurement_consent: 'rc_experiment_v1' });
for (const patch of [{ consent: false }, { age: 17 }, { age: null }, { age: NaN }, { origin: 'unknown' }, { origin: 'test' }, { originalVariant: 'B' },
  ...['excluded', 'unassigned'].map(variant => ({ record: { ...access, variant } })),
  ...['qa'].map(source => ({ record: { ...access, source } })),
  ...['testflight', 'local', 'review'].map(environment => ({ record: { ...access, environment } }))]) {
  assert.equal(policy.experimentAttributes({ ...eligible, ...patch }), null);
}
assert.equal(policy.experimentAttributes({ ...eligible, record: { ...access, variant: 'B', hard: true, access: 'inactive' } }).kandro_variant, 'B', 'hard-paywall abandonment does not exclude its original group');
assert.equal(policy.experimentAttributes({ ...eligible, record: { ...access, access: 'active' } }).kandro_variant, 'A', 'a later purchase never redraws assignment');

const values = new Map(); let failWrite = false;
const storage = {
  getItem: async key => values.get(key) ?? null,
  setItem: async (key, value) => { if (failWrite) throw Error('disk'); values.set(key, value); },
  getAllKeys: async () => [...values.keys()], multiRemove: async keys => keys.forEach(key => values.delete(key)),
};
const consent = load('src/services/revenueCatExperimentConsent.ts', {
  '@react-native-async-storage/async-storage': storage, '@/services/revenueCatExperimentPolicy': policy,
});
assert.equal((await consent.readRevenueCatExperimentConsent('one')).enabled, false);
values.set('@kandro/analytics-consent:v1', 'true');
assert.equal((await consent.readRevenueCatExperimentConsent('one')).enabled, false, 'PostHog consent is never imported');
await consent.setRevenueCatExperimentConsent('one', true);
assert.equal((await consent.readRevenueCatExperimentConsent('two')).enabled, false, 'consent belongs only to its account');
assert.equal(await consent.rememberRevenueCatExperimentVariant('one', 'A'), true);
assert.equal(await consent.rememberRevenueCatExperimentVariant('one', 'B'), false);
failWrite = true;
const failedRevoke = consent.setRevenueCatExperimentConsent('one', false);
assert.equal(consent.peekRevenueCatExperimentConsent('one').enabled, false, 'revocation closes synchronously, even on disk failure');
await assert.rejects(failedRevoke, /disk/); failWrite = false;
await consent.setRevenueCatExperimentConsent('one', false);
const consentReload = load('src/services/revenueCatExperimentConsent.ts', { '@react-native-async-storage/async-storage': storage, '@/services/revenueCatExperimentPolicy': policy });
assert.equal((await consentReload.readRevenueCatExperimentConsent('one')).enabled, false);
assert.equal((await consentReload.readRevenueCatExperimentConsent('one')).pendingRemoval, true, 'removal survives app restart');

process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'public-fixture';
let owner = 'one', rcOwner = 'one', configured = true, idHold = null, writeHold = null;
const writes = [], logins = [];
const sdk = {
  isConfigured: async () => configured, getAppUserID: async () => { if (idHold) await idHold.promise; return rcOwner; },
  setAttributes: async attributes => { writes.push({ owner: rcOwner, attributes }); if (writeHold) await writeHold.promise; },
  logIn: async user => { logins.push(user); rcOwner = user; }, setLogLevel: async () => {}, configure: () => { configured = true; },
  getCustomerInfo: async () => ({ entitlements: { active: {} } }), isAnonymous: async () => false, logOut: async () => { rcOwner = 'anonymous'; },
};
const subscription = load('src/services/subscription.ts', {
  'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'expo' } },
  'react-native': { Platform: { OS: 'ios' } },
  'react-native-purchases': { __esModule: true, default: sdk, LOG_LEVEL: {}, INTRO_ELIGIBILITY_STATUS: {}, PURCHASES_ERROR_CODE: {} },
  '@/services/supabaseClient': { getCurrentSessionUserId: async () => owner, ensureSupabaseUser: async () => ({ id: owner }) },
  '@/services/retention': load('src/services/retention.ts', {}),
  '@/i18n/active': { getDictionary: () => ({}) },
});
const attributes = policy.experimentAttributes(eligible);
assert.equal(await subscription.writeRevenueCatExperimentAttributes('one', attributes, () => false), false);
idHold = deferred();
const stale = subscription.writeRevenueCatExperimentAttributes('one', attributes, () => true);
await settle(); owner = 'two'; idHold.resolve(); idHold = null;
assert.equal(await stale, false); assert.equal(writes.length, 0, 'identity race cannot bind old A/B data to new account');
owner = 'one'; rcOwner = 'one'; writeHold = deferred();
const writing = subscription.writeRevenueCatExperimentAttributes('one', attributes, () => true);
await settle(); owner = 'two';
const switching = subscription.loadSubscriptionTrial(); await settle();
assert.equal(logins.length, 0, 'RC login waits for attribute operation');
writeHold.resolve(); writeHold = null; await writing; await switching;
assert.equal(writes[0].owner, 'one'); assert.equal(rcOwner, 'two');

let originValue = 'unknown', originCalls = 0, originHold = null;
const origin = load('src/services/revenueCatExperimentOrigin.ts', {
  expo: { requireOptionalNativeModule: () => ({ experimentInstallOrigin: async () => { originCalls++; if (originHold) await originHold.promise; return originValue; } }) },
  'react-native': { Platform: { OS: 'ios' } },
});
assert.equal(await origin.readRevenueCatExperimentOrigin(), 'unknown');
originValue = 'not-a-production-proof'; assert.equal(await origin.readRevenueCatExperimentOrigin(), 'unknown');
const debugOrigin = load('src/services/revenueCatExperimentOrigin.ts', { expo: { requireOptionalNativeModule: () => ({ experimentInstallOrigin: () => { throw Error('should not call'); } }) }, 'react-native': { Platform: { OS: 'ios' } } }, true);
assert.equal(await debugOrigin.readRevenueCatExperimentOrigin(), 'test');
const absentOrigin = load('src/services/revenueCatExperimentOrigin.ts', { expo: { requireOptionalNativeModule: () => null }, 'react-native': { Platform: { OS: 'ios' } } });
assert.equal(await absentOrigin.readRevenueCatExperimentOrigin(), 'unknown', 'old binary never assumes production');

await consent.clearRevenueCatExperimentConsentAfterDeletion(); owner = 'one'; rcOwner = 'one'; writes.length = 0; originCalls = 0;
let accessVerified = true;
const analytics = load('src/services/revenueCatExperimentAnalytics.ts', {
  '@/services/supabaseClient': { getCurrentSessionUserId: async () => owner }, '@/services/subscription': subscription,
  '@/services/appAccess': { isAppAccessMeasurementVerified: expected => accessVerified && expected === owner },
  '@/services/revenueCatExperimentPolicy': policy, '@/services/revenueCatExperimentConsent': consent, '@/services/revenueCatExperimentOrigin': origin,
});
const context = { owner: 'one', ready: true, serverVerified: true, age: 25, record: access };
analytics.updateRevenueCatExperimentMeasurement(context); await settle();
assert.equal(originCalls, 0); assert.equal(writes.length, 0, 'no default-off Apple check or RC export');
originValue = 'unknown'; await analytics.setRevenueCatExperimentMeasurementEnabled(true); await settle();
assert.equal(writes.length, 0); assert.equal(analytics.getRevenueCatExperimentMeasurementSnapshot().status, 'paused');
originValue = 'test'; analytics.updateRevenueCatExperimentMeasurement(context); await settle(); assert.equal(writes.length, 0);
accessVerified = false;
originValue = 'production'; analytics.updateRevenueCatExperimentMeasurement({ ...context, serverVerified: false, record: { ...access, variant: 'B', hard: true, access: 'inactive' } }); await settle();
assert.equal(writes.length, 0, 'an old cached public B label is not a live measurement authorization');
analytics.updateRevenueCatExperimentMeasurement(context); await settle(); assert.equal(writes.length, 0, 'stale component props cannot bypass the synchronous owner freshness gate');
accessVerified = true;
originValue = 'production'; analytics.updateRevenueCatExperimentMeasurement(context); await settle();
assert.equal(writes.length, 1); assert.deepEqual(writes[0], { owner: 'one', attributes });
assert.equal(analytics.getRevenueCatExperimentMeasurementSnapshot().status, 'accepted');
analytics.updateRevenueCatExperimentMeasurement({ ...context, record: { ...access, access: 'active' } }); await settle();
assert.equal(writes.length, 1, 'later entitlement and foreground refresh do not resend or redraw');
analytics.updateRevenueCatExperimentMeasurement({ ...context, record: { ...access, variant: 'B' } }); await settle();
assert.equal(writes.length, 1, 'unexpected later variant cannot rewrite ITT assignment');
analytics.updateRevenueCatExperimentMeasurement({ ...context, record: { ...access, source: 'qa' } }); await settle();
assert.deepEqual(writes.at(-1).attributes, policy.clearedExperimentAttributes(), 'a later QA assignment removes previously accepted tags');
assert.equal(consent.peekRevenueCatExperimentConsent('one').enabled, true, 'QA removal does not silently change consent or assignment');
analytics.updateRevenueCatExperimentMeasurement(context); await settle();
assert.deepEqual(writes.at(-1).attributes, attributes);
accessVerified = false; analytics.updateRevenueCatExperimentMeasurement({ ...context, serverVerified: false }); await settle();
configured = false; await analytics.setRevenueCatExperimentMeasurementEnabled(false); await settle();
assert.equal(analytics.getRevenueCatExperimentMeasurementSnapshot().status, 'removal_pending');
assert.equal(consent.peekRevenueCatExperimentConsent('one').enabled, false);
configured = true; analytics.updateRevenueCatExperimentMeasurement(context); await settle();
assert.deepEqual(writes.at(-1).attributes, policy.clearedExperimentAttributes());
assert.equal(accessVerified, false, 'attribute removal does not require a fresh access response');
assert.equal(consent.peekRevenueCatExperimentConsent('one').pendingRemoval, false);
assert.equal(writes.at(-1).attributes.kandro_variant, '', 'SDK documented empty string deletes only our keys');

writes.length = 0; accessVerified = true; originHold = deferred();
await analytics.setRevenueCatExperimentMeasurementEnabled(true); await settle();
await analytics.setRevenueCatExperimentMeasurementEnabled(false);
await settle();
assert.deepEqual(writes.at(-1).attributes, policy.clearedExperimentAttributes(), 'a stalled Apple request does not delay removal');
originHold.resolve(); originHold = null; await settle();
assert.equal(writes.filter(call => call.attributes.kandro_variant !== '').length, 0, 'revocation during native verification prevents late export');

writes.length = 0; originCalls = 0;
analytics.updateRevenueCatExperimentMeasurement({ ...context, record: { ...access, source: 'qa' } });
await analytics.setRevenueCatExperimentMeasurementEnabled(true); await settle();
assert.equal(writes.length, 0); assert.equal(originCalls, 0, 'QA is excluded before Apple verification');
analytics.updateRevenueCatExperimentMeasurement({ ...context, age: 17 }); await settle();
assert.equal(consent.peekRevenueCatExperimentConsent('one').enabled, false, 'confirmed minor disables persisted opt-in');
await assert.rejects(analytics.setRevenueCatExperimentMeasurementEnabled(true), /unavailable/);
analytics.invalidateRevenueCatExperimentMeasurement(); owner = 'two'; rcOwner = 'two';
analytics.updateRevenueCatExperimentMeasurement({ ...context, owner: 'two' }); await settle();
assert.equal(analytics.getRevenueCatExperimentMeasurementSnapshot().consent, false);
writeHold = deferred();
const inFlightWrite = subscription.writeRevenueCatExperimentAttributes('two', attributes, () => true);
await settle();
let erased = false;
const deletion = analytics.clearRevenueCatExperimentMeasurementForAccountDeletion().then(() => { erased = true; });
await settle(); assert.equal(erased, false, 'backend deletion must wait until in-flight optional attributes have been drained');
writeHold.resolve(); writeHold = null; await inFlightWrite; await deletion;
assert.deepEqual(writes.at(-1).attributes, policy.clearedExperimentAttributes());
assert.equal([...values.keys()].some(key => key.startsWith('@kandro/rc-experiment-consent:')), false);
assert.equal(values.get('@kandro/analytics-consent:v1'), 'true', 'separate consent storage never changes PostHog preference');

// Execute the native classification policy itself with positive, negative and
// unknown proofs. Device StoreKit verification remains a separate native gate.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kandro-origin-policy-'));
try {
  const swift = `import Foundation\nlet bundle = KandroExperimentOriginPolicy.productionBundle\nfunc check(_ proof: Bool, _ id: String?, _ env: String, _ result: String) { precondition(KandroExperimentOriginPolicy.classify(verified: proof, bundleID: id, environment: env) == result) }\ncheck(true,bundle,"production","production")\ncheck(true,bundle,"sandbox","test")\ncheck(true,bundle,"xcode","test")\ncheck(false,bundle,"production","unknown")\ncheck(true,"qa.bundle","production","unknown")\ncheck(true,nil,"production","unknown")\ncheck(true,bundle,"future","unknown")\nprint("PASS native origin policy 7 branches")\n`;
  fs.writeFileSync(path.join(temporary, 'main.swift'), swift);
  const binary = path.join(temporary, 'origin-policy');
  const compile = spawnSync('swiftc', [new URL('../modules/kandro-widgets/ios/ExperimentOriginPolicy.swift', import.meta.url).pathname, path.join(temporary, 'main.swift'), '-o', binary], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const execute = spawnSync(binary, [], { encoding: 'utf8' }); assert.equal(execute.status, 0, execute.stderr); process.stdout.write(execute.stdout);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('PASS RC optional measurement: actual consent, policy, SDK writer and lifecycle modules; default-off, provenance, QA, ITT, identity races, revocation/retry and deletion. Mocked SDK acceptance is not live delivery.');
