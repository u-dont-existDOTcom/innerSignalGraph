import { ValidationError } from "../core/errors.mjs";
import { lexicalTerms } from "./graph.mjs";
import { QUOTE_STOPWORDS } from "./quote-index.mjs";
import { QUOTE_SEARCH_LIMITS } from "./retrieval.mjs";
import { FRENCH_STOPWORDS, foldAccents, frenchLightStem, porterStem } from "./word-forms.mjs";

// The word reading itself (accents, the two stemmers, the French stop words) lives in word-forms.mjs, which the quote ranking shares;
// these names are still exported from here, unchanged.
export { FRENCH_STOPWORDS, foldAccents, frenchLightStem, porterStem };

function invariant(condition, code) { if (!condition) throw new ValidationError(code, { code }); }

// A read-only, content-free check of how many test questions the journal quote search would find if its word matching or its
// ranking changed. The search (findQuotes in retrieval.mjs) ranks quote passages by the words of the query. Here the same ranking
// is computed again in memory, for the search as it is and for variants that fold accents, drop French function words, or reduce
// English and French word forms to a common stem, and for variants that order the passages another way (the passages holding
// more of the query's words first, Okapi BM25, or both), and each question is looked up in every variant. Nothing is read from or
// written to the stored journal: the caller hands in the passages and the questions. Results hold ids and counts only, never
// text, and every error is a bare code.

const VARIANT_FLAGS = Object.freeze(["foldAccents", "frenchStopwords", "englishForms", "frenchForms"]);

/**
 * The ways of ordering the passages that hold some of the query's words, one for each variant (the query's words are chosen the
 * same way under all of them):
 * - "idf_sum": the search's own. A passage scores the sum of log(1 + population / passages holding the word) over the query's words
 *   it holds. Higher score first, then more matched words, then the id.
 * - "coordination": more matched words first, then the idf_sum score, then the id.
 * - "bm25": Okapi BM25 with k1 = 1.2 and b = 0.75, which weighs how often a passage uses a word against how long the passage is.
 *   Higher score first, then more matched words, then the id.
 * - "bm25_coordination": more matched words first, then the BM25 score, then the id.
 */
export const SEARCH_CHECK_SCORINGS = Object.freeze(["idf_sum", "coordination", "bm25", "bm25_coordination"]);

const variantOf = (id, flags) => Object.freeze({ id, foldAccents: false, frenchStopwords: false, englishForms: false, frenchForms: false,
  scoring: "idf_sum", ...flags });

// The reading of the four "forms" variants: accents folded, English and French word forms reduced, French stop words kept in.
const FORMS_READING = Object.freeze({ foldAccents: true, englishForms: true, frenchForms: true });

/**
 * The ways of ranking the check compares, in this order. Each reads words in some way and orders passages with one scoring.
 * "current" reads words exactly and scores with idf_sum, so it ranks exactly as findQuotes does. "accents" folds accents,
 * "french_stopwords" leaves out French function words as well as the English ones, "english_forms" reduces English word forms with
 * the Porter stemmer, "french_forms" reduces French word forms with the light stemmer, and "all" does all four; these six score
 * with idf_sum. The next three read words exactly and change only the scoring: "coordination", "bm25" and "bm25_coordination".
 * The last four read words with accents folded and both stemmers, without the French stop words, and take the four scorings in
 * turn: "forms" (idf_sum), "forms_coordination", "forms_bm25" and "forms_bm25_coordination".
 */
export const SEARCH_CHECK_VARIANTS = Object.freeze([
  variantOf("current", {}),
  variantOf("accents", { foldAccents: true }),
  variantOf("french_stopwords", { frenchStopwords: true }),
  variantOf("english_forms", { englishForms: true }),
  variantOf("french_forms", { frenchForms: true }),
  variantOf("all", { foldAccents: true, frenchStopwords: true, englishForms: true, frenchForms: true }),
  variantOf("coordination", { scoring: "coordination" }),
  variantOf("bm25", { scoring: "bm25" }),
  variantOf("bm25_coordination", { scoring: "bm25_coordination" }),
  variantOf("forms", FORMS_READING),
  variantOf("forms_coordination", { ...FORMS_READING, scoring: "coordination" }),
  variantOf("forms_bm25", { ...FORMS_READING, scoring: "bm25" }),
  variantOf("forms_bm25_coordination", { ...FORMS_READING, scoring: "bm25_coordination" })
]);

