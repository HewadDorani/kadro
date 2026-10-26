import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { PurchasesStoreProductDiscount } from 'react-native-purchases';

import { PrimaryButton } from '@/components/ui';
import { typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useLanguage } from '@/i18n/LanguageProvider';
import { markPaywallShown, markPurchaseStep } from '@/services/paywallExposure';
import { cancelledTrialEnding, manageModel, mealsSince, offerPercent, offerTerms } from '@/services/retention';
import { loadPromotionalDiscount, openSubscriptionManagement } from '@/services/subscription';
import { localDateKey } from '@/utils/date';
import { formatDateParts } from '@/utils/format';

const DISMISSED_KEY = '@kandro/trial-ending-dismissed:v1';

/**
 * The trial was turned off at Apple and ends within two days. One calm card:
 * when it ends, what was logged so far, and the ways to keep going (a real
 * StoreKit promotional offer when RevenueCat can sign one, otherwise Apple's
 * own subscription page). Hidden for the rest of the day when dismissed.
 */
export function TrialEndingCard() {
  const { colors } = useTheme();
  const { t, locale } = useLanguage();
  const { mealHistory } = useApp();
  const { busy, purchaseOffer, snapshot, status } = useSubscription();
  const today = useLocalDay();
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [promo, setPromo] = useState<PurchasesStoreProductDiscount | null>(null);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(DISMISSED_KEY).catch(() => null).then(value => { if (active) { setDismissedDay(value); setLoaded(true); } });
    return () => { active = false; };
  }, []);

  const ending = loaded && snapshot?.mode === 'native-store'
    ? cancelledTrialEnding({ status, customer: snapshot.customer, now: Date.now(), dismissedDay, today })
    : null;
  const plans = snapshot?.plans ?? { yearly: null, monthly: null };
  const model = manageModel(snapshot?.customer, plans);
  const currentPlan = model.planId ? plans[model.planId] : null;
  const promoKey = model.promoDiscounts.map(discount => discount.identifier).join('|');

  useEffect(() => { if (ending) markPaywallShown('trial_ending'); }, [Boolean(ending)]);
  // Only an offer RevenueCat can sign for this customer is shown.
  useEffect(() => {
    setPromo(null);
    if (!ending || !currentPlan || !model.promoDiscounts.length) return;
    let alive = true;
    void loadPromotionalDiscount(currentPlan, model.promoDiscounts).then(found => { if (alive) setPromo(found); }).catch(() => undefined);
    return () => { alive = false; };
  }, [Boolean(ending), currentPlan?.package.product.identifier, promoKey]);

  if (!ending) return null;
  const endsDay = localDateKey(new Date(ending.expiresAt));
  const tomorrow = localDateKey(new Date(Date.now() + 86_400_000));
  const title = endsDay === today ? t.retention.trialEndingToday
    : endsDay === tomorrow ? t.retention.trialEndingTomorrow
      : t.retention.trialEndingOn(formatDateParts(new Date(ending.expiresAt), { weekday: 'long', day: 'numeric', month: 'long' }, locale));
  const logged = mealsSince(mealHistory ?? [], snapshot?.currentTrial?.startedAt);
  const terms = promo ? offerTerms(promo, t) : null;
  const percent = promo ? offerPercent(promo, model.planId, currentPlan?.priceAmount) : null;
  const duration = promo ? t.billing.trialPeriod(promo.periodNumberOfUnits * promo.cycles, unitName(promo.periodUnit)) : '';

  const dismiss = () => {
    setDismissedDay(today);
    void AsyncStorage.setItem(DISMISSED_KEY, today).catch(() => undefined);
  };
  const keep = () => {
    markPaywallShown('trial_keep');
    void openSubscriptionManagement();
  };
  const redeem = async () => {
    if (busy || !promo || !model.planId) return;
    markPurchaseStep('started', 'trial_offer');
    const result = await purchaseOffer({ kind: 'retention', planId: model.planId, discount: promo });
    markPurchaseStep(result, 'trial_offer');
    if (result === 'active') Alert.alert(t.retention.offerDoneTitle, t.retention.offerDoneBody, [{ text: t.paywall.continueLabel }]);
  };

  return <View accessibilityLiveRegion="polite" style={{ padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Ionicons color={colors.muted} name="hourglass-outline" size={20} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text accessibilityRole="header" style={{ ...typeScale.headline, color: colors.text }}>{title}</Text>
        <Text style={{ ...typeScale.subhead, color: colors.muted }}>{logged > 0 ? t.retention.trialEndingMeals(logged) : t.retention.trialEndingNoMeals}</Text>
      </View>
      <Pressable accessibilityLabel={t.retention.bannerDismiss} accessibilityRole="button" hitSlop={12} onPress={dismiss} style={{ minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons color={colors.muted} name="close" size={18} />
      </Pressable>
    </View>
    {terms && currentPlan ? <View style={{ gap: 4 }}>
      <Text style={{ ...typeScale.subhead, color: colors.text, fontWeight: '700' }}>{percent ? t.retention.trialEndingOffer(t.retention.promoPercent(duration, percent)) : t.retention.promoTitle}</Text>
      <Text style={{ ...typeScale.footnote, color: colors.muted }}>{t.retention.offerThen(terms, currentPlan.price)}</Text>
    </View> : null}
    {terms ? <PrimaryButton disabled={busy} label={t.retention.promoAction} onPress={() => void redeem()} /> : null}
    <PrimaryButton disabled={busy} label={t.retention.trialEndingKeep} onPress={keep} variant={terms ? 'ghost' : 'secondary'} />
  </View>;
}

function unitName(unit: string | null | undefined): 'day' | 'week' | 'month' | 'year' {
  const value = String(unit ?? '').toUpperCase();
  return value === 'DAY' ? 'day' : value === 'WEEK' ? 'week' : value === 'YEAR' ? 'year' : 'month';
}
