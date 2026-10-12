import { getDictionary, getLanguage } from '@/i18n/active';
import type { FoodSearchResult } from '@/services/mealAnalysis';
import type { Meal } from '@/types/nutrition';

/**
 * Instant, on-device food suggestions while typing ("haf" → Haferflocken).
 *
 * The same reviewed 7,140-row BLS 4.0 snapshot the gateway searches ships in
 * the bundle, so the first answer needs no network, no quota and no debounce.
 * The gateway's full search (brands, Open Food Facts, USDA) is merged in
 * afterwards by the caller. Values are the unchanged BLS per-100 g figures.
 */
type Row = readonly [string, string, string, number, number, number, number, number];
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BLS_SEARCH_ROWS } = require('../../supabase/functions/_shared/bls-search-data.mjs') as { BLS_SEARCH_ROWS: readonly Row[] };
// The gateway's reviewed catalogue ranking (typos, multi-word, preparation
// words) runs here too, offline, so local answers never fall below it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { searchBlsCatalog } = require('../../supabase/functions/_shared/bls-search.mjs') as { searchBlsCatalog: (query: string, language: string, limit: number) => { code: string }[] };
// Reuse only reviewed whole-term identities; never use a fuzzy suggestion as
// the automatic answer to a description with a raw/cooked or grain qualifier.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveReviewedStapleFacts } = require('../../supabase/functions/_shared/bls-reference.mjs') as { resolveReviewedStapleFacts: (query: string) => { referenceId: string } | null };
// "Hühnchen" → Hähnchen, "Jogurt" → Joghurt, "Topfen" → Quark: the same
// reviewed spelling table the gateway catalogue uses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyFoodSynonyms } = require('../../supabase/functions/_shared/food-synonyms.mjs') as { applyFoodSynonyms: (folded: string, language: string) => string };

// "Haehnchen" and "Hähnchen" are the same word: umlaut spellings fold to the
// same key on both sides (index and query), so ae/oe/ue typing still matches.
export const fold = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * Everyday foods people actually log, in rough order of how often. They lead
 * a suggestion list whenever they match, so "mil" means milk, not spleen, and
 * "kart" means potatoes before crisps. Explicit words still narrow the list.
 */
const EVERYDAY: readonly string[] = [
  'C133000', 'F503100', 'F110100', 'E111132', 'E111100', 'M111300', 'M111200', 'M141300', 'M141200', 'M710100', 'M713100',
  'B314000', 'B101000', 'B271000', 'B511000', 'C352032', 'C351032', 'E401032', 'X6A1010', 'K110100', 'V416172',
  'V416100', 'T410100', 'T121902', 'F502100', 'H880200', 'S120000', 'Q120000', 'Q611000', 'M402500', 'M304600',
  'M032100', 'M012200', 'M711100', 'M306400', 'G520100', 'G561100', 'G620100', 'G312100', 'G211100', 'G582100',
  'K701100', 'G480100', 'G760100', 'F603100', 'F301100', 'F310100', 'F304100', 'F302100', 'F516100', 'F501100',
  'F514100', 'F130100', 'F535100', 'N410100', 'N630000', 'N610100', 'N110000', 'F603600', 'F110600', 'N330000',
  'N331000', 'P163000', 'C660000', 'H841100', 'H800000', 'H861000', 'G770432', 'W424000', 'W140000', 'U010100',
  'D771600', 'K130262', 'Q991000', 'H210100', 'H120100', 'M173900', 'M710800', 'B111200', 'B314072', 'C512300',
  'X912033', 'Y921162',
];
const EVERYDAY_RANK = new Map(EVERYDAY.map((code, index) => [code, index]));

/**
 * Everyday words whose BLS rows only exist as compounds or technical names
 * ("Ei" → Hühnerei, "Nudeln" → Teigwaren, "Brot" → Vollkornbrot). Typing any
 * prefix of such a word ranks these rows first. Keys are folded (no umlauts).
 */
