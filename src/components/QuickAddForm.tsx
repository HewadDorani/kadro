import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import { newAnalysisRequestId } from '@/utils/requestId';
import { typeScale } from '@/constants/theme';

/** Grams a quick entry is stored at; its values are "per 1 portion". */
export const QUICK_ADD_GRAMS = 100;

/** "250", "12,5" or "12.5"; empty → null; anything else → NaN. */
function parse(value: string) {
  const text = value.trim().replace(',', '.');
  if (!text) return null;
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * Returns the quick entry for valid input, else null. Energy 1–5000 kcal;
 * protein optional, and never more energy (4 kcal/g) than the total.
 */
export function quickAddFood(input: { name: string; kcal: string; protein: string }, labels: { defaultName: string; source: string; portion: string }): FoodSearchResult | null {
  const kcal = parse(input.kcal);
  const protein = parse(input.protein) ?? 0;
  if (kcal === null || !Number.isFinite(kcal) || kcal < 1 || kcal > 5000) return null;
  if (!Number.isFinite(protein) || protein < 0 || protein * 4 > kcal + 10) return null;
  const id = `quick-${newAnalysisRequestId()}`;
  return {
    id,
    name: (input.name.trim() || labels.defaultName).slice(0, 80),
    // Stored as one 100 g "portion" so the values are exactly what was typed.
    per100g: { calories: Math.round(kcal), protein: Math.round(protein * 10) / 10, carbs: 0, fat: 0, fiber: 0 },
    defaultGrams: QUICK_ADD_GRAMS,
    portions: [{ label: labels.portion, grams: QUICK_ADD_GRAMS }],
    source: { provider: 'manual', referenceId: id, label: labels.source },
  };
}

export const isQuickAddResult = (result: Pick<FoodSearchResult, 'source'>) => Boolean(result.source.referenceId?.startsWith('quick-'));

/**
 * "Kalorien schnell eintragen": for when nothing in any database fits. Only
 * energy is required; it is labelled as the user's own entry everywhere.
 */
export function QuickAddForm({ initialName, onCancel, onConfirm }: {
  initialName: string;
  onCancel: () => void;
  onConfirm: (food: FoodSearchResult, grams: number) => void;
}) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const copy = t.scan;
  const [name, setName] = useState(initialName.trim().slice(0, 80));
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [error, setError] = useState(false);

  const save = () => {
    const food = quickAddFood({ name, kcal, protein }, { defaultName: copy.quickAddDefaultName, source: copy.quickAddSource, portion: copy.portionServing });
    if (!food) { setError(true); return; }
    onConfirm(food, QUICK_ADD_GRAMS);
  };

  const field = (label: string, value: string, onChange: (next: string) => void, unit: string, numeric = true) => (
    <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
      <Text style={{ ...typeScale.footnote, color: colors.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, backgroundColor: colors.surface }}>
        <TextInput
          accessibilityLabel={label}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          maxLength={numeric ? 7 : 80}
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
      <Text accessibilityRole="header" style={{ ...typeScale.title2, color: colors.text, fontWeight: '700' }}>{copy.quickAddTitle}</Text>
      <Text style={{ ...typeScale.subhead, color: colors.muted }}>{copy.quickAddText}</Text>
      {field(copy.quickAddName, name, setName, '', false)}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {field(copy.quickAddCalories, kcal, setKcal, 'kcal')}
        {field(copy.quickAddProtein, protein, setProtein, 'g')}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ ...typeScale.subhead, color: colors.attentionText }}>{copy.quickAddInvalid}</Text> : null}
      <PrimaryButton icon="checkmark" label={copy.quickAddSave} onPress={save} />
      <PrimaryButton variant="ghost" label={t.common.cancel} onPress={onCancel} />
    </View>
  );
}
