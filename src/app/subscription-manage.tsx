import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesStoreProductDiscount } from 'react-native-purchases';

import { Card, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { markPurchaseStep } from '@/services/paywallExposure';
import { CANCEL_REASONS, CancelReason, manageModel, offerPercent, offerTerms } from '@/services/retention';
import { loadPromotionalDiscount, openSubscriptionManagement } from '@/services/subscription';
import { toBillingMode, trackEvent } from '@/services/telemetry';
import { formatDateParts } from '@/utils/format';

/**
 * In-app "Abo verwalten" (1.0.6). Shows the plan and its next date, then at
 * most two real store options before leaving. The way out is a fixed footer
 * button, outside the scroll view and never conditional: it opens Apple's
 * own subscription management, where cancelling is one tap. Apple's cancel
 * flow in Settings is untouched (App Review guideline 3.1.2 / 5.6).
 */
export default function SubscriptionManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const { busy, error, purchase, purchaseOffer, refresh, snapshot, status } = useSubscription();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [promo, setPromo] = useState<PurchasesStoreProductDiscount | null>(null);
  const billingMode = toBillingMode(snapshot?.mode);
  const offersAllowed = status === 'active' && snapshot?.mode === 'native-store';
  const customer = snapshot?.customer ?? null;
  const plans = snapshot?.plans ?? { yearly: null, monthly: null };
  const model = manageModel(customer, plans, amount => formatCurrency(amount, plans.yearly?.package.product.currencyCode, locale));
  const currentPlan = model.planId ? plans[model.planId] : null;
  const promoKey = model.promoDiscounts.map(discount => discount.identifier).join('|');

  useEffect(() => { void refresh(); }, [refresh]);
  // Only a promotional offer RevenueCat can sign for this customer is shown.
  useEffect(() => {
    setPromo(null);
    if (!offersAllowed || !currentPlan || !model.promoDiscounts.length) return;
    let alive = true;
    void loadPromotionalDiscount(currentPlan, model.promoDiscounts).then(found => { if (alive) setPromo(found); }).catch(() => undefined);
    return () => { alive = false; };
  }, [offersAllowed, currentPlan?.package.product.identifier, promoKey]);

  const date = customer?.expiresAt ? formatDateParts(new Date(customer.expiresAt), { day: 'numeric', month: 'long', year: 'numeric' }, locale) : '';
  const renewal = !date ? t.retention.dateAtApple
    : customer?.periodType === 'TRIAL' && customer.willRenew ? t.retention.trialUntil(date)
      : customer?.willRenew ? t.retention.renewsOn(date) : t.retention.endsOn(date);
  const planLabel = model.planId === 'yearly' ? t.retention.planYearly : model.planId === 'monthly' ? t.retention.planMonthly : t.retention.planUnknown;
  const annual = offersAllowed ? model.annualSwitch : null;
  const promoTerms = offersAllowed && promo ? offerTerms(promo, t) : null;
  const promoPercent = promo ? offerPercent(promo, model.planId, currentPlan?.priceAmount) : null;
  const promoDuration = promo ? t.billing.trialPeriod(promo.periodNumberOfUnits * promo.cycles, unitName(promo.periodUnit)) : '';
  const showOffers = Boolean(annual || promoTerms);
  // Already cancelled (no renewal): the same button, worded for what is left to do.
  const exitLabel = customer?.willRenew === false && status === 'active' ? t.retention.manageAtApple : t.retention.cancelAnyway;

  const finish = (result: Awaited<ReturnType<typeof purchase>>, offer: 'annual_switch' | 'promotional') => {
    trackEvent('subscription offer purchase ended', { billing_mode: billingMode, offer, outcome: result });
    markPurchaseStep(result, 'retention_offer');
    if (result === 'active') Alert.alert(t.retention.offerDoneTitle, t.retention.offerDoneBody, [{ text: t.paywall.continueLabel }]);
  };
  const switchToAnnual = async () => {
    if (busy || !annual) return;
    markPurchaseStep('started', 'retention_offer');
    // A normal purchase of the annual package; StoreKit handles the crossgrade.
    finish(await purchase('yearly'), 'annual_switch');
  };
  const redeemPromo = async () => {
    if (busy || !promo || !model.planId) return;
    markPurchaseStep('started', 'retention_offer');
    finish(await purchaseOffer({ kind: 'retention', planId: model.planId, discount: promo }), 'promotional');
  };
  const chooseReason = (next: CancelReason) => {
    setReason(next);
    // Optional analytics only (consent + adult); never blocks or delays cancelling.
    trackEvent('subscription cancel reason', { reason: next });
  };

  return <Screen scroll={false}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <PrimaryButton variant="ghost" label={t.common.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')} />
      <Text accessibilityRole="header" style={styles.title}>{t.retention.manageTitle}</Text>
      <Text style={styles.muted}>{t.retention.manageSubtitle}</Text>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{planLabel}</Text>
        {currentPlan ? <Text style={styles.body}>{currentPlan.price}</Text> : null}
        <Text style={styles.muted}>{status === 'loading' ? t.retention.loading : renewal}</Text>
        {customer?.billingIssueDetectedAt && status === 'active' ? <Text style={styles.body}>{t.retention.bannerText}</Text> : null}
      </Card>

      {showOffers ? <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t.retention.beforeYouGo}</Text>
        <Text style={styles.muted}>{t.retention.beforeYouGoText}</Text>
        {annual ? <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t.retention.annualTitle}</Text>
          <Text style={styles.body}>{t.retention.annualText(annual.perMonth, annual.monthlyPrice)}</Text>
          <Text style={styles.muted}>{t.retention.annualBilling(annual.yearlyPrice)}</Text>
          <PrimaryButton disabled={busy} label={t.retention.annualAction} onPress={() => void switchToAnnual()} variant="secondary" />
        </Card> : null}
        {promoTerms && currentPlan ? <Card style={styles.card}>
          <Text style={styles.cardTitle}>{promoPercent ? t.retention.promoPercent(promoDuration, promoPercent) : t.retention.promoTitle}</Text>
          <Text style={styles.muted}>{t.retention.offerThen(promoTerms, currentPlan.price)}</Text>
          <PrimaryButton disabled={busy} label={t.retention.promoAction} onPress={() => void redeemPromo()} variant="secondary" />
        </Card> : null}
      </View> : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t.retention.reasonTitle}</Text>
        <View accessibilityRole="radiogroup" style={styles.reasons}>
          {CANCEL_REASONS.map(option => <Pressable aria-checked={reason === option} accessibilityRole="radio" accessibilityState={{ checked: reason === option }} key={option} onPress={() => chooseReason(option)} style={[styles.reason, reason === option && styles.reasonActive]}>
            <Text style={[styles.reasonText, reason === option && styles.reasonTextActive]}>{t.retention.reasons[option]}</Text>
          </Pressable>)}
        </View>
        {reason ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{t.retention.reasonThanks}</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>

    {/* Never conditional, never disabled: cancelling stays one tap away. */}
    <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      <PrimaryButton label={exitLabel} onPress={() => void openSubscriptionManagement()} variant="secondary" />
      <View style={styles.noteRow}>
        <Ionicons color={colors.muted} name="open-outline" size={14} />
        <Text style={styles.note}>{t.retention.cancelNote}</Text>
      </View>
    </View>
  </Screen>;
}

function unitName(value: string): 'day' | 'week' | 'month' | 'year' {
  const unit = value?.toUpperCase();
  return unit === 'DAY' ? 'day' : unit === 'WEEK' ? 'week' : unit === 'YEAR' ? 'year' : 'month';
}

function formatCurrency(amount: number, currency: string | undefined, locale: string) {
  if (!currency || !Number.isFinite(amount)) return null;
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount); }
  catch { return null; }
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { gap: 14, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  title: { ...typeScale.title1, color: colors.text, fontWeight: '700' },
  card: { gap: 8, padding: 16 },
  cardTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  body: { ...typeScale.callout, color: colors.text },
  muted: { ...typeScale.subhead, color: colors.muted },
  section: { gap: 10, marginTop: 6 },
  sectionTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  sectionLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reasonActive: { borderColor: colors.text, backgroundColor: colors.text },
  reasonText: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  reasonTextActive: { color: colors.surface },
  error: { ...typeScale.subhead, color: colors.attentionText },
  footer: { gap: 8, paddingTop: 10, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  note: { ...typeScale.caption, color: colors.muted, textAlign: 'center', flexShrink: 1 },
});
