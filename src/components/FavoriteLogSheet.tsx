import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLocalDay } from '@/hooks/useLocalDay';
import { useLanguage } from '@/i18n/LanguageProvider';
import { errorHaptic, selectionHaptic, successHaptic } from '@/services/haptics';
import { favoriteCandidate, filterFavoriteCandidates, RepeatCandidate, scaleMealPortion } from '@/services/repeatMeals';
import type { Meal, PortionFactor } from '@/types/nutrition';
import { formatDayLabel, formatNumber, MEAL_TYPES, mealTypeIcon, mealTypeLabel } from '@/utils/format';

/** Above this many favourites the list gets a search field. */
export const FAVORITE_SEARCH_THRESHOLD = 8;
const PORTIONS: PortionFactor[] = [0.7, 1, 1.4];

type Props = {
  visible: boolean;
  /** Opens straight on the check step for this meal (Today's "Nochmal essen"); otherwise the favourites list. */
  candidate?: RepeatCandidate | null;
  /** The slot the flow started from (Today "+ Abendessen"): used as is, no chooser. */
  fixedSlot?: Meal['type'] | null;
  /** Preselected slot when the user chooses (the clock's, or Breakfast for yesterday's breakfast). */
  defaultSlot: Meal['type'];
  /** The day the meal is filed on; null is today. */
  date: string | null;
  onClose: () => void;
  onLogged: (meal: Meal, slot: Meal['type']) => void;
};

/**
 * Logging a favourite (or any repeat) into a slot the user states.
 *
 * One tap on a favourite opens a short check: portion (Weniger / Passt /
 * Mehr, relative to the stored grams) and "Als … eintragen" with the four
 * slots, preselected. When the flow already named the slot, it is used
 * directly. Logging is free: no analysis runs.
 */
