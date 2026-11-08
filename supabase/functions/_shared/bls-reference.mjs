/**
 * Curated German composite dishes from Bundeslebensmittelschlüssel (BLS) 4.0.
 *
 * Values are per 100 g. The compact snapshot keeps the deployed function small
 * and, more importantly, makes a known German dish deterministic: the model
 * identifies the dish and portion, but never invents its nutrient values.
 *
 * Source: Max Rubner-Institut, BLS 4.0 (2025), CC BY 4.0
 * DOI: https://doi.org/10.25826/Data20251217-134202-0
 */
import { BLS_SEARCH_ROWS } from './bls-search-data.mjs';
import { canonicalFoodQuery } from './food-query.mjs';
import { blsEnglishName } from './bls-names.mjs';

export const BLS_SOURCE = Object.freeze({
  name: 'Bundeslebensmittelschlüssel 4.0',
  version: '4.0 (2025)',
  license: 'CC BY 4.0',
  doi: '10.25826/Data20251217-134202-0',
  url: 'https://blsdb.de/download',
});

const rows = String.raw`
currywurst_pommes|Y944062|Currywurst mit Pommes frites|450|217|6.58|17.44|13.04|1.42
doner_chicken|Y921162|Döner Kebab mit Geflügel, Rohkost und Sauce|400|199|13.08|18|7.9|1.6
doner_beef|Y921062|Döner Kebab mit Kalb/Rind, Rohkost und Sauce|400|177|11.2|20|5.3|1.7
pizza_margherita|X912033|Pizza Margherita|350|238|7.77|20|13.55|1.9
pizza_funghi|X912133|Pizza Funghi|370|202|7.29|17|11.24|2
pizza_salame|X914133|Pizza Salami|380|251|9.6|16|16|1.7
pizza_tonno|X915233|Pizza Tonno|400|228|11.16|15|13.3|1.6
pizza_hawaii|X9A5010|Pizza Hawaii|380|207|9.89|17|10.52|1.6
pizza_prosciutto|X912412|Pizza Prosciutto|380|224|11.36|16|12.17|1.6
pizza_special|X9A5020|Pizza Spezial mit Schinken und Salami|400|247|12.98|15|14.48|1.5
lasagna_al_forno|X730033|Lasagne al forno|450|197|9.69|8.9|13.3|1.2
pasta_bolognese|X740433|Eierteigwaren mit Bologneser Sauce|450|164|8.3|13.9|8|1.2
wholegrain_pasta_bolognese|X702412|Vollkorn-Eierteigwaren mit Bologneser Sauce|450|166|9.16|9|9.8|2.2
kaesespaetzle|X711412|Käsespätzle|400|155|8|16.6|5.84|1.6
maultaschen_cooked|X760112|Schwäbische Maultaschen mit Hackfleisch, gegart|350|132|10.4|8.032|6.02|2.2
maultaschen_onions|X760312|Schwäbische Maultaschen mit gebratenen Zwiebeln|350|116|8.186|8.38|4.95|2.2
maultaschen_spinach|X7A3000|Maultaschen mit Spinatfüllung, gegart|350|96|4.4|13|2.53|1.7
pork_schnitzel_breaded|Y332132|Schweineschnitzel paniert, gebraten|200|220|22.65|7.59|10.6|0.69
turkey_schnitzel_breaded|Y583312|Putenschnitzel paniert, gebraten|200|204|22.72|7.07|9.1|0.63
currywurst_roll|Y943062|Currywurst mit Curryketchup und Brötchen|350|222|9.11|19.95|11.36|1.45
bratwurst_potato_salad|Y942132|Bratwurst mit Kartoffelsalat und Senf|450|188|5.6|6.43|15.2|1
meatball_potato_salad|Y912130|Frikadelle mit Kartoffelsalat und Senf|450|198|8.4|7.77|14.5|1.1
koenigsberger_klopse|Y036333|Königsberger Klopse mit Kapernsauce|400|140|9.4|3.52|9.7|0.4
beef_roulade_sauce|Y151112|Rinderroulade geschmort mit Sauce|300|133|12|1.8|8.5|0.4
goulash_soup|X456133|Ungarische Gulaschsuppe mit Rindfleisch und Kartoffeln|500|59|2.8|3|3.8|0.5
goulash_beef|Y1A1000|Gulasch mit Rindfleisch (keine Suppe)|300|124|12.95|4.2|5.9|1
goulash_pork|Y341023|Gulasch mit Schweinefleisch (keine Suppe)|300|150|18.2|0.6|8.3|0.2
chili_con_carne|X469753|Chili con carne mit Rinderhackfleisch|450|158|9.9|9|7.9|4.9
lentil_soup|X462513|Linsensuppe mit Gemüse|500|82|4.53|10|1.9|3.4
lentil_soup_sausage|X4A8050|Linsensuppe mit Gemüse und Wiener Würstchen|500|115|5.78|9|5.5|2.8
pea_soup_sausage|X464433|Erbsensuppe mit Speck und Wiener Würstchen|500|103|5.38|5|6.3|2.5
chicken_soup|X4A1020|Hühnersuppe mit Hühnerfleisch und Suppengemüse|500|56|5.5|0.4|3.5|0.5
potato_soup|X449613|Gebundene Kartoffelsuppe mit Gemüsebrühe|500|62|1.11|10|1.8|0.7
potato_soup_sausage|X450033|Kartoffelsuppe mit Gemüsebrühe und Brühwurst|500|93|2.95|8|5.4|0.5
tomato_soup|X444343|Gebundene Tomatensuppe|450|44|0.49|1.89|3.68|0.5
scrambled_eggs|Y720143|Rührei gebraten|180|203|12.88|0.39|16.61|0.1
fried_egg|Y710142|Spiegelei gebraten|120|210|13.419|0.353|17.193|0
omelette|Y730163|Omelett gebraten|200|197|12.23|0.66|16.21|0
potato_pancakes|X655022|Kartoffelpuffer oder Reibekuchen, gebraten|300|206|4.23|18.08|12.61|1.5
potato_gratin|X640053|Kartoffelgratin|350|128|3.42|15|5.77|1.14
pancakes|X925012|Ungesüßte Pfannkuchen mit Milch, gebraten|300|211|8.75|31.6|5|2.15
milk_rice_cinnamon|X810123|Milchreis mit Zucker und Zimt|400|142|4.83|23.2|3.18|0.6
semolina_pudding|X951113|Grießbrei gesüßt|400|100|4.29|12.94|3.39|0.35
porridge_milk|X9A2100|Ungesüßtes Porridge mit Vollmilch|350|134|6.29|15|4.9|2.232
muesli_yogurt_fruit|X092510|Ungesüßtes Müsli mit Joghurt und Früchten|350|117|5.03|12.7|4.3|2.4
bircher_muesli|X0A5000|Bircher-Müsli mit Apfel, Rosinen, Sahne und Nüssen|350|114|1.8|14.6|4.7|2.4
milk_rice_red_fruit|Y8A4080|Milchreis mit roter Grütze|400|123|3.8|20.7|2.4|1.2
apple_strudel|D540200|Apfelstrudel aus Strudelteig|180|220|3.3|30.4|8.6|3.5
berliner_jam|D7A6200|Berliner oder Krapfen mit Konfitüre|75|329|6.2|44|13.7|2.4
germknoedel|X985162|Germknödel mit Pflaumenmus und Mohn|250|287|7.13|41|9.7|3.33
dampfnudel|Y813442|Süße Dampfnudel, gebraten|250|348|7.67|42|16.05|2.53
hamburger|Y911060|Hamburger|220|190|10.01|19.72|7.31|1.7
cheeseburger|Y911160|Cheeseburger|250|202|10.6|18.1|9.1|1.5
chicken_wrap|Y599112|Wrap mit Salat und gebratener Hähnchenbrust|350|153|12.18|15.9|4.2|1.3
falafel_wrap|Y9A1060|Falafel im Fladenbrot mit vegetarischer Füllung|400|156|5.4|14|7.8|2.8
beef_burrito|X9A4000|Burrito mit Gemüse, Rinderhackfleisch und Käse|450|289|11.5|35|11|1.8
salmon_sushi|Y627112|Sushi mit Lachs|300|126|7.3|16.4|3.19|0.8
lahmacun_chicken|Y9A1080|Lahmacun mit Geflügel, Rohkost und Sauce|450|186|9.1|17|8.5|2.2
couscous_vegetables|X9A1000|Gebratener Couscous mit Gemüse|400|118|3.03|14.4|4.8|2.3
vegetable_rice_cheese|X880213|Gemüsereis mit Wurzelgemüse und Käse|400|134|3.8|18|4.6|2.2
nasi_goreng|X891133|Nasi Goreng mit Gemüse und Schweinefleisch|450|110|10.2|14|1|2
fish_fingers_oven|T930162|Fischstäbchen aus dem Ofen|250|206|13.75|16.32|9.33|0.909
hamburg_pannfisch|Y695623|Hamburger Pannfisch mit Bratkartoffeln und Senfsauce|450|181|8.4|9.79|11.59|1.8
salmon_vegetables|Y640112|Gedünsteter Lachs auf Gemüse|400|136|11.64|1.9|8.6|1.6
chicken_vegetables|Y562112|Gebratene Hähnchenbrust mit gedünstetem Kaisergemüse|400|98|13.94|2.5|3.3|1.4
gyros|Y384112|Schweine-Gyros, gebraten|250|230|24.35|0.5|14.48|0.3
`.trim();

