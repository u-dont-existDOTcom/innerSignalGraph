import { ValidationError } from "../core/errors.mjs";
import { lexicalTerms } from "./graph.mjs";
import { QUOTE_STOPWORDS } from "./quote-index.mjs";
import { QUOTE_SEARCH_LIMITS } from "./retrieval.mjs";

function invariant(condition, code) { if (!condition) throw new ValidationError(code, { code }); }

// A read-only, content-free check of how many test questions the journal quote search would find if its word matching changed.
// The search (findQuotes in retrieval.mjs) ranks quote passages by the words of the query. Here the same ranking is computed
// again in memory, for the search as it is and for variants that fold accents, drop French function words, or reduce English
// and French word forms to a common stem, and each question is looked up in every variant. Nothing is read from or written to
// the stored journal: the caller hands in the passages and the questions. Results hold ids and counts only, never text, and
// every error is a bare code.

// Common French function words in lower case with their accents: articles, pronouns, prepositions, conjunctions and forms of the
// two auxiliary verbs. The single letters are what an apostrophe leaves behind, as "l'ami" reads as "l" and "ami".
export const FRENCH_STOPWORDS = Object.freeze(new Set(("à au aux avec ce ces c ça cela ceci cet cette celle celles celui ceux chez comme "
  + "contre dans de des d depuis donc dont du elle elles en entre et eux il ils j je l la le les leur leurs lui m ma mais me même mes moi "
  + "mon n ne ni nos notre nous on ou où par parce pas pendant plus pour qu quand que quel quelle quelles quels qui quoi s sa sans se "
  + "selon ses si soi son sous sur t ta te tes toi ton tous tout toute toutes tu un une vers vos votre vous y or car alors ainsi aussi "
  + "après avant lorsque puisque lorsqu puisqu jusqu suis es est sommes êtes sont été étais était étions étaient sera serait soit fut "
  + "être ai as a avons avez ont avais avait avaient aura aurait eu avoir").split(" ")));

/**
 * A term with its accents taken off: "déprimé" becomes "deprime". Ligatures such as "œ" are letters of their own and stay.
 * The term is decomposed, every combining mark is removed, and what is left is composed again.
 */
