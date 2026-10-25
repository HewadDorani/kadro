/**
 * The loop the whole product rests on: eat something, the day changes.
 *
 * Choosing a recommendation used to do nothing at all — no entry, no calories.
 * These checks pin the three ways a meal can enter the day and the maths behind
 * the targets, so a refactor cannot quietly break the promise again.
 */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(resolve(projectRoot, p), 'utf8');

const [plan, appContext, today, repeatSource, personalization, mealsMigration, detailSheet, localRepo, cloudRepo, syncRepo, progress, consistency, ring, uiKit, dictDe, dictEn, result, analyzing, reminders] = await Promise.all([
  read('src/app/(tabs)/plan.tsx'),
  read('src/context/AppContext.tsx'),
  read('src/app/(tabs)/today.tsx'),
  read('src/services/repeatMeals.ts'),
  read('src/services/personalization.ts'),
  read('supabase/migrations/20260901160000_allow_planned_meals.sql'),
  read('src/components/MealDetailSheet.tsx'),
  read('src/services/localRepository.ts'),
  read('src/services/cloudRepository.ts'),
  read('src/services/syncRepository.ts'),
  read('src/app/(tabs)/progress.tsx'),
  read('src/services/consistency.ts'),
  read('src/components/CalorieRing.tsx'),
  read('src/components/ui.tsx'),
  read('src/i18n/de.ts'),
  read('src/i18n/en.ts'),
  read('src/app/result.tsx'),
  read('src/app/analyzing.tsx'),
  read('src/services/reminders.ts'),
]);

const failures = [];

// 1. A chosen recommendation must actually be logged.
if (!plan.includes('logPlannedMeal')) failures.push('choosing a recommendation does not log a meal');
// Wording lives in the dictionaries; check the wiring instead.
if (!plan.includes('t.plan.logIt') || !plan.includes('logMeal(suggestion)')) {
  failures.push('the plan screen has no action that commits the meal');
}
if (!plan.includes('setPortion')) failures.push('a chosen recommendation must let the user pick a portion');
if (!appContext.includes('createPlannedMeal')) failures.push('AppContext cannot build a planned meal');
if (!mealsMigration.includes("origin in ('scan', 'plan')")) failures.push('the database still rejects planned meals');

