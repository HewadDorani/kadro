#!/usr/bin/env node
// The day-complete state is easy to regress: someone rearranges the Today card
// or the Plan results and the app starts recommending a fourth meal to a person
// who has already eaten their whole budget. These checks pin the guard down.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const problems = [];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const today = read('src/app/(tabs)/today.tsx');
const plan = read('src/app/(tabs)/plan.tsx');
const hook = read('src/hooks/useLocalDay.ts');
const emitted = ts.transpileModule(hook.replace(/^import .*;\n/gm, '').replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let currentDate = '2026-09-05', renderedDay, tick, onState, cleanup, removed = false, cleared = false;
const useLocalDay = new Function('useState', 'useEffect', 'AppState', 'localDateKey', 'setInterval', 'clearInterval', `${emitted}; return useLocalDay;`)(
  (initial) => { renderedDay = initial(); return [renderedDay, (next) => { renderedDay = next; }]; },
  (effect) => { cleanup = effect(); },
  { addEventListener: (_, callback) => { onState = callback; return { remove: () => { removed = true; } }; } },
  () => currentDate,
  (callback) => { tick = callback; return 42; },
  (id) => { cleared = id === 42; },
);
assert.equal(useLocalDay(), '2026-09-05');
currentDate = '2026-09-06'; tick(); assert.equal(renderedDay, currentDate);
currentDate = '2026-09-07'; onState('background'); assert.equal(renderedDay, '2026-09-06');
onState('active'); assert.equal(renderedDay, currentDate);
cleanup(); assert.ok(removed && cleared);
const progress = read('src/app/(tabs)/progress.tsx');
assert.match(progress, /\[currentDay, locale, mealHistory, targets\.protein\]/);
assert.match(progress, /weeklyLoggingGoal\(mealHistory\), \[currentDay, mealHistory\]/);
assert.doesNotMatch(progress, /flame-outline|daysTracked/, 'the streak flame is replaced by the weekly goal');
assert.match(read('src/context/AppContext.tsx'), /setMeals\(mealHistory\.filter\(\(meal\) => meal\.date === currentDay\)\)/);

// Reaching the target must remain visible without locking meal ideas away.
assert.match(today, /const dayIsDone = remaining\.calories < 200;/);
assert.match(today, /t.today.dayComplete/);
assert.match(today, /t.today.dayOver/);
assert.match(today, /label=\{t.plan.smallIdeas\}/);
assert.match(plan, /selected \? recommendMeals\(/);
assert.doesNotMatch(plan, /selected && !dayIsDone/);
assert.match(plan, /smallBudget \? \(/);
assert.match(plan, /t.plan.dayDoneText/);
// The overage line lives in the shared option card every situation renders.
assert.match(read('src/components/PlanOptionCard.tsx'), /t\.plan\.afterOver/);
assert.match(plan, /<PlanOptionCard[\s\S]*availableCalories/);
const result = read('src/app/result.tsx');
assert.match(result, /label=\{t.plan.smallIdeas\}/);

for (const dict of ['src/i18n/de.ts', 'src/i18n/en.ts']) {
  const source = read(dict);
  for (const key of ['dayComplete:', 'dayCompleteText:', 'dayOver:', 'dayOverText:', 'logAnyway:', 'dayDoneTitle:', 'dayDoneText:', 'backToToday:']) {
    if (!source.includes(key)) problems.push(`${dict}: missing ${key}`);
  }
}

if (problems.length) {
  console.error('Day-complete check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Daily target status stays visible; optional small meals remain reachable.');
