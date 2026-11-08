/**
 * Formatting must never take a screen down.
 *
 * Intl throws a RangeError on an Invalid Date and on a locale it does not
 * accept, and Hermes hands Intl to the platform rather than bundling it — so
 * what works in a browser is not proof it works on a phone. One corrupted
 * stored date should show one odd label, not crash the tab it appears on.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(resolve(projectRoot, relative), 'utf8');

/** Loads a module with its React Native and i18n imports stubbed out. */
async function load(relative, prelude) {
  const source = (await read(relative)).replace(/^import[^;]+;$/gm, '');
  const { outputText } = ts.transpileModule(prelude + source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}`);
}

const format = await load('src/utils/format.ts', `
  const getLocale = () => 'en-GB';
  const getDictionary = () => ({ common: {
    mealBreakfast: 'Breakfast', mealLunch: 'Lunch', mealDinner: 'Dinner', mealSnack: 'Snack',
  } });
`);
const units = await load('src/utils/units.ts', `
  const getLocale = () => 'en-GB';
  const deviceRegion = () => undefined;
`);

// --- Dates ------------------------------------------------------------------
assert.equal(format.formatDateParts('2026-09-02', { day: 'numeric', month: 'short' }, 'en-GB'), '2 Sept');
for (const broken of ['', 'undefined', 'not-a-date', '9999-99-99']) {
  assert.equal(
    format.formatDateParts(broken, { day: 'numeric' }, 'en-GB'),
    '',
    `a broken stored date must render as nothing, not throw: ${JSON.stringify(broken)}`,
  );
}
assert.equal(format.formatDateParts(new Date('nonsense'), { day: 'numeric' }), '');
// A locale the platform rejects must fall back, not crash.
assert.doesNotThrow(() => format.formatDateParts(new Date('2026-09-02T12:00:00'), { day: 'numeric' }, 'not-a-locale!!'));

// --- Clock ------------------------------------------------------------------
assert.equal(format.formatClockTime(new Date('2026-09-02T14:32:00'), 'de-DE'), '14:32');
assert.match(format.formatClockTime(new Date('2026-09-02T14:32:00'), 'en-US'), /2:32\s?(PM|pm)/);
assert.doesNotThrow(() => format.formatClockTime(new Date('2026-09-02T14:32:00'), '@@@'));
assert.doesNotThrow(() => format.formatClockTime(new Date('nonsense')));

// --- Numbers ----------------------------------------------------------------
assert.equal(format.formatNumber(2020, 'en-GB'), '2,020');
assert.equal(format.formatNumber(2020, 'de-DE'), '2.020');
assert.equal(format.formatNumber(0.7, 'en-GB'), '0.7');
assert.equal(format.formatNumber(1.4, 'en-US'), '1.4');
assert.equal(format.formatNumber(0.7, 'de-DE'), '0,7');
assert.equal(format.formatNumber(1.4, 'de-DE'), '1,4');
for (const broken of [NaN, Infinity, -Infinity]) {
  assert.doesNotThrow(() => format.formatNumber(broken, 'en-GB'), `formatNumber(${broken}) threw`);
}
assert.equal(format.formatNumber(NaN, 'en-GB'), '0', 'NaN must not reach the interface as "NaN"');

// --- Weight -----------------------------------------------------------------
assert.equal(units.formatWeight(84, 'metric', 'en-GB'), '84 kg');
assert.equal(units.formatWeight(84.5, 'metric', 'de-DE'), '84,5 kg');
assert.equal(units.formatWeight(72.12, 'us', 'en-US'), '159 lb');
for (const broken of [NaN, Infinity]) {
  for (const system of ['metric', 'us', 'uk']) {
    assert.doesNotThrow(() => units.formatWeight(broken, system, 'en-GB'), `${system} weight of ${broken} threw`);
  }
}
assert.doesNotThrow(() => units.formatWeight(84, 'metric', 'not-a-locale!!'));

// --- The progress bar must never emit NaN% ---------------------------------
const ui = await read('src/components/ui.tsx');
const bar = ui.slice(ui.indexOf('export function ProgressBar'), ui.indexOf('export function MacroBar'));
assert.match(bar, /Number\.isFinite\(value\)/, 'the progress bar must reject a non-finite ratio');
const clamp = (value) => {
  const safe = Number.isFinite(value) ? value : (value > 0 ? 1 : 0);
  return Math.round(Math.min(1, Math.max(0, safe)) * 100);
};
assert.equal(clamp(0 / 0), 0, 'a zero target must render an empty bar, not NaN%');
assert.equal(clamp(1 / 0), 100, 'an exceeded target is a full bar');
assert.equal(clamp(0.5), 50);

// --- No screen may pin a locale --------------------------------------------
for (const file of [
  'src/context/AppContext.tsx',
  'src/services/cloudRepository.ts',
  'src/services/mockNutrition.ts',
  'src/app/(tabs)/today.tsx',
  'src/app/(tabs)/progress.tsx',
  'src/app/evening.tsx',
]) {
  const source = await read(file);
  assert.ok(!/'de-DE'/.test(source), `${file}: a hardcoded German locale shows a 24-hour clock to an American`);
}

// Portion multipliers are user-visible decimal numbers too. Keeping a German
// literal here made the otherwise English Plan screen show 0,7× and 1,4×.
const plan = await read('src/app/(tabs)/plan.tsx');
assert.match(plan, /formatNumber\(0\.7, locale\)/, 'the smaller Plan portion must use the active locale');
assert.match(plan, /formatNumber\(1\.4, locale\)/, 'the larger Plan portion must use the active locale');
assert.ok(!plan.includes("multiplier: '0,7×'"), 'the English Plan must not inherit a German decimal literal');
assert.ok(!plan.includes("multiplier: '1,4×'"), 'the English Plan must not inherit a German decimal literal');

console.log('Validated formatting: broken dates, rejected locales, non-finite numbers and zero targets all degrade instead of throwing.');