const englishNameByCode = new Map(BLS_SEARCH_ROWS.map((row) => [row[0], blsEnglishName(row)]));

export const BLS_REFERENCE_MEALS = Object.freeze(rows.split('\n').map((row) => {
  const [key, code, nameDe, defaultGrams, calories, protein, carbs, fat, fiber] = row.split('|');
  return Object.freeze({
    key,
    code,
    nameDe,
    nameEn: englishNameByCode.get(code) ?? nameDe,
    defaultGrams: Number(defaultGrams),
    per100g: Object.freeze({
      calories: Number(calories),
      protein: Number(protein),
      carbs: Number(carbs),
      fat: Number(fat),
      fiber: Number(fiber),
    }),
  });
}));

export const BLS_REFERENCE_KEYS = Object.freeze(BLS_REFERENCE_MEALS.map((meal) => meal.key));

/** Short prompt catalog: the schema enforces the key; this explains its dish. */
export const BLS_MODEL_CATALOG = BLS_REFERENCE_MEALS
  .map((meal) => `${meal.key}=${meal.nameDe}`)
  .join('; ');

const byKey = new Map(BLS_REFERENCE_MEALS.map((meal) => [meal.key, meal]));
const byCode = new Map(BLS_REFERENCE_MEALS.map((meal) => [meal.code, meal]));

