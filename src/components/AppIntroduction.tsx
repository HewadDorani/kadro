import { usePresentationBlock } from '@/services/presentation';
import { trackEvent } from '@/services/telemetry';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFreeScanAllowance } from '@/hooks/useHardWall';
import { PrimaryButton } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { typeScale } from '@/constants/theme';

/** Points at the existing five-tab navigation; no additional permissions. */
export function AppIntroduction({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  usePresentationBlock(true);
  const { t } = useLanguage();
  const { allowance } = useFreeScanAllowance();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const heading = useRef<Text>(null);
  const scroll = useRef<ScrollView>(null);
  const steps = [
    { title: t.intro.todayTitle, text: t.intro.todayText, tab: 0, icon: 'today-outline' },
    { title: t.intro.scanTitle, text: t.intro.scanText, tab: 2, icon: 'add-circle-outline' },
    { title: t.intro.planTitle, text: t.intro.planText, tab: 1, icon: 'sparkles-outline' },
    { title: t.intro.progressTitle, text: t.intro.progressText, tab: 3, icon: 'stats-chart-outline' },
    { title: t.intro.profileTitle, text: `${t.intro.profileText} ${t.intro.proText(allowance)}`, tab: 4, icon: 'person-outline' },
  ] as const;
  const current = steps[step];
  useEffect(() => { trackEvent('introduction step viewed', { step: (step + 1) as 1 | 2 | 3 | 4 | 5 }); }, [step]);
  const exit = (completed: boolean) => {
    trackEvent('introduction exited', { completed });
    if (completed) onStart(); else onClose();
  };
  const center = insets.left + (width - insets.left - insets.right) * (current.tab + 0.5) / 5;
  const targetSize = current.tab === 2 ? 72 : Math.min(64, (width - insets.left - insets.right) / 5 - 8);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (Platform.OS !== 'web') {
      const node = findNodeHandle(heading.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [step]);
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => handler.remove();
  }, [onClose]);

  return (
    <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.overlay}>
      <View pointerEvents="none" style={styles.scrim} />
      <View style={[styles.card, { bottom: insets.bottom + 140, maxHeight: Math.max(180, height - insets.top - insets.bottom - 165) }]}>
        <ScrollView ref={scroll} contentContainerStyle={styles.content}>
          <View style={styles.top}>
            <Ionicons name={current.icon} size={26} color={colors.accentText} />
            <Text style={styles.counter}>{t.intro.step(step + 1, steps.length)}</Text>
          </View>
          <Text ref={heading} accessible accessibilityRole="header" style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.text}</Text>
          <PrimaryButton label={step === steps.length - 1 ? t.intro.start : t.common.next} icon="arrow-forward" onPress={() => step === steps.length - 1 ? exit(true) : setStep(step + 1)} />
          <View style={styles.actions}>
            {step > 0 ? <PrimaryButton label={t.common.back} onPress={() => setStep(step - 1)} variant="ghost" style={styles.action} /> : null}
            <PrimaryButton label={t.intro.close} onPress={() => exit(false)} variant="ghost" style={styles.action} />
          </View>
        </ScrollView>
      </View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="arrow-down" size={32} color={colors.white} style={{ position: 'absolute', left: center - 16, bottom: insets.bottom + 78 }} />
        <View style={[styles.target, { width: targetSize, height: targetSize, borderRadius: targetSize / 2, left: center - targetSize / 2, bottom: insets.bottom + (current.tab === 2 ? 12 : 0) }]} />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,21,15,0.52)' },
  card: { position: 'absolute', left: 20, right: 20, borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  content: { padding: 22, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  counter: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  title: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '700' },
  body: { ...typeScale.body, color: colors.text },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, paddingHorizontal: 4 },
  target: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.accent },
});
