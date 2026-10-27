import { Animated, StyleSheet } from 'react-native';

import { useKeyboardInset } from '@/hooks/useKeyboardInset';

/**
 * A bottom sheet that rides on the keyboard ends at the keyboard's top edge.
 * The iOS keyboard has rounded top corners, so the dark scrim showed through
 * beside them and the sheet looked cut off. This fills the strip behind the
 * keyboard with the sheet's own color (with a small overlap once it is up).
 * Render it as the scrim's first child, so it stays behind the sheet.
 */
export function KeyboardBackfill({ color }: { color: string }) {
  const inset = useKeyboardInset();
  return <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: color, height: inset.interpolate({ inputRange: [0, 1, 10000], outputRange: [0, 25, 10024] }) }]} />;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
