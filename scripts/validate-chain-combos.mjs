#!/usr/bin/env node
/**
 * Plan → Unterwegs: real chains of the person's market.
 *
 * 1. Data (src/data/chains/<market>.json): every item cites its official
 *    source and check date, has plausible energy (Atwater), a unique id and
 *    the right market; home-market chains never leak into another market and
 *    no source URL is shared between markets; files stay small.
 * 2. Engine (services/chainCombos.ts): orders fit ≤ +10 % of the budget, honour
 *    every diet by the item's own tags (unknown = excluded), keep breakfast to
 *    the morning, come from three different chains where possible, only ever
 *    from the requested market, deterministically and fast.
 * 3. Wiring: Plan shows chain cards only when there are exactly three and
 *    falls back to the catalogue otherwise; the confirm draft logs exactly
 *    the card's numbers; notices name the sources and the trademarks.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    assert.ok(id.startsWith('@/'), `Unexpected dependency in ${path}: ${id}`);
    return load(`src/${id.slice(2)}${id.endsWith('.json') ? '' : '.ts'}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const problems = [];
const MARKETS = ['de', 'gb', 'us'];
const CATEGORIES = new Set(['burger', 'wrap', 'bowl', 'salad', 'sandwich', 'pizza', 'sushi', 'soup', 'side', 'drink', 'dessert', 'breakfast', 'coffee', 'snack', 'bakery']);
/**
 * Chains that exist in only one of the three markets: their data must never
 * appear in another market's file. (International chains such as McDonald's
 * appear in several files, each with that country's own publication.)
 */
const HOME_ONLY = {
  de: ['backwerk', 'dean-david', 'haus-des-doeners', 'nordsee', 'ditsch', 'kamps', 'lila-baecker'],
  gb: ['greggs', 'leon', 'itsu', 'wasabi', 'costa-coffee', 'pizza-express'],
  us: ['raising-canes', 'in-n-out', 'panera-bread', 'sweetgreen', 'jersey-mikes'],
};
const today = new Date().toISOString().slice(0, 10);

