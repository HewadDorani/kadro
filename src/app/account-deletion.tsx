import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { accountDeletionErrorMessage, deleteKandroAccount } from '@/services/accountDeletion';
import { accountLinkErrorMessage, enableNewCloudAccount } from '@/services/accountLinking';

const appleSubscriptionsUrl = 'https://apps.apple.com/account/subscriptions';

export default function AccountDeletionScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { resetAfterAccountDeletion } = useApp();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [appleRevokeManually, setAppleRevokeManually] = useState(false);
  const { t } = useLanguage();

  const removeAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteKandroAccount();
      setAppleRevokeManually(result.appleRevocation === 'manual_required');
      resetAfterAccountDeletion();
      setDeleted(true);
    } catch (failure) {
      setError(accountDeletionErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const startAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableNewCloudAccount();
      router.replace('/onboarding');
    } catch (failure) {
      setError(accountLinkErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  if (deleted) {
    return (
      <Screen>
        <View style={styles.success} accessibilityLiveRegion="polite">
          <View style={styles.successIcon}><Ionicons color={colors.onAccent} name="checkmark" size={28} /></View>
          <Text accessibilityRole="header" style={styles.title}>{t.deletion.doneTitle}</Text>
          <Text style={styles.copy}>{t.deletion.doneText}</Text>
          {appleRevokeManually ? <Text style={styles.copy}>{t.deletion.appleRevokeManually}</Text> : null}
        </View>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          disabled={busy}
          icon="arrow-forward"
          label={busy ? t.deletion.startingAgain : t.deletion.backToApp}
          onPress={() => void startAgain()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
      </View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>{t.deletion.title}</Text>
        <Text style={styles.copy}>{t.deletion.body}</Text>
      </View>

      <Card style={styles.warningCard}>
        <Ionicons color={colors.attentionText} name="information-circle-outline" size={22} />
        <View style={styles.warningCopy}>
          <Text style={styles.warningTitle}>{t.deletion.warningTitle}</Text>
          <Text style={styles.warningText}>{t.deletion.warningText}</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(appleSubscriptionsUrl)}>
            <Text style={styles.link}>{t.deletion.openSubscriptions}</Text>
          </Pressable>
        </View>
      </Card>

      <Pressable
        accessibilityLabel={t.deletion.confirmLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => setConfirmed((current) => !current)}
        style={styles.confirmRow}
      >
        <View style={[styles.checkbox, confirmed && styles.checkboxSelected]}>
          {confirmed ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
        </View>
        <Text style={styles.confirmText}>{t.deletion.confirmText}</Text>
      </Pressable>

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        disabled={!confirmed || busy}
        icon="trash-outline"
        label={busy ? t.deletion.deleting : t.deletion.deleteNow}
        onPress={() => void removeAccount()}
        variant="dark"
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row' },
  backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: 10 },
  title: { color: colors.text, fontSize: 31, lineHeight: 37, fontWeight: '700', letterSpacing: -0.8 },
  copy: { ...typeScale.subhead, color: colors.muted },
  warningCard: { flexDirection: 'row', gap: 12, backgroundColor: colors.attentionSoft, borderColor: colors.attention },
  warningCopy: { flex: 1, gap: 7 },
  warningTitle: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  warningText: { ...typeScale.footnote, color: colors.muted },
  link: { ...typeScale.caption, color: colors.accentText, fontWeight: '800', textDecorationLine: 'underline' },
  confirmRow: { minHeight: 74, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: colors.accentDeep, borderColor: colors.accentDeep },
  confirmText: { ...typeScale.footnote, flex: 1, color: colors.text },
  error: { ...typeScale.footnote, color: colors.attentionText, textAlign: 'center' },
  success: { flex: 1, minHeight: 440, alignItems: 'center', justifyContent: 'center', gap: 14 },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
