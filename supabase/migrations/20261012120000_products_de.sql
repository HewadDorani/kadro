begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- German supermarket product index: a derivative of the Open Food Facts
-- database (ODbL 1.0), built by scripts/build-products-de.py and loaded by
-- scripts/load-products-de.mjs. Public product records only, never user data.
-- Only the nutrition edge function (service role) reads it; the app never
-- queries it directly, so search keeps the edge function's auth, consent and
-- provider limits.

create schema if not exists extensions;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm'
             and extnamespace <> 'extensions'::regnamespace) then
    raise exception 'pg_trgm is installed outside the extensions schema; move it before applying products_de';
  end if;
end $$;
create extension if not exists pg_trgm with schema extensions;

-- One folding for stored rows and queries: lower case, ä→a, ö→o, ü→u, ß→ss,
-- other Latin accents dropped, everything that is not a letter or digit
-- becomes a single space ("K-Classic" → "k classic", "ja!" → "ja").
create function private.product_fold(value text) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.translate(
      pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.lower(value), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'),
      'äöüàáâãåāèéêëēìíîïòóôõøōùúûūýÿñçč',
      'aouaaaaaaeeeeeiiiiooooooouuuuyyncc'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create function private.product_fold_all(value text[]) returns text[]
language sql immutable strict parallel safe set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(f order by o), '{}')
  from pg_catalog.unnest(value) with ordinality as u(v, o),
       lateral (select private.product_fold(u.v) as f) folded
  where folded.f <> ''
$$;

