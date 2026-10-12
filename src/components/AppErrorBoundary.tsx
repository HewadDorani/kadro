import { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, typeScale } from '@/constants/theme';
import { getDictionary } from '@/i18n/active';
import { captureOperationalError } from '@/services/telemetry';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureOperationalError(error, {
      area: 'ui',
      operation: info.componentStack ? 'react_render' : 'unknown_render',
      code: error.name,
      fatal: true,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;

    // A class component cannot use the hook, and this screen appears exactly
    // when something already went wrong: so it reads the active dictionary
    // directly rather than shipping German to every reader.
    const t = getDictionary().errors;

    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>KANDRO</Text>
          <Text style={styles.title}>{t.crashTitle}</Text>
          <Text style={styles.copy}>{t.crashBody}</Text>
          <Pressable onPress={() => this.setState({ failed: false })} style={styles.button}>
            <Text style={styles.buttonText}>{t.crashRetry}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 24, gap: 12 },
  eyebrow: { ...typeScale.caption, color: colors.accentText, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 24, lineHeight: 29, fontWeight: '700' },
  copy: { ...typeScale.subhead, color: colors.muted },
  button: { minHeight: 48, marginTop: 6, borderRadius: radii.pill, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...typeScale.subhead, color: colors.white, fontWeight: '700' },
});
