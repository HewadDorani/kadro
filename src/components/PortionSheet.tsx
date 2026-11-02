import { friendlySource } from '@/utils/sourceLabel';
import { nutritionFitsStorage } from '@/utils/ingredientCorrection';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardBackfill } from '@/components/KeyboardBackfill';
import { PrimaryButton } from '@/components/ui';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { formatNumber } from '@/utils/format';
import { radii, typeScale } from '@/constants/theme';
import { useLanguage } from '@/i18n/LanguageProvider';
import { pieceKey, piecePortions, portionName, rememberPieceWeight } from '@/services/pieceWeights';
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
  /** Product reference the weight of one piece is remembered under. */
  pieceKey?: string;
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
  accessory,
}: {
  target: PortionTarget | null;
  visible: boolean;
  onCancel: () => void;
  onConfirm: (grams: number) => void;
  embedded?: boolean;
  initialDraft?: { amount: string; unitIndex: number } | null;
  onDraftChange?: (draft: { amount: string; unitIndex: number }) => void;
  /** Shown under the title, e.g. which meal and day this goes to. */
  accessory?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  // Bumps when a piece weight was just typed, so the list below is rebuilt.
  const [pieceRevision, setPieceRevision] = useState(0);
  const key = target ? target.pieceKey ?? pieceKey(target.name) : '';
  const portions = useMemo(
    () => (target ? piecePortions(target.name, target.portions, key) : []),
    [key, pieceRevision, target?.name, target?.portions],
  );
  // Restaurant servings without a published weight: counted in servings only,
  // never in grams (the stored grams are a stand-in).
  const servingOnly = portions.length > 0 && portions.every((portion) => portion.unitOnly);
  // A named portion is the friendlier default when the food has one.
  const [unitIndex, setUnitIndex] = useState(0);
  const [amount, setAmount] = useState('');
  const [pieceInput, setPieceInput] = useState<string | null>(null);
  const pieceField = useRef<InstanceType<typeof TextInput>>(null);

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
    setPieceInput(null);
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

  const quickGrams = ['50', '100', '150', '200', '250'];
  const cancel = () => { Keyboard.dismiss(); onCancel(); };
  const step = (direction: 1 | -1) => {
    const current = Number(amount.replace(',', '.')) || 0;
    if (activePortion) {
      const next = direction > 0 ? current + 1 : current - 1;
      setAmount(String(Math.min(99, next < 1 ? 0.5 : next)));
    } else {
      setAmount(String(Math.max(10, Math.min(5000, Math.round((current + direction * 10) / 10) * 10))));
    }
  };
  const pieceGrams = pieceInput === null ? null : resolveGrams(pieceInput);
  const applyPiece = () => {
    if (pieceGrams === null || !target) return;
    Keyboard.dismiss();
    void rememberPieceWeight(key, target.name, pieceGrams);
    setPieceInput(null);
    setPieceRevision((revision) => revision + 1);
    setUnitIndex(0);
    // Counting already keeps its count; coming from grams starts at one piece.
    if (unitIndex < 0) setAmount('1');
  };
  const unitName = (portion: FoodPortion) => portionName(portion.label);
  const weightText = (portion: FoodPortion) => `${portion.estimated ? '~' : ''}${formatNumber(Math.round(portion.grams * 10) / 10, locale)}`;

  const content = (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.scrim}>
        <KeyboardBackfill color={colors.surface} />
        <Pressable accessibilityRole="button" accessibilityLabel={t.common.cancel} onPress={cancel} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{target?.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.common.close} hitSlop={8} onPress={cancel} style={styles.close}><Ionicons color={colors.text} name="close" size={20} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {accessory}

          {portions.length ? (
            <View accessibilityRole="radiogroup" style={styles.unitRow}>
              {portions.map((portion, index) => (
                <Pressable
                  aria-checked={unitIndex === index}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: unitIndex === index }}
                  key={portion.label}
                  onPress={() => pickUnit(index)}
                  style={[styles.unitChip, unitIndex === index && styles.unitChipOn]}
                >
                  <Text numberOfLines={1} style={[styles.unitChipText, unitIndex === index && styles.unitChipTextOn]}>{unitName(portion)}</Text>
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
              </Pressable>}
            </View>
          ) : null}

          <View style={styles.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.confirm.decrease} onPress={() => step(-1)} style={styles.stepButton}><Ionicons color={colors.text} name="remove" size={24} /></Pressable>
            <View style={styles.amountBlock}>
              <TextInput
                accessibilityLabel={t.portion.amount}
                keyboardType="decimal-pad"
                maxLength={7}
                onChangeText={setAmount}
                selectTextOnFocus
                style={styles.amountInput}
                value={amount.replace('.', t.portion.decimalMark)}
              />
              <Text numberOfLines={1} style={styles.amountUnit}>{activePortion ? `× ${unitName(activePortion)}` : 'g'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t.confirm.increase} onPress={() => step(1)} style={styles.stepButton}><Ionicons color={colors.text} name="add" size={24} /></Pressable>
          </View>

          {pieceInput !== null ? (
            <View style={styles.pieceBox}>
              <Text style={styles.pieceLabel}>{t.portion.pieceWeight}</Text>
              <View style={styles.pieceRow}>
                <TextInput accessibilityLabel={t.portion.pieceWeight} keyboardType="decimal-pad" maxLength={6} onChangeText={setPieceInput} onLayout={() => pieceField.current?.focus()} ref={pieceField} selectTextOnFocus style={styles.pieceInput} value={pieceInput} />
                <Text style={styles.pieceUnit}>g</Text>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: pieceGrams === null }} disabled={pieceGrams === null} onPress={applyPiece} style={[styles.pieceApply, pieceGrams === null && styles.pieceApplyOff]}>
                  <Text style={styles.pieceApplyText}>{t.portion.pieceApply}</Text>
                </Pressable>
              </View>
              <Text style={styles.source}>{t.portion.pieceWeightHint}</Text>
            </View>
          ) : activePortion && !activePortion.unitOnly ? (
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setPieceInput(String(Math.round(activePortion.grams * 10) / 10))} style={styles.pieceLine}>
              <Text style={styles.source}>{t.portion.pieceEach(weightText(activePortion))}</Text>
              <Text style={styles.pieceChange}>{t.portion.pieceChange}</Text>
            </Pressable>
          ) : !activePortion && !servingOnly ? (
            <>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickRow} horizontal showsHorizontalScrollIndicator={false}>
                {quickGrams.map((value) => (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: amount === value }} key={value} onPress={() => setAmount(value)} style={[styles.quickChip, amount === value && styles.quickChipOn]}>
                    <Text style={[styles.quickChipText, amount === value && styles.quickChipTextOn]}>{`${value} g`}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {portions.length ? null : <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setPieceInput('')} style={styles.pieceLine}>
                <Text style={styles.pieceChange}>{t.portion.pieceSet}</Text>
              </Pressable>}
            </>
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
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.neutralSoft },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.4 },
  source: { ...typeScale.footnote, color: colors.muted },
  unitRow: { flexDirection: 'row', borderRadius: radii.input, backgroundColor: colors.neutralSoft, padding: 4, gap: 4 },
  unitChip: { flex: 1, minHeight: 40, borderRadius: 11, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  unitChipOn: { backgroundColor: colors.surface },
  unitChipText: { ...typeScale.footnote, color: colors.muted, fontWeight: '700' },
  unitChipTextOn: { color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepButton: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  amountBlock: { flex: 1, minWidth: 0, alignItems: 'center' },
  amountInput: { minWidth: 120, color: colors.text, fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -0.8, paddingVertical: 0, textAlign: 'center', fontVariant: ['tabular-nums'] },
  amountUnit: { ...typeScale.subhead, color: colors.muted, fontWeight: '600' },
  pieceLine: { minHeight: 32, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 8 },
  pieceChange: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  pieceBox: { gap: 8, borderRadius: radii.input, backgroundColor: colors.neutralSoft, padding: 14 },
  pieceLabel: { ...typeScale.footnote, color: colors.text, fontWeight: '700' },
  pieceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pieceInput: { width: 92, minHeight: 44, borderRadius: 11, backgroundColor: colors.surface, color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  pieceUnit: { ...typeScale.subhead, flex: 1, color: colors.muted, fontWeight: '600' },
  pieceApply: { minHeight: 44, borderRadius: radii.pill, backgroundColor: colors.accent, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  pieceApplyOff: { opacity: 0.45 },
  pieceApplyText: { ...typeScale.footnote, color: colors.onAccent, fontWeight: '800' },
  quickRow: { gap: 8, paddingRight: 8 },
  quickChip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  quickChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  quickChipText: { ...typeScale.subhead, color: colors.muted, fontWeight: '700' },
  quickChipTextOn: { color: colors.onAccent },
  preview: { borderRadius: radii.input, backgroundColor: colors.neutralSoft, padding: 14, gap: 3, alignItems: 'center' },
  previewValue: { ...typeScale.title2, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewMacros: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
});
