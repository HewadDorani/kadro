#!/usr/bin/env node
/**
 * A plan someone cannot change is a plan they abandon: goals finish, weight
 * moves, activity changes. Editing re-runs the onboarding questions rather
 * than duplicating them, so the risks are that a field stops being prefilled
 * (silently resetting it to the first-run default), that consent gets asked
 * again, or that the entry point disappears from the profile.
 */
import { readFileSync } from 'node:fs';

const problems = [];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const onboarding = read('src/app/onboarding.tsx');
const profile = read('src/app/(tabs)/profile.tsx');
const context = read('src/context/AppContext.tsx');

if (!/const editing = params\.edit === '1' && !!profile\.completedAt;/.test(onboarding)) {
  problems.push('onboarding: edit mode is not gated on a completed profile');
}

// Every stored field must come back prefilled; a missed one silently resets.
const prefilled = [
  ['goal', 'profile.goal'],
  ['displayName', 'profile.displayName'],
  ['sex', 'profile.sex'],
  ['unitSystem', 'profile.unitSystem'],
  ['height', 'profile.heightCm'],
  ['weight', 'profile.weightKg'],
  ['activity', 'profile.activityLevel'],
  ['weeklyRate', 'profile.weeklyRateKg'],
  ['preferences', 'profile.preferences'],
];
// The age is derived, not a state: the recorded one when editing.
if (!/const age = editing \? profile\.age :/.test(onboarding)) {
  problems.push('onboarding: age is not prefilled from profile.age when editing');
}
for (const [state, source] of prefilled) {
  const pattern = new RegExp(`useState[^\\n]*editing \\? ${source.replace('.', '\\.')} :`);
  if (!pattern.test(onboarding)) {
    problems.push(`onboarding: ${state} is not prefilled from ${source} when editing`);
  }
}

if (!/completedAt: editing \? profile\.completedAt : null/.test(onboarding)) {
  problems.push('onboarding: editing would overwrite completedAt and look like a fresh install');
}
if (!onboarding.includes("step === 'about' && !editing")) {
  problems.push('onboarding: recorded age is editable');
}
// Editing never re-opens consent. The recorded age cannot be edited, and
// earlier 14–15 profiles are protected server-side (guardian approval), so
// the client no longer runs a guardian flow when saving.
const saveBlock = onboarding.slice(onboarding.indexOf('const saveEdits'), onboarding.indexOf('const showFooterButton'));
if (!saveBlock.includes('completeOnboarding(draftProfile)')) {
  problems.push('onboarding: saving edits does not go through completeOnboarding');
}
if (!/if \(editing\) \{\s*await saveEdits\(\);\s*return;/.test(saveBlock)) {
  problems.push('onboarding: an edit no longer saves directly');
}
// The wish (target weight, pace) and food preferences left first-run
// onboarding; plan editing is where they live now.
const goals = read('src/services/personalGoal.ts');
if (!/if \(!editing\) return FIRST_RUN_STEPS;/.test(goals) || !/FIRST_RUN_STEPS = \['goal', 'about', 'body', 'activity', 'plan'\]/.test(goals)) {
  problems.push('personalGoal: first run must skip target and preferences');
}
if (!/ONBOARDING_STEPS = \['goal', 'about', 'body', 'activity', 'target', 'preferences', 'plan'\]/.test(goals) || !onboarding.includes('onboardingSteps(age, planGoal, editing)')) {
  problems.push('onboarding: plan editing no longer reaches the target and preference steps');
}

if (!profile.includes("router.push('/onboarding?edit=1' as never)")) {
  problems.push('profile: no way in to the plan editor');
}
if (!profile.includes('t.profile.changePlan')) {
  problems.push('profile: the plan editor row has no label');
}

// Plan → "Angepasst an … Ändern" jumps straight to the preference step of
// the same editor and comes back to Plan; it is not a second editor.
const plan = read('src/app/(tabs)/plan.tsx');
if (!plan.includes("router.push('/onboarding?edit=1&step=preferences' as never)")) {
  problems.push('plan: no way from the options to the preference editor');
}
if (!/const preferencesShortcut = editing && params\.step === 'preferences';/.test(onboarding)
  || !/indexOf\('preferences'\)/.test(onboarding)
  || !/router\.replace\(editDone\)/.test(onboarding)) {
  problems.push('onboarding: the preference shortcut does not open the preference step and return to Plan');
}

// completeOnboarding is the single place that recalculates and syncs.
if (!/const nextTargets = calculateDailyTargets\(completedProfile\);/.test(context)) {
  problems.push('AppContext: completeOnboarding no longer recalculates targets, so an edit would not move them');
}

if (problems.length) {
  console.error('Plan-editing check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Plan editing reuses onboarding, stays prefilled, saves without re-asking consent, and is where target, pace and preferences are edited.');
