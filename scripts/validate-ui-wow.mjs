/**
 * The moments people share: the result "aha", the Story day card, the text
 * share, the time-scaled weight chart and the shared press feedback.
 *
 * Runs the real share and chart modules (transpiled, no native code) and pins
 * the privacy promise: the text share never carries a body measurement and
 * always tells people how to find the app; weight is off the card by default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cache = new Map();
let dictionary;
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/i18n/active') return { getLocale: () => 'en-GB', getDictionary: () => dictionary };
    if (id === '@/i18n') return { deviceRegion: () => 'DE' };
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`);
    throw Error(`Unexpected dependency: ${id}`);
  }, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}

const { de } = load('src/i18n/de.ts');
const { en } = load('src/i18n/en.ts');
dictionary = en;
const share = load('src/services/shareDay.ts');
const presentation = load('src/utils/progressPresentation.ts');
const failures = [];
const test = (name, fn) => { try { fn(); } catch (error) { failures.push(`${name}: ${error.message}`); } };

const input = {
  consumedCalories: 1380, targetCalories: 2200, consumedProtein: 84, targetProtein: 140,
  next: { calories: [450, 600], protein: [30, 40] }, slot: 'Dinner', weightChangeKg: -1.4, weightAllowed: true,
};
const weightWords = /\b(kg|lbs?|st|stone|weight|Gewicht|wiege|weigh)\b/i;

// --- 1. The text share ------------------------------------------------------
test('text share: exact German line, App Store hint, no weight', () => {
  const card = share.shareDayCard(input, { showProtein: true, showWeight: true });
  const deMessage = share.shareDayMessage(de.shareDay, card, (n) => n.toLocaleString('de-DE'));
  assert.equal(deMessage, 'Noch 820 kcal übrig und Kandro hat mir 3 Ideen gezeigt 👀 Kandro im App Store suchen');
  for (const [dict, tag] of [[de, 'de-DE'], [en, 'en-GB']]) {
    for (const consumed of [0, 1380, 2100, 2600]) {
      const model = share.shareDayCard({ ...input, consumedCalories: consumed }, { showProtein: true, showWeight: true });
      const message = share.shareDayMessage(dict.shareDay, model, (n) => n.toLocaleString(tag));
      assert.ok(message.endsWith(dict.shareDay.appStoreHint), `${tag}: the share must end with the App Store hint`);
      assert.match(message, /App Store/, `${tag}: the hint must name the App Store`);
      assert.doesNotMatch(message, weightWords, `${tag}: the text share must never mention weight: ${message}`);
      assert.ok(!message.includes('1,4') && !message.includes('1.4'), `${tag}: the weight change leaked into the text`);
    }
  }
  const done = share.shareDayCard({ ...input, consumedCalories: 2150 });
  assert.equal(done.dayDone, true);
  assert.equal(share.shareDayMessage(de.shareDay, done, String), `${de.shareDay.messageDone} ${de.shareDay.appStoreHint}`);
  assert.doesNotMatch(de.shareDay.messageDone + en.shareDay.messageDone, /drüber|over|zu viel|too much/i, 'a full day is never framed as a failure');
});

// --- 2. The card carries only what the person chose ------------------------
test('card: weight is off by default, teen-safe, and only a change', () => {
  assert.deepEqual(share.DEFAULT_SHARE_OPTIONS, { showProtein: true, showWeight: false });
  assert.equal(share.shareDayCard(input).weightChangeKg, null, 'weight must be hidden by default');
  assert.equal(share.shareDayCard(input, { showProtein: true, showWeight: true }).weightChangeKg, -1.4);
  assert.equal(share.shareDayCard({ ...input, weightAllowed: false }, { showProtein: true, showWeight: true }).weightChangeKg, null, 'no weight for teens');
  assert.equal(share.shareDayCard({ ...input, weightChangeKg: null }, { showProtein: true, showWeight: true }).weightChangeKg, null);
  assert.equal(share.shareDayCard(input, { showProtein: false, showWeight: false }).protein, null, 'protein can be switched off');
  assert.equal(share.shareDayCard({ ...input, consumedCalories: 2150 }).next, null, 'a complete day does not advertise a next meal');
  const cardSource = read('src/components/ShareDayCard.tsx');
  assert.doesNotMatch(cardSource, /weightKg|currentWeight|profile\./, 'the card must never read the absolute weight or the profile');
  const modal = read('src/components/ShareDayModal.tsx');
  assert.match(modal, /useState<ShareDayOptions>\(DEFAULT_SHARE_OPTIONS\)/, 'the Story view starts from the private defaults');
  assert.match(modal, /!isTeenProfile\(profile\)/, 'the weight switch is adults-only');
  assert.match(modal, /Share\.share\(\{\s*message: shareDayMessage\(/, 'the text share goes through the checked message builder');
  assert.match(modal, /t\.shareDay\.screenshotHint/, 'the Story view tells people to take a screenshot');
  assert.match(modal, /<StatusBar hidden=\{focus\} \/>/, 'focus mode hides the status bar for a clean screenshot');
  // Smallest card text: 16 units is still 12 pt on a 270 pt wide card.
  const sizes = [...cardSource.matchAll(/fontSize=\{(\d+|SMALL)\}/g)].map((m) => (m[1] === 'SMALL' ? 16 : Number(m[1])));
  assert.ok(sizes.length > 5 && Math.min(...sizes) >= 16, `card text below 16 units: ${Math.min(...sizes)}`);
  assert.match(cardSource, /SHARE_CARD_WIDTH = 360;[\s\S]*SHARE_CARD_HEIGHT = 640;/, 'the card is 9:16');
  for (const dict of [de, en]) assert.ok(dict.shareDay.appStoreHint.length <= 30, 'the App Store hint must fit one card line');
});

// --- 3. The next slot ------------------------------------------------------
test('next slot follows the day and never goes back in time', () => {
  assert.equal(share.nextMealSlot('Breakfast', 8), 'Lunch');
  assert.equal(share.nextMealSlot('Lunch', 13), 'Dinner');
  assert.equal(share.nextMealSlot('Dinner', 19), 'Snack');
  assert.equal(share.nextMealSlot('Breakfast', 18), 'Dinner', 'a late breakfast does not suggest lunch at 18:00');
  assert.equal(share.nextMealSlot('Snack', 9), 'Breakfast');
  assert.equal(share.nextMealSlot(null, 13), 'Lunch');
  assert.equal(share.latestMainSlot(['Lunch', 'Breakfast', 'Snack']), 'Lunch');
  assert.equal(share.latestMainSlot(['Snack']), null);
  assert.equal(de.shareDay.ideasFor('Dinner'), '3 Ideen fürs Abendessen');
});

// --- 4. Time-scaled weight chart ---------------------------------------------
test('weight chart x axis is time, not order', () => {
  const entries = [
    { date: '2026-09-01', weightKg: 80 }, { date: '2026-09-02', weightKg: 79.8 },
    { date: '2026-09-03', weightKg: 79.9 }, { date: '2026-09-30', weightKg: 79 },
  ];
  const { points, spanDays } = presentation.weightChartLayout(entries, 310, 150, { x: 10, y: 14 });
  assert.equal(spanDays, 29);
  assert.equal(points[0].x, 10); assert.equal(points.at(-1).x, 300);
  assert.ok(Math.abs((points[1].x - points[0].x) - 10) < 1e-9, 'one day is 1/29 of the width');
  assert.ok(points[3].x - points[2].x > 20 * (points[1].x - points[0].x), 'a 27-day gap must look like a gap');
  const flat = presentation.weightChartLayout([{ date: '2026-09-01', weightKg: 80 }, { date: '2026-09-08', weightKg: 80 }], 200, 100, { x: 0, y: 0 });
  assert.deepEqual(flat.points.map((p) => p.y), [50, 50], 'an unchanged trend is flat in the middle');
  // Across the DST switch the days stay whole.
  const dst = presentation.weightChartLayout([{ date: '2026-03-28', weightKg: 80 }, { date: '2026-03-29', weightKg: 80 }, { date: '2026-03-30', weightKg: 80 }], 200, 100, { x: 0, y: 0 });
  assert.deepEqual(dst.points.map((p) => p.x), [0, 100, 200]);
  const progress = read('src/app/(tabs)/progress.tsx');
  assert.match(progress, /weightChartLayout\(shown, width, WEIGHT_CHART_HEIGHT\)/, 'the screen must plot through the time-scaled layout');
  assert.doesNotMatch(progress, /barColumn|measurementSpacing/, 'the order-spaced bars are gone');
  assert.match(progress, /<WeekBars days=\{calorieWeek\} target=\{targets\.calories\} \/>/);
  assert.match(progress, /strokeDasharray="4 5"/, 'the weekly bars carry a goal line');
  assert.match(progress, /t\.progress\.proteinDays/);
  assert.match(progress, /<EmptyIllustration icon="analytics-outline"/, 'an empty chart gets the friendly illustration');
  assert.doesNotMatch(en.progress.timeScaled, /not scaled/i);
});

// --- 5. Result "aha" and press feedback ------------------------------------
test('result settles the ring once, with a success tick, and respects Reduce Motion', () => {
  const result = read('src/app/result.tsx');
  assert.match(result, /if \(landed\.current\) return;\s*landed\.current = true;/, 'the landing fires once');
  assert.match(result, /void successHaptic\(\);\s*if \(reduceMotionRef\.current\) return;/, 'Reduce Motion keeps the tick and skips the movement');
  assert.match(result, /reduceMotionRef\.current = reduceMotion;\s*if \(reduceMotion\) \{/);
  assert.match(result, /t\.shareDay\.ideasFor\(nextSlot\)/);
  assert.match(result, /const canShareDay = !pastDay && !demo;/, 'the example meal and back-dated meals are not shared as a day');
  const today = read('src/app/(tabs)/today.tsx');
  assert.match(today, /<ShareDayModal/);
  assert.match(today, /const canRefresh = syncMode !== 'local';/, 'pull to refresh only with a cloud copy to refresh');
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /export const PRESS_SCALE = 0\.98;/);
  assert.match(ui, /if \(haptic && !disabled\) void stepHaptic\(true\);/, 'the shared press is a light tick');
  assert.match(ui, /const motion = reduceMotion \? /, 'Reduce Motion swaps the scale for opacity');
  assert.match(ui, /<PressableScale\s+accessibilityRole="button"/, 'PrimaryButton uses the shared press');
  assert.match(read('src/app/(tabs)/_layout.tsx'), /tabPillActive/, 'the active tab is more than a colour change');
  assert.doesNotMatch(read('src/app/(tabs)/profile.tsx'), /name="infinite"/, 'Pro has a fair-use cap; no infinity glyph');
});

if (failures.length) {
  console.error('UI wow checks failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('UI wow: text share ends with the App Store hint and never mentions weight, the card hides weight by default, the next slot follows the day, the weight chart is time-scaled, and the result settles once with Reduce Motion respected.');
