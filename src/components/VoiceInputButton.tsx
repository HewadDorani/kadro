import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { useLanguage } from '@/i18n/LanguageProvider';
import { selectionHaptic } from '@/services/haptics';
import { createDictation, VOICE_STOP_GRACE_MS, type Dictation, type VoiceErrorKind, type VoiceNative } from '@/services/voiceDictation';

type SpeechModule = typeof import('expo-speech-recognition');

// Loaded once. Builds without the native module (web, older binaries)
// simply show no microphone instead of failing.
let speechModule: SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speechModule = require('expo-speech-recognition') as SpeechModule;
} catch { speechModule = null; }

// Availability is asked when the sheet opens, not at app start: right after
// install iOS can report "unavailable" for a moment, which used to hide the
// microphone until the next launch.
function recognitionAvailable() {
  try { return speechModule?.isRecognitionAvailable() === true; } catch { return false; }
}

/**
 * Speak the meal instead of typing it. Apple's speech recognition turns it
 * into text live (on device when available); nothing is recorded or stored.
 * Words appear while speaking, are appended to what is already typed, and
 * failures show a short message instead of doing nothing.
 * Without the native module (web, old builds) the button is simply absent.
 */
export function VoiceInputButton({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { language, t } = useLanguage();
  const [available, setAvailable] = useState(recognitionAvailable);
  useEffect(() => {
    if (available) return;
    // A late "ready" from iOS still brings the microphone in.
    const timer = setTimeout(() => setAvailable(recognitionAvailable()), 600);
    return () => clearTimeout(timer);
  }, [available]);
  const speech = available ? speechModule : null;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<VoiceErrorKind | null>(null);
  const dictation = useRef<Dictation | null>(null);
  // Results arrive outside React; they always reach the current field setter.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const clearStopTimer = () => { if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; } };

  useEffect(() => {
    if (!speech) return;
    // Listeners must be added on the native module itself (see voiceDictation.ts).
    const controller = createDictation(speech.ExpoSpeechRecognitionModule as unknown as VoiceNative, {
      onText: text => onChangeRef.current(text),
      onListening: setListening,
      onError: setError,
    });
    dictation.current = controller;
    return () => { clearStopTimer(); controller.dispose(); dictation.current = null; };
  }, [speech]);

  useEffect(() => {
    if (!listening) { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  if (!speech) return null;

  const toggle = async () => {
    void selectionHaptic();
    if (listening) {
      // Stop must feel instant. iOS can take seconds to report "end" for
      // continuous on-device recognition (or never), which used to leave the
      // button pulsing as if it could not be stopped. The last words still
      // arrive as a final result and are kept; if iOS does not finish, abort.
      dictation.current?.stop();
      clearStopTimer();
      stopTimer.current = setTimeout(() => { stopTimer.current = null; dictation.current?.abortFallback(); }, VOICE_STOP_GRACE_MS);
      return;
    }
    setError(null);
    let granted = false;
    try {
      granted = (await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
    } catch {
      setError('unavailable');
      return;
    }
    if (!granted) {
      setError('denied');
      Alert.alert(t.scan.voiceDeniedTitle, t.scan.voiceDeniedBody, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.scan.voiceOpenSettings, onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    // A pending abort from the previous stop must not cut off this new session.
    clearStopTimer();
    dictation.current?.start(value, {
      lang: language === 'de' ? 'de-DE' : 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      requiresOnDeviceRecognition: speech.supportsOnDeviceRecognition(),
      contextualStrings: t.scan.voiceVocabulary,
    });
  };

  const errorText = error ? t.scan.voiceErrors[error] : null;
  const ring = { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }] };
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={listening ? t.scan.voiceStop : t.scan.voiceStart}
        accessibilityRole="button"
        accessibilityState={{ selected: listening }}
        onPress={() => void toggle()}
        style={({ pressed }) => [styles.button, listening && styles.buttonActive, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        {listening ? <Animated.View pointerEvents="none" style={[styles.ring, ring]} /> : null}
        <Ionicons color={listening ? colors.onAccent : colors.text} name={listening ? 'stop' : 'mic'} size={22} />
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={errorText && !listening ? 'alert' : 'text'}
        style={[styles.hint, errorText && !listening && styles.error]}
      >
        {listening ? t.scan.voiceListening : errorText ?? t.scan.voiceHint}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  button: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  buttonActive: { backgroundColor: colors.accent },
  ring: { ...StyleSheet.absoluteFillObject, borderRadius: 26, backgroundColor: colors.accent },
  hint: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 19 },
  error: { color: colors.attentionText },
});
