import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EMPTY_LABEL_FORM, LabelFoodForm, type LabelForm } from '@/components/LabelFoodForm';
import { PrimaryButton } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { customFoodResult, saveCustomFood, type CustomFoodDraft } from '@/services/customFoods';
import { countLifetimeScanOnce } from '@/services/localRepository';
import { deleteTemporaryPhoto, MealAnalysisError, prepareLabelFrontPhoto, prepareMealPhoto, readNutritionLabel } from '@/services/mealAnalysis';
import { primaryHaptic, successHaptic } from '@/services/haptics';
import { formatNumber } from '@/utils/format';
import { newAnalysisRequestId } from '@/utils/requestId';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { labelFormDefaults } = require('../../supabase/functions/_shared/label-facts.mjs') as {
  labelFormDefaults: (label: unknown, options: { barcode: string | null; language: string }) => LabelForm;
};

type Step = 'table' | 'front' | 'reading' | 'review' | 'error';

/**
 * "Nährwerttabelle fotografieren": photograph the nutrition table (and,
 * optionally, the front for the name), confirm every value, save it as
 * "Mein Produkt" and log it. Reached from an unknown barcode and from search.
 * The read costs one AI analysis under the same access rules as a meal photo;
 * `?manual=1` opens the empty form instead, which costs nothing.
 */
