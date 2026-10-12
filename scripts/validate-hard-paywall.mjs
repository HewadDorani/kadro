// Owner decision 2026-10-10: new installs get ONE free AI analysis (the first
// scan), then a hard paywall without a close button. Existing installs keep
// their free scope. Actual client modules with mocked native/network
// boundaries; the SQL side is covered by validate-hard-paywall-postgres.py.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function compile(path, mocks = {}) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => { assert.ok(id in mocks, `${path}: unmocked ${id}`); return mocks[id]; }, module, module.exports);
  return module.exports;
}
const ticks = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const passed = [];
const check = name => { passed.push(name); console.log('PASS', name); };

const policy = compile('src/services/accessPolicy.ts');
const now = Date.now();
const legacy = { ...policy.FREE_ACCESS, mode: 'legacy', freeAnalyses: 3 };
const fresh = { ...policy.FREE_ACCESS, mode: 'hard_after_first_scan', freeAnalyses: 1 };
const resolve = (record, local) => policy.resolveAccess(policy.applyHardWall(record, local));

// 1. Policy: server decides, install flag only without a server answer.
assert.equal(resolve(fresh, { cohort: true, used: false }), 'free', 'the first scan is free');
assert.equal(resolve(fresh, { cohort: false, used: false }), 'free');
assert.equal(resolve(fresh, { cohort: false, used: true }), 'locked', 'server mode wins over a missing install flag');
assert.equal(resolve({ ...fresh, hard: true, access: 'inactive' }, { cohort: true, used: false }), 'locked', 'server-known first meal locks');
assert.equal(resolve({ ...fresh, hard: true, access: 'active', validUntil: new Date(now + 60_000).toISOString() }, { cohort: true, used: true }), 'active', 'an active entitlement (trial) unlocks');
assert.equal(resolve({ ...fresh, access: 'active', validUntil: new Date(now + 60_000).toISOString() }, { cohort: true, used: true }), 'active');
assert.equal(resolve({ ...fresh, hard: true, access: 'unknown' }, { cohort: true, used: true }), 'verification', 'unknown entitlement is never treated as free');
assert.equal(resolve(legacy, { cohort: true, used: true }), 'free', 'legacy server scope ignores the install flag');
assert.equal(resolve({ ...legacy, variant: 'B', hard: false }, { cohort: false, used: true }), 'free', 'paused B stays soft');
assert.equal(resolve(policy.FREE_ACCESS, { cohort: true, used: false }), 'free', 'offline: the first scan stays allowed');
assert.equal(resolve(policy.FREE_ACCESS, { cohort: true, used: true }), 'locked', 'offline: after the first meal the paywall follows');
assert.equal(resolve(policy.FREE_ACCESS, { cohort: false, used: true }), 'free', 'offline legacy install keeps its free scope');
assert.equal(policy.parseAccessRecord({ ...fresh, hard: true, access: 'inactive' }).hard, true, 'a hard record without variant B is valid only in the hard-wall mode');
assert.throws(() => policy.parseAccessRecord({ ...legacy, hard: true, access: 'inactive' }));
assert.throws(() => policy.parseAccessRecord({ ...fresh, mode: 'unlimited' }));
assert.throws(() => policy.parseAccessRecord({ ...fresh, freeAnalyses: 99 }));
assert.throws(() => policy.parseAccessRecord({ ...fresh, hard: true, access: 'free' }));
assert.equal(policy.firstMealRevealOpen('/result', 'scan'), true);
for (const [path, stage] of [['/result', null], ['/result', 'paywall'], ['/plan', 'scan'], ['/today', 'scan']]) assert.equal(policy.firstMealRevealOpen(path, stage), false, `${path} ${stage}`);
for (const route of ['/paywall', '/account-help', '/privacy', '/terms', '/account-deletion', '/data-consent', '/saved-meals']) assert.equal(policy.routeRequiresAccess(route), false, route);
for (const route of ['/today', '/plan', '/scan', '/capture', '/progress', '/recipe', '/result', '/confirm', '/evening']) assert.equal(policy.routeRequiresAccess(route), true, route);
check('policy: new user 1 free scan then locked, trial unlocks, legacy unchanged, offline fallback, only paywall/help/legal/data routes stay open');

