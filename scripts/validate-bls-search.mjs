#!/usr/bin/env node
import {isSearchQuery} from '../supabase/functions/_shared/search-policy.mjs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { getBlsReferenceByCode, normalizeSearchTerm, isUsableSearchTerm } from '../server/core.mjs';
import { readFile } from 'node:fs/promises';

import {
  BLS_SEARCH_ROWS,
  BLS_SEARCH_WORKBOOK_SHA256,
} from '../supabase/functions/_shared/bls-search-data.mjs';
import { searchBlsCatalog } from '../supabase/functions/_shared/bls-search.mjs';

assert.equal(BLS_SEARCH_WORKBOOK_SHA256, '524bbefe25b691f5cb3de7a9f3e27fa2967aebfeabf217d99414ba7806e78c60');
assert.equal(BLS_SEARCH_ROWS.length, 7140, 'the full reviewed BLS 4.0 snapshot must stay complete');
assert.equal(new Set(BLS_SEARCH_ROWS.map((row) => row[0])).size, BLS_SEARCH_ROWS.length, 'BLS codes must be unique');

for (const [code, nameDe, nameEn, ...nutrition] of BLS_SEARCH_ROWS) {
  assert.match(code, /^[A-Z0-9]{7}$/, `${code}: invalid BLS code`);
  assert.ok(nameDe.trim() && nameEn.trim(), `${code}: both display languages are required`);
  assert.equal(nutrition.length, 5, `${code}: search rows need five nutrients`);
  assert.ok(nutrition.every((value) => Number.isFinite(value) && value >= 0), `${code}: invalid nutrition value`);
}

const byCode = new Map(BLS_SEARCH_ROWS.map((row) => [row[0], row]));
for (const [code, calories, protein] of [
  ['F503100', 79, 1.319],      // banana, raw
  ['X820162', 112, 2.535],     // rice, boiled
  ['Y921162', 199, 13.08],     // chicken doner
  ['X891133', 110, 10.2],      // nasi goreng
  ['Y693932', 221, 10.7],      // fish and chips
]) {
  const row = byCode.get(code);
  assert.ok(row, `${code}: sourced international spot check is missing`);
  assert.equal(row[3], calories, `${code}: calories drifted from BLS 4.0`);
  assert.equal(row[4], protein, `${code}: protein drifted from BLS 4.0`);
}

const leading = (query, language) => searchBlsCatalog(query, language, 1)[0];
for (const query of ['Kartoffelchips', 'potato chips', 'potato crisps']) {
  for (const language of ['de', 'en']) assert.equal(leading(query, language).code, 'K280100', `${query}: packaged chips are not fries or reduced-calorie chips`);
}
assert.equal(leading('French fries', 'en').code, 'X654042');
assert.equal(leading('Pommes frites', 'de').code, 'X654042');
assert.equal(leading('Kartoffelchips energiereduziert', 'de').code, 'K290100');
for (const [query, language] of [['Haferflocken', 'de'], ['oats', 'en'], ['rolled oats', 'en']]) {
  assert.deepEqual(searchBlsCatalog(query, language, 2).map(x=>x.code), ['C133000', 'C133032'], 'plain oats and cooked oats precede cookies/compound dishes');
}
for (const query of ['Banane', 'bananen', 'banana', 'bananas']) {
  assert.equal(leading(query, 'de').code, 'F503100', 'ordinary banana must lead in either language');
  assert.deepEqual(searchBlsCatalog(query, 'de', 2).map(x=>x.code), ['F503100', 'F503400'], 'plain banana variants precede mixed recipes');
}
assert.equal(leading('Banane getrocknet', 'de').code, 'F503400', 'an explicit preparation must override the default');
for (const [query, language, code, expectedName] of [
  ['Banane', 'de', 'F503100', 'Banane roh'],
  ['Haferflocken', 'de', 'C133000', 'Hafer Flocken'],
  ['banana', 'en', 'F503100', 'Banana raw'],
  ['Reis', 'de', 'X820162', 'Reis gekocht'],
  ['rice', 'en', 'X820162', 'Rice boiled'],
  ['Döner', 'de', 'Y921162', 'Döner Kebab'],
  ['doner', 'en', 'Y921162', 'Doner kebab'],
  ['lahmacun', 'en', 'Y9A1070', 'Lahmacun'],
  ['sushi', 'en', 'Y627112', 'Sushi with salmon'],
  ['nasi goreng', 'en', 'X891133', 'Nasi Goreng'],
  ['fish and chips', 'en', 'Y693932', 'Fish and chips'],
  ['porridge', 'en', 'X9A2100', 'Porridge unsweetened'],
  ['hamburger', 'en', 'Y911060', 'Hamburger'],
]) {
  const result = leading(query, language);
  assert.equal(result?.code, code, `${language}:${query} should lead with the everyday reference`);
  assert.match(language === 'de' ? result.nameDe : result.nameEn, new RegExp(expectedName, 'i'));
}