export function getBlsReference(referenceKey) {
  return byKey.get(String(referenceKey ?? '')) ?? null;
}

export function getBlsReferenceByCode(code) {
  return byCode.get(String(code ?? '')) ?? null;
}

/** A reviewed family conflict requires correction, not a different database. */
export function requiresFoodIdentityCorrection(item) {
  const staple = preferredStapleRows.get(exactFoodKey(item?.searchTermEn));
  if (staple) {
    const named = preferredStapleNames.get(exactFoodKey(item?.name));
    if (item?.name && (!named || named.family !== staple.family
      || (named.preparation && named.preparation !== staple.preparation))) return true;
    if (staple.preparation) {
      const preparation = String(item?.preparation ?? 'unknown');
      if (preparation !== 'unknown' && !(staple.preparation === 'raw'
        ? preparation === 'raw' : ['boiled', 'steamed'].includes(preparation))) return true;
    }
  }
  const name = String(item?.name ?? '').trim().toLowerCase();
  // Preserve the established German chips/fries translation disambiguation.
  if (/^(kartoffelchips|stapelchips|pommes frites)$/.test(name)) return false;
  const reviewedName = reviewedNameAliases.get(exactFoodKey(name));
  const reviewedQuery = reviewedNameAliases.get(exactFoodKey(item?.searchTermEn));
  if (reviewedQuery && name && reviewedName?.[0] !== reviewedQuery[0]) return true;
  if (!reviewedName || !String(item?.searchTermEn ?? '').trim()) return false;
  const plainMuesliQuery = canonicalFoodQuery(item.searchTermEn) === 'muesli'
    && ['C514200', 'C514400', 'C514600'].includes(reviewedName[0]);
  return !plainMuesliQuery && resolveExactBlsFacts(item.searchTermEn)?.referenceId !== reviewedName[0];
}