function isVariant(value) {
  return value !== null && typeof value === "object" && typeof value.id === "string" && value.id.length > 0
    && VARIANT_FLAGS.every((flag) => typeof value[flag] === "boolean") && SEARCH_CHECK_SCORINGS.includes(value.scoring);
}

function applyVariant(term, variant) {
  let result = term;
  if (variant.foldAccents) result = foldAccents(result);
  if (variant.englishForms) result = porterStem(result);
  if (variant.frenchForms) result = frenchLightStem(result);
  return result;
}

/** A term as a variant reads it: accents folded, then the English stem, then the French stem, each only when the variant says so. */
export function variantTerm(term, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  return applyVariant(term, variant);
}

// One term as a variant reads it. `memo` (a Map or null) remembers the reading of each distinct term, so a long run of passages
// stems a word once.
function readOne(term, variant, memo) {
  if (memo === null) return applyVariant(term, variant);
  let read = memo.get(term);
  if (read === undefined) {
    read = applyVariant(term, variant);
    memo.set(term, read);
  }
  return read;
}

// The terms of a text as a variant reads them, each once, in the order they first appear.
function readTerms(text, variant, memo) {
  const seen = new Set();
  const terms = [];
  for (const term of lexicalTerms(text)) {
    const read = readOne(term, variant, memo);
    if (!seen.has(read)) {
      seen.add(read);
      terms.push(read);
    }
  }
  return terms;
}

// Every token of a text as a variant reads it, in order and with repeats. The normalization and the pattern are the ones of
// lexicalTerms (graph.mjs), which keeps one copy of each token; as there, a value that is not text has no tokens.
function readTokens(text, variant, memo) {
  if (typeof text !== "string") return [];
  const tokens = text.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((token) => readOne(token, variant, memo));
}

/** The terms of a text as a variant reads them: lexicalTerms mapped through variantTerm, each once, in first-appearance order. */
export function variantTermsOf(text, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  return readTerms(text, variant, null);
}

/**
 * Every token of a text as a variant reads it, in order and with repeats: the text is normalized and cut into runs of letters and
 * digits as lexicalTerms does, and each token goes through variantTerm. With the repeats taken out it is variantTermsOf. With them
 * it tells how long the text is and how often each term is used, which is what BM25 weighs. A value that is not text has no tokens.
 */
export function variantTokensOf(text, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  return readTokens(text, variant, null);
}

const stopwordCache = new Map();

/**
 * The words a variant leaves out of the ranking: the English list the search uses (QUOTE_STOPWORDS), plus the French list when the
 * variant says so, each read as the variant reads terms. One set is kept for each variant; callers must not change it.
 */
export function variantStopwords(variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  const key = `${variant.id}:${VARIANT_FLAGS.map((flag) => (variant[flag] ? 1 : 0)).join("")}`;
  if (!stopwordCache.has(key)) {
    const words = variant.frenchStopwords ? [...QUOTE_STOPWORDS, ...FRENCH_STOPWORDS] : [...QUOTE_STOPWORDS];
    stopwordCache.set(key, Object.freeze(new Set(words.map((word) => variantTerm(word, variant)))));
  }
  return stopwordCache.get(key);
}

// Okapi BM25 with the usual constants: k1 limits how much using a word again adds, and b sets how much a passage's length counts
// against it. Then the scorings that use BM25, and the ones that put the passages holding more of the query's words first.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const BM25_SCORINGS = Object.freeze(new Set(["bm25", "bm25_coordination"]));
const COORDINATION_SCORINGS = Object.freeze(new Set(["coordination", "bm25_coordination"]));

// What BM25 needs of an index, kept apart from it and made once, when buildVariantIndex builds an index for a BM25 scoring: how many
// tokens each passage has (every distinct passage listed, those with no words too), and for each term how often each passage that
// holds it uses it (a Uint32Array in the order of the term's postings).
const countings = new WeakMap();

