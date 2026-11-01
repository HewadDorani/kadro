import { getCurrentSessionUserId, supabase } from '@/services/supabaseClient';
import { localDateKey } from '@/utils/date';

export type UsageSignal = 'app_open' | 'photo' | 'description' | 'barcode' | 'search' | 'recommendation' | 'repeat' | 'demo' | 'queued_retry'
  | 'photo_context' | 'ideas_refreshed' | 'reminders_on';

const openedDay = new Map<string, string>();

/**
 * Server-side count per account, day and fixed signal (docs/GROWTH_FUNNEL.md).
 * Functional like the paywall record: no content, device or value data, and
 * independent of the analytics opt-in, which would hide most people. Fire and
 * forget: never creates an identity, never throws and never delays anything.
 */
export function markUsage(signal: UsageSignal) {
  void (async () => {
    if (!supabase) return;
    const owner = await getCurrentSessionUserId();
    if (!owner) return;
    const { error } = await supabase.rpc('mark_usage', { p_signal: signal });
    if (error) throw error;
  })().catch(() => undefined);
}

/** At most one app_open per account and local day, however often the app comes to the front. */
export function markAppOpen() {
  void (async () => {
    if (!supabase) return;
    const owner = await getCurrentSessionUserId();
    const today = localDateKey();
    if (!owner || openedDay.get(owner) === today) return;
    const { error } = await supabase.rpc('mark_usage', { p_signal: 'app_open' });
    if (!error) openedDay.set(owner, today);
  })().catch(() => undefined);
}

const MEAL_SIGNALS: Record<string, UsageSignal> = {
  camera: 'photo', description: 'description', barcode: 'barcode', search: 'search',
  recommendation: 'recommendation', repeat: 'repeat', demo: 'demo', queued_retry: 'queued_retry',
};

/** The telemetry save source says how a new meal was captured; corrections ('edit') are no new meal. */
export function markMealCaptured(source: string) {
  const signal = MEAL_SIGNALS[source];
  if (signal) markUsage(signal);
}
