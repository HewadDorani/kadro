#!/usr/bin/env python3
"""Regional product index (20261012120000 + 20261025120000) in an isolated local Postgres.

Usage: KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-<name> KANDRO_TEST_PG_PORT=<port> \
  python3 scripts/validate-products-postgres.py [--data de=products-de.ndjson.gz --data gb=… --data us=…]

Creates and drops its own database (with the Supabase role/schema stubs the
migrations need), applies both migrations (German rows already in
products_de are copied into public.products), loads synthetic fixture rows of
every market through scripts/load-products.mjs (resume, idempotency, prune,
market isolation) and checks grants and ranking. Never touches a linked
Supabase project. With --data it also loads real builds and prints latency
and the top 3 for the benchmark queries of each market.
"""
import gzip, json, os, pathlib, re, subprocess, sys, tempfile, time, uuid

root = pathlib.Path(__file__).resolve().parents[1]
host = os.environ.get('KANDRO_TEST_PG_SOCKET', '')
assert host.startswith('/tmp/kandro-pg-'), 'Dedicated local PG only (KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-…)'
port = os.environ.get('KANDRO_TEST_PG_PORT', '56341')
user = os.environ.get('KANDRO_TEST_PG_USER', 'postgres')
database = 'kandro_products_test_' + uuid.uuid4().hex[:10]
base = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', port, '-U', user]
migration_de = (root / 'supabase/migrations/20261012120000_products_de.sql').read_text()
migration_markets = (root / 'supabase/migrations/20261025120000_products_markets.sql').read_text()
data_args = dict(arg.split('=', 1) for i, arg in enumerate(sys.argv) if i and sys.argv[i - 1] == '--data')
keep = '--keep' in sys.argv


def run(sql, db=database, error=None):
    result = subprocess.run(base + ['-d', db], input=sql, text=True, capture_output=True)
    if error:
        assert result.returncode and error in result.stderr, (error, result.stdout, result.stderr)
        return result.stderr
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def check(name):
    print('PASS', name, flush=True)