export function foldAccents(term) {
  invariant(typeof term === "string", "SEARCH_CHECK_INPUT_INVALID");
  return term.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

// The English stemmer below follows M. F. Porter, "An algorithm for suffix stripping", Program 14(3), 1980: steps 1a, 1b (with its
// tidying of the stem it leaves), 1c, 2, 3, 4, 5a and 5b, with the paper's rules as written ("abli" becomes "able", and there is
// no "logi" rule). Like the usual reference code, it leaves words of two letters or fewer alone.

// Whether each letter is a consonant: any letter but a, e, i, o, u, and a "y" is a vowel when a consonant comes just before it.
function consonantFlags(word) {
  const flags = [];
  for (let index = 0; index < word.length; index += 1) {
    const letter = word[index];
    flags.push(letter === "y" ? index === 0 || !flags[index - 1] : !"aeiou".includes(letter));
  }
  return flags;
}

// Porter's measure m of a stem: how many times a run of vowels is followed by a run of consonants.
function porterMeasure(stem) {
  const flags = consonantFlags(stem);
  let measure = 0;
  for (let index = 1; index < flags.length; index += 1) if (flags[index] && !flags[index - 1]) measure += 1;
  return measure;
}

const hasVowel = (stem) => consonantFlags(stem).some((isConsonant) => !isConsonant);

function endsInDoubleConsonant(stem) {
  const last = stem.length - 1;
  return last >= 1 && stem[last] === stem[last - 1] && consonantFlags(stem)[last];
}

// The stem ends consonant, vowel, consonant, and that last consonant is not w, x or y (Porter's "*o").
function endsInCvc(stem) {
  const flags = consonantFlags(stem);
  const last = stem.length - 1;
  return last >= 2 && flags[last] && !flags[last - 1] && flags[last - 2] && !"wxy".includes(stem[last]);
}

// Rules are tried from the longest suffix to the shortest. The first suffix that matches decides: when its condition on the stem
// fails, the word is left as it is and no shorter suffix is tried.
const longestFirst = (rules) => Object.freeze(rules.sort((left, right) => right[0].length - left[0].length));
const PORTER_STEP_2 = longestFirst([["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"],
  ["abli", "able"], ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"],
  ["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"],
  ["biliti", "ble"]]);
const PORTER_STEP_3 = longestFirst([["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""],
  ["ness", ""]]);
const PORTER_STEP_4 = Object.freeze(["ement", "ance", "ence", "able", "ible", "ment", "ant", "ent", "ion", "ism", "ate", "iti", "ous",
  "ive", "ize", "al", "er", "ic", "ou"]);

// Step 1a: plurals. sses -> ss, ies -> i, ss -> ss, and a final s goes.
function porterStep1a(word) {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}i`;
  if (word.endsWith("ss")) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

// Step 1b: -eed, -ed and -ing. "eed" becomes "ee" when the stem has m > 0. "ed" and "ing" go when the stem holds a vowel, and then
// the stem is tidied: at -> ate, bl -> ble, iz -> ize, a double consonant other than l, s or z loses one letter, and a short stem
// of the form consonant-vowel-consonant (m = 1) gets an "e" back.
function porterStep1b(word) {
  if (word.endsWith("eed")) return porterMeasure(word.slice(0, -3)) > 0 ? word.slice(0, -1) : word;
  let stem;
  if (word.endsWith("ed")) stem = word.slice(0, -2);
  else if (word.endsWith("ing")) stem = word.slice(0, -3);
  else return word;
  if (!hasVowel(stem)) return word;
  if (stem.endsWith("at") || stem.endsWith("bl") || stem.endsWith("iz")) return `${stem}e`;
  if (endsInDoubleConsonant(stem)) return "lsz".includes(stem[stem.length - 1]) ? stem : stem.slice(0, -1);
  return porterMeasure(stem) === 1 && endsInCvc(stem) ? `${stem}e` : stem;
}

// Step 1c: a final y becomes i when the stem before it holds a vowel.
function porterStep1c(word) {
  return word.endsWith("y") && hasVowel(word.slice(0, -1)) ? `${word.slice(0, -1)}i` : word;
}

// Steps 2 and 3: the longest matching suffix is replaced when the stem before it has m > 0.
function porterReplace(word, rules) {
  for (const [suffix, replacement] of rules) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    return porterMeasure(stem) > 0 ? `${stem}${replacement}` : word;
  }
  return word;
}

// Step 4: the longest matching suffix goes when the stem before it has m > 1; "ion" goes only after an s or a t.
function porterStep4(word) {
  for (const suffix of PORTER_STEP_4) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length);
    if (suffix === "ion" && !/[st]$/u.test(stem)) return word;
    return porterMeasure(stem) > 1 ? stem : word;
  }
  return word;
}

// Step 5a: a final e goes when m > 1, or when m = 1 and the stem does not end consonant-vowel-consonant. Step 5b: a double l at
// the end loses one l when m > 1.
function porterStep5(word) {
  let result = word;
  if (result.endsWith("e")) {
    const stem = result.slice(0, -1);
    const measure = porterMeasure(stem);
    if (measure > 1 || (measure === 1 && !endsInCvc(stem))) result = stem;
  }
  return result.endsWith("ll") && porterMeasure(result) > 1 ? result.slice(0, -1) : result;
}

/**
 * The Porter (1980) stem of a lower case English word: "caresses" gives "caress", "relational" gives "relat". A word of two
 * letters or fewer, and any word with a character outside a-z (an accented French word, a number, a capital letter), comes back
 * unchanged.
 */
export function porterStem(word) {
  invariant(typeof word === "string", "SEARCH_CHECK_INPUT_INVALID");
  if (word.length <= 2 || !/^[a-z]+$/u.test(word)) return word;
  let stem = porterStep1c(porterStep1b(porterStep1a(word)));
  stem = porterReplace(stem, PORTER_STEP_2);
  stem = porterReplace(stem, PORTER_STEP_3);
  return porterStep5(porterStep4(stem));
}

// A light French stemmer in the spirit of Jacques Savoy's light stemmer (the one behind Lucene's FrenchLightStemmer). It takes off
// plural and feminine marks and the endings of the most common inflections, and does no more than that. Every rule leaves at
// least three letters before the part it takes off, so short words stay whole. It works on lower case words, with or without
// accents, and leaves a word of three letters or fewer, or one with a character that is not a letter, as it is. A stem can end up
// the same as an unrelated short word (mois -> moi): that is the price of a light stemmer.
//
// Endings, [suffix, replacement, letters that must stay before the suffix (3 unless given)]. The first one that fits is used, and
// only one is. A suffix fits when the word ends with it and enough letters come before it. Adverbs come first, because they end
// in the longer suffixes.
const FRENCH_ENDINGS = Object.freeze([
  ["emment", "ent"], // évidemment -> évident: the adverb of an adjective in -ent
  ["amment", "ant"], // constamment -> constant: the adverb of an adjective in -ant
  ["eusement", "eu"], // heureusement -> heureu: as "heureuse" and "heureux" come out below
  ["ivement", "if"], // activement -> actif: as "active" comes out below
  ["ement", ""], // lentement -> lent, doucement -> douc: the adverb of the feminine form (also gouvernement -> gouvern)
  ["ément", ""], // précisément -> précis
  ["iment", "i"], // vraiment -> vrai: the adverb of an adjective in -i
  ["ument", "u"], // absolument -> absolu: the adverb of an adjective in -u
  ["ée", ""], // déprimée -> déprim: the feminine past participle
  ["ee", ""], // the same once accents are folded
  ["é", ""], // déprimé -> déprim: the past participle
  ["er", ""], // déprimer -> déprim: the infinitive
  ["ez", ""], // déprimez -> déprim: you (plural) form
  ["euse", "eu"], // heureuse -> heureu: the feminine of -eux
  ["ive", "if"], // active -> actif: the feminine of -if
  ["ère", "", 4], // dernière -> derni: the feminine of -ier, which loses its -er as the infinitive does (four letters stay: colère)
  ["ere", "", 4], // the same once accents are folded
  ["e", ""] // petite -> petit: the feminine, and a final e in general
]);

/**
 * The light stem of a lower case French word. Steps, in order:
 * 1. Plural. "-aux" becomes "-al" when the word has six letters or more and the letter before the "aux" is not "e" (chevaux ->
 *    cheval); otherwise a final "x" or "s" goes (amis -> ami, prix -> pri, bateaux -> bateau).
 * 2. The first fitting ending in FRENCH_ENDINGS: adverbs (-ement, -iment, -ument), past participles (-é, -ée), the infinitive
 *    (-er), the "vous" form (-ez), the feminine of a few common adjectives (-euse, -ive, -ère) and a final "e".
 * 3. A stem of four letters or more that ends in a doubled consonant loses one (bonne -> bonn -> bon, ville -> vil). This is done
 *    for every word, so that a singular and its plural, or a masculine and its feminine, still come out the same.
 */
export function frenchLightStem(word) {
  invariant(typeof word === "string", "SEARCH_CHECK_INPUT_INVALID");
  if (word.length <= 3 || !/^\p{L}+$/u.test(word)) return word;
  let stem = word;
  if (stem.endsWith("aux") && stem.length >= 6 && stem[stem.length - 4] !== "e") stem = `${stem.slice(0, -3)}al`;
  else if ((stem.endsWith("x") || stem.endsWith("s")) && stem.length >= 4) stem = stem.slice(0, -1);
  for (const [suffix, replacement, keep = 3] of FRENCH_ENDINGS) {
    if (stem.endsWith(suffix) && stem.length - suffix.length >= keep) {
      stem = `${stem.slice(0, stem.length - suffix.length)}${replacement}`;
      break;
    }
  }
  if (stem.length >= 4 && /([bcdfgklmnprstz])\1$/u.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

const VARIANT_FLAGS = Object.freeze(["foldAccents", "frenchStopwords", "englishForms", "frenchForms"]);
const variantOf = (id, flags) => Object.freeze({ id, foldAccents: false, frenchStopwords: false, englishForms: false, frenchForms: false,
  ...flags });

/**
 * The ways of matching words the check compares, in this order. "current" changes nothing and ranks exactly as findQuotes does.
 * "accents" folds accents, "french_stopwords" also leaves out French function words, "english_forms" reduces English word forms
 * with the Porter stemmer, "french_forms" reduces French word forms with the light stemmer, and "all" does all four.
 */
export const SEARCH_CHECK_VARIANTS = Object.freeze([
  variantOf("current", {}),
  variantOf("accents", { foldAccents: true }),
  variantOf("french_stopwords", { frenchStopwords: true }),
  variantOf("english_forms", { englishForms: true }),
  variantOf("french_forms", { frenchForms: true }),
  variantOf("all", { foldAccents: true, frenchStopwords: true, englishForms: true, frenchForms: true })
]);

function isVariant(value) {
  return value !== null && typeof value === "object" && typeof value.id === "string" && value.id.length > 0
    && VARIANT_FLAGS.every((flag) => typeof value[flag] === "boolean");
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

// The terms of a text as a variant reads them, each once, in the order they first appear. `memo` (a Map or null) remembers the
// reading of each distinct term, so a long run of passages stems a word once.
function readTerms(text, variant, memo) {
  const seen = new Set();
  const terms = [];
  for (const term of lexicalTerms(text)) {
    let read = memo === null ? undefined : memo.get(term);
    if (read === undefined) {
      read = applyVariant(term, variant);
      if (memo !== null) memo.set(term, read);
    }
    if (!seen.has(read)) {
      seen.add(read);
      terms.push(read);
    }
  }
  return terms;
}

/** The terms of a text as a variant reads them: lexicalTerms mapped through variantTerm, each once, in first-appearance order. */
export function variantTermsOf(text, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  return readTerms(text, variant, null);
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

/**
 * The word index of some passages as a variant reads them: a frozen { variant, postings }, where postings maps each term to the
 * sorted ids of the passages that hold it, each id once. `passages` is an array of { id, quote } with every id starting with
 * "passage:", as the search's own word index lists them.
 */
export function buildVariantIndex(passages, variant) {
  invariant(isVariant(variant), "SEARCH_CHECK_INPUT_INVALID");
  invariant(Array.isArray(passages), "SEARCH_CHECK_INPUT_INVALID");
  const memo = new Map();
  const holders = new Map();
  for (const passage of passages) {
    invariant(passage !== null && typeof passage === "object" && typeof passage.id === "string" && passage.id.startsWith("passage:")
      && typeof passage.quote === "string", "SEARCH_CHECK_INPUT_INVALID");
    for (const term of readTerms(passage.quote, variant, memo)) {
      if (!holders.has(term)) holders.set(term, new Set());
      holders.get(term).add(passage.id);
    }
  }
  const postings = new Map();
  for (const [term, ids] of holders) postings.set(term, Object.freeze([...ids].sort()));
  return Object.freeze({ variant, postings });
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
    known = { ids, holders };
    numberings.set(index, known);
  }
  return known;
}

/**
 * The passage ids a word search over `index` returns for `query`, best first, exactly as findQuotes orders them by words, but
 * with the variant's reading of terms and stop words. As there: the query's terms are the ones not in the stop word list, or all
 * of them when none is left, cut to the first `termsMax`; a term no passage holds is skipped; each term adds log(1 + population /
 * passages holding it) to a passage's score; the order is higher score, then more matched terms, then id. `population` is the
 * number of nodes in the generation the search would read (its manifest's node_count). A query with no terms gives [].
 */
export function rankPassages({ index, query, population, termsMax = QUOTE_SEARCH_LIMITS.termsMax } = {}) {
  invariant(index !== null && typeof index === "object" && index.postings instanceof Map && isVariant(index.variant)
    && typeof query === "string" && Number.isSafeInteger(population) && population >= 0
    && Number.isSafeInteger(termsMax) && termsMax >= 1, "SEARCH_CHECK_INPUT_INVALID");
  const allTerms = readTerms(query, index.variant, null);
  if (!allTerms.length) return [];
  const stopwords = variantStopwords(index.variant);
  const content = allTerms.filter((term) => !stopwords.has(term));
  const terms = (content.length ? content : allTerms).slice(0, termsMax);
  const total = Math.max(1, population);
  const { ids, holders } = numbering(index);
  const scores = new Float64Array(ids.length);
  const matched = new Uint32Array(ids.length);
  const touched = [];
  for (const term of terms) {
    const numbers = holders.get(term);
    if (numbers === undefined) continue;
    const weight = Math.log(1 + total / numbers.length);
    for (const number of numbers) {
      if (matched[number] === 0) touched.push(number);
      scores[number] += weight;
      matched[number] += 1;
    }
  }
  // Passage numbers run in id order, so the last tie-break is the numbers themselves.
  touched.sort((left, right) => scores[right] - scores[left] || matched[right] - matched[left] || left - right);
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
 * is ranked once for each variant, and each variant's index is built once.
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