// 2. Actual appAccess + hardWall store: the gate used by every new meal save.
const storage = new Map(); let owner = 'fresh', network = true, remote = fresh; const rpcs = [];
const asyncStorage = { getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => { storage.set(k, v); }, removeItem: async k => { storage.delete(k); } };
const hardWall = compile('src/services/hardWall.ts', { '@react-native-async-storage/async-storage': asyncStorage });
const app = compile('src/services/appAccess.ts', {
  '@react-native-async-storage/async-storage': asyncStorage, '@/services/accessPolicy': policy, '@/services/hardWall': hardWall,
  '@/services/supabaseClient': { functionsBaseUrl: 'https://fixture.invalid/functions/v1', supabaseAnonKey: 'fixture-public', getAccessSession: async () => ({ userId: owner, accessToken: 'fixture' }), getCurrentSessionUserId: async () => owner, supabase: { rpc: async (name, args) => { rpcs.push([name, args]); return { error: null }; } } },
  '@/i18n/active': { getDictionary: () => ({ access: { accessRequired: 'access_required', saveOnline: 'online_required' } }) },
  '@/services/subscription': { loadSubscriptionSnapshot: async () => ({ mode: 'native-store', plans: {} }) }, '@/services/serverEntitlement': { refreshServerEntitlement: async () => false },
});
globalThis.fetch = async url => { assert.equal(new URL(url).hostname, 'fixture.invalid'); if (!network) throw Error('offline'); return { ok: true, json: async () => remote }; };
await hardWall.startHardWallInstall();
assert.deepEqual(JSON.parse(storage.get('@kandro/hard-wall:v1')), { cohort: true, used: false }, 'onboarding marks a fresh install');
assert.equal((await app.refreshAppAccess()).mode, 'hard_after_first_scan');
assert.equal(hardWall.getHardWallSnapshot().serverMode, 'hard_after_first_scan');
await app.authorizeMealCreate('first-meal'); assert.deepEqual(rpcs, [], 'the free first meal needs no receipt and works offline');
await hardWall.markHardWallUsed();
await assert.rejects(app.authorizeMealCreate('second-meal'), /access_required/, 'no second meal without Pro');
remote = { ...fresh, hard: true, access: 'active', validUntil: new Date(Date.now() + 60_000).toISOString() };
await app.refreshAppAccess(); await app.authorizeMealCreate('trial-meal');
assert.deepEqual(rpcs.map(([name, args]) => [name, args.p_meal_id]), [['authorize_meal_create_v1', 'trial-meal']], 'a trial unlocks with a server receipt');
network = false; owner = 'offline-fresh'; app.invalidateAppAccess();
assert.equal(hardWall.getHardWallSnapshot().serverMode, null, 'an identity change forgets the server mode');
assert.equal((await app.refreshAppAccess()).mode, undefined, 'offline without cache: no server mode');
await assert.rejects(app.assertNewAppUse(), /access_required/, 'offline after the first meal: paywall');
owner = 'pre-migration'; network = true; remote = { ...policy.FREE_ACCESS }; app.invalidateAppAccess();
assert.equal((await app.refreshAppAccess()).mode, undefined, 'a server answer without mode leaves the decision to the install flag');
await assert.rejects(app.assertNewAppUse(), /access_required/, 'before the server migration a fresh install is still walled after its free meal');
owner = 'legacy'; remote = { ...policy.FREE_ACCESS, mode: 'legacy' }; app.invalidateAppAccess();
assert.equal((await app.refreshAppAccess()).mode, 'legacy', 'the server legacy mode keeps the free scope');
await app.assertNewAppUse();
network = false; assert.equal((await app.refreshAppAccess()).mode, 'legacy', 'offline keeps the last server mode');
await app.assertNewAppUse();
check('appAccess: free first meal offline, locked after it, trial receipt, offline fallback, pre-migration server, legacy server scope and cached mode');

