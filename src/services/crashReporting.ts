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

export function reportError(error: unknown, context?: string) {
  if (!crashReportingEnabled) return;
  Sentry.captureException(error, context ? { tags: { area: context } } : undefined);
}

export const wrapRoot = <T,>(component: T): T => (crashReportingEnabled ? Sentry.wrap(component as never) as T : component);
