import type { CustomerInfo, PurchasesStoreProductDiscount } from 'react-native-purchases';

import type { de } from '@/i18n/de';

/**
 * Retention facts and copy decisions (1.0.6). Pure: no SDK calls, so the
 * billing-issue banner, the manage screen and the win-back card can be
 * checked against deterministic CustomerInfo/offering fixtures.
 *
 * Honesty rules encoded here:
 * - an offer exists only when StoreKit returns it (product.discounts / win-back
 *   eligibility); prices and periods are always the store's own strings;
 * - cancellation is never part of the decision: the manage screen always
 *   offers Apple's subscription management, whatever this returns.
 */

type Dictionary = typeof de;
export type PlanId = 'yearly' | 'monthly';

/** What the device SDK says about the Kandro Pro entitlement right now. */
export type SubscriptionCustomer = {
  /** Store product of the active entitlement, null without one. */
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
  periodType: string | null;
  /** Set by RevenueCat while Apple retries a failed renewal (grace period). */
  billingIssueDetectedAt: string | null;
  unsubscribeDetectedAt: string | null;
  /** Had Kandro Pro before and has no active entitlement now. */
  lapsed: boolean;
};

export const NO_CUSTOMER: SubscriptionCustomer = {
  productId: null, expiresAt: null, willRenew: false, periodType: null,
  billingIssueDetectedAt: null, unsubscribeDetectedAt: null, lapsed: false,
};

const validDate = (value: string | null | undefined) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

/**
 * During Apple's billing grace period RevenueCat keeps the entitlement in
 * `entitlements.active` and sets billingIssueDetectedAt. Access therefore
 * stays exactly where it is (active); only the calm banner reads the flag.
 * When grace ends without payment the entitlement leaves `active` and the
 * normal lock applies again (server: EXPIRATION webhook / REST recheck).
 */
export function subscriptionCustomerFrom(customerInfo: CustomerInfo, entitlementId: string): SubscriptionCustomer {
  const active = customerInfo.entitlements.active?.[entitlementId];
  const known = customerInfo.entitlements.all?.[entitlementId];
  if (active?.isActive) {
    return {
      productId: active.productIdentifier || null,
      expiresAt: validDate(active.expirationDate),
      willRenew: active.willRenew === true,
      periodType: active.periodType ?? null,
      billingIssueDetectedAt: validDate(active.billingIssueDetectedAt),
      unsubscribeDetectedAt: validDate(active.unsubscribeDetectedAt),
      lapsed: false,
    };
  }
  return { ...NO_CUSTOMER, lapsed: Boolean(known) };
}

/** The banner: confirmed Pro (server says active) with a billing issue, not dismissed today. */
export function billingIssueBannerVisible(input: { status: string; customer: SubscriptionCustomer | null | undefined; dismissedDay: string | null; today: string }) {
  return input.status === 'active' && Boolean(input.customer?.billingIssueDetectedAt) && input.dismissedDay !== input.today;
}

/** A cancelled trial shows the Today card only in its last 48 hours. */
export const TRIAL_ENDING_WINDOW_MS = 48 * 3_600_000;

/**
 * Trial started, then turned off at Apple (willRenew false). Access stays
 * until the trial ends; the card only says when and how to keep going.
 * Null for a renewing trial, a paid period, an expired trial or after
 * "hide for today".
 */
export function cancelledTrialEnding(input: { status: string; customer: SubscriptionCustomer | null | undefined; now: number; dismissedDay: string | null; today: string }) {
  const customer = input.customer;
  if (input.status !== 'active' || !customer || customer.periodType !== 'TRIAL' || customer.willRenew) return null;
  if (input.dismissedDay === input.today) return null;
  const expiresAt = customer.expiresAt ? Date.parse(customer.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now || expiresAt - input.now > TRIAL_ENDING_WINDOW_MS) return null;
  return { expiresAt: customer.expiresAt as string };
}

/** Meals saved since the trial started (savedAt, falling back to the meal date). */
export function mealsSince(meals: readonly { savedAt?: string; date?: string }[], startedAt: string | null | undefined) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return 0;
  return meals.filter(meal => {
    const at = Date.parse(meal.savedAt ?? meal.date ?? '');
    return Number.isFinite(at) && at >= start;
  }).length;
}

type PlanLike = { id: PlanId; price: string; priceAmount: number; package: { product: { identifier: string; priceString: string; pricePerMonthString?: string | null; discounts?: PurchasesStoreProductDiscount[] | null } } };
type Plans = Record<PlanId, PlanLike | null>;

