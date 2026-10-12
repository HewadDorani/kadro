import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [service, accountDeletion, context, paywall, scan, result, appContext, localRepository, envExample, packageJson, dictDe, dictEn] = await Promise.all([
  readFile(resolve(projectRoot, 'src/services/subscription.ts'), 'utf8'),
  readFile(resolve(projectRoot, 'src/services/accountDeletion.ts'), 'utf8'),
  readFile(resolve(projectRoot, 'src/context/SubscriptionContext.tsx'), 'utf8'),
  readFile(resolve(projectRoot, 'src/app/paywall.tsx'), 'utf8'),
  readFile(resolve(projectRoot, 'src/app/(tabs)/scan.tsx'), 'utf8'),
  readFile(resolve(projectRoot, 'src/app/result.tsx'), 'utf8'),
  readFile(resolve(projectRoot, 'src/context/AppContext.tsx'), 'utf8'),
  readFile(resolve(projectRoot, 'src/services/localRepository.ts'), 'utf8'),
  readFile(resolve(projectRoot, '.env.example'), 'utf8'),
  readFile(resolve(projectRoot, 'package.json'), 'utf8'),
  readFile(resolve(projectRoot, 'src/i18n/de.ts'), 'utf8'),
  readFile(resolve(projectRoot, 'src/i18n/en.ts'), 'utf8'),
]);

