import { getCurrentSessionUserId, supabase } from '@/services/supabaseClient';

export type PaywallContext = 'entry' | 'blocked' | 'hard' | 'manual';
export type PurchaseStep = 'purchase_started' | 'purchase_cancelled' | 'purchase_failed' | 'purchase_pending' | 'purchase_completed';

const sent = new Set<string>();

/**
 * Server-side funnel record that the paywall was shown (first sighting per
 * user and context; see docs/GROWTH_FUNNEL.md). Functional, not analytics:
 * no device, price or behavior data. Fire-and-forget: never creates an
 * identity, never throws and never delays the paywall.
 */
export function markPaywallShown(context: PaywallContext | PurchaseStep) {
  void (async () => {
    if (!supabase) return;
    const owner = await getCurrentSessionUserId();
    if (!owner || sent.has(owner + ':' + context)) return;
    const { error } = await supabase.rpc('mark_paywall_shown', { p_context: context });
    if (!error) sent.add(owner + ':' + context);
  })().catch(() => undefined);
}

/** Purchase outcome → funnel step (first occurrence per account, like the exposure). */
export function markPurchaseStep(outcome: 'started' | 'active' | 'cancelled' | 'failed' | 'pending' | 'interrupted') {
  const step: PurchaseStep = outcome === 'started' ? 'purchase_started'
    : outcome === 'active' ? 'purchase_completed'
      : outcome === 'cancelled' ? 'purchase_cancelled'
        : outcome === 'pending' ? 'purchase_pending' : 'purchase_failed';
  markPaywallShown(step);
}
