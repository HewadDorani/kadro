import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const VISIBLE_MS = 2200;

/**
 * A short confirmation ("Zu Favoriten hinzugefügt") that floats above the
 * screen for about two seconds and never blocks a touch. VoiceOver hears it
 * as an announcement. Render `toast` through Screen's `overlay`.
 */
export function useToast() {
  const [message, setMessage] = useState<{ text: string; serial: number } | null>(null);
  const serial = useRef(0);
  const show = useCallback((text: string) => {
    serial.current += 1;
    setMessage({ text, serial: serial.current });
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
  const toast = message ? <Toast key={message.serial} onDone={() => setMessage(null)} text={message.text} /> : null;
  return { toast, show };
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    const appear = reduceMotion ? null : Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true });
    appear?.start();
    const timer = setTimeout(() => {
      if (reduceMotion) { onDone(); return; }
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => onDone());
    }, VISIBLE_MS);
    return () => { clearTimeout(timer); appear?.stop(); };
    // One toast instance per message (keyed by serial).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 24 }]}>
      <Animated.View accessibilityLiveRegion="polite" style={[styles.toast, { opacity }]}>
        <Ionicons color={colors.accent} name="checkmark-circle" size={18} />
        <Text style={styles.text}>{text}</Text>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: '100%', minHeight: 44, borderRadius: radii.pill, backgroundColor: colors.camera, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { ...typeScale.subhead, flexShrink: 1, color: colors.white, fontWeight: '700' },
});
