import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Screen, PrimaryButton } from '@/components/ui';
import { KandroMark } from '@/components/KandroMark';
import { useAccess } from '@/context/AccessContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { typeScale } from '@/constants/theme';

/**
 * A fresh install that just finished onboarding is a first use by
 * construction; the server still rejects any identity with prior meals,
 * analyses or an older account. While access is resolved, the plan is built
 * on screen (the real intermediate values), so the step into the app or the
 * paywall is a calm hand-over, not a second calculation.
 */
export default function AccessSetup() {
  const access = useAccess(); const router = useRouter(); const { t } = useLanguage(); const { colors } = useTheme();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const started = useRef(false);
  const finish = async (newUser: boolean) => {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      await access.enroll(newUser);
      router.replace('/(tabs)/today');
    }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (started.current || !access.ready || !access.enrollmentPending) return;
    started.current = true;
    void finish(true);
  }, [access.ready, access.enrollmentPending]);
  if (access.ready && !access.enrollmentPending && !busy) return <Redirect href="/(tabs)/today" />;
  return <Screen>
    <View style={{ flex: 1, justifyContent: 'center', gap: 28, paddingVertical: 40 }}>
      {/* The plan was already built and shown; this is only a short hand-over. */}
      <View style={{ alignItems: 'center', gap: 16 }}>
        <KandroMark size={56} />
        <Text accessibilityRole="header" style={{ ...typeScale.title2, color: colors.text, fontWeight: '700', textAlign: 'center' }}>{t.access.settingUp}</Text>
      </View>
      {error ? <View style={{ gap: 10 }}>
        <Text accessibilityRole="alert" style={{ ...typeScale.callout, color: colors.attentionText, textAlign: 'center' }}>{t.access.verify}</Text>
        <PrimaryButton disabled={busy} label={busy ? t.common.moment : t.access.identityContinue} onPress={() => void finish(true)} />
        <PrimaryButton disabled={busy} variant="ghost" label={t.access.identitySkip} onPress={() => void finish(false)} />
      </View> : null}
    </View>
  </Screen>;
}
