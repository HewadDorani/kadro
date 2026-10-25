import { getCurrentSessionUserId, supabase } from '@/services/supabaseClient';

export type PaywallContext = 'entry' | 'blocked' | 'hard' | 'manual';
type StepOutcome = 'started' | 'cancelled' | 'failed' | 'pending' | 'completed';
/** 'winback' and 'retention_offer' need migration 20261025140000 (written, not applied). */
export type PurchaseStepKind = 'purchase' | 'winback' | 'retention_offer';
export type PurchaseStep = `${PurchaseStepKind}_${StepOutcome}`;

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

/**
 * Purchase outcome → funnel step (first occurrence per account, like the
 * exposure). `kind` separates the paywall purchase from a win-back offer and
 * the manage screen's retention offers (promotional offer, annual switch).
 * Until the migration is applied the server rejects the new values and the
 * fire-and-forget call is silently dropped; the purchase is never affected.
 */
export function markPurchaseStep(outcome: 'started' | 'active' | 'cancelled' | 'failed' | 'pending' | 'interrupted', kind: PurchaseStepKind = 'purchase') {
  const step: StepOutcome = outcome === 'started' ? 'started'
    : outcome === 'active' ? 'completed'
      : outcome === 'cancelled' ? 'cancelled'
        : outcome === 'pending' ? 'pending' : 'failed';
  markPaywallShown(`${kind}_${step}`);
}
