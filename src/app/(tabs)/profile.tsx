import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { WidgetPreferences } from '@/components/WidgetPreferences';
import { ReminderPreferences } from '@/components/ReminderPreferences';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { AccountLinkCard } from '@/components/AccountLinkCard';
import { BillingIssueBanner } from '@/components/BillingIssueBanner';
import { MarketRegionPreference } from '@/components/MarketRegionPreference';
import { Card, Eyebrow, ListDivider, PageTitle, PressableScale, Screen, SectionTitle, SettingsRow } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { lastMealSavedAt } from '@/services/consistency';
import { isReengagementEnabled, remindersSupported, setReengagementEnabled } from '@/services/reminders';
import {
  getAnalyticsCollectionEnabled,
  isTelemetryConfigured,
  setAnalyticsCollectionEnabled,
} from '@/services/telemetry';
import { activityLabel, effectiveGoal, goalLabel, isTeenProfile, weeklyRateLabel } from '@/services/personalization';
import { useLanguage } from '@/i18n/LanguageProvider';
import { formatNumber } from '@/utils/format';
import type { Language } from '@/i18n';
import { UNIT_SYSTEMS, UnitSystem, formatHeight, formatWeight } from '@/utils/units';

/**
 * Endonyms, not translations: someone who opened the app in the wrong language
 * has to recognise their own language in the list without reading the rest.
 */
/** Professional, confidential help by language; Kandro itself gives no such guidance. */
const EATING_DISORDER_HELP: Record<Language, string> = {
  de: 'https://www.bzga-essstoerungen.de',
  en: 'https://www.nationaleatingdisorders.org',
};

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

