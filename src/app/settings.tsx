import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { AccountLinkCard } from '@/components/AccountLinkCard';
import { MarketRegionPreference } from '@/components/MarketRegionPreference';
import { ReminderPreferences } from '@/components/ReminderPreferences';
import { InfoRow, MenuRow, ToggleRow } from '@/components/SettingsRows';
import { WidgetPreferences } from '@/components/WidgetPreferences';
import { Card, ListDivider, Screen, SectionTitle, SettingsRow } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { Language } from '@/i18n';
import { useLanguage } from '@/i18n/LanguageProvider';
import { lastMealSavedAt } from '@/services/consistency';
import { isReengagementEnabled, remindersSupported, setReengagementEnabled } from '@/services/reminders';
import { getAnalyticsCollectionEnabled, isTelemetryConfigured, setAnalyticsCollectionEnabled } from '@/services/telemetry';
import { UNIT_SYSTEMS, UnitSystem, formatHeight, formatWeight } from '@/utils/units';

const SETTINGS_SECTIONS = ['account', 'reminders', 'region', 'appearance', 'privacy', 'help'] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Professional, confidential help by language; Kandro itself gives no such guidance. */
const EATING_DISORDER_HELP: Record<Language, string> = {
  de: 'https://www.bzga-essstoerungen.de',
  en: 'https://www.nationaleatingdisorders.org',
};

/**
 * Endonyms, not translations: someone who opened the app in the wrong language
 * has to recognise their own language in the list without reading the rest.
 */
const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

/**
 * One settings group per page. Du lists the six groups as rows, so nobody
 * scrolls past reminders and privacy to find the language.
 */
export default function SettingsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const section: SettingsSection = (SETTINGS_SECTIONS as readonly string[]).includes(params.section ?? '') ? params.section as SettingsSection : 'account';
  const { t } = useLanguage();
  const titles: Record<SettingsSection, string> = {
    account: t.settings.accountRow,
    reminders: t.settings.remindersRow,
    region: t.settings.regionRow,
    appearance: t.settings.appearanceRow,
    privacy: t.settings.privacyRow,
    help: t.settings.helpRow,
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'));

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" hitSlop={8} onPress={back} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{titles[section]}</Text>
        <View style={styles.backButtonSpacer} />
      </View>
      {section === 'account' ? <AccountLinkCard /> : null}
      {section === 'reminders' ? <RemindersSection /> : null}
      {section === 'region' ? <RegionSection /> : null}
      {section === 'appearance' ? <AppearanceSection /> : null}
      {section === 'privacy' ? <PrivacySection /> : null}
      {section === 'help' ? <HelpSection /> : null}
    </Screen>
  );
}

function RemindersSection() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { mealHistory } = useApp();
  const { t } = useLanguage();
  const [reengageEnabled, setReengageEnabled] = useState(true);
  const [reengageError, setReengageError] = useState(false);

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

  return (
    <View style={styles.section}>
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
  );
}

function RegionSection() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile, setUnitSystem } = useApp();
  const { language, locale, setLanguage, t } = useLanguage();
  const unitLabels: Record<UnitSystem, string> = { metric: t.onboarding.unitMetric, us: t.onboarding.unitUs, uk: t.onboarding.unitUk };
  return (
    <View style={styles.section}>
      <SectionTitle>{t.profile.language}</SectionTitle>
      <Card style={styles.listCard}>
        <SettingsRow detail={t.profile.languageDetail} icon="language-outline" label={t.profile.language} />
        <View style={styles.choice}>
          {LANGUAGE_OPTIONS.map((option) => {
            const active = option.value === language;
            return (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} key={option.value} onPress={() => void setLanguage(option.value)} style={[styles.option, active && styles.optionActive]}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionTitle>{t.profile.marketRegion}</SectionTitle>
      <MarketRegionPreference />

      <SectionTitle>{t.profile.units}</SectionTitle>
      <Card style={styles.listCard}>
        <SettingsRow detail={t.profile.unitsDetail} icon="swap-horizontal-outline" label={t.profile.units} />
        <View style={styles.choice}>
          {UNIT_SYSTEMS.map((system) => {
            const active = system === profile.unitSystem;
            return (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} key={system} onPress={() => void setUnitSystem(system)} style={[styles.option, active && styles.optionActive]}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{unitLabels[system]}</Text>
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
  );
}

function AppearanceSection() {
  const { accent, preference: themePreference, setAccent, setPreference: setThemePreference } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  return (
    <Card style={styles.listCard}>
      <SettingsRow detail={t.profile.appearanceDetail} icon="contrast-outline" label={t.profile.appearance} />
      <View style={styles.choice}>
        {(['system', 'light', 'dark'] as const).map((choice) => <Pressable key={choice} aria-checked={themePreference === choice} accessibilityLabel={t.profile[choice]} accessibilityRole="radio" accessibilityState={{ checked: themePreference === choice }} onPress={() => setThemePreference(choice)} style={[styles.option, themePreference === choice && styles.optionActive]}>
          <Text numberOfLines={1} style={[styles.optionLabel, themePreference === choice && styles.optionLabelActive]}>{t.profile[choice]}</Text>
        </Pressable>)}
      </View>
      <SettingsRow detail={t.profile.accentDetail} icon="color-palette-outline" label={t.profile.accent} />
      <View style={styles.choice}>
        {(['pistachio', 'rose'] as const).map((choice) => <Pressable key={choice} aria-checked={accent === choice} accessibilityLabel={t.profile.accentNames[choice]} accessibilityRole="radio" accessibilityState={{ checked: accent === choice }} onPress={() => setAccent(choice)} style={[styles.option, accent === choice && styles.optionActive]}>
          <Text numberOfLines={1} style={[styles.optionLabel, accent === choice && styles.optionLabelActive]}>{t.profile.accentNames[choice]}</Text>
        </Pressable>)}
      </View>
    </Card>
  );
}

function PrivacySection() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { hydrationReady, profile } = useApp();
  const { t } = useLanguage();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
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

  const updateAnalytics = async (enabled: boolean) => {
    setAnalyticsEnabled(await setAnalyticsCollectionEnabled(enabled));
  };

  return (
    <Card style={styles.listCard}>
      <MenuRow icon="shield-checkmark-outline" label={t.profile.dataConsent} onPress={() => router.push('/data-consent' as never)} />
      <ListDivider />
      <InfoRow detail={t.profile.photoHandlingDetail} icon="image-outline" label={t.profile.photoHandling} />
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
  );
}

function HelpSection() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { language, t } = useLanguage();
  return (
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
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backButtonSpacer: { width: 44 },
  title: { ...typeScale.title2, flex: 1, color: colors.text, fontWeight: '700', textAlign: 'center' },
  section: { gap: 12 },
  listCard: { padding: 8 },
  choice: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  option: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optionActive: { borderColor: colors.text, backgroundColor: colors.text },
  optionLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  optionLabelActive: { color: colors.surface },
  inlineError: { ...typeScale.footnote, color: colors.attentionText, paddingHorizontal: 12, paddingBottom: 12, marginLeft: 48 },
});