/**
 * The word index of some passages as a variant reads them: a frozen { variant, postings }, where postings maps each term to the
 * sorted ids of the passages that hold it, each id once. `passages` is an array of { id, quote } with every id starting with
 * "passage:", as the search's own word index lists them. For a BM25 scoring the index also keeps, out of sight, how many tokens
 * each passage has and how often it uses each term; there every distinct passage listed is a passage of the index, those with no
 * words too, and a passage listed twice is read once, from its first listing.
 */
export function buildVariantIndex(passages, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  invariant(Array.isArray(passages), "SEARCH_CHECK_INPUT_INVALID");
  const counting = BM25_SCORINGS.has(variant.scoring);
  const memo = new Map();
  // Each term, with the passages that hold it and how many times each uses it (a 1 where the scoring does not count uses).
  const holders = new Map();
  const lengths = new Map();
  const usesOf = (term) => {
    let known = holders.get(term);
    if (known === undefined) {
      known = new Map();
      holders.set(term, known);
    }
    return known;
  };
  for (const passage of passages) {
    invariant(passage !== null && typeof passage === "object" && typeof passage.id === "string" && passage.id.startsWith("passage:")
      && typeof passage.quote === "string", "SEARCH_CHECK_INPUT_INVALID");
    if (!counting) {
      for (const term of readTerms(passage.quote, variant, memo)) usesOf(term).set(passage.id, 1);
    } else if (!lengths.has(passage.id)) {
      const tokens = readTokens(passage.quote, variant, memo);
      lengths.set(passage.id, tokens.length);
      for (const token of tokens) {
        const uses = usesOf(token);
        uses.set(passage.id, (uses.get(passage.id) ?? 0) + 1);
      }
    }
  }
  const postings = new Map();
  const frequencies = new Map();
  for (const [term, uses] of holders) {
    const ids = [...uses.keys()].sort();
    postings.set(term, Object.freeze(ids));
    if (counting) frequencies.set(term, Uint32Array.from(ids, (id) => uses.get(id)));
  }
  const index = Object.freeze({ variant, postings });
  if (counting) countings.set(index, { lengths, frequencies });
  return index;
}

// A ranking works on numbers, which is much faster than on ids: the passages of an index are numbered in id order (the order the
// search settles ties in), and each term gets the numbers of the passages that hold it. Made on first use, kept with the index, and
// good for as long as the index's postings are left alone.
const numberings = new WeakMap();
function numbering(index) {
  let known = numberings.get(index);
  if (known === undefined) {
    const holding = new Set();
    for (const ids of index.postings.values()) for (const id of ids) holding.add(id);
    const ids = [...holding].sort((left, right) => left.localeCompare(right));
    const numberOf = new Map(ids.map((id, number) => [id, number]));
    const holders = new Map();
    for (const [term, termIds] of index.postings) holders.set(term, Int32Array.from(termIds, (id) => numberOf.get(id)));
    known = { ids, holders, counted: countedNumbers(index, ids) };
    numberings.set(index, known);
  }
  return known;
}

// What BM25 needs, by passage number, or null for an index that was not made for a BM25 scoring: how many passages the index has,
// how often each holder of a term uses it (in the order of the term's holders), and each passage's length factor
// 1 - b + b * length / mean length. The mean is taken over every passage of the index, and counts as 1 when it is 0.
function countedNumbers(index, ids) {
  const counts = countings.get(index);
  if (counts === undefined) return null;
  let tokens = 0;
  for (const length of counts.lengths.values()) tokens += length;
  const mean = tokens / counts.lengths.size || 1;
  return { passages: counts.lengths.size, frequencies: counts.frequencies,
    factors: Float64Array.from(ids, (id) => 1 - BM25_B + BM25_B * counts.lengths.get(id) / mean) };
}

