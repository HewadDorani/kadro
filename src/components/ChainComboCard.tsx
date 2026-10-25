import { PlanOptionCard, type PlanOptionItem } from '@/components/PlanOptionCard';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { ChainCombo, ChainComboItem } from '@/services/chainCombos';
import { formatNumber } from '@/utils/format';
import type { OptionFit } from '@/utils/mealSuggestions';

/**
 * Plan → Unterwegs: one order from a real chain, built from the shared
 * PlanOptionCard pieces so it reads like every other option. The chain name
 * leads, the rows are the menu items with the chain's own serving label, and
 * the fine print says whose numbers these are and how current.
 *
 * Values are the chain's published ones, so nothing carries the "~" of an
 * estimate.
 */
export function ChainComboCard({
  combo,
  rank,
  fit,
  availableCalories,
  onTake,
}: {
  combo: ChainCombo;
  rank: number;
  fit: OptionFit | null;
  availableCalories: number;
  onTake: () => void;
}) {
  const { locale, t } = useLanguage();
  const row = (entry: ChainComboItem): PlanOptionItem => ({
    key: entry.item.id,
    name: entry.item.name,
    detail: t.plan.marketItemMacros(formatNumber(entry.calories, locale), entry.protein),
    amount: entry.count > 1 ? `${formatNumber(entry.count, locale)} × ${entry.item.servingLabel}` : entry.item.servingLabel,
    ...(entry.item.servingG ? { amountDetail: `${formatNumber(Math.round(entry.item.servingG * entry.count), locale)} ${entry.item.category === 'drink' || entry.item.category === 'coffee' ? 'ml' : 'g'}` } : {}),
  });
  return (
    <PlanOptionCard
      footer={{
        action: { icon: 'restaurant-outline', label: t.plan.chainTake, onPress: onTake },
        availableCalories,
        calories: combo.calories,
        carbs: combo.carbs,
        estimated: false,
        fat: combo.fat,
        notes: [t.plan.chainSource(formatCheckedDate(combo.checked, locale))],
      }}
      header={{
        calories: combo.calories,
        estimated: false,
        fit,
        protein: combo.protein,
        rank,
        subtitle: combo.title,
        title: combo.chain.name,
      }}
      items={combo.items.map(row)}
    />
  );
}

/** "Okt. 2026" from "2026-10-25". */
export function formatCheckedDate(isoDate: string, locale: string) {
  const date = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}
