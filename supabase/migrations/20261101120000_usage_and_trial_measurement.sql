begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1.0.7 measurement. The analysis of 01.11.2026 could not answer three things:
-- why trials end, which capture path people really use (origin='plan' covers
-- search, barcode, repeats and plan suggestions alike), and whether anyone
-- opens the app without saving a meal.

-- 1. Facts RevenueCat already sends with every event. Fixed vocabulary, no
--    price or personal data. Rows from before this migration stay null.
alter table public.revenuecat_webhook_events
  add column if not exists period_type text,
  add column if not exists product_id text,
  add column if not exists cancel_reason text;
alter table public.revenuecat_webhook_events drop constraint if exists revenuecat_webhook_events_period_type_check;
alter table public.revenuecat_webhook_events add constraint revenuecat_webhook_events_period_type_check
  check (period_type is null or period_type in ('TRIAL', 'INTRO', 'NORMAL', 'PROMOTIONAL', 'PREPAID'));
alter table public.revenuecat_webhook_events drop constraint if exists revenuecat_webhook_events_product_id_check;
alter table public.revenuecat_webhook_events add constraint revenuecat_webhook_events_product_id_check
  check (product_id is null or length(product_id) <= 120);
alter table public.revenuecat_webhook_events drop constraint if exists revenuecat_webhook_events_cancel_reason_check;
alter table public.revenuecat_webhook_events add constraint revenuecat_webhook_events_cancel_reason_check
  check (cancel_reason is null or cancel_reason in ('UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED', 'PRICE_INCREASE', 'CUSTOMER_SUPPORT', 'UNKNOWN'));

-- 2. Usage signals: one row per account, Berlin day and fixed signal, with a
--    count. No device, content or value data. Functional measurement under the
--    same basis as private.paywall_exposures; deleted with the account.
create table if not exists private.usage_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  signal text not null check (signal in (
    'app_open', 'photo', 'description', 'barcode', 'search', 'recommendation', 'repeat', 'demo', 'queued_retry',
    'photo_context', 'ideas_refreshed', 'reminders_on')),
  count integer not null default 1 check (count > 0),
  primary key (user_id, day, signal)
);
alter table private.usage_days enable row level security;
revoke all on table private.usage_days from public, anon, authenticated;

create or replace function public.mark_usage(p_signal text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id = auth.uid()) then
    raise exception 'cloud_identity_changed';
  end if;
  if p_signal is null or p_signal not in (
      'app_open', 'photo', 'description', 'barcode', 'search', 'recommendation', 'repeat', 'demo', 'queued_retry',
      'photo_context', 'ideas_refreshed', 'reminders_on') then
    raise exception 'invalid_usage_signal';
  end if;
  insert into private.usage_days(user_id, day, signal)
  values (auth.uid(), (now() at time zone 'Europe/Berlin')::date, p_signal)
  on conflict (user_id, day, signal) do update
    set count = least(private.usage_days.count + 1, 1000);
end $$;
revoke all on function public.mark_usage(text) from public, anon;
grant execute on function public.mark_usage(text) to authenticated;

-- Aggregate per day and signal; the only shape read for reporting.
create or replace view private.usage_daily as
  select day, signal, count(distinct user_id)::integer as users, sum(count)::integer as events
  from private.usage_days group by day, signal;

-- Active days per account after sign-up, as a distribution: did people return?
create or replace view private.active_days_distribution as
  with days as (
    select user_id, count(distinct day) as active_days from private.usage_days where signal = 'app_open' group by user_id
  )
  select least(active_days, 8)::integer as active_days, count(*)::integer as users from days group by 1;

revoke all on table private.usage_daily, private.active_days_distribution from public, anon, authenticated;
grant select on table private.usage_daily, private.active_days_distribution to service_role;

-- 3. A failed charge is not a decision. RevenueCat sends CANCELLATION with
--    reason BILLING_ERROR when Apple cannot charge. Older rows have no reason;
--    there the BILLING_ISSUE event of the same instant tells them apart.
create or replace view private.trial_outcomes_daily as
with starts as (
  select w.user_id, min(w.event_timestamp_ms) as started_ms
  from public.revenuecat_webhook_events w
  where w.event_type = 'INITIAL_PURCHASE' and w.environment = 'PRODUCTION'
  group by w.user_id
), facts as (
  select s.user_id, s.started_ms,
    (select min(c.event_timestamp_ms) from public.revenuecat_webhook_events c
      where c.user_id = s.user_id and c.event_type = 'CANCELLATION' and c.environment = 'PRODUCTION'
        and c.event_timestamp_ms >= s.started_ms
        and coalesce(c.cancel_reason, '') <> 'BILLING_ERROR'
        and not exists(select 1 from public.revenuecat_webhook_events b
          where b.user_id = c.user_id and b.event_type = 'BILLING_ISSUE' and b.environment = 'PRODUCTION'
            and abs(b.event_timestamp_ms - c.event_timestamp_ms) < 60000)) as cancelled_ms,
    exists(select 1 from public.revenuecat_webhook_events u where u.user_id = s.user_id
      and u.event_type = 'UNCANCELLATION' and u.environment = 'PRODUCTION') as uncancelled,
    exists(select 1 from public.revenuecat_webhook_events r where r.user_id = s.user_id
      and r.event_type = 'RENEWAL' and r.environment = 'PRODUCTION') as renewed,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_ending') as card_seen,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_keep') as keep_tapped,
    exists(select 1 from private.paywall_exposures e where e.user_id = s.user_id and e.context = 'trial_offer_completed') as offer_taken,
    exists(select 1 from public.revenuecat_webhook_events b where b.user_id = s.user_id
      and b.event_type = 'BILLING_ISSUE' and b.environment = 'PRODUCTION') as billing_issue
  from starts s
)
select (to_timestamp((started_ms::numeric / 1000.0)::double precision) at time zone 'Europe/Berlin')::date as start_day,
  count(*)::integer as first_purchases,
  count(*) filter (where cancelled_ms is not null and (cancelled_ms - started_ms) <= 3600000)::integer as cancelled_within_1h,
  count(*) filter (where cancelled_ms is not null and (cancelled_ms - started_ms) <= 86400000)::integer as cancelled_within_24h,
  count(*) filter (where cancelled_ms is not null)::integer as cancelled_any,
  count(*) filter (where uncancelled)::integer as uncancelled,
  count(*) filter (where renewed)::integer as renewed,
  count(*) filter (where card_seen)::integer as trial_card_seen,
  count(*) filter (where keep_tapped)::integer as trial_keep_tapped,
  count(*) filter (where offer_taken)::integer as trial_offer_completed,
  count(*) filter (where billing_issue)::integer as billing_issue,
  count(*) filter (where billing_issue and renewed)::integer as billing_recovered
from facts
group by 1;

commit;
