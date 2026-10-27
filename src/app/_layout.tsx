import { wrapRoot } from '@/services/crashReporting';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AppRouteGuard } from '@/components/AppRouteGuard';
import { ProductAnalytics } from '@/components/ProductAnalytics';
import { ReminderScheduler } from '@/components/ReminderScheduler';
import { AppProvider } from '@/context/AppContext';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { AccessProvider } from '@/context/AccessContext';
import { CaptureCompanion } from '@/components/CaptureCompanion';

export const unstable_settings = {
  initialRouteName: 'index',
};

// Expo Router hides the native splash once the first screen is mounted; the
// fade then reveals Kandro's own canvas instead of a blank white frame.
SplashScreen.setOptions({ duration: 250, fade: true });

function RootLayout() {
  return <ThemeProvider><ThemedRootLayout /></ThemeProvider>;
}
export default wrapRoot(RootLayout);

function ThemedRootLayout() {
  const { colors, mode: themeMode } = useTheme();
  const reduceMotion = useReducedMotion();
  // The native root view sits behind every screen and modal; white showed as
  // a flash between the splash and the first screen.
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined); }, [colors.background]);


  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <LanguageProvider>
        <AppProvider>
          <SubscriptionProvider>
            <AccessProvider>
            <CaptureCompanion />
            <AppRouteGuard>
              <ReminderScheduler />
              <ProductAnalytics />
              <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
              <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: Platform.OS === 'web' || reduceMotion ? 'none' : 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="data-consent" />
              <Stack.Screen name="reminder-setup" />
              <Stack.Screen name="first-scan" options={{ gestureEnabled: false }} />
              <Stack.Screen name="capture" />
              <Stack.Screen name="access-setup" />
              <Stack.Screen name="account-help" />
              <Stack.Screen name="subscription-manage" />
              <Stack.Screen name="saved-meals" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="analyzing" options={{ gestureEnabled: false }} />
              <Stack.Screen name="confirm" />
              <Stack.Screen name="correct-food" />
              <Stack.Screen name="result" />
              <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: reduceMotion ? 'none' : 'slide_from_bottom' }} />
              <Stack.Screen name="privacy" />
              <Stack.Screen name="terms" />
              <Stack.Screen name="account-deletion" />
              <Stack.Screen name="evening" />
              <Stack.Screen name="sources" />
              </Stack>
            </AppRouteGuard>
            </AccessProvider>
          </SubscriptionProvider>
        </AppProvider>
        </LanguageProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
