import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { mealPhotoPlaceholder } from '@/utils/format';
import { MealPhoto, PrimaryButton } from '@/components/ui';
import { useFreeScanAllowance } from '@/hooks/useHardWall';
import { useApp } from '@/context/AppContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useLanguage } from '@/i18n/LanguageProvider';
import { AnalysisErrorKind } from '@/services/contracts';
import { setScanInputDraft } from '@/services/captureIntents';
import { getUnknownBarcode } from '@/services/mealAnalysis';
import { typeScale } from '@/constants/theme';

/**
 * Most analyses answer within a few seconds. After this the screen says so
 * honestly: it is taking longer, and the server retries once by itself.
 */
const LONGER_AFTER_MS = 8_000;
/** Most analyses answer well within this; after it the user gets a way out. */
const SLOW_AFTER_MS = 15_000;

export default function AnalyzingScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const {
    analysisError,
    analysisMessage,
    analysisPhase,
    analysisStatus,
    analyzeCurrentPhoto,
    cancelAnalysis,
    photoUri,
    resetScan,
    scanMode,
    descriptionInput,
    startDemoScan,
  } = useApp();
  const [slow, setSlow] = useState(false);
  const [longer, setLonger] = useState(false);
  const started = useRef(false);
  const reduceMotion = useReducedMotion();
  const { t } = useLanguage();
  const { allowance, hardWall } = useFreeScanAllowance();
  // The gateway answers once, at the end. Rather than tick off steps it never
  // reported, say what is actually happening: preparing the photo on the
  // device, then waiting for the analysis.
  const statusLine = analysisPhase === 'preparing'
    ? t.analyzing.phasePreparing
    : scanMode === 'demo'
      ? t.analyzing.phaseDemo
      : scanMode === 'description'
        ? t.analyzing.phaseDescription
        : scanMode === 'barcode'
          ? t.analyzing.phaseBarcode
          : t.analyzing.phasePhoto;
  const errorCopy: Record<AnalysisErrorKind, { title: string; detail: string }> = {
    'not-configured': { title: t.analyzing.errNotConfiguredTitle, detail: t.analyzing.errNotConfiguredBody },
    'consent-required': { title: t.analyzing.errConsentTitle, detail: t.analyzing.errConsentBody },
    'subscription-required': hardWall
      ? { title: t.paywall.trialUsedHeadline, detail: t.paywall.trialUsedSub }
      : { title: t.paywall.blockedHeadline(allowance), detail: t.paywall.blockedSub },
    'daily-limit': { title: t.analyzing.errProviderTitle, detail: t.errors.gatewayDailyLimit },
    'invalid-input': { title: t.analyzing.errInputTitle, detail: t.analyzing.errInputBody },
    'request-expired': { title: t.analyzing.errExpiredTitle, detail: t.analyzing.errExpiredBody },
    offline: { title: t.analyzing.errOfflineTitle, detail: t.analyzing.errOfflineBody },
    'unclear-image': scanMode === 'description'
      ? { title: t.analyzing.errDescriptionTitle, detail: t.analyzing.errDescriptionBody }
      : { title: t.analyzing.errUnclearTitle, detail: t.analyzing.errUnclearBody },
    'multiple-dishes': { title: t.analyzing.errMultipleTitle, detail: t.analyzing.errMultipleBody },
    'product-not-found': { title: t.analyzing.errProductTitle, detail: t.analyzing.errProductBody },
    'timeout': {title:t.analyzing.errProviderTitle,detail:t.errors.gatewayTimeout},
    'rate-limited': {title:t.analyzing.errProviderTitle,detail:t.errors.gatewayRateLimited},
    'session-required': {title:t.analyzing.errProviderTitle,detail:t.errors.sessionUnavailable},
    'invalid-response': {title:t.analyzing.errProviderTitle,detail:t.errors.gatewayInvalidResponse},
    'model-refused': {title:t.analyzing.errInputTitle,detail:t.errors.gatewayRefused},
    'provider-error': { title: t.analyzing.errProviderTitle, detail: t.analyzing.errProviderBody },
  };
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // A fixed 330pt photo pushed the retry buttons off small screens. Scale it to
  // the viewport and let the whole screen scroll as a fallback.
  const photoHeight = Math.round(Math.min(330, Math.max(180, windowHeight * 0.34)));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void analyzeCurrentPhoto();
  }, [analyzeCurrentPhoto]);

  // The 90 s request deadline stays; after 15 s the user may stop waiting.
  useEffect(() => {
    setSlow(false);
    setLonger(false);
    if (analysisStatus !== 'analyzing') return;
    const longerTimer = setTimeout(() => setLonger(true), LONGER_AFTER_MS);
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => { clearTimeout(longerTimer); clearTimeout(timer); };
  }, [analysisStatus]);

  useEffect(() => {
    if (analysisStatus !== 'ready') return;
    // Confidence describes the model, not certainty about a real portion.
    // Every estimate is reviewed before result.tsx stores it.
    const timer = setTimeout(() => router.replace('/confirm'), reduceMotion ? 0 : 260);
    return () => clearTimeout(timer);
  }, [analysisStatus, reduceMotion, router]);

  const runDemo = () => {
    startDemoScan();
    started.current = true;
    void analyzeCurrentPhoto(true);
  };

  // Network loss or a timeout may have finished on the server: the same id then
  // replays the stored result at no extra cost. Any other failure retries fresh.
  const retry = () => {
    started.current = true;
    void analyzeCurrentPhoto(false, analysisError !== 'offline' && analysisError !== 'timeout');
  };

  const openLabelScan = () => {
    const barcode = getUnknownBarcode();
    resetScan();
    router.replace(barcode ? { pathname: '/label-scan', params: { barcode } } : '/label-scan');
  };

  const changeInput = (path: '/(tabs)/scan' | '/(tabs)/scan?mode=description' = '/(tabs)/scan') => {
    if (scanMode === 'description') {
      router.dismissTo('/(tabs)/scan?mode=description');
    } else {
      resetScan();
      router.dismissTo(path);
    }
  };

  /**
   * Stops waiting and opens the text input instead. A photo is dropped and the
   * text field starts empty; a description goes back with its own text.
   */
  const cancelAndDescribe = () => {
    if (scanMode === 'description') {
      cancelAnalysis();
      router.dismissTo('/(tabs)/scan?mode=description');
      return;
    }
    resetScan();
    setScanInputDraft(null);
    router.dismissTo('/(tabs)/scan?mode=description');
  };

  const error = analysisError ? errorCopy[analysisError] : null;
  const failed = analysisStatus === 'error' || analysisStatus === 'queued';
  // A photo stays on screen after any failure, so trying it again is one tap.
  const photoCapture = scanMode === 'live' || scanMode === 'queued';
  const describeInstead = () => { setScanInputDraft(null); changeInput('/(tabs)/scan?mode=description'); };
  // Only the analysing phase can take long; preparing the photo is local.
  // The copy promises the server's automatic retry, which only AI analyses have.
  const waitingLonger = longer && analysisPhase !== 'preparing' && (photoCapture || scanMode === 'description');
  const failureDetail = analysisError === 'offline'
    ? (analysisStatus === 'queued' ? error?.detail : t.analyzing.errOfflineNotQueuedBody)
    : scanMode === 'description' && analysisError === 'unclear-image'
      ? t.analyzing.errDescriptionBody
      : analysisMessage ?? error?.detail;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.analyzing.close} accessibilityRole="button" hitSlop={8} onPress={() => changeInput()} style={styles.closeButton}>
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
        <Text style={styles.topTitle}>{t.analyzing.title}</Text>
        <View style={styles.closeButtonSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.photoWrap}>
          <MealPhoto height={photoHeight} description={scanMode === 'description' ? descriptionInput : undefined} placeholder={mealPhotoPlaceholder(scanMode)} uri={photoUri} />
          {!failed && scanMode !== 'description' ? <View style={styles.scanLine} /> : null}
          {!failed ? <View style={styles.analyzingPill}>
            <View style={styles.liveDot} />
            <Text style={styles.analyzingPillText}>{t.analyzing.badgeAnalysing}</Text>
          </View> : null}
        </View>

        <View style={styles.content}>
          <View style={[styles.sparkleCircle, failed && styles.warningCircle]}>
            <Ionicons color={colors.onAccent} name={failed ? 'alert-outline' : 'sparkles'} size={25} />
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.title}>{failed ? error?.title : slow ? t.analyzing.slowTitle : waitingLonger ? t.analyzing.longerTitle : statusLine}</Text>
          <Text style={styles.subtitle}>
            {failed ? failureDetail : slow ? t.analyzing.slowText : waitingLonger ? t.analyzing.longerText : t.analyzing.phaseHint}
          </Text>

          {failed ? (
            <View style={styles.actions}>
              {analysisError === 'subscription-required' ? (
                <>
                  <PrimaryButton icon="sparkles" label={t.paywall.ctaStart} onPress={() => router.replace('/paywall?reason=blocked')} />
                  <PrimaryButton label={t.analyzing.changeInput} onPress={() => changeInput()} variant="ghost" />
                </>
              ) : analysisError === 'consent-required' ? (
                <>
                  <PrimaryButton icon="shield-checkmark-outline" label={t.analyzing.openConsent} onPress={() => router.replace('/data-consent' as never)} />
                  <PrimaryButton label={t.analyzing.changeInput} onPress={() => changeInput()} variant="ghost" />
                </>
              ) : analysisError === 'request-expired' ? (
                <>
                  <PrimaryButton icon="refresh" label={t.analyzing.retry} onPress={retry} />
                  <PrimaryButton label={t.analyzing.changeInput} onPress={() => changeInput()} variant="ghost" />
                </>
              ) : analysisError === 'unclear-image' && scanMode !== 'description' ? (
                <>
                  {/* Unclear is still an error, but never a dead end: one tap to
                      try again with the camera or to say it in words. */}
                  <PrimaryButton icon="camera-outline" label={t.analyzing.retakePhoto} onPress={() => changeInput()} />
                  <PrimaryButton icon="create-outline" label={t.analyzing.describeInstead} onPress={describeInstead} variant="secondary" />
                </>
              ) : analysisError === 'invalid-input' && photoCapture ? (
                <>
                  {/* The photo is kept: retry it as is, or say it in words. */}
                  <PrimaryButton icon="refresh" label={t.analyzing.retryPhoto} onPress={retry} />
                  <PrimaryButton icon="create-outline" label={t.analyzing.describeInstead} onPress={describeInstead} variant="secondary" />
                  <PrimaryButton label={t.analyzing.retakePhoto} onPress={() => changeInput()} variant="ghost" />
                </>
              ) : analysisError === 'product-not-found' || analysisError === 'invalid-input' ? (
                <>
                  {/* "Produkt nicht gefunden": the label on the pack is the
                      source; photographed once, the barcode knows it next time. */}
                  {analysisError === 'product-not-found' && scanMode === 'barcode' ? <PrimaryButton
                    icon="nutrition-outline"
                    label={t.analyzing.labelScanInstead}
                    onPress={openLabelScan}
                  /> : null}
                  {analysisError === 'product-not-found' ? <PrimaryButton
                    icon="create-outline"
                    label={t.analyzing.describeInstead}
                    onPress={() => changeInput('/(tabs)/scan?mode=description')}
                    variant={scanMode === 'barcode' ? 'secondary' : 'primary'}
                  /> : null}
                  <PrimaryButton label={t.analyzing.changeInput} onPress={() => changeInput()} variant="ghost" />
                </>
              ) : (
                photoCapture && analysisError !== 'not-configured' ? (
                  <>
                    {/* Any other photo failure keeps the photo: one tap retries it. */}
                    <PrimaryButton icon="refresh" label={t.analyzing.retryPhoto} onPress={retry} />
                    <PrimaryButton icon="create-outline" label={t.analyzing.describeInstead} onPress={describeInstead} variant="secondary" />
                    <PrimaryButton label={t.analyzing.retakePhoto} onPress={() => changeInput()} variant="ghost" />
                  </>
                ) : (
                  <>
                    {analysisError !== 'not-configured' ? <PrimaryButton icon="refresh" label={t.analyzing.retry} onPress={retry} /> : null}
                    <PrimaryButton label={t.analyzing.openDemo} onPress={runDemo} variant={analysisError === 'not-configured' ? 'primary' : 'secondary'} />
                    <PrimaryButton label={t.analyzing.changeInput} onPress={() => changeInput()} variant="ghost" />
                  </>
                )
              )}
            </View>
          ) : slow && scanMode !== 'demo' ? (
            <View style={styles.actions}>
              <PrimaryButton icon="create-outline" label={t.analyzing.cancelDescribe} onPress={cancelAndDescribe} variant="secondary" />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  closeButtonSpacer: { width: 40, height: 40 },
  topTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  photoWrap: { marginHorizontal: 20 },
  scanLine: { position: 'absolute', left: 16, right: 16, top: '48%', height: 2, backgroundColor: colors.accent },
  analyzingPill: { position: 'absolute', top: 14, left: 14, minHeight: 30, paddingVertical: 6, borderRadius: 15, backgroundColor: 'rgba(23,24,22,0.75)', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  warningDot: { backgroundColor: colors.attention },
  analyzingPillText: { ...typeScale.caption, color: colors.white, fontWeight: '800', letterSpacing: 1 },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 30, paddingTop: 28 },
  sparkleCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  warningCircle: { backgroundColor: colors.attentionSoft },
  title: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 14, textAlign: 'center' },
  subtitle: { ...typeScale.footnote, color: colors.muted, textAlign: 'center', marginTop: 7, maxWidth: 340 },
  actions: { alignSelf: 'stretch', gap: 8, marginTop: 22 },
});