export default function ProfileScreen() {
  const { colors, preference: themePreference, setPreference: setThemePreference } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { hydrationReady, mealHistory, profile, setUnitSystem, targets, userName } = useApp();
  const { status: subscriptionStatus } = useSubscription();
  const { language, locale, setLanguage, t } = useLanguage();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [reengageEnabled, setReengageEnabled] = useState(true);
  const [reengageError, setReengageError] = useState(false);
  const analyticsEligible = hydrationReady && Boolean(profile.completedAt) && profile.age >= 18;
  const isMinor = !analyticsEligible;


  useEffect(() => {
    if (!hydrationReady) return;
    let active = true;
    void getAnalyticsCollectionEnabled().then((enabled) => {
      if (active) setAnalyticsEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [hydrationReady, profile.age, profile.completedAt]);

  useEffect(() => {
    if (!hydrationReady || analyticsEligible) return;
    void setAnalyticsCollectionEnabled(false).then(() => setAnalyticsEnabled(false));
  }, [analyticsEligible, hydrationReady]);

  useEffect(() => {
    let active = true;
    void isReengagementEnabled().then((enabled) => { if (active) setReengageEnabled(enabled); });
    return () => { active = false; };
  }, []);

  const updateReengagement = (enabled: boolean) => {
    setReengageEnabled(enabled);
    setReengageError(false);
    void setReengagementEnabled(enabled, lastMealSavedAt(mealHistory)).catch(() => {
      setReengageEnabled(!enabled);
      setReengageError(true);
    });
  };

  const updateAnalytics = async (enabled: boolean) => {
    setAnalyticsEnabled(await setAnalyticsCollectionEnabled(enabled));
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{userName.trim().charAt(0).toUpperCase() || 'K'}</Text></View>
        <View style={styles.headerCopy}>
          <Eyebrow>{t.profile.eyebrow}</Eyebrow>
          <PageTitle>{userName.trim() || t.tabs.profile}</PageTitle>
          <Text style={styles.subtitle}>{t.profile.headerSubtitle}</Text>
        </View>
      </View>

      <BillingIssueBanner />

      {/* Active Pro opens the subscription screen (plan, renewal, cancel at Apple); otherwise the paywall. */}
      <PressableScale accessibilityLabel={subscriptionStatus === 'active' ? t.access.manage : t.profile.proView} accessibilityRole="button" onPress={() => router.push(subscriptionStatus === 'active' ? '/subscription-manage' as never : '/paywall')}>
        <Card style={styles.proCard}>
          {/* Not "infinite": Pro has a fair-use cap, so the glyph must not promise otherwise. */}
          <View style={styles.proIcon}><Ionicons color={colors.onAccent} name="sparkles" size={22} /></View>
          <View style={styles.proCopy}>
            <Text style={styles.proTitle}>{subscriptionStatus === 'active' ? t.profile.proActive : t.profile.proTitle}</Text>
            <Text style={styles.proText}>{subscriptionStatus === 'active' ? t.profile.proActiveText : t.profile.proText}</Text>
          </View>
          <View style={styles.tryPill}><Text style={styles.tryText}>{subscriptionStatus === 'active' ? t.profile.badgeActive : t.profile.badgeView}</Text></View>
        </Card>
      </PressableScale>

      <View style={styles.section}>
        <SectionTitle>{t.profile.plan}</SectionTitle>
        <Card style={styles.planCard}>
          <View style={styles.planGrid}>
            <PlanStat label={t.profile.calories} value={formatNumber(targets.calories, locale)} />
            <PlanStat label={t.common.protein} value={`${targets.protein} g`} />
            <PlanStat label={t.profile.goal} value={goalLabel(effectiveGoal(profile), t.common, isTeenProfile(profile))} />
            <PlanStat label={t.profile.pace} value={isTeenProfile(profile)
              ? t.onboarding.teenPace
              : weeklyRateLabel(effectiveGoal(profile), profile.weeklyRateKg, t.common, profile.unitSystem)} />
            <PlanStat label={t.profile.activity} value={activityLabel(profile.activityLevel, t.common)} />
          </View>
          <ListDivider />
          {/*
            A goal is not a one-time decision: people finish losing weight and
            move on to building muscle, and their weight and activity change
            under them either way. Re-running the same questions keeps one
            source of truth for how a plan is calculated.
          */}
          <MenuRow icon="create-outline" label={t.profile.changePlan} onPress={() => router.push('/onboarding?edit=1' as never)} />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.account}</SectionTitle>
        <AccountLinkCard />
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.reminders}</SectionTitle>
        <ReminderPreferences />
        {remindersSupported ? (
          <Card style={styles.listCard}>
            <ToggleRow
              detail={t.captureExtras.reengageDetail}
              icon="notifications-outline"
              label={t.captureExtras.reengageLabel}
              onValueChange={updateReengagement}
              value={reengageEnabled}
            />
            {reengageError ? <Text accessibilityRole="alert" style={styles.inlineError}>{t.captureExtras.reengageError}</Text> : null}
          </Card>
        ) : null}
        <WidgetPreferences />
        <Card style={styles.listCard}>
          <MenuRow icon="sparkles-outline" label={t.profile.openEvening} onPress={() => router.push('/evening')} />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.privacySettings}</SectionTitle>
        <Card style={styles.listCard}>
          <MenuRow icon="shield-checkmark-outline" label={t.profile.dataConsent} onPress={() => router.push('/data-consent' as never)} />
          <ListDivider />
          <InfoRow
            detail={t.profile.photoHandlingDetail}
            icon="image-outline"
            label={t.profile.photoHandling}
          />
          <ListDivider />
          <ToggleRow
            detail={isMinor
              ? t.profile.analyticsMinor
              : isTelemetryConfigured
                ? t.profile.analyticsOn
                : t.profile.analyticsOff}
            disabled={!analyticsEligible || !isTelemetryConfigured}
            icon="analytics-outline"
            label={t.profile.analytics}
            onValueChange={(enabled) => void updateAnalytics(enabled)}
            value={analyticsEnabled}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.units}</SectionTitle>
        <Card style={styles.listCard}>
          <SettingsRow detail={t.profile.unitsDetail} icon="swap-horizontal-outline" label={t.profile.units} />
          <View style={styles.languageChoice}>
            {UNIT_SYSTEMS.map((system) => {
              const active = system === profile.unitSystem;
              const labels: Record<UnitSystem, string> = {
                metric: t.onboarding.unitMetric,
                us: t.onboarding.unitUs,
                uk: t.onboarding.unitUk,
              };
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={system}
                  onPress={() => void setUnitSystem(system)}
                  style={[styles.languageOption, active && styles.languageOptionActive]}
                >
                  <Text style={[styles.languageLabel, active && styles.languageLabelActive]}>{labels[system]}</Text>
                </Pressable>
              );
            })}
          </View>
          <ListDivider />
          <MenuRow
            detail={`${formatHeight(profile.heightCm, profile.unitSystem)} · ${formatWeight(profile.weightKg, profile.unitSystem, locale)}`}
            icon="body-outline"
            label={t.profile.bodyValues}
            onPress={() => router.push('/onboarding?edit=1' as never)}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.language}</SectionTitle>
        <Card style={styles.listCard}>
          <SettingsRow detail={t.profile.languageDetail} icon="language-outline" label={t.profile.language} />
          <View style={styles.languageChoice}>
            {LANGUAGE_OPTIONS.map((option) => {
              const active = option.value === language;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={option.value}
                  onPress={() => void setLanguage(option.value)}
                  style={[styles.languageOption, active && styles.languageOptionActive]}
                >
                  <Text style={[styles.languageLabel, active && styles.languageLabelActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.marketRegion}</SectionTitle>
        <MarketRegionPreference />
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.appearance}</SectionTitle>
        <Card style={styles.listCard}>
          <SettingsRow detail={t.profile.appearanceDetail} icon="contrast-outline" label={t.profile.appearance} />
          <View style={styles.languageChoice}>
            {(['system', 'light', 'dark'] as const).map((choice) => <Pressable key={choice} aria-checked={themePreference === choice} accessibilityLabel={t.profile[choice]} accessibilityRole="radio" accessibilityState={{ checked: themePreference === choice }} onPress={() => setThemePreference(choice)} style={[styles.languageOption, themePreference === choice && styles.languageOptionActive]}>
              <Text numberOfLines={1} style={[styles.languageLabel, themePreference === choice && styles.languageLabelActive]}>{t.profile[choice]}</Text>
            </Pressable>)}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.support}</SectionTitle>
        <Card style={styles.listCard}>
          <MenuRow icon="compass-outline" label={t.profile.appTour} onPress={() => router.push({ pathname: '/(tabs)/today', params: { tour: '1' } })} />
          <ListDivider />
          <MenuRow icon="shield-checkmark-outline" label={t.profile.privacy} onPress={() => router.push('/privacy')} />
          <ListDivider />
          <MenuRow icon="document-text-outline" label={t.profile.terms} onPress={() => router.push('/terms')} />
          <ListDivider />
          <MenuRow icon="library-outline" label={t.profile.sources} onPress={() => router.push('/sources')} />
          <ListDivider />
          <MenuRow
            detail={t.profile.eatingHelpDetail}
            icon="heart-outline"
            label={t.profile.eatingHelp}
            onPress={() => void Linking.openURL(EATING_DISORDER_HELP[language]).catch(() => undefined)}
          />
          <ListDivider />
          <MenuRow icon="trash-outline" label={t.profile.deleteAccount} onPress={() => router.push('/account-deletion')} />
        </Card>
      </View>

      <View style={styles.wellnessNote}>
        <Ionicons color={colors.muted} name="information-circle-outline" size={18} />
        <Text style={styles.wellnessText}>{t.profile.wellness}</Text>
      </View>

      <Text style={styles.version}>{t.profile.version(Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '-')}</Text>
    </Screen>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  const { colors, mode: themeMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.planStat}>
      <Text style={styles.planStatLabel}>{label}</Text>
      <Text style={styles.planStatValue}>{value}</Text>
    </View>
  );
}

