// Retention 1.0.6: billing grace period, in-app subscription screen, win-back.
// Actual modules and screens; RevenueCat/StoreKit, storage and navigation are
// deterministic fixtures. No network, purchase or App Store Connect claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

import { activeIosSubscriptionFromV2, validateRevenueCatEvent } from '../supabase/functions/_shared/revenuecat.mjs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function compile(path, mocks = {}) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', js)(id => { assert.ok(id in mocks, `${path}: unmocked ${id}`); return mocks[id]; }, module, module.exports, false);
  return module.exports;
}
const passed = [];
async function check(name, run) { await run(); passed.push(name); }
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const de = compile('src/i18n/de.ts').de;
const en = compile('src/i18n/en.ts', { '@/i18n/de': {} }).en;
const retention = compile('src/services/retention.ts');

// ---------------------------------------------------------------- fixtures
const NOW = Date.parse('2026-10-25T10:00:00Z');
const realNow = Date.now; Date.now = () => NOW;
const entitlement = (overrides = {}) => ({ identifier: 'kandro_pro', isActive: true, willRenew: true, periodType: 'NORMAL', store: 'APP_STORE', productIdentifier: 'kandro_monthly', expirationDate: '2026-11-10T10:00:00Z', latestPurchaseDate: '2026-10-10T10:00:00Z', billingIssueDetectedAt: null, unsubscribeDetectedAt: null, ...overrides });
const customerInfo = ({ active, all } = {}) => ({ entitlements: { active: active ? { kandro_pro: active } : {}, all: all ?? (active ? { kandro_pro: active } : {}) } });
const discount = (overrides = {}) => ({ identifier: 'promo_3m_50', price: 4.99, priceString: '4,99 €', cycles: 3, period: 'P1M', periodUnit: 'MONTH', periodNumberOfUnits: 1, ...overrides });
const product = (yearly, discounts = null) => ({ identifier: yearly ? 'kandro_annual' : 'kandro_monthly', price: yearly ? 59.99 : 9.99, priceString: yearly ? '59,99 €' : '9,99 €', pricePerMonthString: yearly ? '5,00 €' : '9,99 €', currencyCode: 'EUR', introPrice: null, discounts });
const plan = (yearly, discounts) => ({ id: yearly ? 'yearly' : 'monthly', price: yearly ? '59,99 € / Jahr' : '9,99 € / Monat', priceAmount: yearly ? 59.99 : 9.99, monthlyEquivalent: yearly ? 5 : 9.99, detail: '', billing: '', hasFreeTrial: false, trialLabel: null, trialDays: null, package: { identifier: yearly ? '$rc_annual' : '$rc_monthly', product: product(yearly, discounts) } });
const plans = (discounts, { yearly = true, monthly = true } = {}) => ({ yearly: yearly ? plan(true, discounts) : null, monthly: monthly ? plan(false, discounts) : null });

// ---------------------------------------------------------------- 1. grace period
await check('Entitlement in billing grace stays active (SDK and server), and only the banner reads the billing issue', async () => {
  const grace = retention.subscriptionCustomerFrom(customerInfo({ active: entitlement({ billingIssueDetectedAt: '2026-10-24T08:00:00Z', willRenew: true }) }), 'kandro_pro');
  assert.equal(grace.billingIssueDetectedAt, '2026-10-24T08:00:00Z');
  assert.equal(grace.lapsed, false);
  assert.equal(grace.productId, 'kandro_monthly');
  const lapsed = retention.subscriptionCustomerFrom(customerInfo({ all: { kandro_pro: entitlement({ isActive: false }) } }), 'kandro_pro');
  assert.equal(lapsed.lapsed, true); assert.equal(lapsed.billingIssueDetectedAt, null);
  assert.equal(retention.subscriptionCustomerFrom(customerInfo(), 'kandro_pro').lapsed, false, 'never subscribed is not lapsed');
  // Server: RevenueCat keeps gives_access during grace although the paid period has ended.
  const config = { entitlementResourceId: 'entl', iosAppId: 'app', productResourceIds: ['prod_monthly'], nowMs: NOW };
  const sub = overrides => ({ object: 'list', items: [{ environment: 'production', store: 'app_store', product_id: 'prod_monthly', gives_access: true, status: 'in_grace_period', current_period_ends_at: NOW - 86_400_000, ends_at: null, entitlements: { items: [{ id: 'entl', state: 'active' }] }, ...overrides }] });
  const inGrace = activeIosSubscriptionFromV2(sub(), config);
  assert.equal(inGrace.active, true, 'grace period: server access stays active');
  assert.ok(Date.parse(inGrace.expiresAt) > NOW && Date.parse(inGrace.expiresAt) <= NOW + 15 * 60_000, 'grace access is cached only briefly and rechecked');
  assert.equal(activeIosSubscriptionFromV2(sub({ gives_access: false, status: 'in_billing_retry', entitlements: { items: [{ id: 'entl', state: 'inactive' }] } }), config).active, false, 'grace over, still retrying: locked again');
  assert.equal(activeIosSubscriptionFromV2(sub({ gives_access: false, status: 'expired' }), config).active, false, 'EXPIRATION: locked again');
  for (const type of ['BILLING_ISSUE', 'EXPIRATION', 'RENEWAL']) {
    const event = validateRevenueCatEvent({ api_version: '1.0', event: { id: 'evt_' + type, type, app_id: 'app', environment: 'PRODUCTION', event_timestamp_ms: NOW, app_user_id: '3d594650-3436-4b1d-a8f8-1cbf294653ab', entitlement_ids: ['kandro_pro'], store: 'APP_STORE' } }, 'app');
    assert.equal(event.relevant, true, `${type} triggers a server recheck of the entitlement`);
  }
});

