import { captureMode, getScanInputRevision, getScanInputState, saveScanInputState, setScanInputDraft } from '@/services/captureIntents';
import { CaptureSearchHelp } from '@/components/CaptureSearchHelp';
import { durationBucket, trackEvent } from '@/services/telemetry';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, Alert, AppState, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Animated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFreeScanAllowance } from '@/hooks/useHardWall';
import { PrimaryButton } from '@/components/ui';
import { PortionSheet } from '@/components/PortionSheet';
import { ManualFoodForm } from '@/components/ManualFoodForm';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { radii, typeScale } from '@/constants/theme';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { frameToPhotoCrop, type Rect } from '@/utils/cameraCrop';
import { useApp } from '@/context/AppContext';
import { deleteTemporaryPhoto, FoodSearchResult, MealAnalysisError, searchFoods } from '@/services/mealAnalysis';
import { foodSourceBadge, foodUsage, frequentFoods, mergeSuggestions, recentFoods, suggestFoods, type FoodSourceBadge } from '@/services/foodSuggest';
import { customFoodResult, deleteCustomFood, isCustomFoodResult, matchCustomFoods } from '@/services/customFoods';
import { useCustomFoods } from '@/hooks/useCustomFoods';
import { isQuickAddResult, QuickAddForm } from '@/components/QuickAddForm';
import { parseLocalDescription } from '@/services/localDescription';
import { useSubscription } from '@/context/SubscriptionContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { primaryHaptic, successHaptic } from '@/services/haptics';
import { formatDayLabel, formatNumber, mealTypeLabel } from '@/utils/format';
import { mealTypeForTime } from '@/utils/mealDay';
import { localDateKey } from '@/utils/date';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { subscribePrivateDataInvalidation } from '@/services/localRepository';

