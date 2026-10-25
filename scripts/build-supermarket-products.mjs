#!/usr/bin/env node
/**
 * Builds the bundled supermarket datasets for the Plan → Supermarkt combos,
 * one per shopping market (src/services/region.ts):
 *   --market de → src/data/supermarketProducts.json     (Germany, German label)
 *   --market gb → src/data/supermarketProducts.gb.json  (United Kingdom, English label)
 *   --market us → src/data/supermarketProducts.us.json  (United States, English label)
 * Each is also published under ODbL in site/data/.
 *
 * Source: Open Food Facts (ODbL 1.0 database, DbCL 1.0 contents). Discovery
 * runs against the public search service (search.openfoodfacts.org) restricted
 * to products sold in the market with a label in its language; every candidate is then
 * re-read by barcode from the product API, and only that record is used.
 * Loose fruit and vegetables have no barcode; those few rows come from the
 * bundled BLS 4.0 snapshot with the app's existing typical piece weights
 * (always labelled as estimates).
 *
 * Rules this script enforces (scripts/validate-supermarket-combos.mjs checks
 * the output again):
 * - Nutrients are copied from the label record, never filled in. A product
 *   without kcal, protein, carbohydrate and fat per 100 g is dropped.
 * - Atwater plausibility: |kcal − (4p + 4c + 9f)| ≤ 15 % of kcal + 10 kcal.
 * - Volume labels (per 100 ml, ml/l packages) are dropped: the app logs grams
 *   and never renames millilitres to grams (same rule as the barcode gateway).
 * - Store availability comes only from the product's own `stores_tags`. A
 *   Milbona product without a Lidl tag gets no store; nothing is inferred
 *   from the brand.
 * - At most one request per second, identified as Kandro.
 *
 * Usage: node scripts/build-supermarket-products.mjs [--market de|gb|us] [--cache <dir>] [--date YYYY-MM-DD]
 * Raw responses are cached (default: $TMPDIR/kandro-off-cache) so a rerun
 * after a network hiccup does not hit Open Food Facts again.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLS_SEARCH_ROWS } from '../supabase/functions/_shared/bls-search-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'Kandro/1.0 (getkandro.com)';
const SEARCH = 'https://search.openfoodfacts.org/search';
const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';
const MIN_INTERVAL_MS = 1100;

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const CACHE = argument('--cache') ?? join(tmpdir(), 'kandro-off-cache');
const FETCHED = argument('--date') ?? new Date().toISOString().slice(0, 10);
const MARKET = argument('--market') ?? 'de';
/** Per market: OFF country, label language, output files, and discovery hints only that market has. */
const MARKETS = {
  de: { country: 'en:germany', lang: 'de', output: 'src/data/supermarketProducts.json', site: 'site/data/supermarket-products.json',
    attribution: 'Produktdaten: Open Food Facts (openfoodfacts.org), ODbL 1.0' },
  gb: { country: 'en:united-kingdom', lang: 'en', output: 'src/data/supermarketProducts.gb.json', site: 'site/data/supermarket-products.gb.json',
    attribution: 'Product data: Open Food Facts (openfoodfacts.org), ODbL 1.0' },
  us: { country: 'en:united-states', lang: 'en', output: 'src/data/supermarketProducts.us.json', site: 'site/data/supermarket-products.us.json',
    attribution: 'Product data: Open Food Facts (openfoodfacts.org), ODbL 1.0' },
};
if (!MARKETS[MARKET]) throw new Error(`--market must be one of ${Object.keys(MARKETS).join(', ')}`);
const MARKET_CONFIG = MARKETS[MARKET];
const OUTPUT = resolve(root, MARKET_CONFIG.output);
mkdirSync(CACHE, { recursive: true });

// --- polite fetch ---------------------------------------------------------
let lastRequest = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function politeJson(url) {
  const file = join(CACHE, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = lastRequest + MIN_INTERVAL_MS * (attempt + 1) - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (response.status === 429 || response.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      const body = await response.json();
      writeFileSync(file, JSON.stringify(body));
      return body;
    } catch {
      await sleep(3000 * (attempt + 1));
    }
  }
  console.warn(`gave up: ${url}`);
  return null;
}

// --- discovery ------------------------------------------------------------
const MARKET_FILTER = `countries_tags:"${MARKET_CONFIG.country}" AND lang:"${MARKET_CONFIG.lang}"`;
const cat = (tag) => `categories_tags:"${tag}"`;
/**
 * Each query names what we are looking for; `limit` is the number of most
 * scanned German-label hits kept per query. Classification happens later from
 * the product's own categories, so a query is only a discovery hint.
 */
