import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BillingIssueBanner } from '@/components/BillingIssueBanner';
import { MenuRow } from '@/components/SettingsRows';
import { Card, Eyebrow, ListDivider, PageTitle, PressableScale, Screen, SectionTitle } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { activityLabel, effectiveGoal, goalLabel, isTeenProfile, weeklyRateLabel } from '@/services/personalization';
import { useLanguage } from '@/i18n/LanguageProvider';
import { formatNumber } from '@/utils/format';

export default function ProfileScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile, targets, userName } = useApp();
  const { status: subscriptionStatus } = useSubscription();
  const { locale, t } = useLanguage();
  const openSettings = (section: 'account' | 'reminders' | 'region' | 'appearance' | 'privacy' | 'help') => router.push({ pathname: '/settings', params: { section } } as never);

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
          {/* Two lines instead of five tiles, so Du fits one screen. */}
          <View style={styles.planSummary}>
            <Text style={styles.planHeadline}>{formatNumber(targets.calories, locale)} kcal · {targets.protein} g {t.common.protein}</Text>
            <Text style={styles.planDetail}>{[
              goalLabel(effectiveGoal(profile), t.common, isTeenProfile(profile)),
              isTeenProfile(profile) ? t.onboarding.teenPace : weeklyRateLabel(effectiveGoal(profile), profile.weeklyRateKg, t.common, profile.unitSystem),
              activityLabel(profile.activityLevel, t.common),
            ].join(' · ')}</Text>
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

      {/* Six groups, one page each (app/settings.tsx): Du fits one screen instead of ten sections. */}
      <View style={styles.section}>
        <Card style={styles.listCard}>
          <MenuRow detail={t.settings.accountDetail} icon="person-circle-outline" label={t.settings.accountRow} onPress={() => openSettings('account')} />
          <ListDivider />
          <MenuRow icon="notifications-outline" label={t.settings.remindersRow} onPress={() => openSettings('reminders')} />
          <ListDivider />
          <MenuRow icon="globe-outline" label={t.settings.regionRow} onPress={() => openSettings('region')} />
          <ListDivider />
          <MenuRow icon="contrast-outline" label={t.settings.appearanceRow} onPress={() => openSettings('appearance')} />
          <ListDivider />
          <MenuRow icon="shield-checkmark-outline" label={t.settings.privacyRow} onPress={() => openSettings('privacy')} />
          <ListDivider />
          <MenuRow icon="help-circle-outline" label={t.settings.helpRow} onPress={() => openSettings('help')} />
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
  planSummary: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 },
  planHeadline: { ...typeScale.headline, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  planDetail: { ...typeScale.subhead, color: colors.muted },
  listCard: { padding: 8 },
  wellnessNote: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, marginTop: 12 },
  wellnessText: { ...typeScale.footnote, flex: 1, color: colors.muted },
  version: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
});
