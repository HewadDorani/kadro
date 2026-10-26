import { invalidatePrivateData } from '@/services/localRepository';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalDay } from '@/hooks/useLocalDay';

import { AnalysisErrorKind, MealAnalysisInput } from '@/services/contracts';
import { foodUsage } from '@/services/foodSuggest';
import { estimateDescriptionPortions, parseLocalDescription, resolveUnmatchedItems } from '@/services/localDescription';
import { analyzeBarcode, analyzeDescription, analyzePreparedPhoto, deleteTemporaryPhoto, FoodSearchResult, MealAnalysisError, mealFromSearch, prepareMealPhoto } from '@/services/mealAnalysis';
import {
  beginLocalAccountSwitch,
  clearLocalKandroData,
  completeLocalAccountSwitch,
  loadAllStoredScans,
  loadAnalysisQueue,
  loadLifetimeScanCount,
  loadMeals,
  loadProfile,
  loadWeightEntries,
  queueAnalysis,
  removeQueuedAnalysis,
  saveLifetimeScanCount,
  saveProfile,
  saveWeightEntry,
  clearAnalysisQueue,
  countLifetimeScanOnce,
  loadLocalAccountSwitch,
  replaceLocalAccountData,
  subscribeLocalMeals, getLocalDataGeneration,
} from '@/services/localRepository';
import {
  createPlannedMeal,
  createScannedMeal,
  DEFAULT_TARGETS,
  DETECTED_ITEMS,
  getDemoItems,
  getRemaining,
  nutritionFromItems,
  sumMeals,
} from '@/services/mockNutrition';
import { useFreeScanAllowance } from '@/hooks/useHardWall';
import { calculateDailyTargets, DEFAULT_PROFILE } from '@/services/personalization';
import { availableRepeats, FavoriteMeal, findFavorite, RepeatCandidate, scaleMealPortion } from '@/services/repeatMeals';
import { addFavorite, getFavoriteMealsSnapshot, loadFavorites, removeFavorite, renameFavorite, setFavoriteCloudEnabled, subscribeFavoriteMeals, syncFavorites } from '@/services/favoriteMeals';
import { deleteSyncedMeal, hydrateCloudState, hydrateExistingCloudAccount, saveSyncedMeal, syncUserSetup, SyncMode } from '@/services/syncRepository';
import { getCurrentSessionUserId, isSupabaseConfigured, rememberSupabaseUser, startSupabaseAuthLifecycle, supabase } from '@/services/supabaseClient';
import { applyAnalyticsAgePolicy, captureOperationalError, clearTelemetryForAccountSwitch, countBucket, durationBucket, trackEvent } from '@/services/telemetry';
import { DailyTargets, Meal, MealItem, MealSuggestion, Nutrition, PortionFactor, UserProfile, WeightEntry } from '@/types/nutrition';
import { localDateKey } from '@/utils/date';
import { mealTypeForHour } from '@/utils/daypart';
import { clampLogDate, mealMoment } from '@/utils/mealDay';
import { itemNutritionPer100g } from '@/utils/portions';
import { getDictionary } from '@/i18n/active';
import type { UnitSystem } from '@/utils/units';
import { normalizeWeightKg } from '@/utils/units';
import { clearLocalWellnessConsent, forgetLocalWellnessConsent, hasCurrentWellnessConsent, recordWellnessConsent, withdrawWellnessConsent as withdrawStoredWellnessConsent } from '@/services/consent';
import { clearRemindersForAccountSwitch, setEveningReminderEnabled } from '@/services/reminders';
import { formatClockTime } from '@/utils/format';
import { newAnalysisRequestId } from '@/utils/requestId';
import { canSaveMealDraft, needsIngredientCorrection, replaceMealIngredient } from '@/utils/ingredientCorrection';
import { AccountLinkState, AppleAccountCredential, appleReferenceFromUser, recoverAppleSession, signInToExistingAccount, signInWithApple } from '@/services/accountLinking';

import { clearAppleReauthentication, clearAppleTokenPending, createAppleCredentialMonitor, loadAppleReauthentication, loadAppleTokenPending, requireAppleReauthentication, selectAppleRecoveryReference } from '@/services/appleReauthentication';
import type { AppleAccountReference } from '@/services/appleReauthentication';

export type AnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'queued' | 'error';
/** What the client is actually doing right now; the gateway reports no finer steps. */
export type AnalysisPhase = 'preparing' | 'analysing';
/** Amount errors an older gateway still answers with 422 instead of an estimate. */
const AMOUNT_ERROR_CODES = new Set(['mass_required', 'amount_ambiguous', 'amount_out_of_range']);
type ScanMode = 'live' | 'demo' | 'queued' | 'description' | 'barcode' | 'search' | 'plan';

/**
 * Inputs that never reach the model, and therefore never spend one of the
 * three free meals. Search is the reason this exists: it is a database lookup
 * the sheet openly labels as free.
 */
const FREE_ANALYSIS_MODES = new Set<ScanMode>(['demo', 'search', 'barcode', 'plan']);

function telemetryScanSource(mode: ScanMode) {
  if (mode === 'live') return 'camera' as const;
  if (mode === 'queued') return 'queued_retry' as const;
  if (mode === 'description') return 'description' as const;
  if (mode === 'barcode') return 'barcode' as const;
  // A supermarket basket from Plan is a set of database products, like search.
  if (mode === 'search' || mode === 'plan') return 'search' as const;
  return 'demo' as const;
}

type AppContextValue = {
  userName: string;
  profile: UserProfile;
  hydrationReady: boolean;
  localStorageError: boolean;
  appleReauthenticationRequired: boolean;
  wellnessConsentGranted: boolean;
  targets: DailyTargets;
  meals: Meal[];
  mealHistory: Meal[];
  weightEntries: WeightEntry[];
  consumed: Nutrition;
  remaining: Nutrition;
  detectedItems: MealItem[];
  scannedMeal: Meal;
  photoUri: string | null;
  scanMode: ScanMode;
  descriptionInput: string;
  hasLoggedScan: boolean;
  hasEverLoggedScan: boolean;
  lifetimeScanCount: number;
  freeScansLeft: number;
  isCurrentScanLogged: boolean;
  mealPortion: PortionFactor | null;
  analysisStatus: AnalysisStatus;
  analysisPhase: AnalysisPhase | null;
  /** The amounts are a typical portion, not something Kandro could read off the input. */
  portionEstimated: boolean;
  /** Ingredients the gateway could not price that Kandro matched itself; the user should glance at them. */
  autoMatchedItemIds: string[];
  analysisError: AnalysisErrorKind | null;
  analysisMessage: string | null;
  pendingAnalysisCount: number;
  syncMode: SyncMode;
  refreshCloudState: () => Promise<void>;
  loadExistingAccount: (email: string, password: string) => Promise<AccountLinkState>;
  loadAppleAccount: (credential: AppleAccountCredential) => Promise<AccountLinkState>;
  retryAccountRecovery: (credential?: AppleAccountCredential) => Promise<void>;
  grantWellnessConsent: (age?: number) => Promise<void>;
  withdrawWellnessConsent: () => Promise<void>;
  completeOnboarding: (profile: UserProfile) => Promise<void>;
  setUnitSystem: (unitSystem: UnitSystem) => Promise<void>;
  addWeightEntry: (weightKg: number) => Promise<void>;
  setCapturedPhoto: (uri: string) => void;
  startDemoScan: () => void;
  startDescriptionScan: (description: string) => void;
  startBarcodeScan: (barcode: string) => void;
  applySearchResult: (result: FoodSearchResult, grams: number) => void;
  /** Puts several known products (a Plan → Supermarkt basket) on the confirm screen as one meal. Free, no analysis. */
  /** `title` names the meal (a chain order: "Nando's: Chicken Butterfly"); else the item names. */
  startPlannedDraft: (entries: { result: FoodSearchResult; grams: number }[], title?: string) => void;
  /** Logs the foods picked in one search session as one meal (free, no confirmation screen). */
  logFoodsDirect: (entries: { result: FoodSearchResult; grams: number }[]) => Promise<Meal>;
  replaceDetectedItem: (id: string, result: FoodSearchResult, grams: number) => void;
  removeDetectedItem: (id: string) => void;
  /** freshRequest: retry a failed analysis under a new request id (the server refunded the failed one). */
  analyzeCurrentPhoto: (forceDemo?: boolean, freshRequest?: boolean) => Promise<void>;
  resumeLatestAnalysis: () => Promise<boolean>;
  /** Stops waiting for the running analysis; a late answer is ignored. The input is kept. */
  cancelAnalysis: () => void;
  adjustItem: (id: string, direction: -1 | 1) => void;
  setItemAmount: (id: string, grams: number) => void;
  setMealPortion: (factor: PortionFactor) => void;
  toggleItem: (id: string) => void;
  resetScan: () => void;
  resetAfterAccountDeletion: () => void;
  /** Saves the confirmed draft and returns the meal as stored. */
  logScannedMeal: () => Promise<Meal>;
  logPlannedMeal: (suggestion: MealSuggestion, portion: PortionFactor) => Promise<Meal>;
  repeatMeals: RepeatCandidate[];
  /**
   * Logs a meal again for free. `target` states the slot and day chosen in a
   * sheet ("Als Abendessen eintragen"); without it the slot chosen on Today,
   * else the clock. `portion` scales the stored grams (Weniger / Passt / Mehr).
   */
  logRepeatMeal: (candidate: RepeatCandidate, target?: RepeatTarget) => Promise<Meal>;
  deleteLoggedMeal: (id: string) => Promise<void>;
  adjustLoggedMealPortion: (id: string, factor: PortionFactor) => Promise<void>;
  /** Corrects one ingredient of a saved meal; the other ingredients keep their amounts. */
  setLoggedItemAmount: (id: string, itemId: string, grams: number) => Promise<void>;
  setLoggedMealType: (id: string, type: Meal['type']) => Promise<void>;
  /** Slot chosen before scanning, so a late breakfast is not filed as lunch. */
  plannedMealType: Meal['type'] | null;
  setPlannedMealType: (type: Meal['type'] | null) => void;
  /** Day chosen for the next meal (Today's day switcher or Confirm); null means today. */
  plannedMealDate: string | null;
  setPlannedMealDate: (date: string | null) => void;
  /** Where the current draft will be filed: the chosen slot and day, else the clock and today. */
  scanTarget: { type: Meal['type']; date: string };
  favoriteMeals: FavoriteMeal[];
  toggleFavoriteMeal: (meal: Meal) => Promise<void>;
  /** Stars a meal exactly as logged (items and grams); replaces an older portion of the same name. */
  addFavoriteMeal: (meal: Meal) => Promise<void>;
  removeFavoriteMeal: (id: string) => Promise<void>;
  renameFavoriteMeal: (id: string, title: string) => Promise<void>;
  /**
   * The star on Confirm and Result. Before the draft is saved it is a wish
   * that the save fulfils with the meal as stored; once saved it writes now.
   */
  scanFavorite: boolean;
  setScanFavorite: (on: boolean) => Promise<void>;
};