/**
 * The passage ids a word search over `index` returns for `query`, best first, with the variant's reading of terms and stop words
 * and the variant's scoring. Under "idf_sum" this is exactly the order findQuotes gives by words. The query's terms are chosen the
 * same way under every scoring: the ones not in the stop word list, or all of them when none is left, cut to the first `termsMax`;
 * a term no passage holds is skipped. Then, by scoring (`matched` is how many of those terms a passage holds):
 * - idf_sum: each term adds log(1 + population / passages holding it) to a passage's score; the order is higher score, then more
 *   matched terms, then id. `population` is the number of nodes in the generation the search would read (its manifest's node_count).
 * - coordination: more matched terms, then the idf_sum score, then id.
 * - bm25: each term adds idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * length / mean length)) to a passage's score, where
 *   idf = log(1 + (P - df + 0.5) / (df + 0.5)), P is how many passages the index has, df how many hold the term, tf how often the
 *   passage uses it, length how many tokens the passage has (stop words included), k1 = 1.2 and b = 0.75. The order is higher score,
 *   then more matched terms, then id. `population` must be given but is not used.
 * - bm25_coordination: more matched terms, then the BM25 score, then id.
 * A query with no terms gives []. An index for a BM25 scoring must have been made by buildVariantIndex.
 */
export function rankPassages({ index, query, population, termsMax = QUOTE_SEARCH_LIMITS.termsMax } = {}) {
  invariant(index !== null && typeof index === "object" && index.postings instanceof Map && isVariant(index.variant)
    && typeof query === "string" && Number.isSafeInteger(population) && population >= 0
    && Number.isSafeInteger(termsMax) && termsMax >= 1, "SEARCH_CHECK_INPUT_INVALID");
  const { scoring } = index.variant;
  invariant(!BM25_SCORINGS.has(scoring) || countings.has(index), "SEARCH_CHECK_INPUT_INVALID");
  const allTerms = readTerms(query, index.variant, null);
  if (!allTerms.length) return [];
  const stopwords = variantStopwords(index.variant);
  const content = allTerms.filter((term) => !stopwords.has(term));
  const terms = (content.length ? content : allTerms).slice(0, termsMax);
  const total = Math.max(1, population);
  // `counted` is there exactly when the scoring is a BM25 one.
  const { ids, holders, counted } = numbering(index);
  const scores = new Float64Array(ids.length);
  const matched = new Uint32Array(ids.length);
  const touched = [];
  for (const term of terms) {
    const numbers = holders.get(term);
    if (numbers === undefined) continue;
    if (counted === null) {
      const weight = Math.log(1 + total / numbers.length);
      for (const number of numbers) {
        if (matched[number] === 0) touched.push(number);
        scores[number] += weight;
        matched[number] += 1;
      }
    } else {
      const weight = Math.log(1 + (counted.passages - numbers.length + 0.5) / (numbers.length + 0.5));
      const uses = counted.frequencies.get(term);
      for (let position = 0; position < numbers.length; position += 1) {
        const number = numbers[position];
        const tf = uses[position];
        if (matched[number] === 0) touched.push(number);
        scores[number] += weight * tf * (BM25_K1 + 1) / (tf + BM25_K1 * counted.factors[number]);
        matched[number] += 1;
      }
    }
  }
  // Passage numbers run in id order, so the last tie-break is the numbers themselves.
  const byScore = (left, right) => scores[right] - scores[left] || matched[right] - matched[left] || left - right;
  const byMatched = (left, right) => matched[right] - matched[left] || scores[right] - scores[left] || left - right;
  touched.sort(COORDINATION_SCORINGS.has(scoring) ? byMatched : byScore);
  return touched.map((number) => ids[number]);
}

const COUNTED_STATUSES = Object.freeze(new Set(["complete", "marked"]));

// The fixed ranges the questions are sorted into by the best rank of their passage; a passage no search ranks has no rank.
function rankBucket(rank) {
  if (rank === Infinity) return "not_ranked";
  if (rank <= 12) return "top_12";
  if (rank <= 24) return "from_13_to_24";
  if (rank <= 40) return "from_25_to_40";
  return rank <= 100 ? "from_41_to_100" : "over_100";
}

/**
 * How many of the test questions each variant would find. The questions are the ones the measurement counts: those of units whose
 * status is "complete" or "marked", leaving out any question flagged `copied`. A question's passage comes from
 * `passageIdForUnit(question.unit_id)`. The question's best rank is the smallest 1-based rank of that passage among the results
 * of its queries (Infinity when none ranks it); it is found at a cutoff when that rank is at most the cutoff. Each distinct query
 * is ranked once for each variant, and each variant's index is built once. `variants` is SEARCH_CHECK_VARIANTS (all thirteen) unless
 * the caller gives its own.
 *
 * Returns a frozen { questions, variants }, where `questions` is how many questions were counted and `variants[id]` holds
 * `found` (the set of question ids found at each cutoff), `counts` (the size of each set) and `buckets` (how many questions have
 * their best rank in top_12, from_13_to_24, from_25_to_40, from_41_to_100, over_100, or not_ranked). It holds ids and counts only.
 */
