import { getLocalDataGeneration } from '@/services/localRepository';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { AnalysisErrorKind, MealAnalysisInput, MealAnalysisResult } from '@/services/contracts';
import {
  functionsBaseUrl,
  getAccessToken,
  isSupabaseConfigured,
  supabaseAnonKey,
} from '@/services/supabaseClient';
import { MealItem, Nutrition } from '@/types/nutrition';
import { getDictionary, getLanguage, getLocale } from '@/i18n/active';
import { needsIngredientCorrection } from '@/utils/ingredientCorrection';
import { customFoodResult, findCustomFoodByBarcode } from '@/services/customFoods';

/**
 * Optional local override for development. When it is unset the app talks to
 * the hosted Supabase edge function, which is what production builds do: the
 * provider keys live there, never on the device.
 */
const localApiUrl = process.env.EXPO_PUBLIC_ANALYSIS_API_URL?.replace(/\/$/, '');
const MAX_IMAGE_BASE64 = 3_000_000;
/**
 * Long edge of the photo sent for analysis. 1024 px keeps a plate, its sides
 * and a legible package label recognisable while uploading a fraction of the
 * former 1600 px image, which is most of the wait on a mobile connection.
 */
export const PHOTO_LONG_EDGE = 1024;
/** About 600 KB of JPEG; base64 is 4/3 of the byte size. */
export const TARGET_IMAGE_BASE64 = 800_000;
/** Quality steps, tried in order until the photo fits the target. */
const PHOTO_PASSES = [
  { longEdge: PHOTO_LONG_EDGE, compress: 0.8 },
  { longEdge: PHOTO_LONG_EDGE, compress: 0.65 },
  { longEdge: 800, compress: 0.6 },
];

/**
 * The gateway's own message is German: it is one deployed function serving
 * every language. Translate by code here so the user reads their own language
 * without a redeploy. Unknown codes use a localized generic error.
 */
/**
 * The gateway returns codes for its warnings and for an ingredient it could
 * not price, so the wording comes from the dictionary and a language fix never
 * needs a redeploy. An unknown code is dropped rather than shown raw.
 */
function localizeResult(result: MealAnalysisResult): MealAnalysisResult {
  const t = getDictionary().errors;
  const warnings: Record<string, string> = {
    unmatched_ingredient: t.warnUnmatched,
    hidden_calories: t.warnHiddenCalories,
    wide_portion: t.warnWidePortion,
    milk_volume_estimated: t.warnMilkVolume,
    drink_volume_estimated: t.warnDrinkVolume,
    amount_estimated: t.warnAmountEstimated,
  };
  const sources: Record<string, string> = { unmatched: t.sourceUnmatched };
  const localizedWarnings = (result.warnings ?? []).map((entry) => warnings[entry]).filter(Boolean);
  if (result.items?.some((item) => item.source?.estimatedReference) && !localizedWarnings.includes(t.warnGenericReference)) {
    localizedWarnings.push(t.warnGenericReference);
  }
  return {
    ...result,
    warnings: localizedWarnings,
    items: (result.items ?? []).map((item) => {
      const code = (item.source as { code?: string } | undefined)?.code;
      return code && sources[code]
        ? { ...item, source: { ...item.source, label: sources[code] } }
        : item;
    }),
  };
}

function gatewayMessage(code: string | undefined, _fallback: string | undefined) {
  const dictionary = getDictionary();
  const t = dictionary.errors;
  const byCode: Record<string, string> = {
    invalid_input: t.gatewayInvalidInput,
    invalid_request: t.gatewayInvalidInput,
    invalid_barcode: t.gatewayInvalidBarcode,
    product_not_found: t.gatewayProductNotFound,
    missing_nutrition: t.gatewayMissingNutrition,
    unauthorized: t.gatewayUnauthorized,
    provider_error: t.gatewayProviderError,
    provider_rate_limited: t.gatewayRateLimited,
    provider_timeout: t.gatewayTimeout,
    provider_response_invalid: t.gatewayInvalidResponse,
    model_truncated: t.gatewayInvalidResponse,
    model_refused: t.gatewayRefused,
    ai_route_not_approved: t.analysisNotConfigured,
    ai_key_missing: t.analysisNotConfigured,
    ai_provider_invalid: t.analysisNotConfigured,
    mass_required: t.gatewayMassRequired,
    amount_ambiguous: t.gatewayAmountAmbiguous,
    amount_out_of_range: t.gatewayAmountRange,
    daily_limit_reached: t.gatewayDailyLimit,
    subscription_required: dictionary.paywall.blockedSub,
    analysis_in_progress: t.analysisFailed,
    request_completed: t.gatewayRequestExpired,
    access_unavailable: t.gatewayProviderError,
    entitlement_verification_unavailable: t.gatewayProviderError,
    entitlement_rate_limited: t.gatewayProviderError,
    consent_required: t.gatewayConsentRequired,
    unclear_image: t.noClearMeal,
    multiple_dishes: t.gatewayMultipleDishes,
    server_not_configured: t.analysisNotConfigured,
    // Routing faults a user should never reach; the raw German would be worse.
    method_not_allowed: t.gatewayUnexpected,
    not_found: t.gatewayUnexpected,
    label_unreadable: t.gatewayLabelUnreadable,
    label_volume_basis: t.gatewayLabelVolume,
  };
  return (code && byCode[code]) || t.analysisFailed;
}

