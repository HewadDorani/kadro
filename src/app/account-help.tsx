import { Linking, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, PrimaryButton } from '@/components/ui';
import { AccountLinkCard } from '@/components/AccountLinkCard';
import { ReminderPreferences } from '@/components/ReminderPreferences';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { legalProvider } from '@/constants/legal';
import { typeScale } from '@/constants/theme';
import { useAccess } from '@/context/AccessContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { openSubscriptionManagement } from '@/services/subscription';

export default function AccountHelp() {
  const router = useRouter(); const { t, language } = useLanguage(); const { colors } = useTheme();
  const { status } = useSubscription(); const { canUse } = useAccess();
  // Confirmed Pro sees its plan first (cancel stays one tap away there).
  // Anyone else, including a locked account in billing retry, goes straight
  // to Apple: this screen must never stand between a customer and cancelling.
  const manage = () => status === 'active' && canUse ? router.push('/subscription-manage' as never) : void openSubscriptionManagement();
  return <Screen>
    <PrimaryButton variant="ghost" label={t.common.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/paywall')} />
    <Text accessibilityRole="header" style={{ ...typeScale.title1, color: colors.text, fontWeight: '700' }}>{t.access.accountHelp}</Text>
    <Text style={{ color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '600' }}>{t.access.signIn}</Text>
    <AccountLinkCard />
    <PrimaryButton label={t.paywall.restore} variant="secondary" onPress={() => router.push('/paywall')} />
    <PrimaryButton label={t.access.manage} variant="secondary" onPress={manage} />
    <PrimaryButton label={t.access.savedMeals} variant="secondary" onPress={() => router.push('/saved-meals' as never)} />
    <ReminderPreferences />
    <PrimaryButton label={t.profile.privacy} variant="ghost" onPress={() => router.push('/privacy')} />
    <PrimaryButton label={t.profile.terms} variant="ghost" onPress={() => router.push('/terms')} />
    <PrimaryButton label={t.consent.title} variant="ghost" onPress={() => router.push('/data-consent')} />
    <PrimaryButton label={t.profile.deleteAccount} variant="ghost" onPress={() => router.push('/account-deletion')} />
    <PrimaryButton label={t.access.support} variant="ghost" onPress={() => void Linking.openURL(legalProvider.supportUrl || `https://getkandro.com/${language}/support/`)} />
  </Screen>;
}