await check('Billing banner shows only for confirmed Pro with a billing issue and hides for the rest of the dismissed day', () => {
  const customer = { ...retention.NO_CUSTOMER, productId: 'kandro_monthly', billingIssueDetectedAt: '2026-10-24T08:00:00Z' };
  const show = input => retention.billingIssueBannerVisible({ status: 'active', customer, dismissedDay: null, today: '2026-10-25', ...input });
  assert.equal(show({}), true);
  assert.equal(show({ dismissedDay: '2026-10-25' }), false, 'dismissed today');
  assert.equal(show({ dismissedDay: '2026-10-24' }), true, 'back the next day');
  assert.equal(show({ customer: { ...customer, billingIssueDetectedAt: null } }), false, 'resolved payment: no banner');
  for (const status of ['loading', 'ready', 'pending', 'error', 'unconfigured']) assert.equal(show({ status }), false, status);
  assert.equal(de.retention.bannerText, 'Zahlung hat nicht geklappt – Kandro Pro läuft vorerst weiter. Bitte prüfe deine Zahlungsmethode.');
  assert.equal(de.retention.bannerAction, 'Zahlungsmethode prüfen');
  assert.match(en.retention.bannerText, /keeps running/);
  for (const dict of [de, en]) assert.doesNotMatch(dict.retention.bannerText + dict.retention.bannerAction, /!|sofort|immediately|verlierst|lose|gesperrt|locked/i, 'calm wording, no threat');
});

function hooks() {
  const slots = []; let cursor = 0, effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const n = cursor++; if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) slots[n] = { value: fn(), deps }; return slots[n].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn(); }); } },
  };
  return { react, render(Component, props = {}) { cursor = 0; const tree = Component(props); const queue = effects; effects = []; queue.forEach(fn => fn()); return tree; } };
}
const jsx = (type, props) => ({ type, props });
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const texts = tree => nodes(tree).filter(n => n.type === 'Text').map(n => [n.props.children].flat(Infinity).join(''));
const buttons = tree => nodes(tree).filter(n => n.type === 'Primary');
const rn = { Alert: { alert() {} }, Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: x => x }, Text: 'Text', View: 'View' };
const ui = { Card: 'Card', PrimaryButton: 'Primary', Screen: 'Screen' };
const theme = { radii: {}, typeScale: {} };

await check('Billing banner renders on Today and in Du, opens Apple, and dismissal persists for the day', async () => {
  const storage = new Map(); const opened = [];
  const make = (status, issue) => {
    const h = hooks();
    const Banner = compile('src/components/BillingIssueBanner.tsx', {
      react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': rn,
      '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } } },
      '@expo/vector-icons/Ionicons': 'Icon', '@/components/ui': ui, '@/constants/theme': theme,
      '@/context/SubscriptionContext': { useSubscription: () => ({ status, snapshot: { customer: { ...retention.NO_CUSTOMER, billingIssueDetectedAt: issue } } }) },
      '@/context/ThemeContext': { useTheme: () => ({ colors: {} }) }, '@/hooks/useLocalDay': { useLocalDay: () => '2026-10-25' },
      '@/i18n/LanguageProvider': { useLanguage: () => ({ t: de }) }, '@/services/retention': retention,
      '@/services/subscription': { openSubscriptionManagement: async () => { opened.push('apple'); } },
    }).BillingIssueBanner;
    return { render: () => h.render(Banner) };
  };
  const banner = make('active', '2026-10-24T08:00:00Z');
  assert.equal(banner.render(), null, 'nothing before the dismissal state is read');
  await settle();
  let tree = banner.render();
  assert.ok(texts(tree).includes(de.retention.bannerText));
  const action = buttons(tree).find(b => b.props.label === de.retention.bannerAction);
  action.props.onPress(); await settle(); assert.deepEqual(opened, ['apple']);
  nodes(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === de.retention.bannerDismiss).props.onPress();
  await settle();
  assert.equal(banner.render(), null, 'hidden after dismiss');
  assert.equal(storage.get('@kandro/billing-issue-dismissed:v1'), '2026-10-25');
  const again = make('active', '2026-10-24T08:00:00Z'); again.render(); await settle();
  assert.equal(again.render(), null, 'stays hidden for the rest of the day after a restart');
  const healthy = make('active', null); healthy.render(); await settle(); storage.clear();
  assert.equal(healthy.render(), null, 'no billing issue: no banner');
  assert.match(read('src/app/(tabs)/today.tsx'), /<MealSyncStatus \/>\s*<BillingIssueBanner \/>/);
  assert.match(read('src/app/(tabs)/profile.tsx'), /<BillingIssueBanner \/>/);
});

