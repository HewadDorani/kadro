#!/usr/bin/env node
/**
 * Plan → Supermarkt: the bundled Open Food Facts product data and the combo
 * engine that turns it into three shopping baskets.
 *
 * Data: required fields, unique barcodes, Atwater plausibility, no invented
 * stores, ODbL attribution in data, app and docs.
 * Engine: exactly three baskets with three different anchor products, within
 * 10 % of what is left, preferences respected, totals equal the label values
 * for the amounts shown, deterministic and fast.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (path.endsWith('.json')) return JSON.parse(read(path));
  const module = { exports: {} };
  cache.set(path, module.exports);
  const require = (id) => {
    assert.ok(id.startsWith('@/'), `Unexpected dependency: ${id}`);
    return load(`src/${id.slice(2)}${id.endsWith('.json') ? '' : '.ts'}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const engine = load('src/services/supermarketCombos.ts');
const { supermarketCombos, productPortions, comboBudget, comboSearchEntries, matchesPreferences, STORE_IDS, MARKET_STORE_IDS, SUPERMARKET_DATASETS, supermarketDataset } = engine;
/** One bundled dataset per shopping region; nobody in the UK sees a Rewe product. */
const MARKETS = {
  de: { path: 'src/data/supermarketProducts.json', site: 'site/data/supermarket-products.json', maxKb: 300, country: 'en:germany', language: 'de',
    categories: ['skyr', 'quark', 'protein-bar', 'tuna', 'poultry', 'fruit', 'bread', 'nuts'] },
  gb: { path: 'src/data/supermarketProducts.gb.json', site: 'site/data/supermarket-products.gb.json', maxKb: 150, country: 'en:united-kingdom', language: 'en',
    categories: ['protein-bar', 'yogurt', 'poultry', 'fruit', 'bread', 'nuts', 'sandwich'] },
  us: { path: 'src/data/supermarketProducts.us.json', site: 'site/data/supermarket-products.us.json', maxKb: 150, country: 'en:united-states', language: 'en',
    categories: ['protein-bar', 'yogurt', 'skyr', 'poultry', 'tuna', 'fruit', 'bread', 'nuts'] },
};
assert.deepEqual(Object.keys(SUPERMARKET_DATASETS).sort(), ['de', 'gb', 'us']);
assert.equal(supermarketDataset('de').products.length, JSON.parse(read(MARKETS.de.path)).products.length, 'de is the German dataset');
const STORES_OF = { de: new Set(MARKET_STORE_IDS.de), gb: new Set(MARKET_STORE_IDS.gb), us: new Set(MARKET_STORE_IDS.us) };
assert.ok(!STORES_OF.gb.has('rewe') && !STORES_OF.us.has('rewe') && !STORES_OF.de.has('tesco') && !STORES_OF.de.has('walmart'), 'store lists never cross markets');
for (const store of Object.values(MARKET_STORE_IDS).flat()) assert.ok(STORE_IDS.includes(store), `store id ${store}`);
const summaries = [];

