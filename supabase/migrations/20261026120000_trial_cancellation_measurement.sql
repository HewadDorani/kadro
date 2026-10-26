begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Cancelled trials (1.0.6). Two count-only measurements, no device, price or
-- plan data:
-- 1. Client steps of the Today card for a trial turned off at Apple:
--      trial_ending   card shown (last 48 h of a cancelled trial)
--      trial_keep     "Keep Kandro Pro" tapped (opens Apple's page)
--      trial_offer_*  purchase with the promotional offer from that card
-- 2. private.trial_outcomes_daily from the RevenueCat webhook rows the backend
--    already stores: how fast first purchases/trials are cancelled and how
--    many still renew. PRODUCTION only; webhook rows are purged after 90 days.
alter table private.paywall_exposures drop constraint if exists paywall_exposures_context_check;
alter table private.paywall_exposures add constraint paywall_exposures_context_check
  check (context in ('entry', 'blocked', 'hard', 'manual',
                     'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed',
                     'winback_started', 'winback_cancelled', 'winback_failed', 'winback_pending', 'winback_completed',
                     'retention_offer_started', 'retention_offer_cancelled', 'retention_offer_failed', 'retention_offer_pending', 'retention_offer_completed',
                     'trial_ending', 'trial_keep',
                     'trial_offer_started', 'trial_offer_cancelled', 'trial_offer_failed', 'trial_offer_pending', 'trial_offer_completed'));

create or replace function private.mark_paywall_shown(p_context text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid()) then
    raise exception 'cloud_identity_changed';
  end if;
  if p_context is null or p_context not in ('entry', 'blocked', 'hard', 'manual',
      'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed',
      'winback_started', 'winback_cancelled', 'winback_failed', 'winback_pending', 'winback_completed',
      'retention_offer_started', 'retention_offer_cancelled', 'retention_offer_failed', 'retention_offer_pending', 'retention_offer_completed',
      'trial_ending', 'trial_keep',
      'trial_offer_started', 'trial_offer_cancelled', 'trial_offer_failed', 'trial_offer_pending', 'trial_offer_completed') then
    raise exception 'invalid_paywall_context';
  end if;
  insert into private.paywall_exposures(user_id, context) values (auth.uid(), p_context)
  on conflict (user_id, context) do nothing;
end $$;
revoke all on function private.mark_paywall_shown(text) from public, anon;
grant execute on function private.mark_paywall_shown(text) to authenticated;

-- One row per first-purchase day (Europe/Berlin). INITIAL_PURCHASE covers a
-- trial start and a direct purchase alike (period_type is not stored).
create view private.trial_outcomes_daily as
with starts as (
  select w.user_id, min(w.event_timestamp_ms) as started_ms
  from public.revenuecat_webhook_events w
  where w.event_type = 'INITIAL_PURCHASE' and w.environment = 'PRODUCTION'
  group by w.user_id
), facts as (
  select s.user_id, s.started_ms,
    (select min(c.event_timestamp_ms) from public.revenuecat_webhook_events c
      where c.user_id = s.user_id and c.event_type = 'CANCELLATION' and c.environment = 'PRODUCTION'
        and c.event_timestamp_ms >= s.started_ms) as cancelled_ms,
    exists(select 1 from public.revenuecat_webhook_events u where u.user_id = s.user_id
      and u.event_type = 'UNCANCELLATION' and u.environment = 'PRODUCTION') as uncancelled,
    exists(select 1 from public.revenuecat_webhook_events r where r.user_id = s.user_id
      and r.event_type = 'RENEWAL' and r.environment = 'PRODUCTION') as renewed,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_ending') as card_seen,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_keep') as keep_tapped,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_offer_completed') as offer_taken
  from starts s
)
select (pg_catalog.to_timestamp(started_ms / 1000.0) at time zone 'Europe/Berlin')::date as start_day,
  count(*)::integer as first_purchases,
  count(*) filter (where cancelled_ms is not null and cancelled_ms - started_ms <= 3600000)::integer as cancelled_within_1h,
  count(*) filter (where cancelled_ms is not null and cancelled_ms - started_ms <= 86400000)::integer as cancelled_within_24h,
  count(*) filter (where cancelled_ms is not null)::integer as cancelled_any,
  count(*) filter (where uncancelled)::integer as uncancelled,
  count(*) filter (where renewed)::integer as renewed,
  count(*) filter (where card_seen)::integer as trial_card_seen,
  count(*) filter (where keep_tapped)::integer as trial_keep_tapped,
  count(*) filter (where offer_taken)::integer as trial_offer_completed
from facts
group by 1;
comment on view private.trial_outcomes_daily is
  'First purchase/trial → cancellation speed, uncancel, renewal, cancelled-trial card. PRODUCTION only. Service-role/SQL editor only. See docs/GROWTH_FUNNEL.md.';
revoke all on private.trial_outcomes_daily from public, anon, authenticated;
grant select on private.trial_outcomes_daily to service_role;

notify pgrst, 'reload schema';
commit;