export default function ScanScreen() {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const { applySearchResult, logFoodsDirect, plannedMealDate, plannedMealType, setPlannedMealDate, setPlannedMealType, descriptionInput, freeScansLeft, hasEverLoggedScan, isCurrentScanLogged, mealHistory, resetScan, scannedMeal, scanMode, setCapturedPhoto, startBarcodeScan, startDemoScan, startDescriptionScan } = useApp();
  const { status: subscriptionStatus } = useSubscription();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const { mode: requestedMode } = useLocalSearchParams<{ mode?: string }>();
  const [restoredInput] = useState(getScanInputState);
  const inputRevision = useRef(getScanInputRevision());
  const [mode, setMode] = useState<'photo' | 'description' | 'barcode' | 'search'>(
    restoredInput?.mode ?? captureMode(requestedMode) ?? 'photo',
  );
  const [description, setDescription] = useState(restoredInput?.description ?? (scanMode === 'description' && !isCurrentScanLogged ? descriptionInput : ''));
  // Arriving with ?mode=description means the user just hit a barcode the
  // database does not know; the sheet should already be open for them.
  const [showDescription, setShowDescription] = useState(requestedMode === 'description');
  const [showSearch, setShowSearch] = useState(requestedMode === 'search');
  const [searchQuery, setSearchQuery] = useState(restoredInput?.searchQuery ?? '');
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [visibleSearchCount, setVisibleSearchCount] = useState(15);
  const [searching, setSearching] = useState(false);
  const [completedEmptySearch, setCompletedEmptySearch] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingFood, setPendingFood] = useState<FoodSearchResult | null>(restoredInput?.pendingFood ?? null);
  const [manualFor, setManualFor] = useState<string | null>(null);
  // "Kalorien schnell eintragen": null = closed, otherwise the prefilled name.
  const [quickAddFor, setQuickAddFor] = useState<string | null>(null);
  // Foods picked in this search session, newest last. They are saved together
  // as one meal ("Als Frühstück speichern"), not as one entry per food.
  const [added, setAdded] = useState<{ id: string; food: FoodSearchResult; name: string; grams: number; kcal: number }[]>([]);
  const pickSerial = useRef(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [portionDraft, setPortionDraft] = useState(restoredInput?.portion ?? null);
  const [torchOn, setTorchOn] = useState(false);
  const [showBarcodeEntry, setShowBarcodeEntry] = useState(false);
  const [barcodeEntry, setBarcodeEntry] = useState(restoredInput?.barcodeEntry ?? '');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearch = useRef('');
  const searchGeneration = useRef(0);
  const confirmAfterSearchDismiss = useRef(false);
  const labelAfterSearchDismiss = useRef(false);
  const afterSheetDismiss = useRef<'/analyzing' | '/paywall?reason=blocked' | null>(null);
  useEffect(() => () => {
    searchGeneration.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  // Guide frame and camera view in window coordinates, for cropping.
  const guideRef = useRef<View>(null);
  const containerRef = useRef<View>(null);
  const measure = (ref: { current: View | null }) => new Promise<Rect | null>(resolve => {
    if (!ref.current) return resolve(null);
    ref.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
  const currentScan = useRef({ id: scannedMeal.id, descriptionInput, scanMode, isCurrentScanLogged });
  currentScan.current = { id: scannedMeal.id, descriptionInput, scanMode, isCurrentScanLogged };
  const inputOwner = useRef({ id: scannedMeal.id, logged: isCurrentScanLogged });
  const inputOwnerChanged = inputOwner.current.id !== scannedMeal.id || (!inputOwner.current.logged && isCurrentScanLogged);
  const invalidatedScanId = useRef<string | null>(null);
  const clearInputDraft = useCallback(() => {
    setDescription(''); setSearchQuery(''); setBarcodeEntry(''); setPendingFood(null); setPortionDraft(null);
    setScanInputDraft(null);
    searchGeneration.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchResults([]); setSearching(false); setCompletedEmptySearch(false); setSearchNotice(null); setSearchError(null);
  }, []);
  useEffect(() => {
    if (!inputOwnerChanged) return;
    inputOwner.current = { id: scannedMeal.id, logged: isCurrentScanLogged };
    inputRevision.current = getScanInputRevision();
    clearInputDraft();
  }, [scannedMeal.id, isCurrentScanLogged, inputOwnerChanged, clearInputDraft]);
  useEffect(() => subscribePrivateDataInvalidation(async () => {
    // Clear the mounted form immediately, even before account recovery has
    // replaced AppContext. Its old submitted text must not be restored later.
    invalidatedScanId.current = currentScan.current.id;
    inputRevision.current = -1;
    clearInputDraft();
  }), [clearInputDraft]);
  useEffect(() => {
    // A new scan/save may reset state in this same commit. Do not re-persist
    // the preceding render's values while those state updates are pending.
    if (!inputOwnerChanged) saveScanInputState({ mode, description, searchQuery, barcodeEntry, pendingFood, portion: portionDraft }, inputRevision.current);
  }, [description, searchQuery, barcodeEntry, pendingFood, portionDraft, mode, inputOwnerChanged]);
  const scanVisit = useRef(0);
  const scanFocused = useRef(false);
  const captureLock = useRef(false);
  const barcodeLock = useRef(false);
  const [scannerClosed, setScannerClosed] = useState(false);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const { language, locale, t } = useLanguage();
  // The sheets cover the whole screen, so a camera running behind one is a
  // preview nobody can see holding a device nobody else can use.
  const cameraActive = pathname.endsWith('/scan')
    && isFocused && foreground
    && !scannerClosed
    && mode !== 'description'
    && mode !== 'search'
    && !showBarcodeEntry
    && permission?.granted === true;

  // Tabs stay mounted. Without a focus reset, returning from a previous text
  // search could leave the next Lunch/Dinner tap behind an invisible sheet and
  // make the camera look frozen.
  useFocusEffect(useCallback(() => {
    scanVisit.current += 1;
    scanFocused.current = true;
    captureLock.current = false;
    barcodeLock.current = false;
    setScannerClosed(false);
    const samePrivacyRevision = inputRevision.current === getScanInputRevision();
    const draft = samePrivacyRevision ? getScanInputState() : null;
    inputRevision.current = getScanInputRevision();
    const scan = currentScan.current;
    const nextMode = draft?.mode ?? captureMode(requestedMode) ?? 'photo';
    // Submission clears the input draft while analysis owns it. A mounted tab
    // must recover that submitted text when Confirm/error sends it back here;
    // a newer local edit still wins, and saved/private/other scans do not leak.
    const submittedDescription = samePrivacyRevision && scan.id !== invalidatedScanId.current
      && nextMode === 'description' && scan.scanMode === 'description' && !scan.isCurrentScanLogged
      ? scan.descriptionInput : '';
    setDescription(draft?.description ?? submittedDescription);
    setSearchQuery(draft?.searchQuery ?? ''); setBarcodeEntry(draft?.barcodeEntry ?? '');
    setPendingFood(draft?.pendingFood ?? null); setPortionDraft(draft?.portion ?? null);
    setMode(nextMode);
    setShowDescription(nextMode === 'description');
    setShowSearch(nextMode === 'search');
    setShowBarcodeEntry(false);
    setTorchOn(false);
    setCapturing(false);
    setBarcodeBusy(false);
    return () => {
      scanFocused.current = false;
      scanVisit.current += 1;
      confirmAfterSearchDismiss.current = false;
      afterSheetDismiss.current = null;
      searchGeneration.current += 1;
      if (searchTimer.current) clearTimeout(searchTimer.current);
      setShowDescription(false);
      setShowSearch(false);
      setShowBarcodeEntry(false);
      setTorchOn(false);
    };
  }, [requestedMode]));

  /**
   * onCameraReady fires once per mounted camera. Resetting the flag whenever
   * `mode` changed cleared it on a FOTO → BARCODE → FOTO switch, which does
   * not remount anything, so the callback never came back and the shutter
   * answered "camera not ready" until the tab was left and re-entered. Only a
   * teardown may clear it.
   */
  useEffect(() => {
    if (!cameraActive) setCameraReady(false);
  }, [cameraActive]);

  // A barcode already handed off must not re-fire, but a new mode or a fresh
  // camera starts a new chance to scan one.
  useEffect(() => {
    setBarcodeBusy(false);
  }, [cameraActive, mode]);

  const requestCameraAccess = async () => {
    const visit = scanVisit.current;
    if (permission && !permission.canAskAgain) {
      Alert.alert(
        t.scan.permissionTitle,
        t.scan.permissionBody,
        [
          { text: t.common.cancel, style: 'cancel' },
          { text: t.scan.openSettings, onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }

    const nextPermission = await requestPermission();
    trackEvent('camera permission resolved', { granted: nextPermission.granted });
    if (!scanFocused.current || visit !== scanVisit.current) return;
    if (!nextPermission.granted) {
      Alert.alert(
        t.scan.permissionMissingTitle,
        nextPermission.canAskAgain ? t.scan.permissionAsk : t.scan.permissionDenied,
      );
    }
  };

  const close = () => {
    if (!scanFocused.current) return;
    scanFocused.current = false;
    scanVisit.current += 1;
    confirmAfterSearchDismiss.current = false;
    afterSheetDismiss.current = null;
    searchGeneration.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setScannerClosed(true);
    setDescription(''); setSearchQuery(''); setBarcodeEntry(''); setPendingFood(null); setPortionDraft(null); setScanInputDraft(null);
    setAdded([]); setAddError(null);
    resetScan();
    setTorchOn(false);
    Keyboard.dismiss();
    router.replace('/(tabs)/today');
  };

  const subscribed = subscriptionStatus === 'active';
  const subscriptionUncertain = subscriptionStatus === 'loading' || subscriptionStatus === 'error' || subscriptionStatus === 'pending';
  // hasEverLoggedScan is kept so the copy can distinguish a first-time user from
  // someone who has simply used up the allowance.
  const showAllowance = !subscribed && !subscriptionUncertain && hasEverLoggedScan;
  const { allowance, hardWall } = useFreeScanAllowance();

  const navigateAfterSheet = (target: '/analyzing' | '/paywall?reason=blocked') => {
    Keyboard.dismiss();
    if (Platform.OS === 'ios' && (showDescription || showBarcodeEntry)) {
      afterSheetDismiss.current = target;
      setShowDescription(false);
      setShowBarcodeEntry(false);
    } else {
      setShowDescription(false);
      setShowBarcodeEntry(false);
      router.push(target);
    }
  };
  const finishSheetDismiss = () => {
    const target = afterSheetDismiss.current;
    afterSheetDismiss.current = null;
    if (target && scanFocused.current) router.push(target);
  };

  const hasScanAccess = () => {
    // Loading/error is not proof of inactivity. Let the server-authoritative
    // analysis ledger decide instead of locally blocking a paying user after
    // a transient RevenueCat or network failure.
    if (subscribed || subscriptionUncertain || freeScansLeft > 0) return true;
    // The paywall reads very differently when it interrupted someone mid-scan
    // than when it was opened out of curiosity.
    navigateAfterSheet('/paywall?reason=blocked');
    return false;
  };

  const capture = async () => {
    if (!scanFocused.current || captureLock.current) return;
    if (!hasScanAccess()) return;
    captureLock.current = true;
    const visit = scanVisit.current;
    setCapturing(true);
    void primaryHaptic();

    try {
      if (!permission?.granted || !cameraRef.current) {
        trackEvent('camera capture failed', { failure_reason: 'not_ready' });
        Alert.alert(t.scan.notReadyTitle, t.scan.notReadyBody);
        return;
      }
      // Deliberately not gated on `cameraReady`. Some devices never send
      // onCameraReady, and refusing on a flag that may never arrive turns the
      // shutter into a dead button; asking the camera and handling the failure
      // costs one retry at worst.
      const result = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!scanFocused.current || visit !== scanVisit.current || AppState.currentState !== 'active') {
        deleteTemporaryPhoto(result?.uri);
        return;
      }
      if (!result?.uri) throw new Error('missing camera uri');
      // What is inside the frame is what gets analysed: crop to the guide.
      let photoUri = result.uri;
      try {
        const [frame, view] = await Promise.all([measure(guideRef), measure(containerRef)]);
        const crop = frame && view && result.width && result.height
          ? frameToPhotoCrop({ ...frame, x: frame.x - view.x, y: frame.y - view.y }, view, { width: result.width, height: result.height })
          : null;
        if (crop) {
          const cropped = await manipulateAsync(result.uri, [{ crop: { originX: crop.x, originY: crop.y, width: crop.width, height: crop.height } }], { compress: 0.92, format: SaveFormat.JPEG });
          deleteTemporaryPhoto(result.uri);
          photoUri = cropped.uri;
        }
      } catch { /* the full photo still works; never lose a capture over a crop */ }
      if (!scanFocused.current || visit !== scanVisit.current || AppState.currentState !== 'active') {
        deleteTemporaryPhoto(photoUri);
        return;
      }
      setCapturedPhoto(photoUri);
      router.push('/analyzing');
    } catch {
      if (scanFocused.current && visit === scanVisit.current && AppState.currentState === 'active') {
        trackEvent('camera capture failed', { failure_reason: 'capture_failed' });
        Alert.alert(t.scan.captureFailedTitle, t.scan.captureFailedBody);
      }
    } finally {
      if (visit === scanVisit.current) {
        captureLock.current = false;
        setCapturing(false);
      }
    }
  };

  // The demo meal never reaches the analysis gateway, so it costs nothing and
  // must not spend one of the three free meals. A user trying it first should
  // not lose a third of their trial on a meal they did not eat.
  const runDemo = () => {
    startDemoScan();
    router.push('/analyzing');
  };

  const chooseMode = (nextMode: 'photo' | 'description' | 'barcode' | 'search') => {
    if (!scanFocused.current || captureLock.current) return;
    barcodeLock.current = false;
    setMode(nextMode);
    if (nextMode !== 'barcode' && nextMode !== 'photo') setTorchOn(false);
    if (nextMode === 'description') setShowDescription(true);
    if (nextMode === 'search') setShowSearch(true);
  };

  /**
   * Search does not reach the model, so it costs neither a free meal nor any
   * credit: that is the whole reason it exists next to the camera.
   *
   * Debounced, and every response is checked against the request that is still
   * current: typing "rice" fired four searches, and a slow first one could
   * land after a later, better one and overwrite it.
   */
  // Language-aware: suggestion names follow the app language.
  const usage = useMemo(() => foodUsage(mealHistory), [mealHistory]);
  // Own products ("Mein Produkt") lead every list they match; refreshed from
  // the cloud once while the search sheet is open.
  const customFoods = useCustomFoods(showSearch);
  // Empty field: own products, then what is eaten often, then the latest.
  const myProducts = useMemo(() => customFoods.slice(0, 5).map(customFoodResult), [customFoods, language]);
  const frequent = useMemo(() => frequentFoods(mealHistory), [mealHistory, language]);
  const recents = useMemo(() => {
    const shown = new Set([...myProducts, ...frequent].map(result => result.source.referenceId ?? result.id));
    return recentFoods(mealHistory).filter(result => !shown.has(result.source.referenceId ?? result.id));
  }, [mealHistory, language, myProducts, frequent]);
  const badgeLabel = (badge: FoodSourceBadge) => ({
    bls: t.scan.badgeBls, off: t.scan.badgeOff, usda: t.scan.badgeUsda, custom: t.scan.badgeCustom, own: t.scan.badgeOwn, catalog: t.scan.badgeCatalog,
  })[badge];
  const runSearch = (value: string, submitted = false) => {
    setCompletedEmptySearch(false);
    setSearchNotice(null);
    setSearchError(null);
    setSearchQuery(value);
    setVisibleSearchCount(15);
    const term = value.trim();
    const generation = ++searchGeneration.current;
    latestSearch.current = term;
    // Keep the previous list visible while typing; it is replaced as soon as
    // the current query answers. Clearing it on every key made the list jump.
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    // Instant on-device suggestions (own products first, then the German
    // catalogue); the gateway's brands/products follow after the debounce.
    const local = mergeSuggestions(matchCustomFoods(term, customFoods), suggestFoods(term, usage));
    setSearchResults(local);
    setSearching(true);
    setSearchError(null);
    searchTimer.current = setTimeout(() => {
      const request = term;
      latestSearch.current = request;
      const startedAt = Date.now();
      trackEvent('food search started', {});
      void searchFoods(request, { catalogueOnly: !submitted })
        .then((results) => {
          if (latestSearch.current !== request || generation !== searchGeneration.current) return;
          trackEvent('food search completed', { result_count: results.length === 0 ? '0' : results.length <= 15 ? '1-15' : results.length <= 30 ? '16-30' : '31+', duration: durationBucket(startedAt) });
          // Catalogue-only results are normal while typing; the brand search
          // sits as a quiet action under the list instead of a notice.
          setSearchNotice(results.searchStatus === 'partial' ? t.errors.searchPartial : null);
          setCompletedEmptySearch(submitted && results.searchStatus === 'complete' && !results.length);
          setSearchResults(mergeSuggestions(local, results));
          setSearching(false);
          // Brands and products live outside the local catalogue. When typing
          // pauses and the catalogue has little to offer, ask the full search
          // without making the user find the return key.
          if (!submitted && results.searchStatus === 'catalogue' && results.length < 5) {
            searchTimer.current = setTimeout(() => {
              if (generation === searchGeneration.current && latestSearch.current === request) runSearch(value, true);
            }, 650);
          }
        })
        .catch((error: unknown) => {
          if (latestSearch.current !== request || generation !== searchGeneration.current) return;
          setSearchResults(local);
          // Swallowing this showed "nothing found" for a network failure and
          // for a withdrawn consent alike, which tells the user the food does
          // not exist when the truth is that we never asked.
          trackEvent('food search failed', { failure_reason: error instanceof MealAnalysisError ? error.kind : 'provider-error', duration: durationBucket(startedAt) });
          // Offline or a gateway hiccup: the local suggestions still work.
          if (!local.length) setSearchError(error instanceof MealAnalysisError ? error.message : t.errors.gatewayProviderError);
          setSearching(false);
        });
    }, submitted ? 0 : 350);
  };

  useEffect(() => {
    searchGeneration.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearching(false);
    setSearchResults([]);
    setCompletedEmptySearch(false);
    setSearchNotice(null);
    setSearchError(null);
  }, [showSearch, locale]);

  /**
   * Picking a food no longer logs it: it opens the amount sheet. Deciding
   * "how much" before knowing "of what" was the wrong order, and grams was
   * the only unit on offer.
   */
  const addSearchResult = (result: FoodSearchResult) => {
    const rank = searchResults.indexOf(result) + 1;
    trackEvent('food search selected', { rank: rank <= 3 ? '1-3' : rank <= 15 ? '4-15' : '16+' });
    Keyboard.dismiss();
    setPortionDraft(null);
    setPendingFood(result);
  };
  const cancelPortion = () => { setPendingFood(null); setPortionDraft(null); if (searchQuery.trim().length >= 2) runSearch(searchQuery); };
  const cancelSearch = () => {
    if (added.length) {
      // Picks are not saved yet, so leaving must not silently drop or save them.
      Alert.alert(t.scan.discardTitle, t.scan.discardBody, [
        { text: t.scan.keepPicking, style: 'cancel' },
        { text: t.scan.discardConfirm, style: 'destructive', onPress: doneAdding },
      ]);
      return;
    }
    setManualFor(null); setQuickAddFor(null); setPendingFood(null); setPortionDraft(null); setSearchQuery(''); setSearchResults([]); setShowSearch(false); setMode('photo'); };

  /** The search sheet is a native modal: it must be gone before a new screen. */
  const openLabelScan = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'ios') {
      labelAfterSearchDismiss.current = true;
      setShowSearch(false);
    } else {
      setShowSearch(false);
      router.push('/label-scan');
    }
  };
  const confirmDeleteCustom = (result: FoodSearchResult) => {
    const id = result.source.referenceId?.replace(/^custom-/, '');
    if (!id) return;
    Alert.alert(t.scan.deleteCustomTitle, t.scan.deleteCustomBody, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.scan.deleteCustomConfirm, style: 'destructive', onPress: () => void deleteCustomFood(id) },
    ]);
  };

  const confirmPortion = (grams: number) => {
    if (!pendingFood) return;
    finishFood(pendingFood, grams);
  };
  const finishFood = (food: FoodSearchResult, grams: number) => {
    if (adding) return;
    setAddError(null);
    void successHaptic();
    const kcal = Math.round(food.per100g.calories * grams / 100);
    setAdded(list => [...list, { id: `pick-${++pickSerial.current}`, food, name: food.name, grams, kcal }]);
    setPendingFood(null); setPortionDraft(null); setManualFor(null); setQuickAddFor(null);
    setSearchQuery(''); setSearchResults([]); setScanInputDraft(null);
    setSearchError(null); setSearchNotice(null); setCompletedEmptySearch(false); setSearching(false);
    searchGeneration.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
  };
  const removePicked = (id: string) => setAdded(list => list.filter(entry => entry.id !== id));
  const savePicked = async () => {
    if (adding || !added.length) return;
    setAdding(true); setAddError(null);
    try {
      await logFoodsDirect(added.map(entry => ({ result: entry.food, grams: entry.grams })));
      void successHaptic();
      doneAdding();
    } catch (error) {
      setAddError(error instanceof Error && error.message ? error.message : t.result.saveFailed);
    } finally {
      setAdding(false);
    }
  };
  const doneAdding = () => {
    setAdded([]); setAddError(null); setPlannedMealType(null); setPlannedMealDate(null);
    setPendingFood(null); setPortionDraft(null); setManualFor(null);
    setSearchQuery(''); setSearchResults([]); setShowSearch(false); setMode('photo');
    Keyboard.dismiss();
    router.replace('/(tabs)/today');
  };
  // The slot the picks are saved under: the one chosen on Today, else the clock.
  const saveSlot = plannedMealType ?? mealTypeForTime();
  const pastDay = plannedMealDate && plannedMealDate !== localDateKey() ? plannedMealDate : null;
  const targetLabel = plannedMealType || pastDay
    ? [pastDay ? formatDayLabel(pastDay, localDateKey(), t.today, locale) : null, plannedMealType ? mealTypeLabel(plannedMealType, t.common) : null].filter(Boolean).join(' · ')
    : null;

  const submitDescription = () => {
    const value = description.trim();
    const local = value.length >= 2 ? parseLocalDescription(value, usage) : null;
    if (!local && value.length < 3) {
      Alert.alert(t.scan.describeShortTitle, t.scan.describeShortBody);
      return;
    }
    // A description Kandro can resolve itself costs no analysis and is never blocked.
    if (!local && !hasScanAccess()) return;
    setShowDescription(false);
    startDescriptionScan(value);
    setDescription(''); setSearchQuery(''); setBarcodeEntry(''); setScanInputDraft(null);
    navigateAfterSheet('/analyzing');
  };

  const openBarcode = (data: string) => {
    if (!scanFocused.current || barcodeLock.current || !/^\d{7,14}$/.test(data)) return;
    barcodeLock.current = true;
    setBarcodeBusy(true);
    void successHaptic();
    startBarcodeScan(data);
    setBarcodeEntry(''); setDescription(''); setSearchQuery(''); setScanInputDraft(null);
    navigateAfterSheet('/analyzing');
  };

  const handleBarcode = ({ data }: BarcodeScanningResult) => {
    if (cameraActive && mode === 'barcode') openBarcode(data);
  };

  const submitBarcodeEntry = () => {
    const normalized = barcodeEntry.replace(/\D/g, '');
    if (!/^\d{7,14}$/.test(normalized)) {
      Alert.alert(t.scan.barcodeManualInvalidTitle, t.scan.barcodeManualInvalidBody);
      return;
    }
    setShowBarcodeEntry(false);
    openBarcode(normalized);
  };

  const renderResult = (result: FoodSearchResult) => {
    const badge = badgeLabel(foodSourceBadge(result));
    const own = isCustomFoodResult(result);
    return (
      <View key={result.id} style={styles.searchResultRow}>
        <Pressable accessibilityHint={t.scan.sourceBadgeLabel(badge)} accessibilityRole="button" onPress={() => addSearchResult(result)} style={[styles.searchRow, styles.searchRowMain]}>
          <View style={styles.searchRowCopy}>
            <Text numberOfLines={2} style={styles.searchRowName}>{result.name}</Text>
            <Text style={styles.searchRowMeta}>
              {result.lastGrams
                ? `${t.scan.lastAmount(`${formatNumber(result.lastGrams, locale)} g`)} · ${formatNumber(Math.round(result.per100g.calories * result.lastGrams / 100), locale)} kcal`
                : `${formatNumber(Math.round(result.per100g.calories), locale)} kcal ${t.scan.searchPer100} · ${formatNumber(Number(result.per100g.protein.toFixed(1)), locale)} g ${t.common.protein}`}
            </Text>
            <View style={[styles.sourceBadge, own && styles.sourceBadgeOwn]}>
              <Text numberOfLines={1} style={[styles.sourceBadgeText, own && styles.sourceBadgeTextOwn]}>{badge}</Text>
            </View>
          </View>
          <Ionicons color={colors.accentText} name="add-circle" size={26} />
        </Pressable>
        {own && searchQuery.trim().length < 2 ? (
          <Pressable accessibilityLabel={t.scan.deleteCustom(result.name)} accessibilityRole="button" hitSlop={6} onPress={() => confirmDeleteCustom(result)} style={styles.searchRowDelete}>
            <Ionicons color={colors.muted} name="trash-outline" size={20} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View ref={containerRef} style={[styles.container, !cameraActive && styles.fallbackBackground]}>
      {cameraActive ? (
        <>
          <CameraView
            pictureSize={Platform.OS === 'ios' ? '1920x1080' : undefined}
            pointerEvents="none"
            active={Platform.OS === 'ios' ? cameraActive : undefined}
            autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] }}
            enableTorch={(mode === 'barcode' || mode === 'photo') && torchOn}
            facing="back"
            onCameraReady={() => setCameraReady(true)}
            onBarcodeScanned={mode === 'barcode' ? handleBarcode : undefined}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            zoom={mode === 'barcode' ? 0.08 : 0}
          />
          {/* A black rectangle reads as a broken camera; say it is starting. */}
          {cameraReady ? null : (
            <View pointerEvents="none" style={styles.cameraStarting}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.cameraStartingText}>{t.scan.cameraStarting}</Text>
            </View>
          )}
        </>
      ) : null}

      <View pointerEvents="none" style={styles.scrimTop} />
      <View pointerEvents="none" style={styles.scrimBottom} />

      <SafeAreaView pointerEvents="box-none" edges={['top', 'bottom']} style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel={t.scan.close} accessibilityRole="button" hitSlop={8} onPress={close} style={styles.circleButton}>
            <Ionicons color={colors.white} name="close" size={24} />
          </Pressable>
          <View style={styles.titlePill}>
            <Ionicons color={colors.accent} name="sparkles" size={15} />
            <Text numberOfLines={1} style={styles.screenTitle}>{targetLabel ? `${t.scan.title} · ${targetLabel}` : t.scan.title}</Text>
          </View>
          {(mode === 'barcode' || mode === 'photo') && cameraActive ? (
            <Pressable
              accessibilityLabel={torchOn ? t.scan.torchOff : t.scan.torchOn}
              accessibilityRole="switch"
              accessibilityState={{ checked: torchOn }}
              onPress={() => setTorchOn((value) => !value)}
              style={[styles.circleButton, torchOn && styles.circleButtonActive]}
            >
              <Ionicons color={torchOn ? colors.onAccent : colors.white} name={torchOn ? 'flash' : 'flash-outline'} size={21} />
            </Pressable>
          ) : <View style={styles.circlePlaceholder} />}
        </View>

        {cameraActive ? (
          <View ref={guideRef} collapsable={false} style={styles.guideArea}>
            <View style={styles.cornerTopLeft} />
            <View style={styles.cornerTopRight} />
            <View style={styles.cornerBottomLeft} />
            <View style={styles.cornerBottomRight} />
            <View style={styles.tipPill}>
              <View style={styles.tipDot} />
              <Text style={styles.tipText}>{mode === 'barcode' ? t.scan.framingBarcode : t.scan.framingPhoto}</Text>
            </View>
          </View>
        ) : (
          <ScrollView style={styles.fallbackScroll} contentContainerStyle={styles.fallback}>
          <View style={styles.fallbackOrb}>
            <Ionicons color={colors.accent} name="restaurant" size={58} />
          </View>
          <Text style={styles.fallbackTitle}>
            {mode === 'description'
              ? t.scan.fallbackDescribeTitle
              : mode === 'barcode'
                ? t.scan.fallbackBarcodeTitle
                : t.scan.fallbackPhotoTitle}
          </Text>
          <Text style={styles.fallbackText}>
            {mode === 'description'
              ? t.scan.fallbackDescribeText
              : mode === 'barcode'
                ? t.scan.fallbackBarcodeText
                : t.scan.fallbackPhotoText}
          </Text>
          {mode !== 'description' && !permission ? <Text style={styles.permissionStatus}>{t.scan.permissionChecking}</Text> : null}
          {mode !== 'description' && permission && !permission.granted ? (
            <Pressable accessibilityRole="button" onPress={() => void requestCameraAccess()} style={styles.permissionButton}>
              <Ionicons color={colors.onAccent} name="camera-outline" size={18} />
              <Text style={styles.permissionText}>{permission.canAskAgain ? t.scan.allowCamera : t.scan.openSettings}</Text>
            </Pressable>
          ) : null}
          </ScrollView>
        )}

        <View style={styles.controls}>
          {showAllowance ? (
            <View style={styles.allowancePill}>
              <Ionicons color={colors.accent} name="sparkles" size={13} />
              <Text style={styles.allowanceText}>
                {hardWall
                  ? freeScansLeft > 0 ? t.scan.trialScanLeft : t.scan.trialScanUsed
                  : freeScansLeft > 0 ? t.scan.allowanceLeft(freeScansLeft, allowance) : t.scan.allowanceUsed}
              </Text>
            </View>
          ) : null}
          <View accessibilityRole="radiogroup" style={styles.modeLabel}>
            <ModeButton active={mode === 'photo'} label={t.scan.modePhoto} onPress={() => chooseMode('photo')} />
            <ModeButton active={mode === 'description'} label={t.scan.modeDescribe} onPress={() => chooseMode('description')} />
            <ModeButton active={mode === 'barcode'} label={t.scan.modeBarcode} onPress={() => chooseMode('barcode')} />
            <ModeButton active={mode === 'search'} label={t.scan.modeSearch} onPress={() => chooseMode('search')} />
          </View>
          {mode === 'photo' ? (
            <View style={styles.shutterRow}>
              <View style={styles.smallPlaceholder} />
              <Pressable accessibilityLabel={t.scan.shutter} accessibilityRole="button" accessibilityState={{ disabled: capturing }} disabled={capturing} onPress={capture} style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}>
                <View style={styles.shutterInner} />
              </Pressable>
              <Pressable accessibilityLabel={t.scan.demoLabel} accessibilityRole="button" onPress={runDemo} style={styles.demoControl}>
                <Ionicons color={colors.white} name="play-outline" size={17} />
                <Text style={styles.demoControlText}>{t.scan.demo}</Text>
              </Pressable>
            </View>
          ) : mode === 'barcode' ? (
            <View style={styles.barcodeState}>
              <Ionicons color={colors.accent} name="barcode-outline" size={30} />
              <Text style={styles.barcodeText}>{barcodeBusy ? t.scan.barcodeOpening : t.scan.barcodeWaiting}</Text>
              <Pressable accessibilityRole="button" onPress={() => setShowBarcodeEntry(true)} style={styles.barcodeManualButton}>
                <Ionicons color={colors.white} name="keypad-outline" size={16} />
                <Text style={styles.barcodeManualText}>{t.scan.barcodeManual}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setShowDescription(true)} style={styles.describeButton}>
              <Ionicons color={colors.onAccent} name="create-outline" size={19} />
              <Text style={styles.describeButtonText}>{t.scan.openDescription}</Text>
            </Pressable>
          )}
          <Text style={styles.privacy}>{mode === 'photo' ? t.scan.privacyPhoto : t.scan.privacyOther}</Text>
        </View>
      </SafeAreaView>

      <Modal animationType="none" onDismiss={finishSheetDismiss} onRequestClose={() => setShowBarcodeEntry(false)} transparent visible={showBarcodeEntry}>
        <Animated.View style={[styles.modalScrim, { paddingBottom: keyboardInset }]}>
          <View accessibilityViewIsModal style={[styles.barcodeSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text accessibilityRole="header" style={styles.describeTitle}>{t.scan.barcodeManualTitle}</Text>
            <Text style={styles.describeText}>{t.scan.barcodeManualHint}</Text>
            <TextInput
              accessibilityLabel={t.scan.barcodeManualTitle}
              autoFocus
              keyboardType="number-pad"
              maxLength={18}
              onChangeText={setBarcodeEntry}
              onSubmitEditing={submitBarcodeEntry}
              placeholder={t.scan.barcodeManualPlaceholder}
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.barcodeInput}
              value={barcodeEntry}
            />
            <Pressable accessibilityRole="button" onPress={submitBarcodeEntry} style={styles.describeSubmit}>
              <Text style={styles.describeSubmitText}>{t.scan.barcodeManualSubmit}</Text>
              <Ionicons color={colors.white} name="search" size={18} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setShowBarcodeEntry(false)} style={styles.describeCancel}>
              <Text style={styles.describeCancelText}>{t.common.cancel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Modal>

      <Modal animationType="none" onDismiss={() => {
        if (confirmAfterSearchDismiss.current) {
          confirmAfterSearchDismiss.current = false;
          router.push('/confirm');
        } else if (labelAfterSearchDismiss.current) {
          labelAfterSearchDismiss.current = false;
          if (scanFocused.current) router.push('/label-scan');
        }
      }} onRequestClose={() => { if (pendingFood) cancelPortion(); else cancelSearch(); }} transparent visible={showSearch}>
        {pendingFood ? <PortionSheet
          embedded
          key={pendingFood.id}
          initialDraft={portionDraft}
          onDraftChange={setPortionDraft}
          onCancel={cancelPortion}
          onConfirm={confirmPortion}
          target={{ name: pendingFood.name, per100g: pendingFood.per100g, defaultGrams: pendingFood.lastGrams ?? pendingFood.defaultGrams, amountIsChosen: Boolean(pendingFood.lastGrams), adding: true, portions: pendingFood.portions, sourceLabel: pendingFood.source.label }}
          visible
        /> : (
        <Animated.View style={[styles.modalScrim, { paddingBottom: keyboardInset }]}>
          <View accessibilityViewIsModal style={[styles.searchSheet, { paddingBottom: insets.bottom + 16 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.searchResults} contentContainerStyle={styles.searchContent}>
            {manualFor !== null ? <>
              {addError ? <Text accessibilityRole="alert" style={styles.searchError}>{addError}</Text> : null}
              <ManualFoodForm initialName={manualFor} onCancel={() => { setAddError(null); setManualFor(null); }} onConfirm={finishFood} />
            </> : quickAddFor !== null ? <>
              {addError ? <Text accessibilityRole="alert" style={styles.searchError}>{addError}</Text> : null}
              <QuickAddForm initialName={quickAddFor} onCancel={() => { setAddError(null); setQuickAddFor(null); }} onConfirm={finishFood} />
            </> : <>
            <View style={styles.searchHead}>
              <Text accessibilityRole="header" style={styles.describeTitle}>{t.scan.searchTitle}</Text>
              <View style={styles.freePill}><Text style={styles.freePillText}>{t.scan.searchFree}</Text></View>
            </View>
            <Text style={styles.describeText}>{t.scan.searchHint}</Text>
            {added.length ? <View accessibilityLiveRegion="polite" style={styles.addedBox}>
              {added.map(entry => (
                <View key={entry.id} style={styles.addedRow}>
                  <Ionicons color={colors.success} name="checkmark-circle" size={18} />
                  <Text numberOfLines={1} style={styles.addedText}>{isQuickAddResult(entry.food) ? `${entry.name} · ${formatNumber(entry.kcal, locale)} kcal` : `${entry.name} · ${formatNumber(entry.grams, locale)} g · ${formatNumber(entry.kcal, locale)} kcal`}</Text>
                  <Pressable accessibilityLabel={t.scan.removePicked(entry.name)} accessibilityRole="button" hitSlop={10} onPress={() => removePicked(entry.id)} style={styles.addedRemove}>
                    <Ionicons color={colors.muted} name="close" size={18} />
                  </Pressable>
                </View>
              ))}
              <Text style={styles.addedHint}>{t.scan.pickedHint(added.length, formatNumber(added.reduce((sum, entry) => sum + entry.kcal, 0), locale))}</Text>
            </View> : null}
            {addError ? <Text accessibilityRole="alert" style={styles.searchError}>{addError}</Text> : null}
            <TextInput
              accessibilityLabel={t.scan.searchTitle}
              autoCorrect={false}
              autoFocus
              maxLength={60}
              onChangeText={runSearch}
              onSubmitEditing={() => runSearch(searchQuery, true)}
              placeholder={t.scan.searchPlaceholder}
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={styles.searchInput}
              value={searchQuery}
            />
            {searchNotice ? <Text accessibilityLiveRegion="polite" style={styles.searchStatus}>{searchNotice}</Text> : null}
            <View>
              {searching && !searchResults.length ? <Text style={styles.searchStatus}>{t.scan.searchSearching}</Text> : null}
              {!searching && searchError ? (
                <Text accessibilityLiveRegion="polite" style={styles.searchError}>{searchError}</Text>
              ) : null}
              {!searching && !searchError && !searchNotice && searchQuery.trim().length >= 2 && !searchResults.length ? (
                <Text style={styles.searchStatus}>{t.scan.searchEmpty}</Text>
              ) : null}
              {!searching && !searchError && t.scan.searchHintEnglish && searchQuery.trim().length >= 2 && !searchResults.length ? (
                <Text style={styles.searchStatus}>{t.scan.searchHintEnglish}</Text>
              ) : null}
              {completedEmptySearch && !searching && !searchError ? <CaptureSearchHelp query={searchQuery.trim()} onConfirm={value=>runSearch(value,true)}/> : null}
              {searchQuery.trim().length < 2 ? <>
                {myProducts.length ? <Text accessibilityRole="header" style={styles.searchSection}>{t.scan.myProductsTitle}</Text> : null}
                {myProducts.map(renderResult)}
                {frequent.length ? <Text accessibilityRole="header" style={styles.searchSection}>{t.scan.frequentTitle}</Text> : null}
                {frequent.map(renderResult)}
                {recents.length ? <Text accessibilityRole="header" style={styles.searchSection}>{t.scan.recentTitle}</Text> : null}
                {recents.map(renderResult)}
              </> : searchResults.slice(0, visibleSearchCount).map(renderResult)}
              {searchResults.length > visibleSearchCount ? <PrimaryButton label={t.scan.searchMore} variant="secondary" onPress={() => setVisibleSearchCount((count) => count + 15)} /> : null}
              {searchQuery.trim().length >= 2 && !searching ? (
                <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); runSearch(searchQuery, true); }} style={styles.searchRow}>
                  <View style={styles.searchRowCopy}>
                    <Text numberOfLines={2} style={styles.searchRowName}>{t.errors.searchSubmit}</Text>
                    <Text style={styles.searchRowMeta}>{t.scan.brandSearchHint}</Text>
                  </View>
                  <Ionicons color={colors.accentText} name="search" size={22} />
                </Pressable>
              ) : null}
              {searchQuery.trim().length >= 2 && !searching ? (
                <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setManualFor(searchQuery.trim()); }} style={styles.searchRow}>
                  <View style={styles.searchRowCopy}>
                    <Text numberOfLines={2} style={styles.searchRowName}>{t.scan.manualCta(searchQuery.trim())}</Text>
                    <Text style={styles.searchRowMeta}>{t.scan.manualSource}</Text>
                  </View>
                  <Ionicons color={colors.accentText} name="create-outline" size={24} />
                </Pressable>
              ) : null}
              {!searching ? (
                <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setQuickAddFor(searchQuery.trim()); }} style={styles.searchRow}>
                  <View style={styles.searchRowCopy}>
                    <Text numberOfLines={2} style={styles.searchRowName}>{t.scan.quickAddCta}</Text>
                    <Text style={styles.searchRowMeta}>{t.scan.quickAddHint}</Text>
                  </View>
                  <Ionicons color={colors.accentText} name="flash-outline" size={24} />
                </Pressable>
              ) : null}
              {!searching ? (
                <Pressable accessibilityRole="button" onPress={() => openLabelScan()} style={styles.searchRow}>
                  <View style={styles.searchRowCopy}>
                    <Text numberOfLines={2} style={styles.searchRowName}>{t.scan.labelScanCta}</Text>
                    <Text style={styles.searchRowMeta}>{t.scan.labelScanHint}</Text>
                  </View>
                  <Ionicons color={colors.accentText} name="nutrition-outline" size={24} />
                </Pressable>
              ) : null}
            </View>
            </>}
            </ScrollView>
            {manualFor !== null || quickAddFor !== null ? null : added.length ? <>
              <PrimaryButton disabled={adding} icon="checkmark" label={t.scan.saveAs(mealTypeLabel(saveSlot, t.common))} onPress={() => void savePicked()} />
              <Pressable accessibilityRole="button" onPress={cancelSearch} style={styles.describeCancel}>
                <Text style={styles.describeCancelText}>{t.common.cancel}</Text>
              </Pressable>
            </> : (
            <Pressable accessibilityRole="button" onPress={cancelSearch} style={styles.describeCancel}>
              <Text style={styles.describeCancelText}>{t.common.cancel}</Text>
            </Pressable>)}
          </View>
        </Animated.View>
        )}
      </Modal>

      <Modal animationType="none" onDismiss={finishSheetDismiss} onRequestClose={() => { setShowDescription(false); setMode('photo'); }} transparent visible={showDescription}>
        <Animated.View style={[styles.modalScrim, { paddingBottom: keyboardInset }]}>
          <View accessibilityViewIsModal style={[styles.describeSheet, { paddingBottom: insets.bottom + 22 }]}>
            <Text accessibilityRole="header" style={styles.describeTitle}>{t.scan.describeTitle}</Text>
            <Text style={styles.describeText}>{t.scan.describeText}</Text>
            <TextInput
              accessibilityLabel={t.scan.describeTitle}
              autoFocus
              maxLength={500}
              multiline
              onChangeText={setDescription}
              placeholder={t.scan.describePlaceholder}
              placeholderTextColor={colors.muted}
              style={styles.describeInput}
              value={description}
            />
            <VoiceInputButton onChange={setDescription} value={description} />
            <Pressable accessibilityRole="button" onPress={submitDescription} style={styles.describeSubmit}>
              <Text style={styles.describeSubmitText}>{t.scan.describeSubmit}</Text>
              <Ionicons color={colors.white} name="arrow-forward" size={18} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setShowDescription(false); setMode('photo'); }} style={styles.describeCancel}>
              <Text style={styles.describeCancelText}>{t.common.cancel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Modal>
    </View>
  );
}

function ModeButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable aria-checked={active} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text numberOfLines={1} style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.camera },
  fallbackBackground: { backgroundColor: colors.cameraSoft },
  fallbackScroll: { flex: 1, minHeight: 0 },
  fallback: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 18 },
  fallbackOrb: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(187,220,142,0.12)', borderWidth: 1, borderColor: 'rgba(187,220,142,0.32)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  fallbackTitle: { ...typeScale.title2, color: colors.white, fontWeight: '700', textAlign: 'center' },
  fallbackText: { ...typeScale.footnote, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 8 },
  permissionButton: { marginTop: 18, minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 16, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 8 },
  permissionText: { ...typeScale.footnote, flexShrink: 1, textAlign: 'center', color: colors.onAccent, fontWeight: '700' },
  cameraStarting: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  cameraStartingText: { ...typeScale.footnote, color: 'rgba(255,255,255,0.72)', fontWeight: '600' },
  permissionStatus: { ...typeScale.caption, color: 'rgba(255,255,255,0.58)', marginTop: 16 },
  scrimTop: { pointerEvents: 'none', position: 'absolute', left: 0, right: 0, top: 0, height: 160, backgroundColor: 'rgba(0,0,0,0.36)' },
  scrimBottom: { pointerEvents: 'none', position: 'absolute', left: 0, right: 0, bottom: 0, height: 250, backgroundColor: 'rgba(0,0,0,0.48)' },
  overlay: { flex: 1, justifyContent: 'space-between', pointerEvents: 'box-none', zIndex: 2 },
  topBar: { minHeight: 66, paddingVertical: 8, paddingHorizontal: 18, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circleButton: { flexShrink: 0, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(17,19,15,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  circleButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  circlePlaceholder: { flexShrink: 0, width: 42, height: 42 },
  titlePill: { flexShrink: 1, minWidth: 0, minHeight: 38, paddingVertical: 8, borderRadius: 19, backgroundColor: 'rgba(17,19,15,0.58)', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  screenTitle: { ...typeScale.callout, flexShrink: 1, textAlign: 'center', color: colors.white, fontWeight: '700' },
  guideArea: { pointerEvents: 'none', flex: 1, marginHorizontal: 28, marginVertical: 42 },
  cornerTopLeft: { position: 'absolute', top: 0, left: 0, width: 50, height: 50, borderTopWidth: 2, borderLeftWidth: 2, borderColor: 'rgba(255,255,255,0.74)', borderTopLeftRadius: 18 },
  cornerTopRight: { position: 'absolute', top: 0, right: 0, width: 50, height: 50, borderTopWidth: 2, borderRightWidth: 2, borderColor: 'rgba(255,255,255,0.74)', borderTopRightRadius: 18 },
  cornerBottomLeft: { position: 'absolute', bottom: 0, left: 0, width: 50, height: 50, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: 'rgba(255,255,255,0.74)', borderBottomLeftRadius: 18 },
  cornerBottomRight: { position: 'absolute', bottom: 0, right: 0, width: 50, height: 50, borderBottomWidth: 2, borderRightWidth: 2, borderColor: 'rgba(255,255,255,0.74)', borderBottomRightRadius: 18 },
  tipPill: { position: 'absolute', bottom: 18, alignSelf: 'center', height: 34, borderRadius: 17, backgroundColor: 'rgba(17,19,15,0.62)', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  tipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  tipText: { ...typeScale.caption, color: colors.white, fontWeight: '600' },
  controls: { paddingHorizontal: 24, paddingBottom: 7, alignItems: 'center', gap: 16 },
  allowancePill: { minHeight: 30, maxWidth: '100%', borderRadius: 15, backgroundColor: 'rgba(17,19,15,0.62)', paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  allowanceText: { ...typeScale.caption, flexShrink: 1, textAlign: 'center', color: colors.white, fontWeight: '700' },
  modeLabel: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', borderRadius: radii.pill, backgroundColor: 'rgba(17,19,15,0.58)', padding: 3 },
  modeButton: { flexGrow: 1, maxWidth: '100%', minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { backgroundColor: colors.accent },
  // 13 pt semibold in sentence case: the old 9 pt capitals were unreadable over a live camera.
  modeText: { ...typeScale.footnote, textAlign: 'center', color: 'rgba(255,255,255,0.78)', fontWeight: '600' },
  modeTextActive: { color: colors.onAccent },
  shutterRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.accent },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  smallPlaceholder: { width: 62, height: 46 },
  demoControl: { width: 62, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 },
  demoControlText: { ...typeScale.caption, color: colors.white, fontWeight: '700' },
  barcodeState: { minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 7 },
  barcodeText: { ...typeScale.caption, color: colors.white, fontWeight: '700' },
  barcodeManualButton: { minHeight: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 },
  barcodeManualText: { ...typeScale.caption, color: colors.white, fontWeight: '700' },
  describeButton: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.accent, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  describeButtonText: { ...typeScale.footnote, color: colors.onAccent, fontWeight: '800' },
  privacy: { ...typeScale.caption, color: 'rgba(255,255,255,0.48)' },
  modalScrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.58)', justifyContent: 'flex-end' },
  barcodeSheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface, paddingHorizontal: 22, paddingTop: 22, gap: 13 },
  barcodeInput: { minHeight: 56, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 15 },
  searchSheet: { maxHeight: '86%', borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card, backgroundColor: colors.background, paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  searchHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  freePill: { borderRadius: radii.pill, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 4 },
  freePillText: { ...typeScale.caption, color: colors.accentText, fontWeight: '800', letterSpacing: 0.4 },
  searchInput: { minHeight: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 17, paddingHorizontal: 16 },
  searchResults: { flexShrink: 1 },
  searchContent: { gap: 12 },
  searchError: { ...typeScale.subhead, color: colors.attentionText, paddingVertical: 12 },
  searchStatus: { ...typeScale.subhead, color: colors.muted, paddingVertical: 12 },
  addedBox: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.successSoft },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addedText: { ...typeScale.subhead, flex: 1, color: colors.text, fontWeight: '600' },
  addedRemove: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  addedHint: { ...typeScale.footnote, color: colors.muted },
  searchSection: { ...typeScale.footnote, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8, marginBottom: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchRowCopy: { flex: 1, gap: 3 },
  searchResultRow: { flexDirection: 'row', alignItems: 'stretch' },
  searchRowMain: { flex: 1 },
  searchRowDelete: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  sourceBadge: { alignSelf: 'flex-start', marginTop: 3, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 2 },
  sourceBadgeOwn: { borderColor: colors.accentText, backgroundColor: colors.neutralSoft },
  sourceBadgeText: { ...typeScale.caption, color: colors.muted, fontWeight: '700' },
  sourceBadgeTextOwn: { color: colors.accentText },
  searchRowName: { ...typeScale.label, color: colors.text, fontWeight: '600' },
  searchRowMeta: { ...typeScale.footnote, color: colors.muted },
  describeSheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface, paddingHorizontal: 22, paddingTop: 22, gap: 13 },
  describeTitle: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
  describeText: { ...typeScale.footnote, color: colors.muted },
  describeInput: { minHeight: 128, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 16, lineHeight: 23, padding: 14, textAlignVertical: 'top' },
  describeSubmit: { minHeight: 54, borderRadius: radii.button, backgroundColor: colors.camera, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  describeSubmitText: { ...typeScale.callout, color: colors.white, fontWeight: '800' },
  describeCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  describeCancelText: { ...typeScale.footnote, color: colors.muted, fontWeight: '700' },
});
