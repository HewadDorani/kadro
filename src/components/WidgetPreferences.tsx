import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Card, ListDivider, SettingsRow } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { getWidgetSharing, setWidgetSharing, subscribeWidgetSharing, widgetsAvailable } from '@/services/widgetSnapshot';
import { typeScale } from '@/constants/theme';

/**
 * Grouped like the other settings: how to add the widget, then the one
 * switch, with the privacy terms as a footnote under it rather than a wall
 * of body text.
 */
export function WidgetPreferences() {
  const { t } = useLanguage(); const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => { let active = true; const refresh = () => { void getWidgetSharing().then(value => { if (active) setEnabled(value); }).catch(() => { if (active) setError(true); }); }; refresh(); const unsubscribe = subscribeWidgetSharing(refresh); return () => { active = false; unsubscribe(); }; }, []);
  const footnote = { ...typeScale.footnote, color: colors.muted, paddingHorizontal: 12 };
  return <Card style={{ padding: 8 }}>
    <SettingsRow detail={t.captureExtras.widgetsHelp} icon="apps-outline" label={t.captureExtras.widgetsTitle} />
    <ListDivider />
    <SettingsRow
      accessory={<Switch accessibilityLabel={t.captureExtras.widgetNumbers} disabled={busy || !widgetsAvailable} ios_backgroundColor={colors.border} thumbColor={colors.surface} trackColor={{ false: colors.border, true: colors.accentText }} value={enabled} onValueChange={value => { setBusy(true); setError(false); void setWidgetSharing(value).then(() => setEnabled(value)).catch(() => { setEnabled(false); setError(true); }).finally(() => setBusy(false)); }} />}
      disabled={!widgetsAvailable}
      label={t.captureExtras.widgetNumbers}
    />
    <View style={{ gap: 8, paddingBottom: 12 }}>
      <Text style={footnote}>{widgetsAvailable ? t.captureExtras.widgetPrivacy : t.captureExtras.widgetUnavailable}</Text>
      {error ? <Text accessibilityRole="alert" style={{ ...footnote, color: colors.attentionText }}>{t.captureExtras.widgetError}</Text> : null}
    </View>
  </Card>;
}
