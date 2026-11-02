#!/usr/bin/env node
/**
 * Portion entry is where a wrong number becomes a wrong day: "2" bananas that
 * silently means 2 g, or a comma that parses as nothing at all. These checks
 * pin down the arithmetic and the portion list the gateway hands the picker.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (await readFile(resolve(projectRoot, 'src/utils/portions.ts'), 'utf8'))
  .replace(/^import[^;]+;$/gm, '');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { initialSelection, resolveGrams, scaleNutrition } = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`
);
const { usdaPortions } = await import(resolve(projectRoot, 'supabase/functions/_shared/nutrition.mjs'));

const banana = { label: '1 banana', grams: 126 };

// --- Counting portions ------------------------------------------------------
assert.equal(resolveGrams('1', banana), 126);
assert.equal(resolveGrams('2', banana), 252);
assert.equal(resolveGrams('0.5', banana), 63);
// A German keyboard writes the same half portion with a comma.
assert.equal(resolveGrams('1,5', banana), 189, 'a comma decimal must count as a decimal');
assert.equal(resolveGrams('1.5', banana), 189);

// --- Plain grams ------------------------------------------------------------
assert.equal(resolveGrams('150'), 150);
assert.equal(resolveGrams('150,5'), 150.5);
assert.equal(resolveGrams('110.3'), 110.3);
assert.equal(resolveGrams('110,3'), 110.3);
assert.deepEqual(initialSelection(110.3, [], { chosen: true }), { unitIndex: -1, amount: '110.3' });

// --- Refusals ---------------------------------------------------------------
for (const bad of ['', ' ', '0', '-2', 'abc', '99999', '1e3', '0x10', '1,2.3']) {
  assert.equal(resolveGrams(bad), null, `"${bad}" must not become an amount`);
}
assert.equal(resolveGrams('100', banana), null, '100 bananas is past the ceiling, not a portion');

// --- Scaling ----------------------------------------------------------------
const per100 = { calories: 97, protein: 1.1, carbs: 23, fat: 0.3 };
assert.deepEqual(scaleNutrition(per100, 100), { calories: 97, protein: 1, carbs: 23, fat: 0 });
assert.deepEqual(scaleNutrition(per100, 252), { calories: 244, protein: 3, carbs: 58, fat: 1 });
assert.equal(scaleNutrition(per100, 0).calories, 0);

// --- What the gateway offers ------------------------------------------------
const measured = usdaPortions({
  foodMeasures: [
    { disseminationText: '1 cup, mashed', gramWeight: 225, rank: 1 },
    { disseminationText: '1 banana', gramWeight: 126, rank: 2 },
    { disseminationText: 'Quantity not specified', gramWeight: 126, rank: 3 },
    { disseminationText: '1 slice', gramWeight: 6, rank: 4 },
  ],
});
assert.deepEqual(measured, [{ label: '1 banana', grams: 126 }, { label: '1 slice', grams: 6 }],
  'cups and USDA placeholders are not portions a person recognises');

assert.deepEqual(
  usdaPortions({ servingSize: 52, servingSizeUnit: 'g', householdServingFullText: '1 CONTAINER' }),
  [{ label: '1 container', grams: 52 }],
  'branded household text must not shout');

assert.deepEqual(usdaPortions({}), []);
assert.deepEqual(usdaPortions(null), []);
assert.deepEqual(usdaPortions({ servingSize: 3, servingSizeUnit: 'IU', householdServingFullText: '1 pill' }), [],
  'a serving measured in something other than grams is not a weight');
assert.ok(usdaPortions({ foodMeasures: Array.from({ length: 9 }, (_, i) => ({ disseminationText: `1 piece ${i}`, gramWeight: 10 + i, rank: i })) }).length <= 4,
  'a picker with nine units is a picker nobody reads');

// --- Where the sheet opens for an amount that already exists ---------------
const chosen = { chosen: true };
// Picking a food from search: the friendly unit, not the database's 100 g.
assert.deepEqual(initialSelection(100, [banana]), { unitIndex: 0, amount: '1' },
  'a food with a household portion must not open in grams');
assert.deepEqual(initialSelection(100, []), { unitIndex: -1, amount: '100' });
// Re-opening an amount someone already set.
assert.deepEqual(initialSelection(252, [banana], chosen), { unitIndex: 0, amount: '2' },
  're-opening 252 g must say two bananas, not one');
assert.deepEqual(initialSelection(126, [banana], chosen), { unitIndex: 0, amount: '1' });
assert.deepEqual(initialSelection(63, [banana], chosen), { unitIndex: 0, amount: '0.5' });
assert.deepEqual(initialSelection(189, [banana], chosen), { unitIndex: 0, amount: '1.5' });
// Not a clean count: grams are the honest answer.
assert.deepEqual(initialSelection(200, [banana], chosen), { unitIndex: -1, amount: '200' });
assert.deepEqual(initialSelection(150, [], chosen), { unitIndex: -1, amount: '150' });
assert.deepEqual(initialSelection(0, [banana], chosen), { unitIndex: -1, amount: '100' });
assert.deepEqual(initialSelection(Number.NaN, [], chosen), { unitIndex: -1, amount: '100' });

// --- Portions must survive every hop to the amount sheet -------------------
/**
 * The amount sheet is only as good as the portions it is handed. Each of these
 * hops dropped them at some point: a search hit that offered "1 banana" became
 * an item that offered grams only, and the barcode path never asked Open Food
 * Facts for the pack's serving at all.
 */
