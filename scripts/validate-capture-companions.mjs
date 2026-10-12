import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
function compile(path, deps = {}, source = null) {
  const module = { exports: {} };
  const code = ts.transpileModule(source ?? fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, `Unmocked dependency ${name}`); return deps[name]; }, module, module.exports);
  return module.exports;
}
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const memory = new Map();
let blockRead = null, failPermission = false, failSet = false;
const storage = { getItem: async key => { if (blockRead) await blockRead; return memory.get(key) ?? null; }, setItem: async (key, value) => { if (failSet) throw Error('disk'); memory.set(key, value); }, removeItem: async key => { memory.delete(key); }, multiRemove: async keys => { keys.forEach(key => memory.delete(key)); } };
const ios = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
let permission = 0, requests = 0, answer = 2;
const scheduled = new Map(), dismissed = [], events = [];
const notifications = { IosAuthorizationStatus: ios, SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' }, setNotificationHandler() {}, getPermissionsAsync: async () => { if (failPermission) throw Error('unavailable'); return { ios: { status: permission }, granted: permission === 2, canAskAgain: permission === 0 }; }, requestPermissionsAsync: async () => { requests++; permission = answer; return notifications.getPermissionsAsync(); }, cancelScheduledNotificationAsync: async id => { scheduled.delete(id); events.push('cancel:' + id); }, dismissNotificationAsync: async id => dismissed.push(id), scheduleNotificationAsync: async record => { scheduled.set(record.identifier, record); events.push('schedule:' + record.identifier); return record.identifier; } };
let language = 'de';
const copy = { de: { notificationTitle: 'Ein Moment für dich', notificationBody: 'Ein kurzer Moment für dein Ernährungstagebuch.' }, en: { notificationTitle: 'A moment for you', notificationBody: 'A quick moment for your food journal.' } };
const reminderDeps = { '@react-native-async-storage/async-storage': storage, 'expo-notifications': notifications, 'react-native': { Platform: { OS: 'ios' } }, '@/i18n/active': { getDictionary: () => ({ captureExtras: copy[language] }) } };
const reminders = compile('src/services/reminders.ts', reminderDeps);
const daily = { enabled: true, hour: 19, minute: 15, mode: 'daily' };
await test('new reminder waits for explicit action, schedules exactly one generic daily notification', async () => {
  await reminders.syncEveningReminder(); assert.equal(requests, 0); assert.equal(scheduled.size, 0);
  assert.equal((await reminders.updateReminder(daily)).enabled, true); assert.equal(requests, 1); assert.equal(scheduled.size, 1);
  const row = [...scheduled.values()][0]; assert.deepEqual(row.trigger, { type: 'daily', hour: 19, minute: 15 }); assert.deepEqual(row.content.data, { route: '/capture', mode: 'search' }); assert.equal(row.content.body, copy.de.notificationBody); assert.equal(row.content.badge, undefined);
});
await test('remount, language/time change replace deterministic IDs; off also dismisses own delivered items', async () => {
  await reminders.syncEveningReminder(); language = 'en'; await reminders.syncEveningReminder(); await reminders.updateReminder({ ...daily, hour: 7 }); assert.equal(scheduled.size, 1); assert.equal([...scheduled.values()][0].content.body, copy.en.notificationBody); assert.equal(requests, 1);
  failPermission = true; await reminders.updateReminder({ ...daily, enabled: false }); failPermission = false;
  assert.equal(scheduled.size, 0); assert.ok(dismissed.includes('kandro-meal-reminder')); assert.equal((await reminders.getReminderSettings()).enabled, false);
});
await test('denied never re-prompts; quiet is permitted; technical error does not masquerade as refusal', async () => {
  permission = 0; answer = 1; await reminders.updateReminder(daily); const previous = requests; await reminders.updateReminder(daily); assert.equal(requests, previous); assert.equal(scheduled.size, 0);
  assert.equal(JSON.parse(memory.get('@kandro/reminder-decision:v1')).permission, 'denied');
  permission = 3; assert.equal((await reminders.updateReminder(daily)).permission, 'quiet'); assert.equal(scheduled.size, 1);
  failPermission = true; assert.equal((await reminders.updateReminder(daily)).permission, 'error'); assert.equal(JSON.parse(memory.get('@kandro/reminder-decision:v1')).permission, 'error'); failPermission = false; assert.equal((await reminders.getReminderSettings()).enabled, true);
  permission = 1; await reminders.syncEveningReminder(); assert.equal(scheduled.size, 0); assert.equal((await reminders.getReminderSettings()).enabled, true);
});
await test('B pauses reminders without erasing choice; allowed access schedules once, without another OS prompt', async () => {
  permission = 2; await reminders.updateReminder(daily); const before = requests;
  reminders.setReminderAccessAllowed(false); await reminders.syncEveningReminder();
  assert.equal(scheduled.size, 0); assert.equal((await reminders.getReminderSettings()).enabled, true);
  await reminders.updateReminder({...daily,hour:18}); assert.equal(scheduled.size,0);
  reminders.setReminderAccessAllowed(true); await reminders.syncEveningReminder();
  assert.equal(scheduled.size,1); assert.equal([...scheduled.values()][0].trigger.hour,18); assert.equal(requests,before);
});
await test('legacy two reminders preserved, no third added; account clear wins against an in-flight read', async () => {
  memory.delete('@kandro/reminders:v2'); memory.set('@kandro/evening-reminder:v1', 'true'); permission = 2;
  await reminders.syncEveningReminder(); assert.equal(scheduled.size, 2); assert.ok(!scheduled.has('kandro-meal-reminder'));
  let release; blockRead = new Promise(resolve => { release = resolve; }); const pending = reminders.syncEveningReminder(); await Promise.resolve(); const clear = reminders.clearRemindersForAccountSwitch(); release(); blockRead = null; await Promise.all([pending, clear]);
  assert.equal(scheduled.size, 0); assert.equal((await reminders.getReminderSettings()).enabled, false);
});
await test('onboarding marker is explicit and skip persists; invalid time never schedules', async () => {
  assert.equal(await reminders.isReminderOnboardingPending(), false); await reminders.prepareReminderOnboarding(); assert.equal(await reminders.isReminderOnboardingPending(), true); await reminders.finishReminderOnboarding(); assert.equal(JSON.parse(memory.get('@kandro/reminder-decision:v1')).onboarding, 'skipped'); assert.equal(await reminders.isReminderOnboardingPending(), false);
  for (const time of [[24, 0], [12, 60], [12.5, 0], [-1, 0]]) await assert.rejects(reminders.updateReminder({ ...daily, hour: time[0], minute: time[1] })); assert.equal(scheduled.size, 0);
});
const policy = compile('src/services/reviewPolicy.ts');
await test('reminder completion updates screen and root guard together before storage/navigation, for enable and skip', async () => {
 for (const choice of ['enabled','skipped']) {
  await reminders.prepareReminderOnboarding();
  const screen=[],guard=[];
  const unsubScreen=reminders.subscribeReminderOnboarding(()=>screen.push(reminders.getReminderOnboardingSnapshot()));
  const unsubGuard=reminders.subscribeReminderOnboarding(()=>guard.push(reminders.getReminderOnboardingSnapshot()));
  let release; blockRead=new Promise(resolve=>{release=resolve;});
  const finish=reminders.finishReminderOnboarding(choice);
  assert.deepEqual(screen,[false]);assert.deepEqual(guard,[false]);
  assert.equal(await reminders.isReminderOnboardingPending(),false);
  release();blockRead=null;await finish;
  assert.equal(memory.get('@kandro/reminder-onboarding:v1'),undefined);
  assert.equal(JSON.parse(memory.get('@kandro/reminder-decision:v1')).onboarding,choice);
  unsubScreen();unsubGuard();await reminders.prepareReminderOnboarding();assert.deepEqual(screen,[false]);
  await reminders.finishReminderOnboarding();
 }
});
await test('late persisted pending read cannot reopen a completed reminder screen; next launch stays completed', async () => {
 let release;
 const delayedStorage={...storage,getItem:async key=>key==='@kandro/reminder-onboarding:v1'?new Promise(resolve=>{release=()=>resolve('true');}):storage.getItem(key)};
 const fresh=compile('src/services/reminders.ts',{...reminderDeps,'@react-native-async-storage/async-storage':delayedStorage});
 const pending=fresh.isReminderOnboardingPending();
 await fresh.finishReminderOnboarding('enabled');release();assert.equal(await pending,false);assert.equal(fresh.getReminderOnboardingSnapshot(),false);
 const restarted=compile('src/services/reminders.ts',reminderDeps);assert.equal(await restarted.isReminderOnboardingPending(),false);
});
await test('optional reminder read failure does not strand the app at an empty navigation gate', async () => {
 const fresh=compile('src/services/reminders.ts',{...reminderDeps,'@react-native-async-storage/async-storage':{...storage,getItem:async()=>{throw Error('disk');}}});
 assert.equal(await fresh.isReminderOnboardingPending(),false);assert.equal(fresh.getReminderOnboardingSnapshot(),false);
});
const DAY = 86400000, start = Date.UTC(2026, 0, 1);
await test('review thresholds: five unique real creations, three local days, full 72 hours', () => {
  let usage = null;
  for (let n = 0; n < 5; n++) usage = policy.recordReviewUsage(usage, 'meal' + n, `2026-01-0${1 + n % 3}`, start + n * 1000);
  assert.equal(policy.recordReviewUsage(usage, 'meal0', '2026-01-04', start + 4 * DAY), usage);
  assert.equal(policy.reviewEligible(usage, [], '1', start + 3 * DAY - 1), false); assert.equal(policy.reviewEligible(usage, [], '1', start + 3 * DAY), true);
  assert.equal(policy.reviewEligible({ ...usage, ids: usage.ids.slice(0, 4) }, [], '1', start + 4 * DAY), false); assert.equal(policy.reviewEligible({ ...usage, days: usage.days.slice(0, 2) }, [], '1', start + 4 * DAY), false);
});
await test('review version, 120-day and rolling 365-day limits stay independent', () => {
  const usage = { firstAt: start, ids: ['1', '2', '3', '4', '5'], days: ['a', 'b', 'c'] }; const now = start + 500 * DAY;
  assert.equal(policy.reviewEligible(usage, [{ version: '2', at: start }], '2', now), false);
  assert.equal(policy.reviewEligible(usage, [{ version: '1', at: now - 120 * DAY + 1 }], '2', now), false);
  assert.equal(policy.reviewEligible(usage, [{ version: '1', at: now - 120 * DAY }], '2', now), true);
  assert.equal(policy.reviewEligible(usage, [121, 242, 364].map((days, n) => ({ version: String(n), at: now - days * DAY })), '4', now), false);
});
let localGeneration = 0, held = false, available = true, calls = 0, version = '1.0.2', quiet = true;
const reviewDeps = { '@react-native-async-storage/async-storage': storage, 'expo-store-review': { isAvailableAsync: async () => available, requestReview: async () => { calls++; } }, 'expo-application': { get nativeApplicationVersion() { return version; } }, 'react-native': { Platform: { OS: 'ios' } }, '@/services/localRepository': { getLocalDataGeneration: () => localGeneration }, '@/utils/date': { localDateKey: date => date.toISOString().slice(0, 10) }, '@/services/presentation': { presentationIsIdle: () => !held, holdPresentation: () => { held = true; return () => { held = false; }; } }, '@/services/reviewPolicy': policy };
let review = compile('src/services/reviewRequest.ts', reviewDeps);
await test('actual review service ignores demos and stale identity, preserves a later quiet opportunity', async () => {
  await review.recordSuccessfulMeal('demo', 'demo', 0, start); assert.ok(!memory.has(policy.REVIEW_USAGE_KEY));
  await review.recordSuccessfulMeal('old', 'search', -1, start); assert.ok(!memory.has(policy.REVIEW_USAGE_KEY));
  for (let n = 0; n < 5; n++) await review.recordSuccessfulMeal('real' + n, 'search', 0, start + (n % 3) * DAY);
  await review.recordSuccessfulMeal('real0', 'search', 0, start + 4 * DAY); assert.equal(JSON.parse(memory.get(policy.REVIEW_USAGE_KEY)).ids.length, 5);
  held = true; await review.requestReviewAfterReturn(() => quiet); held = false; quiet = false; await review.requestReviewAfterReturn(() => quiet); quiet = true; available = false; await review.requestReviewAfterReturn(() => quiet); available = true; assert.equal(calls, 0);
  await Promise.all([review.requestReviewAfterReturn(() => quiet), review.requestReviewAfterReturn(() => quiet)]); assert.equal(calls, 1); assert.equal(held, false); assert.equal(JSON.parse(memory.get(policy.REVIEW_ATTEMPTS_KEY)).length, 1);
});
await test('review restart and account clear retain device attempt limits without importing historical meals', async () => {
  review = compile('src/services/reviewRequest.ts', reviewDeps); await review.requestReviewAfterReturn(() => true); assert.equal(calls, 1);
  await review.recordSuccessfulMeal('another', 'search', 0); await review.requestReviewAfterReturn(() => true); assert.equal(calls, 1);
  version = '1.0.3'; await review.requestReviewAfterReturn(() => true); assert.equal(calls, 1);
  await review.clearReviewUsage(); assert.ok(!memory.has(policy.REVIEW_USAGE_KEY)); assert.equal(JSON.parse(memory.get(policy.REVIEW_ATTEMPTS_KEY)).length, 1);
});
let nativeGeneration = randomUUID(), lastSnapshot = null, writes = 0;
const bridge = { invalidate: () => { lastSnapshot = null; nativeGeneration = randomUUID(); return nativeGeneration; }, writeSnapshot: (json, epoch) => { assert.equal(epoch, nativeGeneration); lastSnapshot = JSON.parse(json); writes++; return true; } };
const widget = compile('src/services/widgetSnapshot.ts', { '@react-native-async-storage/async-storage': storage, 'expo': { requireOptionalNativeModule: () => bridge }, '@/services/localRepository': { getLocalDataGeneration: () => localGeneration }, '@/utils/date': { localDateKey: () => '2026-10-02' } });
const input = { consumed: { calories: 522.4, protein: 30, carbs: 45, fat: 20 }, targets: { calories: 2100, protein: 110 }, day: '2026-10-02', language: 'de' };
await test('widget defaults to actions; explicit sharing writes only minimal app-derived totals', async () => {
  await widget.publishWidgetSnapshot(input, 0); assert.equal(lastSnapshot.privacy, 'actions'); assert.equal(lastSnapshot.calories, undefined);
  await widget.setWidgetSharing(true); await widget.publishWidgetSnapshot(input, 0); assert.equal(lastSnapshot.calories, 522.4); assert.equal(lastSnapshot.targetProtein, 110);
  assert.deepEqual(Object.keys(lastSnapshot).sort(), ['schema', 'generation', 'day', 'updatedAt', 'timezoneOffset', 'language', 'privacy', 'calories', 'protein', 'targetCalories', 'targetProtein'].sort());
  const before = writes; await widget.publishWidgetSnapshot({ ...input, day: '2026-10-01' }, 0); await widget.publishWidgetSnapshot(input, -1); assert.equal(writes, before);
});
await test('widget privacy invalidation is synchronous and late account writes cannot restore old values', async () => {
  const clear = widget.clearWidgetSharing(); assert.equal(lastSnapshot, null); localGeneration++; await clear;
  await widget.publishWidgetSnapshot(input, 0); assert.equal(lastSnapshot, null);
  await widget.publishWidgetSnapshot(input, localGeneration); assert.equal(lastSnapshot.privacy, 'actions');
  failSet = true; await assert.rejects(widget.setWidgetSharing(true)); failSet = false; assert.equal(await widget.getWidgetSharing(), false); assert.equal(lastSnapshot, null);
});
await test('queued widget opt-in cannot outlive a concurrent account/privacy clear', async () => {
  const enable = widget.setWidgetSharing(true); const clear = widget.clearWidgetSharing(); await Promise.all([enable, clear]);
  assert.equal(await widget.getWidgetSharing(), false); assert.equal(memory.get('@kandro/widget-totals:v1'), undefined);
  await widget.publishWidgetSnapshot(input, localGeneration); assert.equal(lastSnapshot.privacy, 'actions');
});
const intents = compile('src/services/captureIntents.ts');
await test('capture allowlist rejects injection/foreign routes; all four modes and duplicate links preserve intent', () => {
  for (const mode of ['photo', 'barcode', 'description', 'search']) assert.equal(intents.parseCaptureURL('kandro://capture?mode=' + mode), mode);
  for (const path of ['https://capture?mode=photo', 'kandro://capture?mode=paywall', 'kandro://capture?mode=photo&mode=search', 'kandro://capture?mode=photo&save=true', 'kandro://evil@capture?mode=photo', 'kandro://capture/evil?mode=photo', 'kandro://capture?mode=photo#save']) assert.equal(intents.parseCaptureURL(path), null, path);
  intents.receiveCaptureLink('kandro://capture?mode=barcode', 10000); const first = intents.pendingCaptureIntent(); intents.receiveCaptureLink('kandro://capture?mode=barcode', 10100); assert.deepEqual(intents.pendingCaptureIntent(), first);
  intents.setScanInputDraft('description'); assert.equal(intents.getScanInputDraft(), 'description'); intents.clearCaptureIntent(); assert.equal(intents.getScanInputDraft(), 'description');
});
await test('actual input registry preserves chosen food and raw portion across route remounts, and rejects late privacy writes', () => {
  const revision = intents.getScanInputRevision();
  const value = { mode: 'search', description: '', searchQuery: 'egg', barcodeEntry: '', pendingFood: { id: 'bls-E111132', name: 'Chicken egg boiled', defaultGrams: 100 }, portion: { amount: '100.5', unitIndex: -1 } };
  intents.saveScanInputState(value, revision);
  intents.clearCaptureIntent();
  assert.equal(intents.getScanInputDraft(), 'search');
  assert.deepEqual(intents.getScanInputState(), value);
  intents.invalidateScanInputState();
  intents.saveScanInputState(value, revision);
  assert.equal(intents.getScanInputState(), null);
  intents.saveScanInputState({ ...value, mode: 'description', description: '100,5 g oats', pendingFood: null, portion: null }, intents.getScanInputRevision());
  assert.equal(intents.getScanInputState().description, '100,5 g oats');
  intents.setScanInputDraft(null); assert.equal(intents.getScanInputState(), null);
});
await test('notification routing accepts only own known reminder IDs/default taps and fixed navigation payloads', () => {
  const response = { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { date: 123, request: { identifier: 'kandro-meal-reminder', content: { data: { route: '/capture', mode: 'search' } } } } };
  assert.deepEqual(intents.reminderIntent(response), { key: 'kandro-meal-reminder:123', mode: 'search' });
  const changed = structuredClone(response); changed.notification.request.content.data.route = '/paywall'; assert.equal(intents.reminderIntent(changed), null); changed.notification.request.identifier = 'someone-else'; assert.equal(intents.reminderIntent(changed), null);
  // Personalised meal reminders (and their later-day occurrences) lead to Plan; nothing else may.
  const plan = structuredClone(response); plan.notification.request.identifier = 'kandro-reminder-lunch-3'; plan.notification.request.content.data = { route: '/plan' };
  assert.deepEqual(intents.reminderIntent(plan), { key: 'kandro-reminder-lunch-3:123', plan: true });
  plan.notification.request.identifier = 'kandro-meal-reminder'; assert.equal(intents.reminderIntent(plan), null);
  plan.notification.request.identifier = 'kandro-reminder-lunch-7'; assert.equal(intents.reminderIntent(plan), null);
  const reengage = structuredClone(response); reengage.notification.request.identifier = 'kandro-reengage'; reengage.notification.request.content.data = { route: '/capture', mode: 'photo' };
  assert.deepEqual(intents.reminderIntent(reengage), { key: 'kandro-reengage:123', mode: 'photo' });
});
// Exercise the actual mounted screen, including state/effect ordering and focus
// transitions. Native views/navigation are boundaries; this is not an OS tap test.
function scanScreenHarness() {
  const registry = compile('src/services/captureIntents.ts');
  const slots = [], effects = [], privacy = new Set(), navigation = [];
  let cursor = 0, dirty = true, tree, focused = true, mode = 'description', serial = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    // Memo is recomputed each render in this harness; values here are pure.
    useMemo(fn) { return fn(); },
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => {
        const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(value) { const i = cursor++; return (slots[i] ??= { current: value }); },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i]; slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const app = {
    descriptionInput: '', scanMode: 'demo', isCurrentScanLogged: false,
    scannedMeal: { id: 'initial' }, freeScansLeft: 3, hasEverLoggedScan: false,
    startDescriptionScan(value) {
      this.descriptionInput = value; this.scanMode = 'description'; this.isCurrentScanLogged = false;
      this.scannedMeal = { id: 'scan-' + ++serial }; dirty = true;
    },
    resetScan() {
      this.descriptionInput = ''; this.scanMode = 'demo'; this.isCurrentScanLogged = false;
      this.scannedMeal = { id: 'reset-' + ++serial }; dirty = true;
    },
  };
  app.startDescriptionScan = app.startDescriptionScan.bind(app); app.resetScan = app.resetScan.bind(app);
  const colors = new Proxy({}, { get: () => '#fff' });
  const copy = new Proxy({}, { get: (_, key) => key === 'allowanceLeft' ? () => '' : String(key) });
  const jsx = (type, props) => ({ type, props });
  const rn = Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Modal','Pressable','ScrollView','Text','TextInput','View'].map(key => [key, key]));
  const screen = compile('src/app/(tabs)/scan.tsx', {
    '@/services/captureIntents': registry,
    '@/hooks/useHardWall': { useFreeScanAllowance: () => ({ hardWall: false, allowance: 3 }) },
    '@/services/localRepository': { subscribePrivateDataInvalidation: fn => { privacy.add(fn); return () => privacy.delete(fn); } },
    '@/components/CaptureSearchHelp': { CaptureSearchHelp: 'CaptureSearchHelp' },
    '@/components/ManualFoodForm': { ManualFoodForm: 'ManualFoodForm' },
    '@/services/foodSuggest': { foodUsage: () => new Map(), mergeSuggestions: (a, b) => [...a, ...b], recentFoods: () => [], frequentFoods: () => [], suggestFoods: () => [], foodSourceBadge: () => 'bls' },
    '@/services/customFoods': { customFoodResult: x => x, deleteCustomFood: async () => {}, isCustomFoodResult: () => false, matchCustomFoods: () => [] },
    '@/hooks/useCustomFoods': { useCustomFoods: () => [] },
    '@/components/QuickAddForm': { QuickAddForm: 'QuickAddForm', isQuickAddResult: () => false },
    '@/services/localDescription': { parseLocalDescription: () => null },
    '@/services/telemetry': { trackEvent() {}, durationBucket: () => 'fast' },
    '@/context/ThemeContext': { useTheme: () => ({ colors }), useThemedStyles: fn => fn(colors) },
    '@/constants/theme': { radii: { pill: 22 }, typeScale: { micro: 12, caption: 13, compact: 15, body: 17, heading: 22, title: 32, display: 56 } },
    '@expo/vector-icons/Ionicons': 'Icon',
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: false, canAskAgain: false }, async () => ({ granted: false })] },
    'expo-router': {
      useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [focused, fn]),
      useLocalSearchParams: () => ({ mode }), usePathname: () => focused ? '/scan' : '/confirm',
      useRouter: () => ({ push: path => navigation.push(path), replace: path => navigation.push(path) }),
    },
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': { ...rn, Animated: { View: 'AnimatedView', Value: class { setValue() {} } }, Platform: { OS: 'ios' }, StyleSheet: { create: x => x },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, Alert: { alert() {} }, Linking: { openSettings() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/constants/product': { FREE_SCAN_ALLOWANCE: 3 }, '@/components/ui': { PrimaryButton: 'PrimaryButton' },
    '@/components/PortionSheet': { PortionSheet: 'PortionSheet' }, '@/context/AppContext': { useApp: () => app },
    '@/components/VoiceInputButton': { VoiceInputButton: 'VoiceInputButton' }, '@/hooks/useKeyboardInset': { useKeyboardInset: () => 0 },
    'expo-image-manipulator': { manipulateAsync: async uri => ({ uri }), SaveFormat: { JPEG: 'jpeg' } }, '@/utils/cameraCrop': { frameToPhotoCrop: () => null },
    '@/services/mealAnalysis': { MealAnalysisError: class extends Error {}, searchFoods: async () => [], deleteTemporaryPhoto() {} },
    '@/context/SubscriptionContext': { useSubscription: () => ({ status: 'active' }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ locale: 'en-GB', t: { scan: copy, common: copy, errors: copy } }) },
    '@/services/haptics': { primaryHaptic() {}, successHaptic() {} },
    '@/utils/format': { formatNumber: String, formatDayLabel: String, mealTypeLabel: String }, '@/hooks/useReducedMotion': { useReducedMotion: () => true },
    '@/utils/mealDay': { mealTypeForTime: () => 'Lunch' }, '@/utils/date': { localDateKey: () => '2026-10-09' },
  }, process.env.SCAN_SCREEN_SOURCE ? fs.readFileSync(process.env.SCAN_SCREEN_SOURCE, 'utf8') : null).default;
  function render() {
    dirty = true;
    for (let n = 0; dirty; n++) {
      assert.ok(n < 20, 'Screen render did not settle'); dirty = false; cursor = 0; tree = screen();
      while (effects.length) effects.shift()();
    }
    return tree;
  }
  function nodes(value = tree, out = []) {
    if (Array.isArray(value)) value.forEach(x => nodes(x, out));
    else if (value && typeof value === 'object') { out.push(value); nodes(value.props?.children ?? null, out); }
    return out;
  }
  function text(value) {
    if (Array.isArray(value)) return value.map(text).join('');
    return value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' ? value : '';
  }
  const description = () => nodes().find(x => x.type === 'TextInput' && x.props.multiline);
  const press = label => { const button = nodes().find(x => x.type === 'Pressable' && (x.props.accessibilityLabel === label || text(x) === label)); assert.ok(button, label); button.props.onPress(); render(); };
  render();
  return {
    app, registry, navigation, render, press,
    value: () => description().props.value,
    type: value => { description().props.onChangeText(value); render(); },
    focus: (value, requested = mode) => { focused = value; mode = requested; render(); },
    dismiss: () => { nodes().find(x => x.type === 'Modal' && nodes(x).some(n => n.type === 'TextInput' && n.props.multiline)).props.onDismiss(); render(); },
    invalidate: async () => { registry.invalidateScanInputState(); await Promise.all([...privacy].map(fn => fn())); render(); },
  };
}
await test('mounted description screen restores DE/EN input after confirmation/error and keeps revised input on repeated return', () => {
  for (const input of ['10 g Olivenöl', '2 eggs and 1 litre of milk']) {
    const h = scanScreenHarness(); h.type(input); h.press('describeSubmit');
    assert.equal(h.app.descriptionInput, input); assert.equal(h.registry.getScanInputState(), null);
    h.dismiss(); assert.deepEqual(h.navigation, ['/analyzing']);
    h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), input, 'Confirmation/error return must retain submitted input');
    h.type(input + ' and 100 g rice'); h.focus(false); h.focus(true, 'description');
    assert.equal(h.value(), input + ' and 100 g rice', 'Unsaved edit must win over last submitted text');
    h.press('describeSubmit'); h.dismiss(); h.focus(false); h.focus(true, 'description');
    assert.equal(h.value(), input + ' and 100 g rice'); assert.equal(h.navigation.length, 2);
  }
});
await test('mounted description draft clears on new scan, completed save and explicit close', () => {
  const h = scanScreenHarness();
  h.type('10 g olive oil'); h.press('describeSubmit'); h.dismiss(); h.focus(false); h.focus(true, 'description');
  h.type('edited old meal'); h.focus(false); h.app.resetScan(); h.render(); h.focus(true, 'description');
  assert.equal(h.value(), ''); assert.equal(h.registry.getScanInputState(), null);
  h.type('100 g rice'); h.press('describeSubmit'); h.dismiss(); h.focus(false);
  h.app.isCurrentScanLogged = true; h.render(); h.focus(true, 'description'); assert.equal(h.value(), '');
  h.type('a new unsaved description'); h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), 'a new unsaved description');
  h.press('close'); h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), ''); assert.equal(h.registry.getScanInputState(), null);
});
await test('private invalidation clears a mounted input and blocks both stale context recovery and late draft writes', async () => {
  const h = scanScreenHarness(); h.type('100 g private old food'); h.press('describeSubmit'); h.dismiss(); h.focus(false); h.focus(true, 'description');
  const revision = h.registry.getScanInputRevision();
  await h.invalidate(); assert.equal(h.value(), ''); assert.equal(h.registry.getScanInputState(), null);
  h.registry.saveScanInputState({ mode: 'description', description: 'late old food', searchQuery: '', barcodeEntry: '', pendingFood: null, portion: null }, revision);
  h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), '');
  h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), '');
  h.app.resetScan(); h.render(); h.type('new account food');
  assert.equal(h.registry.getScanInputState()?.description, 'new account food');
  h.focus(false); h.focus(true, 'description'); assert.equal(h.value(), 'new account food');
});

