import type { TextStyle } from 'react-native';

export const lightColors = {
  background: '#F5F3EE',
  surface: '#FFFFFF',
  text: '#14150F',
  muted: '#6E7066',
  border: '#E4E2D9',
  accent: '#BBDC8E',
  accentSoft: '#EFF6E3',
  accentDeep: '#3F5233',
  accentText: '#3F5233',
  neutralSoft: '#F0EFE9',
  success: '#3F5233',
  successSoft: '#F0F1EC',
  /** Fills, bars and borders only: 2.5:1 on white is too faint for text. */
  attention: '#C89B4B',
  /** Amber for text and meaningful icons: 5.4:1 or better on surface, canvas and attentionSoft. */
  attentionText: '#7F5A1E',
  attentionSoft: '#F6EFE1',
  error: '#8A5D28',
  camera: '#14150F',
  cameraSoft: '#25261F',
  white: '#FFFFFF',
  onAccent: '#14150F',
  onDeep: '#FFFFFF',
  // Macro colours are for bars and dots. Their labels stay ink or muted:
  // carbs amber is 2.3:1 on white and would fail as text.
  macroProtein: '#5E8C3A',
  macroCarbs: '#D9A441',
  macroFat: '#C9775A',
} as const;

export type ThemeColors = { [Key in keyof typeof lightColors]: string };
export const darkColors: ThemeColors = {
  background: '#10120E',
  surface: '#191C16',
  text: '#F4F3EC',
  muted: '#A8AA9F',
  border: '#30342A',
  accent: '#BBDC8E',
  accentSoft: '#202A1C',
  accentDeep: '#3F5233',
  accentText: '#BBDC8E',
  neutralSoft: '#22251F',
  success: '#BBDC8E',
  successSoft: '#1C281B',
  attention: '#D7AA56',
  attentionText: '#D7AA56',
  attentionSoft: '#302719',
  error: '#E2A16C',
  camera: '#0C0E0B',
  cameraSoft: '#171A15',
  white: '#FFFFFF',
  onAccent: '#14150F',
  onDeep: '#FFFFFF',
  macroProtein: '#9CCB6E',
  macroCarbs: '#E5BA5E',
  macroFat: '#DE937A',
};

/**
 * The first launch follows the system appearance. Screens subscribe to
 * ThemeProvider; this fallback is only for the outer error boundary and pure defaults.
 */
export const colors = lightColors;

export const radii = {
  card: 18,
  sheet: 28,
  button: 999,
  chip: 12,
  input: 14,
  pill: 999,
} as const;

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/** The only shadow in the app: the central Scan button. It follows the active theme. */
export function scanShadow(mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  return {
    shadowColor: dark ? '#000000' : '#14150F',
    shadowOpacity: dark ? 0.28 : 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  } as const;
}

/**
 * Text styles. Every step carries its own line height and tracking, so a
 * paragraph never sits on a cramped default line box. Spread a step first
 * and override only colour, weight or alignment:
 *
 *   title: { ...typeScale.title2, color: colors.text, fontWeight: '700' }
 *
 * Headings track slightly tighter, reading text stays at 0. Card descriptions
 * use subhead or footnote in muted colour and are never larger than the card
 * title. React Native scales fontSize and lineHeight together with Dynamic Type.
 */
export const typeScale = {
  display: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  title1: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  title2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2, fontWeight: '600' },
  /** Row and button titles: one step under headline. */
  label: { fontSize: 16, lineHeight: 21, letterSpacing: -0.1, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 23, letterSpacing: 0 },
  callout: { fontSize: 15, lineHeight: 21, letterSpacing: 0 },
  subhead: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  /** The floor: no rendered text goes below 12 pt. */
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  eyebrow: { fontSize: 12, lineHeight: 16, letterSpacing: 0.8, fontWeight: '600', textTransform: 'uppercase' },
} as const satisfies Record<string, TextStyle>;

/**
 * Tight numeric hero figures (ring totals, the plan calorie number) stop
 * growing at 130% Dynamic Type so they stay on one line; body text is never capped.
 */
export const HERO_MAX_FONT_SCALE = 1.3;
