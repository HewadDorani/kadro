import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
// A native Modal is its own root, so the app-level provider's insets do not
// reach it; this provider measures the modal window itself.
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ShareDayCard, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/components/ShareDayCard';
import { PrimaryButton } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useLanguage } from '@/i18n/LanguageProvider';
import { isTeenProfile } from '@/services/personalization';
import { usePresentationBlock } from '@/services/presentation';
import { DEFAULT_SHARE_OPTIONS, shareDayCard, shareDayMessage, type ShareDayInput, type ShareDayOptions } from '@/services/shareDay';
import { selectionHaptic } from '@/services/haptics';
import { formatDateParts, formatNumber } from '@/utils/format';
import { progressPresentation } from '@/utils/progressPresentation';
import { formatWeightDelta } from '@/utils/units';

/**
 * The Story view: a full-screen 9:16 day card made for a screenshot or a
 * screen recording, plus a plain text share that always works. Tapping the
 * card hides every control so the screenshot is just the card.
 */
export function ShareDayModal({ input, onClose, visible }: {
  input: Omit<ShareDayInput, 'weightChangeKg' | 'weightAllowed'>;
  onClose: () => void;
  visible: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const { mealHistory, profile, weightEntries } = useApp();
  const today = useLocalDay();
  const reduceMotion = useReducedMotion();
  usePresentationBlock(visible);
  const [options, setOptions] = useState<ShareDayOptions>(DEFAULT_SHARE_OPTIONS);
  const [focus, setFocus] = useState(false);
  const [area, setArea] = useState({ width: 0, height: 0 });

  // Weight is only ever a 30-day change, only for adults with two readings.
  const weight = useMemo(() => {
    const presentation = progressPresentation(profile, mealHistory, weightEntries, today);
    return presentation.visibleWeights.length > 1 ? presentation.weightChange : null;
  }, [mealHistory, profile, today, weightEntries]);
  const weightAllowed = !isTeenProfile(profile) && weight !== null;
  const card = shareDayCard({ ...input, weightChangeKg: weight, weightAllowed }, options);
  const weightLabel = card.weightChangeKg === null ? null
    : `${card.weightChangeKg > 0 ? '+' : card.weightChangeKg < 0 ? '−' : '±'}${formatWeightDelta(Math.abs(card.weightChangeKg), profile.unitSystem, locale)}`;
  const dateLabel = formatDateParts(today, { weekday: 'short', day: 'numeric', month: 'short' }, locale);

  const cardWidth = Math.floor(Math.min(area.width, (area.height * SHARE_CARD_WIDTH) / SHARE_CARD_HEIGHT));
  const close = () => {
    setFocus(false);
    onClose();
  };
  const toggle = (key: keyof ShareDayOptions) => {
    void selectionHaptic();
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  };
  const shareText = async () => {
    try {
      await Share.share({
        message: shareDayMessage(t.shareDay, card, (value) => formatNumber(value, locale)),
        title: t.shareDay.shareTitle,
      });
    } catch {
      // The system sheet was dismissed or is unavailable; nothing to undo.
    }
  };
  const summary = [
    card.dayDone && card.overCalories > 0 ? t.shareDay.cardDayDone : `${formatNumber(card.remainingCalories, locale)} ${t.shareDay.cardLeft}`,
    card.protein ? `${t.common.protein} ${card.protein.current} / ${card.protein.target} g` : null,
    card.next ? t.shareDay.ideasFor(card.next.slot) : null,
    t.shareDay.appStoreHint,
  ].filter(Boolean).join('. ');

  return (
    <Modal animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={close} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar hidden={focus} />
      <SafeAreaView edges={focus ? [] : ['top', 'bottom']} style={styles.safe}>
        {!focus ? (
          <View style={styles.topBar}>
            <Pressable accessibilityLabel={t.shareDay.close} accessibilityRole="button" hitSlop={8} onPress={close} style={styles.iconButton}>
              <Ionicons color={colors.text} name="close" size={22} />
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>{t.shareDay.title}</Text>
            <View style={styles.iconSpacer} />
          </View>
        ) : null}

        <View onLayout={(event) => setArea({ width: Math.round(event.nativeEvent.layout.width), height: Math.round(event.nativeEvent.layout.height) })} style={[styles.cardArea, focus && styles.cardAreaFocus]}>
          {cardWidth > 0 ? (
            <Pressable
              accessibilityHint={focus ? t.shareDay.focusExit : t.shareDay.focusHint}
              accessibilityLabel={summary}
              accessibilityRole="button"
              onPress={() => setFocus((value) => !value)}
            >
              <ShareDayCard card={card} dateLabel={dateLabel} weightLabel={weightLabel} width={cardWidth} />
            </Pressable>
          ) : null}
        </View>

        {!focus ? (
          <ScrollView bounces={false} contentContainerStyle={styles.controls} style={styles.controlsScroll}>
            <View style={styles.hintRow}>
              <Ionicons color={colors.text} name="camera-outline" size={20} />
              <View style={styles.hintCopy}>
                <Text style={styles.hintTitle}>{t.shareDay.screenshotHint}</Text>
                <Text style={styles.hintText}>{t.shareDay.focusHint}</Text>
              </View>
            </View>
            <View style={styles.optionCard}>
              <View style={styles.optionRow}>
                <Text style={styles.optionLabel}>{t.shareDay.showProtein}</Text>
                <Switch accessibilityLabel={t.shareDay.showProtein} onValueChange={() => toggle('showProtein')} trackColor={{ false: colors.border, true: colors.accentText }} value={options.showProtein} />
              </View>
              {weightAllowed ? (
                <>
                  <View style={styles.optionDivider} />
                  <View style={styles.optionRow}>
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionLabel}>{t.shareDay.showWeight}</Text>
                      <Text style={styles.optionDetail}>{t.shareDay.showWeightDetail}</Text>
                    </View>
                    <Switch accessibilityLabel={t.shareDay.showWeight} onValueChange={() => toggle('showWeight')} trackColor={{ false: colors.border, true: colors.accentText }} value={options.showWeight} />
                  </View>
                </>
              ) : null}
            </View>
            <Text style={styles.privacy}>{t.shareDay.privacyNote}</Text>
            <PrimaryButton haptic icon="share-outline" label={t.shareDay.shareText} onPress={() => void shareText()} variant="secondary" />
          </ScrollView>
        ) : null}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  iconSpacer: { width: 44, height: 44 },
  title: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  cardArea: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  cardAreaFocus: { paddingHorizontal: 0, paddingVertical: 0 },
  controlsScroll: { flexGrow: 0, maxHeight: '46%' },
  controls: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  hintCopy: { flex: 1, gap: 2 },
  hintTitle: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  hintText: { ...typeScale.footnote, color: colors.muted },
  optionCard: { borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14 },
  optionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { ...typeScale.subhead, flex: 1, color: colors.text, fontWeight: '600' },
  optionDetail: { ...typeScale.caption, color: colors.muted },
  optionDivider: { height: 1, backgroundColor: colors.border },
  privacy: { ...typeScale.footnote, color: colors.muted },
});
