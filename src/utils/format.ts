import type { MealPhotoPlaceholder } from '@/components/ui';
import Ionicons from '@expo/vector-icons/Ionicons';

import { getDictionary, getLocale } from '@/i18n/active';
import { Meal } from '@/types/nutrition';

/**
 * The locale defaults to the active language rather than to German: a caller
 * that forgets to pass one used to silently format 1950 as "1.950" for an
 * English reader.
 */
export function formatNumber(value: number, locale = getLocale()) {
  if (!Number.isFinite(value)) return '0';
  try {
    return value.toLocaleString(locale);
  } catch {
    return String(Math.round(value));
  }
}

type MealLabels = { mealBreakfast: string; mealLunch: string; mealDinner: string; mealSnack: string };

export function mealTypeLabel(type: Meal['type'], labels?: MealLabels) {
  const source = labels ?? getDictionary().common;
  return {
    Breakfast: source.mealBreakfast,
    Lunch: source.mealLunch,
    Dinner: source.mealDinner,
    Snack: source.mealSnack,
  }[type];
}

/** Distinct glyph per meal moment; three identical rows read as a bug. */
export function mealTypeIcon(type: Meal['type']): keyof typeof Ionicons.glyphMap {
  return {
    Breakfast: 'cafe-outline',
    Lunch: 'restaurant-outline',
    // Not a moon: the evening summary row already owns that glyph, and two
    // different things sharing one icon on the same screen reads as a bug.
    Dinner: 'pizza-outline',
    Snack: 'nutrition-outline',
  }[type] as keyof typeof Ionicons.glyphMap;
}

export const MEAL_TYPES: Meal['type'][] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/**
 * Clock time for a logged meal.
 *
 * The locale was hardcoded to de-DE in four places, so an American saw a
 * 24-hour clock. Hermes delegates Intl to the platform, but a missing or
 * unusual locale should degrade to a readable time rather than throw inside a
 * render.
 */
export function formatClockTime(date: Date, locale = getLocale()) {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    const hours = String(date.getHours()).padStart(2, '0');
    return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * A meal's stored "18:52" in the reader's clock ("6:52 PM" in the US). Meals
 * keep the time as written when they were saved; anything that is not a plain
 * 24-hour time is shown unchanged.
 */
export function displayClockTime(stored: string, locale = getLocale()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(stored.trim());
  if (!match) return stored;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return stored;
  return formatClockTime(new Date(2000, 0, 1, hour, minute), locale);
}

/**
 * Date formatting that cannot take a screen down.
 *
 * Intl throws a RangeError on an Invalid Date, and one corrupted stored entry
 * would then crash the whole tab rather than showing one odd label. Hermes
 * delegates Intl to the platform, so an unusual locale is worth guarding too.
 */
export function formatDateParts(
  value: Date | string,
  options: Intl.DateTimeFormatOptions,
  locale = getLocale(),
) {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * "Heute", "Gestern" or a short date: how a diary day is named in the day
 * switcher and on the confirm screen. Both keys are local calendar days.
 */
export function formatDayLabel(day: string, today: string, labels: { dayToday: string; dayYesterday: string }, locale = getLocale()) {
  const ago = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${day}T12:00:00`).getTime()) / 86_400_000);
  if (ago === 0) return labels.dayToday;
  if (ago === 1) return labels.dayYesterday;
  return formatDateParts(day, { weekday: 'short', day: 'numeric', month: 'short' }, locale);
}

/**
 * Which frame the confirm and result screens show when there is no photo.
 *
 * This used to be inlined at three call sites with a chain that ended in
 * 'demo', so a food chosen from search was presented as the example meal,
 * stock photo and all.
 */
export function mealPhotoPlaceholder(scanMode: string): MealPhotoPlaceholder {
  if (scanMode === 'barcode') return 'barcode';
  if (scanMode === 'description') return 'description';
  if (scanMode === 'search') return 'search';
  return 'demo';
}
