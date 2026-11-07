import { canonicalFoodQuery } from './food-query.mjs';

/**
 * The display language for the detected title and ingredient names. An older
 * build sends nothing, and an unknown value is not worth a 400: falling back to
 * the app's default language is the safe reading.
 */
export function requestedLanguage(input) {
  return input?.language === 'de' ? 'de' : 'en';
}

const SAFE_GATEWAY_FAILURES = new Set([
  'ai_key_missing',
  'ai_provider_invalid',
  'missing_structured_output',
]);

/**
 * Turns an arbitrary exception into the only value that may enter gateway logs.
 * Provider bodies and model output are intentionally not part of this contract.
 */
export function safeGatewayFailureCode(error) {
  const message = error instanceof Error ? error.message : '';
  if (SAFE_GATEWAY_FAILURES.has(message)) return message;
  if (/^(?:openrouter|openai|usda|off)_[1-5]\d{2}$/.test(message)) return message;
  return error instanceof SyntaxError ? 'provider_response_invalid' : 'gateway_unexpected_error';
}

/**
 * Runs `task` over `values` with at most `limit` in flight and keeps the input
 * order. The first failure rejects the whole call (like Promise.all) and no
 * further task is started after it.
 */
export async function mapBounded(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < values.length) {
      const index = next++;
      try {
        results[index] = await task(values[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, values.length));
  await Promise.all(Array.from({ length: values.length ? width : 0 }, worker));
  return results;
}

export function validateAnalysisInput(input) {
  const encoded = input?.imageBase64;
  if (input?.mimeType !== 'image/jpeg' || typeof encoded !== 'string' || encoded.length < 100) return false;
  // The route owns the 413 size response; avoid scanning an oversized body.
  if (encoded.length > 3_000_000) return true;
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    // Check actual JPEG framing before spending a provider request. This is a
    // bounded structural check, not a claim to fully decode/validate the image.
    const head = atob(encoded.slice(0, 8));
    const tail = atob(encoded.slice(-8));
    return head.startsWith('\xff\xd8\xff') && tail.endsWith('\xff\xd9');
  } catch {
    return false;
  }
}

/**
 * @param detection  structured model output
 * @param source     'photo' or 'text'. A typed description is by definition one
 *                   meal the user chose to report, so the multi-dish guard —
 *                   which exists to stop a photo of a whole table — must not
 *                   apply to it. The model marks normal plates as dishCount > 1
 *                   often enough that leaving it on rejected valid input.
 */
export function classifyDetection(detection, source = 'photo') {
  const fromPhoto = source !== 'text';
  // Only a photo without any identifiable food is a dead end. A slightly
  // blurred photo or a second plate still yields the recognised foods: the
  // person can untick what they did not eat instead of taking a new photo.
  if (!detection || !Array.isArray(detection.items) || detection.items.length === 0) {
    // A pack has exact values on its barcode; the code stays unclear_image so
    // older apps keep their handling, and `packaged` lets new ones offer the scan.
    if (fromPhoto && detection?.packagedProduct === true) {
      return {
        status: 422,
        body: {
          code: 'unclear_image',
          packaged: true,
          message: 'Das sieht nach einer Verpackung aus. Scanne den Barcode, dann stimmen die Werte genau.',
        },
      };
    }
    return {
      status: 422,
      body: {
        code: 'unclear_image',
        message: fromPhoto
          ? 'Das Foto ist für eine verlässliche Schätzung nicht eindeutig genug.'
          : 'Aus dieser Beschreibung lässt sich noch keine Mahlzeit ableiten. Nenne kurz die Lebensmittel und ungefähren Mengen.',
      },
    };
  }
  return null;
}

