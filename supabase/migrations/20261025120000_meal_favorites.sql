begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Favourite meals ("Zu Favoriten hinzufügen"): one starred meal exactly as
-- the user logged it (items with grams, sources and per-100 g references), so
-- it re-logs 1:1 from Today, the scan sheet or "Alle Favoriten". Wellness data
-- like the diary: owner-only, written by the app only with wellness consent,
-- deleted with the account (FK to auth.users on delete cascade). The device
-- keeps its own copy and works offline; this table is the cross-device copy.
create table public.meal_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  meal_type text not null check (meal_type in ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
  confidence text not null check (confidence in ('high', 'medium')),
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 40
    and pg_column_size(items) <= 65536
  ),
  calories numeric(7, 1) not null check (calories between 0 and 20000),
  protein numeric(6, 1) not null check (protein between 0 and 2000),
  carbs numeric(6, 1) not null check (carbs between 0 and 2000),
  fat numeric(6, 1) not null check (fat between 0 and 2000),
  fiber numeric(6, 1) not null default 0 check (fiber between 0 and 2000),
  starred_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index meal_favorites_user_updated_idx on public.meal_favorites (user_id, updated_at desc);

alter table public.meal_favorites enable row level security;
revoke all on table public.meal_favorites from public, anon, authenticated;
grant select, insert, update, delete on table public.meal_favorites to authenticated;

create policy meal_favorites_select_own on public.meal_favorites
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy meal_favorites_insert_own on public.meal_favorites
  for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy meal_favorites_update_own on public.meal_favorites
  for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy meal_favorites_delete_own on public.meal_favorites
  for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Every item is a real, complete food row: a name, grams within the app's
-- limits, non-negative nutrients and a source object. Unresolved analysis
-- rows (source.code = 'unmatched') are never stored. Totals must be the sum
-- of the items (rounding tolerance), so a favourite cannot drift from what it
-- re-logs. And a bounded personal list: at most 100 favourites per account.
create function private.validate_meal_favorite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  sum_calories numeric := 0;
  sum_protein numeric := 0;
begin
  -- Runs before the table's check constraints, so it checks the shape first.
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception 'meal_favorite_items_invalid' using errcode = 'check_violation';
  end if;
  for item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'name') is distinct from 'string'
      or char_length(btrim(item ->> 'name')) not between 1 and 160
      or jsonb_typeof(item -> 'amountG') is distinct from 'number'
      or jsonb_typeof(item -> 'calories') is distinct from 'number'
      or jsonb_typeof(item -> 'protein') is distinct from 'number'
      or jsonb_typeof(item -> 'carbs') is distinct from 'number'
      or jsonb_typeof(item -> 'fat') is distinct from 'number'
      or jsonb_typeof(item -> 'source') is distinct from 'object'
      or jsonb_typeof(item -> 'source' -> 'provider') is distinct from 'string'
      or coalesce(item -> 'source' ->> 'code', '') = 'unmatched'
    then
      raise exception 'meal_favorite_item_invalid' using errcode = 'check_violation';
    end if;
    if (item ->> 'amountG')::numeric not between 0.1 and 5000
      or (item ->> 'calories')::numeric not between 0 and 10000
      or (item ->> 'protein')::numeric not between 0 and 1000
      or (item ->> 'carbs')::numeric not between 0 and 1000
      or (item ->> 'fat')::numeric not between 0 and 1000
      or (jsonb_typeof(item -> 'fiber') = 'number' and (item ->> 'fiber')::numeric not between 0 and 1000)
    then
      raise exception 'meal_favorite_item_out_of_range' using errcode = 'check_violation';
    end if;
    sum_calories := sum_calories + (item ->> 'calories')::numeric;
    sum_protein := sum_protein + (item ->> 'protein')::numeric;
  end loop;
  if abs(sum_calories - new.calories) > 1 + jsonb_array_length(new.items)
    or abs(sum_protein - new.protein) > 1 + jsonb_array_length(new.items) then
    raise exception 'meal_favorite_totals_mismatch' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.meal_favorites where user_id = new.user_id) >= 100 then
    raise exception 'meal_favorite_limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.validate_meal_favorite() from public, anon, authenticated;
create trigger meal_favorites_validate before insert or update on public.meal_favorites
  for each row execute function private.validate_meal_favorite();

comment on table public.meal_favorites is
  'Favourite meals as logged (items with grams); owner-only; max 100 per account; deleted with the account.';

notify pgrst, 'reload schema';
commit;
