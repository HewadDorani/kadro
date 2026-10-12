import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/weeklyReview.ts', import.meta.url), 'utf8');
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: module.exports, require: id => { assert.equal(id, '@/utils/date'); return { localDateKey: (date = new Date()) => dateKey(date) }; }, Date, Map, Set });
const { weeklyReview, trialActivity } = module.exports;
const meal = (id, date, calories = 1800, protein = 100, rest = {}) => ({ id, date, calories, protein, origin: 'scan', savedAt: `${date}T12:00:00Z`, ...rest });
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`✓ ${name}`); };
check('Empty days are missing data; today and future do not enter completed weeks', () => {
  const s = weeklyReview([meal('today', '2026-10-04'), meal('future', '2026-10-05')], 1800, '2026-10-04');
  assert.equal(s.current.loggedDays, 0); assert.equal(s.current.averageCalories, null); assert.equal(s.proteinChangePercent, null);
  assert.equal(s.current.from, '2026-09-27'); assert.equal(s.current.to, '2026-10-03');
});
check('Same-day entries sum once; duplicates, demos and invalid data excluded', () => {
  const s = weeklyReview([meal('one', '2026-10-03', 600, 20), meal('two', '2026-10-03', 1200, 80), meal('one', '2026-10-03', 600, 20), meal('demo', '2026-10-02', 800, 15, { origin: 'seed' }), meal('broken', '2026-10-01', NaN), meal('bad-date', '2026-09-31')], 1800, '2026-10-04');
  assert.equal(s.current.loggedDays, 1); assert.equal(s.current.averageCalories, 1800); assert.equal(s.current.averageProtein, 100); assert.equal(s.current.daysNearCurrentTarget, 1);
});
check('Comparisons require three logged days in both periods, never zero-fill', () => {
  const current = ['01','02','03'].map(d => meal('c'+d, '2026-10-'+d, 1800, 120));
  const previous = ['23','24','25'].map(d => meal('p'+d, '2026-09-'+d, 1800, 100));
  assert.equal(weeklyReview([...current,...previous], 1800, '2026-10-04').proteinChangePercent, 20);
  assert.equal(weeklyReview([...current,...previous.slice(1)], 1800, '2026-10-04').proteinChangePercent, null);
  assert.equal(weeklyReview([...current,...previous.map(m => ({...m,protein:0}))], 1800, '2026-10-04').proteinChangePercent, null);
});
check('Protein percentage uses actual totals before final display rounding', () => {
  const current = [21,21,22].map((protein, i) => meal('c'+i, `2026-10-0${i+1}`, 400, protein));
  const previous = [20,20,20].map((protein, i) => meal('p'+i, `2026-09-${23+i}`, 400, protein));
  const review = weeklyReview([...current, ...previous], 1800, '2026-10-04');
  assert.equal(review.current.averageProtein, 21);
  assert.equal(review.previous.averageProtein, 20);
  assert.equal(review.proteinChangePercent, 7, '64/3 compared with 60/3 is +7%, not rounded 21/20 = +5%');
});
check('Local calendar windows cross DST/year boundaries without gaps', () => {
  const dst = weeklyReview([], 0, '2026-03-30'); assert.equal(dst.current.from, '2026-03-23'); assert.equal(dst.current.to, '2026-03-29');
  const year = weeklyReview([], 0, '2026-01-03'); assert.equal(year.current.from, '2025-12-27'); assert.equal(year.current.to, '2026-01-02');
  assert.equal(year.current.daysNearCurrentTarget, null); assert.throws(() => weeklyReview([], 1, '2026-02-30'));
});
check('Trial moment uses confirmed start and saved records, not installation age or old data', () => {
  const meals = [meal('before', '2026-10-01'), meal('first', '2026-10-02'), meal('second', '2026-10-03'), meal('third', '2026-10-04'), meal('unknown', '2026-10-02', 1000, 10, { savedAt: undefined })];
  assert.equal(trialActivity(meals, null, '2026-10-04'), null);
  assert.equal(trialActivity(meals, 'bad', '2026-10-04'), null);
  assert.equal(trialActivity(meals, '2026-10-02T09:00:00Z', '2026-10-04').loggedDays, 3);
  assert.equal(trialActivity(meals, '2026-10-02T09:00:00Z', '2026-10-04').averageCalories, 1800);
});