function validateMarket(market) {
const { path: DATA_PATH, site: SITE_PATH, maxKb, categories: REQUIRED, language } = MARKETS[market];
const data = JSON.parse(read(DATA_PATH));
assert.equal(read(SITE_PATH), read(DATA_PATH), `${market}: the ODbL copy on getkandro.com matches the bundled data`);
assert.equal(supermarketDataset(market).products.length, data.products.length, `${market}: the engine reads the ${market} dataset`);

// --- data integrity -------------------------------------------------------
const CATEGORIES = new Set(['skyr', 'quark', 'cottage-cheese', 'pudding', 'yogurt', 'tuna', 'fish', 'poultry', 'jerky', 'eggs', 'protein-bar', 'tofu', 'legumes', 'wrap', 'sandwich', 'salad', 'ready-meal', 'cheese', 'hummus', 'nuts', 'bread', 'fruit-puree', 'fruit', 'vegetable']);
const DIETS = new Set(['vegan', 'vegetarian', 'lactose-free', 'pork-free']);
const MEAT_FISH = new Set(['tuna', 'fish', 'jerky', 'poultry']);
const size = statSync(resolve(root, DATA_PATH)).size;
assert.ok(size < maxKb * 1024, `${market}: dataset must stay below ${maxKb} KB (is ${(size / 1024).toFixed(1)} KB)`);
if (market !== 'de') assert.equal(data.market, market, `${market}: dataset is marked with its market`);
assert.ok(data.products.length >= 200 && data.products.length <= 450, `expected ~250–400 products, got ${data.products.length}`);
assert.match(data.attribution, /Open Food Facts/);
assert.match(data.attribution, /ODbL/);
assert.match(data.sources.off.license, /ODbL/);
assert.match(data.sources.bls.license, /CC BY 4\.0/);
assert.match(data.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);

const ids = new Set();
const barcodes = new Set();
for (const product of data.products) {
  const label = `${product.id} ${product.name}`;
  assert.equal(typeof product.id, 'string', label);
  assert.ok(!ids.has(product.id), `duplicate id ${label}`);
  ids.add(product.id);
  assert.ok(['off', 'bls'].includes(product.src), `${label}: src`);
  if (product.src === 'off') {
    assert.match(product.id, /^\d{8,14}$/, `${label}: barcode`);
    assert.ok(!barcodes.has(product.id), `duplicate barcode ${label}`);
    barcodes.add(product.id);
  } else {
    assert.match(product.id, /^bls-[A-Z0-9]{7}$/, `${label}: BLS code`);
    assert.ok(product.unit?.estimated, `${label}: loose produce piece weight must be marked as estimate`);
    assert.deepEqual(product.stores, [], `${label}: loose produce has no store data`);
  }
  assert.ok(typeof product.name === 'string' && product.name.trim() && product.name.length <= 70, `${label}: name`);
  assert.equal(typeof product.brand, 'string', `${label}: brand`);
  assert.match(product.fetched, /^\d{4}-\d{2}-\d{2}$/, `${label}: fetched date`);
  assert.ok(CATEGORIES.has(product.category), `${label}: category ${product.category}`);
  assert.ok(Array.isArray(product.stores) && product.stores.every((store) => STORES_OF[market].has(store)), `${market} ${label}: store ${product.stores} is not a ${market} store`);
  assert.ok(Array.isArray(product.diet) && product.diet.every((tag) => DIETS.has(tag)), `${label}: diet tags`);
  if (product.diet.includes('vegan')) assert.ok(product.diet.includes('vegetarian'), `${label}: vegan implies vegetarian`);
  if (MEAT_FISH.has(product.category)) assert.ok(!product.diet.includes('vegetarian'), `${label}: meat/fish is never vegetarian`);
  const n = product.per100g;
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
    assert.ok(typeof n[key] === 'number' && Number.isFinite(n[key]) && n[key] >= 0, `${label}: ${key} missing`);
  }
  if (n.fiber !== undefined) assert.ok(Number.isFinite(n.fiber) && n.fiber >= 0 && n.fiber <= 60, `${label}: fiber`);
  assert.ok(n.kcal <= 900 && n.protein + n.carbs + n.fat <= 101, `${label}: implausible nutrients`);
  const atwater = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  assert.ok(Math.abs(n.kcal - atwater) <= 0.15 * n.kcal + 10, `${label}: Atwater ${n.kcal} kcal vs ${atwater.toFixed(0)}`);
  if (product.packageG !== undefined) assert.ok(product.packageG >= 10 && product.packageG <= 2500, `${label}: package`);
  if (product.servingG !== undefined) assert.ok(product.servingG >= 10 && product.servingG <= 1000, `${label}: serving`);
  assert.ok(productPortions(product).length > 0, `${label}: no portion`);
  for (const portion of productPortions(product)) {
    assert.ok(Number.isInteger(portion.grams) && portion.grams >= 10, `${label}: portion grams`);
  }
}
const offProducts = data.products.filter((product) => product.src === 'off');
assert.ok(offProducts.length >= 200, 'most rows are real packaged products');
assert.ok(offProducts.filter((product) => !product.brand.trim()).length < offProducts.length * 0.1, 'packaged products carry their brand');
for (const category of REQUIRED) {
  assert.ok(data.products.some((product) => product.category === category), `${market}: category ${category} present`);
}

