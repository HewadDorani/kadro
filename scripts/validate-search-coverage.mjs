#!/usr/bin/env node
/**
 * The catalogue answers most German queries without touching the network, and
 * that shortcut is what makes search fast and free. It is also what makes a
 * bad match expensive: "pho" prefix-matches the phosphate in a curing salt,
 * and returning that used to end the search before Open Food Facts was asked,
 * so three million products sat behind four letters that happened to line up.
 *
 * This pins down the difference between answering a question and starting with
 * the same letters, and that only the first kind may end the search.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { searchBlsCatalog } = await import('../supabase/functions/_shared/bls-search.mjs');
const gateway = readFileSync(new URL('../supabase/functions/nutrition/index.ts', import.meta.url), 'utf8');
const problems = [];

// --- Real foods must match strongly ----------------------------------------
const strongCases = [
  ['tofu', 'de'], ['falafel', 'de'], ['haferflocken', 'de'], ['döner', 'de'],
  ['currywurst', 'de'], ['sushi', 'de'], ['fischstäbchen', 'de'], ['lahmacun', 'de'],
  ['magerquark', 'de'], ['hähnchenbrust', 'de'], ['baklava', 'de'], ['hummus', 'de'],
  ['gyros', 'de'], ['guacamole', 'de'], ['burrito', 'de'], ['kefir', 'de'],
  ['chicken breast', 'en'], ['oats', 'en'], ['broccoli', 'en'],
];
for (const [query, language] of strongCases) {
  const hits = searchBlsCatalog(query, language, 5);
  if (!hits.length) { problems.push(`"${query}" finds nothing in the catalogue`); continue; }
  if (!hits.some((hit) => hit.strong)) {
    problems.push(`"${query}" only matches by prefix: ${hits[0][language === 'de' ? 'nameDe' : 'nameEn']}`);
  }
}

// --- German spellings, regional words and plurals lead to the plain food ----
// People type "Hühnchen", "Jogurt", "Topfen" or a plural; BLS labels say
// "Hähnchen", "Joghurt", "Quark" and the singular. Expected = top result.
const germanFirst = [
  ['hühnchen', /^V416/], ['huehnchen', /^V416/], ['hühnerbrust', /^V416/], ['hähnchenbrust', /^V416/], ['chicken', /^V416/],
  ['jogurt', /^M141[23]00$/], ['joghurts', /^M141[23]00$/], ['joghurt', /^M141[23]00$/],
  ['quark', /^M713100$/], ['magerquark', /^M713100$/], ['topfen', /^M713100$/],
  ['hüttenkäse', /^M711100$/], ['tomaten', /^G561100$/], ['bananen', /^F503100$/], ['äpfel', /^F110100$/],
  ['hackfleisch', /^U010100$/], ['hack', /^U010100$/], ['rinderhack', /^U010100$/], ['frischkäse', /^M710800$/],
  ['nudeln', /^E401(000|032)$/], ['putenbrust', /^V486100$/], ['erdäpfel', /^K1(10|20)1/], ['paradeiser', /^G561100$/],
];
for (const [query, code] of germanFirst) {
  const [top] = searchBlsCatalog(query, 'de', 5);
  if (!top) { problems.push(`"${query}" finds nothing`); continue; }
  if (!code.test(top.code)) problems.push(`"${query}" leads with ${top.code} ${top.nameDe}`);
  if (!top.strong) problems.push(`"${query}" is only a prefix match`);
}
// English stays English: the German rewrite table is not applied to English readers.
if (!/^V416/.test(searchBlsCatalog('chicken breast', 'en', 3)[0]?.code ?? '')) problems.push('"chicken breast" (en) lost the chicken breast');
if (!/^M141/.test(searchBlsCatalog('yoghurt', 'en', 3)[0]?.code ?? '')) problems.push('"yoghurt" (en) lost plain yogurt');
// A plural ending only ever shortens what was typed: the cheese leads "brie",
// never sweetbread ("Bries") through a reversed plural rule.
if (!/^M6016/.test(searchBlsCatalog('brie', 'de', 5)[0]?.code ?? '')) problems.push('"brie" no longer leads with Brie');

// --- A prefix coincidence must not claim to be an answer -------------------
{
  const hits = searchBlsCatalog('pho', 'de', 5);
  if (hits.some((hit) => hit.strong)) {
    problems.push('"pho" is treated as a real catalogue match, so the network is never asked');
  }
}

// --- Every returned row carries the flag ------------------------------------
for (const hit of searchBlsCatalog('reis', 'de', 5)) {
  assert.equal(typeof hit.strong, 'boolean', 'a catalogue row lost its match-strength flag');
}

// --- Only a real match may end the search -----------------------------------
assert.match(gateway, /const catalogueAnswered = catalogue\.some\(\(food\) => food\.strong\)/,
  'the gateway no longer distinguishes a real match from a prefix one');
assert.match(gateway, /if \(results\.length && catalogueAnswered\) \{/,
  'any catalogue hit ends the search again, however weak');
assert.doesNotMatch(gateway, /if \(results\.length\) \{\s*appendWeak/, 'any catalogue hit ends the search again, however weak');
// And a weak row must not sit above whatever the network found.
assert.match(gateway, /else weakRows\.push/, 'weak rows are mixed in with the real results again');
const appends = (gateway.match(/appendWeak\(\);/g) ?? []).length;
assert.ok(appends >= 2, `weak rows are appended on ${appends} of the return paths, expected every one`);

if (problems.length) {
  console.error('Search coverage check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Search coverage: ${strongCases.length} everyday and international dishes match the catalogue outright, ${germanFirst.length} German spellings/plurals/regional words lead with the plain food, and a prefix coincidence no longer ends the search.`);
