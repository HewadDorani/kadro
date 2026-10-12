import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useLocalDay } from '@/hooks/useLocalDay';
import { Meal } from '@/types/nutrition';
import { formatDayLabel, MEAL_TYPES, mealTypeIcon, mealTypeLabel } from '@/utils/format';
import { MAX_BACKDATE_DAYS, shiftDateKey } from '@/utils/mealDay';

/**
 * The compact "Heute · Mittagessen → Ändern" row on Confirm and the sheet
 * behind it. Logging yesterday's dinner this morning is normal; it must not
 * require logging it today and moving it afterwards.
 */
export function LogTargetRow({ date, type, onChange }: { date: string; type: Meal['type']; onChange: (type: Meal['type'], date: string) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const today = useLocalDay();
  const [open, setOpen] = useState(false);
  const label = `${formatDayLabel(date, today, t.today, locale)} · ${mealTypeLabel(type, t.common)}`;
  return (
    <>
      <Pressable
        accessibilityHint={t.confirm.targetSheetTitle}
        accessibilityLabel={`${t.confirm.targetFor}: ${label}`}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Ionicons color={colors.text} name={mealTypeIcon(type)} size={18} />
        <View style={styles.rowCopy}>
          <Text style={styles.rowLabel}>{t.confirm.targetFor}</Text>
          <Text numberOfLines={1} style={styles.rowValue}>{label}</Text>
        </View>
        <Text style={styles.rowAction}>{t.confirm.targetChange}</Text>
      </Pressable>
      <LogTargetSheet
        date={date}
        onApply={(nextType, nextDate) => { setOpen(false); onChange(nextType, nextDate); }}
        onCancel={() => setOpen(false)}
        type={type}
        visible={open}
      />
    </>
  );
}

function LogTargetSheet({ date, type, visible, onApply, onCancel }: { date: string; type: Meal['type']; visible: boolean; onApply: (type: Meal['type'], date: string) => void; onCancel: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, t } = useLanguage();
  const today = useLocalDay();
  const [draftDate, setDraftDate] = useState(date);
  const [draftType, setDraftType] = useState(type);
  useEffect(() => {
    if (!visible) return;
    setDraftDate(date);
    setDraftType(type);
  }, [date, type, visible]);
  // Today first, then back in time; never a future day.
  const days = useMemo(() => Array.from({ length: MAX_BACKDATE_DAYS + 1 }, (_, index) => shiftDateKey(today, -index)), [today]);
  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
      <Pressable accessibilityLabel={t.common.close} onPress={onCancel} style={styles.scrim} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <Text accessibilityRole="header" style={styles.title}>{t.confirm.targetSheetTitle}</Text>
        <Text style={styles.sectionLabel}>{t.confirm.targetDay}</Text>
        <ScrollView contentContainerStyle={styles.chipRow} horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {days.map((day) => {
            const active = day === draftDate;
            return (
              <Pressable
                aria-checked={active}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={day}
                onPress={() => setDraftDate(day)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{formatDayLabel(day, today, t.today, locale)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.sectionLabel}>{t.confirm.targetSlot}</Text>
        <View style={styles.slotRow}>
          {MEAL_TYPES.map((slot) => {
            const active = slot === draftType;
            return (
              <Pressable
                aria-checked={active}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={slot}
                onPress={() => setDraftType(slot)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Ionicons color={active ? colors.onAccent : colors.text} name={mealTypeIcon(slot)} size={15} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{mealTypeLabel(slot, t.common)}</Text>
              </Pressable>
            );
          })}
        </View>
        <PrimaryButton icon="checkmark" label={t.confirm.targetDone} onPress={() => onApply(draftType, draftDate)} />
        <PrimaryButton label={t.common.cancel} onPress={onCancel} variant="ghost" />
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { minHeight: 56, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowPressed: { backgroundColor: colors.neutralSoft },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '600' },
  rowValue: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  rowAction: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  scrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.42)' },
  sheet: { borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { ...typeScale.title2, color: colors.text, fontWeight: '700' },
  sectionLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 1 },
  chipScroll: { marginHorizontal: -20, flexGrow: 0 },
  chipRow: { paddingHorizontal: 20, gap: 8 },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typeScale.footnote, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.onAccent },
});
