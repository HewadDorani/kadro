import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/context/AppContext.tsx');
const cloud = read('src/services/cloudRepository.ts');
const local = read('src/services/localRepository.ts');
const onboarding = read('src/app/onboarding.tsx');
const plan = read('src/app/(tabs)/plan.tsx');
const scan = read('src/app/(tabs)/scan.tsx');
const consistency = read('src/services/consistency.ts');
const progress = read('src/app/(tabs)/progress.tsx');
const authTemplate = read('supabase/templates/email_change.html');
const authConfig = read('supabase/config.toml');
const consent = read('src/services/consent.ts');
const deletionScreen = read('src/app/account-deletion.tsx');

const draftModule = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/utils/mealDraftGuard.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(draftModule, draftModule.exports);
for (const route of ['confirm', 'result', 'correct-food']) {
  for (const status of ['idle', 'analyzing', 'queued', 'error']) {
    assert.equal(draftModule.exports.requiresMealDraftRedirect(route, status), true);
  }
  assert.equal(draftModule.exports.requiresMealDraftRedirect(route, 'ready'), false);
}
for (const route of ['index', 'onboarding', 'scan', '(tabs)', 'privacy', 'account-deletion']) {
  assert.equal(draftModule.exports.requiresMealDraftRedirect(route, 'idle'), false);
}
const guard = read('src/components/AppRouteGuard.tsx');
assert.match(guard, /const missingMealDraft = requiresMealDraftRedirect/);
assert.match(guard, /const gated = [^\n]*missingMealDraft \|\| incompleteResult/);
assert.match(read('src/app/result.tsx'), /if \(savedOnArrival\.current \|\| gated\) return;/,
  'cold result routes must not run their save effect before the redirect');
