import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, IconCircle, PrimaryButton, SkeletonBlock } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalDay } from '@/hooks/useLocalDay';
import { weeklyReview } from '@/services/weeklyReview';
import { formatDateParts } from '@/utils/format';
import { typeScale } from '@/constants/theme';

/** First day of the review week that was given for free on this device. */
const FREE_REVIEW_KEY = '@kandro/free-weekly-review:v1';

/**
 * Who sees the full review: Pro, or anyone 18+ for their first review with
 * real entries. That week stays open for the whole week; from the next one a
 * calm teaser points to Pro. An empty week never uses up the free review.
 */
export function freeReviewAccess(stored: string | null, weekStart: string, loggedDays: number): { full: boolean; claim: boolean } {
  if (stored === weekStart) return { full: true, claim: false };
  if (stored === null) return { full: true, claim: loggedDays > 0 };
  return { full: false, claim: false };
}

export function WeeklyReviewCard() {
  const { colors } = useTheme();
  const { t, locale } = useLanguage();
  const { mealHistory, profile, targets, hydrationReady } = useApp();
  const { status } = useSubscription();
  const router = useRouter();
  const today = useLocalDay();
  // undefined: not read yet; null: no free review used on this device.
  const [freeWeek, setFreeWeek] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(FREE_REVIEW_KEY).then(value => { if (active) setFreeWeek(value); }).catch(() => { if (active) setFreeWeek(null); });
    return () => { active = false; };
  }, []);
  const eligible = hydrationReady && !!profile.completedAt && profile.age >= 18;
  const review = eligible ? weeklyReview(mealHistory, targets.calories, today) : null;
  const pro = status === 'active';
  const access = review && freeWeek !== undefined ? freeReviewAccess(freeWeek, review.current.from, review.current.loggedDays) : null;
  useEffect(() => {
    if (pro || !access?.claim || !review) return;
    const week = review.current.from;
    setFreeWeek(week);
    void AsyncStorage.setItem(FREE_REVIEW_KEY, week).catch(() => undefined);
  }, [pro, access?.claim, review?.current.from]);
  // Reading the free-review marker takes a moment; hold the card's place
  // instead of letting it pop in under the reader's thumb.
  if (eligible && review && !pro && freeWeek === undefined) {
    return <Card style={{ gap: 12 }}>
      <SkeletonBlock height={22} width="55%" />
      <SkeletonBlock height={14} width="35%" />
      <SkeletonBlock height={14} />
      <SkeletonBlock height={14} width="80%" />
    </Card>;
  }
  if (!eligible || !review || (!pro && !access)) return null;
  const copy = t.weeklyReview;
  const { current, previous, proteinChangePercent } = review;
  const number = (value: number) => value.toLocaleString(locale);
  const text = { ...typeScale.callout, color: colors.muted };
  return <Card style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <IconCircle name="calendar-clear-outline" size={40} tone="neutral" />
      <Text accessibilityRole="header" style={{ ...typeScale.title2, flex: 1, color: colors.text, fontWeight: '700' }}>{copy.title}</Text>
    </View>
    {pro || access?.full ? <>
      <Text style={text}>{formatDateParts(current.from, { day: 'numeric', month: 'short' }, locale)} – {formatDateParts(current.to, { day: 'numeric', month: 'short' }, locale)}</Text>
      <Text style={{ color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '600' }}>{copy.loggedDays(current.loggedDays)}</Text>
      {current.loggedDays ? <View style={{ gap: 8 }}>
        <Text style={text}>{copy.averages(number(current.averageCalories!), number(current.averageProtein!))}</Text>
        {current.daysNearCurrentTarget !== null ? <Text style={text}>{copy.nearTarget(current.daysNearCurrentTarget, current.loggedDays, number(targets.calories))}</Text> : null}
        <Text style={text}>{proteinChangePercent !== null
          ? copy.proteinComparison(`${proteinChangePercent > 0 ? '+' : ''}${number(proteinChangePercent)}%`, current.loggedDays, previous.loggedDays)
          : copy.comparisonPending}</Text>
        <Text style={text}>{copy.dataNote}</Text>
      </View> : <Text style={text}>{copy.empty}</Text>}
      {!pro && current.loggedDays ? <Text style={{ ...text, ...typeScale.footnote }}>{copy.freeNote}</Text> : null}
    </> : <>
      <Text style={{ ...typeScale.headline, color: colors.text, fontWeight: '600' }}>{copy.teaser}</Text>
      <Text style={text}>{copy.proDescription}</Text>
      <PrimaryButton label={copy.openPro} variant="secondary" onPress={() => router.push('/paywall')} />
    </>}
  </Card>;
}
