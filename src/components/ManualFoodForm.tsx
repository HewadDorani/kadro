import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import { newAnalysisRequestId } from '@/utils/requestId';
import { typeScale } from '@/constants/theme';

/** Accepts "250", "12,5" or "12.5"; empty optional fields count as 0. */
function parse(value: string, optional: boolean) {
  const text = value.trim().replace(',', '.');
  if (!text) return optional ? 0 : null;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/**
 * Any food can be logged, even one no database knows: the user states what
 * they ate and its calories for the amount eaten (macros optional). Stored as
 * an explicit own entry, never presented as a sourced reference value.
 */
export function ManualFoodForm({ initialName, onCancel, onConfirm }: {
  initialName: string;
  onCancel: () => void;
  onConfirm: (food: FoodSearchResult, grams: number) => void;
}) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const copy = t.scan;
  const [name, setName] = useState(initialName.trim().slice(0, 80));
  const [grams, setGrams] = useState('100');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [error, setError] = useState(false);

  const save = () => {
    const amount = parse(grams, false);
    const energy = parse(kcal, false);
    const macros = [parse(protein, true), parse(carbs, true), parse(fat, true)];
    if (!name.trim() || amount === null || amount < 1 || amount > 5000 || energy === null || energy > 10000 || macros.some(value => value === null || value > 2000)) {
      setError(true);
      return;
    }
    const per = (value: number) => Math.round(value / amount * 100 * 10) / 10;
    const [p, c, f] = macros as number[];
    const id = `manual-${newAnalysisRequestId()}`;
    onConfirm({
      id,
      name: name.trim(),
      per100g: { calories: per(energy), protein: per(p), carbs: per(c), fat: per(f), fiber: 0 },
      defaultGrams: amount,
      portions: [],
      source: { provider: 'manual', referenceId: id, label: copy.manualSource },
    }, Math.round(amount * 10) / 10);
  };

  const field = (label: string, value: string, onChange: (next: string) => void, unit: string, numeric = true) => (
    <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
      <Text style={{ ...typeScale.footnote, color: colors.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, backgroundColor: colors.surface }}>
        <TextInput
          accessibilityLabel={label}
          autoCorrect={false}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          onChangeText={next => { setError(false); onChange(next); }}
          placeholderTextColor={colors.muted}
          style={{ flex: 1, minWidth: 0, width: '100%', color: colors.text, fontSize: 17 }}
          value={value}
        />
        {unit ? <Text style={{ ...typeScale.callout, color: colors.muted, marginLeft: 4 }}>{unit}</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ ...typeScale.title2, color: colors.text, fontWeight: '700' }}>{copy.manualTitle}</Text>
      <Text style={{ ...typeScale.subhead, color: colors.muted }}>{copy.manualHint}</Text>
      {field(copy.manualName, name, setName, '', false)}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {field(copy.manualAmount, grams, setGrams, 'g')}
        {field(copy.manualCalories, kcal, setKcal, 'kcal')}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {field(t.common.protein, protein, setProtein, 'g')}
        {field(t.common.carbs, carbs, setCarbs, 'g')}
        {field(t.common.fat, fat, setFat, 'g')}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ ...typeScale.subhead, color: colors.attentionText }}>{copy.manualInvalid}</Text> : null}
      <PrimaryButton icon="checkmark" label={copy.manualSave} onPress={save} />
      <PrimaryButton variant="ghost" label={t.common.cancel} onPress={onCancel} />
    </View>
  );
}
