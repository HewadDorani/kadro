import { useEffect, useId, useRef, useState } from 'react';
import { InputAccessoryView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import { formatNumber } from '@/utils/format';
import { parseDecimalInput, stepWeightInput } from '@/utils/decimalInput';
import { typeScale } from '@/constants/theme';

/** A visible input: entering 90 kg takes two digits, not 120 small steps. */
export function WeightEntry({ value, min, max, unit, hint, label, compact = false, onChange, onValidityChange }: {
  value: number; min: number; max: number; unit: string; hint?: string;
  /** Compact: one card row (label · − value + ) for dense onboarding steps. */
  label?: string; compact?: boolean;
  onChange: (value: number) => void; onValidityChange: (valid: boolean) => void;
}) {
  const { t, locale } = useLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = useState(() => formatNumber(Math.round(value * 10) / 10, locale));
  const [focused, setFocused] = useState(false);
  const input = useRef<InstanceType<typeof TextInput> | null>(null);
  const accessoryId = useId();
  const parsed = parseDecimalInput(draft, min, max);
  const rangeHint = t.onboarding.weightRange.replace('{min}', formatNumber(min, locale)).replace('{max}', formatNumber(max, locale));
  useEffect(() => {
    onValidityChange(parsed !== null);
  }, [parsed, onValidityChange]);
  // Leaving this step must not leave a stale invalid flag on a later visit.
  useEffect(() => () => onValidityChange(true), [onValidityChange]);

  const changeText = (text: string) => {
    setDraft(text);
    const next = parseDecimalInput(text, min, max);
    onValidityChange(next !== null);
    if (next !== null) onChange(next);
  };
  const adjust = (direction: -1 | 1) => {
    const next = stepWeightInput(parsed ?? value, direction, min, max);
    setDraft(formatNumber(next, locale));
    onValidityChange(true);
    onChange(next);
  };

  const field = (
    <TextInput
      ref={input}
      accessibilityLabel={`${t.onboarding.editWeight} (${unit})`}
      accessibilityHint={t.onboarding.directWeightHint}
      inputMode="decimal"
      keyboardType="decimal-pad"
      inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
      selectTextOnFocus
      maxLength={7}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (parsed !== null) setDraft(formatNumber(parsed, locale)); }}
      onChangeText={changeText}
      onSubmitEditing={() => input.current?.blur()}
      selectionColor={colors.accentDeep}
      style={compact ? styles.compactInput : styles.input}
      value={draft}
    />
  );
  const accessory = Platform.OS === 'ios' ? (
    <InputAccessoryView nativeID={accessoryId} backgroundColor={colors.surface}>
      <View style={styles.keyboardBar}>
        <Text accessibilityLiveRegion="polite" style={[styles.keyboardHint, parsed === null && styles.error]}>{parsed === null ? rangeHint : `${draft} ${unit}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t.onboarding.doneWeight} onPress={() => input.current?.blur()} style={styles.keyboardDone}>
          <Text style={styles.doneText}>{t.onboarding.doneWeight}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  ) : null;

  const stepButton = (direction: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction < 0 ? t.common.decreaseUnit(`1 ${unit}`) : t.common.increaseUnit(`1 ${unit}`)}
      hitSlop={6}
      onPress={() => adjust(direction)}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      <Ionicons color={colors.text} name={direction < 0 ? 'remove' : 'add'} size={20} />
    </Pressable>
  );

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <View style={[styles.row, focused && styles.focused, parsed === null && styles.invalid]}>
          {label ? <Text numberOfLines={1} style={styles.rowLabel}>{label}</Text> : null}
          <View style={styles.rowControls}>
            {stepButton(-1)}
            <View style={styles.rowValue}>
              {field}
              <Text style={styles.rowUnit}>{unit}</Text>
            </View>
            {stepButton(1)}
          </View>
        </View>
        {parsed === null || hint ? <Text accessibilityLiveRegion="polite" style={[styles.hint, parsed === null && styles.error]}>{parsed === null ? rangeHint : hint}</Text> : null}
        {accessory}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t.onboarding.editWeight}</Text>
      <View style={[styles.field, focused && styles.focused, parsed === null && styles.invalid]}>
        <TextInput
          ref={input}
          accessibilityLabel={`${t.onboarding.editWeight} (${unit})`}
          accessibilityHint={t.onboarding.directWeightHint}
          inputMode="decimal"
          keyboardType="decimal-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
          selectTextOnFocus
          maxLength={7}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (parsed !== null) setDraft(formatNumber(parsed, locale)); }}
          onChangeText={changeText}
          onSubmitEditing={() => input.current?.blur()}
          selectionColor={colors.accentDeep}
          style={styles.input}
          value={draft}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.hint, parsed === null && styles.error]}>
        {parsed === null
          ? rangeHint
          : hint || t.onboarding.directWeightHint}
      </Text>
      <View style={styles.controls}>
        {([-1, 1] as const).map((direction) => (
          <Pressable
            key={direction}
            accessibilityRole="button"
            accessibilityLabel={direction < 0 ? t.common.decreaseUnit(`1 ${unit}`) : t.common.increaseUnit(`1 ${unit}`)}
            onPress={() => adjust(direction)}
            style={({ pressed }) => [styles.adjust, pressed && styles.pressed]}
          >
            <Text style={styles.adjustText}>{direction < 0 ? '−' : '+'} 1 {unit}</Text>
          </Pressable>
        ))}
      </View>
      <View aria-hidden={!focused} accessibilityElementsHidden={!focused} importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}>
        <Pressable disabled={!focused} accessibilityRole="button" accessibilityLabel={t.onboarding.doneWeight} onPress={() => input.current?.blur()} style={[styles.done, !focused && styles.hidden]}>
          <Text style={styles.doneText}>{t.onboarding.doneWeight}</Text>
        </Pressable>
      </View>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId} backgroundColor={colors.surface}>
          <View style={styles.keyboardBar}>
            <Text accessibilityLiveRegion="polite" style={[styles.keyboardHint, parsed === null && styles.error]}>{parsed === null ? rangeHint : `${draft} ${unit}`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t.onboarding.doneWeight} onPress={() => input.current?.blur()} style={styles.keyboardDone}>
              <Text style={styles.doneText}>{t.onboarding.doneWeight}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { width: '100%', maxWidth: 360, alignSelf: 'center', gap: 12 },
  compactWrap: { gap: 6 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16 },
  rowLabel: { ...typeScale.label, flexShrink: 1, color: colors.text, fontWeight: '600' },
  rowControls: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  rowValue: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', minWidth: 96 },
  compactInput: { minWidth: 58, paddingVertical: 6, fontSize: 26, fontWeight: '700', color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rowUnit: { ...typeScale.callout, marginLeft: 4, fontWeight: '600', color: colors.muted },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSoft },
  roundText: { ...typeScale.title2, fontWeight: '600', color: colors.text },
  label: { ...typeScale.subhead, fontWeight: '600', color: colors.muted },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 18, backgroundColor: colors.surface },
  focused: { borderColor: colors.accentDeep },
  invalid: { borderColor: colors.error },
  input: { flex: 1, minWidth: 0, minHeight: 82, paddingVertical: 10, fontSize: 42, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  unit: { ...typeScale.title2, fontWeight: '600', color: colors.muted },
  hint: { ...typeScale.footnote, color: colors.muted },
  error: { color: colors.error },
  controls: { flexDirection: 'row', gap: 12 },
  adjust: { flex: 1, minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14 },
  adjustText: { ...typeScale.headline, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.65 },
  done: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  doneText: { ...typeScale.label, color: colors.accentText, fontWeight: '700' },
  keyboardBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  keyboardHint: { ...typeScale.footnote, flex: 1, color: colors.muted, paddingVertical: 8 },
  keyboardDone: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  // Reserve its space: removing Done on blur moved the +/- controls between
  // pointer-down and pointer-up, swallowing the first tap after typing.
  hidden: { opacity: 0 },
});
