import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  PurchasesPackage,
  PurchasesStoreProductDiscount,
  PurchasesWinBackOffer,
} from 'react-native-purchases';

import { ensureSupabaseUser, getCurrentSessionUserId } from '@/services/supabaseClient';
import type { ExperimentAttributes } from '@/services/revenueCatExperimentPolicy';
import { getDictionary } from '@/i18n/active';
import { NO_CUSTOMER, SubscriptionCustomer, subscriptionCustomerFrom, winBackApplies } from '@/services/retention';

export type SubscriptionPlanId = 'yearly' | 'monthly';

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  package: PurchasesPackage;
  price: string;
  detail: string;
  billing: string;
  hasFreeTrial: boolean;
  /** Localised trial length, e.g. "7 Tage", when the store offers one. */
  trialLabel: string | null;
  trialDays: number | null;
  /** Raw amounts so the UI can compare plans instead of asserting a saving. */
  priceAmount: number;
  monthlyEquivalent: number | null;
};

export type SubscriptionTrial = { productId: string; expiresAt: string; startedAt: string | null; willRenew: boolean };

export type SubscriptionSnapshot = {
  configured: boolean;
  entitlementActive: boolean;
  currentTrial: SubscriptionTrial | null;
  mode: 'unconfigured' | 'test-store' | 'native-store' | 'web';
  plans: Record<SubscriptionPlanId, SubscriptionPlan | null>;
  /** Device SDK facts for retention UI only (grace banner, manage screen, win-back); never access. */
  customer: SubscriptionCustomer;
};

const ENTITLEMENT_ID = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || 'kandro_pro';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let configurationPromise: Promise<boolean> | null = null;
let identityOperation: Promise<unknown> = Promise.resolve();
function serializeRevenueCatIdentity<T>(fn: () => Promise<T>) {
  const next = identityOperation.then(fn, fn);
  identityOperation = next.catch(() => undefined);
  return next;
}

function publicApiKey() {
  if (isExpoGo) return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY?.trim();
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
  return process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY?.trim();
}

function subscriptionMode(): SubscriptionSnapshot['mode'] {
  if (!publicApiKey()) return 'unconfigured';
  if (isExpoGo) return 'test-store';
  if (Platform.OS === 'web') return 'web';
  return 'native-store';
}

function hasPro(customerInfo: CustomerInfo) {
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
}