function ToggleRow({ detail, disabled, icon, label, onValueChange, value }: { detail: string; disabled?: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onValueChange: (value: boolean) => void; value: boolean }) {
  const { colors } = useTheme();
  return (
    <SettingsRow
      accessory={
        /*
          Without a label VoiceOver announces only "switch, off": the row's
          text sits in a sibling view and is not read as part of the control.
        */
        <Switch
          accessibilityHint={detail}
          accessibilityLabel={label}
          disabled={disabled}
          ios_backgroundColor={colors.border}
          onValueChange={onValueChange}
          thumbColor={colors.surface}
          trackColor={{ false: colors.border, true: colors.accentText }}
          value={value}
        />
      }
      detail={detail}
      disabled={disabled}
      icon={icon}
      label={label}
    />
  );
}

function InfoRow({ detail, icon, label }: { detail: string; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return <SettingsRow detail={detail} icon={icon} label={label} />;
}

function MenuRow({ detail, icon, label, onPress }: { detail?: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale accessibilityRole="button" onPress={onPress}>
      <SettingsRow accessory={<Ionicons color={colors.muted} name="chevron-forward" size={18} />} detail={detail} icon={icon} label={label} />
    </PressableScale>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typeScale.title2, color: colors.surface, fontWeight: '800' },
  headerCopy: { flex: 1, gap: 4 },
  subtitle: { ...typeScale.subhead, color: colors.muted },
  proCard: { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  proIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  proCopy: { flex: 1, gap: 2 },
  proTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  proText: { ...typeScale.footnote, color: colors.muted },
  tryPill: { backgroundColor: colors.text, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  tryText: { ...typeScale.caption, color: colors.surface, fontWeight: '700' },
  // Section headers sit 32 pt below the previous block (20 pt screen gap + 12) and 12 pt above their card.
  section: { gap: 12, marginTop: 12 },
  planCard: { padding: 8 },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  planStat: { width: '50%', paddingHorizontal: 12, paddingVertical: 12, gap: 2 },
  planStatLabel: { ...typeScale.footnote, color: colors.muted },
  planStatValue: { ...typeScale.headline, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  listCard: { padding: 8 },
  languageChoice: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  languageOption: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  languageOptionActive: { borderColor: colors.text, backgroundColor: colors.text },
  languageLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  languageLabelActive: { color: colors.surface },
  inlineError: { ...typeScale.footnote, color: colors.attentionText, paddingHorizontal: 12, paddingBottom: 12, marginLeft: 48 },
  wellnessNote: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, marginTop: 12 },
  wellnessText: { ...typeScale.footnote, flex: 1, color: colors.muted },
  version: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
});