const RAW_ALIASES: Record<string, readonly string[]> = {
  ei: ['E111132', 'Y710142', 'E111100'], eier: ['E111132', 'Y710142', 'E111100'], egg: ['E111132', 'Y710142', 'E111100'], eggs: ['E111132', 'Y710142', 'E111100'], spiegelei: ['Y710142'], ruhrei: ['Y720143'],
  nudeln: ['E401032'], pasta: ['E401032'], spaghetti: ['E401032'], penne: ['E401032'], noodles: ['E401032'],
  brot: ['B101000', 'B271000', 'B314000'], bread: ['B101000', 'B271000', 'B314000'], toast: ['B314000', 'B314072', 'B111200'], toastbrot: ['B314000'],
  brotchen: ['B511000'], semmel: ['B511000'], schrippe: ['B511000'], roll: ['B511000'],
  kartoffeln: ['X6A1010', 'K110100'], kartoffel: ['X6A1010', 'K110100'], potato: ['X6A1010', 'K110100'], potatoes: ['X6A1010', 'K110100'], pommes: ['K130262'], fries: ['K130262'],
  reis: ['C352032', 'C351032'], rice: ['C352032', 'C351032'],
  milch: ['M111300', 'M111200'], milk: ['M111300', 'M111200'], hafermilch: ['C660000'], sojamilch: ['H841100'], mandelmilch: ['H800000'],
  quark: ['M713100'], magerquark: ['M713100'], hüttenkase: ['M711100'], huttenkase: ['M711100'], cottage: ['M711100'],
  kase: ['M402500', 'M304600', 'M032100'], cheese: ['M402500', 'M304600', 'M032100'], gouda: ['M402500'],
  hahnchen: ['V416172', 'V416100'], hanchen: ['V416172', 'V416100'], huhn: ['V416172'], chicken: ['V416172', 'V416100'], hahnchenbrust: ['V416172', 'V416100'],
  hack: ['U010100'], hackfleisch: ['U010100'], schinken: ['W424000'], ham: ['W424000'], salami: ['W140000'],
  brezel: ['B723000', 'X061410'], breze: ['B723000', 'X061410'], brezn: ['B723000', 'X061410'], laugenbrezel: ['B723000', 'X061410'], pretzel: ['B723000', 'X061410'], butterbrezel: ['X061410'],
  wurst: ['W211200', 'W222172', 'W231100'], wurstchen: ['W211200'], wiener: ['W211200'], bratwurst: ['W222172', 'Y021312'], sausage: ['W211200', 'W222172'],
  wasser: ['N110000'], water: ['N110000'], tee: ['N630000', 'N610100'], tea: ['N630000', 'N610100'], kaffee: ['N410100'], coffee: ['N410100'],
  bier: ['P163000'], beer: ['P163000'], saft: ['F603600', 'F110600'], juice: ['F603600', 'F110600'],
  joghurt: ['M141300', 'M141200'], jogurt: ['M141300', 'M141200'], yogurt: ['M141300', 'M141200'], yoghurt: ['M141300', 'M141200'],
  mandeln: ['H210100'], nusse: ['H210100', 'H120100'], nuts: ['H210100', 'H120100'], walnusse: ['H120100'],
  oel: ['Q120000'], ol: ['Q120000'], olivenol: ['Q120000'], oil: ['Q120000'],
  cola: ['N330000'], colazero: ['N331000'], colalight: ['N331000'], cokezero: ['N331000'], coke: ['N330000'],
  wein: ['P2A3000', 'P210000'], rotwein: ['P2A3000', 'P253000'], weisswein: ['P210000', 'P220000'], wine: ['P2A3000', 'P210000'], redwine: ['P2A3000'], whitewine: ['P210000'],
  salat: ['X201160', 'G105100', 'G103100'], salad: ['X201160', 'G105100'], kopfsalat: ['G105100'], eisbergsalat: ['G103100'], blattsalat: ['G105100'],
  paprika: ['G543100', 'G541100', 'G542100'], bellpepper: ['G543100', 'G541100'], gurke: ['G520100'], cucumber: ['G520100'], tomate: ['G561100'], tomaten: ['G561100'], tomato: ['G561100'],
  eiweiss: ['E113100'], eiklar: ['E113100'], eggwhite: ['E113100'], putenbrust: ['V486182', 'V486100'], pute: ['V486182'], turkey: ['V486182'],
  erdnussbutter: ['H880200'], peanutbutter: ['H880200'], banane: ['F503100'], banana: ['F503100'],
  musli: ['C512300'], muesli: ['C512300'], porridge: ['C133000'], oats: ['C133000'], oatmeal: ['C133000'], hafer: ['C133000', 'C660000'], haferflocken: ['C133000'],
};
// Everyday dishes rank first in search, with a realistic serving. They are
// deliberately not used to resolve free-text descriptions: "Pizza" there
// still goes to the analysis, because one pizza is not like another.
const RAW_DISH_ALIASES: Record<string, readonly string[]> = {
  bolognese: ['Y038213', 'E401032'], spaghettibolognese: ['Y038213', 'E401032'], lasagne: ['X730033'], lasagna: ['X730033'],
  pizza: ['X912033'], margherita: ['X912033'], doner: ['Y921162', 'Y921062'], döner: ['Y921162', 'Y921062'], kebab: ['Y921162', 'Y921062'],
  currywurst: ['Y943032', 'Y944062'], chili: ['X469753'], chiliconcarne: ['X469753'], schnitzel: ['Y231322'], wienerschnitzel: ['Y231322'],
  burger: ['Y911060', 'Y911160'], hamburger: ['Y911060'], cheeseburger: ['Y911160'],
};
const DISH_ALIASES: Record<string, readonly string[]> = Object.fromEntries(Object.entries(RAW_DISH_ALIASES).map(([key, codes]) => [fold(key).replace(/ /g, ''), codes]));
// Plain foods that a dish alias also lists (pasta for bolognese) stay matchable.
const DISH_CODES = new Set(Object.values(RAW_DISH_ALIASES).flat().filter(code => !Object.values(RAW_ALIASES).some(codes => codes.includes(code))));
function aliasCodes(query: string) {
  const codes = new Map<string, number>();
  // "ei weiß" and "hafer milch" mean the compound word.
  const joined = query.replace(/ /g, '');
  if (joined.length < 2 || query.split(' ').length > 2) return codes;
  query = joined;
  for (const [word, list] of [...Object.entries(ALIASES), ...Object.entries(DISH_ALIASES)]) {
    // Two letters only match a whole word ("ei" is egg, not Eisbergsalat).
    if (!word.startsWith(query) || (query.length < 3 && word !== query)) continue;
    list.forEach((code, position) => {
      const strength = 12 - position - (word.length - query.length) * 0.2;
      codes.set(code, Math.max(codes.get(code) ?? 0, strength));
    });
  }
  return codes;
}

