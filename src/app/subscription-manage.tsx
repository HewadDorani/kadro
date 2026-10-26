import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesStoreProductDiscount } from 'react-native-purchases';

import { KandroMark } from '@/components/KandroMark';
import { Card, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { markPurchaseStep } from '@/services/paywallExposure';
import { manageModel, offerPercent, offerTerms } from '@/services/retention';
import { loadPromotionalDiscount, openSubscriptionManagement } from '@/services/subscription';
import { toBillingMode, trackEvent } from '@/services/telemetry';
import { formatDateParts } from '@/utils/format';

/**
 * In-app "Abo verwalten" (1.0.6). Shows the plan, its status and next date,
 * then at most two real store options. The way out is a fixed footer button,
 * outside the scroll view and never conditional: it opens Apple's own
 * subscription management, where cancelling is one tap. Apple's cancel flow
 * in Settings is untouched (App Review guideline 3.1.2 / 5.6).
 */
export default function SubscriptionManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const { busy, error, purchase, purchaseOffer, refresh, snapshot, status } = useSubscription();
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
  const planLabel = model.planId === 'yearly' ? t.retention.planYearly : model.planId === 'monthly' ? t.retention.planMonthly : null;
  const planLine = [planLabel, currentPlan?.price].filter(Boolean).join(' · ');
  const annual = offersAllowed ? model.annualSwitch : null;
  const promoTerms = offersAllowed && promo ? offerTerms(promo, t) : null;
  const promoPercent = promo ? offerPercent(promo, model.planId, currentPlan?.priceAmount) : null;
  const promoDuration = promo ? t.billing.trialPeriod(promo.periodNumberOfUnits * promo.cycles, unitName(promo.periodUnit)) : '';
  const showOffers = Boolean(annual || promoTerms);
  const cancelled = customer?.willRenew === false && status === 'active';
  const trial = customer?.periodType === 'TRIAL';
  const badge = status !== 'active' ? null : cancelled ? t.retention.statusCancelled : trial ? t.retention.statusTrial : t.retention.statusActive;
  // Already cancelled (no renewal): the same button, worded for what is left to do.
  const exitLabel = cancelled ? t.retention.manageAtApple : trial ? t.retention.cancelTrial : t.retention.cancelSubscription;
  const close = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile');

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

  return <Screen scroll={false}>
    <View style={styles.topBar}>
      <Pressable accessibilityLabel={t.common.close} accessibilityRole="button" hitSlop={8} onPress={close} style={styles.iconButton}>
        <Ionicons color={colors.text} name="close" size={22} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.topTitle}>{t.retention.manageTitle}</Text>
      <View style={styles.iconSpacer} />
    </View>

    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card style={styles.planCard}>
        <View style={styles.planRow}>
          <KandroMark size={40} />
          <View style={styles.planCopy}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>{t.retention.planUnknown}</Text>
              {badge ? <View style={styles.badge}>
                <View style={[styles.badgeDot, cancelled && styles.badgeDotOff]} />
                <Text style={styles.badgeText}>{badge}</Text>
              </View> : null}
            </View>
            {planLine ? <Text style={styles.muted}>{planLine}</Text> : null}
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.dateRow}>
          <Ionicons color={colors.muted} name="calendar-outline" size={18} />
          <Text style={styles.body}>{status === 'loading' ? t.retention.loading : renewal}</Text>
        </View>
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>

    {/* Never conditional, never disabled: cancelling stays one tap away. */}
    <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      <PrimaryButton label={exitLabel} onPress={() => void openSubscriptionManagement()} variant="secondary" />
      <View style={styles.noteRow}>
        {cancelled ? null : <Ionicons color={colors.muted} name="open-outline" size={14} />}
        <Text style={styles.note}>{cancelled ? t.retention.cancelledNote : t.retention.cancelNote}</Text>
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  iconSpacer: { width: 42, height: 42 },
  topTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  content: { gap: 14, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  planCard: { gap: 14, padding: 18 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planCopy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accentText },
  badgeDotOff: { backgroundColor: colors.muted },
  badgeText: { ...typeScale.footnote, color: colors.text, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  card: { gap: 8, padding: 16 },
  cardTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  body: { ...typeScale.callout, color: colors.text, flexShrink: 1 },
  muted: { ...typeScale.subhead, color: colors.muted },
  section: { gap: 10, marginTop: 6 },
  sectionTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  error: { ...typeScale.subhead, color: colors.attentionText },
  footer: { gap: 8, paddingTop: 12, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  note: { ...typeScale.caption, color: colors.muted, textAlign: 'center', flexShrink: 1 },
});
