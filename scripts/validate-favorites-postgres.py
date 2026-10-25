#!/usr/bin/env python3
"""public.meal_favorites (20261025120000) on an isolated local PostgreSQL.

Usage: KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-<name> KANDRO_TEST_PG_PORT=<port> \
  python3 scripts/validate-favorites-postgres.py

Creates and drops its own database with the Supabase role/schema stubs the
migration needs and a synthetic auth.uid(). Never touches a linked project.
"""
import json, os, subprocess, uuid, pathlib

root = pathlib.Path(__file__).resolve().parents[1]
host = os.environ.get('KANDRO_TEST_PG_SOCKET', '')
assert '/kandro-pg-' in host, 'Dedicated local PG only (KANDRO_TEST_PG_SOCKET=/tmp/kandro-pg-…)'
port = os.environ.get('KANDRO_TEST_PG_PORT', '56341')
user = os.environ.get('KANDRO_TEST_PG_USER', 'postgres')
db = 'kandro_favorites_test_' + uuid.uuid4().hex[:10]
base = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', port, '-U', user]
migration = (root / 'supabase/migrations/20261025120000_meal_favorites.sql').read_text()
checks = []


def run(sql, database=None, error=None):
    result = subprocess.run(base + ['-d', database or db], input=sql, text=True, capture_output=True)
    if error:
        assert result.returncode and error in result.stderr, (error, result.stdout, result.stderr)
        return result.stderr
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def check(name):
    checks.append(name)
    print('PASS', name, flush=True)


def as_user(uid, sql):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{uid}',true); {sql}; commit;"


def items(*grams):
    return json.dumps([{'id': f'i{n}', 'name': f'Food {n}', 'amountG': g, 'calories': g, 'protein': 10, 'carbs': 5, 'fat': 2,
                        'fiber': 1, 'source': {'provider': 'bls', 'label': 'BLS'}} for n, g in enumerate(grams)])


def row(uid, fid=None, title='Bowl', grams=(100, 50), calories=None, protein=None, payload=None):
    fid = fid or str(uuid.uuid4())
    body = payload if payload is not None else items(*grams)
    kcal = sum(grams) if calories is None else calories
    prot = 10 * len(grams) if protein is None else protein
    return (f"insert into public.meal_favorites(user_id,id,title,meal_type,confidence,items,calories,protein,carbs,fat,fiber) "
            f"values('{uid}','{fid}','{title}','Dinner','high','{body}'::jsonb,{kcal},{prot},10,4,2)")


run(f'create database {db}', 'postgres')
try:
    run("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$;")
    run("create schema auth; create schema private; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;")
    run(migration)
    check('migration applies in one transaction')
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    run(f"insert into auth.users values('{a}'),('{b}')")

    fid = str(uuid.uuid4())
    run(as_user(a, row(a, fid)))
    assert run(as_user(a, 'select count(*) from public.meal_favorites')).splitlines()[-1] == '1'
    check('owner inserts and reads a favourite with items as logged')

    run(as_user(b, row(a)), error='row-level security')
    assert run(as_user(b, 'select count(*) from public.meal_favorites')).splitlines()[-1] == '0'
    run(as_user(b, f"update public.meal_favorites set title='x' where id='{fid}'"))
    run(as_user(b, f"delete from public.meal_favorites where id='{fid}'"))
    assert run(f"select title from public.meal_favorites where id='{fid}'") == 'Bowl'
    check('another user can neither insert for, read, update nor delete the owner\'s favourites')

    run(f"begin; set local role anon; select count(*) from public.meal_favorites; commit;", error='permission denied')
    check('anon has no access')

    for payload, label in [
        ('[]', 'empty items'),
        ('{"a":1}', 'items not an array'),
        (json.dumps([{'name': 'x', 'calories': 1, 'protein': 0, 'carbs': 0, 'fat': 0, 'source': {'provider': 'bls'}}]), 'missing grams'),
        (json.dumps([{'name': 'x', 'amountG': 9000, 'calories': 1, 'protein': 0, 'carbs': 0, 'fat': 0, 'source': {'provider': 'bls'}}]), 'grams out of range'),
        (json.dumps([{'name': 'x', 'amountG': 'lots', 'calories': 1, 'protein': 0, 'carbs': 0, 'fat': 0, 'source': {'provider': 'bls'}}]), 'grams not a number'),
        (json.dumps([{'name': 'x', 'amountG': 10, 'calories': 1, 'protein': 0, 'carbs': 0, 'fat': 0, 'source': {'provider': 'bls', 'code': 'unmatched'}}]), 'unresolved row'),
        (json.dumps([{'name': '', 'amountG': 10, 'calories': 1, 'protein': 0, 'carbs': 0, 'fat': 0, 'source': {'provider': 'bls'}}]), 'empty name'),
    ]:
        run(as_user(a, row(a, payload=payload, calories=1, protein=0)), error='violat' if label == 'empty items' else 'meal_favorite_item')
    check('damaged or unresolved items are rejected')

    run(as_user(a, row(a, grams=(100, 50), calories=900)), error='meal_favorite_totals_mismatch')
    check('totals must be the sum of the items')

    for n in range(99):
        run(as_user(a, row(a, title=f'Meal {n}')))
    run(as_user(a, row(a, title='One too many')), error='meal_favorite_limit_reached')
    run(as_user(a, f"update public.meal_favorites set title='Renamed' where id='{fid}'"))
    assert run(f"select title from public.meal_favorites where id='{fid}'") == 'Renamed'
    run(as_user(b, row(b)))
    check('at most 100 per account; updates stay possible at the limit; other accounts unaffected')

    run(f"delete from auth.users where id='{a}'")
    assert run(f"select count(*) from public.meal_favorites where user_id='{a}'") == '0'
    assert run(f"select count(*) from public.meal_favorites where user_id='{b}'") == '1'
    check('account deletion cascades')
    print(json.dumps({'passed': len(checks), 'scope': 'isolated PostgreSQL, synthetic auth.uid; not PostgREST or a live project'}, indent=2))
finally:
    run(f'drop database {db} with (force)', 'postgres')
