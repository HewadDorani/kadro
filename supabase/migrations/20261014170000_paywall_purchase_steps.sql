begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Purchase steps on the paywall, recorded like the existing exposure: first
-- occurrence per account and step, no device, price or plan data. Measures
-- "paywall seen → button tapped → cancelled / failed / bought" for everyone,
-- not only for the few who opt into product analytics. Deleted with the
-- account (FK cascade). Same legal basis as the exposure record.
alter table private.paywall_exposures drop constraint if exists paywall_exposures_context_check;
alter table private.paywall_exposures add constraint paywall_exposures_context_check
  check (context in ('entry', 'blocked', 'hard', 'manual',
                     'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed'));

create or replace function private.mark_paywall_shown(p_context text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid()) then
    raise exception 'cloud_identity_changed';
  end if;
  if p_context is null or p_context not in ('entry', 'blocked', 'hard', 'manual',
      'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed') then
    raise exception 'invalid_paywall_context';
  end if;
  insert into private.paywall_exposures(user_id, context) values (auth.uid(), p_context)
  on conflict (user_id, context) do nothing;
end $$;
revoke all on function private.mark_paywall_shown(text) from public, anon;
grant execute on function private.mark_paywall_shown(text) to authenticated;

-- Daily purchase-step counts by signup day (Europe/Berlin), next to the funnel.
create or replace view private.paywall_steps_daily as
select (u.created_at at time zone 'Europe/Berlin')::date as signup_day,
  count(distinct e.user_id) filter (where e.context in ('entry', 'blocked', 'hard', 'manual'))::integer as paywall_seen,
  count(distinct e.user_id) filter (where e.context = 'purchase_started')::integer as purchase_tapped,
  count(distinct e.user_id) filter (where e.context = 'purchase_cancelled')::integer as purchase_cancelled,
  count(distinct e.user_id) filter (where e.context = 'purchase_failed')::integer as purchase_failed,
  count(distinct e.user_id) filter (where e.context = 'purchase_pending')::integer as purchase_pending,
  count(distinct e.user_id) filter (where e.context = 'purchase_completed')::integer as purchase_completed
from private.paywall_exposures e
join auth.users u on u.id = e.user_id
group by 1;
comment on view private.paywall_steps_daily is
  'Paywall → purchase step counts per signup day. Service-role/SQL editor only. See docs/GROWTH_FUNNEL.md.';
revoke all on private.paywall_steps_daily from public, anon, authenticated;
grant select on private.paywall_steps_daily to service_role;

notify pgrst, 'reload schema';
commit;
