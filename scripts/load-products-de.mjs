#!/usr/bin/env node
/**
 * Upserts the products_de build (scripts/build-products-de.py) into Postgres
 * in batches. Resumable and idempotent: every batch is one atomic
 * INSERT … ON CONFLICT (code) DO UPDATE, progress is kept in a state file next
 * to the input, and re-running a finished batch changes nothing but
 * updated_at.
 *
 *   node scripts/load-products-de.mjs --file DIR/products-de.ndjson.gz --dry-run
 *   node scripts/load-products-de.mjs --file … --db-url "$DATABASE_URL"            # psql
 *   node scripts/load-products-de.mjs --file … --linked --confirm-linked          # supabase db query --linked
 *   … --prune      after the last batch, delete rows of older builds
 *   … --batch 1000 --build-id off-20261012 --max-batches 3 --restart
 *
 * Requires migration 20261012120000_products_de.sql. Never run from CI.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const file = option('file');
if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/load-products-de.mjs --file products-de.ndjson.gz (--dry-run | --db-url URL | --linked --confirm-linked) [--prune] [--batch 1000] [--build-id ID] [--restart]');
  process.exit(2);
}
const dbUrl = option('db-url', flag('db-url') ? process.env.SUPABASE_DB_URL : undefined);
const linked = flag('linked');
const dryRun = flag('dry-run');
if ([Boolean(dbUrl), linked, dryRun].filter(Boolean).length !== 1) {
  console.error('Choose exactly one target: --dry-run, --db-url URL, or --linked --confirm-linked.');
  process.exit(2);
}
if (linked && !flag('confirm-linked')) {
  console.error('--linked writes to the linked Supabase project; add --confirm-linked to proceed.');
  process.exit(2);
}
const batchSize = Math.min(Math.max(Number(option('batch', '1000')) || 1000, 50), 5000);
const maxBatches = Number(option('max-batches', '0')) || Infinity;
const stat = statSync(file);
const statsFile = file.replace(/\.ndjson\.gz$/, '.stats.json');
const builtAt = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, 'utf8')).built_at : null;
const buildId = option('build-id', `off-${(builtAt ?? stat.mtime.toISOString()).slice(0, 10).replace(/-/g, '')}`);
if (!/^[0-9A-Za-z_.-]{1,40}$/.test(buildId)) throw new Error(`invalid build id: ${buildId}`);

const stateFile = `${file}.load-state.json`;
const fingerprint = `${stat.size}:${stat.mtimeMs}:${batchSize}:${buildId}`;
let state = { fingerprint, nextBatch: 0, rows: 0, done: false };
if (!flag('restart') && !dryRun && existsSync(stateFile)) {
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (saved.fingerprint === fingerprint) state = saved;
  else console.log('state file belongs to another build/batch size; starting from batch 0');
}
const saveState = () => { if (!dryRun) writeFileSync(stateFile, JSON.stringify(state, null, 1)); };

const COLUMNS = [
  ['code', 'text'], ['name', 'text'], ['brand', 'text'], ['brands', 'text[]'], ['stores', 'text[]'], ['basis', 'text'],
  ['package_g', 'numeric'], ['package_ml', 'numeric'], ['serving_g', 'numeric'], ['kcal', 'numeric'], ['protein', 'numeric'],
  ['carbs', 'numeric'], ['sugars', 'numeric'], ['fat', 'numeric'], ['sat_fat', 'numeric'], ['fiber', 'numeric'],
  ['salt', 'numeric'], ['category', 'text'], ['nutriscore', 'text'], ['popularity', 'integer'], ['last_modified', 'bigint'],
];

/** One atomic upsert; the JSON travels in a dollar quote with a random tag. */
function batchSql(rows, build) {
  const json = JSON.stringify(rows);
  let tag;
  do tag = `$kp${randomBytes(4).toString('hex')}$`; while (json.includes(tag));
  const names = COLUMNS.map(([name]) => name);
  const select = names.map((name) => name === 'last_modified'
    ? 'case when r.last_modified > 0 then to_timestamp(r.last_modified) end'
    : name === 'popularity' ? 'coalesce(r.popularity, 0)'
    : name === 'brands' || name === 'stores' ? `coalesce(r.${name}, '{}')`
    : `r.${name}`);
  const update = [...names.filter((name) => name !== 'code'), 'build_id'].map((name) => `${name} = excluded.${name}`);
  return `insert into public.products_de (${names.join(', ')}, build_id, updated_at)
select ${select.join(', ')}, '${build}', now()
from jsonb_to_recordset(${tag}${json}${tag}::jsonb) as r(${COLUMNS.map(([name, type]) => `${name} ${type}`).join(', ')})
on conflict (code) do update set ${update.join(', ')}, updated_at = now();\n`;
}

const workDir = mkdtempSync(join(tmpdir(), 'kandro-products-'));
function execute(sql, label) {
  const path = join(workDir, 'batch.sql');
  writeFileSync(path, sql);
  if (dryRun) return '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = linked
      ? spawnSync('supabase', ['db', 'query', '--linked', '-f', path], { encoding: 'utf8', maxBuffer: 64 << 20 })
      : spawnSync('psql', [dbUrl, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', path], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (result.status === 0) return result.stdout;
    console.error(`${label}: attempt ${attempt} failed: ${(result.stderr || result.error?.message || '').slice(0, 400)}`);
    if (attempt < 3) spawnSync('sleep', [String(attempt * 5)]);
  }
  saveState();
  rmSync(workDir, { recursive: true, force: true });
  console.error(`stopped at batch ${state.nextBatch}; re-run the same command to resume`);
  process.exit(1);
}

const started = Date.now();
const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
let batch = [];
let index = 0;
let sent = 0;
let lastBytes = 0;
const flush = () => {
  if (!batch.length) return;
  if (index >= state.nextBatch) {
    const sql = batchSql(batch, buildId);
    lastBytes = sql.length;
    execute(sql, `batch ${index}`);
    state.nextBatch = index + 1;
    state.rows += batch.length;
    sent += 1;
    saveState();
    if (sent % 10 === 0 || sent === 1) {
      const seconds = (Date.now() - started) / 1000;
      console.log(`batch ${index + 1}: ${state.rows} rows ${dryRun ? "prepared" : "loaded"} (${(lastBytes / 1024).toFixed(0)} KB/batch, ${seconds.toFixed(0)} s)`);
    }
  }
  index += 1;
  batch = [];
};

for await (const line of lines) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  batch.push(Object.fromEntries(COLUMNS.map(([name]) => [name, row[name] ?? null])));
  if (batch.length >= batchSize) {
    flush();
    if (sent >= maxBatches) break;
  }
}
const complete = sent < maxBatches;
if (complete) flush();

if (complete) {
  if (flag('prune')) {
    execute(`delete from public.products_de where build_id <> '${buildId}';\n`, 'prune');
    console.log(`pruned rows of builds other than ${buildId}`);
  }
  execute('analyze public.products_de;\n', 'analyze');
  state.done = true;
  saveState();
}
const summary = dryRun ? '' : execute(`select count(*) || ' rows, ' || count(*) filter (where build_id = '${buildId}') || ' from ${buildId}' from public.products_de;\n`, 'count');
console.log(`${dryRun ? 'dry run: ' : ''}${index} batches of ≤${batchSize} (${sent} sent this run), build ${buildId}${summary ? `; table: ${summary.trim()}` : ''}${dryRun ? `; last batch SQL ${(lastBytes / 1024).toFixed(0)} KB` : ''}`);
rmSync(workDir, { recursive: true, force: true });