const failures = [];
// Execute the actual plan mapper, not a second implementation of its rules.
const mapper = service.slice(service.indexOf('function trialLabelFrom'), service.indexOf('export async function loadSubscriptionSnapshot'));
const compiledMapper = ts.transpileModule(mapper, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const toPlan = new Function('getDictionary', `${compiledMapper}; return toPlan;`)(() => ({ billing: {
  trialPeriod: (count, unit) => `${count} ${unit}`, pricePerPeriod: (price) => price,
  perMonth: (price) => price, yearlyBilling: 'annual', monthlyFlexible: 'monthly', billingLine: (price) => price,
} }));
const trialPackage = { product: { identifier: 'test', price: 30, priceString: '30', introPrice: { price: 0, periodNumberOfUnits: 7, periodUnit: 'DAY' } } };
for (const eligibility of [undefined, false]) {
  assert.equal(toPlan('yearly', trialPackage, eligibility).hasFreeTrial, false);
  assert.equal(toPlan('yearly', trialPackage, eligibility).trialLabel, null);
}
assert.equal(toPlan('yearly', trialPackage, true).trialLabel, '7 day');
assert.equal(toPlan('yearly', { product: { ...trialPackage.product, introPrice: null } }, true).hasFreeTrial, false);
assert.match(service, /checkTrialOrIntroductoryPriceEligibility/);
assert.match(service, /status ===\s*INTRO_ELIGIBILITY_STATUS\.INTRO_ELIGIBILITY_STATUS_ELIGIBLE/);
assert.match(service, /toPlan\('yearly', offering\?\.annual \?\? null, trialEligible/);
assert.match(service, /toPlan\('monthly', offering\?\.monthly \?\? null, trialEligible/);
for (const invariant of [
  'Purchases.configure',
  'Purchases.getOfferings',
  'Purchases.getCustomerInfo',
  'Purchases.purchasePackage',
  'Purchases.restorePurchases',
  'Purchases.isAnonymous',
  'Purchases.logOut',
  'customerInfo.entitlements.active[ENTITLEMENT_ID]',
  'ensureSupabaseUser',
]) {
  if (!service.includes(invariant)) failures.push(`subscription invariant missing: ${invariant}`);
}
if (!accountDeletion.includes('clearSubscriptionIdentityAfterAccountDeletion')) {
  failures.push('account deletion must discard the RevenueCat on-device identity');
}

if (!service.includes('ExecutionEnvironment.StoreClient')) failures.push('Expo Go must select the RevenueCat Test Store');
if (!context.includes("'active' | 'cancelled' | 'failed'")) failures.push('purchase flow must distinguish cancellation from failure');
// The copy moved into the dictionaries, so assert on the wiring and on both
// languages actually carrying the string.
if (!paywall.includes('t.paywall.restore')) failures.push('paywall has no user-triggered restore action');
if (!paywall.includes('snapshot?.plans')) failures.push('paywall does not display RevenueCat offering prices');
if (!paywall.includes('{t.paywall.fairUse}')) failures.push('paywall must visibly disclose the daily analysis limit before purchase');
for (const [label, dict] of [['German', dictDe], ['English', dictEn]]) {
  for (const key of ['proText', 'benefitAnalyze']) {
    for (const [, copy] of dict.matchAll(new RegExp(`${key}:\\s*['\"]([^'\"]+)['\"]`, 'g'))) {
      if (/unbegrenzt|unlimited|as much as you like/i.test(copy)) failures.push(`${label} ${key} promises unlimited use despite the daily cap`);
    }
  }
}

// The paywall must persuade with facts, not with pressure. These pin the
// honest bits so a later "conversion optimisation" cannot quietly remove them.
if (!paywall.includes('savingPercent')) {
  failures.push('the yearly saving must be computed from the real prices, not asserted');
}
if (!paywall.includes('trialLabel')) failures.push('a free trial must state its actual length before the purchase');
if (!paywall.includes('t.paywall.keeps')) {
  failures.push('the paywall must state that existing history stays accessible without Pro');
}
for (const [label, dict] of [['German', dictDe], ['English', dictEn]]) {
  // Guideline 3.1.2 wants the renewal terms and the legal links clear and
  // conspicuous. They were nine point grey, which is the size something gets
  // when you would rather it were not read — and a reviewer reads it that way.
  const paywall = readFileSync(new URL('../src/app/paywall.tsx', import.meta.url), 'utf8');
  // typeScale steps are text styles ({ fontSize, lineHeight, ... }); a style
  // either spreads one or sets a raw fontSize.
  const typeScale = Object.fromEntries([...readFileSync(new URL('../src/constants/theme.ts', import.meta.url), 'utf8')
    .match(/export const typeScale = \{([\s\S]*?)\n\} as const/)[1].matchAll(/^\s*(\w+): \{ fontSize: (\d+)/gm)].map(([, name, value]) => [name, Number(value)]));
  for (const [style, minimum] of [['renewal', 12], ['legal', 12]]) {
    const raw = paywall.match(new RegExp(`\\b${style}: \\{[^}]*?(?:fontSize: (\\d+)|\\.\\.\\.typeScale\\.(\\w+))`));
    const size = raw?.[1] ? Number(raw[1]) : typeScale[raw?.[2]] ?? 0;
    if (size < minimum) {
      failures.push(`paywall ${style} text is ${size}pt; App Review expects the renewal terms to be legible`);
    }
  }

  for (const key of ['restore', 'keeps', 'renewalYear', 'renewalMonth', 'renewalTail']) {
    if (!dict.includes(`${key}:`)) failures.push(`${label} paywall is missing ${key}`);
  }
}

// Missing StoreKit products must never show fabricated price previews.
if (/previewYearly|previewMonthly/.test(paywall)) failures.push('missing products must not display placeholder prices');
for (const [label, dict] of [['German', dictDe], ['English', dictEn]]) {
  const fallback = dict.match(/yearlyFallback:\s*['"]([^'"]+)['"]/)?.[1];
  if (!fallback || /[0-9]/.test(fallback)) failures.push(`${label} missing-product fallback must be neutral, not a price`);
}
if (!service.includes('loadSubscriptionSnapshot()') || !service.includes('offerChanged')) failures.push('purchase must recheck the actual offer before opening Apple');
if (/Nur noch|läuft ab in|Angebot endet|letzte Chance|only .* left|offer ends|last chance/i.test(paywall + dictDe + dictEn)) {
  failures.push('the paywall must not use countdowns, scarcity or loss framing');
}
if (!service.includes('trialLabelFrom') || !service.includes('monthlyEquivalent')) {
  failures.push('the subscription service must expose trial length and comparable amounts');
}
if (!scan.includes('freeScansLeft > 0') || !scan.includes("subscriptionStatus === 'active'")) {
  failures.push('scanner does not enforce the free-scan entitlement boundary');
}
// A wall the user saw coming reads as a price; a wall that appears without
// warning reads as a bait and switch.
// The wording moved into the dictionaries; the guarantee is that the scanner
// surfaces the remaining allowance at all, in whichever language. Since
// 10/2026 the total comes from useFreeScanAllowance (3 legacy, 1 behind the
// hard wall), and a hard-wall install sees its single sample analysis.
if (!scan.includes('useFreeScanAllowance') || !scan.includes('t.scan.allowanceLeft') || !scan.includes('t.scan.trialScanLeft')) {
  failures.push('scanner does not show the remaining free allowance before the paywall');
}
const analyzeFlow = appContext.slice(
  appContext.indexOf('const analyzeCurrentPhoto = useCallback'),
  appContext.indexOf('const resumeLatestAnalysis = useCallback'),
);
const saveFlow = appContext.slice(
  appContext.indexOf('const logScannedMeal = useCallback'),
  appContext.indexOf('const logPlannedMeal = useCallback'),
);
if (!analyzeFlow.includes('countLifetimeScanOnce(invocationScanId)') || saveFlow.includes('countLifetimeScanOnce')) {
  failures.push('the free allowance must be spent once per successful request, before optional meal save');
}
if (!result.includes('savedOnArrival') || !result.includes('logScannedMeal()')) failures.push('the first complete result is not persisted before the paywall boundary');
if (!appContext.includes('setLifetimeScanCount')) failures.push('a completed scan does not update the free-scan boundary');
if (!localRepository.includes('loadAllStoredScans')) failures.push('the free-scan boundary does not survive a new day locally');
if (!envExample.includes('EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=')) failures.push('Test Store public key is undocumented');
if (!envExample.includes('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=')) failures.push('iOS public SDK key is undocumented');
if (!envExample.includes('EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=kandro_pro')) failures.push('Kandro entitlement ID is undocumented');
if (!packageJson.includes('"react-native-purchases"')) failures.push('RevenueCat SDK dependency is missing');
if (/REVENUECAT_(SECRET|PRIVATE|V2)_API_KEY/.test(envExample)) failures.push('secret RevenueCat key must not be exposed to Expo');

if (failures.length) {
  throw new Error(`RevenueCat validation failed:\n- ${failures.join('\n- ')}`);
}

console.log('Validated the announced free-scan allowance plus RevenueCat offering, entitlement, purchase, cancellation, and restore boundaries.');