export function FavoriteLogSheet({ visible, candidate = null, fixedSlot = null, defaultSlot, date, onClose, onLogged }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, t } = useLanguage();
  const today = useLocalDay();
  const { favoriteMeals, logRepeatMeal, mealHistory } = useApp();
  const [picked, setPicked] = useState<RepeatCandidate | null>(candidate);
  const [slot, setSlot] = useState<Meal['type']>(fixedSlot ?? defaultSlot);
  const [portion, setPortion] = useState<PortionFactor>(1);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(candidate);
    setSlot(fixedSlot ?? defaultSlot);
    setPortion(1);
    setQuery('');
    setError(null);
  }, [candidate, defaultSlot, fixedSlot, visible]);

  const all = useMemo(() => favoriteMeals.map((entry) => favoriteCandidate(entry, mealHistory)), [favoriteMeals, mealHistory]);
  const searchable = all.length > FAVORITE_SEARCH_THRESHOLD;
  const shown = useMemo(() => (searchable ? filterFavoriteCandidates(all, query) : all), [all, query, searchable]);
  const preview = useMemo(() => (picked ? scaleMealPortion(picked.source, portion) : null), [picked, portion]);
  const pastDay = date && date !== today ? formatDayLabel(date, today, t.today, locale) : null;
  const slotName = mealTypeLabel(fixedSlot ?? slot, t.common);

  const log = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    const target = fixedSlot ?? slot;
    try {
      const meal = await logRepeatMeal(picked, { type: target, date, portion });
      void successHaptic();
      onLogged(meal, target);
    } catch {
      void errorHaptic();
      setError(t.result.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    // Opened on one meal (Today): back means close; from the list, back to it.
    if (candidate) onClose();
    else setPicked(null);
  };

  return (
    <Modal animationType="slide" onRequestClose={picked && !candidate ? back : onClose} transparent visible={visible}>
      <Pressable accessibilityLabel={t.common.close} accessibilityRole="button" onPress={onClose} style={styles.scrim} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        {!picked ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>{fixedSlot ? t.favorites.pickTitleFor(mealTypeLabel(fixedSlot, t.common)) : t.favorites.pickTitle}</Text>
            {pastDay ? <Text style={styles.meta}>{t.favorites.forDay(pastDay)}</Text> : null}
            {all.length ? <Text style={styles.meta}>{t.favorites.pickHint}</Text> : null}
            {searchable ? (
              <TextInput
                accessibilityLabel={t.favorites.searchLabel}
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder={t.favorites.searchLabel}
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={styles.search}
                value={query}
              />
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
              {!all.length ? (
                <View style={styles.empty}>
                  <View style={styles.emptyIcon}><Ionicons color={colors.text} name="star-outline" size={22} /></View>
                  <Text style={styles.emptyTitle}>{t.favorites.emptyTitle}</Text>
                  <Text style={styles.meta}>{t.favorites.emptyText}</Text>
                </View>
              ) : !shown.length ? <Text style={styles.meta}>{t.favorites.noMatch}</Text> : shown.map((entry) => (
                <Pressable
                  accessibilityLabel={t.favorites.logAgainLabel(entry.title)}
                  accessibilityRole="button"
                  key={entry.key}
                  onPress={() => { void selectionHaptic(); setPicked(entry); }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={styles.rowStar}><Ionicons color={colors.onAccent} name="star" size={14} /></View>
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={2} style={styles.rowTitle}>{entry.title}</Text>
                    <Text style={styles.meta}>~{formatNumber(entry.calories, locale)} kcal · {entry.protein} g {t.common.protein} · {t.favorites.itemCount(entry.source.items.filter((item) => item.included).length)}</Text>
                  </View>
                  <Ionicons color={colors.muted} name="chevron-forward" size={18} />
                </Pressable>
              ))}
            </ScrollView>
            <PrimaryButton label={t.common.cancel} onPress={onClose} variant="ghost" />
          </>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.check}>
            <Text accessibilityRole="header" style={styles.title}>{fixedSlot ? t.favorites.logAs(slotName) : t.favorites.chooseTitle}</Text>
            <View style={styles.mealBox}>
              <Text numberOfLines={3} style={styles.rowTitle}>{picked.title}</Text>
              <Text style={styles.meta}>
                ~{formatNumber(preview?.calories ?? picked.calories, locale)} kcal · {preview?.protein ?? picked.protein} g {t.common.protein} · {t.favorites.itemCount(picked.source.items.filter((item) => item.included).length)}
              </Text>
              {pastDay ? <Text style={styles.meta}>{t.favorites.forDay(pastDay)}</Text> : null}
            </View>

            <Text style={styles.sectionLabel}>{t.favorites.portionLabel}</Text>
            <View accessibilityRole="radiogroup" style={styles.portionRow}>
              {PORTIONS.map((factor) => {
                const active = factor === portion;
                const label = factor < 1 ? t.confirm.less : factor > 1 ? t.confirm.more : t.confirm.fits;
                return (
                  <Pressable
                    aria-checked={active}
                    accessibilityLabel={`${label}, ${formatNumber(factor, locale)}×`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    key={factor}
                    onPress={() => { void selectionHaptic(); setPortion(factor); }}
                    style={[styles.portion, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                    <Text style={[styles.portionFactor, active && styles.chipTextActive]}>{formatNumber(factor, locale)}×</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.meta}>{t.favorites.portionHint}</Text>

            {fixedSlot ? null : (
              <>
                <Text style={styles.sectionLabel}>{t.favorites.slotLabel}</Text>
                <View accessibilityRole="radiogroup" style={styles.slotRow}>
                  {MEAL_TYPES.map((type) => {
                    const active = type === slot;
                    return (
                      <Pressable
                        aria-checked={active}
                        accessibilityLabel={mealTypeLabel(type, t.common)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                        key={type}
                        onPress={() => { void selectionHaptic(); setSlot(type); }}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Ionicons color={active ? colors.onAccent : colors.text} name={mealTypeIcon(type)} size={15} />
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{mealTypeLabel(type, t.common)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <PrimaryButton disabled={busy} icon="checkmark" label={t.favorites.logAs(slotName)} onPress={() => void log()} />
            <PrimaryButton label={candidate ? t.common.cancel : t.favorites.backToList} onPress={back} variant="ghost" />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.42)' },
  sheet: { maxHeight: '86%', borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  meta: { ...typeScale.footnote, color: colors.muted },
  search: { minHeight: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 16, paddingHorizontal: 14 },
  list: { flexGrow: 0 },
  listContent: { gap: 2, paddingBottom: 4 },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.6 },
  rowStar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  empty: { alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  check: { gap: 12, paddingBottom: 4 },
  mealBox: { borderRadius: radii.card, backgroundColor: colors.neutralSoft, padding: 14, gap: 4 },
  sectionLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 1 },
  portionRow: { flexDirection: 'row', gap: 8 },
  portion: { flex: 1, minHeight: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  portionFactor: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typeScale.footnote, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.onAccent },
  error: { ...typeScale.subhead, color: colors.attentionText },
});
