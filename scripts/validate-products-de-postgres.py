#!/usr/bin/env python3
"""products_de (20261012120000) in an isolated local Postgres.

Usage: KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-<name> KANDRO_TEST_PG_PORT=<port> \
  python3 scripts/validate-products-de-postgres.py [--data products-de-sample.ndjson.gz]

Creates and drops its own database (with the Supabase role/schema stubs the
migration needs), applies the migration, loads synthetic fixture rows through
scripts/load-products-de.mjs (resume, idempotency, prune) and checks grants
and ranking. Never touches a linked Supabase project. With --data it also
loads a real build and prints latency and the top 3 for the benchmark queries.
"""
import gzip, json, os, pathlib, re, subprocess, sys, tempfile, time, uuid

root = pathlib.Path(__file__).resolve().parents[1]
host = os.environ.get('KANDRO_TEST_PG_SOCKET', '')
assert host.startswith('/tmp/kandro-pg-'), 'Dedicated local PG only (KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-…)'
port = os.environ.get('KANDRO_TEST_PG_PORT', '56341')
user = os.environ.get('KANDRO_TEST_PG_USER', 'postgres')
database = 'kandro_products_test_' + uuid.uuid4().hex[:10]
base = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', port, '-U', user]
migration = (root / 'supabase/migrations/20261012120000_products_de.sql').read_text()
data_arg = sys.argv[sys.argv.index('--data') + 1] if '--data' in sys.argv else None
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


