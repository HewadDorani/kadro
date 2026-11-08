-- Premium photo model pilot (owner decision 08.11.2026).
-- Who may use the premium model while VISION_PREMIUM_MODE=pilot, and how many
-- analyses a person started in the last 24 hours (the daily cap).

create table private.vision_pilot_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purpose text not null check (char_length(purpose) between 3 and 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table private.vision_pilot_accounts enable row level security;
revoke all on private.vision_pilot_accounts from public, anon, authenticated;
grant all on private.vision_pilot_accounts to service_role;

create or replace function public.premium_vision_status(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pilot', exists (select 1 from private.vision_pilot_accounts v where v.user_id = p_user_id and v.expires_at > now())
          or exists (select 1 from private.paywall_qa_accounts q where q.user_id = p_user_id and q.expires_at > now()),
    'recent', (select count(*) from public.analysis_requests a where a.user_id = p_user_id and a.reserved_at > now() - interval '24 hours')
  );
$$;
revoke all on function public.premium_vision_status(uuid) from public, anon, authenticated;
grant execute on function public.premium_vision_status(uuid) to service_role;