// Render the actual reminder setup and preferences against the actual service;
// only React/native presentation and notification APIs are local boundaries.
function reminderPreferencesHarness({ onboarding = true } = {}) {
  const state = [], effects = [], listeners = new Set(), choices = [];
  let cursor = 0, dirty = true, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      state[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [state[i].value, update => {
        const next = typeof update === 'function' ? update(state[i].value) : update;
        if (!Object.is(next, state[i].value)) { state[i].value = next; dirty = true; }
      }];
    },
    useRef(value) { return state[cursor++] ??= { current: value }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(state[i]?.deps, deps)) {
        const previous = state[i]; state[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); state[i].cleanup = fn(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const uiCopy = new Proxy({}, { get: (_, key) => String(key) });
  const Component = compile('src/components/ReminderPreferences.tsx', {
    '@/services/presentation': { usePresentationBlock() {} },
    '@expo/vector-icons/Ionicons': 'Icon',
    '@/constants/theme': { typeScale: {} },
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', Linking: { openSettings: async () => {} }, AppState: { addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } } },
    '@/components/ui': { Card: 'Card', PrimaryButton: 'PrimaryButton' },
    '@/context/ThemeContext': { useTheme: () => ({ colors: new Proxy({}, { get: () => '#fff' }) }) },
    '@/context/AccessContext': { useAccess: () => ({ ready: true, canUse: true }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: { captureExtras: uiCopy, access: uiCopy, common: uiCopy } }) },
    '@/services/haptics': { selectionHaptic() {} },
    '@/services/reminders': reminders,
  }, process.env.REMINDER_PREFERENCES_SOURCE ? fs.readFileSync(process.env.REMINDER_PREFERENCES_SOURCE, 'utf8') : null).ReminderPreferences;
  const Setup = compile('src/app/reminder-setup.tsx', {
    react: { useRef: value => ({ current: value }) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { Redirect: 'Redirect' }, '@/components/ui': { Screen: 'Screen' },
    '@/components/ReminderPreferences': { ReminderPreferences: Component },
    '@/services/reminders': { finishReminderOnboarding: async choice => { choices.push(choice); } },
    '@/hooks/useReminderOnboarding': { useReminderOnboarding: () => true },
    '@/services/accessPolicy': { takeAccessDestination: () => '/today' },
    '@/context/AppContext': { useApp: () => ({ profile: { completedAt: '2026-10-04' }, wellnessConsentGranted: true }) },
  }).default;
  const props = onboarding ? Setup().props.children.props : {};
  function render() {
    dirty = true;
    for (let n = 0; dirty; n++) {
      assert.ok(n < 20, 'Reminder render did not settle'); dirty = false; cursor = 0;
      tree = Component(props); while (effects.length) effects.shift()();
    }
  }
  function nodes(value = tree, result = []) {
    if (Array.isArray(value)) value.forEach(x => nodes(x, result));
    else if (value && typeof value === 'object') { result.push(value); nodes(value.props?.children ?? null, result); }
    return result;
  }
  async function settle() { for (let n = 0; n < 3; n++) { await new Promise(setImmediate); render(); } }
  const checked = () => nodes().filter(x => x.props?.accessibilityRole === 'checkbox' && x.props.accessibilityState.checked).map(x => x.props.accessibilityLabel);
  async function press(label) {
    const button = nodes().find(x => x.props?.label === label || x.props?.accessibilityLabel === label);
    assert.ok(button, label); assert.notEqual(button.props.disabled, true, label + ' must be enabled');
    button.props.onPress(); await settle();
  }
  render();
  return { settle, checked, press, choices, text: () => nodes().filter(x => x.type === 'Text').map(x => x.props.children), foreground: async () => { listeners.forEach(fn => fn('active')); await settle(); }, unmount: () => state.forEach(x => x.cleanup?.()) };
}
// Meal slots are one-off dates for a week; group the occurrence IDs by slot.
const slotIds = () => [...new Set([...scheduled.keys()].map(id => id.replace(/-\d$/, '')))];
async function resetReminderFixture(saved = null) {
  await reminders.clearRemindersForAccountSwitch(); memory.clear(); scheduled.clear();
  permission = 0; requests = 0; answer = 2; language = 'de';
  if (saved) memory.set('@kandro/reminders:v2', JSON.stringify(saved));
}
await test('first reminder setup allows one chosen time and activates exactly one only after explicit consent', async () => {
  await resetReminderFixture(); const h = reminderPreferencesHarness(); await h.settle();
  assert.equal(requests, 0); assert.equal(scheduled.size, 0);
  assert.deepEqual(h.checked(), ['slotDinner, 18:30'], 'An empty account must not preselect two daily reminders');
  assert.ok(h.text().includes('reminderSingleText')); assert.ok(!h.text().includes('reminderText'));
  await h.press('slotLunch, 12:30'); assert.deepEqual(h.checked(), ['slotLunch, 12:30']);
  await h.press('slotLunch: later'); assert.deepEqual(h.checked(), ['slotLunch, 12:45']);
  await h.press('slotDinner, 18:30'); assert.deepEqual(h.checked(), ['slotDinner, 18:30']);
  // First run asks a yes/no question after the offer.
  assert.ok(h.text().includes('reminderAskTitle')); assert.ok(!h.text().includes('reminderTitle'));
  await h.press('slotLunch, 12:45'); await h.press('reminderAskYes');
  assert.equal(requests, 1); assert.deepEqual(slotIds(), ['kandro-reminder-lunch']); assert.equal(scheduled.size, reminders.SLOT_OCCURRENCES);
  const first = scheduled.get('kandro-reminder-lunch').trigger; assert.equal(first.type, 'date'); assert.equal(first.date.getHours(), 12); assert.equal(first.date.getMinutes(), 45);
  assert.ok(first.date.getTime() > Date.now() && first.date.getTime() <= Date.now() + 86_400_000, 'the first occurrence is the next 12:45');
  assert.equal(Object.values((await reminders.getReminderSettings()).slots).filter(x => x.enabled).length, 1);
  assert.deepEqual(h.choices, ['enabled']); h.unmount();
});
await test('first setup skip, denial, foreground refresh and reopening never silently add a second reminder or OS prompt', async () => {
  await resetReminderFixture(); const skip = reminderPreferencesHarness(); await skip.settle(); await skip.press('reminderAskLater');
  assert.deepEqual(skip.choices, ['skipped']); assert.equal(requests, 0); assert.equal(scheduled.size, 0); skip.unmount();
  const h = reminderPreferencesHarness(); await h.settle(); answer = 1;
  await h.press('reminderAskYes'); assert.equal(requests, 1); assert.equal(scheduled.size, 0); assert.deepEqual(h.choices, []);
  await h.foreground(); await h.press('slotLunch, 12:30'); assert.deepEqual(h.checked(), ['slotLunch, 12:30']);
  await h.press('reminderAskYes'); assert.equal(requests, 1); h.unmount();
  const reopened = reminderPreferencesHarness(); await reopened.settle();
  assert.deepEqual(reopened.checked(), ['slotLunch, 12:30']);
  await reopened.press('slotDinner, 18:30'); assert.deepEqual(reopened.checked(), ['slotDinner, 18:30']);
  await reopened.press('reminderAskYes'); assert.equal(requests, 1); assert.equal(scheduled.size, 0); reopened.unmount();
});
await test('stored multiple preferences and later explicit trial/profile routine retain both chosen daily times', async () => {
  const slots = structuredClone(reminders.DEFAULT_SLOTS); slots.lunch.minute = 45; slots.dinner.hour = 19;
  const saved = { enabled: true, mode: 'meals', hour: 12, minute: 45, slots };
  await resetReminderFixture(saved); permission = 2;
  const existing = reminderPreferencesHarness(); await existing.settle();
  assert.deepEqual(existing.checked(), ['slotLunch, 12:45', 'slotDinner, 19:30']);
  assert.ok(existing.text().includes('reminderText')); assert.ok(!existing.text().includes('reminderSingleText'));
  await existing.press('reminderAskYes'); assert.equal(requests, 0); assert.equal(slotIds().length, 2); assert.equal(scheduled.size, 2 * reminders.SLOT_OCCURRENCES);
  assert.deepEqual(await reminders.getReminderSettings(), saved); existing.unmount();
  await resetReminderFixture(); const later = reminderPreferencesHarness({ onboarding: false }); await later.settle();
  assert.deepEqual(later.checked(), ['slotLunch, 12:30', 'slotDinner, 18:30']);
  assert.ok(later.text().includes('reminderText')); assert.ok(!later.text().includes('reminderSingleText'));
  assert.equal(requests, 0); assert.equal(scheduled.size, 0);
  await later.press('activate'); assert.equal(requests, 1); assert.equal(slotIds().length, 2); assert.equal(scheduled.size, 2 * reminders.SLOT_OCCURRENCES); later.unmount();
});

console.log(JSON.stringify({ passed, scope: 'Actual reminder/review/widget/intent services; mocked native boundaries, no OS-dialog/display/tap claims; zero external HTTP' }));