// 3. The real paywall screen.
const dict = compile('src/i18n/en.ts').en;
function hooks() {
  const slots = []; let cursor = 0, effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const n = cursor++; if (!slots[n]) slots[n] = { value: initial }; return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) slots[n] = { value: fn(), deps }; return slots[n].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { slots[n] = { deps }; effects.push(fn); } },
  };
  return { react, render(Screen) { cursor = 0; const tree = Screen(); const queue = effects; effects = []; queue.forEach(fn => fn()); return tree; } };
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const texts = tree => nodes(tree).filter(n => n.type === 'Text').map(n => [n.props.children].flat(Infinity).join(''));
const plan = (yearly, trial) => ({ price: yearly ? '£59.00 / year' : '£7.99 / month', detail: '', billing: yearly ? 'Billed yearly' : 'Billed monthly', hasFreeTrial: trial, trialLabel: trial ? '7 days' : null, trialDays: trial ? 7 : null, priceAmount: yearly ? 59 : 7.99, monthlyEquivalent: yearly ? 4.92 : 7.99, package: { product: { identifier: yearly ? 'annual' : 'monthly', priceString: yearly ? '£59.00' : '£7.99', pricePerMonthString: yearly ? '£4.92' : undefined, currencyCode: 'GBP' } } });
function paywall({ hard, hardWall: wall, canUse = false, trial = true, reason }) {
  const h = hooks(); const shown = []; const back = [];
  const subscription = { status: 'ready', busy: false, error: null, snapshot: { configured: true, mode: 'native-store', plans: { yearly: plan(true, trial), monthly: plan(false, trial) } }, async purchase() { return 'cancelled'; }, async refresh() {}, async restore() { return 'none'; }, async syncTrialReminder() { return true; } };
  const jsx = (type, props) => ({ type, props });
  const screen = compile('src/app/paywall.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', Alert: { alert() {} }, Animated: { Value: class { constructor(v) { this.v = v; } }, View: 'AnimatedView', timing: () => ({ start() {} }) }, BackHandler: { addEventListener: (_, fn) => { back.push(fn); return { remove() {} }; } }, Linking: { openSettings: async () => {} }, Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: x => x }, Text: 'Text', View: 'View', useWindowDimensions: () => ({ fontScale: 1 }) },
    'expo-router': { Stack: { Screen: 'Stack' }, useFocusEffect(fn) { h.react.useEffect(fn, [fn]); }, useLocalSearchParams: () => ({ reason }), useRouter: () => ({ replace() {}, push() {} }) },
    'react-native-safe-area-context': { SafeAreaView: 'Safe', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@expo/vector-icons/Ionicons': 'Icon', '@/components/ui': { PrimaryButton: 'Primary' }, '@/components/KandroMark': { KandroMark: 'Mark' },
    '@/constants/theme': { radii: {}, typeScale: { micro: 12, caption: 13, compact: 15, body: 17, heading: 22, title: 32, display: 56 } }, '@/constants/product': { FREE_SCAN_ALLOWANCE: 3 },
    '@/services/presentation': { usePresentationBlock() {} }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/context/AccessContext': { useAccess: () => ({ record: { hard, variant: 'excluded', source: 'public' }, hardWall: wall, refresh: async () => {}, markSeen() {}, ready: true, state: canUse ? 'free' : 'locked', canUse, entryPaywall: false }) },
    '@/context/AppContext': { useApp: () => ({ freeScansLeft: wall ? 0 : 2 }) }, '@/services/accessPolicy': { takeAccessDestination: () => '/today' }, '@/context/SubscriptionContext': { useSubscription: () => subscription },
    '@/hooks/useFirstRun': { useFirstRun: () => null }, '@/services/firstRun': { finishFirstRunOffer: async () => {} },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: dict, locale: 'en-GB' }) }, '@/services/haptics': { successHaptic() {} },
    '@/services/reminders': { TRIAL_REMINDER_LEAD_DAYS: 2, getReminderPermission: async () => 'authorized', requestReminderPermission: async () => 'authorized' },
    '@/services/telemetry': { toBillingMode: x => x, trackEvent() {} }, '@/services/paywallExposure': { markPaywallShown: context => shown.push(context) },
  }).default;
  h.render(screen); const tree = h.render(screen);
  return { tree, shown, back, all: nodes(tree), texts: texts(tree) };
}
{
  const locked = paywall({ hard: true, hardWall: true });
  assert.ok(!locked.all.some(n => n.props?.accessibilityLabel === dict.paywall.close), 'hard wall: no close button');
  assert.equal(locked.all.find(n => n.type === 'Stack').props.options.gestureEnabled, false, 'hard wall: no swipe dismiss');
  assert.equal(locked.back[0](), true, 'hard wall: hardware back is consumed');
  assert.deepEqual(locked.shown, ['hard'], 'exposure context is hard');
  assert.ok(locked.texts.includes(dict.paywall.hardWallTitleTrial(7)));
  assert.ok(locked.texts.includes(dict.paywall.hardWallSubTrial(dict.paywall.chargeYearly('£59.00', '£4.92'))), 'real store price and monthly equivalent');
  assert.equal(locked.all.find(n => n.type === 'Primary').props.label, dict.paywall.hardWallTrialCta(7));
  assert.ok(!locked.texts.includes(dict.paywall.freeTitle), 'no free-scope card behind the hard wall');
  assert.ok(locked.texts.some(text => text.includes(dict.paywall.fairUse)), 'fair-use disclosure stays');
  assert.ok(locked.texts.includes(`${dict.access.accountHelp} · ${dict.access.signIn}`), 'account & help path');
  assert.ok(locked.texts.includes(dict.paywall.restore) && locked.texts.includes(dict.paywall.terms) && locked.texts.includes(dict.paywall.privacy), 'restore, terms, privacy');
  const cards = locked.all.filter(n => n.type?.name === 'PlanCard').map(n => n.props);
  assert.deepEqual(cards.map(card => [card.label, card.selected]), [[dict.paywall.yearly, true], [dict.paywall.monthly, false]], 'annual preselected, monthly option');
  assert.match(cards[0].detail, /£4\.92\/month · 7 days free/, 'annual card: monthly equivalent and trial');
  const noTrial = paywall({ hard: true, hardWall: true, trial: false });
  assert.equal(noTrial.all.find(n => n.type === 'Primary').props.label, dict.paywall.ctaStart, 'without trial eligibility: "Start Kandro Pro"');
  assert.ok(noTrial.texts.includes(dict.paywall.hardWallTitle) && noTrial.texts.includes(dict.paywall.hardWallSub(dict.paywall.chargeYearly('£59.00', '£4.92'))));
  assert.ok(!noTrial.texts.some(text => /free/i.test(text) && text.includes('7')), 'no trial promise without eligibility');
  const subscribed = paywall({ hard: true, hardWall: true, canUse: true });
  assert.ok(subscribed.all.some(n => n.props?.accessibilityLabel === dict.paywall.close), 'an active trial can close it');
  const old = paywall({ hard: false, hardWall: false });
  assert.ok(old.all.some(n => n.props?.accessibilityLabel === dict.paywall.close), 'legacy stays soft');
  assert.ok(old.texts.includes(dict.paywall.freeTitle) && old.texts.includes(dict.paywall.headline), 'legacy keeps its free-scope card and headline');
  assert.equal(old.all.find(n => n.type === 'Stack').props.options.gestureEnabled, true);
}
for (const language of ['de', 'en']) {
  const d = compile(`src/i18n/${language}.ts`)[language];
  for (const copy of [d.paywall.hardWallTitleTrial(7), d.paywall.hardWallSubTrial('x'), d.paywall.hardWallTrialCta(7), d.onboarding.firstScan.trialScan]) assert.doesNotMatch(copy, /unbegrenzt|unlimited|as much as you like/i);
}
const de = compile('src/i18n/de.ts').de;
assert.equal(de.paywall.hardWallTitleTrial(7), 'Dein Plan steht. Starte jetzt deine 7 Tage gratis.');
assert.equal(de.paywall.hardWallSubTrial(de.paywall.chargeYearly('49,99 €', '4,17 €')), 'Danach 49,99 €/Jahr (4,17 €/Monat). Jederzeit in den Apple-Einstellungen kündbar.');
assert.equal(de.paywall.hardWallTrialCta(7), '7 Tage gratis starten');
assert.equal(de.paywall.ctaStart, 'Kandro Pro starten');
assert.doesNotMatch(read('src/app/paywall.tsx'), /49,99|4,17|59\.00/, 'prices come from RevenueCat, never hard-coded');
check('paywall: hard variant without close/swipe/back, store prices, trial CTA or "Start Kandro Pro", restore/legal/help, no free-scope card; legacy soft');