export type RepeatTarget = { type?: Meal['type']; date?: string | null; portion?: PortionFactor };

const AppContext = createContext<AppContextValue | null>(null);

function countScans(meals: Meal[]) {
  return meals.filter((meal) => meal.origin === 'scan').length;
}

function makeScanId() {
  return newAnalysisRequestId();
}

function scaleItem(item: MealItem, nextAmount: number): MealItem {
  if (needsIngredientCorrection(item)) return item;
  // A provider that reports a zero amount would otherwise turn every macro into
  // Infinity or NaN on the first correction tap.
  const reference = itemNutritionPer100g(item);
  const ratio = nextAmount / 100;
  return {
    ...item,
    amountG: nextAmount,
    nutritionPer100g: reference,
    portionFactor: nextAmount / item.baseAmountG,
    calories: Math.round(reference.calories * ratio),
    protein: Math.round(reference.protein * ratio),
    carbs: Math.round(reference.carbs * ratio),
    fat: Math.round(reference.fat * ratio),
    fiber: Math.round((reference.fiber ?? 0) * ratio),
  };
}

export function AppProvider({ children }: PropsWithChildren) {
  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const profileRef = useRef(profile);
  const setProfile = useCallback((next: UserProfile) => {
    profileRef.current = next;
    setProfileState(next);
  }, []);
  const [hydrationReady, setHydrationReady] = useState(false);
  const [appleReauthenticationRequired, setAppleReauthenticationRequired] = useState(false);
  const hydrationReadyRef = useRef(false);
  hydrationReadyRef.current = hydrationReady;
  const [localStorageError, setLocalStorageError] = useState(false);
  const [wellnessConsentGranted, setWellnessConsentGranted] = useState(false);
  const [targets, setTargets] = useState(DEFAULT_TARGETS);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealHistory, setMealHistory] = useState<Meal[]>([]);
  const [lifetimeScanCount, setLifetimeScanCount] = useState(0);
  const correctionDraftRef = useRef(false);
  const repeatInFlightRef = useRef(new Map<string, Promise<Meal>>());
  const unitWritesInFlightRef = useRef(0);
  const [weightEntries, setWeightEntries] = useState<WeightEntry[]>([]);
  const [detectedItems, setDetectedItems] = useState<MealItem[]>(getDemoItems);
  const [mealTitle, setMealTitle] = useState(getDictionary().errors.demoMealTitle);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scanId, setScanId] = useState(makeScanId);
  const [scanMode, setScanMode] = useState<ScanMode>('demo');
  const photoUriRef = useRef<string | null>(null);
  const scanModeRef = useRef<ScanMode>('demo');
  const [plannedMealType, setPlannedMealTypeState] = useState<Meal['type'] | null>(null);
  const plannedMealTypeRef = useRef<Meal['type'] | null>(null);
  const [plannedMealDate, setPlannedMealDateState] = useState<string | null>(null);
  const plannedMealDateRef = useRef<string | null>(null);
  const [favoriteMeals, setFavoriteMeals] = useState<FavoriteMeal[]>(getFavoriteMealsSnapshot);
  // The star on Confirm/Result for the current draft, by scan id.
  const [favoriteDraftScanId, setFavoriteDraftScanId] = useState<string | null>(null);
  const [queuedInput, setQueuedInput] = useState<MealAnalysisInput | null>(null);
  const [descriptionInput, setDescriptionInput] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [mealPortion, setMealPortionState] = useState<PortionFactor | null>(1);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase | null>(null);
  const [portionEstimated, setPortionEstimated] = useState(false);
  const [autoMatchedItemIds, setAutoMatchedItemIds] = useState<string[]>([]);
  const [analysisError, setAnalysisError] = useState<AnalysisErrorKind | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [pendingAnalysisCount, setPendingAnalysisCount] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>(isSupabaseConfigured ? 'syncing' : 'local');
  const loadedDayRef = useRef(localDateKey());
  const currentDay = useLocalDay();
  // Each new input invalidates every older async analysis. The provider call
  // may still finish (and its successful quota spend still has to be counted),
  // but a late response must never replace a newer meal on screen.
  const analysisGenerationRef = useRef(0);
  // Separate from screen-generation: a successful request may spend a credit
  // after the user starts another scan, but never after the Supabase identity
  // changes underneath it.
  const analysisIdentityGenerationRef = useRef(0);
  const inFlightAnalysisIdsRef = useRef<Set<string>>(new Set());

  /** Raises the persisted lifetime counter to whatever we just observed. */
  const adoptScanCount = useCallback(async (observedScans: number) => {
    const stored = await loadLifetimeScanCount();
    const next = Math.max(stored, observedScans);
    setLifetimeScanCount(next > stored ? await saveLifetimeScanCount(next) : stored);
  }, []);

  /** Adopt age privacy policy before exposing or persisting a hydrated profile. */
  const adoptProfile = useCallback(async (nextProfile: UserProfile) => {
    const generation = getLocalDataGeneration();
    await applyAnalyticsAgePolicy(nextProfile.completedAt ? nextProfile.age : null);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    await saveProfile(nextProfile);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setProfile(nextProfile);
  }, []);

  const adoptExistingAccountState = useCallback(async (cloudState: NonNullable<Awaited<ReturnType<typeof hydrateExistingCloudAccount>>>) => {
    const observedScans = Math.max(countScans(cloudState.mealHistory), cloudState.hasEverLoggedScan ? 1 : 0);
    const storedCount = await replaceLocalAccountData(cloudState.profile, cloudState.mealHistory, observedScans);
    await Promise.all([
      clearLocalWellnessConsent(),
      clearRemindersForAccountSwitch(),
    ]);
    setMeals(cloudState.meals);
    setMealHistory(cloudState.mealHistory);
    setLifetimeScanCount(storedCount);
    setWeightEntries([]);
    setTargets(cloudState.targets);
    await adoptProfile(cloudState.profile);
    setPendingAnalysisCount(0);
    setWellnessConsentGranted(false);
    setSyncMode('local');
    await completeLocalAccountSwitch();
  }, [adoptProfile]);

  const restoreLocalStateAfterFailedLogin = useCallback(async () => {
    const [storedMeals, storedHistory, queue, storedProfile, storedWeights, storedScanCount, hasConsent] = await Promise.all([
      loadMeals(),
      loadAllStoredScans(),
      loadAnalysisQueue(),
      loadProfile(),
      loadWeightEntries(),
      loadLifetimeScanCount(),
      hasCurrentWellnessConsent(),
    ]);
    setMeals(storedMeals);
    setMealHistory(storedHistory);
    setLifetimeScanCount(Math.max(storedScanCount, countScans(storedHistory)));
    setPendingAnalysisCount(queue.length);
    setProfile(storedProfile);
    setWeightEntries(storedWeights);
    setTargets(storedProfile.completedAt ? calculateDailyTargets(storedProfile) : DEFAULT_TARGETS);
    await applyAnalyticsAgePolicy(storedProfile.completedAt ? storedProfile.age : null);
    setWellnessConsentGranted(hasConsent);
    setSyncMode('local');
  }, []);

  const pauseRevokedAppleSession = useCallback(async (reference: AppleAccountReference) => {
    analysisGenerationRef.current += 1;
    analysisIdentityGenerationRef.current += 1;
    hydrationReadyRef.current = false;
    setAppleReauthenticationRequired(true);
    setHydrationReady(false);
    setWellnessConsentGranted(false);
    setSyncMode('error');
    // Persist the original identity before signing out. Keep the diary, queued
    // meals and consent on disk; only that same account may reopen them.
    await requireAppleReauthentication(reference);
    rememberSupabaseUser(null);
    if (await getCurrentSessionUserId() === reference.userId) {
      await supabase?.auth.signOut({ scope: 'local' });
    }
  }, []);

  const appleCredentialMonitor = useMemo(() => createAppleCredentialMonitor({
    generation: () => analysisIdentityGenerationRef.current,
    readIdentity: async () => {
      if (Platform.OS !== 'ios' || !supabase) return null;
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return appleReferenceFromUser(data.session?.user ?? null);
    },
    readCredentialState: async (appleUserId) => {
      const state = await AppleAuthentication.getCredentialStateAsync(appleUserId);
      const states = AppleAuthentication.AppleAuthenticationCredentialState;
      if (state === states.REVOKED) return 'revoked';
      if (state === states.NOT_FOUND) return 'not-found';
      if (state === states.TRANSFERRED) return 'transferred';
      return state === states.AUTHORIZED ? 'authorized' : 'unavailable';
    },
    onRevoked: pauseRevokedAppleSession,
  }), [pauseRevokedAppleSession]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    appleCredentialMonitor.start();
    const check = () => {
      if (!hydrationReadyRef.current) return;
      void appleCredentialMonitor.check().catch(() => {
        setLocalStorageError(true);
        setHydrationReady(false);
        setSyncMode('error');
      });
    };
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    const revoked = AppleAuthentication.addRevokeListener(check);
    return () => { foreground.remove(); revoked.remove(); appleCredentialMonitor.stop(); };
  }, [appleCredentialMonitor]);

  const retryAccountRecovery = useCallback(async (credential?: AppleAccountCredential) => {
    analysisGenerationRef.current += 1;
    analysisIdentityGenerationRef.current += 1;
    setHydrationReady(false);
    setWellnessConsentGranted(false);
    setSyncMode('syncing');
    let destinationConfirmed = false;
    try {
      const [pendingSwitch, sessionUserId, appleRecovery, tokenPending] = await Promise.all([
        loadLocalAccountSwitch(),
        getCurrentSessionUserId(),
        loadAppleReauthentication(),
        loadAppleTokenPending(),
      ]);
      let currentUserId = sessionUserId;
      const needsApple = selectAppleRecoveryReference({ reauthentication: appleRecovery, tokenPending, previousUserId: pendingSwitch?.previousUserId ?? null, currentUserId });
      if (needsApple) {
        setAppleReauthenticationRequired(true);
        if (!credential) throw new Error(getDictionary().account.appleRecoveryText);
        const recovered = await recoverAppleSession(credential);
        if (recovered.status !== 'linked' || recovered.userId !== needsApple.userId) throw new Error(getDictionary().account.appleRecoveryWrong);
        currentUserId = recovered.userId;
      }
      // For a revoked current account restore its existing local state, including
      // unsynced meals. A confirmed earlier account switch still hydrates its
      // destination through the established guarded replacement path below.
      if (needsApple && (!pendingSwitch || currentUserId === pendingSwitch.previousUserId)) {
        await restoreLocalStateAfterFailedLogin();
        await completeLocalAccountSwitch();
        await clearAppleReauthentication();
        appleCredentialMonitor.reset();
        setAppleReauthenticationRequired(false);
        setLocalStorageError(false);
        setHydrationReady(true);
        return;
      }
      if (needsApple) {
        await clearAppleReauthentication();
        appleCredentialMonitor.reset();
        setAppleReauthenticationRequired(false);
      }
      if (!pendingSwitch) {
        // Retry a failed local read without resetting or replacing the diary.
        await restoreLocalStateAfterFailedLogin();
        setLocalStorageError(false);
        setHydrationReady(true);
        return;
      }
      if (!currentUserId || currentUserId === pendingSwitch.previousUserId) {
        // The first cold-start session read may have failed even though auth
        // never changed. A successful retry can now prove that this was only a
        // pre-login interruption, so restore A's local state and retire the
        // crash marker instead of trapping the user in the recovery gate.
        await restoreLocalStateAfterFailedLogin();
        await completeLocalAccountSwitch();
        setHydrationReady(true);
        return;
      }
      destinationConfirmed = true;
      await clearTelemetryForAccountSwitch();
      await Promise.all([clearLocalWellnessConsent(), clearRemindersForAccountSwitch()]);
      const cloudState = await hydrateExistingCloudAccount();
      if (!cloudState) throw new Error(getDictionary().errors.permanentAccountNotLoaded);
      if (tokenPending && tokenPending.userId !== currentUserId) await clearAppleTokenPending(tokenPending.userId);
      await adoptExistingAccountState(cloudState);
      setAppleReauthenticationRequired(false);
      setHydrationReady(true);
    } catch (error) {
      // Keep the durable switch marker. A transient fetch failure after auth
      // must never open onboarding under the new identity, where defaults from
      // this device could overwrite the account being restored.
      if (destinationConfirmed) {
        await Promise.all([
          clearLocalKandroData(),
          clearLocalWellnessConsent(),
          clearRemindersForAccountSwitch(),
          clearTelemetryForAccountSwitch(),
        ]).catch(() => undefined);
      }
      setProfile(DEFAULT_PROFILE);
      setTargets(DEFAULT_TARGETS);
      setMeals([]);
      setMealHistory([]);
      setFavoriteMeals([]);
      setLifetimeScanCount(0);
      setWeightEntries([]);
      setPendingAnalysisCount(0);
      setWellnessConsentGranted(false);
      setSyncMode('error');
      setHydrationReady(false);
      throw error;
    }
  }, [adoptExistingAccountState, restoreLocalStateAfterFailedLogin, appleCredentialMonitor]);

  const switchAccount = useCallback(async (signIn: () => Promise<AccountLinkState>) => {
    const previousUserId = await getCurrentSessionUserId();
    if (!previousUserId) throw new Error(getDictionary().errors.sessionNotLoaded);
    analysisGenerationRef.current += 1;
    analysisIdentityGenerationRef.current += 1;
    setHydrationReady(false);
    setWellnessConsentGranted(false);
    setSyncMode('syncing');
    // A durable marker precedes the auth mutation. Launch recovery then knows
    // that the local data belongs to the previous identity even after a crash.
    let identityChanged = false;
    try {
      await beginLocalAccountSwitch(previousUserId);
      await clearTelemetryForAccountSwitch();
      const account = await signIn();
      identityChanged = true;
      // Stop exposing the old identity synchronously before the first cloud
      // read under the new Supabase session.
      deleteTemporaryPhoto(photoUriRef.current);
      photoUriRef.current = null;
      scanModeRef.current = 'demo';
      setProfile(DEFAULT_PROFILE);
      setTargets(DEFAULT_TARGETS);
      setMeals([]);
      setMealHistory([]);
      setFavoriteMeals([]);
      setLifetimeScanCount(0);
      setWeightEntries([]);
      setPhotoUri(null);
      setQueuedInput(null);
      setPendingAnalysisCount(0);

      await retryAccountRecovery();
      setDetectedItems(getDemoItems());
      setMealTitle(getDictionary().errors.demoMealTitle);
      setScanId(makeScanId());
      setScanMode('demo');
      setDescriptionInput('');
      setBarcodeInput('');
      setMealPortionState(1);
      setAnalysisStatus('idle');
      setAnalysisError(null);
      setAnalysisMessage(null);
      setHydrationReady(true);
      return account;
    } catch (error) {
      // Auth can persist the destination session before a subscriber rejects.
      // A rejected sign-in therefore does not prove that identity stayed put.
      if (!identityChanged) {
        const currentUserId = await getCurrentSessionUserId().catch(() => null);
        identityChanged = currentUserId !== previousUserId;
      }
      if (identityChanged) {
        rememberSupabaseUser(null);
        const pendingApple = await loadAppleTokenPending().catch(() => null);
        const currentUserId = await getCurrentSessionUserId().catch(() => null);
        if (selectAppleRecoveryReference({ reauthentication: null, tokenPending: pendingApple, previousUserId, currentUserId })) setAppleReauthenticationRequired(true);
        // Keep the durable marker and old data hidden until recovery verifies
        // the destination. An unreadable session must fail closed as well.
        setSyncMode('error');
        setHydrationReady(false);
      } else {
        await completeLocalAccountSwitch().catch(() => undefined);
        await restoreLocalStateAfterFailedLogin();
        setHydrationReady(true);
      }
      throw error;
    }
  }, [restoreLocalStateAfterFailedLogin, retryAccountRecovery]);
  const loadExistingAccount = useCallback((email: string, password: string) => switchAccount(() => signInToExistingAccount(email, password)), [switchAccount]);
  const loadAppleAccount = useCallback((credential: AppleAccountCredential) => switchAccount(() => signInWithApple(credential)), [switchAccount]);

  useEffect(() => {
    if (!hydrationReady || !wellnessConsentGranted) return;
    let active = true;
    let latestRead = 0;
    const unsubscribe = subscribeLocalMeals(() => {
      const request = ++latestRead;
      const generation = getLocalDataGeneration();
      void Promise.all([loadAllStoredScans(), loadLocalAccountSwitch()]).then(([history, switching]) => {
        if (!active || request !== latestRead || switching || generation !== getLocalDataGeneration()) return;
        setMealHistory(history);
        setMeals(history.filter((meal) => meal.date === localDateKey()));
      }).catch(() => undefined);
    });
    return () => { active = false; unsubscribe(); };
  }, [hydrationReady, wellnessConsentGranted]);

  // Favourites live in services/favoriteMeals (device first). The screen
  // follows that store; it resets itself on every account switch or reset.
  useEffect(() => subscribeFavoriteMeals(() => setFavoriteMeals(getFavoriteMealsSnapshot())), []);
  // Reload whenever the diary is hydrated again (every account switch), and
  // sync with the cloud copy only with wellness consent, like the diary.
  useEffect(() => {
    setFavoriteCloudEnabled(hydrationReady && wellnessConsentGranted);
    if (!hydrationReady) return;
    void loadFavorites()
      .then(() => (wellnessConsentGranted ? syncFavorites() : undefined))
      .catch(() => undefined);
  }, [hydrationReady, wellnessConsentGranted]);

  const refreshCloudState = useCallback(async () => {
    if (!wellnessConsentGranted) {
      setSyncMode('local');
      return;
    }
    if (!isSupabaseConfigured) {
      setSyncMode('local');
      return;
    }
    setSyncMode('syncing');
    try {
      const cloudState = await hydrateCloudState();
      if (!cloudState) {
        setSyncMode('local');
        return;
      }
      setMeals(cloudState.meals);
      setMealHistory(cloudState.mealHistory);
      await adoptScanCount(Math.max(countScans(cloudState.mealHistory), cloudState.hasEverLoggedScan ? 1 : 0));
      setTargets(cloudState.targets);
      await adoptProfile(cloudState.profile);
      setSyncMode(cloudState.hasPendingChanges ? 'error' : 'cloud');
    } catch (error) {
      setSyncMode('error');
      captureOperationalError(error, { area: 'cloud_sync', operation: 'refresh_cloud_state' });
      throw error;
    }
  }, [adoptProfile, adoptScanCount, wellnessConsentGranted]);

  useEffect(() => {
    let active = true;
    let stopAuthLifecycle: () => void = () => undefined;
    void (async () => {
      await appleCredentialMonitor.check();
      const [storedMeals, storedHistory, queue, storedProfile, storedWeights, storedScanCount, hasConsent, pendingAccountSwitch, appleRecovery, tokenPending] = await Promise.all([
        loadMeals(),
        loadAllStoredScans(),
        loadAnalysisQueue(),
        loadProfile(),
        loadWeightEntries(),
        loadLifetimeScanCount(),
        hasCurrentWellnessConsent(),
        loadLocalAccountSwitch(),
        loadAppleReauthentication(),
        loadAppleTokenPending(),
      ]);
      if (!active) return;
      const startupAppleRecovery = selectAppleRecoveryReference({ reauthentication: appleRecovery, tokenPending, previousUserId: pendingAccountSwitch?.previousUserId ?? null, currentUserId: tokenPending ? await getCurrentSessionUserId().catch(() => null) : null });
      if (startupAppleRecovery) {
        setAppleReauthenticationRequired(true);
        setSyncMode('error');
        setHydrationReady(false);
        return;
      }
      if (pendingAccountSwitch) {
        let currentUserId: string | null;
        try {
          currentUserId = await getCurrentSessionUserId();
        } catch (error) {
          // An unreadable session is not evidence that auth never changed.
          // Preserve the marker and block every account-scoped mutation until
          // the user retries from the recovery gate.
          setSyncMode('error');
          setHydrationReady(false);
          captureOperationalError(error, { area: 'cloud_sync', operation: 'read_account_switch_session' });
          return;
        }
        // Auth never changed (or no destination session survived), so this was
        // a pre-login interruption. Keep the old local data instead of treating
        // its anonymous account as the destination.
        if (!currentUserId || currentUserId === pendingAccountSwitch.previousUserId) {
          await completeLocalAccountSwitch();
        } else {
        stopAuthLifecycle = startSupabaseAuthLifecycle();
        try {
          await retryAccountRecovery();
        } catch (error) {
          captureOperationalError(error, { area: 'cloud_sync', operation: 'recover_account_switch' });
        }
        return;
        }
      }
      setMeals(storedMeals);
      setMealHistory(storedHistory);
      setLifetimeScanCount(Math.max(storedScanCount, countScans(storedHistory)));
      if (countScans(storedHistory) > storedScanCount) await saveLifetimeScanCount(countScans(storedHistory));
      setPendingAnalysisCount(queue.length);
      setProfile(storedProfile);
      setWeightEntries(storedWeights);
      setWellnessConsentGranted(hasConsent);
      if (storedProfile.completedAt) setTargets(calculateDailyTargets(storedProfile));

      if (!isSupabaseConfigured || !hasConsent) {
        await applyAnalyticsAgePolicy(storedProfile.completedAt ? storedProfile.age : null);
        if (!active) return;
        setSyncMode('local');
        setHydrationReady(true);
        return;
      }
      stopAuthLifecycle = startSupabaseAuthLifecycle();
      try {
        const cloudState = await hydrateCloudState();
        if (!active) return;
        if (!cloudState) {
          setSyncMode('local');
          return;
        }
        setMeals(cloudState.meals);
        setMealHistory(cloudState.mealHistory);
        await adoptScanCount(Math.max(countScans(cloudState.mealHistory), cloudState.hasEverLoggedScan ? 1 : 0));
        setTargets(cloudState.targets);
        await adoptProfile(cloudState.profile);
        setSyncMode(cloudState.hasPendingChanges ? 'error' : 'cloud');
      } catch (error) {
        captureOperationalError(error, { area: 'cloud_sync', operation: 'initial_hydration' });
        if (active) setSyncMode('error');
      } finally {
        if (active) setHydrationReady(true);
      }
    })().catch((error) => {
      if (!active) return;
      setLocalStorageError(true);
      setSyncMode('error');
      setHydrationReady(false);
      captureOperationalError(error, { area: 'storage', operation: 'initial_local_hydration' });
    });

    return () => {
      active = false;
      stopAuthLifecycle();
    };
  }, [adoptProfile, adoptScanCount, retryAccountRecovery, appleCredentialMonitor]);

  const grantWellnessConsent = useCallback(async (consentingAge = profile.age) => {
    await recordWellnessConsent(consentingAge);
    setWellnessConsentGranted(true);
    // Returning users may have kept cloud history while consent was paused.
    // New onboarding users do not hydrate the consent-only placeholder row.
    if (profile.completedAt && isSupabaseConfigured) {
      try {
        const cloudState = await hydrateCloudState();
        if (cloudState) {
          setMeals(cloudState.meals);
          setMealHistory(cloudState.mealHistory);
          await adoptScanCount(Math.max(countScans(cloudState.mealHistory), cloudState.hasEverLoggedScan ? 1 : 0));
          setTargets(cloudState.targets);
          await adoptProfile(cloudState.profile);
          setSyncMode(cloudState.hasPendingChanges ? 'error' : 'cloud');
        }
      } catch (error) {
        // Consent is already valid on both sides. Keep the user in local mode
        // and let the normal refresh path recover cloud history later.
        setSyncMode('local');
        captureOperationalError(error, { area: 'cloud_sync', operation: 'hydrate_after_consent' });
      }
    }
  }, [adoptProfile, adoptScanCount, profile.age, profile.completedAt]);

  const withdrawWellnessConsent = useCallback(async () => {
    analysisGenerationRef.current += 1;
    await invalidatePrivateData();
    await withdrawStoredWellnessConsent();
    deleteTemporaryPhoto(photoUriRef.current);
    await clearAnalysisQueue();
    await setEveningReminderEnabled(false).catch(() => false);
    photoUriRef.current = null;
    scanModeRef.current = 'demo';
    setPhotoUri(null);
    setScanMode('demo');
    setQueuedInput(null);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    setPendingAnalysisCount(0);
    setSyncMode('local');
    setWellnessConsentGranted(false);
  }, []);

  useEffect(() => {
    if (currentDay === loadedDayRef.current) return;
    loadedDayRef.current = currentDay;
    // Filter the authoritative in-memory history synchronously. A delayed
    // disk read here could overwrite a meal saved just after midnight.
    setMeals(mealHistory.filter((meal) => meal.date === currentDay));
  }, [currentDay, mealHistory]);

  const consumed = useMemo(() => sumMeals(meals.filter(meal => meal.date === currentDay)), [meals, currentDay]);
  const remaining = useMemo(() => getRemaining(targets, consumed), [consumed, targets]);
  const scannedMeal = useMemo(
    () => createScannedMeal(detectedItems, mealTitle, scanId),
    [detectedItems, mealTitle, scanId],
  );
  const hasLoggedScan = meals.some((meal) => meal.origin === 'scan' || meal.origin === 'plan');
  const hasEverLoggedScan = lifetimeScanCount > 0 || mealHistory.some((meal) => meal.origin === 'scan');
  // 3 free AI analyses for existing installs, 1 behind the hard wall.
  const { allowance: freeScanAllowance } = useFreeScanAllowance();
  const freeScansLeft = Math.max(0, freeScanAllowance - lifetimeScanCount);
  const isCurrentScanLogged = mealHistory.some((meal) => meal.id === scanId);
  const userName = profile.displayName;

  const completeOnboarding = useCallback(async (nextProfile: UserProfile) => {
    const generation = getLocalDataGeneration();
    const completedProfile = { ...nextProfile, completedAt: nextProfile.completedAt ?? new Date().toISOString(), editedAt: new Date().toISOString() };
    const nextTargets = calculateDailyTargets(completedProfile);
    const weights = await saveWeightEntry({ date: localDateKey(), weightKg: completedProfile.weightKg });
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    await adoptProfile(completedProfile);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setTargets(nextTargets);
    setWeightEntries(weights);
    setHydrationReady(true);

    if (isSupabaseConfigured) {
      setSyncMode('syncing');
      void syncUserSetup(completedProfile, nextTargets)
        .then(() => setSyncMode('cloud'))
        .catch((error) => {
          setSyncMode('error');
          captureOperationalError(error, { area: 'cloud_sync', operation: 'save_personalization' });
        });
    }
  }, [adoptProfile]);

  /**
   * Units are presentation only, so this writes the profile and syncs it
   * without recalculating anything: the stored centimetres and kilograms, and
   * therefore the targets, stay exactly as they were.
   */
  const setUnitSystem = useCallback(async (unitSystem: UnitSystem) => {
    const generation = getLocalDataGeneration();
    const current = profileRef.current;
    // A tap back to the displayed unit must still queue behind a pending change.
    if (current.unitSystem === unitSystem && unitWritesInFlightRef.current === 0) return;
    const nextProfile = { ...current, unitSystem, editedAt: new Date().toISOString() };
    unitWritesInFlightRef.current += 1;
    try {
      await saveProfile(nextProfile);
      if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
      setProfile(nextProfile);
      if (isSupabaseConfigured) {
        void syncUserSetup(nextProfile, calculateDailyTargets(nextProfile))
          .catch((error) => captureOperationalError(error, { area: 'cloud_sync', operation: 'save_units' }));
      }
    } finally {
      unitWritesInFlightRef.current -= 1;
    }
  }, []);

  const addWeightEntry = useCallback(async (weightKg: number) => {
    const generation = getLocalDataGeneration();
    const roundedWeight = normalizeWeightKg(weightKg);
    if (roundedWeight === null) throw new Error('invalid_weight');
    const nextProfile = { ...profileRef.current, weightKg: roundedWeight, editedAt: new Date().toISOString() };
    const nextTargets = calculateDailyTargets(nextProfile);
    const weights = await saveWeightEntry({ date: localDateKey(), weightKg: roundedWeight });
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    await saveProfile(nextProfile);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setProfile(nextProfile);
    setTargets(nextTargets);
    setWeightEntries(weights);
    if (isSupabaseConfigured) {
      void syncUserSetup(nextProfile, nextTargets).catch((error) => {
        setSyncMode('error');
        captureOperationalError(error, { area: 'cloud_sync', operation: 'save_weight' });
      });
    }
  }, [profile]);

  const setCapturedPhoto = useCallback((uri: string) => {
    analysisGenerationRef.current += 1;
    photoUriRef.current = uri;
    scanModeRef.current = 'live';
    setPhotoUri(uri);
    setScanMode('live');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    setAnalysisStatus('idle');
    trackEvent('meal scan started', { scan_source: 'camera' });
  }, []);

  const startDemoScan = useCallback(() => {
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUri);
    photoUriRef.current = null;
    scanModeRef.current = 'demo';
    setPhotoUri(null);
    setScanMode('demo');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    setDetectedItems(getDemoItems());
    setMealTitle(getDictionary().errors.demoMealTitle);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    trackEvent('meal scan started', { scan_source: 'demo' });
  }, [photoUri]);

  const startDescriptionScan = useCallback((description: string) => {
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUriRef.current);
    photoUriRef.current = null;
    scanModeRef.current = 'description';
    setPhotoUri(null);
    setScanMode('description');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput(description.trim());
    setBarcodeInput('');
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    trackEvent('meal scan started', { scan_source: 'description' });
  }, []);

  /**
   * A food picked from search is already resolved: there is nothing to analyse,
   * so this skips the gateway, the spinner and the quota entirely and puts the
   * result straight on the confirm screen.
   */
  const applySearchResult = useCallback((result: FoodSearchResult, grams: number) => {
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUriRef.current);
    photoUriRef.current = null;
    scanModeRef.current = 'search';
    setPhotoUri(null);
    setScanMode('search');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    const meal = mealFromSearch(result, grams);
    setDetectedItems(meal.items);
    setMealTitle(meal.title);
    setMealPortionState(1);
    setPortionEstimated(false);
    setAutoMatchedItemIds([]);
    setAnalysisMessage(null);
    setAnalysisError(null);
    setAnalysisStatus('ready');
    trackEvent('meal scan started', { scan_source: 'search' });
  }, []);

  /**
   * A supermarket basket from Plan is already resolved, like a search hit,
   * but it is several products. It goes through the normal confirm screen so
   * every amount can still be changed, and it is logged as one meal. No
   * analysis ran, so it never spends a free analysis.
   */
  const startPlannedDraft = useCallback((entries: { result: FoodSearchResult; grams: number }[], title?: string) => {
    if (!entries.length) throw new Error('Cannot start an empty planned meal');
    const items = entries.map((entry, index) => {
      const [item] = mealFromSearch(entry.result, entry.grams).items;
      return entries.length > 1 ? { ...item, id: `${item.id}-${index + 1}` } : item;
    });
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUriRef.current);
    photoUriRef.current = null;
    scanModeRef.current = 'plan';
    setPhotoUri(null);
    setScanMode('plan');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    setDetectedItems(items);
    setMealTitle((title?.trim() || items.map((item) => item.name).join(', ')).slice(0, 160));
    setMealPortionState(1);
    setPortionEstimated(false);
    setAutoMatchedItemIds([]);
    setAnalysisMessage(null);
    setAnalysisError(null);
    setAnalysisStatus('ready');
  }, []);

  const startBarcodeScan = useCallback((barcode: string) => {
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUriRef.current);
    photoUriRef.current = null;
    scanModeRef.current = 'barcode';
    setPhotoUri(null);
    setScanMode('barcode');
    setScanId(makeScanId());
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput(barcode);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    trackEvent('meal scan started', { scan_source: 'barcode' });
  }, []);

  const replaceDetectedItem = useCallback((id: string, result: FoodSearchResult, grams: number) => {
    const replacement = mealFromSearch(result, grams).items[0];
    const corrected = replaceMealIngredient(detectedItems, id, replacement);
    setDetectedItems(corrected);
    // A food the user picked is no longer Kandro's guess.
    setAutoMatchedItemIds((current) => current.filter((entry) => entry !== id));
    setMealTitle(corrected.filter(item => item.included).map(item => item.name).join(', '));
    setMealPortionState(null);
    setAnalysisMessage(null);
  }, [detectedItems]);

  const removeDetectedItem = useCallback((id: string) => {
    const corrected = detectedItems.filter(item => item.id !== id);
    setDetectedItems(corrected);
    setAutoMatchedItemIds((current) => current.filter((entry) => entry !== id));
    setMealTitle(corrected.filter(item => item.included).map(item => item.name).join(', '));
    setMealPortionState(null);
    setAnalysisMessage(null);
  }, [detectedItems]);

  const analyzeCurrentPhoto = useCallback(async (forceDemo = false, freshRequest = false) => {
    // A failed attempt is remembered server-side under its id and refunded, so
    // repeating that id can only answer "request_completed". Queued photos keep
    // their id: it is also their key in the local retry queue.
    const renew = freshRequest && scanModeRef.current !== 'queued';
    const invocationScanId = renew ? makeScanId() : scanId;
    if (renew) setScanId(invocationScanId);
    const invocationIdentityGeneration = analysisIdentityGenerationRef.current;
    // A double tap must join the existing attempt rather than send a second
    // request with the same idempotency key and let a fast 409 beat the real
    // result back to the UI.
    if (inFlightAnalysisIdsRef.current.has(invocationScanId)) return;
    inFlightAnalysisIdsRef.current.add(invocationScanId);
    const invocationGeneration = ++analysisGenerationRef.current;
    const isCurrentInvocation = () => analysisGenerationRef.current === invocationGeneration;
    const activeScanMode = scanModeRef.current;
    const analysisStartedAt = Date.now();
    try {
      setAnalysisStatus('analyzing');
      setAnalysisPhase('analysing');
      setPortionEstimated(false);
      setAutoMatchedItemIds([]);
      setAnalysisError(null);
      setAnalysisMessage(null);

      if (forceDemo || activeScanMode === 'demo') {
        await new Promise((resolve) => setTimeout(resolve, 1900));
        if (!isCurrentInvocation()) return;
        setDetectedItems(getDemoItems());
        setMealTitle(getDictionary().errors.demoMealTitle);
        setAnalysisStatus('ready');
        trackEvent('meal analysis completed', {
          duration: durationBucket(analysisStartedAt),
          confidence: DETECTED_ITEMS.some((item) => item.included && item.confidence === 'medium') ? 'medium' : 'high',
          detected_item_count: countBucket(DETECTED_ITEMS.length),
          scan_source: 'demo',
          warning_present: false,
        });
        return;
      }

      let input = queuedInput;
      try {
        if ((activeScanMode === 'live' || activeScanMode === 'queued') && !input) {
          const originalUri = photoUriRef.current ?? photoUri;
          if (!originalUri) throw new MealAnalysisError('unclear-image', getDictionary().errors.retakeWholePlate);
          setAnalysisPhase('preparing');
          const prepared = await prepareMealPhoto(originalUri);
          if (!isCurrentInvocation()) {
            if (prepared.previewUri !== originalUri) deleteTemporaryPhoto(prepared.previewUri);
            return;
          }
          input = prepared;
          photoUriRef.current = prepared.previewUri;
          setPhotoUri(prepared.previewUri);
          if (prepared.previewUri !== originalUri) deleteTemporaryPhoto(originalUri);
          setAnalysisPhase('analysing');
        }

        // Simple descriptions resolve on the device: instant, offline, free.
        const localDescription = activeScanMode === 'description' ? parseLocalDescription(descriptionInput, foodUsage(mealHistory)) : null;
        const result = localDescription ?? (activeScanMode === 'description'
          ? await analyzeDescription(descriptionInput, invocationScanId)
          : activeScanMode === 'barcode'
            ? await analyzeBarcode(barcodeInput)
            : await analyzePreparedPhoto(input!, invocationScanId));
        // The provider success spends the free analysis, not the later decision
        // to save the meal. This bookkeeping remains valid even if the user has
        // already started another scan, but the stale result never reaches UI.
        const nextLifetimeCount = !FREE_ANALYSIS_MODES.has(activeScanMode)
          && !localDescription
          && result.correctionRequired !== true
          && analysisIdentityGenerationRef.current === invocationIdentityGeneration
          ? await countLifetimeScanOnce(invocationScanId)
          : null;
        const nextPendingCount = activeScanMode === 'queued'
          ? await removeQueuedAnalysis(invocationScanId)
          : null;
        if (!isCurrentInvocation()) return;
        if (nextLifetimeCount !== null) setLifetimeScanCount(nextLifetimeCount);
        if (nextPendingCount !== null) setPendingAnalysisCount(nextPendingCount);
        // A local result costs nothing and is logged in the free bucket.
        correctionDraftRef.current = result.correctionRequired === true || Boolean(localDescription);
        // An ingredient the gateway could not price is matched against the
        // on-device catalogue at its detected amount, so the draft is savable
        // at once; the row is flagged for a quick check instead of blocking.
        const resolved = resolveUnmatchedItems(result.items, foodUsage(mealHistory));
        setDetectedItems(resolved.items);
        setAutoMatchedItemIds(resolved.matchedIds);
        setPortionEstimated(result.estimatedPortion === true
          || (Boolean(localDescription) && result.warnings.includes(getDictionary().errors.warnAmountEstimated)));
        setMealTitle(result.title);
        setMealPortionState(1);
        setAnalysisMessage([...new Set(result.warnings)].join('\n\n') || null);
        setAnalysisStatus('ready');
        trackEvent('meal analysis completed', {
          duration: durationBucket(analysisStartedAt),
          confidence: result.items.some((item) => item.included && item.confidence === 'medium') ? 'medium' : 'high',
          detected_item_count: countBucket(result.items.length),
          scan_source: telemetryScanSource(activeScanMode),
          warning_present: result.warnings.length > 0,
        });
      } catch (error) {
        if (!isCurrentInvocation()) return;
        // The gateway is the authority here. If it says there is no consent,
        // the local record is stale: keeping it would leave the user looking at
        // "Consent is active" with only a "Withdraw" button and no way back.
        if (error instanceof MealAnalysisError && error.kind === 'consent-required') {
          await forgetLocalWellnessConsent();
          if (!isCurrentInvocation()) return;
          setWellnessConsentGranted(false);
        }
        const failure = error instanceof MealAnalysisError
          ? error
          : new MealAnalysisError('provider-error', getDictionary().errors.analysisFailed);
        // "Amount unclear" is not a dead end. An older gateway answers it with
        // 422 (refunded, so free); the recognisable foods still land on the
        // confirm screen at a typical portion for the user to adjust.
        const estimate = activeScanMode === 'description' && AMOUNT_ERROR_CODES.has(failure.code ?? '')
          ? estimateDescriptionPortions(descriptionInput, foodUsage(mealHistory))
          : null;
        if (estimate) {
          correctionDraftRef.current = true;
          setDetectedItems(estimate.items);
          setAutoMatchedItemIds([]);
          setPortionEstimated(true);
          setMealTitle(estimate.title);
          setMealPortionState(1);
          setAnalysisMessage(estimate.warnings.join('\n\n') || null);
          setAnalysisStatus('ready');
          trackEvent('meal analysis completed', {
            duration: durationBucket(analysisStartedAt),
            confidence: 'medium',
            detected_item_count: countBucket(estimate.items.length),
            scan_source: telemetryScanSource(activeScanMode),
            warning_present: true,
          });
          return;
        }
        if (failure.kind === 'request-expired' && activeScanMode === 'queued') {
          const count = await removeQueuedAnalysis(invocationScanId);
          if (!isCurrentInvocation()) return;
          setPendingAnalysisCount(count);
        }
        const shouldQueue = activeScanMode === 'live' || activeScanMode === 'queued'
          ? input && (failure.kind === 'offline' || failure.kind === 'timeout')
          : false;
        if (shouldQueue && input) {
          const count = await queueAnalysis({ ...input, id: invocationScanId, createdAt: new Date().toISOString() });
          if (!isCurrentInvocation()) {
            await removeQueuedAnalysis(invocationScanId);
            return;
          }
          setPendingAnalysisCount(count);
          setAnalysisStatus('queued');
        } else {
          if (!isCurrentInvocation()) return;
          setAnalysisStatus('error');
        }
        setAnalysisError(failure.kind);
        setAnalysisMessage(failure.message);
        trackEvent('meal analysis failed', {
          duration: durationBucket(analysisStartedAt),
          failure_reason: failure.kind,
          queued_for_retry: Boolean(shouldQueue),
          scan_source: telemetryScanSource(activeScanMode),
        });
        captureOperationalError(failure, {
          area: 'analysis',
          operation: `analyze_${telemetryScanSource(activeScanMode)}`,
          code: failure.kind,
        });
      }
    } finally {
      inFlightAnalysisIdsRef.current.delete(invocationScanId);
      if (isCurrentInvocation()) setAnalysisPhase(null);
    }
  }, [barcodeInput, descriptionInput, mealHistory, photoUri, queuedInput, scanId]);

  const cancelAnalysis = useCallback(() => {
    analysisGenerationRef.current += 1;
    setAnalysisPhase(null);
    setAnalysisStatus('idle');
  }, []);

  const resumeLatestAnalysis = useCallback(async () => {
    const queue = await loadAnalysisQueue();
    const latest = queue.at(-1);
    if (!latest) return false;
    analysisGenerationRef.current += 1;
    const queuedPhotoUri = `data:${latest.mimeType};base64,${latest.imageBase64}`;
    scanModeRef.current = 'queued';
    photoUriRef.current = queuedPhotoUri;
    setScanId(latest.id);
    setScanMode('queued');
    setQueuedInput(latest);
    setPhotoUri(queuedPhotoUri);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    return true;
  }, []);

  const adjustItem = (id: string, direction: -1 | 1) => {
    setMealPortionState(null);
    setPortionEstimated(false);
    setDetectedItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const nextAmount = Math.min(5000, Math.max(1, Math.round((item.amountG + direction * 10) * 10) / 10));
        return scaleItem(item, nextAmount);
      }),
    );
  };

  /**
   * Typing the amount instead of stepping to it in tens: a 330 ml can is
   * thirty-three taps away from the 10 g default, which is not an edit anyone
   * makes twice.
   */
  const setItemAmount = (id: string, grams: number) => {
    const amount = Math.round(grams * 10) / 10;
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) return;
    setMealPortionState(null);
    setPortionEstimated(false);
    setDetectedItems((current) => current.map((item) => (item.id === id ? scaleItem(item, amount) : item)));
  };

  const setMealPortion = (factor: PortionFactor) => {
    setMealPortionState(factor);
    setPortionEstimated(false);
    setDetectedItems((current) =>
      current.map((item) => scaleItem(item, Math.min(5000, Math.max(1, Math.round(item.baseAmountG * factor * 10) / 10)))),
    );
  };

  const toggleItem = (id: string) => {
    setDetectedItems((current) =>
      current.map((item) => (item.id === id && !needsIngredientCorrection(item) ? { ...item, included: !item.included } : item)),
    );
  };

  const resetScan = useCallback(() => {
    analysisGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUri);
    photoUriRef.current = null;
    scanModeRef.current = 'demo';
    plannedMealTypeRef.current = null;
    setPlannedMealTypeState(null);
    plannedMealDateRef.current = null;
    setPlannedMealDateState(null);
    setPortionEstimated(false);
    setAutoMatchedItemIds([]);
    setDetectedItems(getDemoItems());
    setMealTitle(getDictionary().errors.demoMealTitle);
    setPhotoUri(null);
    setScanId(makeScanId());
    setScanMode('demo');
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    setMealPortionState(1);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
  }, [photoUri]);

  const resetAfterAccountDeletion = useCallback(() => {
    setAppleReauthenticationRequired(false);
    setLocalStorageError(false);
    setHydrationReady(true);
    appleCredentialMonitor.reset();
    analysisGenerationRef.current += 1;
    analysisIdentityGenerationRef.current += 1;
    deleteTemporaryPhoto(photoUriRef.current);
    photoUriRef.current = null;
    scanModeRef.current = 'demo';
    setProfile(DEFAULT_PROFILE);
    setTargets(DEFAULT_TARGETS);
    setMeals([]);
    setMealHistory([]);
    setFavoriteMeals([]);
    setLifetimeScanCount(0);
    setWeightEntries([]);
    setDetectedItems(getDemoItems());
    setMealTitle(getDictionary().errors.demoMealTitle);
    setPhotoUri(null);
    setScanId(makeScanId());
    setScanMode('demo');
    setQueuedInput(null);
    setDescriptionInput('');
    setBarcodeInput('');
    setMealPortionState(1);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setAnalysisMessage(null);
    setPendingAnalysisCount(0);
    setSyncMode('local');
    setWellnessConsentGranted(false);
  }, [appleCredentialMonitor]);

  const setPlannedMealType = useCallback((type: Meal['type'] | null) => {
    plannedMealTypeRef.current = type;
    setPlannedMealTypeState(type);
  }, []);

  /** An explicit day (also today) wins over the day a corrected meal was filed under. */
  const setPlannedMealDate = useCallback((date: string | null) => {
    const next = date ? clampLogDate(date) : null;
    plannedMealDateRef.current = next;
    setPlannedMealDateState(next);
  }, []);

  /**
   * The slot belongs to the meal it was chosen for and to no other.
   *
   * Only resetScan cleared it, so tapping "+" beside breakfast and then
   * abandoning the scan left the choice standing: a dinner logged from the
   * plan tab hours later was filed as breakfast.
   */
  const consumePlannedMealType = useCallback(() => {
    const type = plannedMealTypeRef.current;
    plannedMealTypeRef.current = null;
    setPlannedMealTypeState(null);
    return type;
  }, []);

  /** Same lifetime as the slot: the chosen day belongs to one meal only. */
  const consumePlannedMealDate = useCallback(() => {
    const date = plannedMealDateRef.current;
    plannedMealDateRef.current = null;
    setPlannedMealDateState(null);
    return date;
  }, []);

  const logScannedMeal = useCallback(async () => {
    if (analysisStatus !== 'ready') throw new Error('Cannot save without a ready meal draft');
    if (!detectedItems.some((item) => item.included)) throw new Error('Cannot save an empty meal');
    if (!canSaveMealDraft(detectedItems)) throw new Error('Cannot save an incomplete meal');
    const generation = getLocalDataGeneration();
    const existing = mealHistory.find((meal) => meal.id === scannedMeal.id);
    const now = new Date();
    // A refunded draft repaired manually belongs to the same free log bucket
    // as search/barcode. Otherwise legacy history hydration would charge it
    // later by counting origin=scan, despite the gateway having refunded it.
    // Complete AI results were already counted on arrival, even if abandoned.
    const costsAnalysis = !FREE_ANALYSIS_MODES.has(scanModeRef.current) && !correctionDraftRef.current;
    // The clock guesses the slot; tapping "+" next to breakfast states it. A
    // correction re-saves the same id, and the choice is spent by then, so the
    // meal that was filed under breakfast kept its own slot rather than
    // snapping back to whatever the clock says now.
    const slot = consumePlannedMealType() ?? existing?.type;
    // A back-dated meal is filed on its own day at the slot's usual time; a
    // correction keeps the day it was first filed under.
    const moment = mealMoment(consumePlannedMealDate() ?? existing?.date, slot ?? scannedMeal.type, now);
    const today = localDateKey(now);
    const persistedMeal: Meal = {
      ...scannedMeal,
      ...(slot ? { type: slot } : {}),
      ...nutritionFromItems(detectedItems),
      origin: costsAnalysis ? 'scan' : 'plan',
      date: moment.date,
      ...(moment.date !== today ? { time: formatClockTime(moment.at) } : {}),
      savedAt: moment.at.toISOString(),
    };
    await saveSyncedMeal(persistedMeal, scanModeRef.current === 'plan' ? 'recommendation' : telemetryScanSource(scanModeRef.current));
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    // Only today's meals belong in `meals`; a past day lives in the history.
    setMeals((current) => [...current.filter((meal) => meal.id !== persistedMeal.id), ...(persistedMeal.date === today ? [persistedMeal] : [])]);
    setMealHistory((current) => [...current.filter((meal) => meal.id !== persistedMeal.id), persistedMeal]);
    return persistedMeal;
  }, [analysisStatus, detectedItems, mealHistory, scannedMeal]);

  /**
   * Logs a meal the user picked from Kandro's own suggestions. It never touches
   * the free-scan allowance: no analysis ran, so it cost nothing, and charging
   * for the app's own recommendation would be absurd.
   */
  const logPlannedMeal = useCallback(async (suggestion: MealSuggestion, portion: PortionFactor) => {
    const generation = getLocalDataGeneration();
    const now = new Date();
    const planned = createPlannedMeal(suggestion, portion, `plan-${suggestion.id}-${now.getTime()}`);
    const slot = consumePlannedMealType();
    // Suggestions are computed from today's remaining budget, so they are
    // always filed today. The day choice is released, not carried over.
    consumePlannedMealDate();
    const persisted: Meal = {
      ...planned,
      ...(slot ? { type: slot } : {}),
      date: localDateKey(now),
      savedAt: now.toISOString(),
    };
    await saveSyncedMeal(persisted, 'recommendation');
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setMeals((current) => [...current.filter((meal) => meal.id !== persisted.id), persisted]);
    setMealHistory((current) => [...current.filter((meal) => meal.id !== persisted.id), persisted]);
    return persisted;
  }, []);

  const repeatMeals = useMemo(() => availableRepeats(mealHistory, meals), [mealHistory, meals]);

  const scanTarget = useMemo(() => {
    const existing = mealHistory.find((meal) => meal.id === scanId);
    return {
      type: plannedMealType ?? existing?.type ?? scannedMeal.type,
      date: clampLogDate(plannedMealDate ?? existing?.date, currentDay),
    };
  }, [currentDay, mealHistory, plannedMealDate, plannedMealType, scanId, scannedMeal.type]);

  /**
   * Logs a meal the user has eaten before. Costs no analysis call, so like a
   * planned meal it never spends part of the free allowance.
   */
  const logRepeatMeal = useCallback((candidate: RepeatCandidate, target?: RepeatTarget) => {
    const generation = getLocalDataGeneration();
    const key = `${generation}:${candidate.key}`;
    const inFlight = repeatInFlightRef.current.get(key);
    if (inFlight) return inFlight;
    const operation = (async () => {
      const now = new Date();
      // Both choices are spent either way; a slot picked in the sheet wins.
      const plannedType = consumePlannedMealType();
      const plannedDate = consumePlannedMealDate();
      const type = target?.type ?? plannedType ?? mealTypeForHour(now.getHours());
      const moment = mealMoment(target && target.date !== undefined ? target.date : plannedDate, type, now);
      const portioned = target?.portion && target.portion !== 1 ? scaleMealPortion(candidate.source, target.portion) : candidate.source;
      const repeated: Meal = {
        ...portioned,
        id: `repeat-${candidate.key.replace(/[^a-z0-9]+/gi, '-')}-${now.getTime()}`,
        origin: 'plan',
        sync: undefined,
        type,
        time: formatClockTime(moment.at),
        date: moment.date,
        savedAt: moment.at.toISOString(),
      };
      await saveSyncedMeal(repeated, 'repeat');
      if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
      setMeals((current) => [...current.filter((meal) => meal.id !== repeated.id), ...(repeated.date === localDateKey(now) ? [repeated] : [])]);
      setMealHistory((current) => [...current.filter((meal) => meal.id !== repeated.id), repeated]);
      return repeated;
    })();
    repeatInFlightRef.current.set(key, operation);
    const release = () => { repeatInFlightRef.current.delete(key); };
    void operation.then(release, release);
    return operation;
  }, []);

  /**
   * Search-and-add, as in every diary app: pick foods and amounts, then save
   * them together. Everything picked in one open search sheet is ONE meal with
   * several ingredients, the way people think of "my breakfast", not five
   * separate entries. The slot and day stay chosen for the whole session and
   * are released when the search closes (setPlannedMealType(null)).
   */
  const logFoodsDirect = useCallback(async (entries: { result: FoodSearchResult; grams: number }[]) => {
    if (!entries.length) throw new Error('Cannot save an empty meal');
    const generation = getLocalDataGeneration();
    const now = new Date();
    const items = entries.map((entry, index) => {
      const [item] = mealFromSearch(entry.result, entry.grams).items;
      // The same food picked twice is two rows, never one id.
      return entries.length > 1 ? { ...item, id: `${item.id}-${index + 1}` } : item;
    });
    if (!canSaveMealDraft(items)) throw new Error('Cannot save an incomplete meal');
    const title = items.map((item) => item.name).join(', ').slice(0, 160);
    const base = createScannedMeal(items, title, makeScanId());
    const type = plannedMealTypeRef.current ?? base.type;
    const moment = mealMoment(plannedMealDateRef.current, type, now);
    const today = localDateKey(now);
    const meal: Meal = {
      ...base,
      type,
      origin: 'plan',
      date: moment.date,
      time: formatClockTime(moment.at),
      savedAt: moment.at.toISOString(),
    };
    await saveSyncedMeal(meal, 'search');
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setMeals((current) => [...current.filter((entry) => entry.id !== meal.id), ...(meal.date === today ? [meal] : [])]);
    setMealHistory((current) => [...current.filter((entry) => entry.id !== meal.id), meal]);
    return meal;
  }, []);

  /**
   * The star is keyed by the meal's title, so "Skyr mit Beeren" stays a
   * favourite across days; what it stores is this meal exactly as logged.
   */
  const toggleFavoriteMeal = useCallback(async (meal: Meal) => {
    const existing = findFavorite(await loadFavorites(), meal);
    if (existing?.id) await removeFavorite(existing.id);
    else await addFavorite(meal);
  }, []);

  const addFavoriteMeal = useCallback(async (meal: Meal) => { await addFavorite(meal); }, []);
  const removeFavoriteMeal = useCallback((id: string) => removeFavorite(id), []);
  const renameFavoriteMeal = useCallback((id: string, title: string) => renameFavorite(id, title), []);

  // A star set on Confirm belongs to that draft only; a new scan starts unstarred.
  const scanFavorite = favoriteDraftScanId === scanId || Boolean(findFavorite(favoriteMeals, scannedMeal));
  // One write per save of the starred draft: "id|savedAt|kcal" of the stored meal.
  const favoriteFulfilledRef = useRef<string | null>(null);
  const favoriteSignature = (meal: Meal) => `${meal.id}|${meal.savedAt ?? ''}|${meal.calories}`;
  const setScanFavorite = useCallback(async (on: boolean) => {
    const logged = mealHistory.find((meal) => meal.id === scanId);
    if (on) {
      setFavoriteDraftScanId(scanId);
      // Already saved (Result): store it now, exactly as logged.
      if (logged) {
        favoriteFulfilledRef.current = favoriteSignature(logged);
        await addFavorite(logged);
      }
      return;
    }
    setFavoriteDraftScanId(null);
    const existing = findFavorite(await loadFavorites(), logged ?? scannedMeal);
    if (existing?.id) await removeFavorite(existing.id);
  }, [mealHistory, scanId, scannedMeal]);

  // The save fulfils a star set before it: the favourite is the meal as
  // stored, and a correction re-saved under the same scan id updates it.
  // Removing the favourite elsewhere afterwards is not undone by this.
  useEffect(() => {
    if (!favoriteDraftScanId) return;
    const logged = mealHistory.find((meal) => meal.id === favoriteDraftScanId);
    if (!logged || favoriteFulfilledRef.current === favoriteSignature(logged)) return;
    favoriteFulfilledRef.current = favoriteSignature(logged);
    void addFavorite(logged).catch(() => undefined);
  }, [favoriteDraftScanId, mealHistory]);

  /**
   * Removes a meal from the day. Until this existed a mis-scan, a wrong portion
   * or a double tap on a repeat was stuck in the user's day forever, while the
   * result screen promised control over every ingredient and portion.
   */
  const deleteLoggedMeal = useCallback(async (id: string) => {
    const generation = getLocalDataGeneration();
    await deleteSyncedMeal(id);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    setMeals((current) => current.filter((meal) => meal.id !== id));
    setMealHistory((current) => current.filter((meal) => meal.id !== id));
  }, []);

  /**
   * Rescales an already logged meal. Scaling runs from each item's baseAmountG,
   * so picking 1x always returns to the original estimate rather than drifting
   * further with every correction.
   */
  const adjustLoggedMealPortion = useCallback(async (id: string, factor: PortionFactor) => {
    const generation = getLocalDataGeneration();
    const target = mealHistory.find((meal) => meal.id === id) ?? meals.find((meal) => meal.id === id);
    if (!target) return;

    const items = target.items.map((item) => scaleItem(item, Math.min(5000, Math.max(1, Math.round(item.baseAmountG * factor * 10) / 10))));
    const updated: Meal = { ...target, items, ...nutritionFromItems(items) };
    await saveSyncedMeal(updated);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    const replace = (list: Meal[]) => list.map((meal) => (meal.id === id ? updated : meal));
    setMeals(replace);
    setMealHistory(replace);
  }, [mealHistory, meals]);

  const setLoggedItemAmount = useCallback(async (id: string, itemId: string, grams: number) => {
    const generation = getLocalDataGeneration();
    const amount = Math.round(grams * 10) / 10;
    if (!Number.isFinite(amount) || amount < 1 || amount > 5000) throw new Error('invalid_amount');
    const target = mealHistory.find((meal) => meal.id === id) ?? meals.find((meal) => meal.id === id);
    if (!target || !target.items.some((item) => item.id === itemId)) return;
    const items = target.items.map((item) => (item.id === itemId ? scaleItem(item, amount) : item));
    const updated: Meal = { ...target, items, ...nutritionFromItems(items) };
    await saveSyncedMeal(updated);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    const replace = (list: Meal[]) => list.map((meal) => (meal.id === id ? updated : meal));
    setMeals(replace);
    setMealHistory(replace);
  }, [mealHistory, meals]);

  /**
   * The meal moment is derived from the clock at logging time, so anyone who
   * catches up on three meals in the evening ends up with three "Abendessen".
   * Correcting it must not require deleting and redoing the meal.
   */
  const setLoggedMealType = useCallback(async (id: string, type: Meal['type']) => {
    const generation = getLocalDataGeneration();
    const target = mealHistory.find((meal) => meal.id === id) ?? meals.find((meal) => meal.id === id);
    if (!target || target.type === type) return;
    const updated: Meal = { ...target, type };
    await saveSyncedMeal(updated);
    if (generation !== getLocalDataGeneration()) throw new Error('cloud_identity_changed');
    const replace = (list: Meal[]) => list.map((meal) => (meal.id === id ? updated : meal));
    setMeals(replace);
    setMealHistory(replace);
  }, [mealHistory, meals]);

  const value = useMemo<AppContextValue>(
    () => ({
      setUnitSystem,
      plannedMealType,
      setPlannedMealType,
      plannedMealDate,
      setPlannedMealDate,
      scanTarget,
      favoriteMeals,
      toggleFavoriteMeal,
      addFavoriteMeal,
      removeFavoriteMeal,
      renameFavoriteMeal,
      scanFavorite,
      setScanFavorite,
      analysisPhase,
      portionEstimated,
      autoMatchedItemIds,
      userName,
      profile,
      hydrationReady,
      localStorageError,
      appleReauthenticationRequired,
      wellnessConsentGranted,
      targets,
      meals,
      mealHistory,
      weightEntries,
      consumed,
      remaining,
      detectedItems,
      scannedMeal: { ...scannedMeal, ...nutritionFromItems(detectedItems) },
      photoUri,
      scanMode,
      descriptionInput,
      hasLoggedScan,
      hasEverLoggedScan,
      lifetimeScanCount,
      freeScansLeft,
      isCurrentScanLogged,
      mealPortion,
      analysisStatus,
      analysisError,
      applySearchResult,
      startPlannedDraft,
      replaceDetectedItem,
      removeDetectedItem,
      analysisMessage,
      pendingAnalysisCount,
      syncMode,
      refreshCloudState,
      loadExistingAccount,
      loadAppleAccount,
      retryAccountRecovery,
      grantWellnessConsent,
      withdrawWellnessConsent,
      completeOnboarding,
      addWeightEntry,
      setCapturedPhoto,
      startDemoScan,
      startDescriptionScan,
      startBarcodeScan,
      analyzeCurrentPhoto,
      resumeLatestAnalysis,
      cancelAnalysis,
      adjustItem,
      setItemAmount,
      setMealPortion,
      toggleItem,
      resetScan,
      resetAfterAccountDeletion,
      logScannedMeal,
      logPlannedMeal,
      repeatMeals,
      logRepeatMeal,
      logFoodsDirect,
      setLoggedItemAmount,
      deleteLoggedMeal,
      adjustLoggedMealPortion,
      setLoggedMealType,
    }),
    [descriptionInput, addWeightEntry, adjustLoggedMealPortion, analysisError, applySearchResult, analysisMessage, analysisStatus, analyzeCurrentPhoto, completeOnboarding, consumed, deleteLoggedMeal, detectedItems, freeScansLeft, grantWellnessConsent, hasEverLoggedScan, hasLoggedScan, lifetimeScanCount, hydrationReady, localStorageError, appleReauthenticationRequired, isCurrentScanLogged, loadExistingAccount, loadAppleAccount, logFoodsDirect, setLoggedItemAmount, plannedMealDate, setPlannedMealDate, scanTarget, favoriteMeals, toggleFavoriteMeal, addFavoriteMeal, removeFavoriteMeal, renameFavoriteMeal, scanFavorite, setScanFavorite, analysisPhase, portionEstimated, autoMatchedItemIds, logPlannedMeal, logRepeatMeal, logScannedMeal, mealHistory, repeatMeals, mealPortion, meals, pendingAnalysisCount, photoUri, profile, refreshCloudState, remaining, resetAfterAccountDeletion, resetScan, resumeLatestAnalysis, cancelAnalysis, retryAccountRecovery, scanMode, setUnitSystem, setLoggedMealType, plannedMealType, setPlannedMealType, scannedMeal, setCapturedPhoto, startBarcodeScan, startDemoScan, startDescriptionScan, startPlannedDraft, syncMode, targets, userName, weightEntries, wellnessConsentGranted, withdrawWellnessConsent],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
