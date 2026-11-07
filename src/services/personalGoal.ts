import type { NutritionGoal, UserProfile } from '@/types/nutrition';

export const ONBOARDING_STEPS = ['goal', 'about', 'body', 'activity', 'target', 'preferences', 'plan'] as const;
/** First run only: they build the reason to stay, they are not plan settings. */
export type FirstRunOnlyStep = 'why' | 'obstacle' | 'potential' | 'rhythm';
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | FirstRunOnlyStep;
/**
 * First run is the shortest path to a plan and a first scan (owner decision
 * 07.11.2026, back to the 1.0.6 flow): the wish (target/pace) and food
 * preferences use calm defaults and stay editable under "Du → Plan anpassen",
 * which reuses this screen with every step. The reminder question follows the
 * paywall again (services/firstRun.ts). The 1.0.7 steps why, obstacle,
 * potential and rhythm stay implemented in onboarding.tsx but are off.
 */
export const FIRST_RUN_STEPS = ['goal', 'about', 'body', 'activity', 'plan'] as const satisfies readonly OnboardingStep[];
export function onboardingSteps(age: number, goal: NutritionGoal, editing = false): readonly OnboardingStep[] {
  if (!editing) return FIRST_RUN_STEPS;
  return age >= 18 && goal !== 'maintain' ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter(step => step !== 'target');
}

/** Kandro is 16+. Younger people see a friendly block, never a consent flow. */
export const MINIMUM_AGE = 16;
/**
 * A birth year alone leaves the age open by one. That only matters when the
 * year straddles a boundary (16: access, 18: adult plan), so only then is the
 * birthday asked; otherwise the age reached this calendar year is used.
 */
export function birthYearNeedsBirthday(birthYear: number, currentYear: number) {
  const reached = currentYear - birthYear;
  return reached === MINIMUM_AGE || reached === 18;
}
export function ageFromBirthYear(birthYear: number, currentYear: number, hadBirthday: boolean | null) {
  const reached = currentYear - birthYear;
  return birthYearNeedsBirthday(birthYear, currentYear) && hadBirthday !== true ? reached - 1 : reached;
}

/** Strict calendar dates, independent of locale, timezone and Date.parse rollover. */
export function isPersonalGoalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const validWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 40 && value <= 200;
/** A wish may never point below BMI 18.5 (same rule as personalization). */
export function targetBelowHealthyRange(weightKg: number, heightCm: number | undefined) {
  if (typeof heightCm !== 'number' || !(heightCm > 0)) return false;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM) < 18.5;
}
type GoalFields = { targetWeightKg: number | null; targetDate: string | null };
type GoalProfile = Pick<UserProfile, 'age' | 'goal'> & Partial<GoalFields> & { heightCm?: number };

/** Optional wishes only: never an input to nutrition, and never a youth claim. */
export function normalizePersonalGoal(profile: GoalProfile): GoalFields {
  if (profile.age < 18 || !Number.isFinite(profile.age) || !['lose', 'gain'].includes(profile.goal) || !validWeight(profile.targetWeightKg)
    || targetBelowHealthyRange(profile.targetWeightKg, profile.heightCm)) {
    return { targetWeightKg: null, targetDate: null };
  }
  return { targetWeightKg: Math.round(profile.targetWeightKg * 100) / 100,
    targetDate: isPersonalGoalDate(profile.targetDate) ? profile.targetDate : null };
}

/** Validate deliberate edits; an expired previously saved wish may still be read. */
export function personalGoalError(weightKg: number | null, date: string | null, today: string, heightCm?: number): 'weight' | 'date' | null {
  if (weightKg === null && date === null) return null;
  if (!validWeight(weightKg) || targetBelowHealthyRange(weightKg, heightCm)) return 'weight';
  if (date !== null && (!isPersonalGoalDate(date) || date < today)) return 'date';
  return null;
}

/** Two decimal places preserve a stored kg value converted from pounds. */
export function parsePersonalGoalWeight(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