/** Billing facts from the entitlement, never purchase time + advertised duration. */
export function currentTrialFrom(customerInfo: CustomerInfo): SubscriptionTrial | null {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  const expiresAt = entitlement?.expirationDate;
  if (!entitlement?.isActive || entitlement.store !== 'APP_STORE'
    || entitlement.periodType !== 'TRIAL'
    || !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return null;
  const start = entitlement.latestPurchaseDate;
  const startedAt = start && Number.isFinite(Date.parse(start)) && Date.parse(start) <= Date.now()
    && Date.parse(start) < Date.parse(expiresAt) ? start : null;
  return { productId: entitlement.productIdentifier, expiresAt, startedAt, willRenew: entitlement.willRenew === true };
}

/** A reminder refresh does not need offerings, prices or intro eligibility. */
export async function loadSubscriptionTrial(): Promise<SubscriptionTrial | null> {
  if (subscriptionMode() !== 'native-store' || !(await ensureRevenueCatConfigured())) return null;
  return currentTrialFrom(await Purchases.getCustomerInfo());
}

async function syncRevenueCatUser() {
  const user = await ensureSupabaseUser().catch(() => null);
  if (!user) return;
  const revenueCatUserId = await Purchases.getAppUserID();
  if (user.id !== await getCurrentSessionUserId()) return;
  if (revenueCatUserId !== user.id) await Purchases.logIn(user.id);
}

function ensureRevenueCatConfigured() {
  return serializeRevenueCatIdentity(ensureRevenueCatConfiguredSerial);
}

async function ensureRevenueCatConfiguredSerial() {
  const apiKey = publicApiKey();
  if (!apiKey) return false;

  if (!configurationPromise) {
    configurationPromise = (async () => {
      await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
      const user = await ensureSupabaseUser().catch(() => null);
      const alreadyConfigured = await Purchases.isConfigured();
      if (!alreadyConfigured) {
        Purchases.configure({ apiKey, ...(user ? { appUserID: user.id } : {}) });
      } else if (user) {
        await syncRevenueCatUser();
      }
      return true;
    })().catch((error) => {
      configurationPromise = null;
      throw error;
    });
  }

  const configured = await configurationPromise;
  if (configured) await syncRevenueCatUser();
  return configured;
}

/**
 * Optional analytics never creates/logs in an account. Identity changes and
 * attribute writes share one queue, so a delayed write cannot land on the next
 * customer's RC identity. The guard is re-read after every asynchronous check.
 */
export function writeRevenueCatExperimentAttributes(owner: string, attributes: ExperimentAttributes, stillAllowed: () => boolean) {
  return serializeRevenueCatIdentity(async () => {
    if (!stillAllowed() || subscriptionMode() !== 'native-store' || !(await Purchases.isConfigured())) return false;
    if (!stillAllowed() || await getCurrentSessionUserId() !== owner) return false;
    if (!stillAllowed() || await Purchases.getAppUserID() !== owner) return false;
    if (!stillAllowed() || await getCurrentSessionUserId() !== owner) return false;
    if (!stillAllowed()) return false;
    await Purchases.setAttributes(attributes);
    // This confirms SDK acceptance only, not server delivery or chart inclusion.
    return true;
  });
}

/** Turns the store's intro period into German copy, or null when there is none. */
function trialLabelFrom(product: PurchasesPackage['product']): string | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0) return null;

  const cycles = intro.cycles ?? 1;
  const count = (intro.periodNumberOfUnits ?? 0) * cycles;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(cycles) || cycles < 1) return null;

  const units = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' } as const;
  const unit = units[String(intro.periodUnit ?? '').toUpperCase() as keyof typeof units];
  if (!unit) return null;
  return getDictionary().billing.trialPeriod(count, unit);
}

function toPlan(id: SubscriptionPlanId, purchasePackage: PurchasesPackage | null, trialEligible = false): SubscriptionPlan | null {
  if (!purchasePackage) return null;
  const { product } = purchasePackage;
  const t = getDictionary();
  const yearly = id === 'yearly';
  const trialLabel = trialEligible ? trialLabelFrom(product) : null;
  const hasFreeTrial = trialLabel !== null;
  const introUnit = product.introPrice?.periodUnit?.toUpperCase();
  const introCount = (product.introPrice?.periodNumberOfUnits ?? 0) * (product.introPrice?.cycles ?? 1);
  const monthlyEquivalent = yearly
    ? (typeof product.pricePerMonth === 'number' ? product.pricePerMonth : product.price / 12)
    : product.price;
  return {
    id,
    package: purchasePackage,
    price: t.billing.pricePerPeriod(product.priceString, yearly),
    detail: yearly && product.pricePerMonthString
      ? t.billing.perMonth(product.pricePerMonthString)
      : yearly
        ? t.billing.yearlyBilling
        : t.billing.monthlyFlexible,
    billing: t.billing.billingLine(product.priceString, yearly),
    hasFreeTrial,
    trialLabel,
    trialDays: hasFreeTrial ? (introUnit === 'DAY' ? introCount : introUnit === 'WEEK' ? introCount * 7 : null) : null,
    priceAmount: product.price,
    monthlyEquivalent: Number.isFinite(monthlyEquivalent) ? monthlyEquivalent : null,
  };
}