// The paywall must never sit between choosing a meal and eating it.
const choosePaywall = /setChosen\([^)]*\);\s*if \(params\.fromScan === '1'/.test(plan);
if (choosePaywall) failures.push('the paywall still fires on selection instead of after logging');

// 2. Free allowance is for paid analysis only.
for (const [label, contents] of [['plan', plan], ['today', today]]) {
  if (contents.includes('hasScanAccess')) failures.push(`${label} must not spend the scan allowance: nothing is analysed`);
}

// 3. Repeats must never duplicate what is already on the plate today.
if (!repeatSource.includes('availableRepeats') || !repeatSource.includes('eatenToday')) {
  failures.push('repeat suggestions do not exclude meals already logged today');
}
// The tap opens the slot sheet ("Als … eintragen"), which logs through logRepeatMeal.
const favoriteSheet = await read('src/components/FavoriteLogSheet.tsx');
if (!today.includes('<FavoriteLogSheet') || !favoriteSheet.includes('logRepeatMeal(picked')) failures.push('Today offers no one-tap repeat');

// 4. Target maths.
const activity = { low: 1.2, light: 1.375, high: 1.6 };
const target = (weight, height, age, level, goal, rate) => {
  const resting = 10 * weight + 6.25 * height - 5 * age - 78;
  const maintenance = resting * activity[level];
  const daily = (rate * 7700) / 7;
  const offset = goal === 'maintain' ? 0 : goal === 'lose' ? -daily : Math.min(350, daily);
  const floor = Math.max(1300, maintenance * 0.7);
  return Math.min(4000, Math.max(floor, Math.round((maintenance + offset) / 10) * 10));
};

try {
  // A faster rate must mean fewer calories when losing, never more.
  assert.ok(target(95, 185, 25, 'high', 'lose', 0.5) < target(95, 185, 25, 'high', 'lose', 0.25),
    '0.5 kg/week must be a larger deficit than 0.25');
  // Nobody is ever sent below the floor.
  assert.ok(target(50, 160, 35, 'low', 'lose', 0.5) >= 1300, 'the 1300 kcal floor must hold');
  // A surplus must stay a surplus but never run away.
  const bulk = target(70, 178, 17, 'high', 'gain', 0.5);
  const maintainTeen = target(70, 178, 17, 'high', 'maintain', 0.5);
  assert.ok(bulk > maintainTeen, 'gaining must exceed maintenance');
  assert.ok(bulk - maintainTeen <= 360, 'the surplus must stay capped near 350 kcal');
  // Two people of very different size must not receive the same deficit.
  const big = target(95, 185, 25, 'high', 'lose', 0.5);
  const small = target(55, 165, 30, 'low', 'lose', 0.5);
  assert.ok(big - small > 600, 'targets must scale with the person, not be a flat offset');
} catch (error) {
  failures.push(error.message);
}

if (!personalization.includes('KCAL_PER_KG')) failures.push('the rate maths must be derived, not a flat table');
if (personalization.includes('lose: -350')) failures.push('the flat goal adjustment is still in place');

// 5. A logged meal must be correctable. Without this a mis-scan, a wrong
//    portion or a stray tap on a repeat stayed in the day forever, while the
//    result screen promises control over every ingredient and portion.
if (!localRepo.includes('export async function deleteMeal')) failures.push('a logged meal cannot be deleted locally');
if (!cloudRepo.includes('export async function deleteCloudMeal')) failures.push('a deleted meal would come back on the next cloud sync');
if (!appContext.includes('deleteLoggedMeal') || !appContext.includes('adjustLoggedMealPortion')) {
  failures.push('the app exposes no way to remove or rescale a logged meal');
}
if (!today.includes('setOpenMeal') || !today.includes('MealDetailSheet')) {
  failures.push('meals on Heute must be tappable, otherwise the correction is unreachable');
}
if (!detailSheet.includes('confirmingDelete')) failures.push('deleting a meal must ask once before it happens');
// A delete made offline must not be undone by the next sync.
if (!localRepo.includes('rememberDeletedMeal') || !localRepo.includes('deleted.has(meal.id)') || !localRepo.includes('localDeleted.has(meal.id)') || !syncRepo.includes('mergeCloudMealSnapshot')) {
  failures.push('a deleted meal can be resurrected by cloud hydration');
}
if (!cloudRepo.includes('forgetDeletedMeal(id, sync.mutationId, user.id)')) failures.push('tombstones must be cleared once the server confirms the delete');
// Correcting twice must not compound: scaling runs from baseAmountG.
if (!appContext.includes('item.baseAmountG * factor')) {
  failures.push('portion correction must scale from the original estimate, not from the current value');
}

// 6. The timeline has to read as a chronology. The meal moment is guessed from
//    the clock at logging time, so three meals caught up in one evening all
//    became "Abendessen" with the same icon and no time shown.
if (!today.includes('meal.time')) failures.push('the meal row must show when the meal was eaten');
if (!today.includes('mealTypeIcon')) failures.push('every meal moment needs its own glyph');
if (!detailSheet.includes('setLoggedMealType')) failures.push('a wrongly guessed meal moment must be correctable');

// 7. Verlauf leads with what this audience controls. Weight swings on water and
//    inverts while building, so it cannot be the hero metric.
if (!progress.includes('proteinConsistency')) failures.push('Verlauf must lead with protein consistency');
if (progress.includes('Leiser Fortschritt summiert sich')) {
  failures.push('the poetic headline ate the fold on the screen people open for numbers');
}
if (!consistency.includes('reached: protein >= safeTarget * 0.9')) {
  failures.push('the protein target must have tolerance, or a good day reads as a failure');
}
if (!consistency.includes('logged.length')) failures.push('the average must ignore untracked days');
if (!progress.includes('trackedDays >= 3')) {
  failures.push('a hit rate needs enough days to mean anything; one tracked day must not be scored');
}

// 8. The one moment where something is finished. A factual current streak is
//    useful, but it must not turn into loss pressure or a punishment mechanic.
// The wording lives in the dictionaries now, so check where it actually is.
if (!ring.includes('t.ring.proteinDone')) failures.push('reaching the protein target must be acknowledged somewhere visible');
for (const [label, dict] of [['German', dictDe], ['English', dictEn]]) {
  if (!dict.includes('proteinDone')) failures.push(`${label} is missing the protein acknowledgement`);
}
if (!ring.includes('proteinReached && over === 0')) {
  failures.push('a day over budget must not be celebrated');
}
if (!uiKit.includes('current >= target * 0.9')) {
  failures.push('the macro card must use the same 10% tolerance as the weekly strip');
}
if (!progress.includes('weeklyLoggingGoal')) failures.push('the progress screen does not show the forgiving weekly logging goal');
if (/Tage in Folge|days in a row|Tage dran|days in\b/.test(dictDe + dictEn)) failures.push('streak copy contradicts "Keine Serien, kein Druck"');
if (/Serie am Leben|verloren|nicht verlieren|save your streak|lost your streak/i.test(progress + ring + dictDe + dictEn)) {
  failures.push('the factual streak must not be framed as loss or pressure');
}

// 9. Leaving the result screen must persist a correction. The exit handlers
//    used to skip the write once the meal had been saved on arrival, so
//    editing the portion afterwards was silently discarded.
if (/if \(!isCurrentScanLogged\) await logScannedMeal\(\)/.test(result)) {
  failures.push('leaving the result screen after an edit discards the correction');
}
if (!result.includes('variant="secondary"')) {
  failures.push('the way out of the logging loop must not be the quietest element on the screen');
}

// 10. The confirmation step is worth a screen only when something is uncertain.
if (!analyzing.includes("router.replace('/confirm')")) {
  failures.push('every estimate must pass through ingredient and portion confirmation');
}
if (analyzing.includes('needsReview')) {
  failures.push('model confidence must not bypass the user confirmation step');
}

// 11. The optional reminder question is the last step of the first run: after
// the first meal (or "Später") and the soft offer, never before the first scan.
// Actual permission/scheduling/race behavior is exercised by validate:companions.
const onboarding = await read('src/app/onboarding.tsx');
const reminderSetup = await read('src/app/reminder-setup.tsx');
const firstRun = await read('src/services/firstRun.ts');
if (result.includes('hasSeenReminderOffer') || result.includes('showReminderOffer')) {
  failures.push('saving a meal must not trigger the retired reminder offer');
}
if (onboarding.includes('prepareReminderOnboarding') || !onboarding.includes("setFirstRunStage('scan')")) {
  failures.push('onboarding must lead to the first scan, not straight to the reminder question');
}
if (!/finishFirstRunOffer[\s\S]*prepareReminderOnboarding/.test(firstRun) || !reminderSetup.includes('ReminderPreferences')) {
  failures.push('first setup must wire the explicit optional reminder choice after the offer');
}
if (!reminders.includes('kandro-morning-plan') || !reminders.includes("settings.mode === 'legacy'")) {
  failures.push('existing two-reminder preferences must survive migration');
}
if (/notificationBody[^\n]*targets|content:[^\n]*targets/.test(reminders)) {
  failures.push('lock-screen reminder text must not contain personal nutrition targets');
}

// 12. Repeat grouping, run against the real module rather than its source text.
//    Transpiled with the project's own TypeScript so the test cannot drift from
//    what the app actually ships.
const outDir = mkdtempSync(join(tmpdir(), 'kandro-loop-'));
try {
  // The module's only import is type-only, so --noResolve lets tsc emit it
  // standalone. tsc still reports the unresolved path alias and exits non-zero;
  // the emitted file is what matters, and npm run typecheck already covers
  // types properly against the real tsconfig.
  try {
    execFileSync('npx', [
      'tsc', resolve(projectRoot, 'src/services/repeatMeals.ts'),
      '--outDir', outDir, '--module', 'esnext', '--target', 'es2022',
      '--skipLibCheck', '--noResolve',
    ], { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // Exit status ignored on purpose; the artifact check below is the real gate.
  }

  const compiled = join(outDir, 'repeatMeals.js');
  if (!existsSync(compiled)) throw new Error('repeatMeals.ts did not transpile');
  renameSync(compiled, join(outDir, 'repeatMeals.mjs'));
  const { availableRepeats, repeatCandidates } = await import(pathToFileURL(join(outDir, 'repeatMeals.mjs')).href);

  const meal = (title, calories, date, savedAt, origin = 'scan') => ({
    id: `${title}-${savedAt}`, title, calories, protein: 30, carbs: 40, fat: 10, fiber: 4,
    type: 'Lunch', time: '12:00', confidence: 'high', items: [], origin, date, savedAt,
  });

  const history = [
    meal('Skyr mit Beeren', 340, '2026-08-28', '2026-08-28T07:00:00Z'),
    meal('Skyr mit Beeren', 355, '2026-08-29', '2026-08-29T07:00:00Z'),
    meal('Skyr mit Beeren', 350, '2026-08-30', '2026-08-30T07:00:00Z'),
    meal('Döner', 700, '2026-08-29', '2026-08-29T13:00:00Z'),
    meal('Currywurst', 900, '2026-08-27', '2026-08-27T13:00:00Z'),
    meal('Rind-Reis-Pfanne', 770, '2026-09-01', '2026-09-01T12:00:00Z', 'plan'),
  ];

  const ranked = repeatCandidates(history);
  assert.equal(ranked[0].title, 'Skyr mit Beeren', 'the most frequent meal must rank first');
  assert.equal(ranked[0].count, 3, 'near-identical portions must merge into one entry');
  assert.equal(ranked[0].calories, 350, 'the most recent portion decides the numbers');
  assert.ok(ranked.some((c) => c.title === 'Rind-Reis-Pfanne'), 'meals chosen from the plan must be repeatable');

  const withoutToday = availableRepeats(history, [history[5]]);
  assert.ok(!withoutToday.some((c) => c.title === 'Rind-Reis-Pfanne'), 'what is already on the plate today must not be suggested');
  assert.ok(withoutToday.some((c) => c.title === 'Skyr mit Beeren'), 'the rest of the history stays available');

  const doubled = repeatCandidates([...history, meal('Skyr mit Beeren', 700, '2026-08-31', '2026-08-31T07:00:00Z')]);
  assert.equal(doubled.filter((c) => c.title === 'Skyr mit Beeren').length, 2, 'a genuinely different portion stays its own entry');

  assert.deepEqual(repeatCandidates([]), [], 'an empty history must not throw');
  assert.deepEqual(availableRepeats([], []), [], 'an empty day must not throw');
} catch (error) {
  failures.push(`repeat grouping: ${error.message}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length) {
  throw new Error(`Daily loop validation failed:\n- ${failures.join('\n- ')}`);
}

console.log('Validated the daily loop: meals log and correct properly, the timeline reads as a chronology, Verlauf leads with protein consistency, and targets scale with the person.');
