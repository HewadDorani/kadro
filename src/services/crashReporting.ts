import * as Sentry from '@sentry/react-native';

/**
 * Crash and error reports only: no session replay, no screenshots, no user
 * identity, no meal or body data. Inactive until a DSN is configured, so
 * development and builds without it behave exactly as before.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
export const crashReportingEnabled = /^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(dsn);

const SENSITIVE = /(meal|description|image|photo|weight|age|email|name|token|password)/i;
// Supabase REST filters carry user and meal ids in the query string.
const withoutQuery = (value: string) => value.replace(/[?#].*$/, '');
const URL_KEYS = ['url', 'http.url'];

if (crashReportingEnabled) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: true,
    // 10% performance sampling (startup, navigation, request timing). Spans
    // keep timings and status only: no query strings, no user, no payloads,
    // and no trace headers sent to Supabase or third-party providers.
    tracesSampleRate: 0.1,
    tracePropagationTargets: [],
    maxBreadcrumbs: 30,
    beforeBreadcrumb(breadcrumb) {
      // Console, route params, typed text and network bodies can carry user input.
      if (['console', 'xhr', 'fetch', 'navigation', 'ui.input'].includes(breadcrumb.category ?? '')) return null;
      return breadcrumb;
    },
    beforeSend(event) {
      // Simulator and QA runs are not user crashes; the native SDK marks them.
      if (event.contexts?.device?.simulator === true) return null;
      delete event.user;
      if (event.request) delete event.request.data;
      if (event.extra) for (const key of Object.keys(event.extra)) if (SENSITIVE.test(key)) delete event.extra[key];
      return event;
    },
    beforeSendSpan(span) {
      if (span.description) span.description = withoutQuery(span.description);
      for (const key of Object.keys(span.data ?? {})) {
        const value = span.data[key];
        if (key === 'http.query' || key === 'http.fragment' || SENSITIVE.test(key)) delete span.data[key];
        else if (URL_KEYS.includes(key) && typeof value === 'string') span.data[key] = withoutQuery(value);
      }
      return span;
    },
    beforeSendTransaction(event) {
      delete event.user;
      if (event.request) { delete event.request.data; delete event.request.query_string; if (event.request.url) event.request.url = withoutQuery(event.request.url); }
      if (event.transaction) event.transaction = withoutQuery(event.transaction);
      return event;
    },
  });
}

/**
 * Every fatal JS error ends in ExceptionsManager, including the ones React
 * reports itself, which never pass Sentry's global handler. On iOS the native
 * side then dies on a background thread and the message is lost (KANDRO-IOS-B),
 * so it is recorded here first: message, JS stack and the recent routes, and
 * the fatal report waits for the upload.
 *
 * Only a render failure still ends the app: React has torn the screen down and
 * a fresh start is the way back. A throw in a timer, promise or tap handler
 * leaves every screen intact, so it is reported and the person keeps working.
 */
let fatalHookInstalled = false;
function installFatalHook() {
  if (fatalHookInstalled) return;
  fatalHookInstalled = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manager = require('react-native/Libraries/Core/ExceptionsManager').default as { handleException: (error: unknown, isFatal: boolean) => void };
  const original = manager.handleException;
  manager.handleException = (error, isFatal) => {
    if (!isFatal) { original(error, isFatal); return; }
    const screenLost = typeof (error as { componentStack?: unknown } | null)?.componentStack === 'string';
    Sentry.captureException(error, { tags: { area: 'fatal_js', screen_lost: String(screenLost) } });
    if (!screenLost) return;
    // Sentry's own timeout bounds this; a failed upload must not swallow the fatal.
    void Sentry.flush().catch(() => false).then(() => original(error, isFatal));
  };
}
if (crashReportingEnabled) {
  try { installFatalHook(); } catch { /* Reporting must never stop the app from starting. */ }
}

/** Fixed route names only: `usePathname` carries no parameters. */
export function noteRoute(path: string) {
  if (!crashReportingEnabled) return;
  Sentry.addBreadcrumb({ category: 'route', message: path.slice(0, 60), level: 'info' });
}

export function reportError(error: unknown, context?: string) {
  if (!crashReportingEnabled) return;
  Sentry.captureException(error, context ? { tags: { area: context } } : undefined);
}

/** Fixed route names only: `usePathname` carries no parameters. */
export function reportRedirectLoop(from: string, to: string) {
  if (!crashReportingEnabled) return;
  Sentry.captureMessage('Route guard redirect loop', { level: 'error', tags: { area: 'route_guard', loop_from: from.slice(0, 60), loop_to: to.slice(0, 60) } });
}

export const wrapRoot = <T,>(component: T): T => (crashReportingEnabled ? Sentry.wrap(component as never) as T : component);