// ---------------------------------------------------------------- 2. manage screen
await check('Manage model: annual switch only for monthly subscribers, promo only from configured discounts', () => {
  const monthly = { ...retention.NO_CUSTOMER, productId: 'kandro_monthly', willRenew: true };
  const yearly = { ...monthly, productId: 'kandro_annual' };
  const m = retention.manageModel(monthly, plans(null));
  assert.equal(m.planId, 'monthly'); assert.deepEqual(m.annualSwitch, { perMonth: '5,00 €', monthlyPrice: '9,99 €', yearlyPrice: '59,99 €' });
  assert.equal(m.cancelAvailable, true); assert.deepEqual(m.promoDiscounts, []);
  assert.equal(retention.manageModel(yearly, plans(null)).annualSwitch, null, 'already annual');
  assert.equal(retention.manageModel(monthly, plans(null, { yearly: false })).annualSwitch, null, 'no annual package in the store');
  assert.equal(retention.manageModel({ ...monthly, productId: 'other' }, plans(null)).annualSwitch, null, 'unknown product: no guess');
  assert.deepEqual(retention.manageModel(monthly, plans([])).promoDiscounts, []);
  assert.equal(retention.manageModel(monthly, plans([discount()])).promoDiscounts.length, 1);
  assert.equal(retention.manageModel(null, plans(null)).cancelAvailable, true);
  assert.equal(retention.offerTerms(discount(), de), '4,99 € pro Monat für 3 Monate');
  assert.equal(retention.offerTerms(discount({ cycles: 1, periodUnit: 'YEAR', priceString: '29,99 €', price: 29.99 }), de), '1 Jahr für 29,99 €');
  assert.equal(retention.offerTerms(discount({ price: 0, priceString: '0,00 €', cycles: 1, periodNumberOfUnits: 1 }), en), '1 month free');
  assert.equal(retention.offerTerms(discount({ periodUnit: 'FORTNIGHT' }), de), null, 'incomplete store data: no copy');
  assert.equal(retention.offerTerms(discount({ priceString: '' }), de), null);
  assert.equal(retention.offerPercent(discount(), 'monthly', 9.99), 50);
  assert.equal(retention.offerPercent(discount({ periodNumberOfUnits: 3 }), 'monthly', 9.99), null, 'no percentage across different periods');
});

function manageScreen({ status = 'active', customer, snapshotPlans = plans(null), signed = true, mode = 'native-store' } = {}) {
  const h = hooks(); const calls = []; const events = []; const steps = [];
  const subscription = {
    status, busy: false, error: null,
    snapshot: status === 'loading' ? null : { configured: true, mode, plans: snapshotPlans, customer },
    async refresh() { calls.push('refresh'); },
    async purchase(id) { calls.push('purchase:' + id); return 'active'; },
    async purchaseOffer(offer) { calls.push('offer:' + offer.kind + ':' + offer.discount?.identifier); return 'active'; },
  };
  const Screen = compile('src/app/subscription-manage.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': rn,
    '@/components/KandroMark': { KandroMark: 'KandroMark' },
    'expo-router': { useRouter: () => ({ back() {}, canGoBack: () => true, replace() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@expo/vector-icons/Ionicons': 'Icon', '@/components/ui': ui, '@/constants/theme': theme,
    '@/context/SubscriptionContext': { useSubscription: () => subscription },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: de, locale: 'de-DE' }) },
    '@/services/paywallExposure': { markPurchaseStep: (outcome, kind) => steps.push(`${kind}:${outcome}`) },
    '@/services/retention': retention,
    '@/services/subscription': {
      loadPromotionalDiscount: async (_plan, discounts) => { calls.push('sign'); return signed ? discounts[0] : null; },
      openSubscriptionManagement: async () => { calls.push('apple'); },
    },
    '@/services/telemetry': { toBillingMode: x => x, trackEvent: (name, props) => events.push([name, props]) },
    '@/utils/format': { formatDateParts: () => '10. November 2026' },
  }).default;
  return { render: () => h.render(Screen), calls, events, steps };
}
const monthlyCustomer = { ...retention.NO_CUSTOMER, productId: 'kandro_monthly', willRenew: true, expiresAt: '2026-11-10T10:00:00Z', periodType: 'NORMAL' };

