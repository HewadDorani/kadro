import { reportError } from '@/services/crashReporting';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import PostHog, { PostHogPersistedProperty } from 'posthog-react-native';

import { AnalysisErrorKind } from '@/services/contracts';
import { MealContext } from '@/types/nutrition';

export type ScanSource = 'camera' | 'demo' | 'queued_retry' | 'description' | 'barcode' | 'search';
type CountBucket = '1' | '2-3' | '4+';
type BillingMode = 'preview' | 'test_store' | 'native_store' | 'web';

export type MealSaveSource = ScanSource | 'recommendation' | 'repeat' | 'edit';
export type ScreenName = 'today' | 'plan' | 'scan' | 'progress' | 'profile' | 'onboarding' | 'data-consent' | 'analyzing' | 'confirm' | 'correct-food' | 'result' | 'paywall' | 'privacy' | 'terms' | 'account-deletion' | 'evening' | 'sources' | 'recipe' | 'index';

type AnalyticsEventMap = {
  'app active': { entry: 'launch' | 'foreground' | 'opt_in' };
  'screen viewed': { screen: ScreenName };
  'setup step viewed': { step: 'about' | 'body' | 'target' | 'goal' | 'name' | 'sex' | 'age' | 'rate' | 'height' | 'weight' | 'activity' | 'preferences' | 'building' | 'plan'; editing: boolean };
  'introduction step viewed': { step: 1 | 2 | 3 | 4 | 5 };
  'introduction exited': { completed: boolean };
  'food search started': Record<string, never>;
  'food search completed': { result_count: '0' | '1-15' | '16-30' | '31+'; duration: DurationBucket };
  'food search failed': { failure_reason: AnalysisErrorKind; duration: DurationBucket };
  'food search selected': { rank: '1-3' | '4-15' | '16+' };
  'camera permission resolved': { granted: boolean };
  'camera capture failed': { failure_reason: 'not_ready' | 'capture_failed' };
  'meal save attempted': { source: MealSaveSource };
  'meal save completed': { source: MealSaveSource; outcome: 'created' | 'updated' | 'unchanged' };
  'meal save failed': { source: MealSaveSource; failure_reason: 'local_storage' };
  'meal updated': { source: MealSaveSource };
  'meal deleted': Record<string, never>;
  'cloud sync completed': { operation: 'save' | 'delete' | 'hydrate'; outcome: 'synced' | 'local_only' };
  'cloud sync failed': { operation: 'save' | 'delete' | 'hydrate' };
  'result continued': { next_destination: 'today' | 'recommendations' };
  'subscription purchase started': { billing_mode: BillingMode; plan: 'yearly' | 'monthly' };
  'subscription purchase ended': { billing_mode: BillingMode; plan: 'yearly' | 'monthly'; outcome: 'active' | 'cancelled' | 'failed' | 'pending' | 'interrupted' };
  'subscription restore started': { billing_mode: BillingMode };
  'subscription restore ended': { billing_mode: BillingMode; outcome: 'active' | 'none' | 'failed' | 'pending' | 'interrupted' };
  'onboarding completed': { completion: 'finished' | 'skipped' };
  'plan edited': { completion: 'finished' };
  'meal scan started': { scan_source: ScanSource };
  'meal analysis completed': {
    confidence: 'high' | 'medium';
    detected_item_count: CountBucket;
    scan_source: ScanSource;
    warning_present: boolean;
    duration?: DurationBucket;
  };
  'meal analysis failed': {
    failure_reason: AnalysisErrorKind;
    queued_for_retry: boolean;
    duration?: DurationBucket;
    scan_source: ScanSource;
  };
  'meal confirmed': {
    confidence: 'high' | 'medium';
    correction_applied: boolean;
    included_item_count: CountBucket;
  };
  'meal saved': { source: MealSaveSource };
  'recommendation set viewed': { meal_context: MealContext };
  'recommendation selected': { meal_context: MealContext; rank: 1 | 2 | 3 };
  'paywall viewed': { billing_mode: BillingMode };
  'subscription purchase completed': { billing_mode: BillingMode; plan: 'yearly' | 'monthly'; purchase_kind: 'trial' | 'paid' };
  'access paywall shown': { experiment: 'paywall_access_v1'; variant: 'A' | 'B'; environment: 'production'; cohort_source: 'public'; access_version: 'v1' };
  'subscription restore completed': { active: boolean; billing_mode: BillingMode };
  // Retention (1.0.6): fixed values only, never price, product or free text.
  'subscription offer purchase ended': { billing_mode: BillingMode; offer: 'winback' | 'promotional' | 'annual_switch'; outcome: 'active' | 'cancelled' | 'failed' | 'pending' | 'interrupted' };
};

