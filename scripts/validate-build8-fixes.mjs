import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildMealItem } from '../supabase/functions/_shared/nutrition.mjs';
import { searchBlsCatalog } from '../supabase/functions/_shared/bls-search.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const load = async (source) => {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
};
const portionSource = read('src/utils/portions.ts').replace(/^import[^;]+;$/gm, '')
  + '\n' + read('src/utils/ingredientCorrection.ts').replace(/^import[^;]+;$/gm, '');
const { initialSelection, resolveGrams, scaleNutrition } = await load(portionSource);
const app = read('src/context/AppContext.tsx');
const ast = ts.createSourceFile('app.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const scaleFunction = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'scaleItem');
assert.ok(scaleFunction);
const { scaleItem } = await load(`${portionSource}\nexport ${scaleFunction.getText(ast)}`);
const setterSource = app.slice(app.indexOf('  const setItemAmount ='), app.indexOf('  const setMealPortion ='));
const { setDecimalAmount } = await load(`${portionSource}\n${scaleFunction.getText(ast)}\nexport function setDecimalAmount(items, grams) { let result = items; const setMealPortionState = () => {}; const setPortionEstimated = () => {}; const setDetectedItems = (fn) => { result = fn(result); }; ${setterSource}\nsetItemAmount(items[0].id, grams); return result[0]; }`);

const facts = { calories: 201, protein: 6.3, carbs: 26.4, fat: 7.2, fiber: 1.3, provider: 'bls', referenceId: 'test' };
const detection = { name: 'Pfannkuchen', estimatedGrams: 240, pieceCount: 3, pieceLabel: 'Pfannkuchen', confidence: 'medium' };
const item = buildMealItem(detection, facts, 0);
const decimal = setDecimalAmount([item], resolveGrams('110,3'));
assert.equal(decimal.amountG, 110.3);
assert.equal(decimal.calories, Math.round(item.calories / item.amountG * 110.3));
assert.equal(initialSelection(decimal.amountG, [], { chosen: true }).amount, '110.3');
assert.equal(setDecimalAmount([decimal], NaN).amountG, 110.3);
assert.deepEqual(item.portions, [{ label: 'Pfannkuchen', grams: 80, estimated: true }]);
assert.deepEqual(initialSelection(item.amountG, item.portions, { chosen: true }), { unitIndex: 0, amount: '3' });
assert.equal(resolveGrams('5', item.portions[0]), 400);
assert.equal(scaleNutrition(facts, 400).calories, 804);
let corrected = item;
for (let i = 0; i < 50; i++) {
  corrected = scaleItem(corrected, 400);
  corrected = scaleItem(corrected, 80);
  corrected = scaleItem(corrected, 240);
}
for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber']) assert.equal(corrected[key], item[key], `${key}: correction round trip must not drift`);
// A rounded total (241 g / 3) must still re-open as 5 pieces after correction.
const uneven = { label: 'pancake', grams: 241 / 3, estimated: true };
assert.deepEqual(initialSelection(resolveGrams('5', uneven), [uneven], { chosen: true }), { unitIndex: 0, amount: '5' });
for (const pieceCount of [null, 0, -1, '3', Infinity, 100]) assert.equal(buildMealItem({ ...detection, pieceCount }, facts, 0).portions, undefined);
assert.equal(buildMealItem(detection, null, 0).included, false, 'pieces cannot manufacture verified nutrients');
assert.deepEqual(searchBlsCatalog('Pfannkuchen', 'de', 2).map((r) => r.code), ['X925012', 'X929212']);
assert.match(searchBlsCatalog('Pfannkuchen Spinat', 'de', 1)[0].nameDe, /Spinat/);

const { lightColors, darkColors } = await load(read('src/constants/theme.ts'));
const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
for (const palette of [lightColors, darkColors]) {
  for (const [fg, bg] of [['text', 'surface'], ['muted', 'surface'], ['muted', 'background'], ['onAccent', 'accent'], ['surface', 'text'], ['onDeep', 'accentDeep'], ['attentionText', 'surface'], ['attentionText', 'background'], ['attentionText', 'attentionSoft']]) {
    const a = luminance(palette[fg]), b = luminance(palette[bg]);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${fg}/${bg}: insufficient text contrast`);
  }
}
const theme = read('src/context/ThemeContext.tsx');
// First launch follows the system; a stored Hell/Dunkel choice from an older build is kept.
assert.match(theme, /useState<ThemePreference>\('system'\)/);
assert.match(theme, /useColorScheme\(\)/);
const { readThemePreference } = await load(theme.slice(theme.indexOf('export function readThemePreference'), theme.indexOf('const ThemeContext')));
assert.equal(readThemePreference(null), 'system');
assert.equal(readThemePreference('light'), 'light');
assert.equal(readThemePreference('dark'), 'dark');
assert.equal(readThemePreference('system'), 'system');
assert.equal(readThemePreference('sepia'), 'system');
const themeTokens = read('src/constants/theme.ts');
assert.doesNotMatch(themeTokens, /isDarkMode/, 'the Scan shadow must follow the active theme, not a constant');
assert.match(read('src/app/(tabs)/_layout.tsx'), /scanShadow\(mode\)/);
const sheet = read('src/components/PortionSheet.tsx');
assert.doesNotMatch(sheet, /\bautoFocus\b/);
assert.match(sheet, /keyboardShouldPersistTaps="handled"/);
assert.match(sheet, /onRequestClose=\{cancel\}/);
assert.match(sheet, /onPress=\{cancel\} style=\{styles.close\}/);
assert.doesNotMatch(sheet, /styles\.cancelText/, "one close action: the X top right, no second Cancel at the bottom");
const scan = read('src/app/(tabs)/scan.tsx');
const confirm = read('src/app/confirm.tsx');
assert.match(confirm, /if \(!canConfirm\) return;/);
assert.match(confirm, /disabled=\{!canConfirm\}/);
// The badge now has three states; an unresolved draft shows "Bitte prüfen" instead of nothing.
assert.match(confirm, /hasIncludedFood \? <ConfidenceBadge level=\{confidence\} \/>/);
const saveStart = app.slice(app.indexOf('const logScannedMeal = useCallback(async () => {') + 'const logScannedMeal = useCallback(async () => {'.length, app.indexOf('const existing = mealHistory.find', app.indexOf('const logScannedMeal =')));
const { canSaveMealDraft } = await load(read('src/utils/ingredientCorrection.ts').replace(/^import[^;]+;$/gm, ''));
const assertSaveable = new Function('canSaveMealDraft', 'getLocalDataGeneration', `return function(detectedItems, analysisStatus = "ready") { ${saveStart} };`)(canSaveMealDraft, () => 0);
assert.throws(() => assertSaveable([{ included: true }], 'idle'), /ready meal draft/);
assert.throws(() => assertSaveable([]), /empty meal/);
assert.throws(() => assertSaveable([{ included: false }]), /empty meal/);
assert.doesNotThrow(() => assertSaveable([item]));
assert.throws(() => assertSaveable([{ included: true }]), /incomplete meal/);
const resultScreen = read('src/app/result.tsx');
assert.match(resultScreen, /const dayIsDone = projected.calories < 200;/);
assert.match(resultScreen, /\{pastDay \? null : dayIsDone \? \([\s\S]*t.today.dayComplete[\s\S]*\) : <Card/);
assert.match(scan, /<PortionSheet\s+embedded/, 'search must not present a second sibling native modal');
assert.equal((scan.match(/<PortionSheet/g) ?? []).length, 1);
console.log('Build 8 regressions passed: counted portions, repeated correction, search ranking, theme contrast and dialog wiring. Native keyboard/touch checks still require an iPhone.');
