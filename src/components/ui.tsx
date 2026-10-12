import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSegments } from 'expo-router';
import { PropsWithChildren, ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  PressableProps,
  PressableStateCallbackType,
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Rect } from 'react-native-svg';

import { HERO_MAX_FONT_SCALE, radii, spacing, typeScale } from '@/constants/theme';
import { useLanguage } from '@/i18n/LanguageProvider';
import { TAB_BAR_CONTENT_HEIGHT } from '@/constants/layout';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { stepHaptic } from '@/services/haptics';
import type { ConfidenceLevel } from '@/utils/confidence';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The one press feel for buttons and tappable cards: 0.98 and a light tick. */
export const PRESS_SCALE = 0.98;

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /** Light impact on touch-down. Off where the screen plays its own haptic on press. */
  haptic?: boolean;
};

/**
 * Shared press feedback. The card eases to 98% while the finger is down and
 * springs back; Reduce Motion swaps the movement for a quiet opacity change.
 */
export function PressableScale({ haptic = true, onPressIn, onPressOut, style, disabled, children, ...rest }: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  // Function styles are resolved here: Animated cannot see values returned
  // from a style callback, so the component hands it a plain array instead.
  const [isPressed, setPressed] = useState(false);
  const animate = (down: boolean) => {
    setPressed(down);
    if (reduceMotion) return;
    Animated.spring(scale, { toValue: down ? PRESS_SCALE : 1, speed: 40, bounciness: down ? 0 : 6, useNativeDriver: true }).start();
  };
  const handlePressIn = (event: GestureResponderEvent) => {
    animate(true);
    if (haptic && !disabled) void stepHaptic(true);
    onPressIn?.(event);
  };
  const handlePressOut = (event: GestureResponderEvent) => {
    animate(false);
    onPressOut?.(event);
  };
  // Expo's web typings widen the state with hovered/focused; native only reports pressed.
  const resolved = typeof style === 'function' ? style({ pressed: isPressed } as PressableStateCallbackType) : style;
  const motion = reduceMotion ? (isPressed ? { opacity: 0.72 } : null) : { transform: [{ scale }] };
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[resolved, motion]}
    >
      {children}
    </AnimatedPressable>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'dark' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Light tick on touch-down. Opt-in, so screens that already confirm with their own haptic stay single. */
  haptic?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  style,
  haptic = false,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dark = variant === 'dark';
  const ghost = variant === 'ghost';
  const secondary = variant === 'secondary';
  const lightText = variant === 'primary' || dark;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      haptic={haptic}
      onPress={onPress}
      style={[
        styles.button,
        dark && styles.buttonDark,
        secondary && styles.buttonSecondary,
        ghost && styles.buttonGhost,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={[styles.buttonText, lightText && styles.buttonTextLight, dark && { color: colors.surface }, ghost && styles.buttonTextDark]}>
        {label}
      </Text>
      {icon ? (
        <Ionicons
          color={dark ? colors.surface : lightText ? colors.onDeep : colors.text}
          name={icon}
          size={18}
        />
      ) : null}
    </PressableScale>
  );
}

export function Screen({
  children,
  scroll = true,
  style,
  refreshControl,
}: PropsWithChildren<{ scroll?: boolean; style?: StyleProp<ViewStyle>; refreshControl?: ReactElement<RefreshControlProps> }>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  // Tab screens scroll underneath the floating tab bar, every other screen only
  // has to clear the home indicator. Both used to share one hard-coded 126pt
  // padding, which cut content off on tall-inset phones and wasted space on the
  // rest.
  const underTabBar = segments[0] === '(tabs)';
  const paddingBottom = underTabBar
    ? TAB_BAR_CONTENT_HEIGHT + insets.bottom + spacing.xl
    : insets.bottom + spacing.xxl;

  if (!scroll) {
    return (
      <SafeAreaView edges={['top']} style={[styles.safe, style]}>
        {children}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, style]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[styles.scrollContent, { paddingBottom }]}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children, light = false }: PropsWithChildren<{ light?: boolean }>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.eyebrow, light && styles.lightText]}>{children}</Text>;
}

