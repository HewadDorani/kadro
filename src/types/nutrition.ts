import type { UnitSystem } from '@/utils/units';

export type MacroKey = 'protein' | 'carbs' | 'fat';

export type Nutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
};

export type NutritionSource = {
  /** Only unresolved analysis drafts carry this code. Never log them. */
  code?: 'unmatched';
  provider: 'usda' | 'bls' | 'open-food-facts' | 'kandro-catalog' | 'demo' | 'manual';
  referenceId?: string;
  /** Typical food-family values, not an exact product/manufacturer label. */
  estimatedReference?: boolean;
  label: string;
};

export type MealItem = Nutrition & {
  id: string;
  name: string;
  amountG: number;
  baseAmountG: number;
  portionFactor: number;
  /** Stable reference retained across repeated amount corrections. */
  nutritionPer100g?: Nutrition;
  confidence: 'high' | 'medium';
  optional?: boolean;
  included: boolean;
  /** Named household portions from the source, when it has any. */
  /** `unitOnly`: values per serving, no published weight; grams are a stand-in (see utils/portions). */
  portions?: { label: string; grams: number; estimated?: boolean; unitOnly?: boolean }[];
  source: NutritionSource;
};

export type MealSync = {
  mealId: string;
  ownerId?: string;
  revision: number;
  mutationId?: string;
  ancestors?: string[];
  status: 'pending' | 'synced' | 'conflict';
};

export type Meal = Nutrition & {
  id: string;
  title: string;
  type: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
  time: string;
  confidence: 'high' | 'medium';
  items: MealItem[];
  /** 'scan' = analysed by the user, 'plan' = chosen from Kandro's suggestions. */
  origin?: 'seed' | 'scan' | 'plan';
  date?: string;
  savedAt?: string;
  /** Sync protocol only; never sent to analytics or counted as a meal edit. */
  sync?: MealSync;
};

export type DailyTargets = Nutrition;

export type MealContext = 'home' | 'supermarket' | 'eating-out';

export type MealSuggestion = Nutrition & {
  id: string;
  title: string;
  detail: string;
  time: string;
  contexts?: MealContext[];
  preferences?: string[];
  source?: NutritionSource;
  /** Fraction of the catalogue/recipe serving represented by these values. */
  portionScale?: number;
  /** Unrounded scaling always starts from this original reference. */
  referenceNutrition?: Nutrition;
};

export type PortionFactor = 0.7 | 1 | 1.4;

export type NutritionGoal = 'lose' | 'maintain' | 'gain';

/**
 * Only what the energy formula needs. Mifflin-St Jeor has a male and a female
 * constant and nothing in between; 'unspecified' keeps the midpoint Kandro
 * used before anyone was asked, for people who would rather not say.
 */
export type BiologicalSex = 'female' | 'male' | 'unspecified';

export type ActivityLevel = 'low' | 'light' | 'high';

/** Target change in body weight per week, in kilograms. */
export type WeeklyRateKg = 0.25 | 0.5;

export type UserProfile = {
  displayName: string;
  goal: NutritionGoal;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  /** Only meaningful when goal is 'lose' or 'gain'. */
  weeklyRateKg: WeeklyRateKg;
  /** Display only: height and weight are always stored in cm and kg. */
  unitSystem: UnitSystem;
  /** Feeds the resting-energy estimate; 'unspecified' is always allowed. */
  sex: BiologicalSex;
  preferences: string[];
  /** Optional adult wishes; never used by the calorie or pace calculation. */
  targetWeightKg?: number | null;
  targetDate?: string | null;
  completedAt: string | null;
  /** Last explicit edit, separate from initial onboarding completion. */
  editedAt?: string;
};

export type WeightEntry = {
  date: string;
  weightKg: number;
};