await check('Manage screen always shows "Abo kündigen", outside the scroll view, opening Apple immediately', async () => {
  const cases = [
    manageScreen({ customer: monthlyCustomer }),
    manageScreen({ status: 'loading' }),
    manageScreen({ status: 'error', customer: retention.NO_CUSTOMER }),
    manageScreen({ status: 'ready', customer: retention.NO_CUSTOMER }),
    manageScreen({ customer: { ...monthlyCustomer, productId: 'kandro_annual' }, snapshotPlans: plans([discount()]) }),
    manageScreen({ customer: monthlyCustomer, mode: 'test-store' }),
  ];
  for (const screen of cases) {
    screen.render(); await settle(); const tree = screen.render();
    const cancel = buttons(tree).filter(b => b.props.label === de.retention.cancelSubscription);
    assert.equal(cancel.length, 1, 'exactly one cancel button in every state');
    assert.notEqual(cancel[0].props.disabled, true, 'never disabled');
    assert.equal(cancel[0].props.variant, 'secondary', 'same weight as a secondary button');
    const scroll = nodes(tree).find(n => n.type === 'ScrollView');
    assert.ok(!nodes(scroll).includes(cancel[0]), 'fixed footer, not scrolled away');
    cancel[0].props.onPress(); await settle();
    assert.equal(screen.calls.at(-1), 'apple', 'opens Apple subscription management, no extra step');
  }
  const cancelled = manageScreen({ customer: { ...monthlyCustomer, willRenew: false } });
  cancelled.render(); await settle();
  assert.ok(buttons(cancelled.render()).some(b => b.props.label === de.retention.manageAtApple), 'already cancelled: same button, "Bei Apple verwalten"');
  assert.equal(de.retention.cancelSubscription, 'Abo kündigen');
  const trial = manageScreen({ customer: { ...monthlyCustomer, periodType: 'TRIAL' } });
  trial.render(); await settle(); let trialTree = trial.render();
  assert.ok(buttons(trialTree).some(b => b.props.label === de.retention.cancelTrial), 'trial: "Testphase kündigen"');
  assert.ok(texts(trialTree).includes(de.retention.statusTrial), 'trial status badge');
  assert.ok(texts(cancelled.render()).includes(de.retention.statusCancelled), 'cancelled status badge');
  const closeButton = nodes(trialTree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel === de.common.close);
  assert.ok(closeButton && !nodes(nodes(trialTree).find(n => n.type === 'ScrollView')).includes(closeButton), 'an X in the fixed top bar');
  assert.doesNotMatch(read('src/app/subscription-manage.tsx'), /reason/i, 'no reason picker in the way');
  for (const dict of [de, en]) assert.doesNotMatch(Object.values(dict.retention).filter(v => typeof v === 'string').join(' '), /schade|enttäusch|sure\?|really|wirklich|verpasst|miss out|lose/i, 'no guilt wording');
});

await check('Manage screen: annual switch only for monthly; promo hidden without a configured/signable discount', async () => {
  const monthly = manageScreen({ customer: monthlyCustomer });
  monthly.render(); await settle(); let tree = monthly.render();
  assert.ok(texts(tree).includes(de.retention.beforeYouGo));
  assert.ok(texts(tree).includes(de.retention.annualText('5,00 €', '9,99 €')));
  assert.ok(!buttons(tree).some(b => b.props.label === de.retention.promoAction), 'no product.discounts: no promo block');
  assert.ok(!monthly.calls.includes('sign'), 'nothing to sign without a configured discount');
  await buttons(tree).find(b => b.props.label === de.retention.annualAction).props.onPress(); await settle();
  assert.ok(monthly.calls.includes('purchase:yearly'), 'switch = normal purchase of the annual package');
  assert.deepEqual(monthly.steps, ['retention_offer:started', 'retention_offer:active']);
  assert.deepEqual(monthly.events.at(-1), ['subscription offer purchase ended', { billing_mode: 'native-store', offer: 'annual_switch', outcome: 'active' }]);

  const annual = manageScreen({ customer: { ...monthlyCustomer, productId: 'kandro_annual' } });
  annual.render(); await settle(); tree = annual.render();
  assert.ok(!buttons(tree).some(b => b.props.label === de.retention.annualAction), 'annual subscriber: no switch');
  assert.ok(!texts(tree).includes(de.retention.beforeYouGo), 'no options: no "Bevor du gehst"');

  const unsigned = manageScreen({ customer: monthlyCustomer, snapshotPlans: plans([discount()]), signed: false });
  unsigned.render(); await settle(); tree = unsigned.render();
  assert.ok(unsigned.calls.includes('sign'));
  assert.ok(!buttons(tree).some(b => b.props.label === de.retention.promoAction), 'not eligible / key missing: hidden, no fake offer');

  const promo = manageScreen({ customer: monthlyCustomer, snapshotPlans: plans([discount()]) });
  promo.render(); await settle(); tree = promo.render();
  assert.ok(texts(tree).includes(de.retention.promoPercent('3 Monate', 50)), 'percent from StoreKit prices');
  assert.ok(texts(tree).includes(de.retention.offerThen('4,99 € pro Monat für 3 Monate', '9,99 € / Monat')), 'offer terms and the regular price afterwards');
  await buttons(tree).find(b => b.props.label === de.retention.promoAction).props.onPress(); await settle();
  assert.ok(promo.calls.includes('offer:retention:promo_3m_50'), 'redeemed through the promotional-offer purchase');

  const test = manageScreen({ customer: monthlyCustomer, snapshotPlans: plans([discount()]), mode: 'test-store' });
  test.render(); await settle(); tree = test.render();
  assert.ok(!texts(tree).includes(de.retention.beforeYouGo), 'Expo Go Test Store: no store offers');
});