export type AnalyticsEventName = keyof AnalyticsEventMap;

type ErrorContext = {
  area: 'analysis' | 'cloud_sync' | 'subscription' | 'ui' | 'storage';
  operation: string;
  code?: string;
  fatal?: boolean;
};

const projectToken = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com';
const telemetryAvailable = process.env.EXPO_PUBLIC_POSTHOG_ENABLED?.trim().toLowerCase() === 'true';
const ANALYTICS_CONSENT_KEY = '@kandro/analytics-consent:v1';
// PostHog React Native 4.x uses these exact storage names. Kandro now supplies
// AsyncStorage explicitly, but earlier builds selected Expo FileSystem first;
// both locations must be erased at an identity or age boundary.
const POSTHOG_STORAGE_KEYS = ['.posthog-rn.json', '.posthog-rn-logs.json'] as const;
const allowedEvents = new Set<string>([
  ...([
    'app active', 'screen viewed', 'setup step viewed', 'introduction step viewed', 'introduction exited',
    'food search started', 'food search completed', 'food search failed', 'food search selected',
    'camera permission resolved', 'camera capture failed',
    'meal save attempted', 'meal save completed', 'meal save failed', 'meal updated', 'meal deleted',
    'cloud sync completed', 'cloud sync failed', 'result continued',
    'subscription purchase started', 'subscription purchase ended', 'subscription restore started', 'subscription restore ended',
    'onboarding completed',
    'plan edited',
    'meal scan started',
    'meal analysis completed',
    'meal analysis failed',
    'meal confirmed',
    'meal saved',
    'recommendation set viewed',
    'recommendation selected',
    'paywall viewed', 'access paywall shown',
    'subscription purchase completed',
    'subscription restore completed',
    'subscription offer purchase ended',
  ] satisfies AnalyticsEventName[]),
  '$exception',
]);
const blockedAutomaticProperties = new Set([
  '$device_manufacturer',
  '$device_model',
  '$device_name',
  '$locale',
  '$screen_height',
  '$screen_width',
  '$timezone',
  // Also scrub legacy queued events produced before goals were removed.
  'goal',
]);