export async function loadSubscriptionSnapshot(): Promise<SubscriptionSnapshot> {
  const configured = await ensureRevenueCatConfigured();
  if (!configured) {
    return {
      configured: false,
      entitlementActive: false,
      currentTrial: null,
      mode: 'unconfigured',
      plans: { yearly: null, monthly: null },
      customer: NO_CUSTOMER,
    };
  }

  const [customerInfo, offerings] = await Promise.all([
    Purchases.getCustomerInfo(),
    Purchases.getOfferings(),
  ]);
  const offering = offerings.current;
  const productIds = [offering?.annual, offering?.monthly]
    .flatMap((pkg) => pkg ? [pkg.product.identifier] : []);
  // An intro offer on a product does not mean this Apple account can use it.
  // Unknown/error/non-iOS must show standard pricing, not promise a free trial.
  const eligibility = Platform.OS === 'ios' && productIds.length
    ? await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds).catch(() => ({}))
    : {};
  const trialEligible = (pkg: PurchasesPackage | null | undefined) => Boolean(pkg &&
    (eligibility as Record<string, { status: INTRO_ELIGIBILITY_STATUS }>)[pkg.product.identifier]?.status ===
      INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE);
  return {
    configured: true,
    entitlementActive: hasPro(customerInfo),
    currentTrial: subscriptionMode() === 'native-store' ? currentTrialFrom(customerInfo) : null,
    mode: subscriptionMode(),
    plans: {
      yearly: toPlan('yearly', offering?.annual ?? null, trialEligible(offering?.annual)),
      monthly: toPlan('monthly', offering?.monthly ?? null, trialEligible(offering?.monthly)),
    },
    customer: subscriptionCustomerFrom(customerInfo, ENTITLEMENT_ID),
  };
}

export async function purchaseSubscription(plan: SubscriptionPlan) {
  if (!(await ensureRevenueCatConfigured())) throw new Error(getDictionary().errors.billingSetupMissing);
  // Re-read price, product and intro eligibility immediately before opening
  // Apple. Changed terms require a new explicit tap after the UI refreshes.
  const fresh = (await loadSubscriptionSnapshot()).plans[plan.id];
  if (!fresh || fresh.package.product.identifier !== plan.package.product.identifier
    || fresh.price !== plan.price || fresh.priceAmount !== plan.priceAmount
    || fresh.trialLabel !== plan.trialLabel || fresh.trialDays !== plan.trialDays) {
    throw new Error(getDictionary().access.offerChanged);
  }
  const { customerInfo } = await Purchases.purchasePackage(fresh.package);
  return hasPro(customerInfo);
}

export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Apple's own subscription management (cancel, change plan, payment method).
 * Never gated on offers, access or network: the sheet first, the Apple URL as
 * the fallback, so cancelling always stays one tap away (guideline 3.1.2).
 */
export async function openSubscriptionManagement() {
  if (Platform.OS === 'ios' && subscriptionMode() === 'native-store') {
    try {
      if (await Purchases.isConfigured()) { await Purchases.showManageSubscriptions(); return 'sheet' as const; }
    } catch { /* Fall through to Apple's page. */ }
  }
  await Linking.openURL(APPLE_SUBSCRIPTIONS_URL).catch(() => undefined);
  return 'url' as const;
}

export type WinBackChoice = { planId: SubscriptionPlanId; offer: PurchasesWinBackOffer };

/**
 * Real StoreKit win-back offers only (iOS 18+, lapsed Kandro Pro customer).
 * Apple decides eligibility; no offer means the normal paywall. Annual first.
 */
export async function loadWinBackOffer(snapshot: SubscriptionSnapshot): Promise<WinBackChoice | null> {
  if (snapshot.mode !== 'native-store' || !winBackApplies(snapshot.customer, Platform.OS, Platform.Version)) return null;
  if (!(await ensureRevenueCatConfigured())) return null;
  for (const planId of ['yearly', 'monthly'] as const) {
    const plan = snapshot.plans[planId];
    if (!plan) continue;
    const offers = await Purchases.getEligibleWinBackOffersForProduct(plan.package.product).catch(() => undefined);
    const offer = offers?.find(candidate => Boolean(candidate?.identifier && candidate.priceString));
    if (offer) return { planId, offer };
  }
  return null;
}

