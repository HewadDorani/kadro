import { friendlySource } from '@/utils/sourceLabel';
import { nutritionFitsStorage } from '@/utils/ingredientCorrection';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';
import { PrimaryButton } from '@/components/ui';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatNumber } from '@/utils/format';
import { radii, typeScale } from '@/constants/theme';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { Nutrition } from '@/types/nutrition';
import { type FoodPortion, initialSelection, resolveGrams, scaleNutrition } from '@/utils/portions';

export type { FoodPortion };

export type PortionTarget = {
  name: string;
  per100g: Nutrition;
  defaultGrams: number;
  portions?: FoodPortion[];
  /** True when defaultGrams is an amount the user set, not a database default. */
  amountIsChosen?: boolean;
  /** A new entry (search): always "Add", even with a remembered amount. */
  adding?: boolean;
  preferGrams?: boolean;
  sourceLabel?: string;
};

/**
 * Amount entry for anything picked from search or a barcode.
 *
 * The old flow had a single grams field sitting above the result list, so you
 * had to decide "how much" before you knew "of what", and grams was the only
 * answer available. Nobody weighs a banana; they eat one, or two, or half.
 * So the amount is asked after the food is chosen, and a named portion counts
 * as a unit of its own: "2 × 1 banana" is 252 g without the user doing the
 * multiplication.
 */
