begin;
set local lock_timeout = '5s';
-- Copying the existing German rows (~230k) and building three trigram
-- indexes takes a few minutes on the production instance.
set local statement_timeout = '20min';

-- Regional product index: one table for every market Kandro serves.
--   'de' Germany, Austria, Switzerland · 'gb' United Kingdom · 'us' United States
-- A derivative of the Open Food Facts database (ODbL 1.0), built per market by
-- scripts/build-products.py and loaded by scripts/load-products.mjs. Public
-- product records only, never user data. Only the nutrition edge function
-- (service role) reads it; the app never queries it directly.
--
-- public.products_de and public.store_brands (20261012120000) stay untouched
-- so an already deployed nutrition function keeps working until the new one
-- is deployed. Their German rows are copied here; a later migration drops
-- them once no deployed function reads them.

create table public.products (
  market text not null check (market in ('de', 'gb', 'us')),
  code text not null check (code ~ '^[0-9]{7,14}$'),
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
  search text generated always as (private.product_search_text(brands, name)) stored,
  primary key (market, code)
);

insert into public.products (market, code, name, brand, brands, stores, basis, package_g, package_ml, serving_g,
  kcal, protein, carbs, sugars, fat, sat_fat, fiber, salt, category, nutriscore, popularity, last_modified, build_id, updated_at)
select 'de', code, name, brand, brands, stores, basis, package_g, package_ml, serving_g,
  kcal, protein, carbs, sugars, fat, sat_fat, fiber, salt, category, nutriscore, popularity, last_modified, build_id, updated_at
from public.products_de;

-- One trigram index per market: every search filters on a literal market, so
-- the planner reads only that market's index.
create index products_search_de_trgm_idx on public.products using gin (search extensions.gin_trgm_ops) where market = 'de';
create index products_search_gb_trgm_idx on public.products using gin (search extensions.gin_trgm_ops) where market = 'gb';
create index products_search_us_trgm_idx on public.products using gin (search extensions.gin_trgm_ops) where market = 'us';
create index products_brands_fold_idx on public.products using gin (brands_fold);
create index products_market_popularity_idx on public.products (market, popularity desc);
-- Barcode lookup across markets (a US product scanned in Germany).
create index products_code_idx on public.products (code);
create index products_market_build_idx on public.products (market, build_id);

alter table public.products enable row level security;
revoke all on table public.products from public, anon, authenticated;
grant select, insert, update, delete on table public.products to service_role;

comment on table public.products is
  'Products sold per market (de = DE/AT/CH, gb, us), derived from Open Food Facts (ODbL 1.0, © Open Food Facts contributors). Per 100 g (basis g) or 100 ml (basis ml). No user data. Service role only.';

-- Supermarket chain → own brand, per market: "lidl skyr" means Milbona in
-- Germany and in the UK; "tesco" means Tesco, Tesco Finest, Stockwell & Co …
-- Only confident mappings: a wrong one sends people to another chain.
create table public.product_store_brands (
  market text not null check (market in ('de', 'gb', 'us')),
  store text not null check (store ~ '^[a-z]{2,20}$'),
  brand text not null check (char_length(brand) between 2 and 60),
  primary key (market, store, brand)
);
-- How people type a chain (folded like private.product_fold) → its store key.
create table public.product_store_words (
  market text not null check (market in ('de', 'gb', 'us')),
  phrase text not null check (phrase ~ '^[a-z0-9]+( [a-z0-9]+){0,3}$'),
  store text not null check (store ~ '^[a-z]{2,20}$'),
  primary key (market, phrase)
);
alter table public.product_store_brands enable row level security;
alter table public.product_store_words enable row level security;
revoke all on table public.product_store_brands from public, anon, authenticated;
revoke all on table public.product_store_words from public, anon, authenticated;
grant select, insert, update, delete on table public.product_store_brands to service_role;
grant select, insert, update, delete on table public.product_store_words to service_role;
comment on table public.product_store_brands is 'Supermarket chain → own brand per market, for product search. No user data.';
comment on table public.product_store_words is 'Typed chain names (folded) → store key per market, for product search. No user data.';

insert into public.product_store_brands (market, store, brand)
select 'de', store, brand from public.store_brands;