function gatewayError(response: GatewayResponse, code?: string, message?: string) {
  const kinds: Record<string, AnalysisErrorKind> = {
    unclear_image:'unclear-image',multiple_dishes:'multiple-dishes',server_not_configured:'not-configured',
    ai_route_not_approved:'not-configured',ai_key_missing:'not-configured',ai_provider_invalid:'not-configured',
    consent_required:'consent-required',unauthorized:'session-required',subscription_required:'subscription-required',
    daily_limit_reached:'daily-limit',request_completed:'request-expired',invalid_input:'invalid-input',invalid_request:'invalid-input',
    missing_nutrition:'product-not-found',product_not_found:'product-not-found',provider_rate_limited:'rate-limited',
    provider_timeout:'timeout',provider_response_invalid:'invalid-response',model_truncated:'invalid-response',model_refused:'model-refused',
    mass_required:'invalid-input',amount_ambiguous:'invalid-input',amount_out_of_range:'invalid-input',
    label_unreadable:'unclear-image',label_volume_basis:'invalid-input',
  };
  const detail = gatewayMessage(code, message);
  return new MealAnalysisError(kinds[code ?? ''] ?? (response.status === 429 ? 'rate-limited' : 'provider-error'),
    response.retryAfter ? `${detail} ${getDictionary().errors.retryAfterSeconds.replace('{seconds}', String(response.retryAfter))}` : detail,
    response.retryAfter, code);
}

function validSearchResult(result: FoodSearchResult) {
  if (!result || typeof result.id !== 'string' || !result.id || typeof result.name !== 'string' || !result.name.trim() || result.name.length > 160
    || !result.per100g || ![result.per100g.calories,result.per100g.protein,result.per100g.carbs,result.per100g.fat].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0)
    || (result.per100g.calories===0 && result.per100g.protein*4+result.per100g.carbs*4+result.per100g.fat*9>5)
    || !Number.isFinite(result.defaultGrams) || result.defaultGrams<1 || result.defaultGrams>5000
    || !['bls','usda','open-food-facts','manual','kandro-catalog'].includes(result.source?.provider) || typeof result.source.referenceId !== 'string' || !result.source.referenceId
    || typeof result.source.label !== 'string') return false;
  if (result.per100g.fiber !== undefined && (!Number.isFinite(result.per100g.fiber) || result.per100g.fiber<0)) return false;
  return result.portions === undefined || (Array.isArray(result.portions) && result.portions.every(p=>typeof p.label==='string' && p.label.length>0 && Number.isFinite(p.grams) && p.grams>=1 && p.grams<=5000));
}

export class MealAnalysisError extends Error {
  constructor(
    public readonly kind: AnalysisErrorKind,
    message: string,
    public readonly retryAfter?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MealAnalysisError';
  }
}

export type PreparedMealPhoto = MealAnalysisInput & {
  previewUri: string;
};

export function isLiveAnalysisConfigured() {
  return Boolean(localApiUrl || (isSupabaseConfigured && functionsBaseUrl));
}

/**
 * Sends one gateway request. Network failures surface as `offline` so the
 * caller can queue a photo; everything else is decided by the response body.
 */
type GatewayResponse = Pick<Response, 'ok' | 'status' | 'json'> & { retryAfter?: number };