export function PortionSheet({
  target,
  visible,
  onCancel,
  onConfirm,
  embedded = false,
  initialDraft,
  onDraftChange,
}: {
  target: PortionTarget | null;
  visible: boolean;
  onCancel: () => void;
  onConfirm: (grams: number) => void;
  embedded?: boolean;
  initialDraft?: { amount: string; unitIndex: number } | null;
  onDraftChange?: (draft: { amount: string; unitIndex: number }) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const portions = target?.portions?.length ? target.portions : [];
  // Restaurant servings without a published weight: counted in servings only,
  // never in grams (the stored grams are a stand-in).
  const servingOnly = portions.length > 0 && portions.every((portion) => portion.unitOnly);
  // A named portion is the friendlier default when the food has one.
  const [unitIndex, setUnitIndex] = useState(0);
  const [amount, setAmount] = useState('');

  // Re-key on the food so a second search does not inherit the first one's
  // count: "2" pieces of yoghurt is not "2" of the next thing.
  const signature = `${visible}:${target?.name ?? ''}:${target?.defaultGrams ?? 0}:${target?.preferGrams ?? false}`;
  // A sentinel no signature can equal, so the first target is initialised by
  // the same branch as every later one. Seeding this with the current
  // signature meant a sheet that mounted with a food already chosen opened
  // with an empty amount field.
  const [seen, setSeen] = useState('\u0000');
  if (seen !== signature) {
    const opening = initialSelection(target?.defaultGrams ?? 100, target?.preferGrams && !servingOnly ? [] : portions, { chosen: target?.amountIsChosen });
    if (servingOnly && opening.unitIndex < 0) {
      opening.unitIndex = 0;
      opening.amount = String(Math.round(((target?.defaultGrams ?? portions[0].grams) / portions[0].grams) * 10) / 10);
    }
    setSeen(signature);
    setUnitIndex(initialDraft?.unitIndex ?? opening.unitIndex);
    setAmount(initialDraft?.amount ?? opening.amount);
  }
  useEffect(() => { if (visible && target) onDraftChange?.({ amount, unitIndex }); }, [visible, target?.name, amount, unitIndex, onDraftChange]);

  const activePortion = unitIndex >= 0 ? portions[unitIndex] : undefined;
  const grams = resolveGrams(amount, activePortion);
  const valid = grams !== null && Boolean(target && nutritionFitsStorage(scaleNutrition(target.per100g, grams)));

  const preview = useMemo(
    () => (target && grams !== null ? scaleNutrition(target.per100g, grams) : null),
    [grams, target],
  );

  const pickUnit = (index: number) => {
    if (index === unitIndex) return;
    setUnitIndex(index);
    const currentGrams = grams ?? target?.defaultGrams ?? 100;
    setAmount(index >= 0 ? String(Number((currentGrams / portions[index].grams).toFixed(6))) : String(currentGrams));
  };

  const quickCounts = activePortion ? ['0.5', '1', '2', '3', '4', '5'] : ['50', '100', '150', '200', '250'];
  const cancel = () => { Keyboard.dismiss(); onCancel(); };

  const content = (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.cancel} onPress={cancel} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{target?.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} hitSlop={8} onPress={cancel} style={styles.close}><Ionicons color={colors.text} name="close" size={20} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.body}>
          {friendlySource(target?.sourceLabel) ? <Text style={styles.source}>{friendlySource(target?.sourceLabel)}</Text> : null}
          {activePortion?.estimated ? <Text style={styles.previewMacros}>{t.portion.estimatedPiece}</Text> : null}

          <View style={styles.amountRow}>
            <TextInput
              accessibilityLabel={t.portion.amount}
              keyboardType="decimal-pad"
              maxLength={7}
              onChangeText={setAmount}
              selectTextOnFocus
              style={styles.amountInput}
              value={amount}
            />
            <Text style={styles.amountUnit} numberOfLines={2}>
              {activePortion ? `× ${activePortion.label}` : 'g'}
            </Text>
          </View>
          {activePortion ? <View style={styles.countStepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.confirm.decrease} onPress={() => setAmount(String(Math.max(0.5, Number(amount.replace(',', '.')) - 1 || 0.5)))} style={styles.close}><Text style={styles.closeText}>−</Text></Pressable>
            <Text style={styles.source}>{t.portion.perPiece.replace('{calories}', String(Math.round(target!.per100g.calories * activePortion.grams / 100)))}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t.confirm.increase} onPress={() => setAmount(String(Math.min(99, (Number(amount.replace(',', '.')) || 0) + 1)))} style={styles.close}><Text style={styles.closeText}>+</Text></Pressable>
          </View> : null}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickRow} horizontal showsHorizontalScrollIndicator={false}>
            {quickCounts.map((value) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: amount === value }}
                key={value}
                onPress={() => setAmount(value)}
                style={[styles.quickChip, amount === value && styles.quickChipOn]}
              >
                <Text style={[styles.quickChipText, amount === value && styles.quickChipTextOn]}>
                  {activePortion ? value.replace('.', t.portion.decimalMark) : `${value} g`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {portions.length ? (
            <View style={styles.unitRow}>
              {portions.map((portion, index) => (
                <Pressable
                  aria-checked={unitIndex === index}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: unitIndex === index }}
                  key={portion.label}
                  onPress={() => pickUnit(index)}
                  style={[styles.unitChip, unitIndex === index && styles.unitChipOn]}
                >
                  <Text numberOfLines={1} style={[styles.unitChipText, unitIndex === index && styles.unitChipTextOn]}>
                    {portion.label}
                  </Text>
                  {portion.unitOnly ? null : <Text style={styles.unitChipGrams}>{portion.estimated ? '~' : ''}{Math.round(portion.grams)} g</Text>}
                </Pressable>
              ))}
              {servingOnly ? null : <Pressable
                aria-checked={unitIndex === -1}
                accessibilityRole="radio"
                accessibilityState={{ checked: unitIndex === -1 }}
                onPress={() => pickUnit(-1)}
                style={[styles.unitChip, unitIndex === -1 && styles.unitChipOn]}
              >
                <Text style={[styles.unitChipText, unitIndex === -1 && styles.unitChipTextOn]}>{t.portion.grams}</Text>
                <Text style={styles.unitChipGrams}>g</Text>
              </Pressable>}
            </View>
          ) : null}

          <View style={styles.preview}>
            <Text style={styles.previewValue}>{preview ? `~${formatNumber(preview.calories, locale)} kcal` : ':'}</Text>
            {preview ? (
              <Text style={styles.previewMacros}>
                {preview.protein} g P · {preview.carbs} g C · {preview.fat} g F{activePortion?.unitOnly ? '' : ` · ${formatNumber(grams!, locale)} g`}
              </Text>
            ) : (
              <Text style={styles.previewMacros}>{grams !== null && !valid ? t.errors.gatewayNutritionRange : t.portion.invalid}</Text>
            )}
          </View>

          </ScrollView>
          <PrimaryButton disabled={!valid} icon="checkmark" label={target?.amountIsChosen && !target.adding ? t.portion.save : t.portion.add} onPress={() => { if (grams !== null) { Keyboard.dismiss(); onConfirm(grams); } }} />
        </View>
      </KeyboardAvoidingView>
  );
  if (embedded) return visible && target ? content : null;
  return <Modal animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={cancel} transparent visible={visible && !!target}>{content}</Modal>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, gap: 12 },
  body: { gap: 14, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.neutralSoft },
  closeText: { color: colors.text, fontSize: 26, lineHeight: 30 },
  countStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.4 },
  source: { ...typeScale.caption, color: colors.muted },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amountInput: { minWidth: 108, minHeight: 64, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.neutralSoft, color: colors.text, fontSize: 30, fontWeight: '700', paddingHorizontal: 16, textAlign: 'center', fontVariant: ['tabular-nums'] },
  amountUnit: { ...typeScale.headline, flex: 1, color: colors.text, fontWeight: '600' },
  quickRow: { gap: 8, paddingRight: 8 },
  quickChip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  quickChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  quickChipText: { ...typeScale.subhead, color: colors.muted, fontWeight: '700' },
  quickChipTextOn: { color: colors.onAccent },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitChip: { minHeight: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'center' },
  unitChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentText },
  unitChipText: { ...typeScale.footnote, color: colors.text, fontWeight: '600', maxWidth: 170 },
  unitChipTextOn: { color: colors.accentText },
  unitChipGrams: { ...typeScale.caption, color: colors.muted },
  preview: { borderRadius: radii.input, backgroundColor: colors.neutralSoft, padding: 14, gap: 3 },
  previewValue: { ...typeScale.title2, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewMacros: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
});