await check('Manage entry: account help and Du route active Pro to the screen, everyone else straight to Apple', () => {
  const help = read('src/app/account-help.tsx');
  assert.match(help, /status === 'active' && canUse \? router\.push\('\/subscription-manage' as never\) : void openSubscriptionManagement\(\)/);
  assert.doesNotMatch(help, /Linking\.openURL\('https:\/\/apps\.apple\.com\/account\/subscriptions'\)/, 'one shared opener');
  assert.match(read('src/app/(tabs)/profile.tsx'), /subscriptionStatus === 'active' \? '\/subscription-manage' as never : '\/paywall'/);
  assert.match(read('src/app/_layout.tsx'), /<Stack\.Screen name="subscription-manage" \/>/);
  // Access policy itself is untouched: the screen is only reached with usable access.
  assert.doesNotMatch(read('src/services/accessPolicy.ts'), /subscription-manage/);
});

// ---------------------------------------------------------------- 3. SDK boundary
function sdkFixture({ info = customerInfo(), version = '18.1', offers = {}, promo = true, manageThrows = false } = {}) {
  const calls = []; const opened = [];
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'appl_fixture';
  const sdk = {
    setLogLevel: async () => {}, isConfigured: async () => true, configure() {}, getAppUserID: async () => 'user', logIn: async () => {},
    getCustomerInfo: async () => info,
    getOfferings: async () => ({ current: { annual: plan(true, null).package, monthly: plan(false, [discount()]).package } }),
    checkTrialOrIntroductoryPriceEligibility: async () => ({}),
    getEligibleWinBackOffersForProduct: async product => { calls.push('eligible:' + product.identifier); return offers[product.identifier]; },
    purchaseProductWithWinBackOffer: async (product, offer) => { calls.push(`winback:${product.identifier}:${offer.identifier}`); return { customerInfo: customerInfo({ active: entitlement() }) }; },
    getPromotionalOffer: async (product, d) => { calls.push(`sign:${product.identifier}:${d.identifier}`); return promo ? { identifier: d.identifier, keyIdentifier: 'KEY', nonce: 'n', signature: 's', timestamp: NOW } : undefined; },
    purchaseDiscountedPackage: async (pkg, signed) => { calls.push(`discounted:${pkg.identifier}:${signed.identifier}`); return { customerInfo: customerInfo({ active: entitlement() }) }; },
    purchasePackage: async () => { calls.push('purchasePackage'); return { customerInfo: customerInfo({ active: entitlement() }) }; },
    showManageSubscriptions: async () => { calls.push('manageSheet'); if (manageThrows) throw Error('unavailable'); },
  };
  const service = compile('src/services/subscription.ts', {
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'react-native': { Platform: { OS: 'ios', Version: version }, Linking: { openURL: async url => { opened.push(url); } } },
    'react-native-purchases': { __esModule: true, default: sdk, LOG_LEVEL: {}, INTRO_ELIGIBILITY_STATUS: {}, PURCHASES_ERROR_CODE: {} },
    '@/services/supabaseClient': { ensureSupabaseUser: async () => null, getCurrentSessionUserId: async () => null },
    '@/i18n/active': { getDictionary: () => en }, '@/services/retention': retention,
  });
  return { service, calls, opened };
}
const winBackOffer = { identifier: 'winback_annual_50', price: 29.99, priceString: '29,99 €', cycles: 1, period: 'P1Y', periodUnit: 'YEAR', periodNumberOfUnits: 1 };
const lapsedInfo = customerInfo({ all: { kandro_pro: entitlement({ isActive: false, expirationDate: '2026-08-01T00:00:00Z' }) } });

await check('Snapshot in grace: entitlement active plus billing issue; RevenueCat stays the access source', async () => {
  const f = sdkFixture({ info: customerInfo({ active: entitlement({ billingIssueDetectedAt: '2026-10-24T08:00:00Z' }) }) });
  const snapshot = await f.service.loadSubscriptionSnapshot();
  assert.equal(snapshot.entitlementActive, true, 'grace period counts as Pro');
  assert.equal(snapshot.customer.billingIssueDetectedAt, '2026-10-24T08:00:00Z');
  assert.equal(snapshot.customer.lapsed, false);
});

