import { usePresentationBlock } from '@/services/presentation';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui';
import { KandroMark } from '@/components/KandroMark';
import { radii, typeScale } from '@/constants/theme';
import { FREE_SCAN_ALLOWANCE } from '@/constants/product';
import { useAccess } from '@/context/AccessContext';
import { useApp } from '@/context/AppContext';
import { takeAccessDestination } from '@/services/accessPolicy';
import { useSubscription } from '@/context/SubscriptionContext';
import { useFirstRun } from '@/hooks/useFirstRun';
import { useLanguage } from '@/i18n/LanguageProvider';
import { finishFirstRunOffer } from '@/services/firstRun';
import { successHaptic } from '@/services/haptics';
import { TRIAL_REMINDER_LEAD_DAYS, getReminderPermission, requestReminderPermission, type ReminderPermission } from '@/services/reminders';
import { toBillingMode, trackEvent } from '@/services/telemetry';
import { markPaywallShown } from '@/services/paywallExposure';

/** The close button arrives after a short, calm moment; only an enforced lock (hard wall, old B) without usable access has none. */
const CLOSE_DELAY_MS = 2500;

type Plan = 'yearly' | 'monthly';

export default function PaywallScreen() {
  usePresentationBlock(true);
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Enlarged text scrolls everything; normal text keeps the purchase button
  // in view instead of below the fold.
  const largeText = fontScale > 1.15;
  const access = useAccess();
  const { freeScansLeft } = useApp();
  const hard = access.record.hard;
  // New installs (hard wall): after the first saved meal or "Später" the
  // record is hard until an entitlement (a running trial counts) is active.
  const hardWall = access.hardWall;
  // Soft for everyone else: only an enforced lock (hard wall, old B cohort)
  // without usable access keeps the screen without a close button.
  const closable = !hard || access.canUse;
  // Interrupted mid-scan after the free analyses: say why the paywall appears.
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const blocked = reason === 'blocked' && !hard && !hardWall;
  const { t, locale } = useLanguage();
  const [selected, setSelected] = useState<Plan>('yearly');
  const [cancelled, setCancelled] = useState(false);
  const planChosen = useRef(false);
  const { busy, error, purchase, refresh, restore, snapshot, status, syncTrialReminder } = useSubscription();
  const yearly = snapshot?.plans.yearly ?? null;
  const monthly = snapshot?.plans.monthly ?? null;
  const selectedPlan = snapshot?.plans[selected] ?? null;
  const testStore = snapshot?.mode === 'test-store';
  const billingMode = toBillingMode(snapshot?.mode);
  const paywallViewed = useRef(false);
  // Shown once in the first run (after the first meal or "Später"); viewing
  // it hands over to the optional reminder question.
  const firstRunStage = useFirstRun();
  useEffect(() => {
    if (firstRunStage === 'scan' || firstRunStage === 'paywall') void finishFirstRunOffer();
  }, [firstRunStage]);
  const closeOpacity = useRef(new Animated.Value(0)).current;
  const [closeVisible, setCloseVisible] = useState(false);
  useEffect(() => {
    if (!closable) return;
    const timer = setTimeout(() => {
      setCloseVisible(true);
      Animated.timing(closeOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    }, CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [closable, closeOpacity]);
  // "We remind you" is only promised when a reminder can actually arrive.
  const [notifications, setNotifications] = useState<ReminderPermission | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    void getReminderPermission().then(value => { if (active) setNotifications(value); });
    return () => { active = false; };
  }, []));
  const remindersAllowed = notifications === 'authorized' || notifications === 'quiet';
  const allowReminders = async () => {
    if (notifications === 'denied') { await Linking.openSettings().catch(() => undefined); return; }
    setNotifications(await requestReminderPermission());
  };

  const resume = async () => { await access.refresh(); router.replace(takeAccessDestination() as never); };
  useFocusEffect(useCallback(() => {
    if (status !== 'loading' && access.ready && !paywallViewed.current) {
      paywallViewed.current = true;
      markPaywallShown(blocked ? 'blocked' : hard ? 'hard' : access.entryPaywall ? 'entry' : 'manual');
      void access.markSeen();
      trackEvent('paywall viewed', { billing_mode: billingMode });
      if (access.record.source !== 'qa' && ['A', 'B'].includes(access.record.variant)) {
        trackEvent('access paywall shown', { experiment: 'paywall_access_v1', variant: access.record.variant as 'A' | 'B', environment: 'production', cohort_source: 'public', access_version: 'v1' });
      }
    }
    const back = BackHandler.addEventListener('hardwareBackPress', () => !closable);
    return () => back.remove();
  }, [access.ready, access.record.variant, access.record.source, billingMode, status, closable]));

  useEffect(() => {
    if (!snapshot?.configured) return;
    // Annual is preselected whenever the store offers it; its card states the
    // real yearly price, the monthly equivalent and any trial. Refreshes must
    // not overwrite a plan the customer deliberately selected.
    if (!planChosen.current) {
      setSelected(yearly ? 'yearly' : 'monthly');
    } else if (!selectedPlan) {
      setSelected(monthly ? 'monthly' : 'yearly');
    }
  }, [monthly, selectedPlan, snapshot?.configured, snapshot?.mode, yearly]);
  const choosePlan = (next: Plan) => { planChosen.current = true; setSelected(next); setCancelled(false); };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = async () => {
    if (status === 'active') {
      await resume();
      return;
    }
    if (!selectedPlan || status === 'unconfigured' || status === 'error' || status === 'pending' || access.state === 'verification') {
      await refresh(); await access.refresh();
      return;
    }
    if (busy) return;
    setCancelled(false);
    trackEvent('subscription purchase started', { billing_mode: billingMode, plan: selected });
    const result = await purchase(selected);
    trackEvent('subscription purchase ended', { billing_mode: billingMode, plan: selected, outcome: result });
    if (result === 'cancelled') { setCancelled(true); return; }
    if (result !== 'active') return;
    trackEvent('subscription purchase completed', { billing_mode: billingMode, plan: selected, purchase_kind: selectedPlan?.hasFreeTrial ? 'trial' : 'paid' });
    void successHaptic();
    // Schedule from the purchased entitlement; a declined notification prompt
    // or accelerated sandbox trial cannot be presented as a scheduled reminder.
    const reminded = testStore ? true : await syncTrialReminder();
    Alert.alert(
      testStore ? t.paywall.activatedTest : t.paywall.activated,
      testStore ? t.paywall.activatedTestBody : (!trialTimeline || reminded) ? t.paywall.activatedBody : `${t.paywall.activatedBody}\n\n${t.paywall.trialReminderOff}`,
      [{ text: t.paywall.continueLabel, onPress: () => { void resume(); } }],
    );
  };

  const restorePurchase = async () => {
    if (status === 'unconfigured') {
      Alert.alert(t.paywall.notLinkedTitle, t.paywall.notLinkedBody);
      return;
    }
    if (busy) return;
    trackEvent('subscription restore started', { billing_mode: billingMode });
    const result = await restore();
    trackEvent('subscription restore ended', { billing_mode: billingMode, outcome: result });
    if (result !== 'active' && result !== 'none') return;
    const active = result === 'active';
    trackEvent('subscription restore completed', { active, billing_mode: billingMode });
    Alert.alert(
      active ? t.paywall.restoredTitle : t.paywall.noPurchaseTitle,
      active ? t.paywall.restoredBody : t.paywall.noPurchaseBody,
      active ? [{ text: t.paywall.continueLabel, onPress: () => { void resume(); } }] : undefined,
    );
  };

  // A real StoreKit trial (eligibility checked) gets a plain timeline: what
  // happens today, when we remind, when billing starts. No pressure framing.
  const trialTimeline = Boolean(status !== 'active' && !testStore && selectedPlan?.hasFreeTrial
    && selectedPlan.trialDays && selectedPlan.trialDays > TRIAL_REMINDER_LEAD_DAYS);
  // The yearly card names its monthly equivalent from the store's own price.
  const yearlyProduct = yearly?.package.product;
  const yearlyPerMonth = yearlyProduct?.pricePerMonthString
    ?? (yearly?.monthlyEquivalent && yearlyProduct?.currencyCode ? formatCurrency(yearly.monthlyEquivalent, yearlyProduct.currencyCode, locale) : null);
  const yearlyDetail = [
    yearlyPerMonth ? t.paywall.perMonthShort(yearlyPerMonth) : null,
    yearly?.trialLabel ? t.paywall.trialFree(yearly.trialLabel) : null,
  ].filter(Boolean).join(' · ') || (yearly?.detail ?? t.paywall.yearlyFallback);

  // Hard wall copy states the real store price (never hard-coded) and the
  // trial only when the store confirmed it for this plan.
  const hardWallOffer = hardWall && status !== 'active' && !testStore && selectedPlan ? {
    trialDays: selectedPlan.hasFreeTrial ? selectedPlan.trialDays : null,
    charge: selected === 'yearly'
      ? t.paywall.chargeYearly(selectedPlan.package.product.priceString, yearlyPerMonth)
      : t.paywall.chargeMonthly(selectedPlan.package.product.priceString),
  } : null;
  const title = blocked ? t.paywall.blockedHeadline(FREE_SCAN_ALLOWANCE)
    : hardWallOffer ? hardWallOffer.trialDays ? t.paywall.hardWallTitleTrial(hardWallOffer.trialDays) : t.paywall.hardWallTitle
      : hardWall ? t.paywall.hardWallTitle
      : hard ? t.paywall.hardTitle : t.paywall.headline;
  const subtitle = blocked ? t.paywall.blockedSub
    : hardWallOffer ? hardWallOffer.trialDays ? t.paywall.hardWallSubTrial(hardWallOffer.charge) : t.paywall.hardWallSub(hardWallOffer.charge)
      : hardWall ? t.paywall.subtitle
      : hard ? t.paywall.hardSubtitle : t.paywall.subtitle;

  const buttonLabel = busy
    ? t.paywall.ctaProcessing
    : status === 'loading'
      ? t.paywall.ctaLoading
      : status === 'active'
        ? t.paywall.ctaActive
        : status === 'unconfigured'
          ? t.paywall.ctaReload
          : (!selectedPlan || status === 'error' || status === 'pending' || access.state === 'verification')
            ? t.paywall.ctaReload
            : testStore
              ? t.paywall.ctaTest
              : selectedPlan?.hasFreeTrial
                ? hardWall && selectedPlan.trialDays ? t.paywall.hardWallTrialCta(selectedPlan.trialDays)
                  : selectedPlan.trialDays === 7 ? t.access.trialCTA : t.paywall.ctaTrial
                : t.paywall.ctaStart;

  const billingCopy = status === 'active'
    ? t.paywall.billingActive
    : status === 'unconfigured'
      ? t.paywall.billingPreview
      : selectedPlan
        ? selectedPlan.trialDays === 7 && selectedPlan.hasFreeTrial && !testStore
          ? t.access.trialThen(selectedPlan.price)
          : `${selectedPlan.billing}${testStore ? t.paywall.testStoreNote : ''}`
        : t.paywall.billingMissing;

  // App Store Review guideline 3.1.2 requires length, price and the renewal
  // terms to be visible before the purchase, not only in the store listing.
  // A missing renewal notice is one of the most common rejection reasons.
  const savingPercent = yearly?.monthlyEquivalent && monthly?.priceAmount
    ? Math.round((1 - yearly.monthlyEquivalent / monthly.priceAmount) * 100)
    : null;
  const yearlyBadge = savingPercent && savingPercent >= 5 ? t.paywall.cheaper(savingPercent) : undefined;

  const renewalCopy = selected === 'yearly'
    ? t.paywall.renewalYear
    : t.paywall.renewalMonth;

  // Enlarged text must not let fixed purchase terms consume the whole screen.
  // Keep every plan, action and legal link in the same scrollable flow then.
  const renewalTerms = status !== 'active' ? (
    <Text style={styles.renewal}>
      {renewalCopy} {t.paywall.renewalTail} {t.paywall.fairUse}
    </Text>
  ) : null;
  const purchaseControls = (
    <View style={[styles.footer, largeText && styles.scrollingFooter, { paddingBottom: insets.bottom + 10 }]}>
      <PrimaryButton
        disabled={busy || status === 'loading'}
        icon={status === 'active' ? 'checkmark-circle-outline' : 'arrow-forward'}
        label={buttonLabel}
        onPress={() => void subscribe()}
      />
      {trialTimeline ? <Text style={styles.dueToday}>{t.paywall.dueToday}</Text> : null}
      <Text style={styles.billing}>{billingCopy}</Text>
      {largeText ? renewalTerms : null}
      <View style={styles.legalRow}>
        <Pressable accessibilityRole="link" onPress={() => router.push('/terms')}><Text style={styles.legal}>{t.paywall.terms}</Text></Pressable>
        <View style={styles.legalDot} />
        <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}><Text style={styles.legal}>{t.paywall.privacy}</Text></Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView key={fontScale} edges={['top', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ gestureEnabled: closable, presentation: closable ? 'modal' : 'card' }} />
      <View style={styles.topBar}>
        {closable ? <Animated.View pointerEvents={closeVisible ? 'auto' : 'none'} style={{ opacity: closeOpacity }}>
          <Pressable accessibilityElementsHidden={!closeVisible} accessibilityLabel={t.paywall.close} accessibilityRole="button" disabled={!closeVisible} hitSlop={8} importantForAccessibility={closeVisible ? 'auto' : 'no-hide-descendants'} onPress={() => { void resume(); }} style={styles.closeButton}>
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
        </Animated.View> : <KandroMark size={28} />}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || status === 'loading' }} disabled={busy || status === 'loading'} onPress={() => void restorePurchase()} style={styles.restoreButton}>
          <Text style={[styles.restore, (busy || status === 'loading') && styles.disabledText]}>{t.paywall.restore}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        {/* One headline for every non-blocked entry: no weight promise, no
            per-user override that would split the measured offer. */}
        <View style={styles.heroMark}><KandroMark size={32} /></View>
        {testStore ? <View style={styles.testBadge}><Text style={styles.testBadgeText}>{t.paywall.testStoreBadge}</Text></View> : null}
        <Text style={styles.eyebrow}>{t.paywall.eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.benefits}>
          <Benefit icon="camera-outline" title={t.paywall.benefitAnalyze} />
          <Benefit icon="restaurant-outline" title={t.paywall.benefitMeals} />
          <Benefit icon="calendar-outline" title={t.paywall.benefitReview} />
        </View>
        <Text style={styles.benefitDetail}>{t.paywall.fairUse}</Text>

        {/* The free scope card belongs to the legacy scope only. */}
        {!hard && !hardWall ? <View style={styles.keepsCard}>
          <Ionicons color={colors.accentText} name="lock-open-outline" size={17} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.benefitTitle}>{t.paywall.freeTitle}</Text>
            <Text style={styles.keepsText}>{t.paywall.keeps}</Text>
            <Text style={styles.keepsText}>{t.paywall.freeAnalysesLeft(freeScansLeft, FREE_SCAN_ALLOWANCE)}</Text>
          </View>
        </View> : null}

        <View accessibilityRole="radiogroup" style={styles.plans}>
          <PlanCard
            badge={yearlyBadge}
            detail={yearlyDetail}
            disabled={!yearly}
            label={t.paywall.yearly}
            onPress={() => choosePlan('yearly')}
            price={yearly?.price ?? t.paywall.unavailable}
            selected={selected === 'yearly'}
          />
          <PlanCard
            detail={monthly?.trialLabel ? t.paywall.trialFirst(monthly.trialLabel) : (monthly?.detail ?? t.paywall.monthlyFallback)}
            disabled={!monthly}
            label={t.paywall.monthly}
            onPress={() => choosePlan('monthly')}
            price={monthly?.price ?? t.paywall.unavailable}
            selected={selected === 'monthly'}
          />
        </View>
        {trialTimeline && selectedPlan ? <View style={styles.timeline}>
          <TimelineStep detail={t.paywall.timelineTodayDetail} icon="lock-open-outline" title={t.paywall.timelineToday} />
          {remindersAllowed
            ? <TimelineStep detail={t.paywall.timelineReminderDetail} icon="notifications-outline" title={t.paywall.timelineDay(selectedPlan.trialDays! - TRIAL_REMINDER_LEAD_DAYS)} />
            : <TimelineStep
              action={notifications === 'notDetermined' || notifications === 'denied' ? { label: t.paywall.allowReminder, onPress: () => void allowReminders() } : undefined}
              detail={t.paywall.timelineCancelTip}
              icon="information-circle-outline"
              title={t.paywall.timelineDay(selectedPlan.trialDays! - TRIAL_REMINDER_LEAD_DAYS)}
            />}
          <TimelineStep detail={t.paywall.timelineChargeDetail(selectedPlan.price)} icon="card-outline" last title={t.paywall.timelineDay(selectedPlan.trialDays!)} />
        </View> : null}
        {cancelled && hard ? <View accessibilityLiveRegion="polite" style={styles.cancelNotice}>
          <Text style={styles.benefitTitle}>{t.paywall.purchaseCancelledTitle}</Text>
          <Text style={styles.keepsText}>{t.paywall.purchaseCancelledBody}</Text>
        </View> : null}
        {status === 'loading' ? <ActivityIndicator color={colors.accentText} style={styles.loader} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {access.state === 'verification' ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t.access.verify}</Text> : null}
        <Pressable accessibilityRole="button" style={{ padding: 14, minHeight: 48 }} onPress={() => router.push('/account-help' as never)}><Text style={styles.legal}>{t.access.accountHelp} · {t.access.signIn}</Text></Pressable>
        {!largeText ? <View style={styles.inlineTerms}>{renewalTerms}</View> : null}
        {largeText ? purchaseControls : null}
      </ScrollView>

      {!largeText ? purchaseControls : null}
    </SafeAreaView>
  );
}