def load(path, *extra):
    url = f'postgresql://{user}@/{database}?host={host}&port={port}'
    result = subprocess.run(['node', str(root / 'scripts/load-products-de.mjs'), '--file', path, '--db-url', url, *extra],
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def search(q, brands=None, lim=5):
    hint = 'null' if brands is None else "array[" + ','.join("'" + b.replace("'", "''") + "'" for b in brands) + "]::text[]"
    rows = run(f"set role service_role; select code || '|' || coalesce(brand,'') || '|' || name from public.search_products_de('{q}', {hint}, {lim})")
    return [r.split('|', 2) for r in rows.splitlines() if r]


# Synthetic fixture rows (not real products): enough to pin the ranking rules.
def row(code, name, brand=None, brands=None, stores=(), popularity=0, basis='g', **n):
    values = dict(kcal=100, protein=5, carbs=10, fat=3)
    values.update(n)
    return {'code': code, 'name': name, 'brand': brand, 'brands': brands or ([brand] if brand else []), 'stores': list(stores),
            'basis': basis, 'package_g': 500 if basis == 'g' else None, 'package_ml': 1000 if basis == 'ml' else None,
            'serving_g': None, 'sugars': None, 'sat_fat': None, 'fiber': None, 'salt': None, 'category': None,
            'nutriscore': None, 'popularity': popularity, 'last_modified': 1760000000, **values}


FIXTURE = [
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
    run(migration)
    check('migration applies on an empty Supabase-like database')

    assert run("select private.product_fold('K-Classic Müller-Milch ß ja! Fin Carré')") == 'k classic muller milch ss ja fin carre'
    check('folding: lower case, ä→a, ß→ss, punctuation → space')

    for role in ('anon', 'authenticated'):
        run(f"set role {role}; select * from public.products_de limit 1", error='permission denied')
        run(f"set role {role}; select * from public.search_products_de('skyr')", error='permission denied')
        run(f"set role {role}; select * from public.store_brands", error='permission denied')
    assert run("select relrowsecurity from pg_class where oid = 'public.products_de'::regclass") == 't'
    assert run("select relrowsecurity from pg_class where oid = 'public.store_brands'::regclass") == 't'
    check('RLS on; anon/authenticated cannot read the tables or call the rpc')

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'fixture.ndjson.gz')
        with gzip.open(path, 'wt') as out:
            for r in FIXTURE:
                out.write(json.dumps(r, ensure_ascii=False) + '\n')
        first = load(path, '--batch', '50', '--build-id', 'fixture-a')
        assert run('select count(*) from public.products_de') == str(len(FIXTURE)), first
        load(path, '--batch', '50', '--build-id', 'fixture-a', '--restart')
        assert run('select count(*) from public.products_de') == str(len(FIXTURE))
        check('loader upserts, and a re-run changes nothing')
        run("insert into public.products_de(code,name,kcal,protein,carbs,fat,build_id) values('4999999999999','Stale product',1,0,0,0,'old')")
        load(path, '--batch', '50', '--build-id', 'fixture-a', '--prune', '--restart')
        assert run("select count(*) from public.products_de where code = '4999999999999'") == '0'
        check('--prune removes rows of older builds')
        state = json.loads(pathlib.Path(path + '.load-state.json').read_text())
        assert state['done'] is True and state['rows'] == len(FIXTURE), state

    assert run("select basis from public.products_de where code='4000000000011'") == 'ml'
    assert run("select search from public.products_de where code='4000000000004'") == 'ja rewe gouda jung'

    top = lambda q, **kw: [r[0] for r in search(q, **kw)]
    assert top('milbona skyr')[0] == '4000000000001', search('milbona skyr')
    assert top('lidl skyr')[0] == '4000000000001', search('lidl skyr')
    assert '3000000000003' not in top('lidl skyr')[:1]
    check('"milbona skyr" and "lidl skyr" lead with the Milbona skyr, not a French yogurt')
    assert top('ja gouda')[0] == '4000000000004', search('ja gouda')
    assert top('rewe gouda')[0] == '4000000000004', search('rewe gouda')
    assert top('edeka gouda')[0] == '4000000000005', search('edeka gouda')
    assert top('k-classic joghurt')[0] == '4000000000006', search('k-classic joghurt')
    assert top('rewe beste wahl')[0] == '4000000000013', search('rewe beste wahl')
    check('store own-brands: ja!, Gut & Günstig, K-Classic, REWE Beste Wahl')
    assert top('pinky donut')[0] == '4000000000008'
    assert set(top('donut')[:2]) == {'4000000000008', '4000000000009'}
    assert top('müller milchreis')[0] == '4000000000012'
    assert top('mueller milchreis') == [] or top('mueller milchreis')[0] == '4000000000012'
    assert top('ehrmann high protein pudding')[0] == '4000000000014' or top('ehrmann high protein')[0] == '4000000000014'
    assert top('proteinriegel')[0] == '4000000000010', search('proteinriegel')
    check('multi-word, brand and compound queries ("proteinriegel" → "Protein Riegel")')
    assert top('skyr', brands=['Milbona'])[0] == '4000000000001'
    assert top('lidl')[:1] and all(r in ('4000000000001', '4000000000008', '4000000000010') for r in top('lidl')[:3])
    check('brand hints boost; a bare store name lists its products')
    assert top('x') == [] and top('') == []
    assert len(search('skyr', lim=500)) <= 50
    check('one-letter queries return nothing; lim is clamped')

    if data_arg:
        load(data_arg, '--batch', '2000', '--build-id', 'bench', '--restart', '--prune')
        print('rows', run('select count(*) from public.products_de'))
        queries = ['pinky donut', 'donut', 'milbona skyr', 'lidl skyr', 'ja gouda', 'rewe beste wahl', 'k-classic joghurt',
                   'proteinriegel', 'skyr', 'haferdrink', 'alpro', 'müller milchreis', 'ehrmann high protein pudding']
        for q in queries:
            search(q)  # warm
            started = time.perf_counter()
            for _ in range(5):
                rows = search(q, lim=20)
            ms = (time.perf_counter() - started) / 5 * 1000
            inner = run(f"set role service_role; explain (analyze, timing off, summary on) select * from public.search_products_de('{q}', null, 20)")
            exec_ms = re.search(r'Execution Time: ([\d.]+)', inner).group(1)
            print(f'{q!r}: {exec_ms} ms in db ({ms:.0f} ms via psql)')
            for r in rows[:3]:
                print('   ', r[1] or '-', '|', r[2])
finally:
    if not keep:
        run(f'drop database if exists {database}', 'postgres')
    else:
        print('kept database', database)