export function resolveBlsFacts(item) {
  // These German food identities are unambiguous, unlike the British source
  // translation "potato chips". Do not let a translated query swap them.
  const name = String(item?.name ?? '').trim().toLowerCase();
  if (/^(kartoffelchips|stapelchips)$/.test(name)) return resolveExactBlsFacts('potato crisps');
  if (name === 'pommes frites') return resolveExactBlsFacts('French fries');
  // Concrete ingredient identity/preparation outranks a contradictory model key
  // (observed: "hard boiled egg" with referenceKey=fried_egg).
  const ingredient = resolveExactBlsFacts(item?.searchTermEn);
  const reviewedName = reviewedNameAliases.get(exactFoodKey(name));
  if (requiresFoodIdentityCorrection(item)) return null;
  if (reviewedName) return factsFromRow(reviewedName, false);
  if (ingredient) return ingredient;
  const meal = getBlsReference(item?.referenceKey);
  if (!meal) return null;
  // Egg preparations are distinct dishes. Never let a model key silently add
  // frying fat to boiled eggs or replace scrambled eggs with an omelette.
  const term = canonicalFoodQuery(item?.searchTermEn);
  if (['fried_egg', 'scrambled_eggs', 'omelette'].includes(meal.key)) {
    const required = {fried_egg: /\b(?:fried|sunny side)\b/, scrambled_eggs: /\bscrambled\b/, omelette: /\bomele(?:t|tt)e?\b/}[meal.key];
    if (!required.test(term) || /\b(?:boiled|poached|raw)\b/.test(term)) return null;
  }
  return {
    provider: 'bls',
    referenceId: meal.code,
    label: `BLS 4.0 ${meal.code}`,
    description: meal.nameDe,
    ...meal.per100g,
  };
}

// Exact identity and preparation only. Never use fuzzy search rankings to
// silently substitute another food or turn dried food into fresh food.
const exactFoodKey = (text) => (canonicalFoodQuery(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/\bpitted\b/g, '').match(/[a-z]+|\d+(?:[.,]\d+)?/g) || [])
  .map(word => word.replace(',', '.'))
  .map(word => word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word).sort().join(' ');