const gateway = await readFile(new URL('../supabase/functions/nutrition/index.ts', import.meta.url), 'utf8');
const searchFn = gateway.slice(gateway.indexOf('async function searchFoods'), gateway.indexOf('async function searchOpenFoodFacts'));
assert.match(searchFn, /searchBlsCatalog\(term, language, 60\)/, 'the gateway must use the complete bilingual catalogue');
// Still the same requirement — an everyday food must not cost a round trip —
// but a hit that merely starts with the same letters is not an everyday food.
// "pho" prefix-matches the phosphate in a curing salt, and letting that end
// the search hid every product Open Food Facts has behind four letters.
assert.match(searchFn, /if \(catalogueOnly\) \{\s*appendWeak\(\); return finish\(\)/,
  'the catalogue-only scope must finish without any further lookup');
// A real match may add the German product index (one database query, no
// provider, no quota) but must still finish without a provider round trip.
const answered = searchFn.slice(searchFn.indexOf('if (results.length && catalogueAnswered) {'), searchFn.indexOf("if (language === 'de')"));
assert.ok(answered.length > 50, 'could not locate the catalogue-answered branch');
assert.match(answered, /searchProductIndex\(admin, term, brands, PRODUCT_INDEX_AFTER_CATALOGUE\)/, 'packs on the shelf follow a real catalogue match');
assert.match(answered, /appendWeak\(\); return finish\(\)/, 'a real catalogue match must finish');
assert.doesNotMatch(answered, /claimProvider|searchOpenFoodFacts|searchUsdaFoods/,
  'a real catalogue match must finish without a provider round trip');
assert.match(searchFn, /const catalogueAnswered = catalogue\.some\(\(food\) => food\.strong\)/,
  'the gateway must tell a real match from a prefix coincidence');
assert.match(searchFn, /if \(language === 'de'\)/, 'German provider fallback must have its own localized path');
assert.ok(!/name: String\(entry\.description/.test(searchFn.slice(searchFn.indexOf("if (language === 'de')"), searchFn.indexOf('let foods'))), 'German results must never expose a raw USDA description');

const offFn = gateway.slice(gateway.indexOf('async function searchOpenFoodFacts'), gateway.indexOf('async function usdaRows'));
assert.match(offFn, /localizedProductName\(product, language\)/, 'Identifiable branded products retain original names when translation is absent');

const localGateway = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
assert.match(localGateway, /requestUrl\.pathname === '\/v1\/search'/, 'Expo Go local development needs the same search route');
assert.match(localGateway, /searchBlsCatalog\(term, language, 60\)/, 'local and hosted search must share the complete catalogue');
assert.match(localGateway, /localizedProductName\(product, language\)/, 'local barcode names must follow the reader language too');

console.log('Validated 7,140 bilingual BLS foods and everyday German, American, British, Turkish and Asian search cases.');

// Execute both shipped handlers. A broad query must expose alternatives beyond
// the old 15-row cutoff without changing the first results or their sources.
// The hosted search also consults the German product index; without a
// database client it answers null, exactly like an unapplied migration.
const compileSearch = (code) => new Function(
  'searchBlsCatalog', 'getBlsReferenceByCode', 'normalizeSearchTerm', 'isUsableSearchTerm', 'isSearchQuery',
  'searchProductIndex', 'productIndexResult', 'PRODUCT_INDEX_LIMIT', 'PRODUCT_INDEX_MIN_HITS', 'PRODUCT_INDEX_AFTER_CATALOGUE', 'PRODUCT_INDEX_AFTER_CATALOGUE_POSITION', 'publicProductHit',
  ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText + '; return searchFoods;',
)(searchBlsCatalog, getBlsReferenceByCode, normalizeSearchTerm, isUsableSearchTerm, isSearchQuery,
  async (admin) => { assert.equal(admin, undefined); return null; }, () => null, 20, 3, 8, 10, (hit) => hit);
const localSearch = compileSearch(localGateway.slice(localGateway.indexOf('function searchFoods'), localGateway.indexOf('function localizedProductName')));
const hostedSearch = compileSearch(searchFn);
for (const [query, language] of [['Brot', 'de'], ['Reis', 'de'], ['bread', 'en'], ['rice', 'en']]) {
  const local = await localSearch(query, language);
  const hosted = await hostedSearch(query, language, () => { throw new Error('A catalogue search must not call a provider'); });
  assert.equal(local.status, 200);
  assert.deepEqual(hosted.body.results, local.body.results, `${query}: hosted/local results differ`);
  const rows = hosted.body.results;
  assert.ok(rows.length > 15 && rows.length <= 60, `${query}: expected 16–60 results, got ${rows.length}`);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(rows.slice(0, 15).map(row => row.source.referenceId), searchBlsCatalog(query, language, 15).map(row => row.code));
  assert.ok(rows.every(row => row.source.provider === 'bls' && Number.isFinite(row.per100g.calories)));
  console.log(`${language}:${query}: ${rows.length} verified results, same leading 15 at either result limit, no provider call.`);
}

for (const language of ['de', 'en']) {
  for (const query of ['Brot', 'bread']) {
    assert.deepEqual(searchBlsCatalog(query, language, 3).map(row => row.code), ['B101000', 'B221000', 'B710500']);
  }
  for (const query of ['Milch', 'milk']) {
    assert.deepEqual(searchBlsCatalog(query, language, 3).map(row => row.code), ['M111200', 'M111300', 'M111100']);
  }
  for (const query of ['Joghurt', 'yogurt', 'yoghurt']) {
    assert.deepEqual(searchBlsCatalog(query, language, 2).map(row => row.code), ['M141300', 'M141200']);
  }
}
assert.equal(leading('milk chocolate', 'en').code, 'S530000');
assert.equal(leading('Vollkornbrot glutenfrei', 'de').code, 'B8A9000');
assert.equal(leading('bread crumbs', 'en').code, 'B821000');
assert.equal(leading('yogurt dip', 'en').code, 'X3A9010');
console.log('Bare bread/milk/yogurt queries lead with plain foods in both languages; explicit products remain specific.');

assert.deepEqual(searchBlsCatalog('constructor', 'en', 60), [], 'arbitrary queries must not resolve object prototype properties');
