import AsyncStorage from '@react-native-async-storage/async-storage';
import { prepareReminderOnboarding, reminderQuestionSettled } from '@/services/reminders';

/**
 * The first run after onboarding: value before the offer.
 *
 *   plan → tour → consent → 'scan' (first meal, or the example) → 'paywall'
 *   → reminder ask (the existing reminder-onboarding flag) → app
 *
 * Only these two stages live here; the reminder step reuses
 * prepareReminderOnboarding so the route guard keeps one source of truth.
 * Installs from before this flow have no key and are never routed by it.
 */
export type FirstRunStage = 'scan' | 'paywall';
const KEY = '@kandro/first-run:v1';
const stages: readonly FirstRunStage[] = ['scan', 'paywall'];

// undefined: not read yet. The guard waits rather than guessing.
let session: FirstRunStage | null | undefined;
let revision = 0;
const listeners = new Set<() => void>();
function publish(next: FirstRunStage | null) {
  session = next; revision++;
  listeners.forEach(listener => listener());
}
export const getFirstRunSnapshot = () => session;
export function subscribeFirstRun(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function loadFirstRunStage() {
  if (session !== undefined) return session;
  const started = revision;
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  const stage = stages.includes(raw as FirstRunStage) ? raw as FirstRunStage : null;
  if (started === revision) publish(stage);
  return session ?? stage;
}
/** Publish first so a navigation in the same tick already sees the new stage. */
export async function setFirstRunStage(stage: FirstRunStage | null) {
  publish(stage);
  if (stage) await AsyncStorage.setItem(KEY, stage).catch(() => undefined);
  else await AsyncStorage.removeItem(KEY).catch(() => undefined);
}

/** The offer was seen: the run ends, the reminder question is next. */
export async function finishFirstRunOffer() {
  // Reminder first: an app kill in between must not skip the question.
  if (!await reminderQuestionSettled().catch(() => false)) await prepareReminderOnboarding().catch(() => undefined);
  await setFirstRunStage(null);
}

/** Primary tabs. Scan flow, legal pages and settings never redirect. */
const firstRunTabs = new Set(['/today', '/plan', '/progress', '/profile']);

/**
 * Where the guard sends someone in the first run, or null to stay.
 * - 'scan': a tab without a saved meal goes back to the first-scan prompt;
 *   after the first saved meal the offer follows (once).
 * - 'paywall': any tab or the first-scan prompt shows the offer.
 */
export function firstRunRedirect(stage: FirstRunStage | null | undefined, path: string, mealSaved: boolean): '/first-scan' | '/paywall' | null {
  if (stage === 'scan') {
    if (path === '/first-scan') return mealSaved ? '/paywall' : null;
    if (!firstRunTabs.has(path)) return null;
    return mealSaved ? '/paywall' : '/first-scan';
  }
  if (stage === 'paywall') return firstRunTabs.has(path) || path === '/first-scan' || path === '/first-sample' ? '/paywall' : null;
  return null;
}