await check('Win-back only for lapsed customers on iOS 18+ with an Apple-eligible offer, purchased with purchaseProductWithWinBackOffer', async () => {
  const eligible = sdkFixture({ info: lapsedInfo, offers: { kandro_annual: [winBackOffer] } });
  const snapshot = await eligible.service.loadSubscriptionSnapshot();
  assert.equal(snapshot.customer.lapsed, true);
  const choice = await eligible.service.loadWinBackOffer(snapshot);
  assert.equal(choice.planId, 'yearly'); assert.equal(choice.offer.identifier, 'winback_annual_50');
  assert.equal(await eligible.service.purchaseWinBackOffer(snapshot.plans.yearly, choice.offer), true);
  assert.ok(eligible.calls.includes('winback:kandro_annual:winback_annual_50'));
  assert.ok(!eligible.calls.includes('purchasePackage'), 'not the normal purchase');
  assert.equal(retention.offerTerms(choice.offer, de), '1 Jahr für 29,99 €', 'price and period straight from StoreKit');

  const monthlyOnly = sdkFixture({ info: lapsedInfo, offers: { kandro_monthly: [{ ...winBackOffer, identifier: 'wb_m', periodUnit: 'MONTH', priceString: '4,99 €' }] } });
  assert.equal((await monthlyOnly.service.loadWinBackOffer(await monthlyOnly.service.loadSubscriptionSnapshot())).planId, 'monthly');

  const none = sdkFixture({ info: lapsedInfo, offers: {} });
  assert.equal(await none.service.loadWinBackOffer(await none.service.loadSubscriptionSnapshot()), null, 'no eligible offer: normal paywall');

  const ios17 = sdkFixture({ info: lapsedInfo, version: '17.6', offers: { kandro_annual: [winBackOffer] } });
  assert.equal(await ios17.service.loadWinBackOffer(await ios17.service.loadSubscriptionSnapshot()), null);
  assert.ok(!ios17.calls.some(c => c.startsWith('eligible:')), 'older iOS: StoreKit is not even asked');

  const neverPro = sdkFixture({ offers: { kandro_annual: [winBackOffer] } });
  assert.equal(await neverPro.service.loadWinBackOffer(await neverPro.service.loadSubscriptionSnapshot()), null);
  assert.ok(!neverPro.calls.some(c => c.startsWith('eligible:')), 'never subscribed: no win-back');

  const changed = sdkFixture({ info: lapsedInfo, offers: { kandro_annual: [{ ...winBackOffer, priceString: '39,99 €' }] } });
  const changedSnapshot = await changed.service.loadSubscriptionSnapshot();
  await assert.rejects(changed.service.purchaseWinBackOffer(changedSnapshot.plans.yearly, winBackOffer), new RegExp(en.access.offerChanged.slice(0, 20)), 'changed terms need a new tap');
  assert.ok(!changed.calls.some(c => c.startsWith('winback:')));
});

await check('Promotional offer: signed by RevenueCat first, purchased with purchaseDiscountedPackage; unsigned → hidden', async () => {
  const f = sdkFixture({ info: customerInfo({ active: entitlement() }) });
  const snapshot = await f.service.loadSubscriptionSnapshot();
  const found = await f.service.loadPromotionalDiscount(snapshot.plans.monthly, snapshot.plans.monthly.package.product.discounts);
  assert.equal(found.identifier, 'promo_3m_50');
  assert.equal(await f.service.purchasePromotionalDiscount(snapshot.plans.monthly, found), true);
  assert.ok(f.calls.includes('discounted:$rc_monthly:promo_3m_50'));
  const unsigned = sdkFixture({ info: customerInfo({ active: entitlement() }), promo: false });
  const s2 = await unsigned.service.loadSubscriptionSnapshot();
  assert.equal(await unsigned.service.loadPromotionalDiscount(s2.plans.monthly, s2.plans.monthly.package.product.discounts), null);
  assert.equal(await unsigned.service.loadPromotionalDiscount(s2.plans.yearly, []), null, 'no configured discount: StoreKit not asked');
});

await check('Apple subscription management: native sheet first, Apple URL as fallback', async () => {
  const sheet = sdkFixture();
  assert.equal(await sheet.service.openSubscriptionManagement(), 'sheet');
  assert.deepEqual(sheet.opened, []);
  const fallback = sdkFixture({ manageThrows: true });
  assert.equal(await fallback.service.openSubscriptionManagement(), 'url');
  assert.deepEqual(fallback.opened, ['https://apps.apple.com/account/subscriptions']);
});