insert into public.product_store_brands (market, store, brand) values
  -- Austria and Switzerland (region 'de')
  ('de', 'hofer', 'Hofer'), ('de', 'hofer', 'Milfina'), ('de', 'hofer', 'Zurück zum Ursprung'),
  ('de', 'spar', 'Spar'), ('de', 'spar', 'S-Budget'), ('de', 'spar', 'Spar Natur*pur'),
  ('de', 'billa', 'Billa'), ('de', 'billa', 'Clever'),
  ('de', 'migros', 'Migros'), ('de', 'migros', 'M-Budget'), ('de', 'migros', 'M-Classic'),
  ('de', 'coop', 'Coop'), ('de', 'coop', 'Prix Garantie'), ('de', 'coop', 'Naturaplan'),
  -- United Kingdom
  ('gb', 'tesco', 'Tesco'), ('gb', 'tesco', 'Tesco Finest'), ('gb', 'tesco', 'Stockwell & Co'), ('gb', 'tesco', 'Hearty Food Co'),
  ('gb', 'sainsburys', 'Sainsbury''s'), ('gb', 'sainsburys', 'Taste the Difference'), ('gb', 'sainsburys', 'by Sainsbury''s'),
  ('gb', 'asda', 'Asda'), ('gb', 'asda', 'Extra Special'), ('gb', 'asda', 'Just Essentials'),
  ('gb', 'morrisons', 'Morrisons'), ('gb', 'morrisons', 'The Best'), ('gb', 'morrisons', 'Savers'),
  ('gb', 'ms', 'M&S'), ('gb', 'ms', 'Marks & Spencer'), ('gb', 'ms', 'M&S Food'),
  ('gb', 'waitrose', 'Waitrose'), ('gb', 'waitrose', 'Essential Waitrose'), ('gb', 'waitrose', 'No.1'), ('gb', 'waitrose', 'Waitrose & Partners'),
  ('gb', 'coop', 'Co-op'), ('gb', 'coop', 'Irresistible'), ('gb', 'coop', 'The Co-operative'),
  ('gb', 'aldi', 'Aldi'), ('gb', 'aldi', 'Specially Selected'), ('gb', 'aldi', 'Everyday Essentials'), ('gb', 'aldi', 'Cowbelle'),
  ('gb', 'aldi', 'Brooklea'), ('gb', 'aldi', 'Harvest Morn'),
  ('gb', 'lidl', 'Lidl'), ('gb', 'lidl', 'Milbona'), ('gb', 'lidl', 'Deluxe'), ('gb', 'lidl', 'Pilos'), ('gb', 'lidl', 'Crownfield'),
  ('gb', 'iceland', 'Iceland'),
  -- Spellings Open Food Facts records for the same own brands.
  ('gb', 'sainsburys', 'Sainsburys'), ('gb', 'ms', 'Marks & Spencers'), ('gb', 'coop', 'Coop'),
  -- United States
  ('us', 'walmart', 'Walmart'), ('us', 'walmart', 'Great Value'), ('us', 'walmart', 'Marketside'), ('us', 'walmart', 'Sam''s Choice'),
  ('us', 'costco', 'Costco'), ('us', 'costco', 'Kirkland Signature'), ('us', 'costco', 'Kirkland'),
  ('us', 'samsclub', 'Sam''s Club'), ('us', 'samsclub', 'Member''s Mark'),
  ('us', 'wegmans', 'Wegmans'), ('us', 'meijer', 'Meijer'), ('us', 'heb', 'H-E-B'), ('us', 'heb', 'Hill Country Fare'), ('us', 'publix', 'Publix'),
  ('us', 'traderjoes', 'Trader Joe''s'),
  ('us', 'wholefoods', 'Whole Foods Market'), ('us', 'wholefoods', '365 by Whole Foods Market'), ('us', 'wholefoods', '365 Everyday Value'),
  ('us', 'target', 'Target'), ('us', 'target', 'Good & Gather'), ('us', 'target', 'Favorite Day'), ('us', 'target', 'Market Pantry'),
  ('us', 'kroger', 'Kroger'), ('us', 'kroger', 'Simple Truth'), ('us', 'kroger', 'Simple Truth Organic'), ('us', 'kroger', 'Private Selection'),
  ('us', 'aldi', 'Aldi'), ('us', 'aldi', 'Friendly Farms'), ('us', 'aldi', 'Simply Nature'), ('us', 'aldi', 'Millville'), ('us', 'aldi', 'Clancy''s'),
  ('us', 'safeway', 'Safeway'), ('us', 'safeway', 'Signature Select'), ('us', 'safeway', 'O Organics'),
  ('us', 'albertsons', 'Albertsons'), ('us', 'albertsons', 'Signature Select'), ('us', 'albertsons', 'O Organics');