export function nutrient(food, ids) {
  for (const id of ids) {
    for (const entry of food.foodNutrients || []) {
      if (Number(entry.nutrientId ?? entry.nutrient?.id) !== id
        && Number(entry.nutrientNumber ?? entry.nutrient?.number) !== id) continue;
      const raw = entry.value ?? entry.amount;
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

// Legacy energy first, then food-specific Atwater, then general Atwater.
// USDA Foundation foods may omit 1008 entirely. Never interpret missing as 0.
export function energyKcal(food) {
  return nutrient(food, [1008, 208, 2048, 958, 2047, 957]);
}

/**
 * Cache key for a USDA search. USDA data is effectively static, so the same
 * term must always resolve to the same entry regardless of casing or spacing.
 */
export function normalizeSearchTerm(term) {
  return String(term ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Terms that name a category rather than a food. The model once returned
 * "other" — the referenceKey sentinel — as the search term for every
 * ingredient of a plate, so chicken, rice and broccoli all resolved to one
 * cached row and the whole meal was priced from it. A term that cannot
 * identify a food must never reach USDA or the cache.
 */
const UNUSABLE_SEARCH_TERMS = new Set([
  'other', 'unknown', 'none', 'n/a', 'na', 'null', 'undefined', 'food', 'meal', 'dish', 'ingredient',
]);

export function isUsableSearchTerm(term) {
  const normalized = normalizeSearchTerm(term);
  if (normalized.length < 3) return false;
  if (UNUSABLE_SEARCH_TERMS.has(normalized)) return false;
  // A BLS key is a reference id, not something USDA can look up.
  if (/^[a-z]+_[a-z_]+$/.test(normalized) && !normalized.includes(' ')) return false;
  return true;
}

/** Changing the matcher invalidates previous choices without deleting data. */
export const USDA_MATCHER_VERSION = 10;

export function usdaCacheKey(term) {
  return `v${USDA_MATCHER_VERSION}:${normalizeSearchTerm(term)}`;
}

const DATA_TYPE_PRIORITY = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'];

const PREPARATION_WORDS = new Set([
  'baked', 'boiled', 'breaded', 'canned', 'cooked', 'dried', 'fried', 'grilled',
  'raw', 'roasted', 'steamed', 'stewed', 'sweetened', 'unsweetened',
]);

const LOW_INFORMATION_WORDS = new Set([
  'and', 'in', 'of', 'the', 'with', 'without', 'style', 'prepared', 'food', 'as', 'to',
]);

/**
 * USDA bookkeeping that narrows a label without changing the food: "Rice,
 * cooked, NFS" is still rice. These must not be charged like an extra
 * ingredient, or a plainly-worded row loses to a terser one from a
 * higher-priority data set.
 */
const QUALIFIER_WORDS = new Set([
  'nfs', 'ns', 'unspecified', 'form', 'salt', 'added', 'drained', 'includes',
  'commodity', 'usda', 'variety', 'varieties', 'type', 'types', 'product',
  'no', 'fresh', 'frozen',
  'broiler', 'fryer', 'meat', 'only', 'boneless', 'skinless',
]);

/**
 * Fat added during cooking, which USDA sometimes folds into the row. It is not
 * a different food, but it is a different calorie density, and the model lists
 * oil as its own ingredient — so an unrequested "cooked with oil" row would be
 * counted twice.
 */
const ADDED_FAT_WORDS = new Set(['oil', 'butter', 'fat', 'cream', 'cheese', 'sauce', 'gravy', 'dressing', 'margarine']);
// A shared noun is insufficient: rice noodles aren't rice and almond milk
// isn't almonds. These transformations cannot win when the base row is absent.
const FOOD_TRANSFORMS = new Set(['noodle', 'flour', 'bread', 'cake', 'cookie', 'biscuit', 'chip', 'juice', 'powder',
  'milk', 'butter', 'oil', 'soup', 'salad', 'sauce', 'spread', 'substitute', 'raab']);
const NO_ADDED_FAT = /\bno(?:t)? +(?:added +)?(?:fat|oil|butter)\b|\bwithout +(?:added +)?(?:fat|oil|butter)\b/;

/**
 * USDA writes many entries in the plural — "Bananas, raw" — while a search
 * term is singular, so the two share no token at all without this.
 *
 * Measured effect on the captured responses: it moves "banana" from the Survey
 * row at 97 kcal to the canonical SR Legacy one at 89. Small, but it is the
 * difference between matching the reference and matching something near it.
 */
function singular(word) {
  if (word === 'potatoes') return 'potato';
  if (word === 'tomatoes') return 'tomato';
  if (word.length <= 3) return word;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es') && word.length > 4 && /(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function words(value) {
  return normalizeSearchTerm(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !LOW_INFORMATION_WORDS.has(word))
    .map(singular);
}

/**
 * Picks the USDA entry that best matches the search term.
 *
 * Ranking by data type alone was not enough: searching "broccoli" returns no
 * Foundation entry, so the first Survey row won — "Fried broccoli" at
 * 223 kcal/100 g — while "Broccoli, raw" sat two rows below. Relevance now
 * decides and the data type only breaks ties, because a precise match in a
 * lesser data set beats a confident match on the wrong food.
 */
export function chooseFoodMatch(foods, term = '') {
  const list = [...(foods || [])];
  // `ranked` must be present even here: search destructures it, and an empty
  // USDA response turned a "nothing found" into a crash and a 503.
  if (!list.length) return { food: undefined, score: 0, margin: 0, confidence: 'low', cacheable: false, ranked: [] };

  const target = normalizeSearchTerm(canonicalFoodQuery(term));
  const targetWords = words(target);

  const rank = (food) => {
    const index = DATA_TYPE_PRIORITY.indexOf(food.dataType);
    return index === -1 ? DATA_TYPE_PRIORITY.length : index;
  };

  const score = (food) => {
    const description = normalizeSearchTerm(food.description);
    const identity = foodNouns(target).filter(word => !['pitted', 'peeled', 'seedless', 'boneless', 'skinless'].includes(word));
    const candidateWords = new Set(words(description));
    // Preparation overlap is not food identity: dried dates are not dried
    // lotus seeds. Keep this as a hard boundary, independent of score bonuses.
    if (identity.length && !identity.every(word => candidateWords.has(word))) return -1000;
    const descriptionWords = words(food.description);
    const descriptionSet = new Set(descriptionWords);
    const targetSet = new Set(targetWords);
    const candidateIdentity = foodNouns(description);
    if (candidateIdentity.some(word => FOOD_TRANSFORMS.has(word) && !targetSet.has(word))) return -1000;
    const cookedWords = ['cooked', 'boiled', 'steamed', 'fried', 'baked', 'roasted', 'grilled', 'stewed'];
    if (targetSet.has('raw') && cookedWords.some(word => descriptionSet.has(word))) return -1000;
    if (descriptionSet.has('raw') && cookedWords.some(word => targetSet.has(word))) return -1000;
    // Curated data outranks user-submitted data, but only as a tie-breaker:
    // relevance still decides. A grid search over fourteen captured USDA
    // responses passes every case for a step of 3 to 7; 5 sits in the middle.
    let value = Math.max(0, 16 - rank(food) * 5);

    if (!target) return value;

    // A Branded row is one manufacturer's product, not the food. USDA lists
    // an all-caps "BANANA" at 336 kcal — dried chips, unlabelled — and the
    // full exact-match bonus let it beat "Bananas, raw" at 89. Matching the
    // query exactly says nothing about being the right reference.
    // A Branded row gets no name bonus at all. USDA lists an all-caps
    // "BANANA" at 336 kcal — dried chips, unlabelled — and a manufacturer
    // naming their product exactly after the food says nothing about it being
    // a good reference for that food.
    const branded = food.dataType === 'Branded';
    if (!branded) {
      if (description === target) value += 120;
      else if (description.startsWith(target)) value += 35;
    }

    const covered = targetWords.filter((word) => descriptionSet.has(word)).length;
    const coverage = targetWords.length ? covered / targetWords.length : 0;
    const precision = descriptionWords.length ? covered / descriptionWords.length : 0;
    value += coverage * 65 + precision * 25;

    // Preparation changes calories dramatically. An unrequested "fried" result
    // must not beat a raw/cooked base food merely because one noun overlaps.
    for (const preparation of PREPARATION_WORDS) {
      if (descriptionSet.has(preparation) && !targetSet.has(preparation)) {
        value -= preparation === 'raw' || preparation === 'cooked' ? 5 : 35;
      }
      if (targetSet.has(preparation) && !descriptionSet.has(preparation)) value -= 18;
    }

    // An extra noun usually names a different food: "Rice noodles" is not
    // rice and "Broccoli raab" is not broccoli. Five points was not enough to
    // outweigh the data-type bonus, so both used to win. Bureaucratic
    // qualifiers stay free.
    const extras = descriptionWords.filter((word) => (
      !targetSet.has(word) && !PREPARATION_WORDS.has(word) && !QUALIFIER_WORDS.has(word)
    )).length;
    // 9 was measured against real USDA responses for ten common foods: 5 still
    // picked "Rice noodles" over rice, 11 dropped baked salmon and 14 dropped a
    // boiled egg.
    value -= Math.min(extras, 4) * 9;

    // Prefer the plainly cooked row over an unspecified one. "Broccoli, NS as
    // to form, cooked" is 63 kcal/100 g because it averages in cooking fat,
    // while "Broccoli, fresh, cooked, no added fat" is 41 — and the model
    // already reports the oil separately.
    const targetWantsFat = targetWords.some((word) => ADDED_FAT_WORDS.has(word));
    if (!targetWantsFat) {
      // 16, not 12: the vaguer row is also the shorter one, so it wins on
      // precision unless the explicit "no added fat" row is paid for.
      if (NO_ADDED_FAT.test(description)) value += 16;
      else if (descriptionWords.some((word) => ADDED_FAT_WORDS.has(word))) value -= 20;
    }

    return value;
  };

  // Ties must break on the data, not on the position USDA happened to return.
  // Two broccoli rows scored identically, so the same query picked a different
  // food depending on the order of the response.
  const ranked = list
    .map((food, index) => ({ food, index, score: score(food) }))
    .sort((a, b) => (
      b.score - a.score
      || rank(a.food) - rank(b.food)
      || String(a.food?.fdcId ?? '').localeCompare(String(b.food?.fdcId ?? ''))
      || a.index - b.index
    ));
  const winner = ranked[0];
  const margin = winner.score - (ranked[1]?.score ?? 0);
  const accepted = targetWords.length > 0 && winner.score >= 52;
  const confidence = accepted && winner.score >= 75 && (ranked.length === 1 || margin >= 8)
    ? 'high'
    : accepted
      ? 'medium'
      : 'low';

  return {
    food: accepted ? winner.food : undefined,
    score: Number(winner.score.toFixed(2)),
    margin: Number(margin.toFixed(2)),
    confidence,
    // Ambiguous matches may be usable for this review screen, but caching them
    // would amplify one uncertain lookup across every user for months.
    cacheable: confidence === 'high',
    // A person choosing from a list can resolve an ambiguity the matcher
    // cannot, so search shows the runners-up the automatic path discards.
    ranked: ranked.map((entry) => ({ food: entry.food, score: Number(entry.score.toFixed(2)) })),
  };
}

/**
 * The same ranking, but every plausible row instead of the single winner.
 *
 * Automatic analysis has to pick one and must refuse when unsure; a person
 * typing "rice" wants the shortlist. The threshold is lower here for that
 * reason — a human reading "Rice, cooked, NFS" next to "Rice noodles" can tell
 * them apart, and offering nothing is the worse answer.
 */
/**
 * The food a description is about, with preparation and paperwork removed.
 *
 * The "no added fat" phrase goes first: it is a statement about the cooking,
 * not an ingredient, and leaving the word "fat" in it made the plainly cooked
 * entry look like a different food from the vague one.
 */
function foodNouns(value) {
  return words(String(value).toLowerCase().replace(NO_ADDED_FAT, ' '))
    .filter((word) => !PREPARATION_WORDS.has(word) && !QUALIFIER_WORDS.has(word));
}

export function rankFoodMatches(foods, term, limit = 12) {
  const { ranked = [] } = chooseFoodMatch(foods, term);
  if (!ranked.length) return [];

  // Searching "rice" must lead with rice, not with rice crackers. USDA's own
  // relevance puts crackers, cakes and paper first, and the general scoring
  // cannot separate them: a two-word compound scores higher on precision than
  // "Rice, cooked, NFS" does. Here the question is simpler than for automatic
  // matching — is this entry the food that was asked for, or a dish made from
  // it? — so an exact match on the food nouns wins outright.
  const wanted = foodNouns(term).join(' ');
  const rescored = ranked.map((entry) => ({
    ...entry,
    // Branded rows are excluded for the same reason they get no name bonus:
    // one manufacturer's product is not the reference for a food.
    score: entry.score + (
      wanted
      && entry.food?.dataType !== 'Branded'
      && foodNouns(entry.food?.description ?? '').join(' ') === wanted ? 25 : 0
    ),
  })).sort((a, b) => b.score - a.score);

  const best = rescored[0]?.score ?? 0;
  // Relative to the best hit, not an absolute number: the score range depends
  // entirely on the query. "rice cooked" tops out near 88 and "salmon baked"
  // near 54, so one fixed cut-off either buried real results or let peanuts
  // into a search for boiled eggs.
  const floor = Math.max(30, best * 0.72);

  // The food itself must be in the description. Without this, a search for
  // "broccoli steamed" returned "Oysters, steamed" — USDA had no steamed
  // broccoli at all, and the preparation word alone carried the match.
  const contentWords = words(term).filter((word) => !PREPARATION_WORDS.has(word));

  const seen = new Set();
  const results = [];
  for (const entry of rescored) {
    if (!entry.food || entry.score < floor) continue;
    // A row with no energy value cannot be logged, only misread as free food.
    if (energyKcal(entry.food) === null) continue;
    const description = normalizeSearchTerm(entry.food.description);
    if (contentWords.length && !contentWords.some((word) => description.includes(word))) continue;
    // USDA repeats near-identical rows; a list of six identical labels reads
    // as a broken screen, not as a choice.
    const key = description.replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(entry.food);
    if (results.length >= limit) break;
  }
  return results;
}

export function chooseFood(foods, term = '') {
  return chooseFoodMatch(foods, term).food;
}

/**
 * Reduces a USDA search hit to the handful of values a meal item needs. This is
 * what gets cached; the raw search response is orders of magnitude larger and
 * carries nothing else we use.
 */
export function toFoodFacts(food, match = null) {
  if (!food) return null;
  // USDA branded records can use a 100 ml basis. Only an explicit gram
  // serving establishes the mass basis for that data type.
  const servingUnit=String(food.servingSizeUnit??'').toLowerCase();
  if (['ml','l','cl','dl','fl oz'].includes(servingUnit) || (food.dataType==='Branded' && servingUnit!=='g')) return null;
  const calories = energyKcal(food);
  const protein = nutrient(food, [1003, 203]);
  const carbs = nutrient(food, [1005, 205]);
  const fat = nutrient(food, [1004, 204]);
  if ([calories, protein, carbs, fat].some((value) => value === null)) return null;
  if (calories === 0 && protein * 4 + carbs * 4 + fat * 9 > 5) return null;
  return {
    provider: 'usda',
    referenceId: String(food.fdcId),
    label: `USDA FDC ${food.fdcId}`,
    description: String(food.description || ''),
    dataType: String(food.dataType || ''),
    matchConfidence: match?.confidence || 'high',
    matchScore: match?.score,
    matchMargin: match?.margin,
    calories,
    protein,
    carbs,
    fat,
    ...(nutrient(food, [1079, 291]) === null ? {} : { fiber: nutrient(food, [1079, 291]) }),
  };
}

/** Scales cached per-100g facts onto the portion the model estimated. */
/**
 * USDA describes most prepared foods as "cooked", almost never as "boiled" or
 * "steamed", so the model's preparation vocabulary misses entries that plainly
 * exist: "white rice boiled" returned mushrooms and beans and was rejected,
 * while "white rice cooked" finds the right row. Callers try the original term
 * first and fall back to these rewrites only when nothing acceptable matched.
 */
export function searchTermVariants(term) {
  const normalized = canonicalFoodQuery(term);
  if (!normalized) return [];
  const variants = [];
  const swapped = normalized.replace(/\b(?:boiled|steamed|poached|braised)\b/gi, 'cooked');
  if (swapped !== normalized) variants.push(swapped);
  // Never drop preparation as a generic fallback. Dry vs cooked rice differs
  // several-fold; an explicit failure is safer than a plausible wrong result.
  return variants;
}

/**
 * The model's own per-100 g estimate, used only when no BLS/USDA reference
 * matched a clearly identified food. Rejected when energy and macronutrients
 * disagree, or when the food itself is unknown: a dead end is better than a
 * number for something nobody could name.
 */
export function aiEstimateFacts(item) {
  const e = item?.estimatedPer100g;
  if (!e || String(item?.searchTermEn ?? '').trim().toLowerCase() === 'unknown') return null;
  const values = [e.calories, e.protein, e.carbs, e.fat];
  if (!values.every(value => Number.isFinite(value) && value >= 0)) return null;
  if (e.calories > 900 || e.protein + e.carbs + e.fat > 100.5) return null;
  const fromMacros = e.protein * 4 + e.carbs * 4 + e.fat * 9;
  if (Math.abs(fromMacros - e.calories) > Math.max(40, e.calories * 0.3)) return null;
  const round = value => Math.round(value * 10) / 10;
  return {
    provider: 'kandro-catalog', referenceId: 'ai-estimate', label: 'Kandro-Schätzung',
    calories: round(e.calories), protein: round(e.protein), carbs: round(e.carbs), fat: round(e.fat),
    matchConfidence: 'medium', estimatedReference: true,
  };
}

/**
 * Clients that cannot store a Kandro estimate (builds before the estimate
 * protocol) must keep the previous correction flow instead of rejecting the
 * whole result as invalid.
 */
export function forEstimateProtocol(detection, input) {
  if (input?.estimates === 1 || !detection || !Array.isArray(detection.items)) return detection;
  return { ...detection, items: detection.items.map(({ estimatedPer100g: _omit, ...item }) => item) };
}

export function buildMealItem(item, facts, index) {
  // Defense against old cache records and malformed provider values.
  if (facts && (![facts.calories, facts.protein, facts.carbs, facts.fat].every(value => Number.isFinite(value) && value >= 0)
    || (facts.calories === 0 && (facts.protein * 4 + facts.carbs * 4 + facts.fat * 9) > 5))) facts = null;
  const count = item.pieceCount;
  const pieceGrams = item.estimatedGrams / count;
  const portions = typeof count === 'number' && Number.isFinite(count) && count >= 0.5 && count <= 99
    && Number.isFinite(pieceGrams) && pieceGrams >= 1 && pieceGrams <= 2000
    && typeof item.pieceLabel === 'string' && item.pieceLabel.trim()
    ? [{ label: item.pieceLabel.trim().slice(0, 80), grams: pieceGrams, estimated: true }]
    : undefined;
  if (!facts) {
    return {
      id: `detected-${index}`,
      name: item.name,
      amountG: item.estimatedGrams,
      baseAmountG: item.estimatedGrams,
      portionFactor: 1,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      confidence: 'medium',
      optional: true,
      // Not included: an ingredient we could not price is worth zero calories
      // only in the arithmetic, never in reality. Counting it silently made a
      // plate of rice disappear from the day. The user sees it flagged on the
      // confirm screen and can add it once the value is corrected.
      included: false,
      source: { provider: 'usda', code: 'unmatched', label: '' },
    };
  }

  const factor = item.estimatedGrams / 100;
  const provider = facts.provider || 'usda';
  const referenceId = String(facts.referenceId || facts.fdcId || 'unknown');
  return {
    id: `${provider}-${referenceId}-${index}`,
    name: item.name,
    amountG: item.estimatedGrams,
    baseAmountG: item.estimatedGrams,
    portionFactor: 1,
    nutritionPer100g: { calories: facts.calories, protein: facts.protein, carbs: facts.carbs, fat: facts.fat, ...(facts.fiber === undefined ? {} : { fiber: facts.fiber }) },
    calories: Math.round(Number(facts.calories) * factor),
    protein: Math.round(Number(facts.protein) * factor),
    carbs: Math.round(Number(facts.carbs) * factor),
    fat: Math.round(Number(facts.fat) * factor),
    ...(facts.fiber === undefined ? {} : { fiber: Math.round(Number(facts.fiber) * factor) }),
    confidence: item.confidence === 'medium' || facts.matchConfidence === 'medium' ? 'medium' : 'high',
    optional: item.optional,
    included: true,
    ...(portions ? { portions } : {}),
    source: {
      provider,
      referenceId,
      label: facts.label || `USDA FDC ${referenceId}`,
      ...(facts.estimatedReference ? { estimatedReference: true } : {}),
    },
  };
}

export function mapUsdaFood(item, food, index) {
  return buildMealItem(item, toFoodFacts(food), index);
}

/**
 * Returns codes, not sentences: one deployed function serves every language,
 * so the app renders the wording from its own dictionary.
 */
export function buildAccuracyWarnings(detection, items) {
  const warnings = [];
  if (detection.items.some(item => item.milkVolumeEstimated)) warnings.push('milk_volume_estimated');
  if (detection.items.some(item => item.drinkVolumeEstimated)) warnings.push('drink_volume_estimated');
  if (detection.amountFallback) warnings.push('amount_estimated');
  if (items.some((item) => item.source?.code === 'unmatched')) {
    warnings.push('unmatched_ingredient');
  }
  if (detection.items.some((item) => item.hiddenCaloriesRisk === 'high')) {
    warnings.push('hidden_calories');
  }
  const widePortionRange = detection.items.some((item) => {
    const low = Number(item.estimatedGramsLow || item.estimatedGrams);
    const high = Number(item.estimatedGramsHigh || item.estimatedGrams);
    return high - low > Math.max(40, Number(item.estimatedGrams) * 0.35);
  });
  if (widePortionRange) {
    warnings.push('wide_portion');
  }
  return warnings;
}

// A partial meal must not become a deceptively complete low-calorie result.
// Use an existing error code understood even by already installed clients.
export function incompleteNutritionError(items) {
  if (!items.length || items.some(item => item.source?.code === 'unmatched'
    || ![item.calories, item.protein, item.carbs, item.fat].every(value => Number.isFinite(value) && value >= 0))) {
    return { status: 422, body: { code: 'missing_nutrition', message: 'Nicht alle Zutaten konnten zuverlässig zugeordnet werden. Bitte Lebensmittel und Zubereitung genauer beschreiben oder die Suche verwenden.' } };
  }
  return null;
}

/** Only correction-capable clients receive a draft. Legacy clients fail closed. */
export function ingredientCorrectionDraft(detection, items, protocol) {
  if (protocol !== 1 || !items.length || !items.some(item => item.source?.code === 'unmatched')) return null;
  // Do not turn malformed resolved values into an editable success.
  if (items.some(item => item.source?.code !== 'unmatched'
    && (![item.calories, item.protein, item.carbs, item.fat].every(value => Number.isFinite(value) && value >= 0)
      || (item.calories === 0 && item.protein * 4 + item.carbs * 4 + item.fat * 9 > 5)))) return null;
  return { status: 200, body: {
    title: detection.title, confidence: 'medium', correctionRequired: true,
    items, warnings: buildAccuracyWarnings(detection, items),
  } };
}

/**
 * The success body for a resolved detection. When the description states an
 * amount Kandro cannot bind safely (detection.amountFallback, formerly a 422
 * mass_required/amount_ambiguous/amount_out_of_range), the recognised foods
 * come back at the model's typical grams, flagged estimatedPortion, so the app
 * opens Confirm with "Portion geschätzt" instead of an error. For
 * correction-capable clients correctionRequired keeps the result in the
 * refunded (free) bucket, exactly like the 422 it replaces.
 */
export function analysisResultBody(detection, items, warnings, correctionProtocol) {
  if (detection.amountFallback) {
    return {
      title: detection.title, confidence: 'medium', items, warnings, estimatedPortion: true,
      ...(correctionProtocol === 1 ? { correctionRequired: true } : {}),
    };
  }
  return { title: detection.title, confidence: detection.confidence, items, warnings };
}

/**
 * Named portions for one USDA row, so the app can offer "1 banana" instead of
 * making someone guess that a banana weighs 126 g.
 *
 * Two shapes come back from the search endpoint: `foodMeasures` on the
 * reference data types (Survey/SR Legacy), and `servingSize` plus
 * `householdServingFullText` on Branded rows. "Quantity not specified" is
 * USDA's placeholder, not a portion anybody recognises, and cup and inch
 * measures are volume dressed as weight — neither belongs in a picker.
 */
const PORTION_NOISE = /\bquantity not specified\b|\bcup\b|\blinear inch\b|\bnlea serving\b/i;

export function usdaPortions(entry) {
  const out = [];
  const seen = new Set();
  const push = (label, grams) => {
    // Branded rows shout their household text ("1 CONTAINER"); a portion
    // picker reads better without the shouting.
    const raw = String(label ?? '').trim();
    const name = raw === raw.toUpperCase() ? raw.toLowerCase() : raw;
    const weight = Number(grams);
    if (!name || !Number.isFinite(weight) || weight < 1 || weight > 2000) return;
    if (PORTION_NOISE.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: name, grams: weight });
  };

  if (entry && typeof entry === 'object') {
    const servingUnit = String(entry.servingSizeUnit ?? '').toLowerCase();
    // Only explicit mass, never assume a density of 1 g/ml.
    if (servingUnit === 'g') {
      push(entry.householdServingFullText || '1 serving', entry.servingSize);
    }
    const measures = Array.isArray(entry.foodMeasures) ? entry.foodMeasures : [];
    for (const measure of [...measures].sort((a, b) => (a?.rank ?? 99) - (b?.rank ?? 99))) {
      push(measure?.disseminationText, measure?.gramWeight);
    }
  }
  return out.slice(0, 4);
}
/** A partial label is not a zero-valued label. Preserve source precision. */
export function openFoodFactsNutrition(values = {}) {
  const number = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  // Only an explicitly labelled kJ field is converted; never guess a unit.
  const kcalPresent = Object.prototype.hasOwnProperty.call(values, 'energy-kcal_100g');
  const kj = number(values['energy-kj_100g']);
  const calories = kcalPresent ? number(values['energy-kcal_100g']) : kj === null ? null : kj / 4.184;
  const protein = number(values.proteins_100g);
  const carbs = number(values.carbohydrates_100g);
  const fat = number(values.fat_100g);
  if ([calories, protein, carbs, fat].some((value) => value === null)) return null;
  // Allow true zero labels, but not an empty energy field disguised as zero.
  if (calories === 0 && protein * 4 + carbs * 4 + fat * 9 > 5) return null;
  const fiber = number(values.fiber_100g);
  return { calories, protein, carbs, fat, ...(fiber === null ? {} : { fiber }) };
}