assert.match(guard, /\{children\}\s*\{gated \?/, 'the guard covers the navigator; removing it strands the redirect and loops');
assert.match(app, /const logScannedMeal = useCallback\(async \(\) => \{\s*if \(analysisStatus !== 'ready'\) throw/,
  'the persistence boundary must reject initial demo state too');

assert.match(onboarding, /stop\(\);\s*const activeGesture = gesture\.current/,
  'every new stepper gesture must cancel the previous hold timer');
assert.match(onboarding, /activeGesture !== gesture\.current/,
  'stale stepper timers must be ignored after release');

assert.match(local, /COUNTED_SCAN_IDS_KEY/);
assert.match(local, /scanCountMutation\.then\(mutate, mutate\)/,
  'analysis credits must be serialized instead of racing through React state');
assert.match(app, /countLifetimeScanOnce\(invocationScanId\)[\s\S]*if \(!isCurrentInvocation\(\)\) return;[\s\S]*setLifetimeScanCount\(nextLifetimeCount\)[\s\S]*setAnalysisStatus\('ready'\)/,
  'the stable provider request id must spend at most one credit when the result succeeds');
const saveStart = app.indexOf('const logScannedMeal = useCallback');
const saveEnd = app.indexOf('const logPlannedMeal = useCallback', saveStart);
assert.doesNotMatch(app.slice(saveStart, saveEnd), /countLifetimeScanOnce/,
  'abandoning the confirmation screen must not postpone the spent-credit update until meal save');

assert.match(cloud, /origin: meal\.origin === 'plan' \? 'plan' : 'scan'/,
  'cloud writes must preserve free plan/search meals');
assert.match(cloud, /origin: row\.origin === 'plan' \? 'plan' : 'scan'/,
  'cloud reads must preserve free plan/search meals');
assert.match(cloud, /defaultProfile\.completedAt \? \{[\s\S]*age: defaultProfile\.age,[\s\S]*height_cm: defaultProfile\.heightCm,[\s\S]*weight_kg: defaultProfile\.weightKg/,
  'a first cloud profile created from completed local onboarding must preserve its declared measurements');
assert.match(cloud, /deriveMissingTargetsFromCloud && profile\.completedAt[\s\S]*calculateDailyTargets\(profile\)[\s\S]*missingTargetDefaults/,
  'a returning account with no target row for today must derive it from the cloud profile instead of generic defaults');
assert.match(app, /\['demo', 'search', 'barcode', 'plan'\]/,
  'barcode, search and Plan supermarket baskets must remain outside the paid AI allowance');
assert.doesNotMatch(scan.slice(scan.indexOf('const openBarcode'), scan.indexOf('const handleBarcode')), /hasScanAccess/,
  'barcode must not open the paywall');
assert.match(plan, /freeScansLeft === 0/,
  'the after-meal paywall must wait until all free analyses are used');

// The streak was replaced by a forgiving weekly goal: nothing to lose, nothing reset.
assert.doesNotMatch(consistency, /currentLoggingStreak/, 'no consecutive-day streak may come back');

const consistencySource = `
  const localDateKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return \`${'${year}-${month}-${day}'}\`;
  };
  const getLocale = () => 'en-GB';
  ${consistency.replace(/^import[^;]+;$/gm, '')}
`;
const compiled = ts.transpileModule(consistencySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { weeklyLoggingGoal, WEEKLY_LOG_GOAL, lastMealSavedAt } = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`);
const on = (date, extra = {}) => ({ date, ...extra });
const today = new Date(2026, 8, 4, 12);
assert.equal(WEEKLY_LOG_GOAL, 4);
assert.equal(weeklyLoggingGoal([on('2026-09-04')], today).logged, 1);
assert.equal(weeklyLoggingGoal([on('2026-09-03')], today).logged, 1, 'yesterday still counts this week');
assert.equal(weeklyLoggingGoal([on('2026-09-04'), on('2026-09-02'), on('2026-08-31')], today).logged, 3, 'a gap never resets the week');
assert.equal(weeklyLoggingGoal([on('2026-08-28')], today).logged, 0, 'only the last seven days count');
assert.equal(weeklyLoggingGoal([on('2026-09-05')], today).logged, 0, 'a future meal does not count');
assert.equal(weeklyLoggingGoal([on('2026-09-04', { origin: 'seed' })], today).logged, 0, 'demo meals do not count');
const fourDays = weeklyLoggingGoal(['2026-09-04', '2026-09-03', '2026-09-01', '2026-08-29'].map((d) => on(d)), today);
assert.equal(fourDays.reached, true); assert.equal(fourDays.days.length, 7); assert.equal(fourDays.days[6].today, true); assert.equal(fourDays.days[6].key, '2026-09-04');
assert.equal(lastMealSavedAt([on('2026-09-01', { savedAt: '2026-09-01T10:00:00Z' }), on('2026-09-03', { savedAt: '2026-09-03T08:00:00Z' }), on('2026-09-04', { origin: 'seed', savedAt: '2026-09-04T08:00:00Z' })]), Date.parse('2026-09-03T08:00:00Z'));
assert.equal(lastMealSavedAt([]), null);
// The chart geometry moved into the time-scaled layout helper.
assert.match(progress + read('src/utils/progressPresentation.ts'), /range === 0 \? 0\.5/,
  'an unchanged weight trend must render flat instead of at the chart minimum');
assert.doesNotMatch(progress, /weightChange > 0 \? colors\.attention/,
  'weight gain must not be marked as failure when building muscle may be the goal');

assert.match(authConfig, /site_url = "https:\/\/getkandro\.com\/confirm"/);
assert.match(authConfig, /double_confirm_changes = false/);
assert.match(authConfig, /host = "smtp\.resend\.com"/);
assert.match(authTemplate, /\.Data\.kandro_language/);
assert.match(authTemplate, /\.Data\.display_name/);
assert.match(authTemplate, /{{ \.Token }}/);
assert.doesNotMatch(authTemplate, /ConfirmationURL|localhost/,
  'the in-app OTP flow must not send users to a browser link');
assert.match(consent, /if \(!user\) throw new Error\('cloud_account_disabled'\)/,
  'a configured but intentionally disabled cloud account must not record a misleading local-only consent');
assert.match(deletionScreen, /enableNewCloudAccount\(\)[\s\S]*router\.replace\('\/onboarding'\)/,
  'after deletion the user needs an explicit, functional path to create a fresh account before consenting again');
assert.match(local, /beginLocalAccountSwitch\(previousUserId: string\)[\s\S]*previousUserId,[\s\S]*startedAt/,
  'the account-switch crash marker must identify the previous session, not just store a boolean');

for (const path of ['src', 'site']) {
  const files = fs.readdirSync(new URL(`../${path}`, import.meta.url), { recursive: true, withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const full = new URL(`../${path}/${entry.parentPath ? `${entry.parentPath.replace(/^.*\/(src|site)\/?/, '')}/` : ''}${entry.name}`, import.meta.url);
    if (fs.readFileSync(full, 'utf8').includes('—')) throw new Error(`em dash remains in ${full.pathname}`);
  }
}

console.log('State integrity checks passed.');