const QUERIES = [
  // protein anchors
  { q: cat('en:skyrs'), limit: 40 },
  { q: `${cat('en:quarks')} AND NOT ${cat('en:protein-bars')}`, limit: 40 },
  { q: cat('en:cottage-cheeses'), limit: 25 },
  { q: `${cat('en:dairy-desserts')} AND labels_tags:"en:high-proteins"`, limit: 40 },
  { q: `${cat('en:puddings')}`, limit: 60, minProtein: 6 },
  { q: `${cat('en:yogurts')}`, limit: 100, minProtein: 6 },
  { q: 'labels_tags:"en:high-proteins"', limit: 100 },
  { q: cat('en:canned-tunas'), limit: 30 },
  { q: cat('en:smoked-salmons'), limit: 15 },
  { q: cat('en:mackerels'), limit: 10 },
  { q: cat('en:poultry-hams'), limit: 35 },
  { q: cat('en:chicken-breasts'), limit: 25 },
  { q: 'jerky', limit: 12 },
  { q: cat('en:boiled-eggs'), limit: 15 },
  { q: cat('en:protein-bars'), limit: 60 },
  { q: cat('en:tofu'), limit: 25 },
  { q: cat('en:edamame'), limit: 10 },
  { q: cat('en:chickpeas'), limit: 12 },
  { q: cat('en:falafels'), limit: 12 },
  { q: cat('en:mozzarella'), limit: 15 },
  ...(MARKET === 'de' ? [{ q: 'Harzer', limit: 10 }] : []),
  { q: cat('en:wraps'), limit: 30 },
  { q: `${cat('en:sandwiches')} AND NOT ${cat('en:breads')}`, limit: 60 },
  ...(MARKET === 'de' ? [{ q: 'brands_tags:"rewe-to-go"', limit: 80 }] : []),
  ...(MARKET === 'gb' ? [{ q: 'meal deal', limit: 40 }, { q: cat('en:greek-style-yogurts'), limit: 30 }] : []),
  ...(MARKET === 'us' ? [{ q: cat('en:greek-yogurts'), limit: 50 }, { q: cat('en:string-cheese'), limit: 15 }, { q: cat('en:beef-jerky'), limit: 20 }] : []),
  { q: cat('en:pasta-salads'), limit: 15 },
  { q: cat('en:prepared-salads'), limit: 40, minProtein: 5 },
  { q: cat('en:microwave-meals'), limit: 40 },
  // store own brands and protein brands of the market, high protein only
  ...({
    de: ['milbona', 'milsani', 'ja', 'gut-gunstig', 'rewe-beste-wahl', 'k-classic', 'golden-seafood', 'rugenwalder-muhle', 'ehrmann', 'dulano', 'chef-select', 'vemondo', 'alpro'],
    gb: ['tesco', 'sainsbury-s', 'asda', 'morrisons', 'marks-spencer', 'm-s', 'waitrose', 'co-op', 'aldi', 'lidl', 'milbona', 'yeo-valley', 'arla', 'fage', 'grenade', 'fulfil', 'graze', 'quorn', 'alpro'],
    us: ['great-value', 'kirkland-signature', 'trader-joe-s', '365-by-whole-foods-market', 'good-gather', 'simple-truth', 'kroger', 'friendly-farms', 'chobani', 'fairlife', 'oikos', 'siggi-s', 'quest', 'premier-protein', 'pure-protein', 'good-culture', 'tyson'],
  }[MARKET]).map((brand) => ({ q: `brands_tags:"${brand}"`, limit: 60, minProtein: 8 })),
  // sides
  { q: cat('en:crispbreads'), limit: 15 },
  { q: cat('en:puffed-rice-cakes'), limit: 10 },
  { q: cat('en:wholemeal-breads'), limit: 25 },
  { q: cat('en:tortillas'), limit: 5 },
  { q: cat('en:almonds'), limit: 10 },
  { q: cat('en:cashew-nuts'), limit: 8 },
  { q: cat('en:peanuts'), limit: 10 },
  { q: cat('en:nuts'), limit: 25 },
  { q: cat('en:pumpkin-seeds'), limit: 5 },
  { q: cat('en:hummus'), limit: 15 },
  { q: cat('en:apple-compotes'), limit: 10 },
  { q: cat('en:fresh-fruits'), limit: 20 },
  { q: cat('en:grapes'), limit: 8 },
  { q: cat('en:blueberries'), limit: 10 },
  { q: cat('en:bananas'), limit: 8 },
  { q: cat('en:cherry-tomatoes'), limit: 10 },
  { q: cat('en:carrots'), limit: 8 },
  { q: cat('en:fresh-vegetables'), limit: 15 },
  { q: cat('en:sliced-cheeses'), limit: 15 },
];

