import type { MarketRegion } from '@/services/region';

/**
 * Store and brand awareness for the food search, per shopping market.
 *
 * People search the way the shelf is labelled: "lidl skyr" means Milbona,
 * "aldi milch" means Milsani, "ja! haferflocken" is Rewe; in the UK "tesco"
 * means Tesco, Tesco Finest, Stockwell & Co …, in the US "costco" means
 * Kirkland Signature. The product search receives the matching brand names as
 * a hint, and a query that names a store or brand shows "Produkte & Marken"
 * before the generic foods. The market (src/services/region.ts) decides which
 * chains exist: "aldi" is Milsani in Germany and Cowbelle in the UK.
 *
 * Only food own-brands we are sure about are listed; a wrong mapping would
 * send people to another chain's product. Pure module: no network, no state.
 */

type StoreBrandData = {
  /** Store → its food own-brands (display spelling, as printed on the pack); the first entry is the store itself. */
  stores: Record<string, string[]>;
  /** Typed spellings of a store ("aldi sud", folded) → the store key. */
  storeWords: Record<string, string>;
  /** Manufacturer brands people search by name. Not exhaustive: it only decides which section leads. */
  manufacturers: string[];
  /** Other ways people type a brand (folded) → the printed spelling. */
  aliases: Record<string, string>;
};
// Brand names are proper nouns, kept as data (src/data/storeBrands*.json).
/* eslint-disable @typescript-eslint/no-var-requires */
const DATA: Record<MarketRegion, StoreBrandData> = {
  de: require('../data/storeBrands.json') as StoreBrandData,
  gb: require('../data/storeBrands.gb.json') as StoreBrandData,
  us: require('../data/storeBrands.us.json') as StoreBrandData,
};
/* eslint-enable @typescript-eslint/no-var-requires */
/** Store → own brands per market. */
export const STORE_BRANDS_BY_REGION: Readonly<Record<MarketRegion, Readonly<Record<string, readonly string[]>>>> = {
  de: DATA.de.stores, gb: DATA.gb.stores, us: DATA.us.stores,
};
/** The German (DE/AT/CH) store brands. */
export const STORE_BRANDS = STORE_BRANDS_BY_REGION.de;

/** Lowercase, no accents, ß → ss, ä/ae fold together; punctuation becomes spaces. */
export function foldBrand(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();
}

type MarketIndex = {
  stores: Readonly<Record<string, readonly string[]>>;
  storeWords: Record<string, string>;
  ownBrandStore: Map<string, string>;
  brandDisplay: Map<string, string>;
};
const INDEX = {} as Record<MarketRegion, MarketIndex>;
for (const region of ['de', 'gb', 'us'] as const) {
  const data = DATA[region];
  const ownBrandStore = new Map<string, string>();
  for (const [store, brands] of Object.entries(data.stores)) for (const brand of brands) ownBrandStore.set(foldBrand(brand), store);
  const brandDisplay = new Map<string, string>();
  for (const brand of [...Object.values(data.stores).flat(), ...data.manufacturers]) if (!brandDisplay.has(foldBrand(brand))) brandDisplay.set(foldBrand(brand), brand);
  // Keys are folded like the query ("trader joes" → "trader jos"), so the data can be written plainly.
  for (const [alias, brand] of Object.entries(data.aliases)) brandDisplay.set(foldBrand(alias), brand);
  const storeWords = Object.fromEntries(Object.entries(data.storeWords).map(([word, store]) => [foldBrand(word), store]));
  INDEX[region] = { stores: data.stores, storeWords, ownBrandStore, brandDisplay };
}

export type ProductSearchHint = {
  /** The query names a store or a brand: products lead the result list. */
  brandQuery: boolean;
  /** Brand names to send as the `brands` hint; empty when none applies. */
  brands: string[];
  /** The store the query named, when one did. */
  store?: string;
};

/** Whole-word containment on folded text ("ja" must not match "jasmin"). */
const containsWords = (folded: string, words: string) => ` ${folded} `.includes(` ${words} `);

/**
 * What the query says about stores and brands in the given market. "lidl
 * skyr" → all Lidl food own-brands; "milbona skyr" → Milbona; "gut & günstig
 * donut" → Gut & Günstig; in 'gb' "tesco" → Tesco's own brands. Longest match
 * wins, so "rewe beste wahl" is the brand, not just the store.
 */
export function productSearchHint(query: string, region: MarketRegion = 'de'): ProductSearchHint {
  const { stores: STORE_BRANDS, storeWords: STORE_WORDS, ownBrandStore: OWN_BRAND_STORE, brandDisplay: BRAND_DISPLAY } = INDEX[region] ?? INDEX.de;
  const folded = foldBrand(query);
  if (folded.replace(/ /g, '').length < 2) return { brandQuery: false, brands: [] };
  const brands: string[] = [];
  let store: string | undefined;
  const brandMatches = [...BRAND_DISPLAY.keys()].filter(key => key && containsWords(folded, key)).sort((a, b) => b.length - a.length);
  const covered: string[] = [];
  for (const key of brandMatches) {
    // "rewe bio" already covers "rewe".
    if (covered.some(longer => containsWords(longer, key))) continue;
    covered.push(key);
    const display = BRAND_DISPLAY.get(key)!;
    const ownStore = OWN_BRAND_STORE.get(foldBrand(display));
    // A bare store name stands for all of its own brands.
    if (ownStore && STORE_BRANDS[ownStore][0] === display) {
      store = ownStore;
      brands.push(...STORE_BRANDS[ownStore]);
    } else {
      brands.push(display);
    }
  }
  const storeWord = Object.keys(STORE_WORDS).sort((a, b) => b.length - a.length).find(word => containsWords(folded, word));
  if (storeWord && !covered.some(key => containsWords(key, storeWord))) {
    store = STORE_WORDS[storeWord];
    brands.push(...STORE_BRANDS[store]);
  }
  const unique = [...new Set(brands)];
  return { brandQuery: unique.length > 0, brands: unique, ...(store ? { store } : {}) };
}

/**
 * Whether "Produkte & Marken" leads: the query names a store/brand, or the
 * generic catalogue has nothing while products do.
 */
export function productsFirst(query: string, genericCount: number, productCount: number, region: MarketRegion = 'de') {
  return productSearchHint(query, region).brandQuery || (genericCount === 0 && productCount > 0);
}