// A runtime allowlist protects the boundary even from untyped callers. No
// arbitrary strings, numbers, nested objects or free-text properties pass it.
const propertyValues: Record<string, readonly unknown[]> = {
  experiment: ['paywall_access_v1'], variant: ['A', 'B'], environment: ['production'], cohort_source: ['public'], access_version: ['v1'], purchase_kind: ['trial', 'paid'],
  entry: ['launch', 'foreground', 'opt_in'],
  screen: ['today', 'plan', 'scan', 'progress', 'profile', 'onboarding', 'data-consent', 'analyzing', 'confirm', 'correct-food', 'result', 'paywall', 'privacy', 'terms', 'account-deletion', 'evening', 'sources', 'recipe', 'index'],
  step: ['goal', 'name', 'sex', 'age', 'rate', 'height', 'weight', 'activity', 'preferences', 'building', 'plan', 1, 2, 3, 4, 5],
  editing: [true, false], completed: [true, false], granted: [true, false],
  completion: ['finished', 'skipped'],
  source: ['camera', 'demo', 'queued_retry', 'description', 'barcode', 'search', 'recommendation', 'repeat', 'edit'],
  scan_source: ['camera', 'demo', 'queued_retry', 'description', 'barcode', 'search'],
  confidence: ['high', 'medium'], detected_item_count: ['1', '2-3', '4+'], included_item_count: ['1', '2-3', '4+'],
  warning_present: [true, false], queued_for_retry: [true, false], correction_applied: [true, false], active: [true, false],
  result_count: ['0', '1-15', '16-30', '31+'], rank: [1, 2, 3, '1-3', '4-15', '16+'],
  duration: ['under_1s', '1_3s', '3_10s', '10_30s', 'over_30s'],
  failure_reason: ['not-configured', 'consent-required', 'subscription-required', 'daily-limit', 'invalid-input', 'request-expired', 'offline', 'unclear-image', 'multiple-dishes', 'product-not-found', 'provider-error', 'timeout', 'rate-limited', 'session-required', 'invalid-response', 'model-refused', 'local_storage', 'not_ready', 'capture_failed'],
  outcome: ['created', 'updated', 'unchanged', 'active', 'cancelled', 'failed', 'pending', 'interrupted', 'none', 'synced', 'local_only'],
  operation: ['save', 'delete', 'hydrate'], next_destination: ['today', 'recommendations'],
  meal_context: ['home', 'supermarket', 'eating-out'],
  billing_mode: ['preview', 'test_store', 'native_store', 'web'], plan: ['yearly', 'monthly'],
  offer: ['winback', 'promotional', 'annual_switch'], reason: ['too_expensive', 'not_using', 'ai_inaccurate', 'other'],
};
export function sanitizeProductProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(properties).filter(([key, value]) => propertyValues[key]?.includes(value)));
}

function sanitizeAutomaticProperties<Event extends { properties?: Record<string, unknown> }>(event: Event) {
  if (!event.properties) return event;
  for (const property of blockedAutomaticProperties) delete event.properties[property];
  return event;
}

// Unknown age is fail-closed. This in-memory policy gate prevents a persisted
// PostHog opt-in or queued event from another session from emitting before the
// authoritative local/cloud profile has been adopted.
let analyticsSubjectAge: number | null = null;
// Separate from PostHog's own persisted opt-in so the SDK never has to start
// (and fetch remote configuration) merely to discover that consent is absent.
let analyticsConsentGranted: boolean | null = null;

function analyticsAgeEligible() {
  return analyticsSubjectAge !== null && analyticsSubjectAge >= 18;
}

function analyticsAllowedForCurrentProfile() {
  return analyticsAgeEligible() && analyticsConsentGranted === true;
}

const telemetryConfigured = Boolean(projectToken && telemetryAvailable);
let posthog: PostHog | null = null;

function createPostHog() {
  if (!projectToken || !telemetryAvailable) return null;
  return new PostHog(projectToken, {
      host,
      customStorage: AsyncStorage,
      defaultOptIn: false,
      personProfiles: 'never',
      captureAppLifecycleEvents: false,
      capturePushNotificationOpened: false,
      capturePushNotificationSubscriptions: false,
      disableGeoip: true,
      disableRemoteFeatureFlags: true,
      disableSurveys: true,
      enablePersistSessionIdAcrossRestart: false,
      enableSessionReplay: false,
      errorTracking: {
        autocapture: false,
        exceptionSteps: { enabled: false },
      },
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      setDefaultPersonProperties: false,
      before_send: (event) => event && analyticsAllowedForCurrentProfile() && allowedEvents.has(event.event)
        ? sanitizeAutomaticProperties(event)
        : null,
    });
}

async function erasePersistedPostHogStorage() {
  // This is the authoritative current storage backend. A failure must reach
  // account-switch/deletion callers so they cannot cross an identity boundary
  // while an old opt-in or event queue may still be recoverable on restart.
  await AsyncStorage.multiRemove([ANALYTICS_CONSENT_KEY, ...POSTHOG_STORAGE_KEYS]);
  for (const name of POSTHOG_STORAGE_KEYS) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) file.delete();
    } catch {
      // The web build and a device without a legacy file both land here.
    }
  }
}

