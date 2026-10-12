// Owner decision 04.10.2026: the paywall test is open to new adult installs,
// linked or anonymous. Protections for existing, minor and paying users stay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261004160156_reopen_paywall_new_installs.sql');
assert.doesNotMatch(migration, /is_anonymous|email_confirmed_at/, 'an anonymous new install must be eligible');
assert.match(migration, /u\.created_at<c\.starts_at or exists\(select 1 from public\.meals where user_id=p_user_id\)/, 'existing accounts stay excluded');
assert.match(migration, /coalesce\(e\.free_completed,0\)>0/, 'prior free use stays excluded');
assert.match(migration, /p\.age<18 or p_age_confirmed is distinct from true/, 'minors stay excluded');
assert.match(migration, /then 'pro'/, 'active subscribers stay excluded');
assert.match(migration, /if exists\(select 1 from private\.paywall_assignments where user_id=p_user_id\) then return/, 'assignments are never re-drawn');
assert.match(migration, /get_byte\(pg_catalog\.uuid_send\(pg_catalog\.gen_random_uuid\(\)\),0\)<128/, '50/50 split');
assert.doesNotMatch(migration, /delete from|update private\.paywall_assignments|alter table/i);

function fixture(ready = true, pending = true) {
  const slots = []; let cursor = 0; const effects = []; const enrolled = [], navigated = [];
  const react = {
    useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = typeof value === 'function' ? value(slots[n]) : value; }]; },
    useRef(initial) { const n = cursor++; if (!(n in slots)) slots[n] = { current: initial }; return slots[n]; },
    useEffect(fn) { effects.push(fn); },
  };
  const jsx = (type, props) => ({ type, props });
  const access = { ready, enrollmentPending: pending, async enroll(value) { enrolled.push(value); } };
  const mocks = { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': { Text: 'Text', View: 'View' }, '@/components/KandroMark': { KandroMark: 'KandroMark' }, '@/constants/theme': { typeScale: {} }, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({ replace: path => navigated.push(path) }) }, '@/components/ui': { Screen: 'Screen', PrimaryButton: 'Button' }, '@/context/AccessContext': { useAccess: () => access }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }) }, '@/i18n/LanguageProvider': { useLanguage: () => ({ t: { access: { identityTitle: 'Access', preparing: 'Preparing', verify: 'Retry', identityContinue: 'Check', identitySkip: 'Skip', settingUp: 'Setting up' }, common: { moment: 'Busy' } } }) } };
  const compiled = ts.transpileModule(read('src/app/access-setup.tsx'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', compiled)(name => { assert.ok(name in mocks, name); return mocks[name]; }, module, module.exports);
  return { enrolled, navigated, effects, render() { cursor = 0; effects.length = 0; return module.exports.default(); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 350)); for (let i = 0; i < 5; i++) await Promise.resolve(); };
const f = fixture(); f.render(); f.effects.forEach(fn => fn()); await flush();
assert.deepEqual(f.enrolled, [true], 'a fresh install enrolls automatically as first use, without a checkbox');
assert.deepEqual(f.navigated, ['/(tabs)/today']);
f.render(); f.effects.forEach(fn => fn()); await flush();
assert.deepEqual(f.enrolled, [true], 'enrollment runs once');
const g = fixture(false); g.render(); g.effects.forEach(fn => fn()); await flush();
assert.deepEqual(g.enrolled, [], 'no enrollment before access is ready');
console.log('PASS open cohort for new adult installs; existing/minor/pro/prior-use exclusions, stable assignment, 50/50 split and automatic single enrollment.');
// ---------------------------------------------------------------------------
// First run (10/2026): value before the offer. plan → consent → first scan
// (or "Später") → soft paywall once → optional reminder → destination.
const compileModule = (path, mocks) => {
  const out = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', out)(name => { assert.ok(name in mocks, `${path}: unmocked ${name}`); return mocks[name]; }, module, module.exports);
  return module.exports;
};
const ticks = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const memory = new Map(); const reminderCalls = [];
const storage = { getItem: async k => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async k => { memory.delete(k); } };
const firstRun = compileModule('src/services/firstRun.ts', { '@react-native-async-storage/async-storage': { __esModule: true, default: storage }, '@/services/reminders': { prepareReminderOnboarding: async () => { reminderCalls.push(['reminder', memory.get('@kandro/first-run:v1') ?? null]); } } });
// Redirect matrix: tabs bounce to the prompt until a meal exists; the scan
// flow, legal pages and settings are never interrupted.
for (const [stage, path, meal, expected] of [
  ['scan', '/today', false, '/first-scan'], ['scan', '/plan', false, '/first-scan'], ['scan', '/today', true, '/paywall'], ['scan', '/plan', true, '/paywall'],
  ['scan', '/scan', false, null], ['scan', '/confirm', true, null], ['scan', '/result', true, null], ['scan', '/analyzing', false, null], ['scan', '/privacy', false, null], ['scan', '/first-scan', false, null], ['scan', '/first-scan', true, '/paywall'],
  ['paywall', '/today', false, '/paywall'], ['paywall', '/first-scan', false, '/paywall'], ['paywall', '/paywall', false, null], ['paywall', '/terms', false, null],
  [null, '/today', false, null], [undefined, '/today', true, null],
]) assert.equal(firstRun.firstRunRedirect(stage, path, meal), expected, `${stage} ${path} meal=${meal}`);
assert.equal(firstRun.getFirstRunSnapshot(), undefined, 'unknown until read: the guard waits');
assert.equal(await firstRun.loadFirstRunStage(), null, 'installs from before the flow are never routed by it');
await firstRun.setFirstRunStage('scan'); assert.equal(memory.get('@kandro/first-run:v1'), 'scan', 'survives an app kill');
await firstRun.finishFirstRunOffer();
assert.deepEqual(reminderCalls, [['reminder', 'scan']], 'the reminder question is prepared before the run is cleared');
assert.equal(firstRun.getFirstRunSnapshot(), null); assert.equal(memory.has('@kandro/first-run:v1'), false);

// The real route guard with a tiny hook runtime.
function guardFixture(state) {
  const slots = []; let cursor = 0, effects = []; const redirects = [], remembered = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(value) { const n = cursor++; slots[n] ??= { value }; return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { slots[n] = { deps }; effects.push(fn); } },
  };
  const jsx = (type, props) => ({ type, props });
  const Guard = compileModule('src/components/AppRouteGuard.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/constants/theme': { typeScale: {} }, 'react-native': { StyleSheet: { create: a => a }, Text: 'Text', View: 'View' },
    'expo-apple-authentication': { isAvailableAsync: async () => false },
    'expo-router': { usePathname: () => state.path, useSegments: () => [state.path.slice(1)], useRouter: () => ({ replace: to => redirects.push(to) }) },
    '@/components/KandroMark': { KandroMark: 'Brand' }, '@/components/ui': { PrimaryButton: 'Primary' }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/context/AccessContext': { useAccess: () => ({ ready: true, canUse: true, enrollmentPending: false, hardWall: false, entryPaywall: state.entryPaywall ?? false }) },
    '@/services/accessPolicy': { firstMealRevealOpen: () => false, rememberAccessDestination: path => remembered.push(path), routeRequiresAccess: path => !['/paywall', '/first-scan', '/reminder-setup', '/privacy'].includes(path) },
    '@/hooks/useReminderOnboarding': { useReminderOnboarding: () => state.reminder ?? false }, '@/hooks/useFirstRun': { useFirstRun: () => state.stage },
    '@/services/firstRun': { firstRunRedirect: firstRun.firstRunRedirect },
    '@/context/AppContext': { useApp: () => ({ appleReauthenticationRequired: false, analysisStatus: 'idle', detectedItems: [], hydrationReady: true, localStorageError: false, mealHistory: state.meals ?? [], profile: { completedAt: '2026-10-09' }, retryAccountRecovery: async () => {}, syncMode: 'cloud', wellnessConsentGranted: true }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: { account: {} } }) }, '@/utils/mealDraftGuard': { requiresMealDraftRedirect: () => false }, '@/utils/ingredientCorrection': { canSaveMealDraft: () => true },
    '@/services/accountLinking': { appleCredential: async () => null, isAppleCancel: () => false },
  }).AppRouteGuard;
  const render = () => { cursor = 0; const tree = Guard({ children: 'APP' }); const queue = effects; effects = []; queue.forEach(fn => fn()); return tree; };
  return { render, redirects, remembered };
}
{
  const g = guardFixture({ path: '/today', stage: 'scan' }); assert.notEqual(g.render(), 'APP'); assert.deepEqual(g.redirects, ['/first-scan'], 'after consent Today hands over to the first scan');
  const scan = guardFixture({ path: '/scan', stage: 'scan', entryPaywall: true }); assert.equal(scan.render(), 'APP'); assert.deepEqual(scan.redirects, [], 'no entry paywall in front of the first scan');
  const meal = guardFixture({ path: '/plan', stage: 'scan', meals: [{ id: 'm1' }] }); meal.render();
  assert.deepEqual(meal.redirects, ['/paywall'], 'the offer follows the first saved meal'); assert.deepEqual(meal.remembered, ['/plan'], 'and returns to the chosen tab');
  const waiting = guardFixture({ path: '/today', stage: undefined, entryPaywall: true }); assert.notEqual(waiting.render(), 'APP'); assert.deepEqual(waiting.redirects, [], 'an unread stage waits instead of guessing');
  const old = guardFixture({ path: '/today', stage: null, entryPaywall: true }); old.render(); assert.deepEqual(old.redirects, ['/paywall'], 'earlier installs keep their entry paywall');
  const reminder = guardFixture({ path: '/plan', stage: null, reminder: true }); reminder.render();
  assert.deepEqual(reminder.redirects, ['/reminder-setup']); assert.deepEqual(reminder.remembered, ['/plan'], 'the reminder question returns to the destination');
  const done = guardFixture({ path: '/today', stage: null }); assert.equal(done.render(), 'APP');
}
// First-scan prompt: three ways in, an honest allowance line, "Später".
{
  const routes = [], stages = []; let stage = 'scan'; const jsx = (type, props) => ({ type, props });
  const dict = { onboarding: { firstScan: new Proxy({}, { get: (_, key) => key.startsWith('allowance') && key !== 'allowanceUsed' ? (...args) => `${key}:${args.join('/')}` : key }) } };
  const Screen = compileModule('src/app/first-scan.tsx', {
    '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' }, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({ replace: to => routes.push(to) }) }, react: { useRef: v => ({ current: v }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', StyleSheet: { create: a => a }, Text: 'Text', View: 'View' }, '@/components/KandroMark': { KandroMark: 'Mark' }, '@/components/ui': { Screen: 'Screen' },
    '@/constants/product': { FREE_SCAN_ALLOWANCE: 3 }, '@/constants/theme': { radii: {}, typeScale: { micro: 12, caption: 13, compact: 15, body: 17, heading: 22, title: 32, display: 56 } }, '@/context/AppContext': { useApp: () => ({ freeScansLeft: 3 }) },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) }, '@/hooks/useFirstRun': { useFirstRun: () => stage },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: dict }) }, '@/services/firstRun': { setFirstRunStage: async next => { stages.push(next); } }, '@/services/haptics': { selectionHaptic() {} },
    // Legacy install (no hard wall); the hard-wall variant is covered by validate-hard-paywall.mjs.
    '@/hooks/useHardWall': { useFreeScanAllowance: () => ({ hardWall: false, allowance: 3 }) }, '@/services/hardWall': { markHardWallUsed: async () => { stages.push('used'); } },
  }).default;
  const all = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
  const tree = Screen(); const buttons = all(tree).filter(n => n.type === 'Pressable');
  assert.deepEqual(buttons.slice(0, 3).map(b => b.props.accessibilityLabel), ['photo', 'speak', 'type']);
  assert.ok(all(tree).some(n => n.type === 'Text' && n.props.children === 'allowanceFirst:3'), 'the first scan honestly counts as analysis 1 of 3');
  buttons[0].props.onPress(); assert.deepEqual(routes.at(-1), { pathname: '/(tabs)/scan', params: { mode: 'photo' } });
  buttons.at(-1).props.onPress(); await ticks(); assert.deepEqual(stages, ['used', 'paywall'], '"Später" ends the free scope before the offer'); assert.equal(routes.at(-1), '/paywall', '"Später" goes on to the offer');
  stage = null; assert.equal(Screen().type, 'Redirect', 'outside the first run the prompt is not reachable');
}
// Onboarding starts the run; the paywall ends it once viewed.
assert.match(read('src/app/onboarding.tsx'), /if \(firstRun\) await setFirstRunStage\('scan'\);[\s\S]*router\.replace\(editing \? '\/\(tabs\)\/profile' : '\/\(tabs\)\/today'\)/);
assert.match(read('src/app/paywall.tsx'), /if \(firstRunStage === 'scan' \|\| firstRunStage === 'paywall'\) void finishFirstRunOffer\(\);/);
assert.doesNotMatch(read('src/app/reminder-setup.tsx'), /tour: '1'/, 'no separate tour after the first run (it stays reachable under "Du")');
console.log('PASS first run: scan before offer, entry paywall deferred, soft paywall once, reminder last, progress persisted.');