check('Actual trial card hides at expiry, on resume and for teens/non-trial Pro; timer cleans up', () => {
  let clock = Date.parse('2026-10-04T10:00:00Z');
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  let trial = { startedAt: '2026-10-01T10:00:00Z', expiresAt: '2026-10-04T10:01:00Z' }, age = 25, status = 'active';
  const states = [], effects = [], timers = new Map(); let stateIndex = 0, effectIndex = 0, timerId = 0, foreground;
  const jsx = (type, props) => ({ type, props });
  const copy = new Proxy({}, { get: (_t, key) => key === 'progress' ? () => key : key });
  const deps = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: {
      useState: initial => { const id = stateIndex++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial; return [states[id], value => { states[id] = typeof value === 'function' ? value(states[id]) : value; }]; },
      useEffect: (run, values) => { const id = effectIndex++; const key = JSON.stringify(values); if (effects[id]?.key !== key) { effects[id]?.cleanup?.(); effects[id] = { key, cleanup: run() }; } },
    },
    'react-native': { Text: 'Text', View: 'View', AppState: { addEventListener: (_name, listener) => { foreground = listener; return { remove: () => { if (foreground === listener) foreground = undefined; } }; } } },
    'expo-router': { useRouter: () => ({ push: () => {} }) },
    '@/components/ui': { Card: 'Card', PrimaryButton: 'Button' }, '@/components/ReminderPreferences': { ReminderPreferences: 'Reminders' },
    '@/context/AppContext': { useApp: () => ({ mealHistory: [], profile: { completedAt: 'present', age }, hydrationReady: true }) },
    '@/context/SubscriptionContext': { useSubscription: () => ({ snapshot: { currentTrial: trial }, status }) },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }) },
    '@/constants/theme': { typeScale: {} },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: { trialActivation: copy }, locale: 'de-DE' }) },
    '@/hooks/useLocalDay': { useLocalDay: () => '2026-10-04' }, '@/services/weeklyReview': { trialActivity },
  };
  const component = { exports: {} };
  const jsxSource = readFileSync(new URL('../src/components/TrialActivationCard.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(jsxSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports: component.exports, Date: ClockDate, require: id => { assert.ok(id in deps, id); return deps[id]; },
    setTimeout: (run, delay) => { const id = ++timerId; timers.set(id, { run, delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  const render = () => { stateIndex = 0; effectIndex = 0; return component.exports.TrialActivationCard(); };
  assert.notEqual(render(), null); assert.equal([...timers.values()][0].delay, 60_000);
  clock += 60_000; const callback = [...timers.values()][0].run; callback();
  assert.equal(render(), null, 'the already-open card disappears at real expiry without a midnight or server refresh');
  trial = { ...trial, expiresAt: '2026-10-04T10:05:00Z' }; assert.notEqual(render(), null);
  clock = Date.parse('2026-10-04T11:00:00Z'); foreground('active'); assert.equal(render(), null, 'resume cannot keep an expired trial card');
  trial = { ...trial, expiresAt: '2026-10-05T10:00:00Z' }; age = 17; assert.equal(render(), null);
  age = 25; trial = null; assert.equal(render(), null, 'active paid Pro is not a trial');
  trial = { startedAt: '2026-10-01T10:00:00Z', expiresAt: 'invalid' }; assert.equal(render(), null);
  trial.expiresAt = '2026-10-05T10:00:00Z'; status = 'pending'; assert.equal(render(), null);
  for (const effect of effects) effect.cleanup?.();
  assert.equal(timers.size, 0); assert.equal(foreground, undefined);
});
console.log(`Weekly review and trial activation: ${checks}/${checks} groups passed.`);
