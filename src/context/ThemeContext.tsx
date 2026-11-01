import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { AccentChoice, lightColors, ThemeColors, themeColors } from '@/constants/theme';

type ThemeMode = 'light' | 'dark';
/** What the person chose in Du. `system` follows the iPhone's appearance. */
export type ThemePreference = 'system' | ThemeMode;
const STORAGE_KEY = 'kandro:appearance:v1';
const ACCENT_KEY = 'kandro:accent:v1';

/**
 * Builds before 1.0.4 only wrote this key when someone picked Hell or Dunkel,
 * so a stored value is an explicit choice and is kept. No value means the
 * person never chose: follow the system.
 */
export function readThemePreference(value: string | null): ThemePreference {
  return value === 'dark' || value === 'light' ? value : 'system';
}

const ThemeContext = createContext({
  mode: 'light' as ThemeMode,
  preference: 'system' as ThemePreference,
  colors: lightColors as ThemeColors,
  setPreference: (_preference: ThemePreference) => {},
  accent: 'pistachio' as AccentChoice,
  setAccent: (_accent: AccentChoice) => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, updatePreference] = useState<ThemePreference>('system');
  const [accent, updateAccent] = useState<AccentChoice>('pistachio');
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());
  const systemScheme = useColorScheme();
  useEffect(() => {
    let active = true;
    void AsyncStorage.multiGet([STORAGE_KEY, ACCENT_KEY]).then(([[, value], [, storedAccent]]) => {
      if (!active) return;
      updatePreference(readThemePreference(value));
      if (storedAccent === 'rose') updateAccent('rose');
    }).catch(() => undefined).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  // An explicit choice also drives native chrome (keyboard, alerts); `null`
  // hands the appearance back to the system.
  useEffect(() => { if (Platform.OS !== 'web') Appearance.setColorScheme(preference === 'system' ? null : preference); }, [preference]);
  const mode: ThemeMode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo(() => ({
    mode, preference, accent, colors: themeColors(mode, accent),
    setPreference: (next: ThemePreference) => {
      updatePreference(next);
      writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, next)).catch(() => undefined);
    },
    setAccent: (next: AccentChoice) => {
      updateAccent(next);
      writes.current = writes.current.then(() => AsyncStorage.setItem(ACCENT_KEY, next)).catch(() => undefined);
    },
  }), [accent, mode, preference]);
  if (!ready) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
