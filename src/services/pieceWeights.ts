import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDictionary } from '@/i18n/active';
import type { Meal } from '@/types/nutrition';
import { guessPiece, type PieceKind } from '@/utils/pieceGuess';
import type { FoodPortion } from '@/utils/portions';

/**
 * What one piece of a product weighs, as the person read it off the pack. Typed
 * once ("1 Scheibe = 36 g"), every later scan starts there. The device keeps a
 * product reference and a weight; other devices learn it from the saved meal,
 * whose portions already sync, so there is no second copy of anything in the
 * cloud.
 */
export const PIECE_WEIGHTS_KEY = '@kandro/piece-weights:v1';
const MAX_REMEMBERED = 500;
const SINGLE_PIECE_MAX_G = 150;

type Remembered = { grams: number; kind: PieceKind; at?: string };
let remembered: Record<string, Remembered> = {};
let loaded = false;

export async function loadPieceWeights() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(PIECE_WEIGHTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') remembered = { ...(parsed as Record<string, Remembered>), ...remembered };
  } catch { /* A damaged note only costs the typed weight, never a meal. */ }
}

export function forgetPieceWeights() {
  remembered = {};
}

export function pieceKey(name: string, referenceId?: string | null) {
  return referenceId || `name:${name.trim().toLowerCase()}`;
}

function pieceLabel(kind: PieceKind) {
  const t = getDictionary().scan;
  return kind === 'slice' ? t.portionSlice : kind === 'egg' ? t.portionEgg : kind === 'tbsp' ? t.portionTbsp : t.portionPiece;
}

export async function rememberPieceWeight(key: string, name: string, grams: number) {
  remembered = { ...remembered, [key]: { grams, kind: guessPiece(name)?.kind ?? 'piece', at: new Date().toISOString() } };
  const entries = Object.entries(remembered);
  if (entries.length > MAX_REMEMBERED) remembered = Object.fromEntries(entries.slice(-MAX_REMEMBERED));
  await AsyncStorage.setItem(PIECE_WEIGHTS_KEY, JSON.stringify(remembered)).catch(() => undefined);
}

/** Weights set on another device arrive with its meals; the newest one wins. */
export async function adoptPieceWeights(meals: Meal[]) {
  await loadPieceWeights();
  let changed = false;
  for (const meal of meals) {
    for (const item of meal.items) {
      const own = item.portions?.find((portion) => portion.own);
      if (!own) continue;
      const key = pieceKey(item.name, item.source.referenceId);
      const known = remembered[key];
      if (known?.grams === own.grams || (known?.at && meal.savedAt && known.at >= meal.savedAt)) continue;
      remembered = { ...remembered, [key]: { grams: own.grams, kind: guessPiece(item.name)?.kind ?? 'piece', at: meal.savedAt } };
      changed = true;
    }
  }
  if (changed) await AsyncStorage.setItem(PIECE_WEIGHTS_KEY, JSON.stringify(remembered)).catch(() => undefined);
}

const PACKAGE_WORD = /packung|package|\bpack\b/i;
const GENERIC_SERVING = /^\s*(?:1\s+)?(?:portion|serving)\b|^\s*\d/i;

/**
 * The amounts offered for a food, friendliest first: the weight the person
 * set, then what the source publishes, then a typical piece marked as an
 * estimate. A pack size alone is not a piece; nobody eats a whole cheese pack.
 */
export function piecePortions(name: string, portions: FoodPortion[] = [], key = pieceKey(name)): FoodPortion[] {
  if (portions.some((portion) => portion.unitOnly)) return portions;
  const own = remembered[key];
  if (own) return [{ label: pieceLabel(own.kind), grams: own.grams, own: true }, ...portions.filter((portion) => Math.abs(portion.grams - own.grams) > 0.5)];
  const guess = guessPiece(name);
  const serving = portions.find((portion) => !PACKAGE_WORD.test(portion.label));
  // "36 g" or "1 Portion" of a sliced cheese is one slice with a real weight.
  if (serving) return guess && GENERIC_SERVING.test(serving.label) ? portions.map((portion) => portion === serving ? { ...portion, label: pieceLabel(guess.kind) } : portion) : portions;
  // A small pack of something counted in pieces is one piece: a real weight beats a typical one.
  const pack = portions.find((portion) => PACKAGE_WORD.test(portion.label));
  if (guess?.kind === 'piece' && pack && pack.grams <= SINGLE_PIECE_MAX_G) return [{ label: pieceLabel(guess.kind), grams: pack.grams }];
  return guess ? [{ label: pieceLabel(guess.kind), grams: guess.grams, estimated: true }, ...portions] : portions;
}

export const isPackPortion = (portion: FoodPortion) => PACKAGE_WORD.test(portion.label);

/** "Scheibe" from "1 Scheibe" or "1 Scheibe (25 g)"; a bare "25 g" serving is a portion. */
export function portionName(label: string) {
  const name = label.replace(/\s*\([^)]*\)\s*$/, '').replace(/^1\s+/, '').trim();
  return /^\d/.test(name) || !name ? getDictionary().scan.portionServing.replace(/^1\s+/, '') : name;
}