// --- engine ---------------------------------------------------------------
const PREFERENCES = [[], ['vegan'], ['vegetarian'], ['lactose-free'], ['pork-free'], ['vegetarian', 'lactose-free'], ['high-protein'], ['pork-free', 'high-protein']];
let checked = 0;
const timings = [];
for (const calories of [300, 500, 800]) {
  for (const protein of [15, 40, 90]) {
    for (const preferences of PREFERENCES) {
      const remaining = { calories, protein, carbs: 80, fat: 25 };
      const started = performance.now();
      const combos = supermarketCombos(remaining, preferences, data.products);
      timings.push(performance.now() - started);
      const label = `${market}: ${calories} kcal / ${protein} g / ${preferences.join('+') || 'none'}`;
      const budget = comboBudget(remaining);
      assert.equal(combos.length, 3, `${label}: exactly three baskets`);
      assert.equal(new Set(combos.map((combo) => combo.id)).size, 3, `${label}: distinct baskets`);
      assert.equal(new Set(combos.map((combo) => combo.items[0].product.id)).size, 3, `${label}: three different anchors`);
      assert.deepEqual(supermarketCombos(remaining, preferences, data.products), combos, `${label}: deterministic`);
      for (const combo of combos) {
        assert.ok(combo.items.length >= 1 && combo.items.length <= 3, `${label}: 1–3 products`);
        assert.equal(new Set(combo.items.map((item) => item.product.id)).size, combo.items.length, `${label}: no product twice`);
        assert.ok(combo.calories <= Math.floor(calories * 1.1), `${label}: ${combo.calories} kcal exceeds the remaining budget by more than 10 %`);
        assert.ok(combo.calories >= budget.min, `${label}: ${combo.calories} kcal is not a meal`);
        for (const item of combo.items) {
          assert.ok(matchesPreferences(item.product, preferences), `${label}: ${item.product.name} violates ${preferences}`);
          for (const tag of preferences.filter((tag) => tag !== 'high-protein')) assert.ok(item.product.diet.includes(tag), `${label}: ${item.product.name} not ${tag}`);
          const factor = item.portion.grams / 100;
          assert.equal(item.calories, Math.round(item.product.per100g.kcal * factor), 'item kcal is the label value for the amount');
          assert.equal(item.protein, Math.round(item.product.per100g.protein * factor), 'item protein is the label value');
          assert.equal(item.carbs, Math.round(item.product.per100g.carbs * factor));
          assert.equal(item.fat, Math.round(item.product.per100g.fat * factor));
          assert.ok(productPortions(item.product).some((portion) => portion.grams === item.portion.grams), 'only package, half, unit or label serving amounts');
        }
        for (const key of ['calories', 'protein', 'carbs', 'fat']) {
          assert.equal(combo[key], combo.items.reduce((sum, item) => sum + item[key], 0), `${label}: ${key} total`);
        }
        // The confirm screen receives exactly these products and amounts.
        const entries = comboSearchEntries(combo, language, (portion) => `${portion.count} · ${portion.grams} g`);
        assert.equal(entries.length, combo.items.length);
        entries.forEach((entry, index) => {
          const item = combo.items[index];
          assert.equal(entry.grams, item.portion.grams);
          assert.equal(entry.result.defaultGrams, item.portion.grams);
          assert.equal(Math.round(entry.result.per100g.calories * entry.grams / 100), item.calories, 'logged kcal equal the card');
          assert.equal(Math.round(entry.result.per100g.protein * entry.grams / 100), item.protein, 'logged protein equal the card');
          assert.ok(['open-food-facts', 'bls'].includes(entry.result.source.provider));
          assert.equal(entry.result.source.referenceId, item.product.id.replace(/^bls-/, ''));
          assert.ok(entry.result.name.length <= 160 && entry.result.portions.every((portion) => portion.grams >= 1 && portion.label));
        });
      }
      if (!preferences.length || preferences.includes('high-protein')) {
        assert.equal(new Set(combos.map((combo) => combo.items[0].product.category)).size, 3, `${label}: three different kinds of anchor`);
        for (const combo of combos) assert.ok(combo.protein >= 15, `${label}: ${combo.protein} g protein is not a protein-focused basket`);
      }
      checked += 1;
    }
  }
}
// Tiny and negative remainders still give three real small meals (200 kcal rule).
for (const calories of [-100, 0, 150]) {
  const combos = supermarketCombos({ calories, protein: 10, carbs: 10, fat: 5 }, [], data.products);
  assert.equal(combos.length, 3, `${calories} kcal: three baskets`);
  for (const combo of combos) assert.ok(combo.calories <= 220, `${calories} kcal: small basket stays ≤ 220 kcal (${combo.calories})`);
}
// High-protein preference raises protein, never lowers it.
const plain = supermarketCombos({ calories: 600, protein: 60, carbs: 60, fat: 20 }, [], data.products);
const strong = supermarketCombos({ calories: 600, protein: 60, carbs: 60, fat: 20 }, ['high-protein'], data.products);
const average = (combos) => combos.reduce((sum, combo) => sum + combo.protein, 0) / combos.length;
assert.ok(average(strong) >= average(plain), 'high-protein preference does not lower protein');

