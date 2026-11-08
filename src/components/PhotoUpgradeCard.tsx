import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, IconCircle, PrimaryButton } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { dismissPhotoUpgrade, offersPhotoUpgrade } from '@/services/consent';
import { successHaptic } from '@/services/haptics';

/**
 * One optional card for people who agreed before Amazon Bedrock was named:
 * the better photo model needs their consent to the new recipient. A news
 * item, not a gate: "Später" hides it for good and nothing else changes.
 */
export function PhotoUpgradeCard() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const router = useRouter();
  const { grantWellnessConsent, hydrationReady, profile, wellnessConsentGranted } = useApp();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const copy = t.photoUpgrade;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  useEffect(() => {
    if (!hydrationReady || !wellnessConsentGranted || !profile.completedAt) return;
    let active = true;
    void offersPhotoUpgrade().then((offer) => { if (active) setVisible(offer); });
    return () => { active = false; };
  }, [hydrationReady, profile.completedAt, wellnessConsentGranted]);

  // Granting consent re-hydrates the app, which re-runs the check above and
  // reports no offer any more; the confirmation still stays for its moment.
  if (!visible && !done) return null;

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await grantWellnessConsent(profile.age);
      void successHaptic();
      setDone(true);
      hideTimer.current = setTimeout(() => { setDone(false); setVisible(false); }, 2600);
    } catch {
      Alert.alert(copy.failed);
    } finally {
      setBusy(false);
    }
  };
  const later = () => { setVisible(false); void dismissPhotoUpgrade(); };

  if (done) {
    return (
      <Card style={styles.card}>
        <View style={styles.head}>
          <IconCircle name="checkmark" size={40} />
          <Text accessibilityLiveRegion="polite" style={styles.title}>{copy.done}</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <IconCircle name="sparkles-outline" size={40} />
        <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
      </View>
      <Text style={styles.body}>{copy.body}</Text>
      <Text style={styles.note}>{copy.privacy}</Text>
      <PrimaryButton disabled={busy} icon="sparkles-outline" label={busy ? t.common.moment : copy.activate} onPress={() => void activate()} />
      <View style={styles.links}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={later}><Text style={styles.link}>{copy.later}</Text></Pressable>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/privacy')}><Text style={styles.link}>{copy.details}</Text></Pressable>
      </View>
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { ...typeScale.headline, color: colors.text, fontWeight: '600', flex: 1 },
  body: { ...typeScale.callout, color: colors.text },
  note: { ...typeScale.footnote, color: colors.muted },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { ...typeScale.subhead, color: colors.accentText, fontWeight: '600' },
});
