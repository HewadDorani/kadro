/**
 * Regional product index (public.products: de = DE/AT/CH, gb, us; the older
 * public.products_de stays until no deployed function reads it): migration
 * shape, grants, the rpc contract, per-market store brands, build and loader,
 * and the edge function's region-aware index-first / live-Open-Food-Facts
 * fallback, executed against a mocked rpc. The ranking itself runs in
 * scripts/validate-products-postgres.py (local Postgres); set
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

// --- Regional migration ---------------------------------------------------------
const marketsName = '20261025120000_products_markets.sql';
assert.ok(migrations.includes(marketsName), 'products_markets migration missing');
assert.ok(migrations.indexOf(marketsName) > migrations.indexOf(name), 'the regional index sorts after products_de');
const markets = read(`supabase/migrations/${marketsName}`);
assert.match(markets, /create table public\.products \(\s*market text not null check \(market in \('de', 'gb', 'us'\)\)/);
assert.match(markets, /primary key \(market, code\)/);
assert.match(markets, /basis text not null default 'g' check \(basis in \('g', 'ml'\)\)/, 'per-100 ml rows are marked in every market');
assert.match(markets, /insert into public\.products \([^)]*\)\s*select 'de', [\s\S]*?from public\.products_de;/, 'German rows already loaded are copied');
for (const market of ['de', 'gb', 'us']) {
  assert.match(markets, new RegExp(`create index products_search_${market}_trgm_idx on public\\.products using gin \\(search extensions\\.gin_trgm_ops\\) where market = '${market}';`), `${market}: own trigram index`);
}
assert.match(markets, /create index products_code_idx on public\.products \(code\);/, 'barcode lookup across markets is indexed');
for (const table of ['products', 'product_store_brands', 'product_store_words']) {
  assert.ok(markets.includes(`alter table public.${table} enable row level security;`), `${table}: RLS`);
  assert.ok(markets.includes(`revoke all on table public.${table} from public, anon, authenticated;`), `${table}: client grants revoked`);
}
assert.doesNotMatch(markets, /grant [^;]* to [^;]*\b(anon|authenticated)\b/i, 'no client role may reach the regional index');
assert.doesNotMatch(markets, /drop table/i, 'products_de stays until no deployed function reads it');
assert.match(markets, /create function public\.search_products\(q text, market text, brands text\[\] default null, lim integer default 25\)/);
assert.match(markets, /language plpgsql stable security invoker set search_path = ''/);
assert.match(markets, /if mk is null or mk not in \('de', 'gb', 'us'\) then return; end if;/, 'unknown markets return nothing');
assert.match(markets, /revoke all on function public\.search_products\(text, text, text\[\], integer\) from public, anon, authenticated;/);
assert.match(markets, /grant execute on function public\.search_products\(text, text, text\[\], integer\) to service_role;/);
assert.match(markets, /filters := format\(' and p\.market = %L', mk\);/, 'every candidate query names its market literally (partial index)');
assert.match(markets, /format\(' and p\.search like %L'/, 'query words are bound through format(%L), never concatenated raw');
assert.match(markets, /select 'de', store, brand from public\.store_brands;/, 'German store brands carry over');
// Owner list (2026-10-25): own brands per UK/US chain. Only confident mappings.
const OWN_BRANDS = {
  gb: { tesco: ['Tesco', 'Tesco Finest', 'Stockwell & Co', 'Hearty Food Co'], sainsburys: ["Sainsbury''s", 'Taste the Difference', "by Sainsbury''s"],
    asda: ['Asda', 'Extra Special', 'Just Essentials'], morrisons: ['Morrisons', 'The Best', 'Savers'], ms: ['M&S', 'Marks & Spencer'],
    waitrose: ['Waitrose', 'Essential Waitrose', 'No.1'], coop: ['Co-op', 'Irresistible'],
    aldi: ['Specially Selected', 'Everyday Essentials', 'Cowbelle', 'Brooklea', 'Harvest Morn'], lidl: ['Milbona', 'Deluxe', 'Pilos', 'Crownfield'], iceland: ['Iceland'] },
  us: { walmart: ['Great Value', 'Marketside', "Sam''s Choice"], costco: ['Kirkland Signature'], traderjoes: ["Trader Joe''s"],
    wholefoods: ['365 by Whole Foods Market'], target: ['Good & Gather', 'Favorite Day'], kroger: ['Kroger', 'Simple Truth', 'Private Selection'],
    aldi: ['Friendly Farms', 'Simply Nature', 'Millville', "Clancy''s"], safeway: ['Signature Select', 'O Organics'], albertsons: ['Signature Select', 'O Organics'] },
};
for (const [market, stores] of Object.entries(OWN_BRANDS)) {
  for (const [store, brands] of Object.entries(stores)) {
    for (const brand of brands) assert.ok(markets.includes(`('${market}', '${store}', '${brand}')`), `${market}: ${store} → ${brand}`);
  }
}
for (const [market, phrase, store] of [['gb', 'tesco', 'tesco'], ['gb', 'm s', 'ms'], ['gb', 'marks and spencer', 'ms'], ['gb', 'sainsburys', 'sainsburys'],
  ['gb', 'co op', 'coop'], ['us', 'trader joes', 'traderjoes'], ['us', 'whole foods', 'wholefoods'], ['us', 'walmart', 'walmart'], ['de', 'aldi sud', 'aldi']]) {
  assert.ok(markets.includes(`('${market}', '${phrase}', '${store}')`), `${market}: "${phrase}" names ${store}`);
}
for (const brand of ['Rewe', 'Milsani', 'ja!', 'Edeka']) assert.ok(!markets.includes(`('gb', `) || !new RegExp(`\\('gb', '[a-z]+', '${brand}'\\)`).test(markets), `no German chain brand ${brand} in the UK`);

// --- Build and load scripts --------------------------------------------------
const build = read('scripts/build-products.py');
assert.match(build, /abs\(n\['kcal'\] - simple\) > tolerance and abs\(n\['kcal'\] - eu\) > tolerance/, 'Atwater plausibility check');
assert.match(build, /tolerance = 0\.15 \* n\['kcal'\] \+ 10/);
assert.match(build, /Refusing to write the ODbL extract into the repository/);
assert.match(build, /def mass_basis[\s\S]*return 'ml'/, 'volume products are marked ml');
assert.match(build, /'de': \{'countries': \['en:germany', 'en:austria', 'en:switzerland'\]/, "region 'de' covers DE/AT/CH");
assert.match(build, /'gb': \{'countries': \['en:united-kingdom'\]/);
assert.match(build, /'us': \{'countries': \['en:united-states'\]/);
assert.match(build, /def unescape_html[\s\S]*html\.unescape/, 'HTML entities are decoded');
assert.match(build, /fl\\\.\?\\s\*oz/, 'US fluid ounces are a volume, never grams');
const loader = read('scripts/load-products.mjs');
assert.match(loader, /--linked writes to the linked Supabase project; add --confirm-linked/);
assert.match(loader, /on conflict \(market, code\) do update set/);
assert.match(loader, /delete from public\.products where market = '\$\{market\}' and build_id <> /, '--prune stays inside one market');

// The loader's dry run must produce one bounded statement per batch.
const tmp = mkdtempSync(join(tmpdir(), 'kandro-products-validate-'));
try {
  const fixture = join(tmp, 'fixture.ndjson.gz');
  const rows = Array.from({ length: 120 }, (_, i) => ({ code: String(4000000000000 + i), name: `Synthetic fixture ${i} 'quoted' $$`, brand: 'Fixture',
    brands: ['Fixture'], stores: [], basis: 'g', kcal: 100, protein: 5, carbs: 10, fat: 3, popularity: i, last_modified: 1760000000 }));
  writeFileSync(fixture, gzipSync(rows.map((row) => JSON.stringify(row)).join('\n')));
  const dry = spawnSync('node', [join(root, 'scripts/load-products.mjs'), '--market', 'de', '--file', fixture, '--dry-run', '--batch', '50'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry run: de: 3 batches of ≤50/);
  const linked = spawnSync('node', [join(root, 'scripts/load-products.mjs'), '--market', 'de', '--file', fixture, '--linked'], { encoding: 'utf8' });
  assert.notEqual(linked.status, 0, 'a linked load without --confirm-linked must refuse');
  const noMarket = spawnSync('node', [join(root, 'scripts/load-products.mjs'), '--file', fixture, '--dry-run'], { encoding: 'utf8' });
  assert.notEqual(noMarket.status, 0, 'the market must be named');
  const wrongMarket = join(tmp, 'wrong.ndjson.gz');
  writeFileSync(wrongMarket, gzipSync(JSON.stringify({ ...rows[0], market: 'gb' })));
  const mismatch = spawnSync('node', [join(root, 'scripts/load-products.mjs'), '--market', 'us', '--file', wrongMarket, '--dry-run'], { encoding: 'utf8' });
  assert.notEqual(mismatch.status, 0, 'a UK build never loads as US');
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
const requestedMarket = loadFunction('requestedMarket', {});
assert.deepEqual(['de', 'gb', 'us', 'fr', '', null, 'DE'].map(requestedMarket), ['de', 'gb', 'us', null, null, null, null]);
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
const offMarkets = [];
let blsRows = [];
const searchFoods = loadFunction('searchFoods', {
  normalizeSearchTerm: (q) => String(q).trim().toLowerCase(), isSearchQuery: (q) => q.length >= 2,
  ProviderQuotaError, ModelError,
  searchBlsCatalog: () => blsRows, getBlsReferenceByCode: () => null,
  searchOpenFoodFacts: async (term, language, claimOff, market) => {
    offCalls += 1;
    offMarkets.push(market);
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
  return searchFoods(options.q ?? 'milbona skyr', options.language ?? 'de', claim, false, admin, options.brands ?? [], options.products ?? false, options.market ?? null);
};

// Enough index hits: no live call, no provider quota spent.
let calls = [];
let result = await run(rpcAdmin({ data: [dbRow('4000000000001'), dbRow('4000000000002'), dbRow('4000000000003')], error: null }, calls), { brands: ['Milbona'] });
assert.equal(offCalls, 0, 'three index hits must not ask Open Food Facts');
assert.equal(offClaims, 0, 'index hits must not consume the Open Food Facts quota');
assert.deepEqual(calls[0], ['search_products', { q: 'milbona skyr', market: 'de', brands: ['Milbona'], lim: 20 }], 'no region (older app): the German index');
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

// The region picks the index and the live fallback's country.
calls = [];
offMarkets.length = 0;
await run(rpcAdmin({ data: [dbRow('5000000000001', { name: 'Baked Beans', brand: 'Heinz', stores: [] })], error: null }, calls), { q: 'heinz beans', language: 'en', market: 'gb', products: true });
assert.deepEqual(calls[0], ['search_products', { q: 'heinz beans', market: 'gb', brands: null, lim: 20 }]);
assert.deepEqual(offMarkets, ['gb'], 'too few UK index hits ask live Open Food Facts for UK products');
calls = [];
await run(rpcAdmin({ data: [], error: null }, calls), { q: 'chobani', language: 'de', market: 'us', products: true });
assert.equal(calls[0][1].market, 'us', 'a German speaker in the US searches US shelves');

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
const barcode = await readProductIndex(fromAdmin({ data: [dbRow('0040000000001', { market: 'de' })], error: null }, seen), '040000000001');
assert.deepEqual(seen, ['products', ['040000000001', '0040000000001']], 'UPC/EAN spellings are looked up together, in every market');
assert.equal(barcode.status, 200);
assert.deepEqual(barcode.body.per100g, { calories: 63, protein: 11, carbs: 4, fat: 0.2 });
assert.equal(barcode.body.source.provider, 'open-food-facts');
assert.equal(await readProductIndex(fromAdmin({ data: [dbRow('4000000000011', { basis: 'ml' })], error: null }), '4000000000011'), null);
// The reader's market answers first; another market's row still answers.
const twoMarkets = [dbRow('0000000000201', { market: 'us', name: 'Protein Bar US' }), dbRow('0000000000201', { market: 'gb', name: 'Protein Bar UK' })];
assert.equal((await readProductIndex(fromAdmin({ data: twoMarkets, error: null }), '0000000000201', 'gb')).body.name, 'Protein Bar UK (Milbona)');
assert.equal((await readProductIndex(fromAdmin({ data: twoMarkets, error: null }), '0000000000201', 'us')).body.name, 'Protein Bar US (Milbona)');
assert.equal((await readProductIndex(fromAdmin({ data: [twoMarkets[0]], error: null }), '0000000000201', 'de')).body.name, 'Protein Bar US (Milbona)', 'a US pack scanned in Germany is found');
assert.equal((await readProductIndex(fromAdmin({ data: [dbRow('0000000000201', { market: 'gb', basis: 'ml' }), twoMarkets[0]], error: null }), '0000000000201', 'gb')).body.name, 'Protein Bar US (Milbona)', 'a volume row is skipped, not shown as grams');
assert.equal(await readProductIndex(fromAdmin({ data: [], error: null }), '4000000000011'), null);
assert.equal(await readProductIndex(fromAdmin({ data: null, error: { message: 'missing' } }), '4000000000011'), null);
assert.equal(await readProductIndex(undefined, '4000000000011'), null);
const lookup = gateway.slice(gateway.indexOf('async function lookupBarcode'), gateway.indexOf('/** An Open Food Facts serving size'));
assert.ok(lookup.indexOf("readProductIndex(admin, barcode, market ?? 'de')") >= 0 && lookup.indexOf("readProductIndex(admin, barcode, market ?? 'de')") < lookup.indexOf('readOffCache(admin, barcode)'), 'the index answers before the OFF cache');

// Live Open Food Facts follows the market's country.
const marketCountry = new Function(`return ${gateway.match(/const MARKET_COUNTRY: [^=]+= (\{[\s\S]*?\n\});/)[1]};`)();
const offUrls = [];
const searchOpenFoodFacts = loadFunction('searchOpenFoodFacts', {
  OFF_PRODUCT_FIELDS: 'code', MARKET_COUNTRY: marketCountry, OFF_USER_AGENT: 'test', ModelError, ProviderQuotaError, AbortSignal,
  offMassNutrition: () => null, localizedProductName: () => '', compatibleSearchIdentity: () => true, offBrand: () => null, offMassPortions: () => [],
  fetch: async (url) => { offUrls.push(String(url)); return { ok: true, json: async () => ({ hits: [], products: [] }) }; },
});
for (const [language, market, country, langs] of [['de', null, 'en:germany', 'de'], ['en', null, null, 'en'], ['en', 'gb', 'en:united-kingdom', 'en'],
  ['en', 'us', 'en:united-states', 'en'], ['de', 'gb', 'en:united-kingdom', 'de,en'], ['en', 'de', 'en:germany', 'en,de']]) {
  offUrls.length = 0;
  await searchOpenFoodFacts('protein bar', language, undefined, market);
  const url = new URL(offUrls[0]);
  assert.equal(url.searchParams.get('langs'), langs, `${language}/${market}: langs`);
  if (country) assert.ok(url.searchParams.get('q').endsWith(`countries_tags:"${country}"`), `${language}/${market}: ${country}`);
  else assert.ok(!url.searchParams.get('q').includes('countries_tags'), 'no region and English: the whole database, as before');
  if (country) assert.match(offUrls[1] ?? '', new RegExp(`countries_tags_en=${country.slice(3)}&lc=${language}`), `${language}/${market}: brand fallback in the same country`);
}

// Route: brands hint and scope reach the search and its cache key.
assert.match(gateway, /captureFingerprint\(\[SEARCH_VERSION, data\.user\.id, params\.get\('q'\), params\.get\('language'\), params\.get\('scope'\), brands, market\]\)/, 'the region is part of the search cache key');
assert.match(gateway, /const market = requestedMarket\(params\.get\('region'\)\);/);
assert.match(gateway, /JSON\.stringify\(\[SEARCH_VERSION, match\[1\], requested, market\]\)/, 'the region is part of the barcode cache key');
assert.match(gateway, /const market = requestedMarket\(new URL\(request\.url\)\.searchParams\.get\('region'\)\);/);
assert.match(gateway, /value\.length <= 40\)\)\]\.slice\(0, 30\)/, 'at most 30 brand hints of ≤40 characters');
assert.match(gateway, /params\.get\('scope'\) === 'products',/);

// --- ODbL --------------------------------------------------------------------
const notices = read('THIRD_PARTY_NOTICES.md');
assert.match(notices, /public\.products\b/);
assert.match(notices, /scripts\/build-products\.py/);

// --- Client: the region rides along with product search and barcode ---------
const client = read('src/services/mealAnalysis.ts');
assert.match(client, /\/v1\/search\?q=\$\{encodeURIComponent\(term\)\}&language=\$\{getLanguage\(\)\}&scope=products&region=\$\{getMarketRegion\(\)\}/);
assert.match(client, /\/v1\/barcode\/\$\{encodeURIComponent\(barcode\)\}\?language=\$\{getLanguage\(\)\}&region=\$\{getMarketRegion\(\)\}/);
assert.match(client, /await loadMarketRegion\(\);\n  const response = await gatewayFetch\(`\/v1\/barcode/, 'the saved override is read before the first lookup');

if (process.env.KANDRO_TEST_PG_SOCKET) {
  const pg = spawnSync('python3', [join(root, 'scripts/validate-products-postgres.py')], { encoding: 'utf8', stdio: 'inherit' });
  assert.equal(pg.status, 0, 'local Postgres ranking check failed');
}
assert.ok(existsSync(join(root, 'scripts/validate-products-postgres.py')));
console.log('Product index: DE/GB/US migration, grants, rpc contract, store brands, loader, and region-aware index-first search/barcode with live Open Food Facts fallback verified.');
