export type PieceKind = 'piece' | 'slice' | 'egg' | 'tbsp';
export type PieceGuess = { kind: PieceKind; grams: number };

/**
 * Typical weight of one piece of a packaged food, for products whose source
 * only knows 100 g. Order matters: the narrower word wins ("Knäckebrot" before
 * "Brot", "Käsebrötchen" before "Käse"). Always shown as an estimate with "~"
 * and corrected once by the person; these are weights, never nutrition values.
 */
const PIECE_WEIGHTS: readonly (readonly [RegExp, PieceKind, number])[] = [
  [/knäcke|crispbread|reiswaffel|rice cake/, 'slice', 10],
  [/brötchen|semmel|baguettebrötchen|\bbuns?\b|bread rolls?/, 'piece', 60],
  [/toast|sandwichbrot|sandwich bread/, 'slice', 28],
  [/\bbrot\b|vollkornbrot|roggenbrot|mischbrot|\bbread\b/, 'slice', 45],
  [/wrap|tortilla/, 'piece', 40],
  [/gouda|edamer|emmentaler|butterkäse|tilsiter|maasdamer|leerdammer|cheddar|käsescheib|scheibletten|cheese slices?/, 'slice', 25],
  [/mozzarella/, 'piece', 125],
  [/salami|chorizo|pepperoni/, 'slice', 8],
  [/schinken|mortadella|lyoner|aufschnitt|putenbrust|\bham\b|turkey slices?/, 'slice', 20],
  [/würstchen|wiener|bockwurst|frankfurter|sausages?/, 'piece', 50],
  [/\beier\b|\bei\b|\beggs?\b/, 'egg', 58],
  [/riegel|protein bar|\bbars?\b/, 'piece', 45],
  [/fischstäbchen|fish fingers?/, 'piece', 30],
  [/nuggets?/, 'piece', 18],
  [/frikadelle|bulette|burger patty|patties/, 'piece', 100],
  [/kartoffelpuffer|rösti|hash browns?/, 'piece', 50],
  [/zwieback|rusk/, 'slice', 10],
  [/pfannkuchen|pancake|waffel|waffle/, 'piece', 50],
  [/gyoza|maultasche|dumpling/, 'piece', 20],
  [/praline/, 'piece', 12],
  [/keks|cookie|biscuit|cracker/, 'piece', 10],
  [/schokolade|chocolate/, 'piece', 6],
  [/muffin|donut|croissant/, 'piece', 70],
  [/nutella|aufstrich|nuss-?nougat|marmelade|konfitüre|honig|erdnussbutter|mandelmus|\bjam\b|honey|peanut butter|\bspread\b/, 'tbsp', 15],
];

export function guessPiece(name: string): PieceGuess | null {
  const text = name.toLowerCase();
  for (const [pattern, kind, grams] of PIECE_WEIGHTS) {
    if (pattern.test(text)) return { kind, grams };
  }
  return null;
}