/** Typical household portions, always labelled as estimates and editable. */
type PortionKind = 'piece' | 'slice' | 'glass' | 'cup' | 'pot' | 'can' | 'bottle' | 'tbsp' | 'tsp' | 'portion' | 'fillet' | 'ball' | 'egg' | 'half';
// Keys fold exactly like typed queries (ä/ae, ö/oe, ü/ue, ß/ss).
const ALIASES: Record<string, readonly string[]> = Object.fromEntries(Object.entries(RAW_ALIASES).map(([key, codes]) => [fold(key).replace(/ /g, ''), codes]));

const PORTIONS: Record<string, readonly (readonly [PortionKind, number])[]> = {
  F503100: [['piece', 120]], F110100: [['piece', 150]], F603100: [['piece', 150]], F130100: [['piece', 160]], F514100: [['piece', 75]],
  F502100: [['half', 70]], G561100: [['piece', 80]], G620100: [['piece', 60]], E111100: [['egg', 58]], E111132: [['egg', 58]], Y710142: [['egg', 62]],
  B314000: [['slice', 25]], B314072: [['slice', 22]], B111200: [['slice', 25]], B101000: [['slice', 50]], B271000: [['slice', 50]], B511000: [['piece', 60]],
  D771600: [['piece', 60]], C133000: [['portion', 40], ['tbsp', 10]], C512300: [['portion', 50]],
  M111300: [['glass', 200]], M111200: [['glass', 200]], C660000: [['glass', 200]], H841100: [['glass', 200]], H800000: [['glass', 200]],
  M141300: [['pot', 150]], M141200: [['pot', 150]], M710100: [['pot', 150]], M713100: [['pot', 250]], M711100: [['pot', 200]],
  N410100: [['cup', 200]], N630000: [['cup', 250]], N610100: [['cup', 250]], N110000: [['glass', 250]],
  F603600: [['glass', 200]], F110600: [['glass', 200]], N330000: [['can', 330], ['glass', 250]], N331000: [['can', 330], ['glass', 250]], P163000: [['bottle', 330]],
  P2A3000: [['glass', 200]], P210000: [['glass', 200]], P253000: [['glass', 200]], P220000: [['glass', 200]], G543100: [['piece', 160]], G541100: [['piece', 160]], G542100: [['piece', 160]], G520100: [['piece', 400]], X201160: [['portion', 150]], E113100: [['egg', 33]], V486182: [['fillet', 150]],
  Y038213: [['portion', 150]], X730033: [['portion', 350]], X912033: [['piece', 350], ['slice', 90]], Y921162: [['piece', 400]], Y921062: [['piece', 400]], Y943032: [['portion', 250]], Y944062: [['portion', 450]], X469753: [['portion', 350]], Y231322: [['piece', 150]], Y911060: [['piece', 110]], Y911160: [['piece', 120]],
  Q611000: [['tsp', 5]], H880200: [['tbsp', 15]], S120000: [['tsp', 8]], Q120000: [['tbsp', 10]],
  M402500: [['slice', 25]], M304600: [['slice', 20]], W424000: [['slice', 20]], W140000: [['slice', 10]], M032100: [['ball', 125]],
  C352032: [['portion', 150]], C351032: [['portion', 150]], E401032: [['portion', 180]], X6A1010: [['portion', 200], ['piece', 80]], K110100: [['portion', 200], ['piece', 80]],
  V416172: [['fillet', 150]], V416100: [['fillet', 150]], T410100: [['fillet', 125]],
};

