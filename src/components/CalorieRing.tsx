import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useLanguage } from '@/i18n/LanguageProvider';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
import { formatNumber } from '@/utils/format';
import { HERO_MAX_FONT_SCALE, typeScale } from '@/constants/theme';

// Screen padding (2 x 20) plus hero card padding (2 x 20).
const HORIZONTAL_CHROME = 80;
const MAX_SIZE = 220;
const MIN_SIZE = 168;
/** Up to this share over the target reads as "slightly over". */
const SLIGHT_OVER_SHARE = 0.1;

/**
 * Graded and calm: a few bites over the target are "Leicht drüber", a clearly
 * bigger day is "Über deinem Ziel". Never red, never an alarm.
 */
export function overBudgetLevel(consumed: number, total: number): 'none' | 'slight' | 'over' {
  if (!(total > 0) || consumed <= total) return 'none';
  return consumed - total <= total * SLIGHT_OVER_SHARE ? 'slight' : 'over';
}

export function CalorieRing({
  consumed,
  total,
  proteinReached = false,
}: {
  consumed: number;
  total: number;
  /** Quietly acknowledges the one goal the user actually controls. */
  proteinReached?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { locale, t } = useLanguage();
  // The ring used to be a hard 220pt, which overflowed the hero card on the
  // narrowest phones. It now shrinks with the viewport instead.
  // Side figures (eaten · goal) only when the phone is wide enough for both.
  const showSides = width >= 360;
  const size = Math.round(Math.min(showSides ? 176 : MAX_SIZE, Math.max(MIN_SIZE - (showSides ? 18 : 0), width - HORIZONTAL_CHROME - (showSides ? 150 : 0))));
  const stroke = Math.round(size * 0.077);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = total > 0 ? total : 1;
  const remaining = Math.max(0, total - consumed);
  const over = Math.max(0, consumed - total);
  const consumedRatio = Math.min(1, Math.max(0, consumed / safeTotal));
  // Warm amber at most; the ring never turns into a red warning.
  const ringColor = over > 0 ? colors.attention : colors.accentText;
  const celebrating = proteinReached && over === 0;
  // Every logged meal visibly fills the ring: the moment of progress is felt.
  const reduceMotion = useReducedMotion();
  const fill = useRef(new Animated.Value(consumedRatio)).current;
  useEffect(() => {
    if (reduceMotion) { fill.setValue(consumedRatio); return; }
    Animated.timing(fill, { toValue: consumedRatio, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [consumedRatio, fill, reduceMotion]);
  const dashOffset = fill.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });

  const side = (value: number, label: string) => (
    <View style={styles.side}>
      <Text adjustsFontSizeToFit maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} numberOfLines={1} style={styles.sideValue}>{formatNumber(value, locale)}</Text>
      <Text adjustsFontSizeToFit maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} minimumFontScale={0.7} numberOfLines={1} style={styles.sideLabel}>{label}</Text>
    </View>
  );

  return (
    <View
      accessibilityLabel={over > 0
        ? `${over} ${t.ring.over}`
        : `${remaining} ${t.ring.left}${celebrating ? `, ${t.ring.proteinDone}` : ''}`}
      style={styles.outer}
    >
      {showSides ? side(consumed, t.ring.eaten) : null}
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg height={size} style={styles.svg} width={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={colors.neutralSoft}
            strokeWidth={stroke}
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={ringColor}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={stroke}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.inner}>
          {/* Everything inside the ring has a fixed circle to fit: it follows
              Dynamic Type up to 130%, then the ring itself is the limit. */}
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={HERO_MAX_FONT_SCALE}
            numberOfLines={1}
            style={[styles.value, { fontSize: Math.round(size * 0.2), lineHeight: Math.round(size * 0.23) }]}
          >
            {formatNumber(over > 0 ? over : remaining, locale)}
          </Text>
          <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.label}>{over > 0 ? t.ring.over : t.ring.left}</Text>
          {/* 10.11.2026 (owner TestFlight report): a chip here made the content taller
              than the ring, so iOS shrank the number to a dot. The protein win is the
              check mark on the Protein bar below; the ring keeps the number alone. */}
        </View>
      </View>
      {showSides ? side(total, t.ring.goal) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  outer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  side: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  sideValue: {
    ...typeScale.title2,
    color: colors.text,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sideLabel: {
    ...typeScale.eyebrow,
    color: colors.muted,
    fontWeight: '700',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  value: {
    color: colors.text,
    fontWeight: '600',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  label: {
    ...typeScale.subhead,
    color: colors.muted,
    fontWeight: '600',
    marginTop: 0,
  },
});
