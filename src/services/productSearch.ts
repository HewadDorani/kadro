/**
 * Store and brand awareness for the food search.
 *
 * People search the way the shelf is labelled: "lidl skyr" means Milbona,
 * "aldi milch" means Milsani, "ja! haferflocken" is Rewe. The product search
 * receives the matching brand names as a hint, and a query that names a store
 * or brand shows "Produkte & Marken" before the generic foods.
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
// Brand names are proper nouns, kept as data (src/data/storeBrands.json).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DATA = require('../data/storeBrands.json') as StoreBrandData;
export const STORE_BRANDS: Readonly<Record<string, readonly string[]>> = DATA.stores;
const STORE_WORDS = DATA.storeWords;
const MANUFACTURER_BRANDS = DATA.manufacturers;
const BRAND_ALIASES = DATA.aliases;

/** Lowercase, no accents, ß → ss, ä/ae fold together; punctuation becomes spaces. */
export function foldBrand(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();
}

const OWN_BRAND_STORE = new Map<string, string>();
for (const [store, brands] of Object.entries(STORE_BRANDS)) for (const brand of brands) OWN_BRAND_STORE.set(foldBrand(brand), store);
const BRAND_DISPLAY = new Map<string, string>();
for (const brand of [...Object.values(STORE_BRANDS).flat(), ...MANUFACTURER_BRANDS]) if (!BRAND_DISPLAY.has(foldBrand(brand))) BRAND_DISPLAY.set(foldBrand(brand), brand);
for (const [alias, brand] of Object.entries(BRAND_ALIASES)) BRAND_DISPLAY.set(alias, brand);

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
 * What the query says about stores and brands. "lidl skyr" → all Lidl food
 * own-brands; "milbona skyr" → Milbona; "gut & günstig donut" → Gut & Günstig.
 * Longest match wins, so "rewe beste wahl" is the brand, not just the store.
 */
export function productSearchHint(query: string): ProductSearchHint {
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
export function productsFirst(query: string, genericCount: number, productCount: number) {
  return productSearchHint(query).brandQuery || (genericCount === 0 && productCount > 0);
}
