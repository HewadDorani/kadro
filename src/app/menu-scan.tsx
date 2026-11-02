import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, PrimaryButton } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { primaryHaptic, selectionHaptic, successHaptic } from '@/services/haptics';
import { countLifetimeScanOnce } from '@/services/localRepository';
import { deleteTemporaryPhoto, MealAnalysisError, prepareMealPhoto, readMenu } from '@/services/mealAnalysis';
import { menuDishFood, type MenuDish, type MenuPick, menuPicks } from '@/services/menuPicks';
import { formatNumber } from '@/utils/format';
import { newAnalysisRequestId } from '@/utils/requestId';

type Step = 'camera' | 'reading' | 'picks' | 'error';

/**
 * "Speisekarte fotografieren": for the restaurants no chain data covers. One
 * photo, and the three dishes that suit what is left of the day. The values are
 * estimates and say so; picking one opens the normal confirm screen. The photo
 * is deleted right after the read.
 */
export default function MenuScanScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { locale, t } = useLanguage();
  const copy = t.plan.menu;
  const { freeScansLeft, profile, remaining, startPlannedDraft } = useApp();
  const { status } = useSubscription();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>('camera');
  const [dishes, setDishes] = useState<MenuDish[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [focused, setFocused] = useState(true);
  const cameraRef = useRef<CameraView>(null);
  const visit = useRef(0);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); visit.current += 1; };
  }, []));

  const subscribed = status === 'active';
  const uncertain = status === 'loading' || status === 'error' || status === 'pending';
  const picks = useMemo(() => menuPicks(dishes, remaining, profile.preferences), [dishes, profile.preferences, remaining]);
  const leave = () => { visit.current += 1; if (router.canGoBack()) router.back(); else router.replace('/(tabs)/plan'); };

  const read = async (uri: string) => {
    const current = ++visit.current;
    setStep('reading');
    setError(null);
    let preview: string | null = null;
    try {
      const prepared = await prepareMealPhoto(uri);
      preview = prepared.previewUri;
      const requestId = newAnalysisRequestId();
      const found = await readMenu(prepared, requestId);
      await countLifetimeScanOnce(requestId).catch(() => undefined);
      if (current !== visit.current) return;
      setDishes(found);
      setStep('picks');
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
      if (preview !== uri) deleteTemporaryPhoto(uri);
    }
  };

  const capture = async () => {
    if (capturing || !cameraRef.current) return;
    if (!subscribed && !uncertain && freeScansLeft <= 0) { router.push('/paywall?reason=blocked'); return; }
    const current = visit.current;
    setCapturing(true);
    void primaryHaptic();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) throw new Error('missing camera uri');
      if (current !== visit.current || AppState.currentState !== 'active') { deleteTemporaryPhoto(photo.uri); return; }
      void read(photo.uri);
    } catch {
      setError(t.scan.captureFailedBody);
      setStep('error');
    } finally {
      setCapturing(false);
    }
  };

  const take = (pick: MenuPick) => {
    void selectionHaptic();
    startPlannedDraft([{ result: menuDishFood(pick, copy.serving), grams: pick.grams }], pick.name);
    router.push('/confirm');
  };

  if (step === 'camera' || step === 'reading') {
    return (
      <View style={styles.dark}>
        {step === 'camera' && focused && permission?.granted ? <CameraView autofocus="on" facing="back" pointerEvents="none" ref={cameraRef} style={StyleSheet.absoluteFill} /> : null}
        <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.overlay}>
          <Pressable accessibilityLabel={t.common.close} accessibilityRole="button" hitSlop={8} onPress={leave} style={styles.close}>
            <Ionicons color={colors.white} name="close" size={24} />
          </Pressable>
          {step === 'reading' ? (
            <View accessibilityLiveRegion="polite" style={styles.center}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.darkText}>{copy.reading}</Text>
            </View>
          ) : permission?.granted ? (
            <View style={styles.bottom}>
              <Text style={styles.darkText}>{copy.hint}</Text>
              <Pressable accessibilityLabel={copy.shutter} accessibilityRole="button" accessibilityState={{ disabled: capturing }} disabled={capturing} onPress={() => void capture()} style={styles.shutterOuter}>
                <View style={styles.shutterInner} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.darkText}>{t.scan.permissionBody}</Text>
              <PrimaryButton icon="camera-outline" label={t.scan.allowCamera} onPress={() => void requestPermission()} />
            </View>
          )}
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.close} accessibilityRole="button" hitSlop={8} onPress={leave} style={styles.iconButton}>
          <Ionicons color={colors.text} name="close" size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {step === 'error' ? (
          <Card style={styles.card}>
            <Text accessibilityRole="alert" style={styles.title}>{copy.errorTitle}</Text>
            <Text style={styles.meta}>{error}</Text>
          </Card>
        ) : (
          <>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>{copy.title(formatNumber(Math.max(0, remaining.calories), locale))}</Text>
              <Text style={styles.meta}>{copy.found(dishes.length)}</Text>
            </View>
            {picks.length ? picks.map((pick) => (
              <Card key={pick.name} style={styles.card}>
                <Text style={styles.dish}>{pick.name}</Text>
                <Text style={styles.values}>~{formatNumber(pick.calories, locale)} kcal · {pick.protein} g {t.common.protein}</Text>
                <Text style={styles.meta}>{pick.fits ? copy.leaves(formatNumber(pick.left, locale)) : copy.over(formatNumber(-pick.left, locale))}</Text>
                <PrimaryButton icon="checkmark" label={copy.take} onPress={() => take(pick)} variant={pick.fits ? 'primary' : 'secondary'} />
              </Card>
            )) : <Text style={styles.meta}>{copy.noDiet}</Text>}
            <Text style={styles.foot}>{copy.estimate}</Text>
          </>
        )}
        <PrimaryButton icon="camera-outline" label={copy.again} onPress={() => { setStep('camera'); setDishes([]); }} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  dark: { flex: 1, backgroundColor: colors.camera },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 20 },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(17,19,15,0.48)', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  bottom: { alignItems: 'center', gap: 16 },
  darkText: { ...typeScale.subhead, color: colors.white, fontWeight: '600', textAlign: 'center' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.accent },
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 14 },
  heading: { gap: 6 },
  title: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  meta: { ...typeScale.subhead, color: colors.muted },
  card: { gap: 8, borderRadius: radii.card },
  dish: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  values: { ...typeScale.callout, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  foot: { ...typeScale.footnote, color: colors.muted, textAlign: 'center' },
});
