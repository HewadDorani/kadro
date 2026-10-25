begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Retention purchase steps (1.0.6), recorded exactly like the paywall
-- purchase steps: first occurrence per account and step, no device, price or
-- plan data, deleted with the account (FK cascade).
--   winback_*          purchase with an Apple win-back offer on the paywall
--   retention_offer_*  purchase from the in-app subscription screen
--                      (Apple promotional offer, or switching to annual)
-- Cancellation reasons are NOT stored here (they stay optional PostHog events
-- with analytics consent only).
alter table private.paywall_exposures drop constraint if exists paywall_exposures_context_check;
alter table private.paywall_exposures add constraint paywall_exposures_context_check
  check (context in ('entry', 'blocked', 'hard', 'manual',
                     'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed',
                     'winback_started', 'winback_cancelled', 'winback_failed', 'winback_pending', 'winback_completed',
                     'retention_offer_started', 'retention_offer_cancelled', 'retention_offer_failed', 'retention_offer_pending', 'retention_offer_completed'));

create or replace function private.mark_paywall_shown(p_context text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid()) then
    raise exception 'cloud_identity_changed';
  end if;
  if p_context is null or p_context not in ('entry', 'blocked', 'hard', 'manual',
      'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed',
      'winback_started', 'winback_cancelled', 'winback_failed', 'winback_pending', 'winback_completed',
      'retention_offer_started', 'retention_offer_cancelled', 'retention_offer_failed', 'retention_offer_pending', 'retention_offer_completed') then
    raise exception 'invalid_paywall_context';
  end if;
  insert into private.paywall_exposures(user_id, context) values (auth.uid(), p_context)
  on conflict (user_id, context) do nothing;
end $$;
revoke all on function private.mark_paywall_shown(text) from public, anon;
grant execute on function private.mark_paywall_shown(text) to authenticated;

-- Same view, retention columns appended (create or replace keeps existing columns first).
create or replace view private.paywall_steps_daily as
select (u.created_at at time zone 'Europe/Berlin')::date as signup_day,
  count(distinct e.user_id) filter (where e.context in ('entry', 'blocked', 'hard', 'manual'))::integer as paywall_seen,
  count(distinct e.user_id) filter (where e.context = 'purchase_started')::integer as purchase_tapped,
  count(distinct e.user_id) filter (where e.context = 'purchase_cancelled')::integer as purchase_cancelled,
  count(distinct e.user_id) filter (where e.context = 'purchase_failed')::integer as purchase_failed,
  count(distinct e.user_id) filter (where e.context = 'purchase_pending')::integer as purchase_pending,
  count(distinct e.user_id) filter (where e.context = 'purchase_completed')::integer as purchase_completed,
  count(distinct e.user_id) filter (where e.context = 'winback_started')::integer as winback_tapped,
  count(distinct e.user_id) filter (where e.context = 'winback_completed')::integer as winback_completed,
  count(distinct e.user_id) filter (where e.context = 'retention_offer_started')::integer as retention_offer_tapped,
  count(distinct e.user_id) filter (where e.context = 'retention_offer_completed')::integer as retention_offer_completed
from private.paywall_exposures e
join auth.users u on u.id = e.user_id
group by 1;
comment on view private.paywall_steps_daily is
  'Paywall → purchase step counts per signup day, plus win-back and retention offers. Service-role/SQL editor only. See docs/GROWTH_FUNNEL.md.';
revoke all on private.paywall_steps_daily from public, anon, authenticated;
grant select on private.paywall_steps_daily to service_role;

notify pgrst, 'reload schema';
commit;
