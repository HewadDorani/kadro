import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Card, Eyebrow, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import {
  enableEveningCheckIn,
  isEveningReminderEnabled,
  remindersSupported,
} from '@/services/reminders';
import { useLanguage } from '@/i18n/LanguageProvider';
import { formatDateParts, formatNumber, mealTypeLabel } from '@/utils/format';

export default function EveningScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { consumed, meals, targets, userName } = useApp();
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const { locale, t } = useLanguage();

  useEffect(() => {
    let active = true;
    void isEveningReminderEnabled().then((enabled) => {
      if (active) setReminderEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const dateLabel = formatDateParts(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }, locale);
  const over = Math.max(0, consumed.calories - targets.calories);
  const under = Math.max(0, targets.calories - consumed.calories);
  const logged = meals.length > 0;
  const proteinShare = targets.protein > 0 ? Math.round((consumed.protein / targets.protein) * 100) : 0;

  // The verdict never scolds. A day over budget is information, not a failure,
  // and tomorrow is always framed as already available.
  const verdict = !logged
    ? t.evening.verdictNothing
    : over > 0
      ? t.evening.verdictOver(formatNumber(over, locale))
      : under < 200
        ? t.evening.verdictClose
        : t.evening.verdictUnder(formatNumber(under, locale));

  const headline = !logged
    ? t.evening.headlineNothing
    : over > 0
      ? t.evening.headlineOver
      : t.evening.headlineOk;

  const shareDay = async () => {
    const name = userName.trim() ? `${userName}: ` : '';
    await Share.share({
      message: logged
        ? `${name}${formatNumber(consumed.calories, locale)} / ${formatNumber(targets.calories, locale)} kcal · ${consumed.protein} g ${t.common.protein} · ${dateLabel}. Kandro.`
        : `${name}${t.evening.verdictNothing}`,
      title: t.evening.shareTitle,
    });
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.evening.close} accessibilityRole="button" hitSlop={8} onPress={() => router.replace('/(tabs)/today')} style={styles.iconButton}>
          <Ionicons color={colors.text} name="close" size={22} />
        </Pressable>
        <Text style={styles.topTitle}>{t.evening.title}</Text>
        <Pressable accessibilityLabel={t.evening.share} accessibilityRole="button" hitSlop={8} onPress={() => void shareDay()} style={styles.iconButton}>
          <Ionicons color={colors.text} name="share-outline" size={21} />
        </Pressable>
      </View>

      <Card style={styles.heroCard}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Eyebrow light>{dateLabel}</Eyebrow>
            <Text style={styles.headline}>{headline}</Text>
          </View>
          <View style={[styles.badge, over > 0 && styles.badgeAttention]}>
            <Ionicons
              color={over > 0 ? colors.attention : colors.accent}
              name={over > 0 ? 'partly-sunny-outline' : 'moon-outline'}
              size={22}
            />
          </View>
        </View>

        <View style={styles.numbersRow}>
          <View style={styles.numberBlock}>
            <Text style={styles.number}>{formatNumber(consumed.calories, locale)}</Text>
            <Text style={styles.numberLabel}>{t.evening.eatenLabel}</Text>
          </View>
          <View style={styles.numberDivider} />
          <View style={styles.numberBlock}>
            <Text style={styles.number}>{consumed.protein} g</Text>
            <Text style={styles.numberLabel}>{t.evening.proteinShare(proteinShare)}</Text>
          </View>
        </View>

        <Text style={styles.verdict}>{verdict}</Text>
      </Card>

      {logged ? (
        <Card style={styles.mealsCard}>
          <Text style={styles.sectionLabel}>{t.evening.meals}</Text>
          {meals.map((meal, index) => (
            <View key={meal.id}>
              <View style={styles.mealRow}>
                <Text style={styles.mealType}>{mealTypeLabel(meal.type, t.common)}</Text>
                <Text numberOfLines={1} style={styles.mealName}>{meal.title}</Text>
                <Text style={styles.mealCalories}>~{meal.calories}</Text>
              </View>
              {index < meals.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </Card>
      ) : null}

      <Card style={styles.tomorrowCard}>
        <View style={styles.tomorrowTop}>
          <View style={styles.tomorrowIcon}><Ionicons color={colors.onAccent} name="sunny-outline" size={20} /></View>
          <View style={styles.tomorrowCopy}>
            <Eyebrow>{t.evening.tomorrow}</Eyebrow>
            <Text style={styles.tomorrowTitle}>{t.evening.tomorrowTitle}</Text>
          </View>
        </View>
        <Text style={styles.tomorrowText}>
          {t.evening.tomorrowText(Math.round(targets.protein * 0.22 / 5) * 5)}
        </Text>
      </Card>

      {/* The offer promises one calm evening message, so accepting turns on
          exactly the end-of-day reminder and nothing else. */}
      {remindersSupported && !reminderEnabled && !reminderDismissed ? (
        <Card style={styles.offerCard}>
          <Text style={styles.offerTitle}>{t.result.reminderEyebrow}</Text>
          <Text style={styles.offerText}>
            {t.result.reminderText}
          </Text>
          <PrimaryButton
            icon="notifications-outline"
            label={t.result.reminderAccept}
            onPress={() => void enableEveningCheckIn().then(setReminderEnabled).catch(() => setReminderEnabled(false))}
          />
          <PrimaryButton label={t.common.notNow} onPress={() => setReminderDismissed(true)} variant="ghost" />
        </Card>
      ) : null}

      <PrimaryButton icon="arrow-forward" label={t.evening.toToday} onPress={() => router.replace('/(tabs)/today')} />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  heroCard: { backgroundColor: colors.camera, borderColor: colors.camera, gap: 22, paddingVertical: 24 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroCopy: { flex: 1, minWidth: 0, gap: 6 },
  headline: { ...typeScale.title1, color: colors.white, fontWeight: '700' },
  badge: { width: 46, height: 46, borderRadius: 17, backgroundColor: 'rgba(187,220,142,0.16)', alignItems: 'center', justifyContent: 'center' },
  badgeAttention: { backgroundColor: 'rgba(200,155,75,0.18)' },
  numbersRow: { flexDirection: 'row', alignItems: 'center' },
  numberBlock: { flex: 1, minWidth: 0, gap: 4 },
  numberDivider: { width: 1, height: 42, backgroundColor: 'rgba(255,255,255,0.13)', marginHorizontal: 18 },
  number: { color: colors.white, fontSize: 26, lineHeight: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  numberLabel: { ...typeScale.caption, color: 'rgba(255,255,255,0.54)' },
  verdict: { ...typeScale.subhead, color: 'rgba(255,255,255,0.82)' },
  mealsCard: { padding: 8, gap: 2 },
  sectionLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  mealRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  mealType: { ...typeScale.footnote, width: 92, color: colors.text, fontWeight: '600' },
  mealName: { ...typeScale.caption, flex: 1, minWidth: 0, color: colors.muted },
  mealCalories: { ...typeScale.footnote, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 10 },
  tomorrowCard: { backgroundColor: colors.accentSoft, borderColor: colors.accent, gap: 14 },
  tomorrowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tomorrowIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  tomorrowCopy: { flex: 1, minWidth: 0, gap: 3 },
  tomorrowTitle: { ...typeScale.headline, color: colors.text, fontWeight: '600' },
  tomorrowText: { ...typeScale.footnote, color: colors.muted },
  offerCard: { gap: 12 },
  offerTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  offerText: { ...typeScale.footnote, color: colors.muted },
});