function formatCurrency(amount: number, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount); }
  catch { return null; }
}

function Benefit({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.benefit}>
      <View style={styles.benefitIcon}><Ionicons color={colors.accentText} name={icon} size={20} /></View>
      <Text style={[styles.benefitTitle, styles.benefitCopy]}>{title}</Text>
      <Ionicons color={colors.success} name="checkmark-circle" size={20} />
    </View>
  );
}

function TimelineStep({ action, detail, icon, last, title }: { action?: { label: string; onPress: () => void }; detail: string; icon: keyof typeof Ionicons.glyphMap; last?: boolean; title: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={styles.stepIcon}><Ionicons color={colors.accentText} name={icon} size={15} /></View>
        {!last ? <View style={styles.stepLine} /> : null}
      </View>
      <View style={[styles.benefitCopy, !last && { paddingBottom: 14 }]}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitDetail}>{detail}</Text>
        {action ? <Pressable accessibilityRole="button" hitSlop={8} onPress={action.onPress} style={styles.stepAction}>
          <Text style={styles.legal}>{action.label}</Text>
        </Pressable> : null}
      </View>
    </View>
  );
}

function PlanCard({ badge, detail, disabled, label, onPress, price, selected }: { badge?: string; detail: string; disabled?: boolean; label: string; onPress: () => void; price: string; selected: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1;
  const priceLabel = <Text style={[styles.planPrice, largeText && styles.planPriceLarge]}>{price}</Text>;
  return (
    <Pressable aria-checked={selected} accessibilityLabel={[label, badge, price, detail].filter(Boolean).join(', ')} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.planCard, largeText && styles.planCardLarge, selected && styles.planCardSelected, disabled && styles.planCardDisabled]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.planCopy}>
        <View style={styles.planLabelRow}>
          <Text style={styles.planLabel}>{label}</Text>
          {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
        </View>
        <Text style={styles.planDetail}>{detail}</Text>
        {largeText ? priceLabel : null}
      </View>
      {!largeText ? priceLabel : null}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20 },
  topBar: { minHeight: 55, paddingVertical: 6, gap: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  restoreButton: { flexShrink: 1, minHeight: 44, justifyContent: 'center' },
  restore: { ...typeScale.callout, textAlign: 'right', color: colors.muted, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', paddingTop: 15, paddingBottom: 16 },
  heroMark: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  testBadge: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, marginTop: 10 },
  testBadgeText: { ...typeScale.caption, color: colors.onAccent, fontWeight: '800', letterSpacing: 0.7 },
  eyebrow: { ...typeScale.caption, color: colors.accentText, fontWeight: '800', letterSpacing: 1.3, marginTop: 16 },
  title: { color: colors.text, fontSize: 36, lineHeight: 41, fontWeight: '700', letterSpacing: -1.2, textAlign: 'center', marginTop: 7 },
  subtitle: { ...typeScale.subhead, color: colors.muted, textAlign: 'center', maxWidth: 340, marginTop: 10 },
  keepsCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, borderRadius: radii.card, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, padding: 13 },
  keepsText: { ...typeScale.subhead, flex: 1, minWidth: 0, color: colors.text },
  benefits: { alignSelf: 'stretch', gap: 9, marginTop: 22 },
  benefit: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: radii.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 11 },
  benefitIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  benefitCopy: { flex: 1, minWidth: 0, gap: 3 },
  benefitTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  benefitDetail: { ...typeScale.subhead, color: colors.muted },
  timeline: { alignSelf: 'stretch', marginTop: 22 },
  step: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center', width: 30 },
  stepIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.accent, marginVertical: 3 },
  stepAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  inlineTerms: { alignSelf: 'stretch', marginTop: 4 },
  dueToday: { ...typeScale.footnote, color: colors.text, fontWeight: '600', textAlign: 'center' },
  plans: { alignSelf: 'stretch', gap: 10, marginTop: 25 },
  planCard: { minHeight: 76, borderRadius: radii.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  planCardLarge: { alignItems: 'flex-start', paddingVertical: 14 },
  planCardSelected: { borderColor: colors.accentText, backgroundColor: colors.neutralSoft },
  planCardDisabled: { opacity: 0.45 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.accentText },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accentText },
  planCopy: { flex: 1, minWidth: 0, gap: 4 },
  planLabelRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  planLabel: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  planDetail: { ...typeScale.footnote, color: colors.muted },
  badge: { flexShrink: 0, backgroundColor: colors.text, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 4 },
  badgeText: { ...typeScale.caption, color: colors.surface, fontWeight: '800', letterSpacing: 0.5 },
  planPrice: { ...typeScale.headline, flexShrink: 0, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  planPriceLarge: { flexShrink: 1 },
  scrollingFooter: { alignSelf: 'stretch', marginTop: 20 },
  cancelNotice: { alignSelf: 'stretch', gap: 4, paddingVertical: 8 },
  footer: { gap: 9, paddingTop: 10, backgroundColor: colors.background },
  loader: { marginTop: 12 },
  error: { ...typeScale.subhead, color: colors.attentionText, marginTop: 12, textAlign: 'center' },
  disabledText: { opacity: 0.45 },
  billing: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
  renewal: { ...typeScale.footnote, color: colors.text, textAlign: 'center', paddingHorizontal: 4 },
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8 },
  legal: { ...typeScale.caption, color: colors.accentText, fontWeight: '600', textDecorationLine: 'underline' },
  legalDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.muted },
});