const exactBlsRows = new Map();
for (const row of BLS_SEARCH_ROWS) {
  const key = exactFoodKey(blsEnglishName(row));
  // Ambiguous names must fall back to USDA, not select an arbitrary row.
  exactBlsRows.set(key, exactBlsRows.has(key) ? null : row);
}
// Reviewed whole-term vocabulary bridges to existing source rows, not invented
// nutrient values. Do not erase qualifiers to force a match: roasted/salted,
// flour, butter, milk and chocolate-coated variants need their own reference.
const ingredientAliases = new Map();
const reviewedNameAliases = new Map();
const rowsByCode = new Map(BLS_SEARCH_ROWS.map(row => [row[0], row]));
// Whole-term bridges for ordinary pasta and Parmesan. These are typical BLS
// references, not a branded product or a licence to strip sauces/grain types.
// Preparation and the separately detected name must agree before automatic use.
const preferredStapleRows = new Map();
const preferredStapleNames = new Map();
for (const [family, preparation, code, aliases] of [
  ['pasta', 'cooked', 'E401032', ['pasta cooked', 'pasta boiled', 'spaghetti cooked', 'spaghetti boiled', 'penne cooked', 'penne boiled', 'macaroni cooked', 'macaroni boiled', 'Nudeln gekocht', 'gekochte Nudeln', 'Spaghetti gekocht', 'gekochte Spaghetti', 'Penne gekocht', 'Teigwaren gekocht']],
  ['pasta', 'raw', 'E401000', ['pasta raw', 'pasta dry', 'pasta dried', 'pasta uncooked', 'spaghetti raw', 'spaghetti dry', 'spaghetti uncooked', 'penne raw', 'penne dry', 'penne uncooked', 'Nudeln roh', 'rohe Nudeln', 'Nudeln trocken', 'trockene Nudeln', 'Spaghetti roh', 'Teigwaren roh']],
  ['wholemeal-pasta', 'cooked', 'E500032', ['wholemeal pasta cooked', 'wholemeal pasta boiled', 'whole wheat pasta cooked', 'whole grain pasta cooked', 'whole wheat spaghetti cooked', 'Vollkornnudeln gekocht', 'gekochte Vollkornnudeln', 'Vollkornspaghetti gekocht']],
  ['wholemeal-pasta', 'raw', 'E510000', ['wholemeal pasta raw', 'wholemeal pasta dry', 'whole wheat pasta raw', 'whole grain pasta raw', 'whole wheat pasta dry', 'Vollkornnudeln roh', 'Vollkornnudeln trocken']],
  ['egg-pasta', 'cooked', 'E432032', ['egg pasta cooked', 'egg noodles cooked', 'egg noodles boiled', 'Eiernudeln gekocht', 'gekochte Eiernudeln', 'Eierteigwaren gekocht']],
  ['egg-pasta', 'raw', 'E432000', ['egg noodles raw', 'egg noodles dry', 'egg pasta dry', 'Eiernudeln roh', 'Eiernudeln trocken']],
  ['parmesan', null, 'M306400', ['parmesan', 'parmesan cheese', 'grated parmesan', 'grated parmesan cheese', 'Parmesan gerieben', 'geriebener Parmesan']],
]) {
  const row = rowsByCode.get(code);
  if (!row) throw new Error(`Missing reviewed BLS staple ${code}`);
  for (const alias of aliases) {
    const key = exactFoodKey(alias);
    ingredientAliases.set(key, row);
    preferredStapleRows.set(key, { family, preparation, row });
    preferredStapleNames.set(key, { family, preparation });
  }
}
for (const [family, names] of [
  ['pasta', ['pasta', 'spaghetti', 'penne', 'macaroni', 'makkaroni', 'nudeln', 'teigwaren']],
  ['wholemeal-pasta', ['wholemeal pasta', 'whole wheat pasta', 'whole grain pasta', 'whole wheat spaghetti', 'Vollkornnudeln', 'Vollkornspaghetti', 'Vollkornteigwaren']],
  ['egg-pasta', ['egg pasta', 'egg noodles', 'Eiernudeln', 'Eierteigwaren']],
]) for (const name of names) preferredStapleNames.set(exactFoodKey(name), { family, preparation: null });

/** Same narrowly reviewed vocabulary for the on-device description path. */
export function resolveReviewedStapleFacts(term) {
  const staple = preferredStapleRows.get(exactFoodKey(term));
  return staple ? factsFromRow(staple.row, false) : null;
}

