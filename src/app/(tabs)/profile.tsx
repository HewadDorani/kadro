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
import { Card, Eyebrow, PageTitle, PressableScale, Screen, SectionTitle } from '@/components/ui';
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

      <PressableScale accessibilityLabel={t.profile.proView} accessibilityRole="button" onPress={() => router.push('/paywall')}>
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
          <View style={styles.divider} />
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
        <MenuRow icon="sparkles-outline" label={t.profile.openEvening} onPress={() => router.push('/evening')} />
      </View>

      <View style={styles.section}>
        <SectionTitle>{t.profile.privacySettings}</SectionTitle>
        <Card style={styles.listCard}>
          <MenuRow icon="shield-checkmark-outline" label={t.profile.dataConsent} onPress={() => router.push('/data-consent' as never)} />
          <View style={styles.divider} />
          <InfoRow
            detail={t.profile.photoHandlingDetail}
            icon="image-outline"
            label={t.profile.photoHandling}
          />
          <View style={styles.divider} />
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
          <View style={styles.toggleRow}>
            <View style={styles.rowIcon}><Ionicons color={colors.text} name="swap-horizontal-outline" size={20} /></View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{t.profile.units}</Text>
              <Text style={styles.rowDetail}>{t.profile.unitsDetail}</Text>
            </View>
          </View>
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
          <View style={styles.divider} />
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
          <View style={styles.toggleRow}>
            <View style={styles.rowIcon}><Ionicons color={colors.text} name="language-outline" size={20} /></View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>{t.profile.language}</Text>
              <Text style={styles.rowDetail}>{t.profile.languageDetail}</Text>
            </View>
          </View>
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
        <SectionTitle>{t.profile.appearance}</SectionTitle>
        <Card>
          <Text style={[styles.rowDetail, { padding: 16 }]}>{t.profile.appearanceDetail}</Text>
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
          <MenuRow icon="shield-checkmark-outline" label={t.profile.privacy} onPress={() => router.push('/privacy')} />
          <View style={styles.divider} />
          <MenuRow icon="document-text-outline" label={t.profile.terms} onPress={() => router.push('/terms')} />
          <View style={styles.divider} />
          <MenuRow icon="library-outline" label={t.profile.sources} onPress={() => router.push('/sources')} />
          <View style={styles.divider} />
          <MenuRow
            detail={t.profile.eatingHelpDetail}
            icon="heart-outline"
            label={t.profile.eatingHelp}
            onPress={() => void Linking.openURL(EATING_DISORDER_HELP[language]).catch(() => undefined)}
          />
          <View style={styles.divider} />
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
  const { colors, mode: themeMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.toggleRow, disabled && styles.disabledRow]}>
      <View style={styles.rowIcon}><Ionicons color={colors.text} name={icon} size={20} /></View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {/*
        Without a label VoiceOver announces only "switch, off": the row's
        text sits in a sibling view and is not read as part of the control.
      */}
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
    </View>
  );
}

function InfoRow({ detail, icon, label }: { detail: string; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { colors, mode: themeMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.toggleRow}>
      <View style={styles.rowIcon}><Ionicons color={colors.text} name={icon} size={20} /></View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function MenuRow({ detail, icon, label, onPress }: { detail?: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors, mode: themeMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} style={styles.menuRow}>
      <View style={styles.rowIcon}><Ionicons color={colors.text} name={icon} size={20} /></View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail ? <Text style={styles.menuDetail}>{detail}</Text> : null}
      </View>
      <Ionicons color={colors.muted} name="chevron-forward" size={18} />
    </PressableScale>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  menuCopy: { flex: 1, gap: 2 },
  menuDetail: { ...typeScale.caption, color: colors.muted },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.surface, fontSize: 20, lineHeight: 25, fontWeight: '800' },
  headerCopy: { flex: 1, gap: 3 },
  subtitle: { ...typeScale.footnote, color: colors.muted },
  proCard: { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  proIcon: { width: 46, height: 46, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  proCopy: { flex: 1, gap: 4 },
  proTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  proText: { ...typeScale.caption, color: colors.text, opacity: 0.7 },
  tryPill: { backgroundColor: colors.text, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  tryText: { ...typeScale.caption, color: colors.surface, fontWeight: '800', letterSpacing: 0.3 },
  section: { gap: 13 },
  planCard: { padding: 8 },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  planStat: { width: '50%', padding: 14, gap: 4 },
  planStatLabel: { ...typeScale.caption, color: colors.muted },
  planStatValue: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  listCard: { padding: 8 },
  toggleRow: { minHeight: 78, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  disabledRow: { opacity: 0.55 },
  languageChoice: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  languageOption: { minHeight: 44, flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  languageOptionActive: { borderColor: colors.text, backgroundColor: colors.text },
  languageLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  languageLabelActive: { color: colors.surface },
  menuRow: { minHeight: 58, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 40, height: 40, borderRadius: 15, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 3 },
  rowLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  rowDetail: { ...typeScale.caption, color: colors.muted },
  inlineError: { ...typeScale.caption, color: colors.attentionText, paddingHorizontal: 9, paddingBottom: 9 },
  menuLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 60 },
  wellnessNote: { flexDirection: 'row', gap: 9, paddingHorizontal: 8 },
  wellnessText: { ...typeScale.footnote, flex: 1, color: colors.muted },
  version: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
});