const PRODUCT_FIELDS = [
  'code', 'product_name', 'product_name_de', 'product_name_en', 'ingredients_text_en', 'brands', 'stores_tags', 'quantity', 'product_quantity', 'product_quantity_unit',
  'serving_size', 'serving_quantity', 'serving_quantity_unit', 'nutrition_data_per', 'nutriments', 'categories_tags', 'labels_tags',
  'ingredients_analysis_tags', 'allergens_tags', 'ingredients_text_de', 'ingredients_text', 'ingredients_n', 'countries_tags', 'lang',
  'obsolete', 'unique_scans_n',
].join(',');

async function discover() {
  const candidates = new Map();
  for (const query of QUERIES) {
    const params = new URLSearchParams({
      q: `(${query.q}) AND ${MARKET_FILTER}`,
      fields: 'code,product_name,product_name_de,product_name_en,brands,quantity,nutriments,categories_tags,lang,unique_scans_n',
      sort_by: '-unique_scans_n',
      page_size: String(Math.min(100, query.limit * 2)),
    });
    const body = await politeJson(`${SEARCH}?${params}`);
    let kept = 0;
    for (const hit of body?.hits ?? []) {
      if (kept >= query.limit) break;
      if (!/^\d{8,14}$/.test(String(hit.code ?? ''))) continue;
      if (query.minProtein && !(Number(hit.nutriments?.proteins_100g) >= query.minProtein)) continue;
      // Cheap pre-filter on the search record, so only plausible products
      // cost a product-API request. The product record is checked again.
      const nutrients = per100g(hit.nutriments ?? {});
      const name = displayName({ ...hit, lang: hit.lang ?? MARKET_CONFIG.lang });
      if (!nutrients || !atwaterOk(nutrients) || !name || isVolume(hit)) continue;
      const category = classify(hit, name);
      if (!category || !categoryPlausible(category, nutrients)) continue;
      kept += 1;
      const previous = candidates.get(hit.code);
      if (!previous || (hit.unique_scans_n ?? 0) > previous.scans) candidates.set(hit.code, { scans: hit.unique_scans_n ?? 0, category });
    }
    console.log(`${String(kept).padStart(3)} · ${query.q}`);
  }
  // Two candidates per final slot leave room for drops on the product record.
  const ordered = [...candidates.entries()].sort((a, b) => b[1].scans - a[1].scans || a[0].localeCompare(b[0]));
  const perCategory = new Map();
  const selected = [];
  for (const [code, { scans, category }] of ordered) {
    const count = perCategory.get(category) ?? 0;
    if (count >= 2 * (CATEGORY_CAP[category] ?? 10)) continue;
    perCategory.set(category, count + 1);
    selected.push([code, scans]);
  }
  return selected;
}

// --- normalisation --------------------------------------------------------
const number = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const round1 = (value) => Math.round(value * 10) / 10;

/** Label values per 100 g; kJ is converted only when kcal is absent and kJ is explicit. */
function per100g(nutriments = {}) {
  const kcalPresent = Object.prototype.hasOwnProperty.call(nutriments, 'energy-kcal_100g');
  const kj = number(nutriments['energy-kj_100g']);
  const kcal = kcalPresent ? number(nutriments['energy-kcal_100g']) : kj === null ? null : kj / 4.184;
  const protein = number(nutriments.proteins_100g);
  const carbs = number(nutriments.carbohydrates_100g);
  const fat = number(nutriments.fat_100g);
  if ([kcal, protein, carbs, fat].some((value) => value === null)) return null;
  const fiber = number(nutriments.fiber_100g);
  return { kcal: Math.round(kcal), protein: round1(protein), carbs: round1(carbs), fat: round1(fat), ...(fiber === null ? {} : { fiber: round1(fiber) }) };
}

export function atwaterOk(n) {
  return Math.abs(n.kcal - (4 * n.protein + 4 * n.carbs + 9 * n.fat)) <= 0.15 * n.kcal + 10;
}

function isVolume(product) {
  const basis = String(product.nutrition_data_per ?? '').toLowerCase();
  const unit = String(product.product_quantity_unit ?? '').toLowerCase();
  const quantity = String(product.quantity ?? '');
  return /ml|\bl\b/.test(basis) || ['ml', 'l', 'cl', 'dl'].includes(unit) || /\d\s*(ml|cl|dl|l)\b/i.test(quantity);
}

