import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KandroMark } from '@/components/KandroMark';
import { Screen } from '@/components/ui';
import { FREE_SCAN_ALLOWANCE } from '@/constants/product';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useFirstRun } from '@/hooks/useFirstRun';
import { useFreeScanAllowance } from '@/hooks/useHardWall';
import { useLanguage } from '@/i18n/LanguageProvider';
import { setFirstRunStage } from '@/services/firstRun';
import { markHardWallUsed } from '@/services/hardWall';
import { selectionHaptic } from '@/services/haptics';

type Option = { mode: 'photo' | 'description' | 'search'; icon: keyof typeof Ionicons.glyphMap; title: string; detail: string };

/**
 * The first value comes before any offer: right after the plan, one real
 * meal. Photo, speech and text are the three ways in; speech and text share
 * the description sheet, which has the microphone. It is the normal scan, so
 * it honestly counts as one of the free analyses. "Später" goes on to the
 * offer and the reminder question, never back into setup.
 *
 * Behind the hard wall (new installs, 10/2026) this scan is the one free
 * "Probe-Analyse"; "Später" skips it and goes straight to the hard paywall.
 */
export default function FirstScanScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useLanguage();
  const { freeScansLeft } = useApp();
  const stage = useFirstRun();
  const { hardWall } = useFreeScanAllowance();
  const leaving = useRef(false);
  if (stage === null && !leaving.current) return <Redirect href="/(tabs)/today" />;

  const copy = t.onboarding.firstScan;
  const options: Option[] = [
    { mode: 'photo', icon: 'camera-outline', title: copy.photo, detail: copy.photoDetail },
    { mode: 'description', icon: 'mic-outline', title: copy.speak, detail: copy.speakDetail },
    { mode: 'description', icon: 'create-outline', title: copy.type, detail: copy.typeDetail },
    // Free and instant: sceptics still reach the result ("what fits next") before any offer.
    { mode: 'search', icon: 'search-outline', title: copy.search, detail: copy.searchDetail },
  ];
  const allowance = hardWall
    ? copy.trialScan
    : freeScansLeft >= FREE_SCAN_ALLOWANCE
    ? copy.allowanceFirst(FREE_SCAN_ALLOWANCE)
    : freeScansLeft > 0 ? copy.allowanceLeft(freeScansLeft, FREE_SCAN_ALLOWANCE) : copy.allowanceUsed;
  const open = (mode: Option['mode']) => {
    if (leaving.current) return;
    void selectionHaptic();
    router.replace({ pathname: '/(tabs)/scan', params: mode === 'search' ? { mode, first: '1' } : { mode } });
  };
  const later = async () => {
    if (leaving.current) return;
    leaving.current = true;
    void selectionHaptic();
    // Skipping the free scan ends the free scope of a hard-wall install.
    await markHardWallUsed();
    await setFirstRunStage('paywall');
    router.replace('/paywall');
  };

  return (
    <Screen>
      <View style={styles.content}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mark}><KandroMark size={40} /></View>
        <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <View style={styles.options}>
          {options.map(option => (
            <Pressable
              accessibilityHint={option.detail}
              accessibilityLabel={option.title}
              accessibilityRole="button"
              key={option.icon}
              onPress={() => open(option.mode)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <View style={styles.optionIcon}><Ionicons color={colors.onAccent} name={option.icon} size={22} /></View>
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              <Ionicons color={colors.muted} name="chevron-forward" size={20} />
            </Pressable>
          ))}
        </View>
        <View style={styles.allowance}>
          <Ionicons color={colors.accentText} name="sparkles-outline" size={16} />
          <Text style={styles.allowanceText}>{allowance}</Text>
        </View>
        <Pressable accessibilityLabel={copy.later} accessibilityRole="button" hitSlop={8} onPress={() => void later()} style={styles.later}>
          <Text style={styles.laterText}>{copy.later}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  content: { flexGrow: 1, gap: 14, paddingTop: 28 },
  mark: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -1 },
  subtitle: { ...typeScale.body, color: colors.muted },
  options: { gap: 12, marginTop: 10 },
  option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14 },
  pressed: { transform: [{ scale: 0.985 }] },
  optionIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1, minWidth: 0, gap: 3 },
  optionTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  optionDetail: { ...typeScale.footnote, color: colors.muted },
  allowance: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4, paddingHorizontal: 4 },
  allowanceText: { ...typeScale.footnote, flex: 1, color: colors.muted },
  // Deliberately quiet: skipping the sample means meeting the paywall without having seen a result.
  later: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, marginTop: 10 },
  laterText: { ...typeScale.footnote, color: colors.muted, fontWeight: '400' },
});
