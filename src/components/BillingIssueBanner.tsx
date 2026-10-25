import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui';
import { typeScale } from '@/constants/theme';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useLanguage } from '@/i18n/LanguageProvider';
import { billingIssueBannerVisible } from '@/services/retention';
import { openSubscriptionManagement } from '@/services/subscription';

const DISMISSED_KEY = '@kandro/billing-issue-dismissed:v1';

/**
 * Apple billing grace period: the renewal failed, Kandro Pro stays active
 * while Apple retries. A calm notice (no warning colour, no countdown) with
 * one way to fix it, hidden for the rest of the day when dismissed.
 */
export function BillingIssueBanner() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { status, snapshot } = useSubscription();
  const today = useLocalDay();
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(DISMISSED_KEY).catch(() => null).then(value => { if (active) { setDismissedDay(value); setLoaded(true); } });
    return () => { active = false; };
  }, []);
  if (!loaded || !billingIssueBannerVisible({ status, customer: snapshot?.customer, dismissedDay, today })) return null;
  const dismiss = () => {
    setDismissedDay(today);
    void AsyncStorage.setItem(DISMISSED_KEY, today).catch(() => undefined);
  };
  return <View accessibilityLiveRegion="polite" style={{ padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Ionicons color={colors.muted} name="card-outline" size={20} />
      <Text style={{ ...typeScale.subhead, flex: 1, color: colors.text }}>{t.retention.bannerText}</Text>
      <Pressable accessibilityLabel={t.retention.bannerDismiss} accessibilityRole="button" hitSlop={12} onPress={dismiss} style={{ minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons color={colors.muted} name="close" size={18} />
      </Pressable>
    </View>
    <PrimaryButton label={t.retention.bannerAction} onPress={() => void openSubscriptionManagement()} variant="secondary" />
  </View>;
}
