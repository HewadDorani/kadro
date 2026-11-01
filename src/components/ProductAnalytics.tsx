import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useApp } from '@/context/AppContext';
import { ScreenName, trackEvent } from '@/services/telemetry';
import { markAppOpen } from '@/services/usageSignals';

// Only fixed route names, never query parameters, food IDs, or deep-link data.
const screens = new Set<ScreenName>(['today', 'plan', 'scan', 'progress', 'profile', 'onboarding', 'data-consent', 'analyzing', 'confirm', 'correct-food', 'result', 'paywall', 'privacy', 'terms', 'account-deletion', 'evening', 'sources', 'recipe', 'index']);
export function ProductAnalytics() {
  const pathname = usePathname();
  const { hydrationReady } = useApp();
  const launched = useRef(false);
  useEffect(() => {
    if (!hydrationReady) return;
    if (!launched.current) {
      launched.current = true;
      trackEvent('app active', { entry: 'launch' });
      markAppOpen();
    }
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && previous !== 'active') {
        trackEvent('app active', { entry: 'foreground' });
        markAppOpen();
      }
      previous = state;
    });
    return () => listener.remove();
  }, [hydrationReady]);
  useEffect(() => {
    if (!hydrationReady) return;
    const screen = (pathname.split('/').filter(Boolean).at(-1) ?? 'index') as ScreenName;
    if (screens.has(screen)) trackEvent('screen viewed', { screen });
  }, [hydrationReady, pathname]);
  return null;
}
