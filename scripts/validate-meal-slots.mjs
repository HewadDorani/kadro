#!/usr/bin/env node
/**
 * Today lists four meal slots, always all four, each with its own "+".
 *
 * Before this the day was a flat list and the app guessed the slot from the
 * clock, so a late breakfast was filed as dinner with no way to say otherwise.
 * The guess is still the fallback; what must not regress is that a stated slot
 * beats it, and that a stated slot does not leak into the next scan.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const problems = [];
const today = readFileSync(new URL('../src/app/(tabs)/today.tsx', import.meta.url), 'utf8');
const context = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const mealDay = readFileSync(new URL('../src/utils/mealDay.ts', import.meta.url), 'utf8');
const dictionaries = {
  de: readFileSync(new URL('../src/i18n/de.ts', import.meta.url), 'utf8'),
  en: readFileSync(new URL('../src/i18n/en.ts', import.meta.url), 'utf8'),
};

if (!/\['Breakfast', 'Lunch', 'Dinner', 'Snack'\] as const/.test(today)) {
  problems.push('today.tsx: the four slots are no longer rendered as a fixed set');
}
if (!/onPress=\{\(\) => startScan\(slot\.type\)\}/.test(today)) {
  problems.push('today.tsx: the per-slot add button does not pass its slot');
}
if (!/if \(slot\) setPlannedMealType\(slot\);/.test(today)) {
  problems.push('today.tsx: startScan does not record the chosen slot');
}
// resetScan clears the choice, so setting it first would be setting nothing.
const startScan = today.slice(today.indexOf('const startScan'), today.indexOf('const slots'));
if (startScan.indexOf('resetScan()') > startScan.indexOf('setPlannedMealType')) {
  problems.push('today.tsx: the slot is set before resetScan, which clears it again');
}
for (const [language, source] of Object.entries(dictionaries)) {
  if (!/addTo: \(slot: string\)/.test(source)) {
    problems.push(`${language}: the per-slot add button has no accessible label`);
  }
}

// A stated slot must win over the clock in both logging paths. The clock is
// the one shared daypart helper; no path keeps its own copy of the hours.
const daypart = readFileSync(new URL('../src/utils/daypart.ts', import.meta.url), 'utf8');
if (!/breakfastUntil: 11, lunchUntil: 15, dinnerUntil: 21/.test(daypart) || !/(?:consumePlannedMealType\(\)|target\?\.type \?\? plannedType) \?\? mealTypeForHour\(now\.getHours\(\)\)/.test(context)) {
  problems.push('AppContext: the clock fallback is gone, so an unstated slot has no answer');
}
for (const [file, source] of [['AppContext.tsx', context], ['mealDay.ts', mealDay]]) {
  if (/hour < 11 \?/.test(source)) problems.push(`${file}: duplicates the daypart clock instead of using src/utils/daypart.ts`);
}
// Back-dating: a slot tapped while Today shows an earlier day files the meal
// on that day; the choice is cleared with the slot and spent by the meal.
if (!/if \(!isToday\) setPlannedMealDate\(viewDay\);/.test(startScan)) {
  problems.push('today.tsx: logging from an earlier day does not carry that day to the meal');
}

const reset = context.slice(context.indexOf('const resetScan'), context.indexOf('const resetScan') + 900);
if (!/plannedMealTypeRef\.current = null;/.test(reset)) {
  problems.push('AppContext: resetScan leaves the old slot behind, so the next scan inherits it');
}
if (!/plannedMealDateRef\.current = null;/.test(reset)) {
  problems.push('AppContext: resetScan leaves the chosen day behind');
}
// The slot must be spent by the meal it was chosen for. Leaving it standing
// filed a dinner logged hours later under the breakfast someone had tapped
// and then abandoned.
if (!/const consumePlannedMealType = useCallback\(\(\) => \{[\s\S]{0,220}plannedMealTypeRef\.current = null;/.test(context)) {
  problems.push('AppContext: nothing clears the slot when it is used');
}
// A correction re-saves the same scan id after the choice has been spent, so
// the slot has to come from the meal already on file or the meal snaps back to
// whatever the clock says now — losing a stated slot and a manual correction
// alike.
if (!/consumePlannedMealType\(\) \?\? existing\?\.type/.test(context)) {
  problems.push('AppContext: a correction would move a meal out of its slot');
}

for (const [label, slice] of [
  ['logScannedMeal', context.slice(context.indexOf('const logScannedMeal'), context.indexOf('const logPlannedMeal'))],
  ['logPlannedMeal', context.slice(context.indexOf('const logPlannedMeal'), context.indexOf('const logRepeatMeal'))],
  ['logRepeatMeal', context.slice(context.indexOf('const logRepeatMeal'), context.indexOf('const deleteLoggedMeal'))],
]) {
  if (!/consumePlannedMealType\(\)/.test(slice)) {
    problems.push(`AppContext: ${label} reads the slot without spending it`);
  }
  if (!/consumePlannedMealDate\(\)/.test(slice)) {
    problems.push(`AppContext: ${label} leaves the chosen day standing for the next meal`);
  }
}

// Back-dating rules, executed against the real helper: never in the future,
// never older than 30 days, and an earlier day gets the slot's usual time on
// that day (eaten_at must fall on meal_date), while today keeps "now".
{
  const load = (path, deps) => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)((id) => deps[id], module, module.exports);
    return module.exports;
  };
  const day = load('src/utils/mealDay.ts', { '@/utils/date': load('src/utils/date.ts', {}), '@/utils/daypart': load('src/utils/daypart.ts', {}) });
  const now = new Date('2026-10-09T21:40:00');
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = day.mealMoment(null, 'Lunch', now);
  if (today.date !== '2026-10-09' || today.at !== now) problems.push('mealDay: today must keep the real time');
  const lunch = day.mealMoment('2026-10-08', 'Lunch', now);
  if (lunch.date !== '2026-10-08' || key(lunch.at) !== '2026-10-08' || lunch.at.getHours() !== 12) problems.push('mealDay: yesterday\'s lunch must be filed at lunchtime yesterday');
  if (day.mealMoment('2026-10-12', 'Dinner', now).date !== '2026-10-09') problems.push('mealDay: a future day must fall back to today');
  if (day.clampLogDate('2026-08-01', '2026-10-09') !== '2026-09-09') problems.push('mealDay: logging reaches back at most 30 days');
  if (day.shiftDateKey('2026-03-30', -1) !== '2026-03-29' || day.shiftDateKey('2026-01-01', -1) !== '2025-12-31') problems.push('mealDay: day arithmetic breaks over DST/new year');
  if (day.mealTypeForTime(new Date('2026-10-09T10:59:00')) !== 'Breakfast' || day.mealTypeForTime(new Date('2026-10-09T21:00:00')) !== 'Snack') problems.push('mealDay: the clock fallback changed');
}
// Only today's meals may enter `meals` (today's totals and the plan); a
// back-dated save goes to the history alone.
for (const label of ['logScannedMeal', 'logRepeatMeal', 'logFoodsDirect']) {
  const start = context.indexOf(`const ${label}`);
  const slice = context.slice(start, context.indexOf('useCallback', start + 40) + 2000);
  if (!/setMeals\(\(current\) => \[\.\.\.current\.filter\([^\n]*?\), \.\.\.\((\w+)\.date === (today|localDateKey\(now\)) \? \[\1\] : \[\]\)\]\)/.test(slice)) {
    problems.push(`AppContext: ${label} could put a back-dated meal into today's totals`);
  }
}
if (!/const dayMeals = useMemo\(\(\) => isToday \? meals : mealHistory\.filter\(\(meal\) => meal\.date === viewDay\)/.test(today)) {
  problems.push('today.tsx: the day switcher does not show the chosen day\'s meals');
}
if (!/t\.today\.logSlot\(mealTypeLabel\(slot\.type, t\.common\)\)/.test(today) || (today.match(/onPress=\{\(\) => startScan\(slot\.type\)\}/g) ?? []).length < 2) {
  problems.push('today.tsx: an empty slot has no "eintragen" row that opens the scan for it');
}

if (problems.length) {
  console.error('Meal-slot check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Meal slots: four on Today, each logging into itself, the clock only as fallback.');