export function PageTitle({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.pageTitle}>{children}</Text>;
}

export function SectionTitle({ children, action }: PropsWithChildren<{ action?: ReactNode }>) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

/**
 * One row of a grouped settings card, like iOS Settings: a 36 pt icon in a
 * soft circle, a title with an optional muted description, and an optional
 * control on the right that centres on the text block.
 */
export function SettingsRow({
  icon,
  label,
  detail,
  accessory,
  disabled = false,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  accessory?: ReactNode;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.settingsRow, !detail && styles.settingsRowSingle, disabled && styles.settingsRowDisabled]}>
      {icon ? <View style={styles.settingsIcon}><Ionicons color={colors.text} name={icon} size={18} /></View> : null}
      <View style={styles.settingsCopy}>
        <Text style={styles.settingsLabel}>{label}</Text>
        {detail ? <Text style={styles.settingsDetail}>{detail}</Text> : null}
      </View>
      {accessory}
    </View>
  );
}

/**
 * Hairline between rows of a grouped card. It starts where the row text
 * starts: at the text column after an icon, or at the row padding without one.
 */
export function ListDivider({ inset = true }: { inset?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.listDivider, inset ? styles.listDividerInset : styles.listDividerFlush]} />;
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // A target of zero makes callers hand us 0/0 or x/0. NaN survives min and
  // max and would reach the style as width: "NaN%"; an exceeded target is a
  // full bar, not an empty one.
  const safeValue = Number.isFinite(value) ? value : (value > 0 ? 1 : 0);
  const percentage = Math.round(Math.min(1, Math.max(0, safeValue)) * 100);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percentage }} style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percentage}%`, backgroundColor: color ?? colors.accentText }]} />
    </View>
  );
}

export function MacroCard({
  label,
  current,
  target,
  unit = 'g',
  icon,
  minimum = false,
  tint,
}: {
  label: string;
  current: number;
  target: number;
  unit?: string;
  /** Macro colour for the bar; defaults to the accent. */
  tint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Protein is a minimum: more is fine. Carbs/fat are guides: far above is not "done". */
  minimum?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  // 10% tolerance, same as the weekly strip: 175 of 180 g is a day that went
  // fine, and calling it a miss is the kind of nagging this app avoids.
  const reached = target > 0 && current >= target * 0.9 && (minimum || current <= target * 1.1);
  const over = !minimum && target > 0 && current > target * 1.1;
  return (
    <Card style={styles.macroCard}>
      <View style={[styles.macroIcon, reached && styles.macroIconReached]}>
        <Ionicons color={reached ? colors.onAccent : colors.text} name={reached ? 'checkmark' : over ? 'information-circle-outline' : icon} size={16} />
      </View>
      <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} numberOfLines={1} style={styles.macroLabel}>{label}</Text>
      {/* Three equal cards on a 320pt phone: the figure shrinks a little
          rather than cutting "/ 150 g" off. */}
      <Text adjustsFontSizeToFit maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} minimumFontScale={0.8} numberOfLines={1} style={styles.macroValue}>{current}<Text style={styles.macroUnit}> / {target} {unit}</Text></Text>
      <ProgressBar color={tint} value={current / target} />
    </Card>
  );
}

/** A calm "estimate" label. Model confidence is not shown as doubt to people. */
/**
 * Three states, each with its own symbol so colour is never the only signal:
 * ✓ Sicher (database values at a known amount), ◐ Geschätzt (portion or
 * values estimated), ! Bitte prüfen (something Kandro could not match itself).
 */
export function ConfidenceBadge({ level = 'estimated' }: { level?: ConfidenceLevel }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const copy = {
    sure: { icon: 'checkmark-circle' as const, label: t.confirm.confidenceSure, hint: t.confirm.confidenceSureHint, color: colors.success },
    estimated: { icon: 'contrast' as const, label: t.confirm.confidenceEstimated, hint: t.confirm.confidenceEstimatedHint, color: colors.text },
    check: { icon: 'alert-circle' as const, label: t.confirm.confidenceCheck, hint: t.confirm.confidenceCheckHint, color: colors.attentionText },
  }[level];
  return (
    <View accessibilityHint={copy.hint} accessibilityLabel={copy.label} accessible style={[styles.confidence, level === 'check' && styles.confidenceUncertain]}>
      <Ionicons color={copy.color} name={copy.icon} size={14} />
      <Text style={[styles.confidenceText, { color: copy.color }]}>{copy.label}</Text>
    </View>
  );
}

export type MealPhotoPlaceholder = 'demo' | 'description' | 'barcode' | 'search';

export function MealPhoto({ uri, height = 250, placeholder = 'demo', description, style }: { uri?: string | null; height?: number; placeholder?: MealPhotoPlaceholder; description?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const source: ImageSourcePropType = uri ? { uri } : require('../../assets/meal-bowl.jpg');
  if (!uri && placeholder !== 'demo') {
    // Anything that is not a photo gets its own frame. Falling back to the
    // stock bowl labelled EXAMPLE told the user their searched food was a
    // demo: and every input that is not the camera reaches this branch.
    const copy = {
      barcode: { icon: 'barcode-outline', alt: t.confirm.photoBarcodeAlt, title: t.confirm.photoBarcodeTitle, text: t.confirm.photoBarcodeText },
      description: { icon: 'create-outline', alt: t.confirm.photoDescribeAlt, title: t.confirm.photoDescribeTitle, text: t.confirm.photoDescribeText },
      search: { icon: 'search-outline', alt: t.confirm.photoSearchAlt, title: t.confirm.photoSearchTitle, text: t.confirm.photoSearchText },
    }[placeholder];
    return (
      <View accessibilityLabel={description || copy.alt} accessible style={[styles.photoFrame, styles.photoPlaceholder, { minHeight: height }, style]}>
        <View style={styles.photoPlaceholderIcon}>
          <Ionicons color={colors.onAccent} name={copy.icon as keyof typeof Ionicons.glyphMap} size={36} />
        </View>
        <Text style={styles.photoPlaceholderTitle}>{description || copy.title}</Text>
        <Text style={styles.photoPlaceholderText}>{copy.text}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.photoFrame, { height }, style]}>
      <Image
        accessibilityLabel={uri ? t.confirm.photoRealAlt : t.confirm.photoDemoAlt}
        accessible
        resizeMode={uri ? 'contain' : 'cover'}
        source={source}
        style={styles.photo}
      />
      {!uri ? (
        <View style={styles.demoBadge}>
          <Text style={styles.demoBadgeText}>{t.confirm.demoBadge}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function IconCircle({
  name,
  tone = 'accent',
  size = 44,
}: {
  name: keyof typeof Ionicons.glyphMap;
  tone?: 'accent' | 'neutral' | 'dark';
  size?: number;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={[
        styles.iconCircle,
        { width: size, height: size, borderRadius: size / 2 },
        tone === 'neutral' && styles.iconCircleNeutral,
        tone === 'dark' && styles.iconCircleDark,
      ]}
    >
      <Ionicons color={tone === 'dark' ? colors.surface : tone === 'accent' ? colors.onAccent : colors.text} name={name} size={Math.round(size * 0.45)} />
    </View>
  );
}

/**
 * A calm placeholder in the shape of what is coming, instead of an empty
 * flash. It breathes slowly; with Reduce Motion it simply stays put.
 */
export function SkeletonBlock({ height = 16, width = '100%', radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, width, borderRadius: radius, backgroundColor: colors.neutralSoft, opacity: pulse }, style]}
    />
  );
}

/**
 * Friendly empty-state art built from the brand's own shapes: a soft disc,
 * a partial ring like the Kandro mark, a pistachio dot and the topic's icon.
 * Decorative only: the caller's text carries the meaning.
 */
export function EmptyIllustration({ icon, size = 96 }: { icon: keyof typeof Ionicons.glyphMap; size?: number }) {
  const { colors } = useTheme();
  const c = size / 2;
  const r = size * 0.36;
  const circumference = 2 * Math.PI * r;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg height={size} style={StyleSheet.absoluteFill} width={size}>
        <Circle cx={c} cy={c} fill={colors.neutralSoft} r={size * 0.46} />
        <Circle cx={c} cy={c} fill="none" r={r} stroke={colors.border} strokeWidth={size * 0.05} />
        <Circle
          cx={c}
          cy={c}
          fill="none"
          r={r}
          stroke={colors.accentText}
          strokeDasharray={`${circumference * 0.62} ${circumference}`}
          strokeLinecap="round"
          strokeWidth={size * 0.05}
          transform={`rotate(-200 ${c} ${c})`}
        />
        <Circle cx={c + size * 0.31} cy={c - size * 0.31} fill={colors.accent} r={size * 0.075} />
        <Rect fill={colors.surface} height={size * 0.3} rx={size * 0.1} width={size * 0.3} x={c - size * 0.15} y={c - size * 0.15} />
      </Svg>
      <Ionicons color={colors.text} name={icon} size={Math.round(size * 0.2)} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  button: {
    minHeight: 56,
    borderRadius: radii.button,
    backgroundColor: colors.accentDeep,
    paddingHorizontal: 22,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonDark: {
    backgroundColor: colors.text,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    minHeight: 44,
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonText: {
    ...typeScale.label,
    flexShrink: 1,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '700',
  },
  buttonTextLight: {
    color: colors.white,
  },
  buttonTextDark: {
    color: colors.text,
  },
  eyebrow: {
    ...typeScale.eyebrow,
    color: colors.muted,
  },
  lightText: {
    color: 'rgba(255,255,255,0.72)',
  },
  pageTitle: {
    ...typeScale.display,
    color: colors.text,
    fontWeight: '700',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...typeScale.title2,
    color: colors.text,
    fontWeight: '700',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  // Grouped settings rows: content lines up with the 20 pt card padding
  // (8 card + 12 row), text starts at 60 pt so hairlines inset to it.
  settingsRow: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsRowSingle: {
    minHeight: 56,
  },
  settingsRowDisabled: {
    opacity: 0.55,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  settingsLabel: {
    ...typeScale.label,
    color: colors.text,
  },
  settingsDetail: {
    ...typeScale.footnote,
    color: colors.muted,
  },
  listDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  listDividerInset: {
    marginLeft: 60,
  },
  listDividerFlush: {
    marginHorizontal: 12,
  },
  macroCard: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderRadius: radii.card,
    gap: 4,
    justifyContent: 'space-between',
  },
  macroIconReached: {
    backgroundColor: colors.accent,
  },
  macroIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  macroLabel: {
    ...typeScale.caption,
    color: colors.muted,
    fontWeight: '600',
  },
  macroValue: {
    ...typeScale.title2,
    color: colors.text,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginBottom: 8,
  },
  macroUnit: {
    ...typeScale.footnote,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0,
  },
  confidence: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.neutralSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  confidenceUncertain: {
    backgroundColor: colors.attentionSoft,
  },
  confidenceText: {
    ...typeScale.caption,
    color: colors.success,
    fontWeight: '700',
  },
  confidenceTextUncertain: {
    color: colors.attentionText,
  },
  photoFrame: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radii.card,
    backgroundColor: colors.cameraSoft,
  },
  photoPlaceholder: { backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center', padding: 24 },
  photoPlaceholderIcon: { width: 70, height: 70, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderTitle: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '700', marginTop: 13 },
  photoPlaceholderText: { ...typeScale.footnote, color: colors.muted, textAlign: 'center', marginTop: 5, maxWidth: 260 },
  photo: {
    width: '100%',
    height: '100%',
  },
  demoBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(23,24,22,0.72)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  demoBadgeText: {
    ...typeScale.caption,
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  iconCircleNeutral: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircleDark: {
    backgroundColor: colors.text,
  },
});