async function gatewayFetch(path: string, init?: { method: 'POST'; body: unknown }): Promise<GatewayResponse> {
  const generation = getLocalDataGeneration();
  const language = getLanguage();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MealAnalysisError('timeout', getDictionary().errors.gatewayTimeout));
    }, 90_000);
  });
  const request = async (): Promise<GatewayResponse> => {
    let url = `${localApiUrl}${path}`;
    const headers: Record<string, string> = init ? { 'Content-Type': 'application/json' } : {};
    if (!localApiUrl) {
      if (!functionsBaseUrl || !supabaseAnonKey) {
        throw new MealAnalysisError('not-configured', getDictionary().errors.analysisNotConfigured);
      }
      const accessToken = await getAccessToken().catch(() => null);
      if (!accessToken) throw new MealAnalysisError('session-required', getDictionary().errors.sessionUnavailable);
      url = `${functionsBaseUrl}/nutrition${path}`;
      headers.Authorization = `Bearer ${accessToken}`;
      headers.apikey = supabaseAnonKey;
    }
    // Session refresh may finish after the deadline: never start a late upload.
    if (controller.signal.aborted) throw new MealAnalysisError('offline', getDictionary().errors.noConnection);
    const response = await fetch(url, {
      method: init?.method ?? 'GET', headers, signal: controller.signal,
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
    // Keep the deadline active while the body arrives, not only until headers.
    const payload = await response.json().catch(() => {
      if (response.ok) throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
      return null;
    });
    if (generation !== getLocalDataGeneration() || language !== getLanguage()) throw new MealAnalysisError('request-expired', getDictionary().errors.gatewayRequestExpired);
    const retryHeader = response.headers?.get('retry-after');
    const seconds = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader)-Date.now())/1000)) : NaN;
    return { ok: response.ok, status: response.status, retryAfter: Number.isFinite(seconds) ? Math.max(0, seconds) : undefined, json: async () => payload };
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (error instanceof MealAnalysisError) throw error;
    throw new MealAnalysisError('offline', getDictionary().errors.noConnection);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resize action for a photo of the given size: bound the LONG edge (portrait
 * photos used to keep a 2133 px height), never upscale, and bound the width
 * when the size is unknown. Cropping happens earlier, in the scan screen.
 */
export function photoResize(width: number, height: number, longEdge = PHOTO_LONG_EDGE): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return { width: longEdge };
  if (Math.max(width, height) <= longEdge) return null;
  return width >= height ? { width: longEdge } : { height: longEdge };
}