// ---------------------------------------------------------------- 4. paywall win-back card
function paywallScreen({ lapsed, choice }) {
  const h = hooks(); const calls = []; const steps = [];
  const snapshot = { configured: true, mode: 'native-store', plans: plans(null), customer: { ...retention.NO_CUSTOMER, lapsed } };
  const subscription = { status: 'ready', busy: false, error: null, snapshot, async purchase(id) { calls.push('purchase:' + id); return 'cancelled'; }, async purchaseOffer(offer) { calls.push(`offer:${offer.kind}:${offer.planId}:${offer.offer.identifier}`); return 'active'; }, async refresh() {}, async restore() { return 'none'; }, async syncTrialReminder() { return true; } };
  const screen = compile('src/app/paywall.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ...rn, ActivityIndicator: 'Spinner', Animated: { Value: class { constructor(v) { this.v = v; } }, View: 'AnimatedView', timing: () => ({ start() {} }) }, BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: { openSettings: async () => {} }, useWindowDimensions: () => ({ fontScale: 1 }) },
    'expo-router': { Stack: { Screen: 'Stack' }, useFocusEffect(fn) { h.react.useEffect(fn, [fn]); }, useLocalSearchParams: () => ({}), useRouter: () => ({ replace() {}, push() {} }) },
    'react-native-safe-area-context': { SafeAreaView: 'Safe', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@expo/vector-icons/Ionicons': 'Icon', '@/components/ui': ui, '@/components/KandroMark': { KandroMark: 'Mark' },
    '@/constants/theme': theme, '@/constants/product': { FREE_SCAN_ALLOWANCE: 3 },
    '@/services/presentation': { usePresentationBlock() {} }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/context/AccessContext': { useAccess: () => ({ record: { hard: true, variant: 'excluded', source: 'public' }, hardWall: true, refresh: async () => {}, markSeen() {}, ready: true, state: 'locked', canUse: false, entryPaywall: false }) },
    '@/context/AppContext': { useApp: () => ({ freeScansLeft: 0 }) }, '@/services/accessPolicy': { takeAccessDestination: () => '/today' }, '@/context/SubscriptionContext': { useSubscription: () => subscription },
    '@/hooks/useFirstRun': { useFirstRun: () => null }, '@/services/firstRun': { finishFirstRunOffer: async () => {} },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: de, locale: 'de-DE' }) }, '@/services/haptics': { successHaptic() {} },
    '@/services/reminders': { TRIAL_REMINDER_LEAD_DAYS: 2, getReminderPermission: async () => 'authorized', requestReminderPermission: async () => 'authorized' },
    '@/services/telemetry': { toBillingMode: x => x, trackEvent() {} }, '@/services/paywallExposure': { markPaywallShown() {}, markPurchaseStep: (outcome, kind = 'purchase') => steps.push(`${kind}:${outcome}`) },
    '@/services/subscription': { loadWinBackOffer: async () => { calls.push('load'); return choice; } }, '@/services/retention': retention,
  }).default;
  return { render: () => h.render(screen), calls, steps };
}
await check('Paywall shows "Willkommen zurück" only with a real win-back offer, and redeems it through the win-back purchase', async () => {
  const offer = { planId: 'yearly', offer: winBackOffer };
  const back = paywallScreen({ lapsed: true, choice: offer });
  back.render(); await settle(); let tree = back.render();
  const title = de.retention.winBackTitle('1 Jahr für 29,99 €');
  assert.ok(texts(tree).includes(title), 'offer price and period from StoreKit');
  assert.ok(texts(tree).includes(de.retention.offerThen('1 Jahr für 29,99 €', '59,99 € / Jahr')), 'renewal price stated before purchase (3.1.2)');
  await buttons(tree).find(b => b.props.label === de.retention.winBackAction).props.onPress(); await settle();
  assert.ok(back.calls.includes('offer:winback:yearly:winback_annual_50'));
  assert.ok(!back.calls.some(c => c.startsWith('purchase:')), 'not the normal purchase');
  assert.deepEqual(back.steps, ['winback:started', 'winback:active']);
  const none = paywallScreen({ lapsed: true, choice: null });
  none.render(); await settle();
  assert.ok(!texts(none.render()).some(text => text.startsWith(de.retention.winBackEyebrow)), 'no eligible offer: normal paywall');
  const fresh = paywallScreen({ lapsed: false, choice: offer });
  fresh.render(); await settle(); tree = fresh.render();
  assert.ok(!fresh.calls.includes('load'), 'never subscribed: StoreKit is not asked');
  assert.ok(!texts(tree).includes(title));
});

// ---------------------------------------------------------------- 5. measurement
await check('Purchase steps: winback_* and retention_offer_* need the written (unapplied) migration', () => {
  const sql = read('supabase/migrations/20261025140000_paywall_retention_steps.sql');
  for (const kind of ['winback', 'retention_offer']) for (const step of ['started', 'cancelled', 'failed', 'pending', 'completed']) {
    assert.ok(sql.split(`'${kind}_${step}'`).length - 1 >= 2, `${kind}_${step} in the check constraint and the function`);
  }
  assert.match(sql, /on conflict \(user_id, context\) do nothing/);
  assert.match(sql, /revoke all on private\.paywall_steps_daily from public, anon, authenticated;/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /price|plan_id|amount|reason/i, 'no price, plan or reason data');
  const exposure = read('src/services/paywallExposure.ts');
  assert.match(exposure, /export type PurchaseStepKind = 'purchase' \| 'winback' \| 'retention_offer' \| 'trial_offer';/);
});

