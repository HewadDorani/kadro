import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, PrimaryButton, Screen } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { typeScale } from '@/constants/theme';

export default function DataConsentScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { grantWellnessConsent, profile, wellnessConsentGranted, withdrawWellnessConsent } = useApp();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConsent = async (grant: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (grant) {
        await grantWellnessConsent(profile.age);
        router.replace(profile.completedAt ? '/(tabs)/today' : '/onboarding');
      } else {
        await withdrawWellnessConsent();
      }
    } catch {
      setError(t.consent.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
      </View>

      <View style={styles.heading}>
        <View style={[styles.statusIcon, !wellnessConsentGranted && styles.statusIconPaused]}>
          <Ionicons color={wellnessConsentGranted ? colors.onAccent : colors.attentionText} name={wellnessConsentGranted ? 'shield-checkmark-outline' : 'pause-outline'} size={28} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{t.consent.title}</Text>
        <Text style={styles.stateTitle}>{wellnessConsentGranted ? t.consent.activeTitle : t.consent.pausedTitle}</Text>
        <Text style={styles.copy}>{wellnessConsentGranted ? t.consent.activeBody : t.consent.pausedBody}</Text>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.consent.aiTitle}</Text>
        <Text style={styles.cardText}>{t.consent.aiBody}</Text>
      </Card>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t.consent.safeguardsTitle}</Text>
        <Text style={styles.cardText}>{t.consent.safeguardsBody}</Text>
      </Card>

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      {wellnessConsentGranted ? (
        <>
          <Text style={styles.hint}>{t.consent.withdrawHint}</Text>
          <PrimaryButton disabled={busy} label={t.consent.withdraw} onPress={() => void updateConsent(false)} variant="dark" />
        </>
      ) : (
        <PrimaryButton disabled={busy} icon="checkmark" label={busy ? t.common.moment : t.consent.accept} onPress={() => void updateConsent(true)} />
      )}
      <PrimaryButton label={t.consent.privacy} onPress={() => router.push('/privacy')} variant="ghost" />
      <PrimaryButton label={t.consent.deletion} onPress={() => router.push('/account-deletion')} variant="ghost" />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row' },
  backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: 9 },
  statusIcon: { width: 58, height: 58, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statusIconPaused: { backgroundColor: colors.attentionSoft },
  title: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.7 },
  stateTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  copy: { ...typeScale.footnote, color: colors.muted },
  card: { gap: 8 },
  cardTitle: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  cardText: { ...typeScale.footnote, color: colors.muted },
  hint: { ...typeScale.footnote, color: colors.muted, textAlign: 'center' },
  error: { ...typeScale.footnote, color: colors.attentionText, textAlign: 'center' },
});