/** Package mass in grams from the label; multipacks ("4 x 125 g") also give the unit. */
function packaging(product) {
  const quantity = String(product.quantity ?? '').replace(/,/g, '.');
  const multi = quantity.match(/(\d{1,2})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg)\b/i);
  let packageG = null;
  let unit = null;
  if (multi) {
    const each = Number(multi[2]) * (multi[3].toLowerCase() === 'kg' ? 1000 : 1);
    const count = Number(multi[1]);
    if (count >= 2 && each >= 10) { unit = { g: Math.round(each), count }; packageG = Math.round(each * count); }
  }
  const declared = number(product.product_quantity);
  const declaredUnit = String(product.product_quantity_unit ?? 'g').toLowerCase();
  if (!packageG && declared && (declaredUnit === 'g' || declaredUnit === '')) packageG = Math.round(declared);
  if (!packageG) {
    const single = quantity.match(/(\d+(?:\.\d+)?)\s*(g|kg)\b/i);
    if (single) packageG = Math.round(Number(single[1]) * (single[2].toLowerCase() === 'kg' ? 1000 : 1));
  }
  // Eggs: "6 Stück" / "12 ct" with a declared mass gives a per-piece weight from the label.
  const pieces = quantity.match(/(\d{1,2})\s*(stück|stk|eier|st\.|eggs|ct\b|count\b|pieces)/i);
  if (!unit && pieces && packageG && Number(pieces[1]) >= 2) unit = { g: Math.round(packageG / Number(pieces[1])), count: Number(pieces[1]) };
  if (packageG !== null && (packageG < 10 || packageG > 2500)) packageG = null;
  // OFF sometimes copies the whole pack into serving_size; only a real part counts.
  const servingUnit = String(product.serving_quantity_unit ?? '').toLowerCase();
  const servingLabel = String(product.serving_size ?? '');
  let servingG = number(product.serving_quantity);
  if (servingG !== null && ((servingUnit && servingUnit !== 'g') || (!servingUnit && !/\d\s*g\b/i.test(servingLabel)) || /\d\s*(ml|cl|dl|l)\b/i.test(servingLabel))) servingG = null;
  if (servingG !== null && (servingG < 10 || servingG > 1000 || (packageG && servingG >= packageG * 0.9) || (unit && Math.abs(servingG - unit.g) < 2))) servingG = null;
  return { packageG, unit, servingG: servingG === null ? null : Math.round(servingG) };
}

