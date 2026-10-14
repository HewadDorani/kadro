# Growth funnel from backend data

PostHog is opt-in and effectively off, so the funnel is computed from data the
backend already stores. Two aggregate views (migration
`20261009100200_growth_funnel_views.sql`) return counts only: no user IDs, ages,
meals or free text.

Both live in the unexposed `private` schema and are granted to `service_role`
only. Query them in the Supabase dashboard **SQL editor** (runs as `postgres`).
They are not reachable from the app or the REST API.

## `private.growth_funnel_daily`

One row per signup day (`auth.users.created_at`, Europe/Berlin). Every column
counts users from that signup cohort.

| Column | Meaning |
| --- | --- |
| `new_users` | All new auth users, including anonymous installs |
| `adults` / `minors` | Profile age ≥ 18 / < 18 (users without an age are in neither) |
| `with_profile` | A `public.profiles` row exists (onboarding saved) |
| `tried_ai` | Any AI analysis request, or a free success in the lifetime ledger |
| `ai_success` | At least one completed AI analysis |
| `saved_meal` | At least one row in `public.meals` (scan, search or plan suggestion) |
| `meal_within_24h` | A meal saved within 24 h of signup |
| `meal_day1_plus` | A meal saved on a Berlin calendar day ≥ signup day + 1 |
| `meal_day7_plus` | A meal saved on a Berlin calendar day ≥ signup day + 7 |
| `paywall_shown` | Paywall seen at least once (`private.paywall_exposures`, from 09.10.2026) |
| `trial_or_purchase` | RevenueCat `INITIAL_PURCHASE`, environment `PRODUCTION` |

```sql
-- Last 30 signup days, newest first
select * from private.growth_funnel_daily
where signup_day >= current_date - 30
order by signup_day desc;

-- Weekly conversion rates
select date_trunc('week', signup_day)::date as week,
  sum(new_users) as new_users,
  round(100.0 * sum(saved_meal) / nullif(sum(new_users), 0), 1) as pct_saved_meal,
  round(100.0 * sum(meal_day1_plus) / nullif(sum(saved_meal), 0), 1) as pct_returned_day1,
  round(100.0 * sum(meal_day7_plus) / nullif(sum(saved_meal), 0), 1) as pct_returned_day7,
  round(100.0 * sum(ai_success) / nullif(sum(tried_ai), 0), 1) as pct_ai_success,
  sum(paywall_shown) as paywall_shown,
  sum(trial_or_purchase) as trial_or_purchase
from private.growth_funnel_daily
group by 1 order by 1 desc;
```

## `private.ai_failure_daily`

Refunded AI analyses per Berlin day (`refunded_at`) and `failure_code`. The
gateway records fixed codes only, for example `correction_required`,
`provider_timeout`, `provider_error`, `unclear_image`, `mass_required`,
`amount_ambiguous`, `missing_nutrition`, `daily_limit`, `global_quota`,
`provider_quota`, `capture_conflict`, `start_failed`, `quota_error`.
`unrecorded` means the refund happened before migration
`20261009100000_analysis_failure_codes.sql`. `unspecified` means an older
gateway version made the refund.

```sql
select * from private.ai_failure_daily
where day >= current_date - 14
order by day desc, count desc;

-- Share of refunds by reason, last 7 days
select failure_code, sum(count) as refunds,
  round(100.0 * sum(count) / sum(sum(count)) over (), 1) as pct
from private.ai_failure_daily
where day >= current_date - 7
group by 1 order by 2 desc;
```

## Limits

- `analysis_requests` rows are purged 30 days after completion or refund
  (`purge_analysis_ledger`). For older cohorts, `tried_ai`/`ai_success` fall back
  to the lifetime free ledger (`analysis_access.free_completed`), and
  `ai_failure_daily` only covers the last 30 days.
- A refunded request ID that the client retries successfully becomes `completed`
  and leaves `ai_failure_daily`.
- RevenueCat webhook rows are purged after 90 days. `period_type` is not stored,
  so a trial start and a direct first purchase are counted together. RevenueCat's
  `app_user_id` is the Supabase user ID (`Purchases.logIn(user.id)`), so rows map
  to the cohort directly. Sandbox (TestFlight/App Review) is excluded.
- Deleted accounts disappear from every count (cascade on `auth.users`). Deleted
  meals no longer count.
- Meal timing uses the client-provided `saved_at`.
- `paywall_shown` starts with the app build that calls `mark_paywall_shown`.
  Earlier cohorts show 0.

## Paywall purchase steps (2026-10-14)

`private.paywall_steps_daily` counts, per signup day, accounts that saw the paywall, tapped the purchase button, cancelled Apple's sheet, failed, are pending, or completed a purchase. Recorded server-side for everyone (first occurrence per account and step, no plan/price data), so it does not depend on the analytics opt-in.

```sql
select * from private.paywall_steps_daily order by signup_day desc;
```
