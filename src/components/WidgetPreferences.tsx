import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { getWidgetSharing, setWidgetSharing, subscribeWidgetSharing, widgetsAvailable } from '@/services/widgetSnapshot';
import { typeScale } from '@/constants/theme';
export function WidgetPreferences() {
  const { t } = useLanguage(); const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => { let active = true; const refresh = () => { void getWidgetSharing().then(value => { if (active) setEnabled(value); }).catch(() => { if (active) setError(true); }); }; refresh(); const unsubscribe = subscribeWidgetSharing(refresh); return () => { active = false; unsubscribe(); }; }, []);
  return <Card><Text accessibilityRole="header" style={{ ...typeScale.title2, color: colors.text, fontWeight: '700' }}>{t.captureExtras.widgetsTitle}</Text><Text style={{ ...typeScale.body, color: colors.muted }}>{t.captureExtras.widgetsHelp}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 }}><Text style={{ flex: 1, color: colors.text }}>{t.captureExtras.widgetNumbers}</Text><Switch accessibilityLabel={t.captureExtras.widgetNumbers} disabled={busy || !widgetsAvailable} value={enabled} onValueChange={value => { setBusy(true); setError(false); void setWidgetSharing(value).then(() => setEnabled(value)).catch(() => { setEnabled(false); setError(true); }).finally(() => setBusy(false)); }} /></View><Text style={{ color: colors.muted }}>{widgetsAvailable ? t.captureExtras.widgetPrivacy : t.captureExtras.widgetUnavailable}</Text>{error ? <Text accessibilityRole="alert" style={{ color: colors.attentionText }}>{t.captureExtras.widgetError}</Text> : null}</Card>;
}
