/**
 * German product index (public.products_de): migration shape, grants, the rpc
 * contract, and the edge function's index-first / live-Open-Food-Facts
 * fallback, executed against a mocked rpc. The ranking itself runs in
 * scripts/validate-products-de-postgres.py (local Postgres); set
 * KANDRO_TEST_PG_SOCKET to run it from here as well.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { offBarcodeCandidates } from '../supabase/functions/_shared/off-product.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

// --- Migration ---------------------------------------------------------------
const migrations = readdirSync(join(root, 'supabase/migrations')).sort();
const name = '20261012120000_products_de.sql';
assert.ok(migrations.includes(name), 'products_de migration missing');
assert.ok(migrations.indexOf(name) > migrations.indexOf('20261010130000_custom_foods_and_off_cache.sql'), 'migration must sort after the OFF cache');
const sql = read(`supabase/migrations/${name}`);
assert.match(sql, /create extension if not exists pg_trgm with schema extensions;/);
assert.match(sql, /extnamespace <> 'extensions'::regnamespace[\s\S]*raise exception/, 'pg_trgm outside extensions must fail loudly');
assert.match(sql, /create table public\.products_de \(\s*code text primary key check \(code ~ '\^\[0-9\]\{7,14\}\$'\)/);
for (const column of ['name text not null', 'brand text', 'brands text[]', 'stores text[]', 'package_g numeric', 'package_ml numeric',
  'serving_g numeric', 'kcal numeric', 'protein numeric', 'carbs numeric', 'sugars numeric', 'fat numeric', 'sat_fat numeric',
  'fiber numeric', 'salt numeric', 'category text', 'popularity integer', 'updated_at timestamptz']) {
  assert.ok(sql.includes(column), `products_de.${column}`);
}
assert.match(sql, /basis text not null default 'g' check \(basis in \('g', 'ml'\)\)/, 'per-100 ml rows must be marked, never stored as grams');
assert.match(sql, /search text generated always as \(private\.product_search_text\(brands, name\)\) stored/);
assert.match(sql, /using gin \(search extensions\.gin_trgm_ops\)/, 'trigram index on the folded search column');
assert.match(sql, /on public\.products_de \(brand_fold\)/, 'btree on the brand');
assert.match(sql, /'äöüàáâãåāèéêëēìíîïòóôõøōùúûūýÿñçč',\s*'aouaaaaaaeeeeeiiiiooooooouuuuyyncc'/, 'ä→a, ö→o, ü→u folding');
assert.match(sql, /replace\(pg_catalog\.lower\(value\), 'ß', 'ss'\)/, 'ß→ss folding');
for (const table of ['products_de', 'store_brands']) {
  assert.ok(sql.includes(`alter table public.${table} enable row level security;`), `${table}: RLS`);
  assert.ok(sql.includes(`revoke all on table public.${table} from public, anon, authenticated;`), `${table}: client grants revoked`);
}
assert.doesNotMatch(sql, /grant [^;]* to [^;]*\b(anon|authenticated)\b/i, 'no client role may reach the index directly');
assert.match(sql, /create function public\.search_products_de\(q text, brands text\[\] default null, lim integer default 25\)/);
assert.match(sql, /language plpgsql stable security invoker set search_path = ''/);
assert.match(sql, /revoke all on function public\.search_products_de\(text, text\[\], integer\) from public, anon, authenticated;/);
assert.match(sql, /grant execute on function public\.search_products_de\(text, text\[\], integer\) to service_role;/);
assert.match(sql, /least\(greatest\(coalesce\(lim, 25\), 1\), 50\)/, 'lim is clamped');
assert.match(sql, /format\(' and p\.search like %L'/, 'query words are bound through format(%L), never concatenated raw');
for (const [store, brand] of [['lidl', 'Milbona'], ['lidl', 'Pilos'], ['lidl', 'Crownfield'], ['aldi', 'Milsani'], ['aldi', 'Moser Roth'],
  ['rewe', 'ja!'], ['rewe', 'REWE Beste Wahl'], ['edeka', 'Gut & Günstig'], ['kaufland', 'K-Classic'], ['penny', 'Naturgut'], ['dm', 'dmBio']]) {
  assert.ok(sql.includes(`('${store}', '${brand}')`), `store brand ${store} → ${brand}`);
}

// --- Build and load scripts --------------------------------------------------
const build = read('scripts/build-products-de.py');
assert.match(build, /abs\(n\['kcal'\] - simple\) > tolerance and abs\(n\['kcal'\] - eu\) > tolerance/, 'Atwater plausibility check');
assert.match(build, /tolerance = 0\.15 \* n\['kcal'\] \+ 10/);
assert.match(build, /Refusing to write the ODbL extract into the repository/);
assert.match(build, /def mass_basis[\s\S]*return 'ml'/, 'volume products are marked ml');
const loader = read('scripts/load-products-de.mjs');
assert.match(loader, /--linked writes to the linked Supabase project; add --confirm-linked/);
assert.match(loader, /on conflict \(code\) do update set/);

// The loader's dry run must produce one bounded statement per batch.
const tmp = mkdtempSync(join(tmpdir(), 'kandro-products-validate-'));
try {
  const fixture = join(tmp, 'fixture.ndjson.gz');
  const rows = Array.from({ length: 120 }, (_, i) => ({ code: String(4000000000000 + i), name: `Synthetic fixture ${i} 'quoted' $$`, brand: 'Fixture',
    brands: ['Fixture'], stores: [], basis: 'g', kcal: 100, protein: 5, carbs: 10, fat: 3, popularity: i, last_modified: 1760000000 }));
  writeFileSync(fixture, gzipSync(rows.map((row) => JSON.stringify(row)).join('\n')));
  const dry = spawnSync('node', [join(root, 'scripts/load-products-de.mjs'), '--file', fixture, '--dry-run', '--batch', '50'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run: 3 batches of ≤50/);
  const linked = spawnSync('node', [join(root, 'scripts/load-products-de.mjs'), '--file', fixture, '--linked'], { encoding: 'utf8' });
  assert.notEqual(linked.status, 0, 'a linked load without --confirm-linked must refuse');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// --- Edge function: index first, live Open Food Facts as fallback ------------
const path = 'supabase/functions/nutrition/index.ts';
const gateway = read(path);
const ast = ts.createSourceFile(path, gateway, ts.ScriptTarget.Latest, true);
function loadFunction(fnName, dependencies) {
  const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === fnName);
  assert.ok(node, fnName);
  const compiled = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn ${fnName};`)(...Object.values(dependencies));
}
const constant = (constName) => Number(gateway.match(new RegExp(`const ${constName} = (\\d+);`))[1]);
const LIMITS = {
  PRODUCT_INDEX_LIMIT: constant('PRODUCT_INDEX_LIMIT'), PRODUCT_INDEX_MIN_HITS: constant('PRODUCT_INDEX_MIN_HITS'),
  PRODUCT_INDEX_AFTER_CATALOGUE: constant('PRODUCT_INDEX_AFTER_CATALOGUE'), PRODUCT_INDEX_AFTER_CATALOGUE_POSITION: constant('PRODUCT_INDEX_AFTER_CATALOGUE_POSITION'),
};
assert.equal(LIMITS.PRODUCT_INDEX_MIN_HITS, 3, 'fewer than three index hits asks live Open Food Facts');

const optionalAmount = loadFunction('optionalAmount', {});
const productIndexHit = loadFunction('productIndexHit', { optionalAmount });
const productIndexResult = loadFunction('productIndexResult', {});
const offSearchHit = loadFunction('offSearchHit', { optionalAmount });
const publicProductHit = loadFunction('publicProductHit', {});
const searchProductIndex = loadFunction('searchProductIndex', { productIndexHit, AbortSignal });
const readProductIndex = loadFunction('readProductIndex', { productIndexHit, productIndexResult, offBarcodeCandidates, AbortSignal });

const dbRow = (code, extra = {}) => ({ code, name: `Skyr ${code}`, brand: 'Milbona', stores: ['lidl'], basis: 'g', package_g: 500,
  package_ml: null, serving_g: 150, kcal: 63, protein: 11, carbs: 4, fat: 0.2, fiber: null, ...extra });
const rpcAdmin = (answer, calls = []) => ({
  rpc(fn, args) {
    calls.push([fn, args]);
    const promise = typeof answer === 'function' ? answer() : Promise.resolve(answer);
    return { abortSignal: () => promise };
  },
});

class ProviderQuotaError extends Error {}
class ModelError extends Error {}
let offCalls = 0;
let offClaims = 0;
let blsRows = [];
const searchFoods = loadFunction('searchFoods', {
  normalizeSearchTerm: (q) => String(q).trim().toLowerCase(), isSearchQuery: (q) => q.length >= 2,
  ProviderQuotaError, ModelError,
  searchBlsCatalog: () => blsRows, getBlsReferenceByCode: () => null,
  searchOpenFoodFacts: async (term, language, claimOff) => {
    offCalls += 1;
    await claimOff?.();
    return [{ id: 'off-4000000000001', name: 'Skyr (Milbona)', per100g: { calories: 63, protein: 11, carbs: 4, fat: 0.2 }, defaultGrams: 100,
      portions: [], brand: 'Milbona', source: { provider: 'open-food-facts', referenceId: '4000000000001', label: 'Open Food Facts 4000000000001' } },
    { id: 'off-4000000000099', name: 'Live only', per100g: { calories: 80, protein: 9, carbs: 8, fat: 0.4 }, defaultGrams: 100,
      portions: [], source: { provider: 'open-food-facts', referenceId: '4000000000099', label: 'Open Food Facts 4000000000099' } }];
  },
  searchUsdaFoods: async () => [], toFoodFacts: () => null, compatibleSearchIdentity: () => true, usdaPortions: () => [],
  searchProductIndex, productIndexResult, offSearchHit, publicProductHit, ...LIMITS,
});
const claim = async (route) => { assert.equal(route, 'off_search'); offClaims += 1; };
const run = async (admin, options = {}) => {
  offCalls = 0; offClaims = 0;
  return searchFoods(options.q ?? 'milbona skyr', options.language ?? 'de', claim, false, admin, options.brands ?? [], options.products ?? false);
};

// Enough index hits: no live call, no provider quota spent.
let calls = [];
let result = await run(rpcAdmin({ data: [dbRow('4000000000001'), dbRow('4000000000002'), dbRow('4000000000003')], error: null }, calls), { brands: ['Milbona'] });
assert.equal(offCalls, 0, 'three index hits must not ask Open Food Facts');
assert.equal(offClaims, 0, 'index hits must not consume the Open Food Facts quota');
assert.deepEqual(calls[0], ['search_products_de', { q: 'milbona skyr', brands: ['Milbona'], lim: 20 }]);
assert.equal(result.body.results.length, 3);
assert.deepEqual(result.body.results[0].source, { provider: 'open-food-facts', referenceId: '4000000000001', label: 'Open Food Facts 4000000000001' });
assert.equal(result.body.results[0].name, 'Skyr 4000000000001 (Milbona)');
assert.deepEqual(result.body.results[0].portions, [{ label: '150 g', grams: 150 }]);
assert.deepEqual(result.body.products[0], { code: '4000000000001', name: 'Skyr 4000000000001', brand: 'Milbona', stores: ['lidl'], packageG: 500,
  servingG: 150, per100g: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, source: 'productdb' });
assert.equal(result.body.searchStatus, 'complete');

// Too few, empty, failing or missing index: live Open Food Facts, merged without duplicates.
for (const admin of [rpcAdmin({ data: [dbRow('4000000000001')], error: null }), rpcAdmin({ data: [], error: null }),
  rpcAdmin({ data: null, error: { message: 'relation "products_de" does not exist' } }), rpcAdmin(() => Promise.reject(new Error('timeout'))), undefined]) {
  result = await run(admin);
  assert.equal(offCalls, 1, 'the index could not answer: live Open Food Facts must be asked');
  assert.equal(offClaims, 1, 'the live fallback claims its provider unit');
  const ids = result.body.results.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, 'index and live rows must not duplicate a code');
  assert.ok(ids.includes('off-4000000000099'));
  assert.ok(result.body.products.some((hit) => hit.source === 'off' && hit.code === '4000000000099'));
}

// The same pack under several codes is listed once.
result = await run(rpcAdmin({ data: [dbRow('4000000000001', { name: 'Skyr' }), dbRow('4000000000002', { name: 'skyr' }), dbRow('4000000000003', { name: 'Skyr', protein: 12 })], error: null }));
assert.deepEqual(result.body.products.filter((hit) => hit.source === 'productdb').map((hit) => hit.code), ['4000000000001', '4000000000003']);

// A per-100 ml row is never offered as grams.
result = await run(rpcAdmin({ data: [dbRow('4000000000011', { basis: 'ml', package_g: null, package_ml: 1000, serving_g: null })], error: null }), { q: 'haferdrink' });
assert.ok(!result.body.results.some((row) => row.id === 'off-4000000000011'));
assert.ok(!result.body.products.some((hit) => hit.code === '4000000000011'));
// Broken values never pass.
assert.equal(productIndexHit(dbRow('4000000000001', { kcal: null })), null);
assert.equal(productIndexHit(dbRow('4000000000001', { kcal: 0, protein: 20 })), null);
assert.equal(productIndexHit(dbRow('12345', {})), null);
assert.equal(publicProductHit(productIndexHit(dbRow('4000000000001', { package_g: 25000 }))).packageG, undefined, 'packageG stays within 1–5000');

// scope=products: the index answers even when the reference catalogue would.
const strongBls = [{ code: 'M000000', strong: true, nameDe: 'Skyr', nameEn: 'Skyr', per100g: { calories: 63, protein: 11, carbs: 4, fat: 0.2 } }];
blsRows = strongBls;
result = await run(rpcAdmin({ data: [dbRow('4000000000001'), dbRow('4000000000002'), dbRow('4000000000003')], error: null }), { q: 'skyr', products: true });
assert.ok(result.body.results.every((row) => row.source.provider === 'open-food-facts'), 'scope=products returns products only');
assert.equal(result.body.products.length, 3);
assert.equal(offCalls, 0);
// Default scope with a real catalogue match: index rows after the leading
// reference rows, never a provider call.
result = await run(rpcAdmin({ data: [dbRow('4000000000001')], error: null }), { q: 'skyr' });
assert.equal(offCalls, 0, 'a real catalogue match must finish without a provider round trip');
assert.equal(result.body.results[0].source.provider, 'bls');
assert.ok(result.body.results.some((row) => row.id === 'off-4000000000001'));
blsRows = [];

// Barcode: index row first, then the existing Open Food Facts path.
const fromAdmin = (answer, seen = []) => ({ from: (table) => {
  seen.push(table);
  const chain = { select: () => chain, in: (column, codes) => { seen.push(codes); return chain; }, limit: () => chain, abortSignal: () => Promise.resolve(answer) };
  return chain;
} });
let seen = [];
const barcode = await readProductIndex(fromAdmin({ data: [dbRow('0040000000001')], error: null }, seen), '040000000001');
assert.deepEqual(seen, ['products_de', ['040000000001', '0040000000001']], 'UPC/EAN spellings are looked up together');
assert.equal(barcode.status, 200);
assert.deepEqual(barcode.body.per100g, { calories: 63, protein: 11, carbs: 4, fat: 0.2 });
assert.equal(barcode.body.source.provider, 'open-food-facts');
assert.equal(await readProductIndex(fromAdmin({ data: [dbRow('4000000000011', { basis: 'ml' })], error: null }), '4000000000011'), null);
assert.equal(await readProductIndex(fromAdmin({ data: [], error: null }), '4000000000011'), null);
assert.equal(await readProductIndex(fromAdmin({ data: null, error: { message: 'missing' } }), '4000000000011'), null);
assert.equal(await readProductIndex(undefined, '4000000000011'), null);
const lookup = gateway.slice(gateway.indexOf('async function lookupBarcode'), gateway.indexOf('/** An Open Food Facts serving size'));
assert.ok(lookup.indexOf('readProductIndex(admin, barcode)') < lookup.indexOf('readOffCache(admin, barcode)'), 'the index answers before the OFF cache');

// Route: brands hint and scope reach the search and its cache key.
assert.match(gateway, /captureFingerprint\(\[SEARCH_VERSION, data\.user\.id, params\.get\('q'\), params\.get\('language'\), params\.get\('scope'\), brands\]\)/);
assert.match(gateway, /value\.length <= 40\)\)\]\.slice\(0, 30\)/, 'at most 30 brand hints of ≤40 characters');
assert.match(gateway, /params\.get\('scope'\) === 'products',/);

// --- ODbL --------------------------------------------------------------------
const notices = read('THIRD_PARTY_NOTICES.md');
assert.match(notices, /products_de/);
assert.match(notices, /scripts\/build-products-de\.py/);

if (process.env.KANDRO_TEST_PG_SOCKET) {
  const pg = spawnSync('python3', [join(root, 'scripts/validate-products-de-postgres.py')], { encoding: 'utf8', stdio: 'inherit' });
  assert.equal(pg.status, 0, 'local Postgres ranking check failed');
}
assert.ok(existsSync(join(root, 'scripts/validate-products-de-postgres.py')));
console.log('Product index: migration, grants, rpc contract, loader, and index-first search/barcode with live Open Food Facts fallback verified.');