// 4. First-scan screen: sample-analysis copy; "Später" goes straight to the hard paywall.
{
  const routes = [], calls = []; const jsx = (type, props) => ({ type, props }); let wall = true;
  const Screen = compile('src/app/first-scan.tsx', {
    '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' }, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({ replace: to => routes.push(to) }) }, react: { useRef: v => ({ current: v }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', StyleSheet: { create: a => a }, Text: 'Text', View: 'View' }, '@/components/KandroMark': { KandroMark: 'Mark' }, '@/components/ui': { Screen: 'Screen' },
    '@/constants/product': { FREE_SCAN_ALLOWANCE: 3 }, '@/constants/theme': { radii: {} }, '@/context/AppContext': { useApp: () => ({ freeScansLeft: 1 }) },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) }, '@/hooks/useFirstRun': { useFirstRun: () => 'scan' },
    '@/hooks/useHardWall': { useFreeScanAllowance: () => ({ hardWall: wall, allowance: wall ? 1 : 3 }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: de }) }, '@/services/firstRun': { setFirstRunStage: async stage => { calls.push(stage); } },
    '@/services/hardWall': { markHardWallUsed: async () => { calls.push('used'); } }, '@/services/haptics': { selectionHaptic() {} },
  }).default;
  const tree = Screen(); const allTexts = texts(tree);
  assert.ok(allTexts.includes(de.onboarding.firstScan.trialScan) && de.onboarding.firstScan.trialScan.startsWith('Deine kostenlose Probe-Analyse'), 'sample-analysis copy');
  assert.ok(!allTexts.some(text => /1\. von|von 3/.test(text)), 'no more "1. von 3" behind the hard wall');
  nodes(tree).filter(n => n.type === 'Pressable').at(-1).props.onPress(); await ticks();
  assert.deepEqual(calls, ['used', 'paywall'], '"Später" spends the free scope (no scan) and ends the run at the offer');
  assert.equal(routes.at(-1), '/paywall');
  wall = false; assert.ok(texts(Screen()).some(text => text.includes('noch 1 von 3')), 'legacy first run keeps its x-of-3 line');
}
check('first-scan: "Deine kostenlose Probe-Analyse", Später → hard paywall, legacy line unchanged');