insert into public.product_store_words (market, phrase, store)
select distinct 'de', store, store from public.store_brands;
insert into public.product_store_words (market, phrase, store) values
  ('de', 'aldi sud', 'aldi'), ('de', 'aldi nord', 'aldi'), ('de', 'hofer', 'hofer'), ('de', 'spar', 'spar'), ('de', 'billa', 'billa'),
  ('de', 'migros', 'migros'), ('de', 'coop', 'coop'),
  ('gb', 'tesco', 'tesco'), ('gb', 'sainsburys', 'sainsburys'), ('gb', 'sainsbury s', 'sainsburys'), ('gb', 'sainsbury', 'sainsburys'),
  ('gb', 'asda', 'asda'), ('gb', 'morrisons', 'morrisons'), ('gb', 'm s', 'ms'), ('gb', 'm and s', 'ms'), ('gb', 'marks spencer', 'ms'),
  ('gb', 'marks and spencer', 'ms'), ('gb', 'waitrose', 'waitrose'), ('gb', 'co op', 'coop'), ('gb', 'coop', 'coop'),
  ('gb', 'aldi', 'aldi'), ('gb', 'lidl', 'lidl'), ('gb', 'iceland', 'iceland'),
  ('us', 'walmart', 'walmart'), ('us', 'wal mart', 'walmart'), ('us', 'costco', 'costco'), ('us', 'trader joes', 'traderjoes'),
  ('us', 'trader joe s', 'traderjoes'), ('us', 'trader joe', 'traderjoes'), ('us', 'whole foods', 'wholefoods'),
  ('us', 'whole foods market', 'wholefoods'), ('us', 'target', 'target'), ('us', 'kroger', 'kroger'), ('us', 'aldi', 'aldi'),
  ('us', 'safeway', 'safeway'), ('us', 'albertsons', 'albertsons'), ('us', 'sams club', 'samsclub'), ('us', 'sam s club', 'samsclub'),
  ('us', 'wegmans', 'wegmans'), ('us', 'meijer', 'meijer'), ('us', 'heb', 'heb'), ('us', 'h e b', 'heb'), ('us', 'publix', 'publix')
on conflict (market, phrase) do nothing;

/*
 * Ranked product search for the nutrition edge function, per market.
 *
 *   q       free text: "milbona skyr", "lidl skyr", "tesco meal deal sandwich", "kirkland protein bar"
 *   market  'de' | 'gb' | 'us'; anything else returns nothing
 *   brands  optional brand hints (boost only)
 *   lim     1..50
 *
 * Same ranking as search_products_de. Chain names (product_store_words, also
 * several words: "trader joes", "m&s") are not matched as text: they select
 * that chain's own brands (product_store_brands) and products tagged with the
 * store, and restrict the result to them when that leaves anything. Every
 * other word must occur in "brands + name" (words of one or two letters as
 * whole words). When that finds fewer rows than asked for, trigram word
 * similarity adds near misses. Rank: word similarity to the name, closeness
 * of the whole name, a brand boost (store brand, hint, or a query word that is
 * the brand), name-prefix boosts and log popularity.
 */