async function clearTelemetryIdentity() {
  analyticsSubjectAge = null;
  analyticsConsentGranted = false;
  let sdkCleanupError: unknown = null;
  if (posthog) {
    // Close the in-memory queues before the first await. Then hydrate once,
    // clear again, opt out and drain every debounced write before the final
    // direct deletion below.
    clearPersistedQueues(posthog);
    try {
      await posthog.ready();
      clearPersistedQueues(posthog);
      await posthog.optOut();
      clearPersistedQueues(posthog);
      posthog.reset([]);
      clearPersistedQueues(posthog);
      await posthog.optOut();
      await (posthog as unknown as { flushStorage: () => Promise<void> }).flushStorage();
    } catch (error) {
      sdkCleanupError = error;
    }
  }
  // Attempt the direct deletion even when SDK cleanup failed. Still surface
  // the SDK failure afterwards because an undrained scheduled write could
  // otherwise recreate a queue after this function reports success.
  await erasePersistedPostHogStorage();
  if (sdkCleanupError) throw sdkCleanupError;
}

async function readyPostHog() {
  if (!analyticsAllowedForCurrentProfile()) return null;
  if (!posthog) posthog = createPostHog();
  if (!posthog) return null;
  await posthog.ready();
  return posthog;
}

const persistedQueues = [
  PostHogPersistedProperty.Queue,
  PostHogPersistedProperty.AiQueue,
  PostHogPersistedProperty.AiCaptureQueue,
  PostHogPersistedProperty.LogsQueue,
] as const;

function clearPersistedQueues(client: PostHog) {
  for (const queue of persistedQueues) client.setPersistedProperty(queue, null);
}

async function loadLocalAnalyticsConsent() {
  if (analyticsConsentGranted !== null) return analyticsConsentGranted;
  try {
    analyticsConsentGranted = await AsyncStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
  } catch {
    analyticsConsentGranted = false;
  }
  return analyticsConsentGranted;
}

async function persistLocalAnalyticsConsent(enabled: boolean) {
  analyticsConsentGranted = enabled;
  // This setter runs synchronously before the first storage await. PostHog's
  // flush path does not re-check opt-out after taking a queued batch, so the
  // in-memory queues must disappear in the same tick as our own gate closes.
  if (!enabled && posthog) clearPersistedQueues(posthog);
  if (enabled) await AsyncStorage.setItem(ANALYTICS_CONSENT_KEY, 'true');
  else await AsyncStorage.removeItem(ANALYTICS_CONSENT_KEY);
}

export const isTelemetryConfigured = telemetryConfigured;

export function countBucket(count: number): CountBucket {
  if (count <= 1) return '1';
  if (count <= 3) return '2-3';
  return '4+';
}

export type DurationBucket = 'under_1s' | '1_3s' | '3_10s' | '10_30s' | 'over_30s';
export function durationBucket(startedAt: number): DurationBucket {
  const ms = Math.max(0, Date.now() - startedAt);
  return ms < 1000 ? 'under_1s' : ms < 3000 ? '1_3s' : ms < 10000 ? '3_10s' : ms < 30000 ? '10_30s' : 'over_30s';
}

function releaseProperties() {
  return {
    analytics_schema: 2,
    app_version: nativeApplicationVersion ?? 'web',
    app_build: nativeBuildVersion ?? 'web',
    app_platform: Platform.OS,
    app_environment: __DEV__ ? 'development' : 'release',
  };
}

export function trackEvent<Name extends AnalyticsEventName>(name: Name, properties: AnalyticsEventMap[Name]) {
  // Telemetry failure must never fail a successful local save or purchase.
  try {
    if (analyticsAllowedForCurrentProfile()) posthog?.capture(name, { ...sanitizeProductProperties(properties), ...releaseProperties() });
  } catch { /* Analytics is optional and cannot interrupt the product. */ }
}

