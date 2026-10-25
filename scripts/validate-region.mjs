#!/usr/bin/env node
/**
 * Shopping region (src/services/region.ts): device region → market
 * (DE/AT/CH → de, GB/UK → gb, US → us, otherwise by language), the Du
 * override persisted in AsyncStorage, listeners re-rendering on change, and
 * everything regional that follows it: store-brand hints per market, the
 * Plan supermarket subtitle and dataset, the Du settings row, and the
 * `region` parameter of product search and barcode lookups.
 * Real modules with stubbed native dependencies; no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load(path, deps = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpile(read(path)))((id) => {
    if (id.startsWith('../data/') && id.endsWith('.json')) return JSON.parse(read(`src/data/${id.slice(8)}`));
    assert.ok(id in deps, `Unmocked dependency ${id}`);
    return deps[id];
  }, module, module.exports);
  return module.exports;
}
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log('PASS', name); };

// --- stubs ---------------------------------------------------------------------
const storage = new Map();
const AsyncStorage = {
  getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: async (key, value) => { storage.set(key, String(value)); },
  removeItem: async (key) => { storage.delete(key); },
};
let locales = [{ regionCode: 'DE', languageCode: 'de', languageTag: 'de-DE' }];
const rendered = [];
const react = {
  useState: (init) => {
    let value = typeof init === 'function' ? init() : init;
    return [value, (next) => { value = typeof next === 'function' ? next() : next; rendered.push(value); }];
  },
  useEffect: (effect) => { effect(); },
};
const region = load('src/services/region.ts', {
  '@react-native-async-storage/async-storage': { __esModule: true, default: AsyncStorage },
  'expo-localization': { getLocales: () => locales },
  react,
});

await test('device region → market: DACH, UK, US, and the language fallback', () => {
  const cases = [
    ['DE', 'de', 'de'], ['AT', 'de', 'de'], ['CH', 'fr', 'de'], ['CH', 'it', 'de'], ['GB', 'en', 'gb'], ['UK', 'en', 'gb'], ['gb', 'de', 'gb'],
    ['US', 'en', 'us'], ['US', 'de', 'us'], ['DE', 'en', 'de'],
    ['FR', 'fr', 'us'], ['IE', 'en', 'us'], ['LU', 'de', 'de'], ['BE', 'de-BE', 'de'], [null, 'de', 'de'], [null, 'en', 'us'], [undefined, undefined, 'us'],
  ];
  for (const [code, language, market] of cases) assert.equal(region.marketRegionFor(code, language), market, `${code}/${language}`);
  locales = [{ regionCode: 'AT', languageCode: 'de', languageTag: 'de-AT' }];
  assert.equal(region.deviceMarketRegion(), 'de');
  locales = [{ regionCode: null, languageCode: 'en', languageTag: 'en-GB' }];
  assert.equal(region.deviceMarketRegion(), 'gb', 'the region inside the language tag counts when regionCode is missing');
  locales = [{ regionCode: 'US', languageCode: 'de', languageTag: 'de-US' }];
  assert.equal(region.deviceMarketRegion(), 'us', 'a German speaker in Texas shops at US stores');
  locales = [];
  assert.equal(region.deviceMarketRegion(), 'us');
  locales = [{ regionCode: 'GB', languageCode: 'en', languageTag: 'en-GB' }];
});

await test('override: persisted, applied synchronously, "auto" clears it, listeners re-render', async () => {
  assert.equal(region.getMarketRegion(), 'gb');
  assert.equal(region.getMarketRegionSetting(), 'auto');
  rendered.length = 0;
  assert.equal(region.useMarketRegion(), 'gb');
  await region.setMarketRegionSetting('us');
  assert.equal(storage.get(region.MARKET_REGION_KEY), 'us');
  assert.equal(region.getMarketRegion(), 'us');
  assert.equal(region.getMarketRegionSetting(), 'us');
  assert.ok(rendered.includes('us'), 'useMarketRegion re-renders on change');
  await region.setMarketRegionSetting('auto');
  assert.equal(storage.has(region.MARKET_REGION_KEY), false);
  assert.equal(region.getMarketRegion(), 'gb', 'automatic follows the device again');
  const setting = region.useMarketRegionSetting();
  assert.equal(setting.setting, 'auto'); assert.equal(setting.region, 'gb'); assert.equal(setting.device, 'gb');
});

await test('stored override is read on launch; junk is ignored', async () => {
  for (const [stored, expected] of [['de', 'de'], ['DE', 'gb'], ['fr', 'gb'], ['', 'gb']]) {
    storage.set(region.MARKET_REGION_KEY, stored);
    const fresh = load('src/services/region.ts', {
      '@react-native-async-storage/async-storage': { __esModule: true, default: AsyncStorage },
      'expo-localization': { getLocales: () => locales }, react,
    });
    assert.equal(fresh.getMarketRegion(), 'gb', 'before the read: the device');
    await fresh.loadMarketRegion();
    assert.equal(fresh.getMarketRegion(), expected, `stored ${JSON.stringify(stored)}`);
  }
  storage.delete(region.MARKET_REGION_KEY);
  const failing = load('src/services/region.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => { throw new Error('disk'); } } },
    'expo-localization': { getLocales: () => locales }, react,
  });
  await failing.loadMarketRegion();
  assert.equal(failing.getMarketRegion(), 'gb', 'a storage failure falls back to the device');
});

const hints = load('src/services/productSearch.ts');
await test('store brands follow the market: no Tesco in Germany, no Rewe in the UK', () => {
  const tesco = hints.productSearchHint('tesco sandwich', 'gb');
  assert.equal(tesco.store, 'Tesco'); assert.ok(tesco.brands.includes('Tesco Finest') && tesco.brands.includes('Stockwell & Co'));
  assert.deepEqual(hints.productSearchHint('tesco sandwich', 'de'), { brandQuery: false, brands: [] });
  assert.deepEqual(hints.productSearchHint('rewe gouda', 'gb'), { brandQuery: false, brands: [] });
  assert.equal(hints.productSearchHint('rewe gouda', 'de').store, 'Rewe');
  const aldiUk = hints.productSearchHint('aldi yogurt', 'gb');
  assert.ok(aldiUk.brands.includes('Cowbelle') && !aldiUk.brands.includes('Milsani'), 'Aldi UK is not Aldi Süd');
  assert.ok(hints.productSearchHint('aldi milch', 'de').brands.includes('Milsani'));
  assert.ok(hints.productSearchHint('lidl skyr', 'gb').brands.includes('Milbona'));
  assert.equal(hints.productSearchHint('m&s sandwich', 'gb').store, 'M&S');
  assert.equal(hints.productSearchHint("sainsbury's chicken", 'gb').store, 'Sainsbury’s'.replace('’', "'"));
  assert.ok(hints.productSearchHint('costco', 'us').brands.includes('Kirkland Signature'));
  assert.deepEqual(hints.productSearchHint('kirkland protein bar', 'us').brands, ['Kirkland Signature']);
  assert.equal(hints.productSearchHint('trader joes pretzels', 'us').store, "Trader Joe's");
  assert.ok(hints.productSearchHint('great value milk', 'us').brands.includes('Great Value'));
  assert.ok(hints.productSearchHint('chobani', 'us').brandQuery);
  assert.ok(hints.productSearchHint('heinz beans', 'gb').brandQuery);
  for (const plain of ['protein bar', 'milk', 'one banana', 'chicken breast', 'the best granola']) {
    assert.equal(hints.productSearchHint(plain, 'us').brandQuery, false, `us: ${plain}`);
    assert.equal(hints.productSearchHint(plain, 'gb').brandQuery, false, `gb: ${plain}`);
  }
  assert.deepEqual(hints.productSearchHint('lidl skyr'), hints.productSearchHint('lidl skyr', 'de'), 'without a region: Germany, as before');
  for (const market of ['de', 'gb', 'us']) {
    const owners = new Map();
    for (const [store, brands] of Object.entries(hints.STORE_BRANDS_BY_REGION[market])) for (const brand of brands) {
      assert.ok(!owners.has(brand), `${market}: ${brand} listed for ${owners.get(brand)} and ${store}`);
      owners.set(brand, store);
    }
  }
  assert.equal(hints.productsFirst('tesco', 4, 2, 'gb'), true);
  assert.equal(hints.productsFirst('tesco', 4, 2, 'de'), false);
});

await test('requests carry the region; Du offers the setting; Plan follows the region', () => {
  const client = read('src/services/mealAnalysis.ts');
  assert.match(client, /&scope=products&region=\$\{getMarketRegion\(\)\}/);
  assert.match(client, /\?language=\$\{getLanguage\(\)\}&region=\$\{getMarketRegion\(\)\}/);
  const scan = read('src/app/(tabs)/scan.tsx');
  assert.match(scan, /productSearchHint\(term, getMarketRegion\(\)\)/);
  assert.match(scan, /productsFirst\(typedQuery, searchResults\.length, productResults\.length, getMarketRegion\(\)\)/);
  const profile = read('src/app/(tabs)/profile.tsx');
  assert.match(profile, /<SectionTitle>\{t\.profile\.marketRegion\}<\/SectionTitle>\s*<MarketRegionPreference \/>/);
  const row = read('src/components/MarketRegionPreference.tsx');
  assert.match(row, /accessibilityRole="radio"/);
  assert.match(row, /accessibilityState=\{\{ checked: active \}\}/);
  assert.match(row, /\{ value: 'auto', label: copy\.marketRegionAuto/);
  assert.match(row, /MARKET_REGIONS\.map/);
  for (const language of ['de', 'en']) {
    const dictionary = read(`src/i18n/${language}.ts`);
    for (const key of ['marketRegion:', 'marketRegionDetail:', 'marketRegionAuto:', 'marketRegionAutoDetail:', 'marketRegionNames:', 'ctxMarketStores:']) {
      assert.ok(dictionary.includes(key), `${language}: ${key}`);
    }
    assert.match(dictionary, /ctxMarketStores: \{ de: 'Rewe, Lidl, Aldi', gb: 'Tesco, Sainsbury’s, Aldi', us: 'Walmart, Trader Joe’s, Target' \}/);
  }
  assert.match(read('src/i18n/de.ts'), /marketRegion: 'Land für Vorschläge'/);
  assert.match(read('src/i18n/de.ts'), /marketRegionAuto: 'Automatisch'/);
  const plan = read('src/app/(tabs)/plan.tsx');
  assert.match(plan, /const region = useMarketRegion\(\);/);
  assert.match(plan, /detail: t\.plan\.ctxMarketStores\[region\]/);
  assert.match(plan, /supermarketCombos\(remaining, profile\.preferences, marketData\.products\)/);
  assert.match(plan, /t\.plan\.marketAttribution\(formatDataDate\(marketData\.fetchedAt, locale\)\)/);
  const service = read('src/services/region.ts');
  assert.match(service, /export type MarketRegion = 'de' \| 'gb' \| 'us';/);
  assert.match(service, /export function useMarketRegion\(\): MarketRegion/);
  assert.match(service, /export function getMarketRegion\(\): MarketRegion/);
});

console.log(`Region: ${passed} checks passed.`);