export function currentPlanId(customer: SubscriptionCustomer | null | undefined, plans: Plans): PlanId | null {
  if (!customer?.productId) return null;
  for (const id of ['yearly', 'monthly'] as const) {
    if (plans[id]?.package.product.identifier === customer.productId) return id;
  }
  return null;
}

export type ManageModel = {
  planId: PlanId | null;
  /** Monthly subscriber and the store offers an annual package. */
  annualSwitch: { perMonth: string; monthlyPrice: string; yearlyPrice: string } | null;
  /** Discounts configured on the current product in App Store Connect. */
  promoDiscounts: PurchasesStoreProductDiscount[];
  /** Always true: the cancel action is never conditional. */
  cancelAvailable: true;
};

export function manageModel(customer: SubscriptionCustomer | null | undefined, plans: Plans, formatPerMonth?: (amount: number) => string | null): ManageModel {
  const planId = currentPlanId(customer, plans);
  const yearly = plans.yearly;
  const monthly = plans.monthly;
  const perMonth = yearly
    ? yearly.package.product.pricePerMonthString ?? formatPerMonth?.(yearly.priceAmount / 12) ?? null
    : null;
  const annualSwitch = planId === 'monthly' && yearly && monthly && perMonth
    ? { perMonth, monthlyPrice: monthly.package.product.priceString, yearlyPrice: yearly.package.product.priceString }
    : null;
  const current = planId ? plans[planId] : null;
  const promoDiscounts = (current?.package.product.discounts ?? []).filter(discount => Boolean(discount?.identifier && discount.priceString));
  return { planId, annualSwitch, promoDiscounts, cancelAvailable: true };
}

/** Win-back is offered only to lapsed Pro customers on iOS 18 or later. */
export function winBackSupported(platformOs: string, platformVersion: string | number | undefined) {
  if (platformOs !== 'ios') return false;
  const major = Number.parseInt(String(platformVersion ?? ''), 10);
  return Number.isFinite(major) && major >= 18;
}

export function winBackApplies(customer: SubscriptionCustomer | null | undefined, platformOs: string, platformVersion: string | number | undefined) {
  return Boolean(customer?.lapsed) && winBackSupported(platformOs, platformVersion);
}

const UNITS = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' } as const;
type Unit = typeof UNITS[keyof typeof UNITS];
const unitOf = (value: string | null | undefined): Unit | null => UNITS[String(value ?? '').toUpperCase() as keyof typeof UNITS] ?? null;

/**
 * Human terms of a StoreKit discount (promotional or win-back offer), built
 * only from the store's own price string, unit and cycles. Null when the
 * store data is incomplete: no offer copy is ever guessed.
 */
export function offerTerms(discount: PurchasesStoreProductDiscount | null | undefined, t: Dictionary): string | null {
  if (!discount || typeof discount.priceString !== 'string' || !discount.priceString) return null;
  const unit = unitOf(discount.periodUnit);
  const units = discount.periodNumberOfUnits;
  const cycles = discount.cycles;
  if (!unit || !Number.isInteger(units) || units < 1 || !Number.isInteger(cycles) || cycles < 1) return null;
  const duration = t.billing.trialPeriod(units * cycles, unit);
  if (discount.price === 0) return t.retention.offerFree(duration);
  if (cycles === 1) return t.retention.offerOnce(duration, discount.priceString);
  if (units === 1) return t.retention.offerPerPeriod(discount.priceString, unit, duration);
  return t.retention.offerRepeated(cycles, t.billing.trialPeriod(units, unit), discount.priceString);
}

/** "50 % off" only when the discount covers whole billing periods of the same length. */
export function offerPercent(discount: PurchasesStoreProductDiscount | null | undefined, planId: PlanId | null, regularAmount: number | null | undefined) {
  if (!discount || !planId || !regularAmount || !(regularAmount > 0) || !(discount.price > 0)) return null;
  const unit = unitOf(discount.periodUnit);
  const samePeriod = discount.periodNumberOfUnits === 1 && unit === (planId === 'yearly' ? 'year' : 'month');
  if (!samePeriod) return null;
  const percent = Math.round((1 - discount.price / regularAmount) * 100);
  return percent >= 5 && percent < 100 ? percent : null;
}

export const CANCEL_REASONS = ['too_expensive', 'not_using', 'ai_inaccurate', 'other'] as const;
export type CancelReason = typeof CANCEL_REASONS[number];