function photoSize(uri: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    try {
      Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export async function prepareMealPhoto(photoUri: string): Promise<PreparedMealPhoto> {
  const size = await photoSize(photoUri);
  const encode = (pass: (typeof PHOTO_PASSES)[number]) => {
    const resize = photoResize(size?.width ?? 0, size?.height ?? 0, pass.longEdge);
    return manipulateAsync(photoUri, resize ? [{ resize }] : [], {
      base64: true,
      compress: pass.compress,
      format: SaveFormat.JPEG,
    });
  };
  let result = await encode(PHOTO_PASSES[0]);

  for (const pass of PHOTO_PASSES.slice(1)) {
    if (result.base64 && result.base64.length <= TARGET_IMAGE_BASE64) break;
    const oversizedUri = result.uri;
    result = await encode(pass);
    deleteTemporaryPhoto(oversizedUri);
  }

  if (!result.base64) {
    throw new MealAnalysisError('provider-error', getDictionary().errors.photoNotPrepared);
  }
  if (result.base64.length > MAX_IMAGE_BASE64) {
    deleteTemporaryPhoto(result.uri);
    throw new MealAnalysisError('invalid-input', getDictionary().errors.gatewayPhotoTooLarge);
  }

  return {
    imageBase64: result.base64,
    // The gateway writes the dish title and the ingredient names in this
    // language; the USDA search term stays English either way.
    language: getLanguage(),
    locale: getLocale(),
    mimeType: 'image/jpeg',
    previewUri: result.uri,
  };
}

export function deleteTemporaryPhoto(uri: string | null | undefined) {
  if (!uri?.startsWith('file:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Camera cache cleanup is best effort and must not break the correction flow.
  }
}

export async function analyzePreparedPhoto(input: MealAnalysisInput, requestId: string): Promise<MealAnalysisResult> {
  return readAnalysisResponse(await gatewayFetch('/v1/analyze', {
    method: 'POST',
    body: { imageBase64: input.imageBase64, mimeType: input.mimeType, language: input.language, locale: input.locale, requestId, ingredientCorrection: 1, captureProtocol: 2, estimates: 1 },
  }));
}

async function readAnalysisResponse(response: GatewayResponse): Promise<MealAnalysisResult> {
  const payload = (await response.json().catch(() => null)) as (MealAnalysisResult & { code?: string; message?: string }) | null;
  if (!response.ok) {
    throw gatewayError(response, payload?.code, payload?.message);
  }
  if (!payload || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 12
    || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 160
    || !['high','medium'].includes(payload.confidence) || !Array.isArray(payload.warnings) || payload.warnings.some(w=>typeof w!=='string')
    || payload.items.some(item=> !item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || item.name.length>160
      || !Number.isFinite(item.amountG) || item.amountG<1 || item.amountG>5000 || !Number.isFinite(item.baseAmountG) || item.baseAmountG<1 || item.baseAmountG>5000
      || !Number.isFinite(item.portionFactor) || item.portionFactor<=0 || item.portionFactor>5000 || typeof item.included !== 'boolean'
      || !['high','medium'].includes(item.confidence) || !item.source || typeof item.source.label !== 'string'
      || !['bls','usda','open-food-facts','demo','kandro-catalog'].includes(item.source.provider))) {
    throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  }
  if (new Set(payload.items.map(item=>item.id)).size !== payload.items.length
    || payload.items.some(item=>item.source?.code !== 'unmatched' && (!item.nutritionPer100g || !validSearchResult({id:item.id,name:item.name,per100g:item.nutritionPer100g,defaultGrams:item.amountG,source:item.source as FoodSearchResult['source'],portions:item.portions})))) {
    throw new MealAnalysisError('invalid-response',getDictionary().errors.gatewayInvalidResponse);
  }
  // Only the explicit correction protocol may carry unresolved placeholders.
  // Malformed numbers in an otherwise resolved ingredient are never accepted.
  if (payload.items.some(item => needsIngredientCorrection(item)
    && !(payload.correctionRequired === true && item.source?.code === 'unmatched'))) {
    throw new MealAnalysisError('invalid-input', getDictionary().errors.gatewayMissingNutrition);
  }
  return localizeResult(payload);
}

export async function analyzeDescription(description: string, requestId: string): Promise<MealAnalysisResult> {
  return readAnalysisResponse(await gatewayFetch('/v1/describe', {
    method: 'POST',
    body: { description: description.trim(), language: getLanguage(), locale: getLocale(), requestId, ingredientCorrection: 1, captureProtocol: 2, estimates: 1 },
  }));
}

type BarcodePayload = {
  barcode: string;
  name: string;
  /** The record carried no usable name; the wording comes from the dictionary. */
  nameMissing?: boolean;
  per100g: Nutrition;
  portions?: { label: string; grams: number }[];
  source: MealItem['source'];
  code?: string;
  message?: string;
};

let unknownBarcode: string | null = null;
/** The last barcode no database knew, for the label-scan fallback. */
export function getUnknownBarcode() {
  return unknownBarcode;
}

export async function analyzeBarcode(barcode: string): Promise<MealAnalysisResult> {
  // The user's own product for this barcode ("Mein Produkt") answers first:
  // offline, free, and with the values from the label they photographed.
  const own = await findCustomFoodByBarcode(barcode);
  if (own) {
    const result = customFoodResult(own);
    const meal = mealFromSearch(result, result.defaultGrams);
    const serving = result.portions?.[0];
    return { ...meal, warnings: [serving ? getDictionary().errors.portionStartServing(serving.label, serving.grams) : getDictionary().errors.portionStartValue] };
  }
  const response = await gatewayFetch(`/v1/barcode/${encodeURIComponent(barcode)}?language=${getLanguage()}`);
  const payload = (await response.json().catch(() => null)) as BarcodePayload | null;
  if (!response.ok || !payload) {
    // Remembered so "Nährwerttabelle fotografieren" can link the new product.
    if (payload?.code === 'product_not_found' || payload?.code === 'missing_nutrition') unknownBarcode = barcode;
    throw gatewayError(response, payload?.code, payload?.message);
  }
  if (payload.barcode !== barcode || typeof payload.name !== 'string' || !validSearchResult({id:barcode,name:payload.name || getDictionary().errors.packagedFood,per100g:payload.per100g,defaultGrams:100,portions:payload.portions,source:payload.source})) {
    throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  }
  const nutrition = payload.per100g;
  // Also reject partial responses from an older gateway or a replayed request.
  if (!nutrition || ![nutrition.calories, nutrition.protein, nutrition.carbs, nutrition.fat]
    .every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || (nutrition.calories === 0 && nutrition.protein * 4 + nutrition.carbs * 4 + nutrition.fat * 9 > 5)) {
    throw new MealAnalysisError('product-not-found', gatewayMessage('missing_nutrition', undefined));
  }
  // An unnamed product used to arrive as the German "Verpacktes Lebensmittel"
  // from the gateway, regardless of who was reading it.
  const name = payload.nameMissing || !payload.name
    ? getDictionary().errors.packagedFood
    : payload.name;
  // Start from the pack's own serving (15 g of a spread, one bar) rather than
  // 100 g, which almost nobody eats; without a serving, 100 g stays explicit.
  const serving = payload.portions?.find((portion) => Number.isFinite(portion.grams) && portion.grams >= 1 && portion.grams <= 2000);
  const grams = serving?.grams ?? 100;
  const factor = grams / 100;
  return {
    title: name,
    confidence: 'high',
    warnings: [serving ? getDictionary().errors.portionStartServing(serving.label, grams) : getDictionary().errors.portionStartValue],
    items: [{
      id: `barcode-${payload.barcode}`,
      name,
      amountG: grams,
      baseAmountG: grams,
      portionFactor: 1,
      confidence: 'high',
      included: true,
      portions: payload.portions,
      source: payload.source,
      nutritionPer100g: nutrition,
      calories: Math.round(nutrition.calories * factor), protein: Math.round(nutrition.protein * factor),
      carbs: Math.round(nutrition.carbs * factor), fat: Math.round(nutrition.fat * factor),
      ...(nutrition.fiber === undefined ? {} : { fiber: Math.round(nutrition.fiber * factor) }),
    }],
  };
}

/** One nutrition-label read, per 100 g, before the user confirms it. */
export type LabelRead = {
  values: { calories: number | null; protein: number | null; carbs: number | null; sugar: number | null; fat: number | null; saturatedFat: number | null; fiber: number | null; salt: number | null };
  missing: string[];
  energyFromKj: boolean;
  basis: 'per_100g' | 'per_serving';
  serving: { grams: number; label: string | null } | null;
  packageG: number | null;
  name: string | null;
  brand: string | null;
  barcode: string | null;
  plausibility: { plausible: boolean; issues: string[]; blocking: string[]; atwaterKcal: number | null };
};

const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000);

/**
 * Reads a photographed nutrition table through the gateway. Costs one AI
 * analysis like a meal photo (refunded when unreadable or incomplete); the
 * caller shows every value for confirmation before anything is saved.
 */
export async function readNutritionLabel(table: MealAnalysisInput, requestId: string, options: { frontImageBase64?: string | null; barcode?: string | null } = {}): Promise<{ label: LabelRead; correctionRequired: boolean }> {
  const response = await gatewayFetch('/v1/label', {
    method: 'POST',
    body: {
      imageBase64: table.imageBase64, mimeType: table.mimeType, language: getLanguage(), locale: getLocale(), requestId, captureProtocol: 2,
      ...(options.frontImageBase64 ? { frontImageBase64: options.frontImageBase64 } : {}),
      ...(options.barcode && /^\d{7,14}$/.test(options.barcode) ? { barcode: options.barcode } : {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as { label?: LabelRead; correctionRequired?: boolean; code?: string; message?: string } | null;
  if (!response.ok) throw gatewayError(response, payload?.code, payload?.message);
  const label = payload?.label;
  if (!label || typeof label !== 'object' || !label.values || !Object.values(label.values).every(nullableNumber)
    || !Array.isArray(label.missing) || !label.plausibility || !Array.isArray(label.plausibility.issues) || !Array.isArray(label.plausibility.blocking)
    || (label.name !== null && typeof label.name !== 'string') || (label.brand !== null && typeof label.brand !== 'string')
    || (label.serving !== null && !(label.serving && Number.isFinite(label.serving.grams)))
    || (label.packageG !== null && !Number.isFinite(label.packageG))) {
    throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  }
  return { label, correctionRequired: payload?.correctionRequired === true };
}

/** The optional pack-front photo only needs to show the name: sent small. */
export async function prepareLabelFrontPhoto(photoUri: string): Promise<string> {
  const result = await manipulateAsync(photoUri, [{ resize: { width: 1024 } }], { base64: true, compress: 0.6, format: SaveFormat.JPEG });
  deleteTemporaryPhoto(result.uri);
  if (!result.base64 || result.base64.length > 1_500_000) throw new MealAnalysisError('invalid-input', getDictionary().errors.gatewayPhotoTooLarge);
  return result.base64;
}

export type FoodSearchResult = {
  id: string;
  name: string;
  per100g: Nutrition;
  defaultGrams: number;
  /** Named household portions ("1 banana", "1 slice"), when the source has any. */
  portions?: { label: string; grams: number; estimated?: boolean; kind?: string; unitOnly?: boolean }[];
  source: MealItem['source'];
  /** Amount the user logged last time; preselected in the portion sheet. */
  lastGrams?: number;
  /** Barcode an own product ("Mein Produkt") is linked to; used to drop duplicates. */
  barcode?: string;
  /** Official database label when `name` is the everyday name (BLS), shown small below it. */
  officialName?: string;
  /** Branded product: name without the brand, the brand, and the net package weight. */
  productName?: string;
  brand?: string;
  packageG?: number;
};

/**
 * Free-text food search.
 *
 * No model call and no quota: logging a banana should not spend one of three
 * free analyses, and should not take five seconds. That is also why this is
 * the cheapest path for us: every search is a lookup the AI never has to do.
 */
export type FoodSearchResults = FoodSearchResult[] & { searchStatus?: 'complete' | 'partial' | 'catalogue'; retryAfter?: number };

export async function searchFoods(query: string, options: { catalogueOnly?: boolean } = {}): Promise<FoodSearchResults> {
  const term = query.trim();
  if (term.length < 2) return [];
  const response = await gatewayFetch(
    `/v1/search?q=${encodeURIComponent(term)}&language=${getLanguage()}${options.catalogueOnly ? '&scope=catalogue' : ''}`,
  );
  const payload = (await response.json().catch(() => null)) as
    { results?: FoodSearchResult[]; searchStatus?: FoodSearchResults['searchStatus']; issues?: {code:string;retryAfter?:string}[]; code?: string; message?: string } | null;
  if (!response.ok) {
    throw gatewayError(response, payload?.code, payload?.message);
  }
  if (!payload || !Array.isArray(payload.results) || payload.results.length > 60 || !payload.results.every(validSearchResult)
    || new Set(payload.results.map(result=>result.id)).size !== payload.results.length
    || (payload.issues !== undefined && (!Array.isArray(payload.issues) || payload.issues.some(issue=>!issue || typeof issue.code !== 'string' || (issue.retryAfter !== undefined && typeof issue.retryAfter !== 'string'))))
    || (payload.searchStatus !== undefined && !['complete','partial','catalogue'].includes(payload.searchStatus))) {
    throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  }
  return Object.defineProperties(payload.results, {
    searchStatus: {value:payload.searchStatus},
    retryAfter: {value:Number(payload.issues?.find(issue=>issue.retryAfter)?.retryAfter) || undefined},
  });
}

/**
 * One branded product from the product search, in the shape the product
 * database route answers with. Values are per 100 g as published by the
 * source (Open Food Facts, directly or via Kandro's German product table).
 */
export type ProductHit = {
  code: string;
  name: string;
  brand?: string | null;
  stores?: string[] | null;
  packageG?: number | null;
  servingG?: number | null;
  per100g: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number | null };
  source: 'off' | 'productdb';
};

export type ProductSearchResults = {
  /** Generic foods the server added (BLS/USDA); merged into the "Lebensmittel" list. */
  generic: FoodSearchResult[];
  /** Branded products for the "Produkte & Marken" list. */
  products: FoodSearchResult[];
  searchStatus?: 'complete' | 'partial' | 'catalogue';
};

const gramsOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5000 ? Math.round(value * 10) / 10 : null;
const isProductHit = (value: unknown): value is ProductHit => {
  const hit = value as ProductHit | null;
  return Boolean(hit) && typeof hit!.code === 'string' && typeof hit!.per100g === 'object' && hit!.per100g !== null && 'kcal' in hit!.per100g;
};

/** Maps a product hit to a loggable search result; null when it is not usable. */
// Open Food Facts keeps some names HTML-escaped ("&quot;", "&amp;"), a few twice.
const HTML_ENTITIES: Record<string, string> = { '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&amp;': '&' };
export function decodeEntities(value: string) {
  let text = value;
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(/&(?:quot|#39|apos|lt|gt|nbsp|amp);/g, (entity) => HTML_ENTITIES[entity]);
    if (next === text) break;
    text = next;
  }
  return text;
}

export function productHitToResult(hit: ProductHit): FoodSearchResult | null {
  if (!isProductHit(hit) || !/^\d{7,14}$/.test(hit.code) || typeof hit.name !== 'string') return null;
  const productName = decodeEntities(hit.name).replace(/\s+/g, ' ').trim();
  const brand = typeof hit.brand === 'string' && hit.brand.trim() && hit.brand.trim().length <= 60 ? decodeEntities(hit.brand).replace(/\s+/g, ' ').trim() : undefined;
  if (!productName) return null;
  const { kcal, protein, carbs, fat, fiber } = hit.per100g;
  const serving = gramsOrNull(hit.servingG);
  const pack = gramsOrNull(hit.packageG);
  const labels = getDictionary().labelScan;
  const portions = [
    ...(serving ? [{ label: labels.portionServing(serving), grams: serving }] : []),
    ...(pack && pack !== serving ? [{ label: labels.portionPackage(pack), grams: pack }] : []),
  ];
  const result: FoodSearchResult = {
    id: `off-${hit.code}`,
    // The logged name keeps the brand, like a scanned barcode does.
    name: brand && !productName.toLowerCase().includes(brand.toLowerCase()) ? `${productName} (${brand})` : productName,
    productName,
    ...(brand ? { brand } : {}),
    ...(pack ? { packageG: pack } : {}),
    per100g: { calories: kcal, protein, carbs, fat, ...(typeof fiber === 'number' ? { fiber } : {}) },
    defaultGrams: serving ?? 100,
    portions,
    source: { provider: 'open-food-facts', referenceId: hit.code, label: `Open Food Facts ${hit.code}` },
  };
  return validSearchResult(result) ? result : null;
}

/** Older gateway rows name a product "Name (Brand)"; split that for display. */
function withProductParts(result: FoodSearchResult): FoodSearchResult {
  if (result.source.provider !== 'open-food-facts' || result.brand) return result;
  const match = result.name.match(/^(.*\S)\s+\(([^()]{1,60})\)$/);
  if (!match || !/[A-Za-zÄÖÜäöü]/.test(match[2]) || /^\d/.test(match[2])) return result;
  return { ...result, productName: match[1], brand: match[2] };
}

/**
 * Branded products for the search sheet. Runs on every debounced query, next
 * to the on-device catalogue, so common words ("Donut", "Skyr") show real
 * products too. `brands` is the store/own-brand hint ("lidl" → Milbona, …);
 * servers that do not know it ignore it. Accepts the product route's
 * `products: ProductHit[]` and the older `results: FoodSearchResult[]` rows.
 */
export async function searchProducts(query: string, options: { brands?: readonly string[] } = {}): Promise<ProductSearchResults> {
  const term = query.trim();
  if (term.length < 2) return { generic: [], products: [] };
  const brands = (options.brands ?? []).map(brand => brand.trim()).filter(brand => brand && brand.length <= 40 && !brand.includes(',')).slice(0, 30);
  const response = await gatewayFetch(
    `/v1/search?q=${encodeURIComponent(term)}&language=${getLanguage()}&scope=products${brands.length ? `&brands=${encodeURIComponent(brands.join(','))}` : ''}`,
  );
  const payload = (await response.json().catch(() => null)) as
    { results?: unknown[]; products?: unknown[]; searchStatus?: ProductSearchResults['searchStatus']; code?: string; message?: string } | null;
  if (!response.ok) throw gatewayError(response, payload?.code, payload?.message);
  if (!payload || (payload.results !== undefined && !Array.isArray(payload.results)) || (payload.products !== undefined && !Array.isArray(payload.products))
    || (payload.searchStatus !== undefined && !['complete', 'partial', 'catalogue'].includes(payload.searchStatus))) {
    throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  }
  const generic: FoodSearchResult[] = [];
  const products: FoodSearchResult[] = [];
  const seen = new Set<string>();
  for (const row of [...(payload.products ?? []), ...(payload.results ?? [])].slice(0, 80)) {
    // A single malformed row is skipped; it must not hide the others.
    const result = isProductHit(row) ? productHitToResult(row) : validSearchResult(row as FoodSearchResult) ? withProductParts(row as FoodSearchResult) : null;
    if (!result || seen.has(result.id)) continue;
    seen.add(result.id);
    (result.source.provider === 'open-food-facts' ? products : generic).push(result);
  }
  return { generic, products, searchStatus: payload.searchStatus };
}

/** A branded drink can be corrected with the digits on its actual label. */
export async function searchIngredientReplacement(query: string): Promise<FoodSearchResults> {
  const term = query.trim();
  let results: FoodSearchResults;
  if (/^\d{7,14}$/.test(term)) {
    const { items: [item] } = await analyzeBarcode(term);
    results = [{ id: item.id, name: item.name, per100g: item.nutritionPer100g!, defaultGrams: 100, portions: item.portions, source: item.source }];
  } else {
    results = await searchFoods(term);
  }
  if (!results.every(validSearchResult)) throw new MealAnalysisError('invalid-response', getDictionary().errors.gatewayInvalidResponse);
  return results;
}

/**
 * Turns a chosen search result into a meal the rest of the app already knows
 * how to handle: same shape as a scanned one, so the timeline, the cloud sync
 * and the ingredient list need no special case.
 */
export function mealFromSearch(result: FoodSearchResult, grams: number): MealAnalysisResult {
  if (!validSearchResult(result) || !Number.isFinite(grams) || grams < 1 || grams > 5000) throw new MealAnalysisError('invalid-input', getDictionary().errors.gatewayInvalidInput);
  const factor = grams / 100;
  const scale = (value: number) => Math.round(value * factor);
  return {
    title: result.name,
    confidence: 'high',
    warnings: [],
    items: [{
      id: `search-${result.id}`,
      name: result.name,
      amountG: grams,
      baseAmountG: grams,
      nutritionPer100g: { ...result.per100g },
      portionFactor: 1,
      calories: scale(result.per100g.calories),
      protein: scale(result.per100g.protein),
      carbs: scale(result.per100g.carbs),
      fat: scale(result.per100g.fat),
      ...(result.per100g.fiber === undefined ? {} : {fiber: scale(result.per100g.fiber)}),
      confidence: 'high',
      included: true,
      // Carried through so re-opening the amount on the confirm screen still
      // offers "1 banana" rather than dropping back to grams only.
      portions: result.portions,
      source: result.source,
    }],
  };
}

export type CaptureCapabilities = { gemini: boolean; searchAssistance: boolean; consentVersion: string };
export type SearchAssistance = { proposal?: { canonical: string; preserve: string[]; question: string; candidateIds: string[]; variants: string[] }; results: FoodSearchResult[]; confirmationRequired: boolean };
export async function captureCapabilities(): Promise<CaptureCapabilities | null> {
  const response=await gatewayFetch('/v1/capture-capabilities');
  if (response.status===404) return null; // Build 19 gateway has no candidate capability.
  const body=await response.json();
  if (!response.ok) throw gatewayError(response,body?.code);
  if(typeof body?.gemini!=='boolean'||typeof body?.searchAssistance!=='boolean'||typeof body?.consentVersion!=='string') throw new MealAnalysisError('invalid-response',getDictionary().errors.gatewayInvalidResponse);
  return body;
}
export async function setCaptureAiConsent(version: string, accepted: boolean, scope: 'search' | 'analysis' = 'search') {
  const response=await gatewayFetch('/v1/ai-consent',{method:'POST',body:{version,accepted,scope}});
  const body=await response.json();
  if(!response.ok)throw gatewayError(response,body?.code);
  if(body?.accepted!==accepted)throw new MealAnalysisError('invalid-response',getDictionary().errors.gatewayInvalidResponse);
}
export async function assistFoodSearch(query: string, requestId: string): Promise<SearchAssistance> {
  const response=await gatewayFetch('/v1/search-assist',{method:'POST',body:{query,requestId,language:getLanguage()}});
  const body=await response.json();
  if(!response.ok)throw gatewayError(response,body?.code);
  if(!body||typeof body.confirmationRequired!=='boolean'||!Array.isArray(body.results)||!body.results.every(validSearchResult)
    || (body.confirmationRequired && (!body.proposal || typeof body.proposal.canonical!=='string'||body.proposal.canonical.length>120||typeof body.proposal.question!=='string'||body.proposal.question.length>240))) throw new MealAnalysisError('invalid-response',getDictionary().errors.gatewayInvalidResponse);
  return body;
}
