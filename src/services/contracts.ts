import { DailyTargets, Meal, MealContext, MealItem, MealSuggestion, Nutrition } from '@/types/nutrition';

export type MealAnalysisInput = {
  imageBase64: string;
  mimeType: 'image/jpeg';
  /** Language the detected title and ingredient names come back in. */
  language: 'de' | 'en';
  locale: string;
};

export type MealAnalysisResult = {
  /** Opt-in protocol: editable draft, not a complete nutrition result. */
  correctionRequired?: boolean;
  /** The amounts are a typical portion because the input's amount was unclear. */
  estimatedPortion?: boolean;
  /** One question the photo cannot answer; a tap adds the food from the database. */
  clarify?: 'cooking_fat' | 'dressing';
  title: string;
  confidence: 'high' | 'medium';
  items: MealItem[];
  warnings: string[];
};

export type AnalysisErrorKind = 'not-configured' | 'consent-required' | 'subscription-required' | 'daily-limit' | 'invalid-input' | 'request-expired' | 'offline' | 'unclear-image' | 'multiple-dishes' | 'product-not-found' | 'provider-error' | 'timeout' | 'rate-limited' | 'session-required' | 'invalid-response' | 'model-refused';

export type PendingAnalysis = MealAnalysisInput & {
  id: string;
  createdAt: string;
};

export interface MealAnalysisService {
  analyze(input: MealAnalysisInput): Promise<MealAnalysisResult>;
}

export interface NutritionLookupService {
  resolve(items: MealItem[]): Promise<MealItem[]>;
}

export interface MealRepository {
  list(date: string): Promise<Meal[]>;
  save(meal: Meal): Promise<void>;
  queueForRetry(analysis: PendingAnalysis): Promise<void>;
}

export type RecommendationInput = {
  context: MealContext;
  remaining: Nutrition;
  targets: DailyTargets;
  preferences: string[];
};

export interface RecommendationService {
  recommend(input: RecommendationInput): Promise<MealSuggestion[]>;
}