for (const [code, aliases] of [
  ['F840100', ['raisins', 'sultanas', 'golden raisins', 'golden raisins dried', 'dried golden raisins', 'grapes dried']],
  ['H210100', ['almonds', 'almonds raw', 'sweet almonds raw']],
  ['H210200', ['almonds blanched']],
  ['H170100', ['cashews', 'cashews raw', 'cashew nuts raw']],
  ['H180100', ['brazil nuts raw']],
  ['H130100', ['hazelnuts raw']],
  ['H120100', ['walnuts raw']],
  ['H250100', ['pistachios', 'pistachios raw', 'pistachio nuts raw']],
  ['H430100', ['sunflower seeds raw']],
  ['C133000', ['rolled oats', 'rolled oats raw', 'oat flakes raw']],
  ['C352032', ['white rice cooked', 'white rice steamed']],
  ['C351032', ['brown rice cooked', 'brown rice steamed']],
  ['V416172', ['chicken breast grilled', 'skinless chicken breast grilled', 'boneless skinless chicken breast grilled']],
  ['E111132', ['hard boiled eggs', 'hard-boiled eggs', 'soft boiled eggs', 'chicken eggs hard boiled']],
  ['M141300', ['plain yogurt 3.5% fat', 'plain whole milk yogurt 3.5% fat', 'whole milk yogurt', 'plain whole milk yogurt']],
  ['M141200', ['plain yogurt 1.5% fat', 'plain low fat yogurt 1.5% fat']],
  ['F533100', ['honeydew melon', 'honeydew raw']],
  ['S145000', ['chocolate hazelnut spread', 'hazelnut chocolate spread', 'cocoa hazelnut spread', 'hazelnut cocoa spread', 'nutella']],
  ['K280100', ['potato chips', 'potato crisps']],
  // Beta 24 feedback: "2 Toast" became an unresolved row. Ordinary sliced
  // wheat toast is the everyday meaning; toasted, wholemeal and multigrain
  // stay separate BLS rows. Typical values, labelled as generic references.
  ['B314000', ['toast', 'toast bread', 'toast slices', 'slices of toast', 'slice of toast', 'white toast', 'white toast bread', 'wheat toast', 'wheat toast bread', 'sandwich toast', 'butter toast', 'toastbrot', 'weizentoastbrot', 'buttertoast']],
  ['B314072', ['toasted bread', 'toasted white bread', 'white bread toasted', 'toast toasted', 'toasted toast', 'toasted toast bread', 'toasted white toast', 'toasted wheat toast', 'toasted bread slices']],
  ['B111200', ['wholemeal toast', 'whole wheat toast', 'whole grain toast', 'wholegrain toast', 'vollkorntoast', 'vollkorntoastbrot']],
  ['B314200', ['multigrain toast', 'mehrkorntoast', 'mehrkorntoastbrot']],
]) {
  const row = rowsByCode.get(code);
  if (!row) throw new Error(`Missing reviewed BLS ingredient ${code}`);
  for (const alias of aliases) ingredientAliases.set(exactFoodKey(alias), row);
}

// Ingredient terms only (searchTermEn), never the displayed name, so a name
// like "Quark" cannot override a stated "quark 40% fat".
for (const [code, aliases] of [
  // 08.11.2026 owner test: plain quark was priced as cream cheese (317 kcal
  // for 120 g instead of about 80). Plain quark means the everyday low-fat
  // Speisequark; stated fat levels keep their own rows.
  ['M713100', ['quark', 'plain quark', 'quark plain', 'quark low fat', 'low fat quark', 'low-fat quark', 'skimmed milk quark', 'skim milk quark', 'quark cheese', 'fresh quark', 'quark fresh', 'Quark', 'Magerquark', 'Speisequark', 'Speisequark mager', 'Topfen', 'Magertopfen']],
  ['M713300', ['quark 20% fat', 'quark 20 % fat', 'half fat quark', 'medium fat quark', 'Halbfettquark', 'Quark 20 %', 'Speisequark 20 %']],
  ['M713500', ['quark 40% fat', 'quark 40 % fat', 'full fat quark', 'creamy quark', 'Sahnequark', 'Quark 40 %', 'Speisequark 40 %']],
  // Same test: a jar of Zwieback became butter biscuits. Ordinary German
  // Zwieback is the butter rusk row; wholemeal and sweetened ones stay apart.
  ['D036000', ['rusk', 'rusks', 'zwieback', 'butter rusk', 'butter rusks', 'Zwieback', 'Butterzwieback']],
]) {
  const row = rowsByCode.get(code);
  if (!row) throw new Error(`Missing reviewed BLS ingredient ${code}`);
  for (const alias of aliases) {
    const key = exactFoodKey(alias);
    if (ingredientAliases.has(key) && ingredientAliases.get(key)[0] !== code) throw new Error(`Conflicting BLS alias: ${alias}`);
    ingredientAliases.set(key, row);
  }
}

