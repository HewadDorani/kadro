import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { stepHaptic } from '@/services/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useLanguage } from '@/i18n/LanguageProvider';
import { explainTargets } from '@/services/personalization';
import type { UserProfile } from '@/types/nutrition';
import { formatNumber } from '@/utils/format';
import { HERO_MAX_FONT_SCALE, typeScale } from '@/constants/theme';

/** Long enough to watch the number settle, short enough not to be a wait. */
export const BUILDING_MS = 3400;

const SIZE = 172;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** 25 frames a second: smooth enough for a climbing number, cheap enough. */
const FRAME_MS = 40;

/**
 * Interpolates the chain of intermediate values at a point in the run.
 *
 * Exported because the timing is the whole illusion: the number has to reach
 * each step's value exactly as that step is announced, and end on the last
 * one, or the animation is telling a different story from the arithmetic.
 */
export function frameAt(progress: number, steps: { value: number; unit: string }[]) {
  if (!steps.length) return { index: 0, value: 0, settled: 0 };
  const clamped = Math.min(1, Math.max(0, progress));
  const slot = 1 / steps.length;
  const index = Math.min(steps.length - 1, Math.floor(clamped / slot));
  // Each value climbs over the first three quarters of its slot and then
  // holds, so it is legible at rest before the next one starts.
  const within = Math.min(1, ((clamped - index * slot) / slot) / 0.75);
  const previous = steps[index - 1];
  // Carrying the kilocalorie figure into the protein step counted 1630 down to
  // 140, which reads as the target collapsing rather than a new number being
  // worked out. A change of unit starts again from zero.
  const from = !previous || previous.unit !== steps[index].unit ? 0 : previous.value;
  return {
    index,
    value: Math.round(from + (steps[index].value - from) * within),
    // How many values have finished climbing, for the ticked list below.
    settled: within >= 1 ? index + 1 : index,
  };
}

/**
 * The pause while the plan is worked out.
 *
 * Lines fading in under one another read as a list being printed, not as work
 * being done. The ring fills, an arc turns, and the figure climbs through each
 * real intermediate value: resting energy, then activity, then the goal :
 * landing on exactly the number the next screen shows.
 */
export function PlanBuilder({ profile, showcase = false }: { profile: UserProfile; showcase?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const steps = useMemo(() => explainTargets(profile), [profile]);

  const [progress, setProgress] = useState(reduceMotion ? 1 : 0);
  const spin = useRef(new Animated.Value(0)).current;
  const ticked = useRef(0);

  useEffect(() => {
    if (reduceMotion) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const next = Math.min(1, (Date.now() - started) / BUILDING_MS);
      setProgress(next);
      if (next >= 1) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        // On the web build the native driver runs the first turn and then
        // stops, leaving the arc frozen at zero: a still spinner reads as a
        // hung screen, which is the one thing this must never look like.
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  const frame = frameAt(progress, steps);

  // One tick per value that lands, so the count is felt as well as seen.
  useEffect(() => {
    if (reduceMotion || frame.settled <= ticked.current) return;
    ticked.current = frame.settled;
    void stepHaptic(true);
  }, [frame.settled, reduceMotion]);

  const current = steps[frame.index];
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View
      accessibilityLabel={t.onboarding.buildingHeadline}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.wrap}
    >
      <View style={styles.ring}>
        <Svg height={SIZE} style={StyleSheet.absoluteFill} width={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} fill="none" r={RADIUS} stroke={colors.neutralSoft} strokeWidth={STROKE} />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            fill="none"
            r={RADIUS}
            stroke={colors.accentText}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            strokeLinecap="round"
            strokeWidth={STROKE}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        {/* The turning arc is the only thing that never stops: the ring can sit
            still between values, and a still screen reads as a stuck one. */}
        <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]}>
          <Svg height={SIZE} width={SIZE}>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              fill="none"
              r={RADIUS - STROKE - 4}
              stroke={colors.accent}
              strokeDasharray={`${CIRCUMFERENCE * 0.12} ${CIRCUMFERENCE}`}
              strokeLinecap="round"
              strokeWidth={3}
            />
          </Svg>
        </Animated.View>
        <View style={styles.centre}>
          <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} adjustsFontSizeToFit numberOfLines={1} style={styles.value}>
            {formatNumber(frame.value, locale)}
          </Text>
          <Text style={styles.unit}>{current?.unit === 'g' ? t.onboarding.proteinUnit : t.onboarding.kilocalories}</Text>
        </View>
      </View>

      <Text numberOfLines={2} style={styles.caption}>{current ? t.onboarding.targetStep[current.id] : ''}</Text>

      {showcase ? <View style={styles.showcase}>
        <Text style={styles.showcaseTitle}>{t.onboarding.showcaseTitle}</Text>
        {([['camera', t.onboarding.showcasePhoto], ['mic', t.onboarding.showcaseVoice], ['barcode-outline', t.onboarding.showcaseBarcode]] as const).map(([icon, label]) => (
          <View key={icon} style={styles.showcaseRow}>
            <View style={styles.showcaseIcon}><Ionicons color={colors.accentText} name={icon} size={18} /></View>
            <Text style={styles.showcaseText}>{label}</Text>
          </View>
        ))}
      </View> : null}
      <View style={styles.dots}>
        {steps.map((step, index) => (
          <View
            key={step.id}
            style={[
              styles.dot,
              index < frame.settled && styles.dotDone,
              index === frame.index && frame.settled === index && styles.dotActive,
            ]}
          >
            {index < frame.settled ? <Ionicons color={colors.onAccent} name="checkmark" size={11} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', gap: 18 },
  ring: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centre: { alignItems: 'center', paddingHorizontal: 20 },
  value: { color: colors.text, fontSize: 42, lineHeight: 47, fontWeight: '700', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  unit: { ...typeScale.footnote, color: colors.muted, marginTop: -2 },
  caption: { ...typeScale.callout, color: colors.text, fontWeight: '600', textAlign: 'center', minHeight: 44, paddingHorizontal: 8 },
  dots: { flexDirection: 'row', gap: 8 },
  showcase: { alignSelf: 'stretch', gap: 10, marginTop: 6, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16 },
  showcaseTitle: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 1 },
  showcaseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  showcaseIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  showcaseText: { ...typeScale.callout, flex: 1, color: colors.text, fontWeight: '600' },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.accent },
  dotActive: { backgroundColor: colors.accentSoft },
});