// --- One piece of a packaged food --------------------------------------------
{
  const guessSource = (await readFile(resolve(projectRoot, 'src/utils/pieceGuess.ts'), 'utf8'));
  const compiled = ts.transpileModule(guessSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { guessPiece } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`);
  assert.deepEqual(guessPiece('Gouda jung in Scheiben (Ja!)'), { kind: 'slice', grams: 25 });
  assert.deepEqual(guessPiece('Knäckebrot Roggen'), { kind: 'slice', grams: 10 }, 'the narrower word wins over Brot');
  assert.deepEqual(guessPiece('Vollkornbrötchen'), { kind: 'piece', grams: 60 }, 'a roll is not a slice of bread');
  assert.equal(guessPiece('Skyr Natur'), null, 'a food without a natural piece stays in grams');
  assert.equal(guessPiece('Haferflocken'), null);
  const { offPiecePortion } = await import(resolve(projectRoot, 'supabase/functions/_shared/off-product.mjs'));
  const pack = (quantity, grams) => ({ quantity, product_quantity: grams, product_quantity_unit: 'g' });
  assert.deepEqual(offPiecePortion(pack('400 g (16 Scheiben)', 400)), { label: '1 Scheibe', grams: 25 });
  assert.deepEqual(offPiecePortion(pack('200g, 10 slices', 200), 'en'), { label: '1 slice', grams: 20 });
  assert.deepEqual(offPiecePortion(pack('6 x 50 g', 300)), { label: '1 Stück', grams: 50 });
  assert.equal(offPiecePortion(pack('400 g', 400)), null, 'no count on the pack means no piece');
  assert.equal(offPiecePortion(pack('1 Stück', 400)), null, 'one piece is the pack, not a portion');
  assert.equal(offPiecePortion({ quantity: '10 Stück' }), null, 'no pack weight, nothing to divide');
}

const readSource = (relative) => readFileSync(resolve(projectRoot, relative), 'utf8');
const hops = [
  ['supabase/functions/nutrition/index.ts', /portions: servingPortion\(product, language\)/, 'the barcode endpoint does not return the pack serving'],
  ['supabase/functions/nutrition/index.ts', /product\/\$\{code\}\.json\?fields=\$\{OFF_PRODUCT_FIELDS\}/, 'the barcode lookup does not ask for the shared field list'],
  ['supabase/functions/_shared/off-product.mjs', /serving_size,serving_quantity/, 'the barcode lookup does not ask for the serving fields'],
  ['supabase/functions/nutrition/index.ts', /portions: usdaPortions\(entry\)/, 'search results carry no household measures'],
  ['src/services/mealAnalysis.ts', /portions: payload\.portions/, 'a scanned barcode drops its portions'],
  ['src/services/mealAnalysis.ts', /portions: result\.portions/, 'a searched food drops its portions'],
  ['src/app/confirm.tsx', /portions: item\.portions/, 'the confirm screen opens the sheet without them'],
  ['src/app/(tabs)/scan.tsx', /portions: pendingFood\.portions/, 'the search sheet opens without them'],
];
for (const [file, pattern, message] of hops) {
  assert.match(readSource(file), pattern, `${file}: ${message}`);
}

console.log('Portion arithmetic and portion lists check out, and portions survive every hop to the sheet.');