// Build 14 feedback: whole food-family names only. These are typical BLS
// values, not manufacturer labels. Keep light, sugar-free and milk/yogurt
// preparations separate. Chocolate-with-biscuit is intentionally excluded:
// the available wholemeal-biscuit bar is not a verified Milka LU reference.
for (const [code, aliases] of [
  ['K280100', ['Paprika-Chips', 'knusprige Paprika-Chips', 'Paprika-Kartoffelchips', 'knusprige Paprika-Kartoffelchips', 'Kartoffelchips Paprika', 'knusprige Kartoffelchips', 'paprika potato chips', 'paprika flavoured potato chips', 'paprika flavored potato chips', 'crispy paprika potato chips', 'crispy potato chips', 'potato chips paprika', 'potato chips paprika flavor', 'paprika chips', 'potato crisps paprika', 'potato chips salted', 'salted potato chips']],
  ['Q999000', ['remoulade', 'remoulade sauce', 'spicy remoulade sauce', 'seasoned remoulade sauce', 'remoulade sauce spicy', 'Remouladensauce', 'würzige Remoulade', 'würzige Remoulade Sauce']],
  ['C514200', ['crunchy muesli', 'crunchy muesli mix', 'crispy muesli', 'Knuspermüsli', 'knuspriges Müsli', 'Knuspermüslimischung']],
  ['X0A3000', ['granola', 'crunchy granola']],
  ['C514400', ['crunchy muesli with dried fruit', 'Knuspermüsli mit Trockenfrüchten']],
  ['C514600', ['chocolate crunchy muesli', 'crunchy muesli with chocolate', 'Schoko-Knuspermüsli', 'Knuspermüsli mit Schokolade']],
]) {
  const row = rowsByCode.get(code);
  if (!row) throw new Error(`Missing reviewed BLS family ${code}`);
  for (const alias of aliases) {
    const key = exactFoodKey(alias);
    for (const map of [ingredientAliases, reviewedNameAliases]) {
      if (map.has(key) && map.get(key)[0] !== code) throw new Error(`Conflicting BLS alias: ${alias}`);
      map.set(key, row);
    }
  }
}

export function resolveExactBlsFacts(term) {
  const key = exactFoodKey(term);
  const exact = exactBlsRows.get(key);
  const row = exact || ingredientAliases.get(key);
  if (!row) return null;
  return factsFromRow(row, Boolean(exact));
}

function factsFromRow(row, exact) {
  const [code, , , calories, protein, carbs, fat, fiber] = row;
  const description = blsEnglishName(row);
  if (![calories, protein, carbs, fat].every(value => Number.isFinite(value) && value >= 0)) return null;
  return { provider: 'bls', referenceId: code, label: `BLS 4.0 ${code}`, description,
    calories, protein, carbs, fat, fiber, matchConfidence: exact ? 'high' : 'medium',
    ...(!exact ? { estimatedReference: true } : {}) };
}

/**
 * Free-text search over the German dish references.
 *
 * USDA is an English database, so a German user typing "Hähnchen" finds
 * nothing there. These 64 dishes are the part of the catalogue that answers in
 * German — and their values are vetted rather than matched, so they belong at
 * the top of a result list, not below it.
 */
export function searchBlsReferences(query, limit = 6, language = 'de') {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle.length < 2) return [];
  const stopWords = new Set(['and', 'or', 'the', 'with', 'und', 'oder', 'mit', 'der', 'die', 'das']);
  const terms = needle.split(/\s+/).filter((term) => term && !stopWords.has(term));
  if (!terms.length) return [];
  return BLS_REFERENCE_MEALS
    .map((meal) => {
      const localName = (language === 'de' ? meal.nameDe : meal.nameEn).toLowerCase();
      const otherName = (language === 'de' ? meal.nameEn : meal.nameDe).toLowerCase();
      const localMatched = terms.filter((term) => localName.includes(term)).length;
      const otherMatched = terms.filter((term) => otherName.includes(term)).length;
      const matched = Math.max(localMatched, otherMatched);
      if (matched !== terms.length) return null;
      // Prefer the dish whose name is mostly the query rather than one that
      // merely contains it: "Reis" should not lead with a rice pudding.
      const name = localMatched >= otherMatched ? localName : otherName;
      return { meal, score: matched / terms.length + needle.length / name.length + (localMatched ? 0.02 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (language === 'de' ? a.meal.nameDe : a.meal.nameEn).localeCompare(language === 'de' ? b.meal.nameDe : b.meal.nameEn))
    .slice(0, limit)
    .map(({ meal }) => meal);
}