create function public.search_products(q text, market text, brands text[] default null, lim integer default 25)
returns table (
  code text, name text, brand text, all_brands text[], stores text[], basis text,
  package_g numeric, package_ml numeric, serving_g numeric,
  kcal numeric, protein numeric, carbs numeric, sugars numeric, fat numeric,
  sat_fat numeric, fiber numeric, salt numeric, category text, popularity integer, score real
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  mk text := search_products.market;
  qn text := private.product_fold(left(coalesce(q, ''), 120));
  rest text;
  words text[];
  content text[] := '{}';
  store_hits text[] := '{}';
  store_set text[] := '{}';
  hint_set text[] := '{}';
  qc text;
  w text;
  phrase record;
  n integer := least(greatest(coalesce(lim, 25), 1), 50);
  filters text := '';
  codes text[] := '{}';
  more text[];
begin
  if mk is null or mk not in ('de', 'gb', 'us') then return; end if;
  if qn is null or char_length(qn) < 2 then return; end if;

  -- Chain names first, longest phrase first ("aldi sud" before "aldi").
  rest := ' ' || qn || ' ';
  for phrase in
    select s.phrase, s.store from public.product_store_words s
    where s.market = mk order by char_length(s.phrase) desc, s.phrase
  loop
    if rest like '% ' || phrase.phrase || ' %' then
      if not (phrase.store = any(store_hits)) then store_hits := store_hits || phrase.store; end if;
      rest := pg_catalog.replace(rest, ' ' || phrase.phrase || ' ', ' ');
    end if;
  end loop;
  rest := pg_catalog.btrim(rest);
  if rest <> '' then
    foreach w in array pg_catalog.regexp_split_to_array(rest, ' ') loop
      if w <> '' and w not in ('und', 'and', 'mit', 'with', 'von', 'the', 'of') and not (w = any(content)) then
        content := content || w;
      end if;
    end loop;
  end if;
  if cardinality(content) > 6 then content := content[1:6]; end if;
  qc := pg_catalog.array_to_string(content, ' ');

  select coalesce(pg_catalog.array_agg(distinct private.product_fold(s.brand)), '{}') into store_set
  from public.product_store_brands s where s.market = mk and s.store = any(store_hits);
  select coalesce(pg_catalog.array_agg(distinct f), '{}') into hint_set
  from pg_catalog.unnest(coalesce(search_products.brands, '{}')) h, lateral (select private.product_fold(left(h, 60)) as f) x
  where x.f <> '';
  hint_set := hint_set[1:30];

  perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);

  -- The market is a literal in every candidate query, so the planner can use
  -- that market's partial trigram index. Folded words hold only [a-z0-9 ],
  -- and every value is bound through format(%L).
  if cardinality(content) > 0 then
    filters := format(' and p.market = %L', mk);
    for i in 1 .. cardinality(content) loop
      if char_length(content[i]) <= 2 then
        filters := filters || format(' and (%L || p.search || %L) like %L', ' ', ' ', '% ' || content[i] || ' %');
      else
        filters := filters || format(' and p.search like %L', '%' || content[i] || '%');
      end if;
    end loop;
    if cardinality(store_hits) > 0 then
      execute format('select coalesce(array_agg(c), %L) from (select p.code c from public.products p where true %s
          and (p.brands_fold operator(pg_catalog.&&) $1 or p.stores operator(pg_catalog.&&) $2)
          order by p.popularity desc limit 4000) x', '{}', filters)
        into codes using store_set, store_hits;
    end if;
    if cardinality(codes) = 0 then
      execute format('select coalesce(array_agg(c), %L) from (select p.code c from public.products p where true %s
          order by p.popularity desc limit 4000) x', '{}', filters) into codes;
    end if;
    if cardinality(codes) < n and char_length(qc) >= 3 then
      execute format('select coalesce(array_agg(x.code), %L) from (
          select p.code from public.products p
          where p.market = %L and p.search operator(extensions.%%>) $1 and not (p.code = any($2))
          order by extensions.word_similarity($1, p.search) desc, p.popularity desc
          limit 200) x', '{}', mk)
        into more using qc, codes;
      codes := codes || more;
    end if;
  elsif cardinality(store_hits) > 0 then
    select coalesce(pg_catalog.array_agg(x.code), '{}') into codes from (
      select p.code from public.products p
      where p.market = mk and (p.brands_fold operator(pg_catalog.&&) store_set or p.stores operator(pg_catalog.&&) store_hits)
      order by p.popularity desc limit 1000) x;
  else
    return;
  end if;

  return query
  select p.code, p.name, p.brand, p.brands, p.stores, p.basis, p.package_g, p.package_ml, p.serving_g,
         p.kcal, p.protein, p.carbs, p.sugars, p.fat, p.sat_fat, p.fiber, p.salt, p.category, p.popularity,
         s.score::real
  from public.products p
  cross join lateral (
    select
      case when qc = '' then 0 else
        extensions.word_similarity(qc, p.name_fold) + 0.5 * extensions.similarity(qc, p.name_fold)
        + case when content[1] is not null and p.name_fold like content[1] || '%' then 0.3 else 0 end
        + case when p.name_fold like qc || '%' then 0.2 else 0 end
        -- every word starts a word of brand + name
        + case when not exists (select 1 from pg_catalog.unnest(content) t
                                where (' ' || p.search) not like ('% ' || t || '%')) then 0.3 else 0 end
        -- a query word that is the product's brand ("alpro", "heinz", "chobani")
        + case when exists (select 1 from pg_catalog.unnest(p.brands_fold) b
                            where (' ' || qc || ' ') like ('% ' || b || ' %')) then 0.4 else 0 end
      end
      + case when p.brands_fold operator(pg_catalog.&&) store_set then 0.6 else 0 end
      + case when p.stores operator(pg_catalog.&&) store_hits then 0.3 else 0 end
      + case when p.brands_fold operator(pg_catalog.&&) hint_set then 0.6 else 0 end
      + 0.1 * ln(1 + p.popularity)
      as score
  ) s
  where p.market = mk and p.code = any(codes)
  order by s.score desc, p.popularity desc, p.code
  limit n;
end $$;

revoke all on function public.search_products(text, text, text[], integer) from public, anon, authenticated;
grant execute on function public.search_products(text, text, text[], integer) to service_role;

notify pgrst, 'reload schema';
commit;