// --- 1. Data ------------------------------------------------------------------
const datasets = {};
const allIds = new Set();
const sourceMarket = new Map();
for (const market of MARKETS) {
  const path = `src/data/chains/${market}.json`;
  const size = statSync(resolve(root, path)).size;
  if (size > 200 * 1024) problems.push(`${path}: ${Math.round(size / 1024)} KB, keep it ≤ 200 KB`);
  const data = load(path);
  datasets[market] = data;
  if (data.market !== market) problems.push(`${path}: market is ${data.market}`);
  if (!/trademarks of their owners/.test(data.attribution) || !/not affiliated/.test(data.attribution)) problems.push(`${path}: attribution must name trademarks and non-affiliation`);
  const chainIds = new Set(data.chains.map((chain) => chain.id));
  if (chainIds.size !== data.chains.length) problems.push(`${market}: duplicate chain ids`);
  if (data.chains.length < 5) problems.push(`${market}: only ${data.chains.length} chains`);
  for (const [home, ids] of Object.entries(HOME_ONLY)) {
    if (home === market) continue;
    for (const id of ids) if (chainIds.has(id)) problems.push(`${market}: ${id} is a ${home.toUpperCase()} chain`);
  }
  for (const chain of data.chains) {
    if (!chain.name || !chain.sourceTitle || !chain.sources?.length || !chain.sources.every((url) => /^https:\/\//.test(url))) problems.push(`${market}/${chain.id}: chain needs a name, source title and https sources`);
    const count = data.items.filter((item) => item.chain === chain.id).length;
    if (count !== chain.items) problems.push(`${market}/${chain.id}: says ${chain.items} items, has ${count}`);
    if (count < 8) problems.push(`${market}/${chain.id}: only ${count} items`);
  }
  for (const item of data.items) {
    const where = `${market}/${item.id}`;
    if (allIds.has(item.id)) problems.push(`${where}: duplicate id`);
    allIds.add(item.id);
    if (item.market !== market || !item.id.startsWith(`${market}-${item.chain}-`)) problems.push(`${where}: wrong market or id prefix`);
    if (!chainIds.has(item.chain)) problems.push(`${where}: unknown chain ${item.chain}`);
    if (!CATEGORIES.has(item.category)) problems.push(`${where}: category ${item.category}`);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) problems.push(`${where}: name`);
    // The meal database accepts portion labels of 1–80 characters.
    if (typeof item.servingLabel !== 'string' || !item.servingLabel.trim() || item.servingLabel.length > 80) problems.push(`${where}: serving label`);
    if (item.servingG !== undefined && !(item.servingG >= 1 && item.servingG <= 2000)) problems.push(`${where}: servingG ${item.servingG}`);
    for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
      if (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0) problems.push(`${where}: ${key}`);
    }
    if (item.kcal > 2500) problems.push(`${where}: ${item.kcal} kcal is not one serving`);
    if (!/^https:\/\/[^\s]+$/.test(item.source ?? '')) problems.push(`${where}: no official https source`);
    if (/fatsecret|nutritionix\.com\/food|myfitnesspal|fastfoodnutrition|openfoodfacts|carbmanager|eatthismuch/i.test(item.source)) problems.push(`${where}: third-party source ${item.source}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.checked ?? '') || item.checked > today) problems.push(`${where}: checked date ${item.checked}`);
    const previous = sourceMarket.get(item.source);
    if (previous && previous !== market) problems.push(`${where}: source also used for ${previous}; every market needs its own publication`);
    sourceMarket.set(item.source, market);
    // Energy plausibility: EU labels exclude fibre from carbohydrate (2 kcal/g).
    const fiber = market === 'us' ? 0 : 2 * (item.fiber ?? 0);
    const atwater = 4 * item.protein + 4 * item.carbs + 9 * item.fat + fiber;
    if (Math.abs(atwater - item.kcal) > Math.max(20, item.kcal * 0.15)) problems.push(`${where}: ${item.kcal} kcal but macros give ${Math.round(atwater)}`);
    const tags = new Set(item.tags);
    if (tags.has('zero-kcal') && item.kcal > 5) problems.push(`${where}: zero-kcal with ${item.kcal} kcal`);
    if (tags.has('high-protein') !== (item.protein >= 20 && item.kcal > 0 && item.protein * 4 / item.kcal >= 0.25)) problems.push(`${where}: high-protein tag does not match the values`);
    if (tags.has('vegan') && !tags.has('vegetarian')) problems.push(`${where}: vegan without vegetarian`);
    if (tags.has('pork') && (tags.has('pork-free') || tags.has('vegetarian'))) problems.push(`${where}: contradictory pork tags`);
    if ((tags.has('chicken') || tags.has('beef') || tags.has('pork') || tags.has('fish')) && tags.has('vegetarian')) problems.push(`${where}: meat or fish tagged vegetarian`);
    if ((item.category === 'breakfast') !== tags.has('breakfast') && item.category === 'breakfast') problems.push(`${where}: breakfast category without tag`);
  }
  const ids = new Set(data.items.map((item) => item.id));
  for (const build of data.builds) {
    if (!build.id.startsWith(`${market}-${build.chain}-build-`) || !chainIds.has(build.chain)) problems.push(`${market}/${build.id}: build id or chain`);
    for (const id of build.components) {
      if (!ids.has(id)) problems.push(`${market}/${build.id}: component ${id} missing`);
      else if (!id.startsWith(`${market}-${build.chain}-`)) problems.push(`${market}/${build.id}: component ${id} from another chain`);
    }
  }
  // Every chain that publishes one offers a zero-kcal drink; the order may add it.
  const zeroChains = new Set(data.items.filter((item) => item.tags.includes('zero-kcal')).map((item) => item.chain));
  if (zeroChains.size < Math.ceil(data.chains.length / 2)) problems.push(`${market}: zero-kcal drinks for only ${zeroChains.size} chains`);
}

// --- 2. Engine ----------------------------------------------------------------
const { chainCombos, chainComboSearchEntries, orderCounts, CHAIN_DATA } = load('src/services/chainCombos.ts');
const { comboBudget } = load('src/services/supermarketCombos.ts');
const { DIET_PREFERENCES } = load('src/services/preferences.ts');
for (const market of MARKETS) assert.equal(CHAIN_DATA[market].market, market, `CHAIN_DATA.${market} is the ${market} file`);

/** Independent of the engine: what the item's own tags establish. */
const breaks = (item, diet) => {
  const tags = new Set(item.tags);
  if (diet === 'vegan') return !tags.has('vegan');
  if (diet === 'vegetarian') return !(tags.has('vegetarian') || tags.has('vegan'));
  if (diet === 'pork-free') return !(tags.has('pork-free') || tags.has('vegetarian') || tags.has('vegan'));
  if (diet === 'lactose-free') return !(tags.has('lactose-free') || tags.has('vegan'));
  return false;
};
const subsets = [];
for (let mask = 0; mask < 16; mask += 1) subsets.push(DIET_PREFERENCES.filter((_, index) => mask & (1 << index)));
const goals = [[], ['high-protein'], ['low-carb']];
const budgets = [2400, 1400, 900, 650, 400, 150, -300];
const hours = [7, 10, 12, 15, 19, 23];
let cases = 0;
let threeChains = 0;
let threeTotal = 0;
for (const market of MARKETS) {
  const data = datasets[market];
  const chainNames = new Set(data.chains.map((chain) => chain.id));
  for (const calories of budgets) {
    const remaining = { calories, protein: 80, carbs: 150, fat: 45 };
    const budget = comboBudget(remaining);
    for (const hour of hours) {
      for (const diets of subsets) {
        for (const goal of goals) {
          const preferences = [...diets, ...goal];
          const combos = chainCombos(remaining, { market, hour, preferences });
          cases += 1;
          const label = `${market} ${calories} kcal ${hour}h [${preferences}]`;
          if (combos.length > 3) problems.push(`${label}: ${combos.length} orders`);
          if (new Set(combos.map((combo) => combo.id)).size !== combos.length) problems.push(`${label}: duplicate orders`);
          const mains = combos.map((combo) => combo.title + combo.chain.id);
          if (new Set(mains).size !== mains.length) problems.push(`${label}: the same main twice`);
          for (const combo of combos) {
            if (!chainNames.has(combo.chain.id)) problems.push(`${label}: chain ${combo.chain.id} is not in ${market}`);
            if (combo.calories > budget.max) problems.push(`${label}: ${combo.calories} kcal over ${budget.max}`);
            const total = combo.items.reduce((sum, entry) => sum + entry.calories, 0);
            if (total !== combo.calories) problems.push(`${label}: total ${combo.calories} ≠ items ${total}`);
            for (const entry of combo.items) {
              const { item } = entry;
              if (item.market !== market || item.chain !== combo.chain.id) problems.push(`${label}: ${item.id} from another market or chain`);
              if (entry.calories !== Math.round(item.kcal * entry.count)) problems.push(`${label}: ${item.id} values changed`);
              if (item.category === 'dessert') problems.push(`${label}: dessert ${item.id} offered`);
              if (hour >= 11 && (item.category === 'breakfast' || item.tags.includes('breakfast'))) problems.push(`${label}: breakfast item ${item.id} after 11`);
              if (!orderCounts(item).includes(entry.count)) problems.push(`${label}: ${entry.count} × ${item.id}`);
              for (const diet of diets) if (breaks(item, diet)) problems.push(`${label}: ${item.name} breaks ${diet}`);
            }
            const drinks = combo.items.filter((entry) => entry.item.category === 'drink' || entry.item.category === 'coffee');
            if (drinks.length > 1) problems.push(`${label}: ${drinks.length} drinks in one order`);
          }
          if (combos.length === 3 && !diets.length) {
            threeTotal += 1;
            if (new Set(combos.map((combo) => combo.chain.id)).size === 3) threeChains += 1;
          }
        }
      }
    }
    // A normal day without diets always fills three orders from three chains.
    for (const hour of [8, 13, 19]) {
      const combos = chainCombos(remaining, { market, hour, preferences: [] });
      if (calories >= 400 && (combos.length !== 3 || new Set(combos.map((combo) => combo.chain.id)).size !== 3)) {
        problems.push(`${market} ${calories} kcal ${hour}h: ${combos.length} orders from ${new Set(combos.map((combo) => combo.chain.id)).size} chains`);
      }
    }
  }

  // The headline promise: "Noch 650 kcal → Subway … → 410 kcal · 30 g Protein".
  const lunch = chainCombos({ calories: 650, protein: 60, carbs: 90, fat: 30 }, { market, hour: 13, preferences: [] });
  if (!lunch.some((combo) => combo.protein >= 25)) problems.push(`${market}: no protein-rich order for 650 kcal at lunch`);
  // Breakfast shows up in the morning where the market has it.
  const morning = [450, 650].flatMap((calories) => chainCombos({ calories, protein: 60, carbs: 90, fat: 30 }, { market, hour: 8, preferences: [] }));
  if (data.items.some((item) => item.tags.includes('breakfast')) && !morning.some((combo) => combo.items.some((entry) => entry.item.tags.includes('breakfast')))) {
    problems.push(`${market}: no breakfast item among the morning orders`);
  }
  // High protein moves the set to more protein.
  const plain = budgets.slice(0, 4).flatMap((calories) => chainCombos({ calories, protein: 90, carbs: 150, fat: 50 }, { market, hour: 13, preferences: [] }));
  const protein = budgets.slice(0, 4).flatMap((calories) => chainCombos({ calories, protein: 90, carbs: 150, fat: 50 }, { market, hour: 13, preferences: ['high-protein'] }));
  const average = (list) => list.reduce((sum, combo) => sum + combo.protein, 0) / Math.max(1, list.length);
  if (average(protein) < average(plain)) problems.push(`${market}: "high-protein" lowers protein`);

  // Region isolation: another market's data is never used for this market.
  const other = datasets[MARKETS[(MARKETS.indexOf(market) + 1) % 3]];
  assert.deepEqual(chainCombos({ calories: 900, protein: 60, carbs: 100, fat: 30 }, { market, hour: 13, data: other }), [], `${market}: refuses another market's data`);

  // Determinism, also against the order of the data.
  const remaining = { calories: 1100, protein: 70, carbs: 130, fat: 40 };
  const first = JSON.stringify(chainCombos(remaining, { market, hour: 13, preferences: ['high-protein'] }));
  const again = JSON.stringify(chainCombos(remaining, { market, hour: 13, preferences: ['high-protein'] }));
  const shuffled = { ...data, chains: [...data.chains].reverse(), items: [...data.items].reverse(), builds: [...data.builds].reverse() };
  const reordered = JSON.stringify(chainCombos(remaining, { market, hour: 13, preferences: ['high-protein'], data: shuffled }));
  if (first !== again || first !== reordered) problems.push(`${market}: orders are not deterministic`);

  // Speed: a warm call stays well under a frame.
  const started = performance.now();
  for (let run = 0; run < 30; run += 1) chainCombos({ calories: 600 + run * 20, protein: 70, carbs: 130, fat: 40 }, { market, hour: 12 + (run % 8), preferences: run % 2 ? ['vegetarian'] : ['high-protein'] });
  const perCall = (performance.now() - started) / 30;
  if (perCall >= 20) problems.push(`${market}: ${perCall.toFixed(1)} ms per call`);

  // The confirm draft logs exactly what the card shows.
  for (const combo of chainCombos({ calories: 1000, protein: 70, carbs: 130, fat: 40 }, { market, hour: 13, preferences: [] })) {
    const entries = chainComboSearchEntries(combo, (chain) => `${chain.name} · test`);
    assert.equal(entries.length, combo.items.length);
    entries.forEach(({ result, grams }, index) => {
      const entry = combo.items[index];
      const scale = grams / 100;
      for (const [key, value] of [['calories', entry.calories], ['protein', entry.protein], ['carbs', entry.carbs], ['fat', entry.fat]]) {
        if (Math.round(result.per100g[key] * scale) !== value) problems.push(`${market}: ${entry.item.id} logs ${key} ${Math.round(result.per100g[key] * scale)} instead of ${value}`);
      }
      const portion = result.portions[0];
      if (Boolean(portion.unitOnly) === Boolean(entry.item.servingG)) problems.push(`${market}: ${entry.item.id} unitOnly must mean "no published weight"`);
      if (result.source.provider !== 'kandro-catalog' || result.source.referenceId !== `chain:${entry.item.id}`) problems.push(`${market}: ${entry.item.id} source reference`);
      if (grams < 1 || grams > 5000) problems.push(`${market}: ${entry.item.id} grams ${grams}`);
    });
  }
}
if (threeTotal && threeChains / threeTotal < 0.9) problems.push(`only ${threeChains}/${threeTotal} sets come from three different chains`);

// --- 3. Wiring ----------------------------------------------------------------
const plan = read('src/app/(tabs)/plan.tsx');
if (!/chainCombos\(remaining, \{ market: region, hour: new Date\(\)\.getHours\(\), preferences: profile\.preferences \}\)/.test(plan)) problems.push('Plan does not ask for chain orders by region, hour and preferences');
if (!/const chainMode = selected === 'eating-out' && orders\.length === 3;/.test(plan)) problems.push('Plan must fall back to the catalogue unless there are exactly three chain orders');
if (!/<ChainComboCard\b/.test(plan) || !/startPlannedDraft\(chainComboSearchEntries\(/.test(plan)) problems.push('Plan does not render ChainComboCard or open the confirm draft');
if (!/useMarketRegion\(\)/.test(plan)) problems.push('Plan does not follow the market region');
const card = read('src/components/ChainComboCard.tsx');
if (!card.includes("from '@/components/PlanOptionCard'") || !/t\.plan\.chainSource\(/.test(card) || !/title: combo\.chain\.name/.test(card)) problems.push('ChainComboCard: shared card, chain name as title, source line');
if (!read('src/services/chainCombos.ts').includes("from '@/services/preferences'")) problems.push('chainCombos must use the shared preference mapping');
for (const [name, dictionary] of [['de', read('src/i18n/de.ts')], ['en', read('src/i18n/en.ts')]]) {
  for (const key of ['chainTake', 'chainSource', 'chainSourceLabel', 'chainNote']) if (!dictionary.includes(`${key}:`)) problems.push(`${name}: plan.${key} missing`);
}
// The Unterwegs subtitle names chains of the chosen market only, so a country switch is visible before tapping.
if (!/detail: t\.plan\.ctxOutChains\[region\]/.test(read('src/app/(tabs)/plan.tsx'))) problems.push('plan.tsx: Unterwegs subtitle must follow the market (ctxOutChains[region])');
for (const [name, dictionary] of [['de', read('src/i18n/de.ts')], ['en', read('src/i18n/en.ts')]]) {
  const line = dictionary.match(/ctxOutChains: \{ de: '([^']+)', gb: '([^']+)', us: '([^']+)' \}/);
  if (!line) { problems.push(`${name}: plan.ctxOutChains missing`); continue; }
  MARKETS.forEach((market, index) => {
    const known = new Set(datasets[market].chains.map((chain) => chain.name.replace(/[’']/g, "'").toLowerCase()));
    for (const chain of line[index + 1].split(', ')) {
      const key = chain.replace(/[’']/g, "'").toLowerCase();
      if (![...known].some((value) => value === key || value.startsWith(key + ' '))) problems.push(`${name}: ctxOutChains.${market} names ${chain}, which is not in src/data/chains/${market}.json`);
    }
  });
}
const notices = read('THIRD_PARTY_NOTICES.md');
if (!/src\/data\/chains/.test(notices) || !/not affiliated/i.test(notices)) problems.push('THIRD_PARTY_NOTICES.md must describe the chain nutrition data and non-affiliation');

if (problems.length) {
  console.error('Chain orders check failed:');
  for (const problem of [...new Set(problems)].slice(0, 80)) console.error(`  - ${problem}`);
  process.exit(1);
}
const counts = MARKETS.map((market) => `${market.toUpperCase()} ${datasets[market].chains.length} chains/${datasets[market].items.length} items`).join(', ');
console.log(`Chain orders: ${counts}; ${cases} budget/hour/preference cases fit the budget, honour every diet, stay in their market and are deterministic; ${threeChains}/${threeTotal} full sets come from three chains.`);
