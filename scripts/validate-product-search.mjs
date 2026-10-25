#!/usr/bin/env node
/**
 * Owner finding (iPhone, 10/2026): "Donut" showed one BLS row with a lab-sheet
 * name and no real products, because the product search only ran when the
 * on-device catalogue had fewer than five hits. Store own-brands (Milbona,
 * Milsani, ja!, Gut & Günstig …) never appeared.
 *
 * This pins down:
 * - everyday names lead BLS rows ("Donut", "Magerquark"), official label kept;
 * - the product search runs on every query, local hit count notwithstanding;
 * - a store/brand query puts "Produkte & Marken" first and sends a brands hint;
 * - the client reads both the product route (ProductHit) and older rows.
 * Real modules, synthetic product fixtures, zero external HTTP.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

globalThis.fetch = async () => { throw new Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shared = name => import(new URL(`../supabase/functions/_shared/${name}`, import.meta.url));
const bls = await shared('bls-search-data.mjs');
const modules = { 'bls-search-data.mjs': bls, 'bls-reference.mjs': await shared('bls-reference.mjs'), 'bls-search.mjs': await shared('bls-search.mjs'), 'food-synonyms.mjs': await shared('food-synonyms.mjs') };
const transpile = (source, jsx = false) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
function load(path, deps = {}, source = null) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpile(source ?? read(path), path.endsWith('.tsx')))(id => {
    if (id.startsWith('../data/') && id.endsWith('.json')) return JSON.parse(read(`src/data/${id.slice(8)}`));
    const shortName = id.split('/').pop();
    if (id.includes('supabase/functions/_shared/') && modules[shortName]) return modules[shortName];
    assert.ok(id in deps, `Unmocked dependency ${id}`);
    return deps[id];
  }, module, module.exports);
  return module.exports;
}
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };

let language = 'de';
const portionLabels = new Proxy({}, { get: (_, key) => `label:${String(key)}` });
const suggest = load('src/services/foodSuggest.ts', { '@/i18n/active': { getLanguage: () => language, getDictionary: () => ({ scan: portionLabels }) } });
const rows = new Map(bls.BLS_SEARCH_ROWS.map(row => [row[0], row]));
const displayNames = JSON.parse(read('src/data/blsDisplayNames.json'));

await test('"donut" leads with the everyday Donut row; bakery words map to the right BLS codes', () => {
  const [donut] = suggest.suggestFoods('donut');
  assert.equal(donut.source.referenceId, 'D741600');
  assert.equal(donut.name, 'Donut');
  assert.equal(donut.officialName, 'Donut (Hefeteig) frittiert', 'the official BLS label stays visible');
  assert.equal(donut.source.label, 'BLS 4.0 D741600');
  const row = rows.get('D741600');
  assert.deepEqual([donut.per100g.calories, donut.per100g.protein, donut.per100g.carbs, donut.per100g.fat], row.slice(3, 7), 'values are the unchanged BLS row');
  for (const [query, code] of [['Donuts', 'D741600'], ['doughnut', 'D741600'], ['berliner', 'D7A6200'], ['krapfen', 'D7A6200'], ['kreppel', 'D7A6200'], ['muffin', 'D400400'], ['croissant', 'D771600']]) {
    assert.equal(suggest.suggestFoods(query)[0]?.source.referenceId, code, query);
  }
  assert.equal(suggest.suggestFoods('berliner')[0].name, 'Berliner / Krapfen mit Marmelade');
  language = 'en';
  try {
    const [english] = suggest.suggestFoods('donut');
    assert.equal(english.name, 'Donut');
    assert.equal(english.officialName, 'Doughnut (yeast dough) deep-fried');
  } finally { language = 'de'; }
});

await test('friendly names: every EVERYDAY code has one, every code is a real BLS row, names are short', () => {
  const source = read('src/services/foodSuggest.ts');
  const everyday = source.match(/const EVERYDAY[^=]*= \[([\s\S]*?)\];/)[1].match(/[A-Z0-9]{7}/g);
  assert.ok(everyday.length >= 80);
  for (const code of everyday) assert.ok(displayNames[code], `EVERYDAY ${code} (${rows.get(code)?.[1]}) has no everyday name`);
  assert.ok(Object.keys(displayNames).length >= 150, 'at least the ~150 most common foods');
  for (const [code, names] of Object.entries(displayNames)) {
    assert.ok(rows.has(code), `${code} is not in the BLS snapshot`);
    assert.ok(Array.isArray(names) && names.length === 2 && names.every(name => typeof name === 'string' && name.trim() && name.length <= 60), code);
  }
  // Every alias target the search uses also has an everyday name.
  for (const code of source.match(/RAW_ALIASES[\s\S]*?\n};/)[0].match(/'[A-Z][A-Z0-9]{6}'/g).map(code => code.slice(1, -1))) {
    assert.ok(displayNames[code], `alias target ${code} (${rows.get(code)?.[1]}) has no everyday name`);
  }
  const quark = suggest.suggestFoods('magerquark')[0];
  assert.equal(quark.name, 'Magerquark');
  assert.match(quark.officialName, /^Speisequark Magerstufe/);
  assert.equal(suggest.suggestFoods('cola')[0].name, 'Cola');
  assert.equal(suggest.suggestFoods('hüttenkäse')[0].name, 'Hüttenkäse');
});

const hints = load('src/services/productSearch.ts');
await test('store aliases send the store own-brands; brand queries put products first', () => {
  const lidl = hints.productSearchHint('lidl skyr');
  assert.equal(lidl.store, 'Lidl'); assert.ok(lidl.brandQuery);
  assert.ok(lidl.brands.includes('Milbona') && lidl.brands.includes('Pilos'));
  assert.ok(!lidl.brands.includes('Milsani'), 'Milsani is Aldi, not Lidl');
  const aldi = hints.productSearchHint('Aldi Süd Milch');
  assert.equal(aldi.store, 'Aldi'); assert.ok(aldi.brands.includes('Milsani') && !aldi.brands.includes('Milbona'));
  assert.deepEqual(hints.productSearchHint('milbona skyr').brands, ['Milbona']);
  assert.deepEqual(hints.productSearchHint('Gut & Günstig Donut').brands, ['Gut & Günstig']);
  assert.deepEqual(hints.productSearchHint('gut und günstig donut').brands, ['Gut & Günstig']);
  assert.deepEqual(hints.productSearchHint('ja! skyr').brands, ['ja!']);
  assert.deepEqual(hints.productSearchHint('rewe bio haferflocken').brands, ['REWE Bio'], 'the longer own-brand wins over the bare store');
  assert.ok(hints.productSearchHint('edeka').brands.includes('Gut & Günstig'));
  assert.ok(hints.productSearchHint('k-classic').brands.includes('K-Classic'));
  for (const plain of ['skyr', 'donut', 'jasmin reis', 'haferflocken', 'milch']) {
    assert.deepEqual(hints.productSearchHint(plain), { brandQuery: false, brands: [] }, plain);
  }
  const owners = new Map();
  for (const [store, brands] of Object.entries(hints.STORE_BRANDS)) for (const brand of brands) {
    assert.ok(!owners.has(brand), `${brand} listed for ${owners.get(brand)} and ${store}`);
    owners.set(brand, store);
  }
  assert.equal(hints.productsFirst('milbona skyr', 5, 3), true);
  assert.equal(hints.productsFirst('donut', 5, 3), false);
  assert.equal(hints.productsFirst('pinky', 0, 2), true, 'nothing generic: products lead');
});

// --- Client contract: request and both response shapes ----------------------
const raw = read('src/services/mealAnalysis.ts');
const clientJs = transpile(raw.replace(/^import[\s\S]*?from [^;]+;\n/gm, '') + '\nexport { gatewayFetch };');
const requests = [];
let reply = { ok: true, status: 200, body: { results: [] } };
const dictionary = { errors: { gatewayInvalidResponse: 'invalid', analysisFailed: 'failed', gatewayProviderError: 'provider', noConnection: 'offline' }, paywall: {}, labelScan: { portionServing: grams => `1 Portion (${grams} g)`, portionPackage: grams => `1 Packung (${grams} g)` } };
const bindings = {
  process: { env: { EXPO_PUBLIC_ANALYSIS_API_URL: 'http://127.0.0.1:8787' } },
  functionsBaseUrl: '', supabaseAnonKey: '', getAccessToken: async () => null, isSupabaseConfigured: false,
  getLocalDataGeneration: () => 0, getDictionary: () => dictionary, getLanguage: () => 'de', getLocale: () => 'de-DE',
  fetch: async (url) => { requests.push(url); return { ok: reply.ok, status: reply.status, headers: { get: () => null }, json: async () => reply.body }; },
  AbortController, setTimeout, clearTimeout,
};
const client = {};
new Function('exports', ...Object.keys(bindings), clientJs)(client, ...Object.values(bindings));
const hit = { code: '0000000000017', name: 'Pinky Donut', brand: 'Gut & Günstig', stores: ['Edeka'], packageG: 280, servingG: 70, per100g: { kcal: 400, protein: 5, carbs: 50, fat: 20, fiber: 1 }, source: 'productdb' };

await test('product search request: scope=products, brands hint only when present', async () => {
  requests.length = 0;
  await client.searchProducts('lidl skyr', { brands: hints.productSearchHint('lidl skyr').brands });
  const url = new URL(requests[0]);
  assert.equal(url.pathname, '/v1/search');
  assert.equal(url.searchParams.get('q'), 'lidl skyr');
  assert.equal(url.searchParams.get('language'), 'de');
  assert.equal(url.searchParams.get('scope'), 'products');
  assert.ok(url.searchParams.get('brands').split(',').includes('Milbona'));
  await client.searchProducts('skyr');
  assert.equal(new URL(requests[1]).searchParams.has('brands'), false);
  assert.equal((await client.searchProducts('a')).products.length, 0); assert.equal(requests.length, 2, 'one letter is never sent');
});

await test('product route shape (ProductHit) maps to a loggable branded result', async () => {
  reply = { ok: true, status: 200, body: { products: [hit, { ...hit, code: 'not-a-code' }, { ...hit, code: '0000000000024', per100g: { kcal: -1, protein: 0, carbs: 0, fat: 0 } }], searchStatus: 'complete' } };
  const { products, generic, searchStatus } = await client.searchProducts('pinky donut');
  assert.equal(searchStatus, 'complete'); assert.equal(generic.length, 0);
  assert.equal(products.length, 1, 'malformed rows are skipped, the valid one stays');
  const [product] = products;
  assert.equal(product.id, 'off-0000000000017');
  assert.equal(product.name, 'Pinky Donut (Gut & Günstig)', 'the logged name keeps the brand');
  assert.equal(product.productName, 'Pinky Donut'); assert.equal(product.brand, 'Gut & Günstig'); assert.equal(product.packageG, 280);
  assert.deepEqual(product.per100g, { calories: 400, protein: 5, carbs: 50, fat: 20, fiber: 1 });
  assert.equal(product.defaultGrams, 70);
  assert.deepEqual(product.portions, [{ label: '1 Portion (70 g)', grams: 70 }, { label: '1 Packung (280 g)', grams: 280 }]);
  assert.deepEqual(product.source, { provider: 'open-food-facts', referenceId: '0000000000017', label: 'Open Food Facts 0000000000017' });
  assert.equal(client.productHitToResult({ ...hit, servingG: null, packageG: null }).defaultGrams, 100);
  const escaped = client.productHitToResult({ ...hit, name: 'Oven &amp;amp; Airfryer', brand: '&quot;the Simpsons&quot;' });
  assert.equal(escaped.productName, 'Oven & Airfryer', 'HTML entities in product names are decoded, also when double-escaped');
  assert.equal(escaped.brand, '"the Simpsons"', 'HTML entities in brands are decoded');
});

await test('older gateway rows still work: generic and Open Food Facts rows are split, brand parsed', async () => {
  const blsRow = { id: 'bls-M710100', name: 'Skyr', per100g: { calories: 64, protein: 11, carbs: 4, fat: 0.2 }, defaultGrams: 100, source: { provider: 'bls', referenceId: 'M710100', label: 'BLS 4.0 M710100' } };
  const offRow = { id: 'off-0000000000031', name: 'Skyr Natur (Milbona)', per100g: { calories: 63, protein: 11, carbs: 4, fat: 0.2 }, defaultGrams: 100, portions: [], source: { provider: 'open-food-facts', referenceId: '0000000000031', label: 'Open Food Facts 0000000000031' } };
  reply = { ok: true, status: 200, body: { results: [blsRow, offRow, { id: 'bad' }], searchStatus: 'partial' } };
  const result = await client.searchProducts('skyr');
  assert.deepEqual(result.generic.map(row => row.id), ['bls-M710100']);
  assert.deepEqual(result.products.map(row => [row.id, row.productName, row.brand]), [['off-0000000000031', 'Skyr Natur', 'Milbona']]);
  assert.equal(result.searchStatus, 'partial');
  reply = { ok: false, status: 429, body: { code: 'provider_rate_limited' } };
  await assert.rejects(client.searchProducts('skyr'), error => error.kind === 'rate-limited');
  reply = { ok: true, status: 200, body: { products: 'nope' } };
  await assert.rejects(client.searchProducts('skyr'), error => error.kind === 'invalid-response');
});

// --- The mounted search sheet ------------------------------------------------
function searchScreen({ local, productReply }) {
  const slots = [], effects = [], calls = [], timers = [];
  let cursor = 0, dirty = true, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const hooks = {
    useMemo(fn) { return fn(); },
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
    },
    useRef(value) { const i = cursor++; return (slots[i] ??= { current: value }); },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const fnKeys = new Set(['allowanceLeft', 'sourceBadgeLabel', 'lastAmount', 'productPackage', 'manualCta', 'pickedHint', 'saveAs', 'removePicked', 'deleteCustom', 'searchCount']);
  const copy = new Proxy({}, { get: (_, key) => fnKeys.has(key) ? (...args) => `${String(key)}(${args.join(',')})` : String(key) });
  const colors = new Proxy({}, { get: () => '#fff' });
  const app = { descriptionInput: '', scanMode: 'demo', isCurrentScanLogged: false, scannedMeal: { id: 'initial' }, freeScansLeft: 3, hasEverLoggedScan: false, mealHistory: [], startDescriptionScan() {}, resetScan() {} };
  const jsx = (type, props) => ({ type, props });
  const rn = Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(key => [key, key]));
  const screen = load('src/app/(tabs)/scan.tsx', {
    '@/services/captureIntents': load('src/services/captureIntents.ts'),
    '@/hooks/useHardWall': { useFreeScanAllowance: () => ({ hardWall: false, allowance: 3 }) },
    '@/services/localRepository': { subscribePrivateDataInvalidation: () => () => {} },
    '@/components/CaptureSearchHelp': { CaptureSearchHelp: 'CaptureSearchHelp' },
    '@/components/ScanFavorites': { ScanFavoritesButton: 'ScanFavoritesButton', ScanFavoritesSheet: 'ScanFavoritesSheet' },
    '@/components/ManualFoodForm': { ManualFoodForm: 'ManualFoodForm' },
    '@/services/foodSuggest': { foodUsage: () => new Map(), mergeSuggestions: suggest.mergeSuggestions, recentFoods: () => [], frequentFoods: () => [], suggestFoods: () => local, foodSourceBadge: suggest.foodSourceBadge },
    '@/services/productSearch': hints,
    '@/services/customFoods': { customFoodResult: x => x, deleteCustomFood: async () => {}, isCustomFoodResult: () => false, matchCustomFoods: () => [] },
    '@/hooks/useCustomFoods': { useCustomFoods: () => [] },
    '@/components/QuickAddForm': { QuickAddForm: 'QuickAddForm', isQuickAddResult: () => false },
    '@/services/localDescription': { parseLocalDescription: () => null },
    '@/services/telemetry': { trackEvent() {}, durationBucket: () => 'fast' },
    '@/context/ThemeContext': { useTheme: () => ({ colors }), useThemedStyles: fn => fn(colors) },
    '@/constants/theme': { radii: { pill: 22 }, typeScale: { micro: 12, caption: 13, compact: 15, body: 17, heading: 22, title: 32, display: 56 } },
    '@expo/vector-icons/Ionicons': 'Icon',
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: false, canAskAgain: false }, async () => ({ granted: false })] },
    'expo-router': { useFocusEffect: fn => hooks.useEffect(() => fn(), [fn]), useLocalSearchParams: () => ({ mode: 'search' }), usePathname: () => '/scan', useRouter: () => ({ push() {}, replace() {} }) },
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@react-navigation/native': { useIsFocused: () => true },
    'react-native': { ...rn, Animated: { View: 'AnimatedView', Value: class { setValue() {} } }, Platform: { OS: 'ios' }, StyleSheet: { create: x => x, absoluteFill: {} },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, Alert: { alert() {} }, Linking: { openSettings() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/components/ui': { PrimaryButton: 'PrimaryButton' }, '@/components/PortionSheet': { PortionSheet: 'PortionSheet' }, '@/context/AppContext': { useApp: () => app },
    '@/components/VoiceInputButton': { VoiceInputButton: 'VoiceInputButton' }, '@/hooks/useKeyboardInset': { useKeyboardInset: () => 0 },
    'expo-image-manipulator': { manipulateAsync: async uri => ({ uri }), SaveFormat: { JPEG: 'jpeg' } }, '@/utils/cameraCrop': { frameToPhotoCrop: () => null },
    '@/services/mealAnalysis': { MealAnalysisError: class extends Error {}, deleteTemporaryPhoto() {}, searchProducts: async (query, options) => { calls.push([query, options]); return productReply(query); } },
    '@/context/SubscriptionContext': { useSubscription: () => ({ status: 'active' }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ language: 'de', locale: 'de-DE', t: { scan: copy, common: copy, errors: copy, today: copy } }) },
    '@/services/haptics': { primaryHaptic() {}, successHaptic() {} },
    '@/utils/format': { formatNumber: String, formatDayLabel: String, mealTypeLabel: String }, '@/hooks/useReducedMotion': { useReducedMotion: () => true },
    '@/utils/mealDay': { mealTypeForTime: () => 'Lunch' }, '@/utils/date': { localDateKey: () => '2026-10-12' },
  }).default;
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  function render() {
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
    try {
      dirty = true;
      for (let n = 0; dirty; n++) { assert.ok(n < 20, 'render did not settle'); dirty = false; cursor = 0; tree = screen(); while (effects.length) effects.shift()(); }
    } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; }
  }
  const nodes = (value = tree, out = []) => {
    if (Array.isArray(value)) value.forEach(x => nodes(x, out));
    else if (value && typeof value === 'object') { out.push(value); nodes(value.props?.children ?? null, out); }
    return out;
  };
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' ? value : '';
  render();
  return {
    calls, timers,
    async type(value) {
      const input = nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'searchTitle');
      assert.ok(input, 'search input');
      globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
      try { input.props.onChangeText(value); } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; }
      render();
    },
    async flush() {
      for (const timer of timers.splice(0)) timer.fn?.();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      render();
    },
    headers: () => nodes().filter(node => node.type === 'Text' && node.props.accessibilityRole === 'header').map(node => text(node)).filter(title => title.startsWith('section')),
    texts: () => nodes().filter(node => node.type === 'Text').map(node => text(node)),
    skeleton: () => nodes().some(node => node.props?.accessibilityLabel === 'productsSearching'),
  };
}
const blsResult = code => {
  const row = rows.get(code);
  return { id: `bls-${code}`, name: row[1], per100g: { calories: row[3], protein: row[4], carbs: row[5], fat: row[6] }, defaultGrams: 100, portions: [], source: { provider: 'bls', referenceId: code, label: `BLS 4.0 ${code}` } };
};
const sixLocal = ['M111300', 'M111200', 'M150000', 'C660000', 'H841100', 'H800000'].map(blsResult);

await test('mounted sheet: products are requested although the device already has ≥5 foods', async () => {
  const product = client.productHitToResult({ ...hit, code: '0000000000048', name: 'Frische Vollmilch', brand: 'Milsani', packageG: null, servingG: null });
  const h = searchScreen({ local: sixLocal, productReply: () => ({ generic: [], products: [product], searchStatus: 'complete' }) });
  await h.type('milch');
  assert.equal(h.calls.length, 0, 'debounced');
  assert.ok(h.skeleton(), 'the product section shows a loading state');
  assert.ok(h.timers.some(timer => timer.fn && timer.ms === 300), 'debounce is about 300 ms');
  await h.flush();
  assert.deepEqual(h.calls, [['milch', { brands: [] }]], 'the product search runs with six local hits');
  assert.deepEqual(h.headers(), ['sectionFoods', 'sectionProducts'], 'generic foods lead a generic word');
  assert.ok(h.texts().includes('Frische Vollmilch') && h.texts().includes('Milsani'), 'product name and brand line');
  assert.ok(!h.skeleton());
});

await test('mounted sheet: a brand/store query leads with products and sends the brands hint', async () => {
  const product = client.productHitToResult({ ...hit, code: '0000000000055', name: 'Skyr Natur', brand: 'Milbona' });
  const h = searchScreen({ local: [blsResult('M710100')], productReply: () => ({ generic: [], products: [product], searchStatus: 'complete' }) });
  await h.type('milbona skyr'); await h.flush();
  assert.deepEqual(h.calls, [['milbona skyr', { brands: ['Milbona'] }]]);
  assert.deepEqual(h.headers(), ['sectionProducts', 'sectionFoods']);
  await h.type('lidl skyr'); await h.flush();
  assert.ok(h.calls[1][1].brands.includes('Milbona') && !h.calls[1][1].brands.includes('Milsani'));
});

await test('mounted sheet: no product found offers the nutrition-label photo', async () => {
  const h = searchScreen({ local: [blsResult('D741600')], productReply: () => ({ generic: [], products: [], searchStatus: 'complete' }) });
  await h.type('donut'); await h.flush();
  assert.ok(h.texts().includes('productsEmpty'));
  assert.equal(h.texts().filter(value => value === 'labelScanCta').length, 1, 'the label scan is offered once');
});

const scan = read('src/app/(tabs)/scan.tsx');
const runFn = scan.slice(scan.indexOf('const runSearch'), scan.indexOf('const addSearchResult'));
assert.doesNotMatch(runFn, /\.length < 5|catalogueOnly/, 'the product search must not depend on how many local foods matched');
for (const file of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
  const dictionary = read(file);
  for (const key of ['sectionFoods', 'sectionProducts', 'productsSearching', 'productsEmpty', 'productsUnavailable', 'productPackage']) assert.ok(dictionary.includes(`${key}:`), `${file}: ${key}`);
}
assert.match(read('src/i18n/de.ts'), /sectionFoods: 'Lebensmittel', sectionProducts: 'Produkte & Marken'/);
console.log(JSON.stringify({ passed, scope: 'everyday BLS names, store/brand hints, product request/response contract, mounted search sheet sections; zero external HTTP' }));