// 5. Route guard: after the first meal everything but paywall/help/legal/data goes to the paywall; the result reveal stays.
{
  const firstRun = compile('src/services/firstRun.ts', { '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage }, '@/services/reminders': { prepareReminderOnboarding: async () => {} } });
  function guard(path, stage, access) {
    const slots = []; let cursor = 0, effects = []; const redirects = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const react = {
      useState(value) { const n = cursor++; slots[n] ??= { value }; return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
      useRef(value) { return slots[cursor++] ??= { current: value }; },
      useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { slots[n] = { deps }; effects.push(fn); } },
    };
    const jsx = (type, props) => ({ type, props });
    const Guard = compile('src/components/AppRouteGuard.tsx', {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { StyleSheet: { create: a => a }, Text: 'Text', View: 'View' }, 'expo-apple-authentication': { isAvailableAsync: async () => false },
      'expo-router': { usePathname: () => path, useSegments: () => [path.slice(1)], useRouter: () => ({ replace: to => redirects.push(to) }) },
      '@/components/KandroMark': { KandroMark: 'Brand' }, '@/constants/theme': { typeScale: {} }, '@/components/ui': { PrimaryButton: 'Primary' }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
      '@/context/AccessContext': { useAccess: () => ({ ready: true, enrollmentPending: false, entryPaywall: false, ...access }) }, '@/services/accessPolicy': policy,
      '@/hooks/useReminderOnboarding': { useReminderOnboarding: () => false }, '@/hooks/useFirstRun': { useFirstRun: () => stage }, '@/services/firstRun': { firstRunRedirect: firstRun.firstRunRedirect },
      '@/context/AppContext': { useApp: () => ({ appleReauthenticationRequired: false, analysisStatus: 'ready', detectedItems: [{}], hydrationReady: true, localStorageError: false, mealHistory: [{ id: 'm1' }], profile: { completedAt: '2026-10-10' }, retryAccountRecovery: async () => {}, syncMode: 'cloud', wellnessConsentGranted: true }) },
      '@/i18n/LanguageProvider': { useLanguage: () => ({ t: { account: {} } }) }, '@/utils/mealDraftGuard': { requiresMealDraftRedirect: () => false }, '@/utils/ingredientCorrection': { canSaveMealDraft: () => true },
      '@/services/accountLinking': { appleCredential: async () => null, isAppleCancel: () => false },
    }).AppRouteGuard;
    cursor = 0; const tree = Guard({ children: 'APP' }); effects.forEach(fn => fn());
    return { tree, redirects };
  }
  const locked = { canUse: false, hardWall: true };
  assert.equal(guard('/result', 'scan', locked).tree, 'APP', 'the first meal reveal stays visible');
  for (const path of ['/plan', '/today', '/scan', '/capture', '/progress']) assert.deepEqual(guard(path, 'scan', locked).redirects, ['/paywall'], path);
  assert.deepEqual(guard('/result', null, locked).redirects, ['/paywall'], 'after the run the result is locked too');
  for (const path of ['/paywall', '/account-help', '/privacy', '/terms', '/account-deletion', '/data-consent']) assert.equal(guard(path, null, locked).tree, 'APP', path);
  assert.deepEqual(guard('/result', 'scan', { canUse: false, hardWall: false }).redirects, ['/paywall'], 'the reveal exception is hard-wall only');
  assert.equal(guard('/plan', null, { canUse: true, hardWall: true }).tree, 'APP', 'an active trial opens the app');
}
check('route guard: result reveal open in the run, every other app route → paywall; legal/help/data reachable; trial opens');

// 6. Wiring the guards rely on.
const sync = read('src/services/syncRepository.ts');
assert.match(sync, /if \(result\.outcome === 'created'\) \{[\s\S]*?await markHardWallUsed\(\);/, 'a created meal ends the free scope');
assert.match(read('src/app/onboarding.tsx'), /if \(firstRun\) await startHardWallInstall\(\);\s*[\s\S]*?if \(firstRun\) await setFirstRunStage\('scan'\);/, 'only a fresh onboarding joins the hard wall');
assert.match(read('src/context/AppContext.tsx'), /const freeScansLeft = Math\.max\(0, freeScanAllowance - lifetimeScanCount\);/, 'the free counter follows the hard-wall allowance');
assert.match(read('src/constants/product.ts'), /export const FIRST_SCAN_FREE_ALLOWANCE = 1;/);
const migration = read('supabase/migrations/20261010120000_hard_paywall_after_first_scan.sql');
assert.match(migration, /hard_after_first_scan_starts_at = coalesce\(hard_after_first_scan_starts_at, pg_catalog\.now\(\)\)/, 'cutoff stored once');
assert.match(migration, /u\.created_at>=c\.hard_after_first_scan_starts_at/, 'cohort = accounts created after the cutoff');
assert.match(migration, /hard := \(v='B' and c\.enforcement_enabled\)\s*or \(first_scan and exists\(select 1 from private\.paywall_free_meals/, 'reuses the existing hard enforcement');
assert.match(migration, /then coalesce\(\(paywall->>'freeAnalyses'\)::integer, 1\) else 3 end/, 'one free analysis for the cohort, three otherwise');
assert.match(migration, /md5\(pg_get_functiondef\('private\.paywall_access_v1\(uuid\)'::regprocedure\)\) <> 'eef39a1b53aa4fbab36c4a895fecf8d7'/, 'md5 drift guard');
assert.doesNotMatch(migration, /enforcement_enabled\s*=\s*true|public_enabled\s*=\s*true/, 'the paused A/B test stays paused');
check('wiring: onboarding cohort, sticky first meal, allowance counter, migration contract');
console.log(`PASS ${passed.length} hard-paywall checks.`);