await check('Cancelled trial: Today card only in the last 48 h of a trial turned off at Apple', () => {
  const trialCustomer = { ...retention.NO_CUSTOMER, productId: 'kandro_monthly', periodType: 'TRIAL', willRenew: false, expiresAt: new Date(NOW + 30 * 3_600_000).toISOString() };
  const base = { status: 'active', customer: trialCustomer, now: NOW, dismissedDay: null, today: '2026-10-25' };
  assert.deepEqual(retention.cancelledTrialEnding(base), { expiresAt: trialCustomer.expiresAt });
  assert.equal(retention.cancelledTrialEnding({ ...base, customer: { ...trialCustomer, willRenew: true } }), null, 'renewing trial');
  assert.equal(retention.cancelledTrialEnding({ ...base, customer: { ...trialCustomer, periodType: 'NORMAL' } }), null, 'paid period');
  assert.equal(retention.cancelledTrialEnding({ ...base, customer: { ...trialCustomer, expiresAt: new Date(NOW + 60 * 3_600_000).toISOString() } }), null, 'more than 48 h left');
  assert.equal(retention.cancelledTrialEnding({ ...base, customer: { ...trialCustomer, expiresAt: new Date(NOW - 1000).toISOString() } }), null, 'already ended');
  assert.equal(retention.cancelledTrialEnding({ ...base, status: 'ready' }), null, 'server does not confirm Pro');
  assert.equal(retention.cancelledTrialEnding({ ...base, dismissedDay: '2026-10-25' }), null, 'hidden for today');
  assert.ok(retention.cancelledTrialEnding({ ...base, dismissedDay: '2026-10-24' }), 'back the next day');
  assert.equal(retention.cancelledTrialEnding({ ...base, customer: null }), null);
});

await check('Cancelled trial: meals counted from the trial start, copy without pressure in both languages', () => {
  const meals = [{ savedAt: '2026-10-20T08:00:00Z' }, { savedAt: '2026-10-22T08:00:00Z' }, { savedAt: '2026-10-24T19:00:00Z' }, { date: '2026-10-23' }, {}];
  assert.equal(retention.mealsSince(meals, '2026-10-21T10:00:00Z'), 3);
  assert.equal(retention.mealsSince(meals, null), 0);
  assert.equal(retention.mealsSince([], '2026-10-21T10:00:00Z'), 0);
  for (const dict of [de, en]) {
    const r = dict.retention;
    for (const text of [r.trialEndingToday, r.trialEndingTomorrow, r.trialEndingOn('Dienstag, 28. Oktober'), r.trialEndingMeals(1), r.trialEndingMeals(12), r.trialEndingNoMeals, r.trialEndingOffer('x'), r.trialEndingKeep, r.trialEndingPushTitle, r.trialEndingPushBody(3), r.trialEndingPushBodyEmpty]) {
      assert.ok(typeof text === 'string' && text.length > 0);
      assert.doesNotMatch(text, /unbegrenzt|unlimited|letzte Chance|last chance|verpass|miss out|!/i, text);
    }
  }
  assert.match(de.retention.trialEndingMeals(1), /1 Mahlzeit /); assert.match(en.retention.trialEndingMeals(1), /1 meal /);
  const card = read('src/components/TrialEndingCard.tsx');
  assert.match(card, /loadPromotionalDiscount\(currentPlan, model\.promoDiscounts\)/, 'offer only when RevenueCat signs it');
  assert.match(card, /openSubscriptionManagement\(\)/, 'Apple page is always offered');
  assert.match(card, /markPurchaseStep\('started', 'trial_offer'\)/);
  assert.match(read('src/app/(tabs)/today.tsx'), /<TrialEndingCard \/>/);
});

await check('Cancelled-trial measurement: steps and outcome view, counts only', () => {
  const sql = read('supabase/migrations/20261026120000_trial_cancellation_measurement.sql');
  for (const context of ['trial_ending', 'trial_keep', 'trial_offer_started', 'trial_offer_cancelled', 'trial_offer_failed', 'trial_offer_pending', 'trial_offer_completed']) {
    assert.ok(sql.split(`'${context}'`).length - 1 >= 2, `${context} in the check constraint and the function`);
  }
  for (const previous of ['purchase_completed', 'winback_completed', 'retention_offer_completed']) assert.ok(sql.includes(`'${previous}'`), `${previous} kept`);
  assert.match(sql, /create view private\.trial_outcomes_daily/);
  assert.match(sql, /environment = 'PRODUCTION'/);
  assert.match(sql, /revoke all on private\.trial_outcomes_daily from public, anon, authenticated;/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /price|plan_id|amount|reason/i, 'no price, plan or reason data');
});

Date.now = realNow;
for (const name of passed) console.log('PASS', name);
console.log(`Validated retention: ${passed.length} checks.`);