export function captureOperationalError(error: unknown, context: ErrorContext) {
  const original = error instanceof Error ? error : null;
  const safeError = new Error(`${context.area}:${context.operation}:${context.code ?? original?.name ?? 'unknown'}`);
  safeError.name = original?.name || 'KandroOperationalError';
  if (original?.stack) {
    const [, ...frames] = original.stack.split('\n');
    safeError.stack = `${safeError.name}: ${safeError.message}\n${frames.join('\n')}`;
  }
  // Crash reports carry only this sanitised message and the code location.
  if (context.fatal) reportError(safeError, context.area);
  if (!posthog || !analyticsAllowedForCurrentProfile()) return;
  try { posthog.captureException(safeError, {
    ...releaseProperties(),
    error_area: context.area,
    error_code: context.code ?? 'unknown',
    fatal: context.fatal ?? false,
    operation: context.operation,
  }); } catch { /* Error reporting must not throw another error. */ }
}

export async function getAnalyticsCollectionEnabled() {
  if (!analyticsAgeEligible()) return false;
  // Reading the switch must remain a local AsyncStorage operation. Starting
  // PostHog here would contact it before the user opted in.
  return loadLocalAnalyticsConsent();
}

export async function setAnalyticsCollectionEnabled(enabled: boolean) {
  if (!analyticsAgeEligible()) {
    await persistLocalAnalyticsConsent(false);
    if (posthog) {
      await posthog.ready();
      clearPersistedQueues(posthog);
      await posthog.optOut();
      clearPersistedQueues(posthog);
    }
    return false;
  }
  if (!enabled) {
    // Revoke the local gate before touching the SDK. No queued callback can
    // pass before_send while opt-out and queue erasure finish.
    await persistLocalAnalyticsConsent(false);
    if (!posthog) return false;
    // optOut prevents new captures, but the SDK can still hold events that
    // were queued before the user withdrew permission. Erase those queues at
    // the same boundary so disabling analytics cannot leak a final batch.
    await posthog.ready();
    clearPersistedQueues(posthog);
    await posthog.optOut();
    clearPersistedQueues(posthog);
    return false;
  }
  await persistLocalAnalyticsConsent(true);
  const client = await readyPostHog();
  if (!client) {
    await persistLocalAnalyticsConsent(false).catch(() => undefined);
    return false;
  }
  await client.optIn();
  trackEvent('app active', { entry: 'opt_in' });
  return analyticsAllowedForCurrentProfile();
}

/** Apply the profile-age privacy boundary before any screen may emit. */
export async function applyAnalyticsAgePolicy(age: number | null) {
  analyticsSubjectAge = Number.isInteger(age) ? age : null;
  // The SDK is constructed lazily only after an adult profile is known. A
  // minor/unknown profile therefore cannot auto-flush a persisted queue from
  // an earlier session during module startup. If an instance already exists,
  // wait for storage hydration, opt out, and erase every local queue.
  if (!analyticsAgeEligible()) {
    await clearTelemetryIdentity();
    return;
  }
  // Adults still remain fully local until they have explicitly enabled the
  // switch. This read does not construct the PostHog SDK or make a request.
  if (await loadLocalAnalyticsConsent()) await readyPostHog();
}

export async function clearTelemetryAfterAccountDeletion() {
  await clearTelemetryIdentity();
}

/** Prevents an old device identity or queued event crossing into a login. */
export async function clearTelemetryForAccountSwitch() {
  await clearTelemetryIdentity();
}

export function toBillingMode(mode: 'unconfigured' | 'test-store' | 'native-store' | 'web' | undefined): BillingMode {
  if (mode === 'test-store') return 'test_store';
  if (mode === 'native-store') return 'native_store';
  if (mode === 'web') return 'web';
  return 'preview';
}
