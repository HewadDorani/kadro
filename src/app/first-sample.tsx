import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { type PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { Card, Eyebrow, PrimaryButton, ProgressBar, Screen } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { HERO_MAX_FONT_SCALE, radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getDictionary } from '@/i18n/active';
import { useLanguage } from '@/i18n/LanguageProvider';
import { setFirstRunStage } from '@/services/firstRun';
import { markHardWallUsed } from '@/services/hardWall';
import { selectionHaptic, successHaptic } from '@/services/haptics';
import { getDemoItems, nutritionFromItems } from '@/services/mockNutrition';
import { recommendMeals } from '@/services/recommendations';
import { markUsage } from '@/services/usageSignals';
import { formatNumber } from '@/utils/format';

type Phase = 'start' | 'scan' | 'day' | 'ideas';
const ITEM_MS = 480;
const COUNT_MS = 1000;

/** New content arrives instead of jumping in. */
function Reveal({ children, still }: PropsWithChildren<{ still: boolean }>) {
  const progress = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.timing(progress, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progress, still]);
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/**
 * Most new people skipped the first scan and met the paywall without ever
 * seeing a result (27 of 40 between 14.10. and 01.11.2026). This is the promise
 * as one tap: a labelled example meal is recognised, the person's own day counts
 * down, and what fits next appears. Nothing is sent, saved or counted as a free
 * scan. Leaving it ends the free scope, like the old "Später" did.
 */
export default function FirstSampleScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { language, locale, t } = useLanguage();
  const { profile, targets } = useApp();
  const reduceMotion = useReducedMotion();
  const copy = t.onboarding.firstScan;
  const leaving = useRef(false);
  const items = useMemo(() => getDemoItems(), [language]);
  const meal = useMemo(() => nutritionFromItems(items), [items]);
  const left = useMemo(() => ({
    calories: Math.max(0, targets.calories - meal.calories),
    protein: Math.max(0, targets.protein - meal.protein),
    carbs: Math.max(0, targets.carbs - meal.carbs),
    fat: Math.max(0, targets.fat - meal.fat),
    fiber: Math.max(0, (targets.fiber ?? 0) - (meal.fiber ?? 0)),
  }), [meal, targets]);
  const ideas = useMemo(() => recommendMeals('home', left, profile.preferences), [language, left, profile.preferences]);

  const [phase, setPhase] = useState<Phase>('start');
  const [found, setFound] = useState(0);
  const [shownCalories, setShownCalories] = useState(targets.calories);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const counter = useRef(new Animated.Value(targets.calories)).current;
  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    counter.stopAnimation();
  }, [counter]);
  const after = (ms: number, run: () => void) => { timers.current.push(setTimeout(run, ms)); };

  const play = () => {
    void selectionHaptic();
    if (reduceMotion) {
      setFound(items.length);
      setShownCalories(left.calories);
      setPhase('ideas');
      return;
    }
    setPhase('scan');
    items.forEach((_, index) => after(ITEM_MS * (index + 1), () => {
      setFound(index + 1);
    }));
    const countStart = ITEM_MS * (items.length + 1) + 300;
    after(countStart, () => {
      setPhase('day');
      const listener = counter.addListener(({ value }) => setShownCalories(Math.round(value)));
      Animated.timing(counter, { toValue: left.calories, duration: COUNT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false })
        .start(() => counter.removeListener(listener));
    });
    after(countStart + COUNT_MS + 350, () => {
      setPhase('ideas');
      void successHaptic();
    });
  };

  const proceed = async () => {
    if (leaving.current) return;
    leaving.current = true;
    void selectionHaptic();
    await markHardWallUsed();
    await setFirstRunStage('paywall');
    markUsage('demo');
    router.replace('/paywall');
  };

  const mealTitle = getDictionary().errors.demoMealTitle;
  const eaten = targets.calories > 0 ? 1 - shownCalories / targets.calories : 0;

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>{copy.sampleEyebrow}</Eyebrow>
        <Text accessibilityRole="header" style={styles.title}>{copy.sampleTitle}</Text>
      </View>

      {phase === 'start' ? (
        <>
          <Card style={styles.startCard}>
            <View style={styles.startIcon}><Ionicons color={colors.onAccent} name="restaurant" size={34} /></View>
            <Text style={styles.startLabel}>{copy.sampleMeal}</Text>
            <Text style={styles.startTitle}>{mealTitle}</Text>
          </Card>
          <PrimaryButton icon="scan-outline" label={copy.sampleScan} onPress={play} />
          <PrimaryButton label={copy.sampleOwn} onPress={() => router.back()} variant="ghost" />
        </>
      ) : (
        <>
          {phase === 'scan' ? (
            <Card style={styles.scanCard}>
              <Text style={styles.scanLabel}>{copy.sampleFound}</Text>
              {items.slice(0, found).map((item) => (
                <Reveal key={item.id} still={reduceMotion}>
                  <View style={styles.foundRow}>
                    <Ionicons color={colors.accentText} name="checkmark-circle" size={20} />
                    <Text numberOfLines={1} style={styles.foundName}>{item.name}</Text>
                    <Text style={styles.foundValue}>~{formatNumber(item.calories, locale)} kcal</Text>
                  </View>
                </Reveal>
              ))}
            </Card>
          ) : (
            <View style={styles.mealLine}>
              <Ionicons color={colors.accentText} name="checkmark-circle" size={20} />
              <Text numberOfLines={1} style={styles.foundName}>{mealTitle}</Text>
              <Text style={styles.foundValue}>−{formatNumber(meal.calories, locale)} kcal</Text>
            </View>
          )}

          {phase === 'day' || phase === 'ideas' ? (
            <Reveal still={reduceMotion}>
              <Card style={styles.dayCard}>
                <Text style={styles.dayLabel}>{copy.sampleLeft}</Text>
                <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.dayValue}>{formatNumber(shownCalories, locale)} kcal</Text>
                <ProgressBar value={eaten} />
              </Card>
            </Reveal>
          ) : null}

          {phase === 'ideas' ? (
            <Reveal still={reduceMotion}>
              <View style={styles.ideas}>
                <Text accessibilityRole="header" style={styles.next}>{copy.sampleNext}</Text>
                {ideas.map((idea) => (
                  <View key={idea.id} style={styles.idea}>
                    <Text numberOfLines={1} style={styles.ideaTitle}>{idea.title}</Text>
                    <Text style={styles.foundValue}>~{formatNumber(idea.calories, locale)} kcal</Text>
                  </View>
                ))}
                <Text style={styles.foot}>{copy.sampleFoot}</Text>
                <PrimaryButton icon="arrow-forward" label={copy.sampleContinue} onPress={() => void proceed()} />
                <PrimaryButton label={copy.sampleOwn} onPress={() => router.back()} variant="ghost" />
              </View>
            </Reveal>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  heading: { gap: 8, paddingTop: 12 },
  title: { ...typeScale.title1, color: colors.text, fontWeight: '700' },
  startCard: { alignItems: 'center', gap: 8, paddingVertical: 36 },
  startIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  startLabel: { ...typeScale.subhead, color: colors.muted, textAlign: 'center' },
  startTitle: { ...typeScale.title2, color: colors.text, fontWeight: '700', textAlign: 'center' },
  scanCard: { gap: 12 },
  scanLabel: { ...typeScale.headline, color: colors.text },
  foundRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  foundName: { ...typeScale.callout, flex: 1, minWidth: 0, color: colors.text, fontWeight: '600' },
  foundValue: { ...typeScale.footnote, color: colors.muted, fontVariant: ['tabular-nums'] },
  mealLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  dayCard: { gap: 10, backgroundColor: colors.accentSoft, borderColor: colors.accent },
  dayLabel: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  dayValue: { color: colors.text, fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  ideas: { gap: 10 },
  next: { ...typeScale.headline, color: colors.text, marginTop: 4 },
  idea: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  ideaTitle: { ...typeScale.label, flex: 1, minWidth: 0, color: colors.text },
  foot: { ...typeScale.footnote, color: colors.muted, textAlign: 'center' },
});