export default function LabelScanScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t, language, locale } = useLanguage();
  const copy = t.labelScan;
  const params = useLocalSearchParams<{ barcode?: string; manual?: string }>();
  const barcode = typeof params.barcode === 'string' && /^\d{7,14}$/.test(params.barcode) ? params.barcode : null;
  const manual = params.manual === '1';
  const { applySearchResult, freeScansLeft } = useApp();
  const { status: subscriptionStatus } = useSubscription();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>(manual ? 'review' : 'table');
  const [origin, setOrigin] = useState<'label' | 'manual'>(manual ? 'manual' : 'label');
  const [tableUri, setTableUri] = useState<string | null>(null);
  const [form, setForm] = useState<LabelForm>({ ...EMPTY_LABEL_FORM, barcode: barcode ?? '' });
  const [formKey, setFormKey] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [focused, setFocused] = useState(true);
  const cameraRef = useRef<CameraView>(null);
  const visit = useRef(0);
  const photos = useRef<string[]>([]);

  const forgetPhotos = useCallback(() => {
    photos.current.forEach(uri => deleteTemporaryPhoto(uri));
    photos.current = [];
  }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); visit.current += 1; forgetPhotos(); };
  }, [forgetPhotos]));
  useEffect(() => () => forgetPhotos(), [forgetPhotos]);

  const subscribed = subscriptionStatus === 'active';
  const subscriptionUncertain = subscriptionStatus === 'loading' || subscriptionStatus === 'error' || subscriptionStatus === 'pending';
  // Same client-side gate as a meal photo; the gateway's ledger decides.
  const hasAccess = subscribed || subscriptionUncertain || freeScansLeft > 0;
  const cameraActive = focused && (step === 'table' || step === 'front') && permission?.granted === true;

  const leave = () => {
    visit.current += 1;
    forgetPhotos();
    if (router.canGoBack()) router.back(); else router.replace('/(tabs)/scan');
  };

  const openManual = () => {
    visit.current += 1;
    forgetPhotos();
    setOrigin('manual');
    setNotices([]);
    setError(null);
    setForm({ ...EMPTY_LABEL_FORM, barcode: barcode ?? '' });
    setFormKey(key => key + 1);
    setStep('review');
  };

  const askCamera = async () => {
    if (permission && !permission.canAskAgain) {
      Alert.alert(t.scan.permissionTitle, t.scan.permissionBody, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.scan.openSettings, onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    await requestPermission();
  };

  const read = async (table: string, front: string | null) => {
    const current = ++visit.current;
    setStep('reading');
    setError(null);
    let preview: string | null = null;
    try {
      const prepared = await prepareMealPhoto(table);
      preview = prepared.previewUri;
      const frontImageBase64 = front ? await prepareLabelFrontPhoto(front).catch(() => null) : null;
      const requestId = newAnalysisRequestId();
      const { label, correctionRequired } = await readNutritionLabel(prepared, requestId, { frontImageBase64, barcode });
      // A complete read spent one analysis on the server; mirror it locally.
      if (!correctionRequired) await countLifetimeScanOnce(requestId).catch(() => undefined);
      if (current !== visit.current) return;
      const next: string[] = [];
      if (label.basis === 'per_serving' && label.serving) next.push(copy.fromServing(formatNumber(label.serving.grams, locale)));
      if (label.energyFromKj) next.push(copy.fromKj);
      if (label.plausibility.issues.includes('energy_units_mismatch')) next.push(copy.warnUnits);
      if (correctionRequired) next.push(copy.missingValues);
      setNotices(next);
      setForm(labelFormDefaults(label, { barcode, language }));
      setFormKey(key => key + 1);
      setOrigin('label');
      setStep('review');
      void successHaptic();
    } catch (caught) {
      if (current !== visit.current) return;
      if (caught instanceof MealAnalysisError && caught.kind === 'subscription-required') {
        router.replace('/paywall?reason=blocked');
        return;
      }
      setError(caught instanceof MealAnalysisError ? caught.message : t.errors.analysisFailed);
      setStep('error');
    } finally {
      deleteTemporaryPhoto(preview);
      forgetPhotos();
    }
  };

  const capture = async () => {
    if (capturing || !cameraRef.current) return;
    if (step === 'table' && !hasAccess) { router.push('/paywall?reason=blocked'); return; }
    const current = visit.current;
    setCapturing(true);
    void primaryHaptic();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) throw new Error('missing camera uri');
      if (current !== visit.current || AppState.currentState !== 'active') { deleteTemporaryPhoto(photo.uri); return; }
      photos.current.push(photo.uri);
      if (step === 'table') { setTableUri(photo.uri); setStep('front'); }
      else if (tableUri) void read(tableUri, photo.uri);
    } catch {
      Alert.alert(t.scan.captureFailedTitle, t.scan.captureFailedBody);
    } finally {
      setCapturing(false);
    }
  };

  const save = async (food: Omit<CustomFoodDraft, 'origin'>, logNow: boolean) => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { food: saved } = await saveCustomFood({ ...food, origin });
      if (logNow) {
        const result = customFoodResult(saved);
        applySearchResult(result, result.defaultGrams);
        router.replace('/confirm');
      } else {
        leave();
      }
    } catch {
      setSaveError(copy.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  if (step === 'review') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityLabel={copy.close} accessibilityRole="button" hitSlop={8} onPress={leave} style={styles.closeLight}>
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
        </View>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.reviewTitle}>{origin === 'manual' ? copy.manualTitle : copy.reviewTitle}</Text>
          <Text style={styles.reviewText}>{origin === 'manual' ? copy.manualText : copy.reviewText}</Text>
          {barcode ? <Text style={styles.reviewText}>{copy.linkedBarcode(barcode)}</Text> : null}
          <LabelFoodForm
            key={formKey}
            initial={form}
            notices={notices}
            onCancel={leave}
            onSave={(food, logNow) => void save(food, logNow)}
            saveError={saveError}
            saving={saving}
            showBarcode={!barcode}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {cameraActive ? (
        <CameraView autofocus="on" facing="back" pointerEvents="none" ref={cameraRef} style={StyleSheet.absoluteFill} />
      ) : null}
      <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel={copy.close} accessibilityRole="button" hitSlop={8} onPress={leave} style={styles.circleButton}>
            <Ionicons color={colors.white} name="close" size={24} />
          </Pressable>
          <View style={styles.titlePill}>
            <Ionicons color={colors.accent} name="nutrition-outline" size={15} />
            <Text numberOfLines={1} style={styles.title}>{copy.title}</Text>
          </View>
          <View style={styles.circlePlaceholder} />
        </View>

        {step === 'reading' ? (
          <View accessibilityLiveRegion="polite" style={styles.center}>
            <ActivityIndicator color={colors.white} />
            <Text style={styles.centerText}>{copy.reading}</Text>
          </View>
        ) : step === 'error' ? (
          <ScrollView contentContainerStyle={styles.center}>
            <Ionicons color={colors.accent} name="document-text-outline" size={44} />
            <Text accessibilityRole="alert" style={styles.centerText}>{error}</Text>
            <View style={styles.actions}>
              <PrimaryButton icon="camera-outline" label={copy.retake} onPress={() => { setTableUri(null); setStep('table'); }} />
              <PrimaryButton icon="create-outline" label={copy.manualEntry} onPress={openManual} variant="secondary" />
            </View>
          </ScrollView>
        ) : !permission?.granted ? (
          <ScrollView contentContainerStyle={styles.center}>
            <Text style={styles.centerTitle}>{copy.title}</Text>
            <Text style={styles.centerText}>{copy.intro}</Text>
            {permission ? (
              <PrimaryButton icon="camera-outline" label={permission.canAskAgain ? t.scan.allowCamera : t.scan.openSettings} onPress={() => void askCamera()} />
            ) : <Text style={styles.centerText}>{t.scan.permissionChecking}</Text>}
            <PrimaryButton icon="create-outline" label={copy.manualEntry} onPress={openManual} variant="secondary" />
          </ScrollView>
        ) : (
          <View pointerEvents="none" style={styles.guide}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>{step === 'table' ? copy.stepTable : copy.stepFront}</Text>
            </View>
            <View style={styles.tipPill}>
              <Text style={styles.tipText}>{step === 'table' ? copy.framingTable : copy.framingFront}</Text>
            </View>
          </View>
        )}

        {cameraActive ? (
          <View style={styles.controls}>
            {step === 'table' ? <Text style={styles.note}>{copy.costNote}</Text> : null}
            <Pressable
              accessibilityLabel={step === 'table' ? copy.shutterTable : copy.shutterFront}
              accessibilityRole="button"
              accessibilityState={{ disabled: capturing }}
              disabled={capturing}
              onPress={() => void capture()}
              style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
            {step === 'front' && tableUri ? (
              <Pressable accessibilityRole="button" onPress={() => void read(tableUri, null)} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>{copy.skipFront}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={openManual} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>{copy.manualEntry}</Text>
              </Pressable>
            )}
            <Text style={styles.note}>{copy.privacyNote}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.camera },
  safe: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  closeLight: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  reviewContent: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  reviewTitle: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
  reviewText: { ...typeScale.footnote, color: colors.muted },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { minHeight: 66, paddingVertical: 8, paddingHorizontal: 18, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circleButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(17,19,15,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  circlePlaceholder: { width: 48, height: 48 },
  titlePill: { flexShrink: 1, minWidth: 0, minHeight: 38, paddingVertical: 8, borderRadius: 19, backgroundColor: 'rgba(17,19,15,0.58)', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { ...typeScale.callout, flexShrink: 1, color: colors.white, fontWeight: '700' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28, paddingVertical: 18 },
  centerTitle: { ...typeScale.title2, color: colors.white, fontWeight: '700', textAlign: 'center' },
  centerText: { ...typeScale.callout, color: 'rgba(255,255,255,0.78)', textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 10 },
  guide: { flex: 1, marginHorizontal: 24, marginVertical: 28, borderRadius: radii.card, borderWidth: 2, borderColor: 'rgba(255,255,255,0.74)', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  stepPill: { borderRadius: radii.pill, backgroundColor: 'rgba(17,19,15,0.62)', paddingHorizontal: 12, paddingVertical: 7 },
  stepText: { ...typeScale.footnote, color: colors.white, fontWeight: '700' },
  tipPill: { borderRadius: radii.pill, backgroundColor: 'rgba(17,19,15,0.62)', paddingHorizontal: 12, paddingVertical: 7, marginHorizontal: 12 },
  tipText: { ...typeScale.caption, color: colors.white, fontWeight: '600', textAlign: 'center' },
  controls: { paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center', gap: 12 },
  note: { ...typeScale.caption, color: 'rgba(255,255,255,0.62)', textAlign: 'center' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.accent },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  textButton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { ...typeScale.footnote, color: colors.white, fontWeight: '700' },
});
