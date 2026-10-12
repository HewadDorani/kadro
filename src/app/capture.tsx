import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Screen, Card, PrimaryButton } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { clearCaptureIntent, getScanInputDraft, pendingCaptureIntent } from '@/services/captureIntents';
import { isReminderOnboardingPending } from '@/services/reminders';
import { typeScale } from '@/constants/theme';
export default function CaptureEntry() {
  const router = useRouter();
  const app = useApp(); const { t } = useLanguage(); const { colors } = useTheme();
  const inputDraft = getScanInputDraft();
  const hasDraft = !!inputDraft || (!app.isCurrentScanLogged && (app.analysisStatus !== 'idle' || !!app.photoUri || !!app.descriptionInput));
  useEffect(() => {
    if (!app.hydrationReady || !app.wellnessConsentGranted || !app.profile.completedAt || hasDraft) return;
    let active = true;
    void isReminderOnboardingPending().then(pending => {
      if (!active) return;
      if (pending) { router.replace('/reminder-setup'); return; }
      const requested = pendingCaptureIntent(); clearCaptureIntent();
      router.replace({ pathname: '/(tabs)/scan', params: { mode: requested?.mode ?? 'search' } });
    });
    return () => { active = false; };
  }, [app.hydrationReady, app.wellnessConsentGranted, app.profile.completedAt, hasDraft, router]);
  if (!hasDraft) return null;
  const continueDraft = () => {
    clearCaptureIntent();
    if (inputDraft) router.replace({ pathname: '/(tabs)/scan', params: { mode: inputDraft } });
    else if (app.analysisStatus === 'ready') router.replace('/confirm');
    else if (app.analysisStatus !== 'idle') router.replace('/analyzing');
    else router.replace({ pathname: '/(tabs)/scan', params: { mode: app.descriptionInput ? 'description' : 'photo' } });
  };
  return <Screen><Card><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '700' }}>{t.captureExtras.draftTitle}</Text><Text style={{ ...typeScale.body, color: colors.muted }}>{t.captureExtras.draftText}</Text><PrimaryButton label={t.captureExtras.continueDraft} onPress={continueDraft} /></Card></Screen>;
}
