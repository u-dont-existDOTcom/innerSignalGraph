import { ValidationError } from "../core/errors.mjs";
import { lexicalTerms } from "./graph.mjs";
import { QUOTE_STOPWORDS } from "./quote-index.mjs";

function invariant(condition, code) { if (!condition) throw new ValidationError(code, { code }); }

// How words are read to match them across their forms: accents folded, English forms reduced with the Porter stemmer, and French
// forms with a light stemmer. The journal search check (search-check.mjs) compares ways of matching words, and the quote ranking of
// version 3 of the quote index reads words the way its "forms" variants do, so both take the reading from here. This module imports
// only the graph's word splitting and the quote index's English stop words; the quote index itself never imports it.

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

/**
 * A term as the forms reading takes it, which is what the "forms" variants of the search check do: accents folded, then the English
 * stem, then the French stem. French stop words are not left out of it.
 */
export function formsReadingTerm(term) {
  return frenchLightStem(porterStem(foldAccents(term)));
}

// The forms reading of one term, remembered in `memo` (a Map or null), so a long run of text stems a word once.
function readFormsTerm(term, memo) {
  if (memo === null) return formsReadingTerm(term);
  let read = memo.get(term);
  if (read === undefined) {
    read = formsReadingTerm(term);
    memo.set(term, read);
  }
  return read;
}

/**
 * Every token of a text as the forms reading takes it, in order and with repeats: the text is normalized and cut into runs of letters
 * and digits as lexicalTerms (graph.mjs) does, and each token is read. Its length is how long the text is, in tokens with the stop
 * words in. A value that is not text has no tokens. `memo` is an optional Map that remembers the reading of each distinct token.
 */
export function formsReadingTokens(text, memo = null) {
  if (typeof text !== "string") return [];
  const tokens = text.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((token) => readFormsTerm(token, memo));
}

let formsStopwords = null;

/** The English stop words of the quote search (QUOTE_STOPWORDS), each read as the forms reading takes terms. Callers must not change it. */
export function formsReadingStopwords() {
  if (formsStopwords === null) formsStopwords = Object.freeze(new Set([...QUOTE_STOPWORDS].map((word) => formsReadingTerm(word))));
  return formsStopwords;
}

/**
 * The terms of a query the forms reading ranks by, chosen as the search check's rankPassages chooses them: the query's words read
 * with the forms reading, each once in the order they first appear, without the stop words unless none is left, cut to the first
 * `termsMax`. Returns { all, terms }: every distinct term read, and the ones chosen.
 */
export function formsQueryTerms(query, termsMax) {
  invariant(typeof query === "string" && Number.isSafeInteger(termsMax) && termsMax >= 1, "SEARCH_CHECK_INPUT_INVALID");
  const memo = new Map();
  const all = [...new Set(lexicalTerms(query).map((term) => readFormsTerm(term, memo)))];
  const stopwords = formsReadingStopwords();
  const content = all.filter((term) => !stopwords.has(term));
  return { all, terms: (content.length ? content : all).slice(0, termsMax) };
}