/** OFF store slug → store id, per market (display names: plan.marketStores). */
const STORES_BY_MARKET = {
  gb: {
    tesco: 'tesco', 'tesco-extra': 'tesco', 'tesco-express': 'tesco', 'tesco-metro': 'tesco', 'sainsbury-s': 'sainsburys', sainsburys: 'sainsburys',
    'sainsbury-s-local': 'sainsburys', asda: 'asda', morrisons: 'morrisons', 'marks-spencer': 'ms', 'marks-and-spencer': 'ms', 'm-s': 'ms',
    'm-s-food': 'ms', waitrose: 'waitrose', 'waitrose-partners': 'waitrose', 'co-op': 'coop', 'the-co-operative': 'coop', 'co-operative': 'coop',
    'coop': 'coop', aldi: 'aldi', 'aldi-uk': 'aldi', lidl: 'lidl', 'lidl-uk': 'lidl', iceland: 'iceland',
  },
  us: {
    walmart: 'walmart', 'wal-mart': 'walmart', 'walmart-supercenter': 'walmart', costco: 'costco', 'trader-joe-s': 'traderjoes', 'trader-joes': 'traderjoes',
    'whole-foods': 'wholefoods', 'whole-foods-market': 'wholefoods', target: 'target', 'super-target': 'target', kroger: 'kroger',
    aldi: 'aldi', 'aldi-us': 'aldi', safeway: 'safeway', albertsons: 'albertsons',
  },
};
const STORES = STORES_BY_MARKET[MARKET] ?? {
  lidl: 'lidl', 'lidl-deutschland': 'lidl',
  aldi: 'aldi', 'aldi-nord': 'aldi-nord', 'aldi-sud': 'aldi-sued', 'aldi-sued': 'aldi-sued', 'aldi-suid': 'aldi-sued',
  rewe: 'rewe', 'rewe-to-go': 'rewe', 'rewe-city': 'rewe', 'rewe-center': 'rewe',
  edeka: 'edeka', 'e-center': 'edeka', marktkauf: 'edeka',
  kaufland: 'kaufland',
  dm: 'dm', 'dm-drogerie-markt': 'dm', 'dm-drogerie': 'dm',
  penny: 'penny', netto: 'netto', 'netto-marken-discount': 'netto', rossmann: 'rossmann',
};
const slug = (value) => String(value).toLowerCase().replace(/^[a-z]{2}:/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function stores(product) {
  const tags = Array.isArray(product.stores_tags) ? product.stores_tags : [];
  const mapped = [...new Set(tags.map((tag) => STORES[slug(tag)]).filter(Boolean))];
  // "Aldi" next to "Aldi Süd" adds nothing.
  return mapped.filter((store) => store !== 'aldi' || !mapped.some((other) => other.startsWith('aldi-'))).sort();
}

const has = (product, field, tag) => (product[field] ?? []).includes(tag);
const anyCategory = (product, tags) => tags.some((tag) => has(product, 'categories_tags', tag));

function displayName(product) {
  const lang = MARKET_CONFIG.lang;
  let name = String(product[`product_name_${lang}`] || (product.lang === lang ? product.product_name : '') || '').replace(/\s+/g, ' ').trim();
  // Some records carry the barcode or a price in the name.
  name = name.replace(/\s*\b\d{8,14}\b\s*/g, ' ').replace(/[\u2013\u2014]/g, '-').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name === name.toUpperCase() && /[A-ZÄÖÜ]{3}/.test(name)) {
    name = name.toLowerCase().replace(/(^|[\s\-(])([a-zäöü])/g, (_m, lead, letter) => lead + letter.toUpperCase());
  }
  return name.length > 70 ? null : name;
}
function displayBrand(product) {
  const first = String(product.brands ?? '').split(',').map((part) => part.trim()).find((part) => /[a-zäöü]{2}/i.test(part));
  if (!first) return '';
  const brand = first.replace(/\s+/g, ' ').slice(0, 40);
  // UK/US retailer feeds write brands in capitals ("TESCO", "RYVITA"); short marks ("M&S") stay.
  if (MARKET_CONFIG.lang === 'en' && brand.length > 4 && brand === brand.toUpperCase() && /[A-Z]{3}/.test(brand)) {
    return brand.toLowerCase().replace(/(^|[\s\-(&])([a-z])/g, (_m, lead, letter) => lead + letter.toUpperCase());
  }
  return brand;
}

/**
 * Not something to buy and eat now: needs an oven or a pan (raw patties,
 * fresh pasta, frozen food), is a filling or an ingredient, or is a sweet.
 */
const NOT_READY = new RegExp([
  'tiefgefroren|tiefkühl|\\btk\\b|fischstäbchen|nuggets|burger|hot ?dogs?|patt(y|ies)|tortell|tortelin|maultasch|lasagne|easy-to-mix|bratwurst|brezel|focaccia|pizza|füllung|sour cream|müsli|muesli|gezuckert|geschält|schoko',
  // English labels (UK/US datasets only, so the German build is unchanged).
  ...(MARKET_CONFIG.lang === 'en' ? ['frozen|uncooked|\\braw\\b|fish fingers|sausages?\\b|pastry|granola|cereal|chocolate|candy|cookie|brownie|ice cream|\\bmix\\b|seasoning|\\bsauce\\b|dressing|\\bdip\\b|pancake'] : []),
].join('|'), 'i');

/** The product's own categories decide; the order resolves overlaps (skyr is also a cheese). */
function classify(product, name) {
  const lower = name.toLowerCase();
  // Hummus is filed under spreads, which are otherwise excluded.
  if (anyCategory(product, ['en:hummus']) && !anyCategory(product, ['en:beverages'])) return 'hummus';
  if (anyCategory(product, ['en:beverages', 'en:dried-fruits', 'en:frozen-foods', 'en:juices', 'en:spreads', 'en:sweet-spreads'])) return null;
  if (NOT_READY.test(name) && !/protein|riegel|pudding/i.test(name)) return null;
  if (/reiswaffel|knäcke|rice cakes?|crispbread|rye crisp/.test(lower)) return 'bread';
  if (/tortilla wraps|wraps? \d|tortillas/.test(lower)) return 'bread';
  if (anyCategory(product, ['en:protein-bars']) || /proteinriegel|protein bar|protein-riegel|quarkriegel/.test(lower)) return 'protein-bar';
  if (anyCategory(product, ['en:skyrs'])) return 'skyr';
  if (anyCategory(product, ['en:cottage-cheeses']) || /hüttenkäse|körniger frischkäse|cottage cheese/.test(lower)) return 'cottage-cheese';
  if (anyCategory(product, ['en:quarks']) || /\bquark\b|magerquark|speisequark/.test(lower)) return 'quark';
  if (anyCategory(product, ['en:puddings']) || /pudding/.test(lower)) return 'pudding';
  if (anyCategory(product, ['en:yogurts', 'en:plant-based-foods-and-beverages']) && /joghurt|yogurt|yoghurt|soja natur|skyr/.test(lower)) return 'yogurt';
  if (anyCategory(product, ['en:yogurts'])) return 'yogurt';
  if (anyCategory(product, ['en:tunas'])) return 'tuna';
  if (anyCategory(product, ['en:smoked-fishes', 'en:mackerels', 'en:salmons', 'en:fishes'])) return 'fish';
  if (/jerky/.test(lower)) return 'jerky';
  if (anyCategory(product, ['en:poultry-hams', 'en:chicken-breasts', 'en:turkey-breasts']) || /hähnchenbrust|putenbrust|chicken breast|turkey breast/.test(lower)) return 'poultry';
  if (anyCategory(product, ['en:boiled-eggs'])) return 'eggs';
  if (anyCategory(product, ['en:tofu', 'xx:tofu', 'en:smoked-tofu']) || /\btofu\b|räuchertofu/.test(lower)) return 'tofu';
  if (anyCategory(product, ['en:edamame', 'en:chickpeas', 'en:falafels'])) return 'legumes';
  if (anyCategory(product, ['en:wraps']) && !anyCategory(product, ['en:breads', 'en:tortillas'])) return 'wrap';
  if (/\bwrap\b/.test(lower) && anyCategory(product, ['en:meals', 'en:sandwiches'])) return 'wrap';
  if (anyCategory(product, ['en:sandwiches']) && !anyCategory(product, ['en:breads', 'en:sauces', 'en:cheeses', 'en:meats'])) return 'sandwich';
  if (anyCategory(product, ['en:pasta-salads', 'en:prepared-salads', 'en:salads'])) return 'salad';
  if (anyCategory(product, ['en:microwave-meals', 'en:meals'])) return 'ready-meal';
  if (anyCategory(product, ['en:hummus'])) return 'hummus';
  if (anyCategory(product, ['en:mozzarella']) || /harzer/.test(lower)) return 'cheese';
  if (anyCategory(product, ['en:sliced-cheeses', 'en:cheeses'])) return 'cheese';
  if (anyCategory(product, ['en:nuts', 'en:almonds', 'en:cashew-nuts', 'en:peanuts', 'en:pumpkin-seeds', 'en:seeds'])) return 'nuts';
  if (anyCategory(product, ['en:crispbreads', 'en:puffed-rice-cakes', 'en:breads', 'en:tortillas'])) return 'bread';
  if (anyCategory(product, ['en:apple-compotes'])) return 'fruit-puree';
  if (anyCategory(product, ['en:fresh-fruits', 'en:grapes', 'en:blueberries', 'en:bananas'])) return 'fruit';
  if (anyCategory(product, ['en:fresh-vegetables', 'en:cherry-tomatoes', 'en:carrots'])) return 'vegetable';
  return null;
}

/** A label typo can still pass Atwater (e.g. kJ typed as kcal everywhere); the category bounds catch those. */
const CATEGORY_BOUNDS = {
  skyr: { kcal: [40, 160], protein: [6, 20] }, quark: { kcal: [50, 220], protein: [5, 20] },
  'cottage-cheese': { kcal: [50, 160], protein: [8, 20] }, pudding: { kcal: [50, 200], protein: [5, 20] },
  yogurt: { kcal: [35, 200], protein: [3, 20] }, tuna: { kcal: [80, 320], protein: [8, 35] },
  fish: { kcal: [80, 320], protein: [12, 35] }, poultry: { kcal: [60, 200], protein: [12, 35] },
  'protein-bar': { kcal: [250, 500], protein: [15, 65] }, tofu: { kcal: [70, 300], protein: [8, 30] },
  fruit: { kcal: [20, 120], protein: [0, 3] }, vegetable: { kcal: [10, 80], protein: [0, 5] },
  nuts: { kcal: [450, 750], protein: [10, 35] },
};
function categoryPlausible(category, nutrients) {
  const bounds = CATEGORY_BOUNDS[category];
  if (!bounds) return true;
  return nutrients.kcal >= bounds.kcal[0] && nutrients.kcal <= bounds.kcal[1] && nutrients.protein >= bounds.protein[0] && nutrients.protein <= bounds.protein[1];
}

const MEAT_FISH = new Set(['tuna', 'fish', 'jerky', 'poultry']);
const DAIRY = new Set(['skyr', 'quark', 'cottage-cheese', 'pudding', 'yogurt', 'cheese']);
const PORK = /schwein|speck|bacon|pork|gelatine|gelatin|schmalz|salami|schinken|wurst|\blard\b|\bham\b|sausage|pepperoni|chorizo|prosciutto|pancetta/i;

/**
 * Conservative dietary flags. A flag is only set when the label or OFF's
 * ingredient analysis states it; unknown stays unknown (= excluded for anyone
 * who asked for that preference).
 */
function dietFlags(product, category) {
  const labels = product.labels_tags ?? [];
  const analysis = product.ingredients_analysis_tags ?? [];
  const allergens = product.allergens_tags ?? [];
  const ingredients = String(product[`ingredients_text_${MARKET_CONFIG.lang}`] || product.ingredients_text || '');
  const hasIngredients = ingredients.trim().length > 2 && Number(product.ingredients_n ?? 1) > 0;
  const flags = [];
  const vegan = !MEAT_FISH.has(category) && !DAIRY.has(category) && !allergens.some((tag) => ['en:milk', 'en:eggs', 'en:fish', 'en:crustaceans', 'en:molluscs'].includes(tag))
    && (labels.includes('en:vegan') || analysis.includes('en:vegan'));
  const vegetarian = !MEAT_FISH.has(category) && (vegan || labels.includes('en:vegetarian') || analysis.includes('en:vegetarian'));
  if (vegan) flags.push('vegan');
  if (vegetarian) flags.push('vegetarian');
  const lactoseLabel = labels.includes('en:no-lactose') || labels.includes('en:lactose-free');
  if (lactoseLabel || vegan || (hasIngredients && !DAIRY.has(category) && !allergens.includes('en:milk') && !/milch|milk|sahne|butter|käse|joghurt|quark|molke|lactose|laktose|cheese|cream|whey|yog(h)?urt|casein/i.test(ingredients))) flags.push('lactose-free');
  // Meat of unnamed species ("Fleisch", "Hack", "Gyros") may be pork; only
  // named poultry, fish or no meat at all counts.
  const unnamedMeat = /(^|[^a-zäöüß])(fleisch|hackfleisch|hack|gyros|frikadell|leberkäse|döner|meat\b|mechanically separated)/i.test(ingredients);
  if (hasIngredients && !PORK.test(ingredients) && (vegetarian || !unnamedMeat)) flags.push('pork-free');
  // A vegan product is also vegetarian, pork free and lactose free; vegetarian implies pork free.
  if (flags.includes('vegan')) for (const implied of ['vegetarian', 'pork-free', 'lactose-free']) if (!flags.includes(implied)) flags.push(implied);
  if (flags.includes('vegetarian') && !flags.includes('pork-free')) flags.push('pork-free');
  return flags.sort();
}

// --- loose produce from BLS 4.0 ---------------------------------------------
// Piece weights are the same typical portions the search uses
// (src/services/foodSuggest.ts PORTIONS) and are shown as estimates.
const PRODUCE = [
  { code: 'F503100', name: 'Banane', category: 'fruit', pieceG: 120 },
  { code: 'F110100', name: 'Apfel', category: 'fruit', pieceG: 150 },
  { code: 'F130100', name: 'Birne', category: 'fruit', pieceG: 160 },
  { code: 'F603100', name: 'Orange', category: 'fruit', pieceG: 150 },
  { code: 'F514100', name: 'Kiwi', category: 'fruit', pieceG: 75 },
];
function produceRows() {
  const byCode = new Map(BLS_SEARCH_ROWS.map((row) => [row[0], row]));
  return PRODUCE.map((entry) => {
    const row = byCode.get(entry.code);
    if (!row) throw new Error(`BLS row ${entry.code} missing`);
    const [, nameDe, nameEn, kcal, protein, carbs, fat, fiber] = row;
    if (!new RegExp(entry.name.slice(0, 4), 'i').test(nameDe)) throw new Error(`BLS ${entry.code} is ${nameDe}, not ${entry.name}`);
    const english = nameEn.replace(/,? raw$/i, '').replace(/^(\w)/, (letter) => letter.toUpperCase());
    return {
      id: `bls-${entry.code}`,
      // UK/US datasets name loose fruit in English; the values stay BLS 4.0.
      name: MARKET_CONFIG.lang === 'de' ? entry.name : english,
      ...(MARKET_CONFIG.lang === 'de' ? { nameEn: english } : {}),
      brand: '',
      stores: [],
      unit: { g: entry.pieceG, count: 1, estimated: true },
      per100g: { kcal: Math.round(kcal), protein: round1(protein), carbs: round1(carbs), fat: round1(fat), fiber: round1(fiber) },
      category: entry.category,
      diet: ['lactose-free', 'pork-free', 'vegan', 'vegetarian'],
      src: 'bls',
      fetched: FETCHED,
    };
  });
}

const HALF_PACK = new Set(['skyr', 'quark', 'cottage-cheese', 'yogurt', 'tofu', 'legumes', 'poultry', 'fish', 'cheese', 'hummus', 'vegetable', 'salad', 'fruit-puree']);
function eatablePortion(category, pack) {
  if ((pack.servingG && pack.servingG <= 550) || (pack.unit && pack.unit.g <= 550)) return true;
  if (!pack.packageG) return false;
  if (category === 'tuna') return pack.packageG * 0.72 <= 550;
  return pack.packageG <= 550 || (HALF_PACK.has(category) && pack.packageG / 2 <= 550);
}

// --- build ----------------------------------------------------------------
const CATEGORY_CAP = {
  skyr: 26, quark: 24, 'cottage-cheese': 16, pudding: 24, yogurt: 30, tuna: 18, fish: 14, poultry: 22, jerky: 8, eggs: 8,
  'protein-bar': 30, tofu: 16, legumes: 16, wrap: 16, sandwich: 20, salad: 22, 'ready-meal': 22, cheese: 16, hummus: 10,
  nuts: 18, bread: 22, 'fruit-puree': 6, fruit: 16, vegetable: 12,
};

async function main() {
  const ordered = await discover();
  console.log(`${ordered.length} candidates`);
  const products = [];
  const seenKeys = new Set();
  const perCategory = new Map();
  const dropped = new Map();
  const drop = (reason) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
  for (const [code] of ordered) {
    const body = await politeJson(`${PRODUCT}/${code}?fields=${PRODUCT_FIELDS}`);
    const product = body?.status === 1 ? body.product : null;
    if (!product) { drop('not found'); continue; }
    if (product.obsolete === 'on' || product.obsolete === true) { drop('obsolete'); continue; }
    if (!(product.countries_tags ?? []).includes(MARKET_CONFIG.country)) { drop(`not sold in ${MARKET_CONFIG.country}`); continue; }
    if (isVolume(product)) { drop('volume label'); continue; }
    const name = displayName(product);
    if (!name) { drop(`no ${MARKET_CONFIG.lang} name`); continue; }
    const nutrients = per100g(product.nutriments);
    if (!nutrients) { drop('missing nutrients'); continue; }
    if (nutrients.kcal > 900 || nutrients.protein > 100 || nutrients.carbs > 100 || nutrients.fat > 100
      || nutrients.protein + nutrients.carbs + nutrients.fat > 101 || (nutrients.fiber ?? 0) > 60) { drop('implausible nutrients'); continue; }
    if (!atwaterOk(nutrients)) { drop('Atwater mismatch'); continue; }
    const category = classify(product, name);
    if (!category) { drop('unclassified'); continue; }
    if (!categoryPlausible(category, nutrients)) { drop('implausible for category'); continue; }
    const pack = packaging(product);
    if (!pack.packageG && !pack.servingG && !pack.unit) { drop('no package size'); continue; }
    // Mirrors productPortions in src/services/supermarketCombos.ts: a whole
    // 800 g loaf without a labelled serving offers no amount anyone eats.
    if (!eatablePortion(category, pack)) { drop('no eatable portion'); continue; }
    const brand = displayBrand(product);
    const key = `${slug(brand)}|${slug(name)}|${pack.packageG ?? pack.servingG}`;
    if (seenKeys.has(key)) { drop('duplicate'); continue; }
    if ((perCategory.get(category) ?? 0) >= (CATEGORY_CAP[category] ?? 10)) { drop('category full'); continue; }
    seenKeys.add(key);
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    products.push({
      id: String(product.code ?? code),
      name,
      brand,
      stores: stores(product),
      ...(pack.packageG ? { packageG: pack.packageG } : {}),
      ...(pack.unit ? { unit: pack.unit } : {}),
      ...(pack.servingG ? { servingG: pack.servingG } : {}),
      per100g: nutrients,
      category,
      diet: dietFlags(product, category),
      src: 'off',
      fetched: FETCHED,
    });
  }
  const all = [...products, ...produceRows()]
    .sort((a, b) => a.category.localeCompare(b.category) || 0);
  const ids = new Set();
  for (const item of all) {
    if (ids.has(item.id)) throw new Error(`duplicate id ${item.id}`);
    ids.add(item.id);
  }
  const dataset = {
    comment: 'GENERATED by scripts/build-supermarket-products.mjs, do not edit by hand. Nutrient values are label values per 100 g as recorded in Open Food Facts (rows with src "off") or BLS 4.0 (rows with src "bls"; loose produce, piece weights estimated). Stores appear only when the Open Food Facts record carries a stores tag.',
    sources: {
      off: { name: 'Open Food Facts', url: 'https://world.openfoodfacts.org', license: 'Open Database License (ODbL) 1.0; individual contents: Database Contents License (DbCL) 1.0' },
      bls: { name: 'Bundeslebensmittelschlüssel 4.0 (Max Rubner-Institut)', url: 'https://doi.org/10.25826/Data20251217-134202-0', license: 'CC BY 4.0' },
    },
    attribution: MARKET_CONFIG.attribution,
    market: MARKET,
    fetchedAt: FETCHED,
    products: all,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(dataset)}\n`);
  // The same extract, published under ODbL on getkandro.com.
  writeFileSync(resolve(root, MARKET_CONFIG.site), `${JSON.stringify(dataset)}\n`);
  const size = Buffer.byteLength(JSON.stringify(dataset));
  const storeCounts = {};
  for (const item of all) for (const store of item.stores) storeCounts[store] = (storeCounts[store] ?? 0) + 1;
  console.log(`\n${all.length} products, ${(size / 1024).toFixed(1)} KB → ${OUTPUT}`);
  console.log('per category', Object.fromEntries([...new Set(all.map((item) => item.category))].map((c) => [c, all.filter((item) => item.category === c).length])));
  console.log('stores', storeCounts, `· with store tag: ${all.filter((item) => item.stores.length).length}`);
  console.log('dropped', Object.fromEntries(dropped));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
