#!/usr/bin/env node
/**
 * "banane" used to return nothing at all, with a hint asking the user to
 * translate the word themselves. Two things fix that — a German food
 * vocabulary in front of USDA, and Open Food Facts for everything a reference
 * database will never carry — and both are easy to break silently.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gateway = readFileSync(new URL('../supabase/functions/nutrition/index.ts', import.meta.url), 'utf8');
const { GERMAN_FOOD_TERMS, translateGermanQuery } = await import('../supabase/functions/_shared/german-food-terms.mjs');

// --- The vocabulary ---------------------------------------------------------
assert.ok(Object.keys(GERMAN_FOOD_TERMS).length >= 300,
  'a vocabulary this short will miss what people actually type');

for (const [german, english] of Object.entries(GERMAN_FOOD_TERMS)) {
  assert.ok(/^[a-zäöüß]+$/.test(german), `"${german}" is not a lookup-shaped key`);
  assert.ok(/^[a-z][a-z ]*$/.test(english), `"${german}" maps to "${english}", which is not plain English`);
}

// --- Translation ------------------------------------------------------------
assert.equal(translateGermanQuery('banane'), 'banana');
assert.equal(translateGermanQuery('Banane'), 'banana', 'a capitalised word is the same word');
assert.equal(translateGermanQuery('hähnchenbrust gegrillt'), 'chicken breast grilled');
assert.equal(translateGermanQuery('magerquark'), 'quark cheese');
assert.equal(translateGermanQuery('vollkornbrot'), 'whole wheat bread');
assert.equal(translateGermanQuery('süßkartoffel'), 'sweet potato', 'umlauts and ß must survive the lookup');

// English and brand names must pass through untouched, not half-translated.
assert.equal(translateGermanQuery('chicken breast'), null);
assert.equal(translateGermanQuery('nutella'), null, 'a word that is the same in both languages needs no rewrite');
assert.equal(translateGermanQuery('haribo goldbären'), null, 'an unknown brand must reach the database as typed');
assert.equal(translateGermanQuery(''), null);
assert.equal(translateGermanQuery(null), null);

// A partly recognised phrase keeps the words it cannot translate.
assert.equal(translateGermanQuery('apfel strudel'), 'apple strudel');

// --- The gateway uses it in English, ranking included ------------------------
const usda = gateway.slice(gateway.indexOf('async function searchUsdaFoods'), gateway.indexOf('function localizedProductName'));
assert.match(usda, /const english = translateGermanQuery\(term\) \?\? term;/,
  'the USDA probe must run on the translated term');
assert.match(usda, /rankFoodMatches\(rows, english, \d+\)/,
  'ranking a German query against English descriptions scores two languages against each other');
assert.ok(!/searchTermVariants\(term\)/.test(usda),
  'the probe variants must be built from the English term, not the raw one');

// --- Open Food Facts --------------------------------------------------------
const off = gateway.slice(gateway.indexOf('async function searchOpenFoodFacts'), gateway.indexOf('async function usdaRows'));
assert.match(off, /search\.openfoodfacts\.org\/search/,
  'the classic search endpoint answers anonymous callers with a sign-in page');
assert.match(off, /User-Agent/, 'Open Food Facts throttles callers that do not identify themselves');
assert.match(off, /AbortSignal\.timeout\(/, 'a slow extra source must not hold up the whole search');
assert.match(off, /const per100g = offMassNutrition\(product\);[\s\S]*if \(!per100g\) continue;/,
  'a product without energy cannot be logged and must not be offered');
assert.match(off, /localizedProductName\(product, language\)/,
  'German search preserves an identifiable original product name when translation is absent');
assert.match(gateway, /if \(strict\) return '';/,
  'strict localized-name selection must omit products without the requested language');
assert.match(gateway, /try \{\s*for \(const product of await searchOpenFoodFacts\(\s*term,\s*language,\s*claimProvider \? \(\) => claimProvider\('off_search'\) : undefined,\s*market,\s*\)\)[\s\S]*catch \(error\) \{\s*noteFailure\(error\);/,
  'Open Food Facts going down must not fail the whole search, while quota denials are preserved as partial status or an explicit error');

// --- German-first Open Food Facts: products sold in Germany, German fields ----
// Region-aware since 1.0.6 (scripts/validate-products.mjs runs it): German
// readers without a region still search Germany on German fields.
assert.match(off, /const country = market \? MARKET_COUNTRY\[market\] : german \? MARKET_COUNTRY\.de : null;/, 'German readers must search products sold in Germany (or their region)');
assert.match(off, /const q = country \? `\$\{words\} countries_tags:"\$\{country\.tag\}"` : words;/);
assert.match(off, /const langs = german \? \(market && market !== 'de' \? 'de,en' : 'de'\)/, 'German readers must be matched on German product fields');
assert.match(off, /api\/v2\/search\?brands_tags=\$\{encodeURIComponent\(slug\)\}&countries_tags_en=\$\{country\.slug\}&lc=\$\{german \? 'de' : 'en'\}/, 'a brand query must reach the brand tag search for the market');
assert.match(off, /if \(country && out\.length < 3\)/, 'the brand search only runs when the text search found little');
assert.match(off, /if \(error instanceof ProviderQuotaError\) throw error;/, 'a quota denial in the brand probe must not be swallowed');
assert.match(off, /replace\(\/\["\(\):\\\[\\\]\{\}\^~\*\?\\\\\/!\+\]\/g, ' '\)/, 'query syntax characters must not reach the search engine');

// --- Shared synonym table ----------------------------------------------------
const { foodSynonym, applyFoodSynonyms, sameFoodWord, synonymKey } = await import('../supabase/functions/_shared/food-synonyms.mjs');
assert.equal(synonymKey('Hühnchen'), synonymKey('Huehnchen'));
assert.equal(foodSynonym('Hühnchen'), 'hahnchen');
assert.equal(foodSynonym('Jogurt'), 'joghurt');
assert.equal(foodSynonym('Topfen'), 'quark');
assert.equal(foodSynonym('Hüttenkäse'), 'korniger frischkase');
assert.equal(foodSynonym('chicken', 'de'), 'hahnchen');
assert.equal(foodSynonym('chicken', 'en'), null, 'English readers keep English words');
assert.equal(foodSynonym('yoghurt', 'en'), 'yogurt');
assert.equal(foodSynonym('Banane'), null, 'words the labels already use are not rewritten');
assert.equal(applyFoodSynonyms('huhnchen gegrillt', 'de'), 'hahnchen gegrillt');
assert.equal(applyFoodSynonyms('chicken breast', 'de'), 'hahnchen brustfilet', 'two-word compounds are rewritten together');
assert.ok(sameFoodWord('tomaten', 'tomate') && sameFoodWord('joghurts', 'joghurt') && sameFoodWord('bananen', 'banane'));
assert.ok(!sameFoodWord('brie', 'bries') && !sameFoodWord('eis', 'ei') && !sameFoodWord('tomate', 'tomaten'), 'plural tolerance only shortens what was typed, to at least four letters');

console.log(`German search: ${Object.keys(GERMAN_FOOD_TERMS).length} food terms translated, German synonym/plural table shared by app and gateway, Open Food Facts scoped to products sold in Germany with a brand-tag fallback.`);
