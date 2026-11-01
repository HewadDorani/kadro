import { useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Eyebrow, PrimaryButton, Screen } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { setFirstRunStage } from '@/services/firstRun';
import { markHardWallUsed } from '@/services/hardWall';
import { selectionHaptic } from '@/services/haptics';
import { getDemoItems, nutritionFromItems } from '@/services/mockNutrition';
import { recommendMeals } from '@/services/recommendations';
import { markUsage } from '@/services/usageSignals';
import { getDictionary } from '@/i18n/active';
import { formatNumber } from '@/utils/format';

/**
 * Most new people skipped the first scan and met the paywall without ever
 * seeing a result (27 of 40 between 14.10. and 01.11.2026). This one tap shows
 * the actual promise with their own targets, on the labelled demo meal: nothing
 * is analysed, saved or counted as a free scan. Leaving it ends the free scope
 * like the old "Später" did.
 */
export default function FirstSampleScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { language, locale, t } = useLanguage();
  const { profile, targets } = useApp();
  const copy = t.onboarding.firstScan;
  const leaving = useRef(false);
  const meal = useMemo(() => nutritionFromItems(getDemoItems()), [language]);
  const left = useMemo(() => ({
    calories: Math.max(0, targets.calories - meal.calories),
    protein: Math.max(0, targets.protein - meal.protein),
    carbs: Math.max(0, targets.carbs - meal.carbs),
    fat: Math.max(0, targets.fat - meal.fat),
    fiber: Math.max(0, (targets.fiber ?? 0) - (meal.fiber ?? 0)),
  }), [meal, targets]);
  const ideas = useMemo(() => recommendMeals('home', left, profile.preferences), [language, left, profile.preferences]);

  const proceed = async () => {
    if (leaving.current) return;
    leaving.current = true;
    void selectionHaptic();
    markUsage('demo');
    await markHardWallUsed();
    await setFirstRunStage('paywall');
    router.replace('/paywall');
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>{copy.sampleEyebrow}</Eyebrow>
        <Text accessibilityRole="header" style={styles.title}>{copy.sampleTitle}</Text>
        <Text style={styles.subtitle}>{copy.sampleSubtitle}</Text>
      </View>
      <Card style={styles.card}>
        <Text style={styles.label}>{copy.sampleMeal}</Text>
        <Text style={styles.mealTitle}>{getDictionary().errors.demoMealTitle}</Text>
        <Text style={styles.mealValues}>~{formatNumber(meal.calories, locale)} kcal · ~{meal.protein} g {t.common.protein}</Text>
      </Card>
      <Card style={styles.leftCard}>
        <Text style={styles.leftLabel}>{copy.sampleLeft}</Text>
        <Text style={styles.leftValue}>{copy.sampleLeftValue(formatNumber(left.calories, locale), left.protein)}</Text>
      </Card>
      <Text accessibilityRole="header" style={styles.next}>{copy.sampleNext}</Text>
      <View style={styles.ideas}>
        {ideas.map((idea) => (
          <View key={idea.id} style={styles.idea}>
            <Text numberOfLines={2} style={styles.ideaTitle}>{idea.title}</Text>
            <Text style={styles.ideaValues}>~{formatNumber(idea.calories, locale)} kcal · ~{idea.protein} g {t.common.protein}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton icon="arrow-forward" label={copy.sampleContinue} onPress={() => void proceed()} />
      <PrimaryButton label={copy.sampleOwn} onPress={() => router.back()} variant="ghost" />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  heading: { gap: 8, paddingTop: 12 },
  title: { ...typeScale.title1, color: colors.text, fontWeight: '700' },
  subtitle: { ...typeScale.body, color: colors.muted },
  card: { gap: 4 },
  label: { ...typeScale.caption, color: colors.muted, fontWeight: '700' },
  mealTitle: { ...typeScale.headline, color: colors.text },
  mealValues: { ...typeScale.subhead, color: colors.muted, fontVariant: ['tabular-nums'] },
  leftCard: { gap: 4, backgroundColor: colors.accentSoft, borderColor: colors.accent },
  leftLabel: { ...typeScale.caption, color: colors.text, fontWeight: '700' },
  leftValue: { ...typeScale.title2, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  next: { ...typeScale.headline, color: colors.text, marginTop: 6 },
  ideas: { gap: 10 },
  idea: { gap: 3, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  ideaTitle: { ...typeScale.label, color: colors.text },
  ideaValues: { ...typeScale.footnote, color: colors.muted, fontVariant: ['tabular-nums'] },
});