export function checkQuestions({ units, passageIdForUnit, passages, population, variants = SEARCH_CHECK_VARIANTS,
  cutoffs = [12, 24, 40] } = {}) {
  invariant(Array.isArray(units) && typeof passageIdForUnit === "function" && Array.isArray(passages)
    && Number.isSafeInteger(population) && population >= 0, "SEARCH_CHECK_INPUT_INVALID");
  invariant(Array.isArray(variants) && variants.length > 0 && variants.every(isVariant)
    && new Set(variants.map((variant) => variant.id)).size === variants.length, "SEARCH_CHECK_INPUT_INVALID");
  invariant(Array.isArray(cutoffs) && cutoffs.length > 0 && cutoffs.every((cutoff) => Number.isSafeInteger(cutoff) && cutoff >= 1)
    && new Set(cutoffs).size === cutoffs.length, "SEARCH_CHECK_INPUT_INVALID");

  // The counted questions, and for each distinct query the passages it has to find.
  const questions = [];
  const questionIds = new Set();
  const targetsByQuery = new Map();
  for (const unit of units) {
    invariant(unit !== null && typeof unit === "object", "SEARCH_CHECK_INPUT_INVALID");
    if (!COUNTED_STATUSES.has(unit.status)) continue;
    invariant(Array.isArray(unit.questions), "SEARCH_CHECK_INPUT_INVALID");
    for (const question of unit.questions) {
      invariant(question !== null && typeof question === "object" && typeof question.question_id === "string"
        && Array.isArray(question.queries) && question.queries.every((query) => typeof query === "string"), "SEARCH_CHECK_INPUT_INVALID");
      if (question.copied === true) continue;
      const passageId = passageIdForUnit(question.unit_id);
      invariant(typeof passageId === "string" && !questionIds.has(question.question_id), "SEARCH_CHECK_INPUT_INVALID");
      questionIds.add(question.question_id);
      const queries = [...new Set(question.queries)];
      questions.push({ questionId: question.question_id, passageId, queries });
      for (const query of queries) {
        if (!targetsByQuery.has(query)) targetsByQuery.set(query, new Set());
        targetsByQuery.get(query).add(passageId);
      }
    }
  }

  const byVariant = [];
  for (const variant of variants) {
    const index = buildVariantIndex(passages, variant);
    // Each distinct query is ranked once; what is kept is the rank of the passages some question wants from it.
    const ranksByQuery = new Map();
    for (const [query, targets] of targetsByQuery) {
      const ranked = rankPassages({ index, query, population });
      const ranks = new Map();
      for (let position = 0; position < ranked.length && ranks.size < targets.size; position += 1) {
        if (targets.has(ranked[position])) ranks.set(ranked[position], position + 1);
      }
      ranksByQuery.set(query, ranks);
    }
    const found = {};
    for (const cutoff of cutoffs) found[cutoff] = new Set();
    const buckets = { top_12: 0, from_13_to_24: 0, from_25_to_40: 0, from_41_to_100: 0, over_100: 0, not_ranked: 0 };
    for (const { questionId, passageId, queries } of questions) {
      let best = Infinity;
      for (const query of queries) best = Math.min(best, ranksByQuery.get(query).get(passageId) ?? Infinity);
      for (const cutoff of cutoffs) if (best <= cutoff) found[cutoff].add(questionId);
      buckets[rankBucket(best)] += 1;
    }
    const counts = {};
    for (const cutoff of cutoffs) counts[cutoff] = found[cutoff].size;
    byVariant.push([variant.id, Object.freeze({ found: Object.freeze(found), counts: Object.freeze(counts),
      buckets: Object.freeze(buckets) })]);
  }
  return Object.freeze({ questions: questions.length, variants: Object.freeze(Object.fromEntries(byVariant)) });
}
