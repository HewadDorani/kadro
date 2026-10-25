import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardEvent, Platform } from 'react-native';

// iOS keyboard curve: the sheet rides up exactly with the keyboard, instead of
// a layout pass that lags behind it.
const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1);

/** Animated bottom inset that follows the system keyboard frame and timing. */
export function useKeyboardInset(active = true) {
  const inset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { inset.setValue(0); return; }
    const move = (to: number, event?: KeyboardEvent) => {
      Animated.timing(inset, {
        toValue: to,
        duration: event?.duration || 250,
        easing: KEYBOARD_EASING,
        useNativeDriver: false,
      }).start();
    };
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => move(event.endCoordinates.height, event));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', event => move(0, event));
    return () => { show.remove(); hide.remove(); };
  }, [active, inset]);
  return inset;
}

/** Whether the system keyboard is up; sheets drop their home-indicator padding then. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}
