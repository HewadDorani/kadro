import { useMemo, useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { CustomFoodDraft } from '@/services/customFoods';
import { formatNumber } from '@/utils/format';
import { typeScale } from '@/constants/theme';

// Same parser and limits as the server table and the gateway's label check.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { customFoodFromForm, parseLabelNumber, labelPlausibility } = require('../../supabase/functions/_shared/label-facts.mjs') as {
  customFoodFromForm: (form: LabelForm) => { food?: Omit<CustomFoodDraft, 'origin'>; errors?: string[]; plausibility: Plausibility };
  parseLabelNumber: (text: string) => number | null;
  labelPlausibility: (values: Record<string, number | null>) => Plausibility;
};

type Plausibility = { plausible: boolean; issues: string[]; blocking: string[]; atwaterKcal: number | null };

export type LabelForm = {
  name: string; brand: string; barcode: string;
  calories: string; protein: string; carbs: string; sugar: string; fat: string; saturatedFat: string; fiber: string; salt: string;
  servingG: string; packageG: string;
};

export const EMPTY_LABEL_FORM: LabelForm = { name: '', brand: '', barcode: '', calories: '', protein: '', carbs: '', sugar: '', fat: '', saturatedFat: '', fiber: '', salt: '', servingG: '', packageG: '' };

/**
 * Confirms a nutrition-label read (or an own product typed from the pack).
 * Every value stays editable; impossible combinations block saving, and an
 * Atwater mismatch is shown as a warning to check against the pack.
 */
export function LabelFoodForm({ initial, notices, saving, saveError, showBarcode, onCancel, onSave }: {
  initial: LabelForm;
  notices: string[];
  saving: boolean;
  saveError: string | null;
  showBarcode: boolean;
  onCancel: () => void;
  onSave: (food: Omit<CustomFoodDraft, 'origin'>, logNow: boolean) => void;
}) {
  const { colors } = useTheme();
  const { t, locale } = useLanguage();
  const copy = t.labelScan;
  const [form, setForm] = useState<LabelForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (key: keyof LabelForm) => (value: string) => { setErrors([]); setForm(current => ({ ...current, [key]: value })); };

  // Live check while typing: only warnings here, blocking errors on save.
  const live = useMemo(() => {
    const values: Record<string, number | null> = {};
    for (const key of ['calories', 'protein', 'carbs', 'sugar', 'fat', 'saturatedFat', 'fiber', 'salt'] as const) {
      const value = parseLabelNumber(form[key]);
      values[key] = value !== null && Number.isFinite(value) ? value : null;
    }
    return labelPlausibility(values);
  }, [form]);

  const message = (code: string) => ({
    sugar_exceeds_carbs: copy.errSugar, saturated_exceeds_fat: copy.errSaturated, mass_exceeds_100g: copy.errMass,
    energy_too_high: copy.errEnergy, nutrient_over_100g: copy.errNutrientOver,
  } as Record<string, string>)[code] ?? copy.errFields;

  const submit = (logNow: boolean) => {
    if (saving) return;
    const result = customFoodFromForm(form);
    if (!result.food) { setErrors([...new Set((result.errors ?? []).map(message))]); return; }
    onSave(result.food, logNow);
  };

  const field = (key: keyof LabelForm, label: string, unit: string, numeric = true) => (
    <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
      <Text style={{ ...typeScale.footnote, color: colors.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, backgroundColor: colors.surface }}>
        <TextInput
          accessibilityLabel={unit ? `${label} (${unit})` : label}
          keyboardType={key === 'barcode' ? 'number-pad' : numeric ? 'decimal-pad' : 'default'}
          maxLength={numeric ? 8 : key === 'brand' ? 60 : 80}
          onChangeText={set(key)}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, minWidth: 0, width: '100%', color: colors.text, fontSize: 17 }}
          value={form[key]}
        />
        {unit ? <Text style={{ ...typeScale.subhead, color: colors.muted, marginLeft: 4 }}>{unit}</Text> : null}
      </View>
    </View>
  );
  const row = (left: ReactNode, right: ReactNode) => <View style={{ flexDirection: 'row', gap: 10 }}>{left}{right}</View>;
  const warnings = [
    ...(live.issues.includes('energy_macro_mismatch') && live.atwaterKcal !== null
      ? [copy.warnMismatch(formatNumber(Number(parseLabelNumber(form.calories)), locale), formatNumber(live.atwaterKcal, locale))] : []),
    ...(live.blocking.length ? [...new Set(live.blocking.map(message))] : []),
  ];

  return (
    <View style={{ gap: 12 }}>
      {notices.map(notice => (
        <Text key={notice} style={{ ...typeScale.subhead, color: colors.attentionText }}>{notice}</Text>
      ))}
      {field('name', copy.fieldName, '', false)}
      {field('brand', copy.fieldBrand, '', false)}
      <Text accessibilityRole="header" style={{ ...typeScale.label, color: colors.text, fontWeight: '700', marginTop: 4 }}>{copy.per100}</Text>
      {row(field('calories', copy.fieldCalories, 'kcal'), field('protein', copy.fieldProtein, 'g'))}
      {row(field('carbs', copy.fieldCarbs, 'g'), field('sugar', copy.fieldSugar, 'g'))}
      {row(field('fat', copy.fieldFat, 'g'), field('saturatedFat', copy.fieldSaturated, 'g'))}
      {row(field('fiber', copy.fieldFiber, 'g'), field('salt', copy.fieldSalt, 'g'))}
      {row(field('servingG', copy.fieldServing, 'g'), field('packageG', copy.fieldPackage, 'g'))}
      {showBarcode ? field('barcode', copy.fieldBarcode, '') : null}
      {warnings.length ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.attentionSoft }}>
          {warnings.map(warning => <Text key={warning} style={{ ...typeScale.subhead, color: colors.attentionText }}>{warning}</Text>)}
        </View>
      ) : null}
      {errors.map(error => <Text accessibilityRole="alert" key={error} style={{ ...typeScale.subhead, color: colors.attentionText }}>{error}</Text>)}
      {saveError ? <Text accessibilityRole="alert" style={{ ...typeScale.subhead, color: colors.attentionText }}>{saveError}</Text> : null}
      <PrimaryButton disabled={saving} icon="checkmark" label={saving ? copy.saving : copy.save} onPress={() => submit(true)} />
      <PrimaryButton disabled={saving} variant="secondary" label={copy.saveOnly} onPress={() => submit(false)} />
      <PrimaryButton variant="ghost" label={t.common.cancel} onPress={onCancel} />
    </View>
  );
}