function portionLabels(): Record<PortionKind, string> {
  const t = getDictionary().scan;
  return { piece: t.portionPiece, slice: t.portionSlice, glass: t.portionGlass, cup: t.portionCup, pot: t.portionPot, can: t.portionCan, bottle: t.portionBottle, tbsp: t.portionTbsp, tsp: t.portionTsp, portion: t.portionServing, fillet: t.portionFillet, ball: t.portionBall, egg: t.portionEgg, half: t.portionHalf };
}

// Qualifiers that rarely describe what someone ate today unless they say so.
const NICHE = /\b(glutenfrei|gluten free|laktosefrei|lactose free|pulver|powder|getrocknet|dried|konserve|canned|tiefgefroren|deep frozen|innereien|offal|leber|liver|herz|heart|milz|spleen|niere|kidney|zunge|tongue|e \d{3}|saure|acid|mehl|flour|starke|starch|grie|semolina|schrot|kleie|bran)/;

type Entry = { row: Row; de: string; en: string; deWords: string[]; enWords: string[] };
let index: Entry[] | null = null;
let byCode: Map<string, Row> | null = null;
function rowsByCode() {
  byCode ??= new Map(BLS_SEARCH_ROWS.map(row => [row[0], row]));
  return byCode;
}
function entries() {
  index ??= BLS_SEARCH_ROWS.map(row => {
    const de = fold(row[1]); const en = fold(row[2]);
    return { row, de, en, deWords: de.split(' '), enWords: en.split(' ') };
  });
  return index;
}

/** Strength with which one typed token matches a name: 0 = no match. */
function tokenScore(token: string, name: string, words: string[]) {
  // "egg-free"/"eifrei" is the opposite of what someone typing "egg" wants.
  const stem = token.endsWith('s') ? token.slice(0, -1) : token;
  if (name.includes(`${token} free`) || name.includes(`${stem} free`) || words.includes(`${token}frei`)) return 0;
  if (words.some(word => word === token || sameWord(token, word))) return 4;
  if (words.some(word => word.startsWith(token))) return 3;
  // Compound words: "toast" in "weizentoastbrot", "milch" in "vollmilch".
  // Never shorter fragments: "oil" must not match inside "boiled".
  if (token.length >= 4 && name.includes(token)) return 2.5;
  return 0;
}

export type FoodUsage = { count: number; lastGrams: number; lastAt: string };

/** How often and with what amount each BLS food was logged. */
export function foodUsage(history: Meal[]): Map<string, FoodUsage> {
  const usage = new Map<string, FoodUsage>();
  for (const meal of history) {
    for (const item of meal.items ?? []) {
      if (!item.included || item.source?.provider !== 'bls' || !item.source.referenceId) continue;
      const at = meal.savedAt ?? meal.date ?? '';
      const previous = usage.get(item.source.referenceId);
      usage.set(item.source.referenceId, {
        count: (previous?.count ?? 0) + 1,
        lastGrams: !previous || at >= previous.lastAt ? item.amountG : previous.lastGrams,
        lastAt: !previous || at >= previous.lastAt ? at : previous.lastAt,
      });
    }
  }
  return usage;
}