-- Brands first, then the name: "milbona skyr natur".
create function private.product_search_text(brands text[], name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select private.product_fold(pg_catalog.array_to_string(coalesce(brands, '{}'), ' ') || ' ' || coalesce(name, ''))
$$;

create table public.products_de (
  code text primary key check (code ~ '^[0-9]{7,14}$'),
  name text not null check (char_length(name) between 2 and 130),
  brand text check (brand is null or char_length(brand) between 1 and 60),
  brands text[] not null default '{}' check (cardinality(brands) <= 8),
  stores text[] not null default '{}' check (cardinality(stores) <= 10),
  -- Whether kcal…salt are per 100 g or per 100 ml. A volume row is never
  -- presented as grams.
  basis text not null default 'g' check (basis in ('g', 'ml')),
  package_g numeric(7, 1) check (package_g is null or package_g between 1 and 25000),
  package_ml numeric(7, 1) check (package_ml is null or package_ml between 1 and 25000),
  serving_g numeric(6, 1) check (serving_g is null or serving_g between 1 and 2000),
  kcal numeric(5, 1) not null check (kcal between 0 and 950),
  protein numeric(4, 1) not null check (protein between 0 and 100),
  carbs numeric(4, 1) not null check (carbs between 0 and 100),
  sugars numeric(4, 1) check (sugars is null or sugars between 0 and 100),
  fat numeric(4, 1) not null check (fat between 0 and 100),
  sat_fat numeric(4, 1) check (sat_fat is null or sat_fat between 0 and 100),
  fiber numeric(4, 1) check (fiber is null or fiber between 0 and 100),
  salt numeric(4, 1) check (salt is null or salt between 0 and 100),
  category text check (category is null or char_length(category) <= 60),
  nutriscore text check (nutriscore is null or nutriscore in ('a', 'b', 'c', 'd', 'e')),
  popularity integer not null default 0 check (popularity >= 0),
  last_modified timestamptz,
  build_id text not null check (build_id ~ '^[0-9A-Za-z_.-]{1,40}$'),
  updated_at timestamptz not null default now(),
  brand_fold text generated always as (private.product_fold(coalesce(brand, ''))) stored,
  brands_fold text[] generated always as (private.product_fold_all(brands)) stored,
  name_fold text generated always as (private.product_fold(name)) stored,
  search text generated always as (private.product_search_text(brands, name)) stored
);

create index products_de_search_trgm_idx on public.products_de using gin (search extensions.gin_trgm_ops);
create index products_de_brand_fold_idx on public.products_de (brand_fold);
create index products_de_brands_fold_idx on public.products_de using gin (brands_fold);
create index products_de_build_id_idx on public.products_de (build_id);

alter table public.products_de enable row level security;
revoke all on table public.products_de from public, anon, authenticated;
grant select, insert, update, delete on table public.products_de to service_role;

comment on table public.products_de is
  'Products sold in Germany, derived from Open Food Facts (ODbL 1.0, © Open Food Facts contributors). Per 100 g (basis g) or 100 ml (basis ml). No user data. Service role only.';

-- Store own-brands: "lidl skyr" means Milbona skyr. Only confident mappings.
create table public.store_brands (
  store text not null check (store ~ '^[a-z]{2,20}$'),
  brand text not null check (char_length(brand) between 2 and 60),
  primary key (store, brand)
);
alter table public.store_brands enable row level security;
revoke all on table public.store_brands from public, anon, authenticated;
grant select, insert, update, delete on table public.store_brands to service_role;
comment on table public.store_brands is 'Supermarket chain → own brand, for product search. No user data.';

insert into public.store_brands (store, brand) values
  ('lidl', 'Lidl'), ('lidl', 'Milbona'), ('lidl', 'Pilos'), ('lidl', 'Cien'), ('lidl', 'Crownfield'),
  ('lidl', 'Chef Select'), ('lidl', 'Deluxe'), ('lidl', 'Fin Carré'), ('lidl', 'Freeway'), ('lidl', 'Combino'),
  ('lidl', 'Snack Day'), ('lidl', 'Sondey'), ('lidl', 'Solevita'), ('lidl', 'Grafschafter'), ('lidl', 'Lord Nelson'),
  ('lidl', 'Dulano'), ('lidl', 'Alesto'), ('lidl', 'Vitasia'), ('lidl', 'Bellarom'), ('lidl', 'Vemondo'),
  ('lidl', 'Favorina'), ('lidl', 'Baresa'), ('lidl', 'Duc de Coeur'), ('lidl', 'McEnnedy'),
  ('aldi', 'Aldi'), ('aldi', 'Milsani'), ('aldi', 'Moser Roth'), ('aldi', 'Choco Changers'), ('aldi', 'Gut Bio'),
  ('aldi', 'Lyttos'), ('aldi', 'Mucci'), ('aldi', 'Golden Seafood'), ('aldi', 'Almare'), ('aldi', 'Rio d''Oro'),
  ('rewe', 'Rewe'), ('rewe', 'ja!'), ('rewe', 'REWE Beste Wahl'), ('rewe', 'REWE Bio'), ('rewe', 'REWE Feine Welt'),
  ('edeka', 'Gut & Günstig'), ('edeka', 'EDEKA'), ('edeka', 'EDEKA Bio'),
  ('kaufland', 'Kaufland'), ('kaufland', 'K-Classic'), ('kaufland', 'K-Bio'), ('kaufland', 'K-Favourites'),
  ('penny', 'Penny'), ('penny', 'Naturgut'),
  ('dm', 'dmBio'), ('dm', 'dm Bio');

/*
 * Ranked product search for the nutrition edge function.
 *
 *   q      free text: "milbona skyr", "lidl skyr", "ja gouda", "k-classic joghurt"
 *   brands optional brand hints (boost only)
 *   lim    1..50
 *
 * Store words (lidl, aldi, rewe, …) are not matched as text: they select that
 * chain's own brands (store_brands) and products tagged with the store, and
 * restrict the result to them when that leaves anything. Every other word must
 * occur in "brands + name" (words of one or two letters as whole words). When
 * that finds fewer rows than asked for, trigram word similarity adds near
 * misses ("proteinriegel" → "Protein Riegel"). Rank: word similarity to the
 * name, closeness of the whole name, a brand boost (store brand, hint, or a
 * query word that is the brand), name-prefix boosts and log popularity.
 */
create function public.search_products_de(q text, brands text[] default null, lim integer default 25)
returns table (
  code text, name text, brand text, all_brands text[], stores text[], basis text,
  package_g numeric, package_ml numeric, serving_g numeric,
  kcal numeric, protein numeric, carbs numeric, sugars numeric, fat numeric,
  sat_fat numeric, fiber numeric, salt numeric, category text, popularity integer, score real
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  qn text := private.product_fold(left(coalesce(q, ''), 120));
  words text[];
  content text[] := '{}';
  store_hits text[] := '{}';
  store_set text[] := '{}';
  hint_set text[] := '{}';
  qc text;
  i integer := 1;
  w text;
  n integer := least(greatest(coalesce(lim, 25), 1), 50);
  filters text := '';
  codes text[] := '{}';
  more text[];
begin
  if qn is null or char_length(qn) < 2 then return; end if;
  words := pg_catalog.regexp_split_to_array(qn, ' ');
  while i <= cardinality(words) loop
    w := words[i];
    if exists (select 1 from public.store_brands s where s.store = w) then
      store_hits := store_hits || w;
      if w = 'aldi' and words[i + 1] in ('sud', 'nord') then i := i + 1; end if;
    elsif w not in ('und', 'and', 'mit', 'with', 'von', 'the') and not (w = any(content)) then
      content := content || w;
    end if;
    i := i + 1;
  end loop;
  if cardinality(content) > 6 then content := content[1:6]; end if;
  qc := pg_catalog.array_to_string(content, ' ');

  select coalesce(pg_catalog.array_agg(distinct private.product_fold(s.brand)), '{}') into store_set
  from public.store_brands s where s.store = any(store_hits);
  select coalesce(pg_catalog.array_agg(distinct f), '{}') into hint_set
  from pg_catalog.unnest(coalesce(search_products_de.brands, '{}')) h, lateral (select private.product_fold(left(h, 60)) as f) x
  where x.f <> '';
  hint_set := hint_set[1:30];

  perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);

  if cardinality(content) > 0 then
    -- Folded words hold only [a-z0-9 ], so they are safe inside LIKE patterns.
    for i in 1 .. cardinality(content) loop
      if char_length(content[i]) <= 2 then
        filters := filters || format(' and (%L || p.search || %L) like %L', ' ', ' ', '% ' || content[i] || ' %');
      else
        filters := filters || format(' and p.search like %L', '%' || content[i] || '%');
      end if;
    end loop;
    if cardinality(store_hits) > 0 then
      execute format('select coalesce(array_agg(c), %L) from (select p.code c from public.products_de p where true %s
          and (p.brands_fold operator(pg_catalog.&&) $1 or p.stores operator(pg_catalog.&&) $2)
          order by p.popularity desc limit 4000) x', '{}', filters)
        into codes using store_set, store_hits;
    end if;
    if cardinality(codes) = 0 then
      execute format('select coalesce(array_agg(c), %L) from (select p.code c from public.products_de p where true %s
          order by p.popularity desc limit 4000) x', '{}', filters) into codes;
    end if;
    if cardinality(codes) < n and char_length(qc) >= 3 then
      select coalesce(pg_catalog.array_agg(x.code), '{}') into more from (
        select p.code from public.products_de p
        where p.search operator(extensions.%>) qc and not (p.code = any(codes))
        order by extensions.word_similarity(qc, p.search) desc, p.popularity desc
        limit 200) x;
      codes := codes || more;
    end if;
  elsif cardinality(store_hits) > 0 then
    select coalesce(pg_catalog.array_agg(x.code), '{}') into codes from (
      select p.code from public.products_de p
      where p.brands_fold operator(pg_catalog.&&) store_set or p.stores operator(pg_catalog.&&) store_hits
      order by p.popularity desc limit 1000) x;
  else
    return;
  end if;

  return query
  select p.code, p.name, p.brand, p.brands, p.stores, p.basis, p.package_g, p.package_ml, p.serving_g,
         p.kcal, p.protein, p.carbs, p.sugars, p.fat, p.sat_fat, p.fiber, p.salt, p.category, p.popularity,
         s.score::real
  from public.products_de p
  cross join lateral (
    select
      case when qc = '' then 0 else
        extensions.word_similarity(qc, p.name_fold) + 0.5 * extensions.similarity(qc, p.name_fold)
        + case when content[1] is not null and p.name_fold like content[1] || '%' then 0.3 else 0 end
        + case when p.name_fold like qc || '%' then 0.2 else 0 end
        -- every word starts a word of brand + name
        + case when not exists (select 1 from pg_catalog.unnest(content) t
                                where (' ' || p.search) not like ('% ' || t || '%')) then 0.3 else 0 end
        -- a query word that is the product's brand ("alpro", "ehrmann", "milbona")
        + case when exists (select 1 from pg_catalog.unnest(p.brands_fold) b
                            where (' ' || qc || ' ') like ('% ' || b || ' %')) then 0.4 else 0 end
      end
      + case when p.brands_fold operator(pg_catalog.&&) store_set then 0.6 else 0 end
      + case when p.stores operator(pg_catalog.&&) store_hits then 0.3 else 0 end
      + case when p.brands_fold operator(pg_catalog.&&) hint_set then 0.6 else 0 end
      + 0.1 * ln(1 + p.popularity)
      as score
  ) s
  where p.code = any(codes)
  order by s.score desc, p.popularity desc, p.code
  limit n;
end $$;

revoke all on function private.product_fold(text) from public, anon, authenticated;
revoke all on function private.product_fold_all(text[]) from public, anon, authenticated;
revoke all on function private.product_search_text(text[], text) from public, anon, authenticated;
grant execute on function private.product_fold(text) to service_role;
grant execute on function private.product_fold_all(text[]) to service_role;
grant execute on function private.product_search_text(text[], text) to service_role;
revoke all on function public.search_products_de(text, text[], integer) from public, anon, authenticated;
grant execute on function public.search_products_de(text, text[], integer) to service_role;

notify pgrst, 'reload schema';
commit;