// Canned tuna: label values are per drained fish, so a whole can never counts its oil/brine.
for (const product of data.products.filter((p) => p.category === 'tuna' && p.packageG)) {
  for (const portion of productPortions(product)) {
    assert.ok(portion.grams < product.packageG || product.servingG, `${product.id}: tuna portion uses the gross can weight`);
    if (!product.servingG) assert.equal(portion.estimated, true, `${product.id}: drained tuna weight must be marked as estimate`);
  }
}

timings.sort((a, b) => a - b);
const median = timings[Math.floor(timings.length / 2)];
assert.ok(median < 20, `combo engine median ${median.toFixed(1)} ms exceeds 20 ms`);

summaries.push(`${market}: ${data.products.length} products (${(size / 1024).toFixed(1)} KB, ${offProducts.filter((p) => p.stores.length).length} with store tag), ${checked} budget/preference cases, median ${median.toFixed(1)} ms`);
}

for (const market of Object.keys(MARKETS)) validateMarket(market);

// Stores only from Open Food Facts tags: the build script has no brand→store mapping.
const build = read('scripts/build-supermarket-products.mjs');
assert.match(build, /User-Agent': USER_AGENT|'User-Agent': USER_AGENT/);
assert.match(build, /Kandro\/1\.0 \(getkandro\.com\)/);
const interval = Number(build.match(/MIN_INTERVAL_MS = (\d+)/)?.[1]);
assert.ok(interval >= 1000, 'Open Food Facts requests stay at or below one per second');
// Every market's slug → store table, German one included.
const storeMap = build.slice(build.indexOf('const STORES_BY_MARKET'), build.indexOf('const slug ='));
assert.ok(storeMap.length > 500, 'store tables found');
for (const brand of ['milbona', 'milsani', 'ja', 'gut-gunstig', 'k-classic', 'golden-seafood', 'rewe-beste-wahl']) {
  assert.ok(!new RegExp(`['\\s]${brand}['\\s]*:`).test(storeMap), `store must not be inferred from brand ${brand}`);
}
assert.match(build, /stores_tags/);

// Attribution in the app and in the docs.
for (const locale of ['de', 'en']) {
  const dictionary = read(`src/i18n/${locale}.ts`);
  const line = dictionary.match(/marketAttribution: \(date: string\) => `([^`]+)`/)?.[1] ?? '';
  assert.match(line, /Open Food Facts \(ODbL\)/, `${locale}: Plan shows the ODbL attribution`);
}
for (const locale of ['de', 'en']) {
  const dictionary = read(`src/i18n/${locale}.ts`);
  for (const store of STORE_IDS) assert.ok(dictionary.includes(`${store.includes('-') ? `'${store}'` : store}: '`), `${locale}: store name for ${store}`);
}
for (const brand of ['great-value', 'kirkland-signature', 'tesco-finest', 'taste-the-difference', 'cowbelle', 'good-gather']) {
  assert.ok(!new RegExp(`['\\s]${brand}['\\s]*:`).test(storeMap), `store must not be inferred from brand ${brand}`);
}
const plan = read('src/app/(tabs)/plan.tsx');
assert.match(plan, /t\.plan\.marketAttribution\(/, 'Plan renders the product data attribution');
assert.match(plan, /supermarketCombos\(remaining, profile\.preferences, marketData\.products\)/, 'Plan uses the dataset of the shopping region');
assert.match(plan, /startPlannedDraft\(comboSearchEntries\(/, '"Das hole ich mir" prefills the confirm screen');
assert.match(plan, /router\.push\('\/confirm'\)/);
const notices = read('THIRD_PARTY_NOTICES.md');
assert.match(notices, /supermarketProducts\.json/, 'THIRD_PARTY_NOTICES names the bundled product extract');
assert.match(notices, /ODbL/);
const context = read('src/context/AppContext.tsx');
assert.match(context, /FREE_ANALYSIS_MODES = new Set<ScanMode>\(\[[^\]]*'plan'/, 'a basket never spends a free analysis');
assert.match(context, /scanModeRef\.current === 'plan' \? 'recommendation'/, 'a basket is saved as a recommendation');

console.log(`supermarket combos per region:\n  ${summaries.join('\n  ')}`);