export async function purchaseWinBackOffer(plan: SubscriptionPlan, offer: PurchasesWinBackOffer) {
  if (!(await ensureRevenueCatConfigured())) throw new Error(getDictionary().errors.billingSetupMissing);
  // Eligibility can change (another device resubscribed): re-ask Apple first.
  const offers = await Purchases.getEligibleWinBackOffersForProduct(plan.package.product).catch(() => undefined);
  const fresh = offers?.find(candidate => candidate.identifier === offer.identifier);
  if (!fresh || fresh.priceString !== offer.priceString || fresh.cycles !== offer.cycles
    || fresh.periodUnit !== offer.periodUnit || fresh.periodNumberOfUnits !== offer.periodNumberOfUnits) {
    throw new Error(getDictionary().access.offerChanged);
  }
  const { customerInfo } = await Purchases.purchaseProductWithWinBackOffer(plan.package.product, fresh);
  return hasPro(customerInfo);
}

/**
 * The first promotional offer (configured on the product in App Store
 * Connect) that RevenueCat can sign for this customer. Undefined from the SDK
 * means not eligible or not set up (In-App Purchase key missing): no offer.
 */
export async function loadPromotionalDiscount(plan: SubscriptionPlan, discounts: PurchasesStoreProductDiscount[]) {
  if (subscriptionMode() !== 'native-store' || !discounts.length || !(await ensureRevenueCatConfigured())) return null;
  for (const discount of discounts) {
    const signed = await Purchases.getPromotionalOffer(plan.package.product, discount).catch(() => undefined);
    if (signed) return discount;
  }
  return null;
}

export async function purchasePromotionalDiscount(plan: SubscriptionPlan, discount: PurchasesStoreProductDiscount) {
  if (!(await ensureRevenueCatConfigured())) throw new Error(getDictionary().errors.billingSetupMissing);
  // A signed offer is short-lived: sign right before opening Apple's sheet.
  const signed = await Purchases.getPromotionalOffer(plan.package.product, discount).catch(() => undefined);
  if (!signed) throw new Error(getDictionary().access.offerChanged);
  const { customerInfo } = await Purchases.purchaseDiscountedPackage(plan.package, signed);
  return hasPro(customerInfo);
}

export async function restoreSubscription() {
  if (!(await ensureRevenueCatConfigured())) throw new Error(getDictionary().errors.billingSetupMissing);
  return hasPro(await Purchases.restorePurchases());
}

/**
 * Drops RevenueCat's on-device identity after the server has erased the
 * linked customer. The backend deletion is authoritative; this cleanup must
 * never make an already-completed account deletion look like it failed.
 */
export function clearSubscriptionIdentityAfterAccountDeletion() {
  return serializeRevenueCatIdentity(async () => {
    if (!publicApiKey() || !(await Purchases.isConfigured())) return;
    if (!(await Purchases.isAnonymous())) await Purchases.logOut();
    configurationPromise = null;
  });
}

export function isSubscriptionPurchaseCancelled(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; userCancelled?: boolean | null };
  return candidate.userCancelled === true || candidate.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

export function isSubscriptionPurchasePending(error: unknown) {
  return Boolean(error && typeof error === 'object' &&
    (error as { code?: unknown }).code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR);
}

export function subscriptionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLocaleLowerCase('en-US');
  const t = getDictionary();
  // The provider speaks English; our own thrown messages come from the
  // dictionary, so match those by value instead of by a German fragment that
  // stopped matching the moment the app also spoke English.
  const ownSetupError = message === t.errors.billingSetupMissing || message === t.errors.billingNotConfigured;
  if (normalized.includes('invalid api key')) return t.errors.billingKeyMismatch;
  if (normalized.includes('offering') || normalized.includes('package')) return t.errors.offeringMissing;
  if (normalized.includes('network')) return t.errors.billingUnreachable;
  if (normalized.includes('not configured') || ownSetupError) return t.errors.billingNotConfigured;
  return message || t.errors.billingStatusFailed;
}