// BLS splits a few everyday compounds ("Hafer Flocken"). Shown as people write
// them; matching already treats both spellings as the same food.
function displayGerman(name: string) {
  return name.replace(/^Hafer ([A-ZÄÖÜ][a-zäöüß]+)/, (_match: string, rest: string) => `Hafer${rest.toLowerCase()}`);
}

function toResult(row: Row, language: string, usage?: FoodUsage): FoodSearchResult {
  const labels = portionLabels();
  const [code, nameDe, nameEn, calories, protein, carbs, fat, fiber] = row;
  const portions = (PORTIONS[code] ?? []).map(([kind, grams]) => ({ label: labels[kind], grams, estimated: true, kind }));
  return {
    id: `bls-${code}`,
    name: language === 'de' ? displayGerman(nameDe) : nameEn,
    per100g: { calories, protein, carbs, fat, fiber },
    defaultGrams: usage?.lastGrams ?? portions[0]?.grams ?? 100,
    portions,
    source: { provider: 'bls', referenceId: code, label: `BLS 4.0 ${code}` },
    ...(usage ? { lastGrams: usage.lastGrams } : {}),
  };
}

/** Ranked suggestions for a partly typed query; synchronous, about 10 ms. */
export function suggestFoods(query: string, usage: Map<string, FoodUsage> = new Map(), limit = 25): FoodSearchResult[] {
  const typed = fold(query).split(' ').filter(Boolean);
  if (!typed.length || typed.join('').length < 2) return [];
  const language = getLanguage();
  // Everyday spellings become the label's words; aliases of what was actually
  // typed ("nudeln", "hähnchenbrust") keep their reviewed everyday rows.
  const tokens = fold(applyFoodSynonyms(typed.join(' '), language)).split(' ').filter(Boolean);
  const scored: { entry: Entry; score: number }[] = [];
  const aliases = aliasCodes(typed.join(' '));
  for (const [code, strength] of aliasCodes(tokens.join(' '))) aliases.set(code, Math.max(aliases.get(code) ?? 0, strength));
  for (const entry of entries()) {
    let total = aliases.get(entry.row[0]) ?? 0;
    let ok = true;
    for (const token of tokens) {
      const local = language === 'de' ? tokenScore(token, entry.de, entry.deWords) : tokenScore(token, entry.en, entry.enWords);
      const other = language === 'de' ? tokenScore(token, entry.en, entry.enWords) : tokenScore(token, entry.de, entry.deWords);
      let best = Math.max(local, other * 0.8);
      // In multi-word queries a one/two-letter word must be a whole word or an
      // everyday alias: "ei gekocht" is a boiled egg, not "Teigwaren eifrei".
      if (tokens.length > 1 && token.length <= 2 && best < 4 && !(ALIASES[token] ?? []).includes(entry.row[0])) best = 0;
      if (!best && !aliases.has(entry.row[0])) { ok = false; break; }
      total += best;
    }
    if (!ok) continue;
    const name = language === 'de' ? entry.de : entry.en;
    const words = language === 'de' ? entry.deWords : entry.enWords;
    const code = entry.row[0];
    if (words[0]?.startsWith(tokens[0])) total += 3;
    if (name.startsWith(tokens.join(' '))) total += 2;
    const rank = EVERYDAY_RANK.get(code);
    if (rank !== undefined) total += 6 - rank / 40;
    const used = usage.get(code);
    if (used) total += 8 + Math.min(used.count, 10) * 0.5;
    if (NICHE.test(name) && !tokens.some(token => NICHE.test(token))) total -= 3;
    if (/^[XY]/.test(code)) total -= 1;
    total -= name.length / 60 + (name.match(/ /g)?.length ?? 0) * 0.05;
    scored.push({ entry, score: total });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.row[1].localeCompare(b.entry.row[1]));
  // A confident everyday/alias/history hit leads; otherwise the reviewed
  // catalogue ranking leads and local prefix matches follow. The catalogue
  // pass is the expensive part, so short confident prefixes skip it.
  const confident = (scored[0]?.score ?? 0) >= 10;
  const needsCatalogue = !confident || tokens.length > 1 || tokens[0].length >= 5;
  const rows = rowsByCode();
  const reviewed = resolveReviewedStapleFacts(query);
  const reviewedRow = reviewed ? rows.get(reviewed.referenceId) : undefined;
  const catalog = needsCatalogue
    ? searchBlsCatalog(query, language, limit).map(food => rows.get(food.code)).filter((row): row is Row => Boolean(row))
    : [];
  const ordered = confident
    ? [...scored.slice(0, 3).map(item => item.entry.row), ...catalog, ...scored.slice(3).map(item => item.entry.row)]
    : [...catalog, ...scored.map(item => item.entry.row)];
  const seen = new Set<string>();
  const out: FoodSearchResult[] = [];
  // An exact reviewed kind/preparation leads even when another pasta kind
  // was used more often. Keep the original source label and editable amount.
  for (const row of [...(reviewedRow ? [reviewedRow] : []), ...ordered]) {
    if (seen.has(row[0])) continue;
    seen.add(row[0]);
    out.push(toResult(row, language, usage.get(row[0])));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Recently eaten foods for the empty search field, newest first. Non-BLS
 * foods (barcode/Open Food Facts/USDA) are included when their per-100 g
 * reference was stored with the meal.
 */
export function recentFoods(history: Meal[], limit = 12): FoodSearchResult[] {
  const language = getLanguage();
  const rows = rowsByCode();
  const usage = foodUsage(history);
  const seen = new Set<string>();
  const out: FoodSearchResult[] = [];
  const meals = [...history].sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  for (const meal of meals) {
    for (const item of meal.items ?? []) {
      if (out.length >= limit) return out;
      if (!item.included) continue;
      const ref = item.source?.referenceId;
      if (item.source?.provider === 'bls' && ref && rows.has(ref)) {
        if (seen.has(`bls-${ref}`)) continue;
        seen.add(`bls-${ref}`);
        out.push(toResult(rows.get(ref)!, language, usage.get(ref)));
      } else if (item.nutritionPer100g && ref && ['open-food-facts', 'usda', 'manual'].includes(item.source.provider)) {
        // Own entries repeat by name, not by their one-off id; a saved
        // product ("Mein Produkt") keeps its own stable id.
        const key = item.source.provider === 'manual' && !ref.startsWith('custom-') ? `manual-${fold(item.name)}` : `${item.source.provider}-${ref}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: key, name: item.name, per100g: item.nutritionPer100g, defaultGrams: item.amountG, portions: item.portions ?? [], source: item.source, lastGrams: item.amountG });
      }
    }
  }
  return out;
}

/**
 * Keys that identify the same food across sources: the reference itself, a
 * barcode shared by an own product and Open Food Facts, and the visible
 * name with its energy (the same product listed twice under two codes).
 */
function sameFoodKeys(result: FoodSearchResult) {
  const keys = [result.source.referenceId ?? result.id];
  if (result.source.provider === 'open-food-facts' && result.source.referenceId) keys.push(`barcode-${result.source.referenceId}`);
  if (result.barcode) keys.push(`barcode-${result.barcode}`);
  if (typeof result.name === 'string' && Number.isFinite(result.per100g?.calories)) keys.push(`name-${fold(result.name)}-${Math.round(result.per100g.calories)}`);
  return keys;
}

/** Local suggestions first, then the gateway's extra rows without duplicates. */
export function mergeSuggestions(local: FoodSearchResult[], remote: FoodSearchResult[]) {
  const seen = new Set<string>();
  const out: FoodSearchResult[] = [];
  for (const result of [...local, ...remote]) {
    const keys = sameFoodKeys(result);
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    out.push(result);
  }
  return out;
}

/** Which database a row comes from, for the badge beside it. */
export type FoodSourceBadge = 'bls' | 'off' | 'usda' | 'custom' | 'own' | 'catalog';
export function foodSourceBadge(result: Pick<FoodSearchResult, 'source'>): FoodSourceBadge {
  switch (result.source.provider) {
    case 'bls': return 'bls';
    case 'open-food-facts': return 'off';
    case 'usda': return 'usda';
    case 'manual': return result.source.referenceId?.startsWith('custom-') ? 'custom' : 'own';
    default: return 'catalog';
  }
}

/**
 * Foods eaten at least twice, most often first (ties: most recent), for the
 * empty search field. Any source with a stored per-100 g reference counts.
 */
export function frequentFoods(history: Meal[], limit = 6): FoodSearchResult[] {
  const recents = recentFoods(history, 200);
  const counts = new Map<string, { count: number; lastAt: string }>();
  for (const meal of history) {
    for (const item of meal.items ?? []) {
      if (!item.included || !item.source?.referenceId) continue;
      const ref = item.source.referenceId;
      const key = item.source.provider === 'bls' ? `bls-${ref}` : item.source.provider === 'manual' && !ref.startsWith('custom-') ? `manual-${fold(item.name)}` : `${item.source.provider}-${ref}`;
      const at = meal.savedAt ?? meal.date ?? '';
      const previous = counts.get(key);
      counts.set(key, { count: (previous?.count ?? 0) + 1, lastAt: previous && previous.lastAt > at ? previous.lastAt : at });
    }
  }
  return recents
    .filter(result => (counts.get(result.id)?.count ?? 0) >= 2)
    .sort((a, b) => (counts.get(b.id)!.count - counts.get(a.id)!.count) || counts.get(b.id)!.lastAt.localeCompare(counts.get(a.id)!.lastAt))
    .slice(0, limit);
}

/** Plural/inflection-tolerant exact word comparison ("bananen" = "banane"). */
function sameWord(token: string, word: string) {
  if (token === word) return true;
  for (const suffix of ['n', 'en', 'e', 's', 'es', 'er']) if (token.length > suffix.length + 2 && token.endsWith(suffix) && token.slice(0, -suffix.length) === word) return true;
  return false;
}

/**
 * The one food a short phrase unambiguously names, or null. Stricter than
 * suggestions: every word must be a whole word of the food's name (or a
 * reviewed everyday alias), so "Brot" never silently becomes "Brotfrucht".
 */
export function matchFood(query: string, usage: Map<string, FoodUsage> = new Map()): FoodSearchResult | null {
  const tokens = fold(query).split(' ').filter(Boolean);
  if (!tokens.length || tokens.length > 5) return null;
  const language = getLanguage();
  const rows = rowsByCode();
  const staple = resolveReviewedStapleFacts(query);
  if (staple && rows.has(staple.referenceId)) {
    const result = toResult(rows.get(staple.referenceId)!, language, usage.get(staple.referenceId));
    return { ...result, source: { ...result.source, estimatedReference: true } };
  }
  const joined = tokens.join('');
  const alias = ALIASES[joined] ?? (tokens.length === 1 ? ALIASES[tokens[0].replace(/(n|en|e|s)$/, '')] : undefined);
  if (alias?.length && rows.has(alias[0])) {
    // Prefer the alias food the user logged before, e.g. their usual milk.
    const preferred = alias.find(code => usage.has(code)) ?? alias[0];
    return toResult(rows.get(preferred)!, language, usage.get(preferred));
  }
  // Plurals: "bananen" must also look up "banane".
  const variants = new Set([tokens.join(' ')]);
  for (const suffix of ['n', 'en', 'e', 's']) {
    variants.add(tokens.map(token => token.length > suffix.length + 3 && token.endsWith(suffix) ? token.slice(0, -suffix.length) : token).join(' '));
  }
  const candidates = [...variants].flatMap(variant => suggestFoods(variant, usage, 15));
  // Among whole-word matches, the plainest food wins: "Bananen" is "Banane
  // roh", not "Bananen im Ausbackteig frittiert". Raw/cooked tags are free.
  const plainTags = new Set(['roh', 'raw', 'frisch', 'fresh', 'gekocht', 'boiled', 'cooked', 'pasteurisiert', 'pasteurised']);
  let best: { result: FoodSearchResult; extra: number; order: number } | null = null;
  candidates.forEach((candidate, order) => {
    const entry = rows.get(candidate.source.referenceId ?? '');
    if (!entry || DISH_CODES.has(entry[0])) return;
    const words = fold(language === 'de' ? entry[1] : entry[2]).split(' ');
    if (!tokens.every(token => words.some(word => sameWord(token, word)))) return;
    const extra = words.filter(word => !tokens.some(token => sameWord(token, word)) && !plainTags.has(word)).length
      - (EVERYDAY_RANK.has(entry[0]) ? 2 : 0);
    if (!best || extra < best.extra || (extra === best.extra && order < best.order)) best = { result: candidate, extra, order };
  });
  return (best as { result: FoodSearchResult } | null)?.result ?? null;
}
