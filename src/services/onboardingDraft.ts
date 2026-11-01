import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BiologicalSex, NutritionGoal, UserProfile } from '@/types/nutrition';
import type { Motivation, Obstacle } from '@/services/motivation';
import type { UnitSystem } from '@/utils/units';

const KEY = '@kandro/onboarding-draft:v1';

/**
 * First-run answers survive the app being killed mid-setup. Device-local only,
 * never synced, and removed as soon as onboarding completes. Consent is not
 * part of the draft: it is always asked again.
 */
export type OnboardingDraft = {
  stepIndex: number;
  goal: NutritionGoal;
  displayName: string;
  sex: BiologicalSex;
  sexChosen: boolean;
  unitSystem: UnitSystem;
  birthYear: number | null;
  hadBirthday: boolean | null;
  heightCm: number;
  weightKg: number;
  activityLevel: UserProfile['activityLevel'];
  // Later additions stay optional: a draft from the previous build still resumes.
  motivation?: Motivation | null;
  obstacle?: Obstacle | null;
  preferences?: string[];
  targetWeightInput?: string;
  targetDateInput?: string;
  weeklyRateKg?: UserProfile['weeklyRateKg'];
};

const goals = ['lose', 'maintain', 'gain'];
const sexes = ['female', 'male', 'unspecified'];
const units = ['metric', 'us', 'uk'];
const activities = ['low', 'light', 'high'];
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Anything malformed is dropped: a fresh start is better than a broken one. */
export function parseOnboardingDraft(raw: string | null): OnboardingDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (!finite(value.stepIndex, 0, 20) || !goals.includes(value.goal as string) || !sexes.includes(value.sex as string)
      || !units.includes(value.unitSystem as string) || !activities.includes(value.activityLevel as string)
      || typeof value.displayName !== 'string' || typeof value.sexChosen !== 'boolean'
      || !(value.birthYear === null || finite(value.birthYear, 1900, 2200))
      || !(value.hadBirthday === null || typeof value.hadBirthday === 'boolean')
      || !finite(value.heightCm, 100, 250) || !finite(value.weightKg, 30, 250)) return null;
    return {
      ...value,
      stepIndex: Math.floor(value.stepIndex),
      displayName: value.displayName.slice(0, 40),
      preferences: Array.isArray(value.preferences) ? value.preferences.filter((entry): entry is string => typeof entry === 'string').slice(0, 12) : undefined,
      targetWeightInput: typeof value.targetWeightInput === 'string' ? value.targetWeightInput.slice(0, 6) : undefined,
      targetDateInput: typeof value.targetDateInput === 'string' ? value.targetDateInput.slice(0, 10) : undefined,
      weeklyRateKg: value.weeklyRateKg === 0.5 ? 0.5 : value.weeklyRateKg === 0.25 ? 0.25 : undefined,
    } as OnboardingDraft;
  } catch { return null; }
}

export async function loadOnboardingDraft() {
  return parseOnboardingDraft(await AsyncStorage.getItem(KEY).catch(() => null));
}
export async function saveOnboardingDraft(draft: OnboardingDraft) {
  await AsyncStorage.setItem(KEY, JSON.stringify(draft)).catch(() => undefined);
}
export async function clearOnboardingDraft() {
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