def load(market, path, *extra):
    url = f'postgresql://{user}@/{database}?host={host}&port={port}'
    result = subprocess.run(['node', str(root / 'scripts/load-products.mjs'), '--market', market, '--file', path, '--db-url', url, *extra],
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def search(q, market='de', brands=None, lim=5):
    hint = 'null' if brands is None else 'array[' + ','.join(quote(b) for b in brands) + ']::text[]'
    mk = 'null' if market is None else quote(market)
    rows = run(f"set role service_role; select code || '|' || coalesce(brand,'') || '|' || name from public.search_products({quote(q)}, {mk}, {hint}, {lim})")
    return [r.split('|', 2) for r in rows.splitlines() if r]


# Synthetic fixture rows (not real products): enough to pin the ranking rules.
def row(code, name, brand=None, brands=None, stores=(), popularity=0, basis='g', market=None, **n):
    values = dict(kcal=100, protein=5, carbs=10, fat=3)
    values.update(n)
    record = {'code': code, 'name': name, 'brand': brand, 'brands': brands or ([brand] if brand else []), 'stores': list(stores),
              'basis': basis, 'package_g': 500 if basis == 'g' else None, 'package_ml': 1000 if basis == 'ml' else None,
              'serving_g': None, 'sugars': None, 'sat_fat': None, 'fiber': None, 'salt': None, 'category': None,
              'nutriscore': None, 'popularity': popularity, 'last_modified': 1760000000, **values}
    if market:
        record['market'] = market
    return record


FIXTURE_DE = [
    row('4000000000001', 'Skyr Natur', 'Milbona', stores=['lidl'], popularity=40, kcal=63, protein=11, carbs=4, fat=0.2),
    row('4000000000002', 'Skyr vanille', 'Siggi', popularity=900, kcal=80, protein=9, carbs=8, fat=0.4),
    row('3000000000003', 'Skyr nature à l’islandaise', 'Les 2 Vaches', popularity=2000, kcal=60, protein=10, carbs=4, fat=0.2),
    row('4000000000004', 'Gouda jung', 'ja!', brands=['ja!', 'Rewe'], stores=['rewe'], popularity=30, kcal=356, protein=24, carbs=0.1, fat=29),
    row('4000000000005', 'Gouda mittelalt', 'Gut & Günstig', stores=['edeka'], popularity=10, kcal=360, protein=24, carbs=0.1, fat=29),
    row('4000000000006', 'Fruchtjoghurt Erdbeere', 'K-Classic', stores=['kaufland'], popularity=5, kcal=95, protein=3.5, carbs=14, fat=2.7),
    row('4000000000007', 'Joghurt mild 3,5 %', 'Weihenstephan', popularity=500, kcal=68, protein=3.8, carbs=4.6, fat=3.5),
    row('4000000000008', 'Pinky Donut', 'Lidl', stores=['lidl'], popularity=12, kcal=420, protein=5, carbs=50, fat=22),
    row('4000000000009', 'Donut Schoko', 'Aldi', popularity=8, kcal=430, protein=5, carbs=48, fat=24),
    row('4000000000010', 'Protein Riegel Schoko', 'Lidl', stores=['lidl'], popularity=50, kcal=360, protein=33, carbs=30, fat=11),
    row('4000000000011', 'Haferdrink Barista', 'Oatly', basis='ml', popularity=700, kcal=59, protein=1, carbs=6.6, fat=3),
    row('4000000000012', 'Milchreis Klassik', 'Müller', popularity=300, kcal=110, protein=3.5, carbs=17, fat=3),
    row('4000000000013', 'Reis Milch Dessert', 'Rewe Beste Wahl', brands=['REWE Beste Wahl'], stores=['rewe'], popularity=4, kcal=120, protein=3, carbs=19, fat=3.4),
    row('4000000000014', 'Schokopudding', 'Ehrmann', brands=['Ehrmann', 'High Protein'], popularity=90, kcal=74, protein=10, carbs=5.2, fat=1.4),
    row('9000000000015', 'Joghurt Natur', 'M-Classic', stores=['migros'], popularity=20, kcal=70, protein=4, carbs=5, fat=3.5),
]
FIXTURE_GB = [
    row('5000000000101', 'Chicken & Bacon Sandwich', 'Tesco', stores=['tesco'], popularity=300, kcal=230, protein=13, carbs=22, fat=9.5),
    row('5000000000102', 'Egg Mayonnaise Sandwich', 'Tesco Finest', stores=['tesco'], popularity=120, kcal=240, protein=10, carbs=21, fat=12),
    row('5000000000103', 'Chicken Salad Sandwich', "Sainsbury's", stores=['sainsburys'], popularity=500, kcal=180, protein=12, carbs=20, fat=5),
    row('5000000000104', 'Baked Beans in Tomato Sauce', 'Heinz', popularity=2000, kcal=78, protein=4.7, carbs=12.5, fat=0.2),
    row('5000000000105', 'Baked Beans', 'Stockwell & Co', popularity=50, kcal=73, protein=4.3, carbs=12, fat=0.3),
    row('5000000000106', 'Skyr Icelandic Style Yogurt', 'Milbona', stores=['lidl'], popularity=60, kcal=63, protein=11, carbs=4, fat=0.2),
    row('5000000000107', 'Medium White Bread', 'Warburtons', popularity=900, kcal=243, protein=9.5, carbs=44, fat=2.2),
    row('5000000000108', 'Natural Organic Yogurt', 'Yeo Valley', popularity=400, kcal=82, protein=4.6, carbs=6.2, fat=4.2),
    row('5000000000109', 'Prawn Mayonnaise Sandwich', 'M&S', brands=['M&S', 'Marks & Spencer'], stores=['ms'], popularity=200, kcal=220, protein=11, carbs=22, fat=9),
    row('5000000000110', 'Greek Style Yogurt', 'Cowbelle', stores=['aldi'], popularity=30, kcal=130, protein=5, carbs=6, fat=10),
    # Same barcode as a German row: the market decides, not the code alone.
    row('4000000000001', 'Skyr Natural', 'Milbona', stores=['lidl'], popularity=5, kcal=63, protein=11, carbs=4, fat=0.2),
]
FIXTURE_US = [
    row('0000000000201', 'Protein Bar Chocolate Chip Cookie Dough', 'Kirkland Signature', stores=['costco'], popularity=800, kcal=380, protein=35, carbs=40, fat=13),
    row('0000000000202', 'Quest Protein Bar Cookies & Cream', 'Quest', popularity=1200, kcal=350, protein=33, carbs=37, fat=13),
    row('0000000000203', 'Non-Fat Greek Yogurt Plain', 'Chobani', popularity=1500, kcal=55, protein=10, carbs=3.6, fat=0),
    row('0000000000204', 'Whole Milk', 'Great Value', stores=['walmart'], popularity=700, basis='ml', kcal=61, protein=3.2, carbs=4.8, fat=3.3),
    row('0000000000205', 'Ultra-Filtered Milk 2%', 'Fairlife', popularity=900, basis='ml', kcal=50, protein=5.4, carbs=2.5, fat=1.9),
    row('0000000000206', 'Peanut Butter Pretzels', "Trader Joe's", stores=['traderjoes'], popularity=300, kcal=500, protein=15, carbs=55, fat=24),
    row('0000000000207', 'Organic Hummus', 'Good & Gather', stores=['target'], popularity=100, kcal=250, protein=7, carbs=14, fat=18),
    row('0000000000208', 'Cheddar Cheese', 'Great Value', stores=['walmart'], popularity=200, kcal=400, protein=25, carbs=1.5, fat=33),
]

run(f'create database {database}', 'postgres')
try:
    run("""
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create schema private; revoke all on schema private from public; grant usage on schema private to service_role;
      grant usage on schema public to anon, authenticated, service_role;
      -- As on Supabase: the extensions schema exists and every API role may use it.
      create schema extensions; grant usage on schema extensions to anon, authenticated, service_role;
    """)
    run(migration_de)
    # A German row that is already live in products_de before the new migration.
    run("insert into public.products_de(code,name,brand,brands,stores,kcal,protein,carbs,fat,popularity,build_id) "
        "values('4000000000099','Magerquark','Milsani','{Milsani}','{aldi}',67,12,4,0.2,7,'live-de')")
    run(migration_markets)
    check('both migrations apply on an empty Supabase-like database')
    assert run("select market || '|' || name || '|' || build_id from public.products where code = '4000000000099'") == 'de|Magerquark|live-de'
    check('German rows already in products_de are copied into public.products (market de)')

    assert run("select private.product_fold('K-Classic Müller-Milch ß ja! Fin Carré')") == 'k classic muller milch ss ja fin carre'
    assert run("select private.product_fold('Sainsbury''s M&S Trader Joe''s')") == 'sainsbury s m s trader joe s'
    check('folding: lower case, ä→a, ß→ss, punctuation → space')

    for role in ('anon', 'authenticated'):
        for table in ('products', 'product_store_brands', 'product_store_words'):
            run(f"set role {role}; select * from public.{table} limit 1", error='permission denied')
        run(f"set role {role}; select * from public.search_products('skyr', 'de')", error='permission denied')
    for table in ('products', 'product_store_brands', 'product_store_words'):
        assert run(f"select relrowsecurity from pg_class where oid = 'public.{table}'::regclass") == 't', table
    check('RLS on; anon/authenticated cannot read the tables or call the rpc')

    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for market, fixture in (('de', FIXTURE_DE), ('gb', FIXTURE_GB), ('us', FIXTURE_US)):
            path = os.path.join(tmp, f'products-{market}.ndjson.gz')
            with gzip.open(path, 'wt') as out:
                for r in fixture:
                    out.write(json.dumps(r, ensure_ascii=False) + '\n')
            paths[market] = path
            load(market, path, '--batch', '50', '--build-id', f'fixture-{market}')
        count = lambda market: run(f"select count(*) from public.products where market = '{market}'")
        assert count('de') == str(len(FIXTURE_DE) + 1) and count('gb') == str(len(FIXTURE_GB)) and count('us') == str(len(FIXTURE_US))
        load('gb', paths['gb'], '--batch', '50', '--build-id', 'fixture-gb', '--restart')
        assert count('gb') == str(len(FIXTURE_GB))
        check('loader upserts per market, and a re-run changes nothing')
        run("insert into public.products(market,code,name,kcal,protein,carbs,fat,build_id) values('gb','5999999999999','Stale product',1,0,0,0,'old')")
        load('gb', paths['gb'], '--batch', '50', '--build-id', 'fixture-gb', '--prune', '--restart')
        assert run("select count(*) from public.products where code = '5999999999999'") == '0'
        assert count('de') == str(len(FIXTURE_DE) + 1), 'pruning gb must not touch de'
        assert run("select count(*) from public.products where code = '4000000000001'") == '2', 'one barcode may exist in two markets'
        check('--prune removes only that market’s rows of older builds')
        mixed = os.path.join(tmp, 'mixed.ndjson.gz')
        with gzip.open(mixed, 'wt') as out:
            out.write(json.dumps(row('5000000000111', 'Wrong market', 'Tesco', market='gb')) + '\n')
        url = f'postgresql://{user}@/{database}?host={host}&port={port}'
        wrong = subprocess.run(['node', str(root / 'scripts/load-products.mjs'), '--market', 'us', '--file', mixed, '--db-url', url],
                               text=True, capture_output=True)
        assert wrong.returncode != 0 and 'refusing' in wrong.stderr, wrong.stderr
        check('a file built for another market is refused')

    assert run("select basis from public.products where market='de' and code='4000000000011'") == 'ml'
    assert run("select search from public.products where market='de' and code='4000000000004'") == 'ja rewe gouda jung'

    top = lambda q, market='de', **kw: [r[0] for r in search(q, market, **kw)]
    # --- Germany (unchanged ranking) ---
    assert top('milbona skyr')[0] == '4000000000001', search('milbona skyr')
    assert top('lidl skyr')[0] == '4000000000001', search('lidl skyr')
    assert '3000000000003' not in top('lidl skyr')[:1]
    assert top('ja gouda')[0] == '4000000000004', search('ja gouda')
    assert top('rewe gouda')[0] == '4000000000004', search('rewe gouda')
    assert top('edeka gouda')[0] == '4000000000005', search('edeka gouda')
    assert top('k-classic joghurt')[0] == '4000000000006', search('k-classic joghurt')
    assert top('rewe beste wahl')[0] == '4000000000013', search('rewe beste wahl')
    assert top('aldi süd quark')[0] == '4000000000099', search('aldi süd quark')
    assert top('migros joghurt')[0] == '9000000000015', search('migros joghurt')
    check('de: store own-brands (ja!, Gut & Günstig, K-Classic, REWE Beste Wahl, Milsani, M-Classic)')
    assert top('pinky donut')[0] == '4000000000008'
    assert set(top('donut')[:2]) == {'4000000000008', '4000000000009'}
    assert top('müller milchreis')[0] == '4000000000012'
    assert top('ehrmann high protein pudding')[0] == '4000000000014' or top('ehrmann high protein')[0] == '4000000000014'
    assert top('proteinriegel')[0] == '4000000000010', search('proteinriegel')
    assert top('skyr', brands=['Milbona'])[0] == '4000000000001'
    assert top('lidl')[:1] and all(r in ('4000000000001', '4000000000008', '4000000000010') for r in top('lidl')[:3])
    check('de: multi-word, brand and compound queries; hints boost; a bare store lists its products')
    # --- United Kingdom ---
    assert top('tesco sandwich', 'gb')[:2] == ['5000000000101', '5000000000102'], search('tesco sandwich', 'gb')
    assert top('tesco', 'gb')[:2] == ['5000000000101', '5000000000102'], search('tesco', 'gb')
    assert top('heinz beans', 'gb')[0] == '5000000000104', search('heinz beans', 'gb')
    assert top('lidl skyr', 'gb')[0] == '5000000000106', search('lidl skyr', 'gb')
    assert top('warburtons', 'gb')[0] == '5000000000107'
    assert top('yeo valley', 'gb')[0] == '5000000000108'
    assert top('m&s sandwich', 'gb')[0] == '5000000000109', search('m&s sandwich', 'gb')
    assert top('marks and spencer prawn', 'gb')[0] == '5000000000109', search('marks and spencer prawn', 'gb')
    assert top('sainsburys sandwich', 'gb')[0] == '5000000000103', search('sainsburys sandwich', 'gb')
    assert top('aldi yogurt', 'gb')[0] == '5000000000110', search('aldi yogurt', 'gb')
    check('gb: Tesco/Sainsbury’s/M&S/Aldi/Lidl own brands, multi-word chain names, brand queries')
    # --- United States ---
    assert top('kirkland protein bar', 'us', brands=['Kirkland Signature'])[0] == '0000000000201', search('kirkland protein bar', 'us')
    assert top('costco protein bar', 'us')[0] == '0000000000201', search('costco protein bar', 'us')
    assert top('quest bar', 'us')[0] == '0000000000202'
    assert top('chobani', 'us')[0] == '0000000000203'
    assert top('great value milk', 'us')[0] == '0000000000204'
    assert top('fairlife', 'us')[0] == '0000000000205'
    assert top('trader joes', 'us')[0] == '0000000000206', search('trader joes', 'us')
    assert top("trader joe's pretzels", 'us')[0] == '0000000000206'
    assert top('walmart cheese', 'us')[0] == '0000000000208', search('walmart cheese', 'us')
    check('us: Costco/Walmart/Trader Joe’s own brands and brand queries')
    # --- Isolation ---
    for q in ('skyr', 'milbona skyr', 'lidl skyr', 'sandwich', 'beans', 'protein bar', 'milk', 'yogurt'):
        for market in ('de', 'gb', 'us'):
            codes = top(q, market, lim=50)
            got = set(run(f"select market from public.products where market = '{market}' and code = any(array[{','.join(quote(c) for c in codes) or 'null'}]::text[])").split()) if codes else set()
            assert got <= {market}, (q, market, codes)
    assert '5000000000101' not in top('sandwich', 'de') and '4000000000008' not in top('donut', 'gb')
    assert top('tesco', 'de') == [] or all(c.startswith('4') or c.startswith('3') or c.startswith('9') for c in top('tesco', 'de'))
    assert top('rewe', 'gb') == [], 'Rewe is not a UK store'
    check('markets never mix: no Tesco in Germany, no Rewe in the UK')
    assert top('x', 'gb') == [] and top('', 'us') == [] and top('skyr', 'fr') == [] and top('skyr', None) == []
    assert len(search('skyr', 'de', lim=500)) <= 50
    check('one-letter queries and unknown markets return nothing; lim is clamped')
    # Barcode across markets: one indexed lookup on code.
    plan = run("explain select market from public.products where code = any(array['0000000000201','000000000201'])")
    assert 'products_code_idx' in plan or 'Seq Scan' in plan, plan
    assert run("select string_agg(market, ',' order by market) from public.products where code = '4000000000001'") == 'de,gb'
    check('a barcode is found in every market that sells it')

    if data_args:
        benchmark = {
            'de': ['milbona skyr', 'lidl skyr', 'ja gouda', 'proteinriegel', 'alpro', 'haferdrink'],
            'gb': ['tesco meal deal sandwich', 'lidl skyr', 'heinz beans', 'warburtons', 'yeo valley', 'tesco', 'm&s sandwich'],
            'us': ['kirkland protein bar', 'chobani', 'great value milk', 'quest bar', 'fairlife', 'trader joes'],
        }
        for market, path in data_args.items():
            started = time.time()
            load(market, path, '--batch', '2000', '--build-id', f'bench-{market}', '--restart', '--prune')
            print(market, 'rows', run(f"select count(*) from public.products where market = '{market}'"), f'loaded in {time.time() - started:.0f}s')
        print('table size', run("select pg_size_pretty(pg_total_relation_size('public.products'))"))
        for market in data_args:
            for q in benchmark[market]:
                search(q, market)  # warm
                started = time.perf_counter()
                for _ in range(5):
                    rows = search(q, market, lim=20)
                ms = (time.perf_counter() - started) / 5 * 1000
                inner = run(f"set role service_role; explain (analyze, timing off, summary on) select * from public.search_products({quote(q)}, '{market}', null, 20)")
                exec_ms = re.search(r'Execution Time: ([\d.]+)', inner).group(1)
                print(f'{market} {q!r}: {exec_ms} ms in db ({ms:.0f} ms via psql)')
                for r in rows[:3]:
                    print('   ', r[1] or '-', '|', r[2])
finally:
    if not keep:
        run(f'drop database if exists {database}', 'postgres')
    else:
        print('kept database', database)
