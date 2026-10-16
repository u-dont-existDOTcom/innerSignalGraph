import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lexicalTerms, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { QUOTE_STOPWORDS, buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { FRENCH_STOPWORDS, SEARCH_CHECK_SCORINGS, SEARCH_CHECK_VARIANTS, buildVariantIndex, checkQuestions, foldAccents,
  frenchLightStem, porterStem, rankPassages, variantStopwords, variantTerm, variantTermsOf,
  variantTokensOf } from "../src/journal-import/search-check.mjs";
import { buildQuoteTermsFromGraph } from "../src/journal-import/quote-terms.mjs";
import * as wordForms from "../src/journal-import/word-forms.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

// The search check (src/journal-import/search-check.mjs): the journal quote search's word ranking computed again in memory, for the
// search as it is and for variants of its word matching and of its scoring, and the count of test questions each variant would find.
// All text here is invented.

const [CURRENT, ACCENTS, FRENCH_STOP, ENGLISH_FORMS, FRENCH_FORMS, ALL, COORDINATION, BM25, BM25_COORDINATION, FORMS, FORMS_COORDINATION,
  FORMS_BM25, FORMS_BM25_COORDINATION] = SEARCH_CHECK_VARIANTS;
const INVALID = { code: "SEARCH_CHECK_INPUT_INVALID" };

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};
const passage = (number, quote) => ({ id: `passage:${String(number).padStart(3, "0")}`, quote });
const idsOf = (...numbers) => numbers.map((number) => `passage:${String(number).padStart(3, "0")}`);
const repeat = (count, word) => Array(count).fill(word).join(" ");
const rankWith = (variant, passages, query, population = 10) => rankPassages({ index: buildVariantIndex(passages, variant), query,
  population });

test("the Porter stemmer gives the classic examples of the 1980 paper", () => {
  const classic = { caresses: "caress", ponies: "poni", ties: "ti", caress: "caress", cats: "cat", feed: "feed", agreed: "agre",
    plastered: "plaster", bled: "bled", motoring: "motor", sing: "sing", conflated: "conflat", troubled: "troubl", sized: "size",
    hopping: "hop", tanned: "tan", falling: "fall", hissing: "hiss", fizzed: "fizz", failing: "fail", filing: "file", happy: "happi",
    sky: "sky", relational: "relat", conditional: "condit", rational: "ration", generalization: "gener", adjustable: "adjust",
    electricity: "electr", controll: "control", roll: "roll" };
  for (const [word, stem] of Object.entries(classic)) assert.equal(porterStem(word), stem, word);
  // More of the paper's examples, through the whole algorithm.
  const more = { hopefulness: "hope", goodness: "good", formative: "form", replacement: "replac", adjustment: "adjust", revival: "reviv",
    probate: "probat", cease: "ceas", rate: "rate", consignment: "consign", consistency: "consist", conspicuous: "conspicu",
    generous: "gener", organization: "organ", dies: "di" };
  for (const [word, stem] of Object.entries(more)) assert.equal(porterStem(word), stem, word);
});

test("the Porter stemmer leaves short words, accented words and anything outside a-z alone", () => {
  for (const word of ["a", "is", "it", "as", "by", "ed", "ss"]) assert.equal(porterStem(word), word, "two letters or fewer");
  for (const word of ["déprimé", "naïve", "œuvres", "garçons", "Cats", "CARESSES", "2019", "k9", "3rd", "co-op", ""]) {
    assert.equal(porterStem(word), word, word);
  }
  assert.throws(() => porterStem(42), INVALID);
});

test("the French light stemmer puts the plural, the feminine and the common verb forms of a word together", () => {
  const families = [
    ["cheval", "chevaux"], ["journal", "journaux", "journale"], ["animal", "animaux"], ["bateau", "bateaux"], ["beau", "beaux"],
    ["ami", "amie", "amis", "amies"], ["petit", "petite", "petits", "petites"], ["grand", "grande", "grands", "grandes"],
    ["déprim", "déprimé", "déprimée", "déprimés", "déprimées", "déprimer", "déprimez", "déprime", "déprimes"],
    ["deprim", "deprime", "deprimee", "deprimes", "deprimees", "deprimer", "deprimez"],
    ["lent", "lente", "lentement"], ["heureu", "heureux", "heureuse", "heureuses", "heureusement"],
    ["actif", "active", "actives", "activement"], ["vrai", "vraiment"], ["évident", "évidemment"], ["constant", "constamment"],
    ["absolu", "absolument"], ["bon", "bonne", "bonnes", "bons", "bonnement"], ["ancien", "ancienne", "anciennes"],
    ["réel", "réelle", "réelles", "réellement"], ["premi", "premier", "première", "premiers", "premières"],
    ["aim", "aime", "aimes", "aimé", "aimée", "aimer", "aimez"], ["arriv", "arrivé", "arrivée", "arrivées", "arriver", "arrivez"],
    ["gouvern", "gouvernement", "gouvernements", "gouverner"], ["mond", "monde", "mondes"], ["écol", "école", "écoles"]
  ];
  for (const [stem, ...words] of families) for (const word of words) assert.equal(frenchLightStem(word), stem, word);
  assert.equal(frenchLightStem("chevaux"), frenchLightStem("cheval"));
});

test("the French light stemmer keeps at least three letters of a word and leaves what is not a word alone", () => {
  // Three letters or fewer: unchanged.
  for (const word of ["les", "des", "une", "pas", "bus", "nez", "été", "ses", "eux"]) assert.equal(frenchLightStem(word), word, word);
  // Nothing is cut that would leave fewer than three letters in front of it.
  assert.equal(frenchLightStem("chez"), "chez");
  assert.equal(frenchLightStem("vues"), "vue");
  assert.equal(frenchLightStem("vue"), "vue");
  assert.equal(frenchLightStem("bras"), "bra");
  assert.equal(frenchLightStem("idée"), "idé");
  assert.equal(frenchLightStem("élément"), "élément");
  assert.equal(frenchLightStem("moment"), "moment");
  assert.equal(frenchLightStem("aiment"), "aiment");
  assert.equal(frenchLightStem("colère"), "colèr", "four letters must stay before -ère");
  // "-eaux" and short "-aux" words lose only the x.
  assert.equal(frenchLightStem("eaux"), "eau");
  assert.equal(frenchLightStem("faux"), "fau");
  // Accents stay in the stem; digits and marks make a word no word at all.
  assert.equal(frenchLightStem("écoles"), "écol");
  for (const word of ["2019s", "1990", "3e", "écoles", "aime-t-il"]) assert.equal(frenchLightStem(word), word, word);
  assert.throws(() => frenchLightStem(null), INVALID);
});

test("foldAccents takes off accents and leaves ligatures and unaccented text as they are", () => {
  assert.equal(foldAccents("déprimé"), "deprime");
  assert.equal(foldAccents("naïve"), "naive");
  assert.equal(foldAccents("garçon"), "garcon");
  assert.equal(foldAccents("ÉCOLE"), "ECOLE");
  assert.equal(foldAccents("œuvre"), "œuvre");
  assert.equal(foldAccents("cœur"), "cœur");
  assert.equal(foldAccents("février"), "fevrier", "an accent written as a separate mark");
  assert.equal(foldAccents("harbour"), "harbour");
  assert.equal(foldAccents(""), "");
  assert.throws(() => foldAccents(undefined), INVALID);
});

test("the French stop word list is a frozen set of lower case function words with their accents", () => {
  assert.ok(FRENCH_STOPWORDS instanceof Set);
  assert.ok(Object.isFrozen(FRENCH_STOPWORDS));
  assert.ok(FRENCH_STOPWORDS.size >= 100 && FRENCH_STOPWORDS.size <= 150, `size ${FRENCH_STOPWORDS.size}`);
  for (const word of FRENCH_STOPWORDS) {
    assert.equal(typeof word, "string");
    assert.ok(word.length > 0 && word === word.toLocaleLowerCase("und") && word === word.normalize("NFC"), word);
  }
  const expected = ("le la les l un une des du de d au aux et ou mais donc or ni car je j tu il elle on nous vous ils elles me m te t se "
    + "s lui leur y en ce c cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos qui que qu quoi dont où ne n pas plus pour "
    + "par sur dans avec sans sous chez vers est suis es sommes êtes sont été être ai as a avons avez ont avoir était étais à "
    + "ça").split(" ");
  for (const word of expected) assert.ok(FRENCH_STOPWORDS.has(word), word);
  for (const word of ["maison", "jour", "mère", "pluie", "heureux", "dormir", "lettre"]) assert.ok(!FRENCH_STOPWORDS.has(word), word);
});

const VARIANT_IDS = ["current", "accents", "french_stopwords", "english_forms", "french_forms", "all", "coordination", "bm25",
  "bm25_coordination", "forms", "forms_coordination", "forms_bm25", "forms_bm25_coordination"];

test("the variants are the thirteen ways of ranking, in order, each a frozen record of four flags and a scoring", () => {
  assert.ok(Object.isFrozen(SEARCH_CHECK_VARIANTS));
  assert.deepEqual(SEARCH_CHECK_VARIANTS.map(({ id }) => id), VARIANT_IDS);
  const flags = (variant) => Object.keys(variant).filter((key) => variant[key] === true);
  assert.deepEqual(flags(CURRENT), []);
  assert.deepEqual(flags(ACCENTS), ["foldAccents"]);
  assert.deepEqual(flags(FRENCH_STOP), ["frenchStopwords"]);
  assert.deepEqual(flags(ENGLISH_FORMS), ["englishForms"]);
  assert.deepEqual(flags(FRENCH_FORMS), ["frenchForms"]);
  assert.deepEqual(flags(ALL), ["foldAccents", "frenchStopwords", "englishForms", "frenchForms"]);
  // The three that change only the scoring read words exactly, as "current" does.
  for (const variant of [COORDINATION, BM25, BM25_COORDINATION]) assert.deepEqual(flags(variant), [], variant.id);
  // The four "forms" read words with accents folded and both stemmers, and keep the French stop words in.
  for (const variant of [FORMS, FORMS_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION]) {
    assert.deepEqual(flags(variant), ["foldAccents", "englishForms", "frenchForms"], variant.id);
    assert.equal(variant.frenchStopwords, false);
  }
  assert.deepEqual(SEARCH_CHECK_VARIANTS.map(({ scoring }) => scoring), ["idf_sum", "idf_sum", "idf_sum", "idf_sum", "idf_sum", "idf_sum",
    "coordination", "bm25", "bm25_coordination", "idf_sum", "coordination", "bm25", "bm25_coordination"]);
  for (const variant of SEARCH_CHECK_VARIANTS) {
    assert.ok(Object.isFrozen(variant));
    assert.deepEqual(Object.keys(variant), ["id", "foldAccents", "frenchStopwords", "englishForms", "frenchForms", "scoring"]);
  }
  assert.ok(Object.isFrozen(SEARCH_CHECK_SCORINGS));
  assert.deepEqual(SEARCH_CHECK_SCORINGS, ["idf_sum", "coordination", "bm25", "bm25_coordination"]);
});

test("a variant must name one of the scorings, and a record of one's own that does is as good as the listed ones", () => {
  const withoutScoring = Object.fromEntries(Object.entries(CURRENT).filter(([key]) => key !== "scoring"));
  const refused = [withoutScoring, { ...CURRENT, scoring: "tf_idf" }, { ...CURRENT, scoring: "" }, { ...CURRENT, scoring: undefined },
    { ...CURRENT, scoring: null }, { ...CURRENT, scoring: 2 }, { ...CURRENT, scoring: ["bm25"] }, { ...CURRENT, scoring: "BM25" }];
  for (const bad of refused) {
    assert.throws(() => variantTerm("kettle", bad), INVALID);
    assert.throws(() => variantTermsOf("kettle", bad), INVALID);
    assert.throws(() => variantTokensOf("kettle", bad), INVALID);
    assert.throws(() => variantStopwords(bad), INVALID);
    assert.throws(() => buildVariantIndex([passage(1, "kettle")], bad), INVALID);
    assert.throws(() => checkQuestions({ units: [], passageIdForUnit: () => "passage:001", passages: [], population: 1, variants: [bad] }),
      INVALID);
  }
  for (const scoring of SEARCH_CHECK_SCORINGS) {
    const own = { ...ENGLISH_FORMS, id: `own_${scoring}`, scoring };
    assert.equal(variantTerm("hopping", own), "hop");
    assert.deepEqual(variantTermsOf("hopping hops", own), ["hop"]);
    const index = buildVariantIndex([passage(1, "A hopping gull")], own);
    assert.deepEqual(rankPassages({ index, query: "hops", population: 4 }), ["passage:001"], scoring);
  }
});

test("a term is read by folding accents, then the English stem, then the French stem, each only when the variant says so", () => {
  assert.equal(variantTerm("déprimé", CURRENT), "déprimé");
  assert.equal(variantTerm("déprimé", ACCENTS), "deprime");
  assert.equal(variantTerm("déprimé", FRENCH_STOP), "déprimé");
  assert.equal(variantTerm("déprimé", ENGLISH_FORMS), "déprimé", "an accented word is outside the English stemmer");
  assert.equal(variantTerm("déprimés", FRENCH_FORMS), "déprim");
  assert.equal(variantTerm("déprimés", ALL), "deprim");
  assert.equal(variantTerm("caresses", ENGLISH_FORMS), "caress");
  assert.equal(variantTerm("gulls", FRENCH_FORMS), variantTerm("gull", FRENCH_FORMS), "a plural and its singular read alike, English too");
  assert.equal(variantTerm("chevaux", FRENCH_FORMS), "cheval");
  assert.equal(variantTerm("chevaux", ALL), "cheval");
  assert.equal(variantTerm("hopping", ALL), "hop");
  // The English stem comes before the French one: "caresses" is "caress" to the first and then "cares" to the second. Stemmed the
  // other way round it would end as "care".
  assert.equal(variantTerm("caresses", ALL), "cares");
  assert.throws(() => variantTerm("a", {}), INVALID);
  const flagged = { id: "x", foldAccents: 1, frenchStopwords: false, englishForms: false, frenchForms: false };
  assert.throws(() => variantTerm("a", flagged), INVALID);
});

test("the terms of a text follow lexicalTerms, are read by the variant, and keep one copy each in first-appearance order", () => {
  assert.deepEqual(variantTermsOf("The harbour, the HARBOUR! A quiet harbour.", CURRENT), ["the", "harbour", "a", "quiet"]);
  assert.deepEqual(variantTermsOf("Caresses and caress, cats and cat", CURRENT), ["caresses", "and", "caress", "cats", "cat"]);
  assert.deepEqual(variantTermsOf("Caresses and caress, cats and cat", ENGLISH_FORMS), ["caress", "and", "cat"],
    "terms that read alike are one term, at the place of the first");
  assert.deepEqual(variantTermsOf("Déprimé, deprime et DÉPRIMÉE", ACCENTS), ["deprime", "et", "deprimee"]);
  assert.deepEqual(variantTermsOf("Déprimé, deprime et DÉPRIMÉE", ALL), ["deprim", "et"]);
  assert.deepEqual(variantTermsOf("", ALL), []);
  assert.deepEqual(variantTermsOf("... !", ALL), []);
  assert.deepEqual(variantTermsOf(null, ALL), [], "like lexicalTerms, a value that is not text has no terms");
  assert.throws(() => variantTermsOf("text", null), INVALID);
});

test("the tokens of a text keep every repeat in order, and with the repeats taken out they are the terms of the text", () => {
  assert.deepEqual(variantTokensOf("The harbour, the HARBOUR! A quiet harbour.", CURRENT),
    ["the", "harbour", "the", "harbour", "a", "quiet", "harbour"]);
  assert.deepEqual(variantTokensOf("Caresses and caress, cats and cat", ENGLISH_FORMS), ["caress", "and", "caress", "cat", "and", "cat"],
    "every token is read, so words that read alike repeat");
  assert.deepEqual(variantTokensOf("Déprimé, deprime et DÉPRIMÉE", ACCENTS), ["deprime", "deprime", "et", "deprimee"]);
  assert.deepEqual(variantTokensOf("Déprimé, deprime et DÉPRIMÉE", ALL), ["deprim", "deprim", "et", "deprim"],
    "stop words are tokens too: the length of a text counts them");
  // The text is normalized (NFKC) and cut into runs of letters and digits, as lexicalTerms does.
  assert.deepEqual(variantTokensOf("ＨＡＲＢＯＵＲ 2019 harbour-2019 ﬁnal", CURRENT), ["harbour", "2019", "harbour", "2019", "final"]);
  assert.deepEqual(variantTokensOf("", ALL), []);
  assert.deepEqual(variantTokensOf("... !", ALL), []);
  assert.deepEqual(variantTokensOf(null, ALL), [], "like lexicalTerms, a value that is not text has no tokens");
  assert.deepEqual(variantTokensOf(undefined, CURRENT), []);
  assert.throws(() => variantTokensOf("text", null), INVALID);
  assert.throws(() => variantTokensOf("text", { id: "x" }), INVALID);
  const texts = ["The harbour, the HARBOUR! A quiet harbour.", "Caresses and caress, cats and cat; Cats! CAT?",
    "Déprimé, deprime et DÉPRIMÉE", "Les chevaux, le cheval; les chevaux.", "walking walked walks, WALKING",
    "ＨＡＲＢＯＵＲ 2019 harbour-2019 ﬁnal ﬁnal", "co-op co op coop", "L'ami de l'ami est l'ami", "", "... --", "42 42 4 2"];
  for (const text of texts) {
    assert.deepEqual([...new Set(variantTokensOf(text, CURRENT))], lexicalTerms(text), text);
    for (const variant of SEARCH_CHECK_VARIANTS) {
      assert.deepEqual([...new Set(variantTokensOf(text, variant))], variantTermsOf(text, variant), `${variant.id}: ${text}`);
    }
  }
});

test("stop words are the search's English list, plus the French list where the variant says so, each read like a term", () => {
  const isStopword = (text, variant) => variantStopwords(variant).has(variantTermsOf(text, variant)[0]);
  // The French article is a stop word only where the French list is on.
  for (const variant of SEARCH_CHECK_VARIANTS) {
    assert.equal(isStopword("Les", variant), variant === FRENCH_STOP || variant === ALL, variant.id);
    assert.equal(isStopword("The", variant), true, variant.id);
    assert.equal(isStopword("harbour", variant), false, variant.id);
  }
  assert.ok(isStopword("êtes", FRENCH_STOP));
  assert.ok(!isStopword("etes", FRENCH_STOP), "without folding, a missing accent makes another word");
  assert.ok(isStopword("etes", ALL), "with folding, it is the same word");
  assert.ok(!isStopword("où", CURRENT));
  // Stop words are read like any term: "was" is "wa" to the English stemmer, and so is a query's "was".
  assert.ok(variantStopwords(ENGLISH_FORMS).has("wa"));
  assert.equal(variantTermsOf("was", ENGLISH_FORMS)[0], "wa");
  assert.ok(isStopword("was", ENGLISH_FORMS));
  // The current variant's list is the search's own list, and the accent variant's too (its words have no accents).
  assert.deepEqual(variantStopwords(CURRENT), QUOTE_STOPWORDS);
  assert.deepEqual(variantStopwords(ACCENTS), QUOTE_STOPWORDS);
  assert.ok(!variantStopwords(CURRENT).has("les"));
  // The scoring leaves the stop words as the reading made them.
  for (const variant of [COORDINATION, BM25, BM25_COORDINATION]) assert.deepEqual(variantStopwords(variant), QUOTE_STOPWORDS, variant.id);
  for (const variant of [FORMS_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION]) {
    assert.deepEqual(variantStopwords(variant), variantStopwords(FORMS), variant.id);
  }
  assert.ok(!variantStopwords(FORMS).has("les"), "the forms variants keep the French stop words in");
  // One set for each variant, kept; a record that borrows a variant's id but differs in its flags gets a list of its own.
  assert.equal(variantStopwords(ALL), variantStopwords(ALL));
  const borrowed = { ...CURRENT, frenchStopwords: true };
  assert.ok(variantStopwords(borrowed).has("les"));
  assert.ok(!variantStopwords(CURRENT).has("les"));
  assert.throws(() => variantStopwords({ id: "x" }), INVALID);
});

test("an index lists, for each term as the variant reads it, the sorted ids of the passages that hold it, once each", () => {
  const passages = [passage(3, "A kettle, a KETTLE and the kettle."), passage(1, "The harbour kettle."),
    passage(2, "Déprimé at the harbour.")];
  const index = buildVariantIndex(passages, CURRENT);
  assert.ok(Object.isFrozen(index));
  assert.equal(index.variant, CURRENT);
  assert.ok(index.postings instanceof Map);
  assert.deepEqual(index.postings.get("kettle"), ["passage:001", "passage:003"]);
  assert.deepEqual(index.postings.get("harbour"), ["passage:001", "passage:002"]);
  assert.deepEqual(index.postings.get("déprimé"), ["passage:002"]);
  assert.equal(index.postings.has("deprime"), false);
  assert.ok(Object.isFrozen(index.postings.get("kettle")));
  // The same passages as a variant reads them.
  const folded = buildVariantIndex(passages, ACCENTS);
  assert.deepEqual(folded.postings.get("deprime"), ["passage:002"]);
  assert.equal(folded.postings.has("déprimé"), false);
  assert.deepEqual(buildVariantIndex([], ALL).postings.size, 0);
  assert.deepEqual(buildVariantIndex([passage(1, "")], ALL).postings.size, 0);
  // A passage listed twice counts once.
  assert.deepEqual(buildVariantIndex([passage(1, "kettle"), passage(1, "kettle")], CURRENT).postings.get("kettle"), ["passage:001"]);
  assert.deepEqual(buildVariantIndex([passage(1, "kettle"), passage(1, "kettle")], BM25).postings.get("kettle"), ["passage:001"]);
  // The scoring does not change what an index lists: the same postings, in a frozen record of the variant and the postings alone.
  for (const [reading, scored] of [[CURRENT, COORDINATION], [CURRENT, BM25], [CURRENT, BM25_COORDINATION], [FORMS, FORMS_COORDINATION],
    [FORMS, FORMS_BM25], [FORMS, FORMS_BM25_COORDINATION]]) {
    const plain = buildVariantIndex(passages, reading);
    const other = buildVariantIndex(passages, scored);
    assert.equal(other.variant, scored);
    assert.deepEqual(other.postings, plain.postings, scored.id);
    assert.deepEqual([...other.postings.keys()], [...plain.postings.keys()], `${scored.id}: terms in the same order`);
    assert.deepEqual(Object.keys(other), ["variant", "postings"], "what BM25 counts is not on the index");
    assert.ok(Object.isFrozen(other) && Object.isFrozen(other.postings.get("kettle")), scored.id);
  }
  assert.deepEqual(buildVariantIndex([], BM25).postings.size, 0);
  assert.deepEqual(buildVariantIndex([passage(1, "")], BM25).postings.size, 0);
});

test("bad input to the index is refused with a bare code, and the code carries no text", () => {
  const secret = "invented secret words";
  const attempts = [
    () => buildVariantIndex("passage:001", CURRENT),
    () => buildVariantIndex([null], CURRENT),
    () => buildVariantIndex([{ id: 1, quote: secret }], CURRENT),
    () => buildVariantIndex([{ id: "entity:001", quote: secret }], CURRENT),
    () => buildVariantIndex([{ id: "passage:001" }], CURRENT),
    () => buildVariantIndex([{ id: "passage:001", quote: 7 }], CURRENT),
    () => buildVariantIndex([passage(1, secret)], { id: "mine" }),
    () => buildVariantIndex([passage(1, secret)], null),
    // The same under a scoring that counts: a passage that is not valid is refused, listed first or listed again.
    () => buildVariantIndex([null], BM25),
    () => buildVariantIndex([{ id: "entity:001", quote: secret }], BM25_COORDINATION),
    () => buildVariantIndex([{ id: "passage:001", quote: 7 }], BM25),
    () => buildVariantIndex([passage(1, secret), { id: "passage:001", quote: 7 }], BM25),
    () => buildVariantIndex([passage(1, secret), { id: 1, quote: secret }], FORMS_BM25)
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (error) => error.code === "SEARCH_CHECK_INPUT_INVALID" && error.message === "SEARCH_CHECK_INPUT_INVALID"
      && !JSON.stringify(error.details ?? {}).includes("secret"));
  }
});

test("words match only under the variants that make them alike", () => {
  const matches = (stored, query) => Object.fromEntries(SEARCH_CHECK_VARIANTS.map((variant) => [variant.id,
    rankPassages({ index: buildVariantIndex([passage(1, stored)], variant), query, population: 2 }).length === 1]));
  // The scoring does not change which words match. The three variants that only change it read words as "current" does, and the four
  // "forms" read them as "all" does (the French stop words only change which words of a query count, and these queries are one word).
  const expected = (six) => ({ ...six, coordination: six.current, bm25: six.current, bm25_coordination: six.current, forms: six.all,
    forms_coordination: six.all, forms_bm25: six.all, forms_bm25_coordination: six.all });
  // An accent: "déprimé" and "deprime" match under accents and all.
  assert.deepEqual(matches("Il était déprimé ce matin", "deprime"), expected({ current: false, accents: true, french_stopwords: false,
    english_forms: false, french_forms: false, all: true }));
  // An English word form.
  assert.deepEqual(matches("The gulls counted nothing", "count"), expected({ current: false, accents: false, french_stopwords: false,
    english_forms: true, french_forms: false, all: true }));
  // A French word form.
  assert.deepEqual(matches("Le cheval dort", "chevaux"), expected({ current: false, accents: false, french_stopwords: false,
    english_forms: false, french_forms: true, all: true }));
  assert.deepEqual(matches("Elle est déprimée", "déprimé"), expected({ current: false, accents: false, french_stopwords: false,
    english_forms: false, french_forms: true, all: true }));
  // The same word matches everywhere.
  assert.deepEqual(matches("The harbour wall", "harbour"), expected({ current: true, accents: true, french_stopwords: true,
    english_forms: true, french_forms: true, all: true }));
  assert.deepEqual(Object.keys(matches("The harbour wall", "harbour")), VARIANT_IDS);
});

test("French stop words leave the ranking only under the variants that list them", () => {
  const passages = [passage(1, "Les mouettes dorment."), passage(2, "Les chats dorment."), passage(3, "Un chien dort.")];
  const ranked = (variant, query) => rankPassages({ index: buildVariantIndex(passages, variant), query, population: 4 });
  assert.deepEqual(ranked(CURRENT, "les mouettes"), ["passage:001", "passage:002"]);
  assert.deepEqual(ranked(FRENCH_STOP, "les mouettes"), ["passage:001"]);
  assert.deepEqual(ranked(ALL, "Les mouettes"), ["passage:001"]);
  // A query of nothing but stop words ranks by them all.
  assert.deepEqual(ranked(FRENCH_STOP, "les"), ["passage:001", "passage:002"]);
  assert.deepEqual(ranked(CURRENT, "the and of"), []);
});

test("ranking follows the search's rules: rarer words count more, then more matched words, then the id", () => {
  const passages = [passage(5, "alpha beta"), passage(4, "alpha"), passage(3, "beta gamma"), passage(2, "gamma"),
    passage(1, "alpha gamma")];
  const index = buildVariantIndex(passages, CURRENT);
  // alpha is in 3 passages, beta in 2, gamma in 3, so beta weighs most. Passages 3 and 5 hold beta and one more word and tie, as do
  // 2 and 4, which hold one word of the lighter two.
  assert.deepEqual(rankPassages({ index, query: "alpha beta gamma", population: 10 }),
    ["passage:003", "passage:005", "passage:001", "passage:002", "passage:004"]);
  // The rarer word alone beats a lighter one alone, and two words beat either.
  assert.deepEqual(rankPassages({ index, query: "alpha beta", population: 10 }),
    ["passage:005", "passage:003", "passage:001", "passage:004"]);
  // Equal scores are told apart by the id.
  assert.deepEqual(rankPassages({ index, query: "alpha", population: 10 }), ["passage:001", "passage:004", "passage:005"]);
  // A population of 0 counts as 1, as the search does for a generation without a count.
  assert.deepEqual(rankPassages({ index, query: "alpha beta", population: 0 }),
    rankPassages({ index, query: "alpha beta", population: 1 }));
  // termsMax cuts the terms, and a term no passage holds is skipped.
  assert.deepEqual(rankPassages({ index, query: "delta alpha beta", population: 10, termsMax: 2 }),
    ["passage:001", "passage:004", "passage:005"]);
  assert.deepEqual(rankPassages({ index, query: "delta alpha", population: 10 }), ["passage:001", "passage:004", "passage:005"]);
  assert.deepEqual(rankPassages({ index, query: "", population: 10 }), []);
  assert.deepEqual(rankPassages({ index, query: "... --", population: 10 }), []);
  assert.deepEqual(rankPassages({ index, query: "delta", population: 10 }), []);
});

test("a word is weighed by log(1 + population / passages that hold it), so one rare word can outweigh two common ones", () => {
  // Population 10. "xenon" is in 1 passage, "yarn" and "zinc" in 5 each, and passage 2 holds both of those two. The search gives
  // log(11) = 2.40 to the first and 2 * log(3) = 2.20 to the second, so passage 1 leads; with log(2 + n) it would be the other way.
  const passages = [passage(1, "xenon"), passage(2, "yarn zinc"), ...[3, 4, 5, 6].map((number) => passage(number, "yarn")),
    ...[7, 8, 9, 10].map((number) => passage(number, "zinc"))];
  const index = buildVariantIndex(passages, CURRENT);
  const ranked = rankPassages({ index, query: "xenon yarn zinc", population: 10 });
  assert.deepEqual(ranked.slice(0, 2), ["passage:001", "passage:002"]);
  assert.deepEqual(ranked.slice(2), ["passage:003", "passage:004", "passage:005", "passage:006", "passage:007", "passage:008",
    "passage:009", "passage:010"], "equal scores in id order");
  // The population is part of the weight: with 100 passages in the generation the two common words (2 * log(21) = 6.1) outweigh the
  // rare one (log(101) = 4.6).
  assert.deepEqual(rankPassages({ index, query: "xenon yarn zinc", population: 100 }).slice(0, 2), ["passage:002", "passage:001"]);
});

test("passages with the same score are put in order by how many query words they hold, whatever their ids", () => {
  // Population 6. "pivot" is in 2 passages and weighs log(4); "quartz" and "rune" are in 6 each and weigh log(2) apiece, so passage 9,
  // which holds both, scores exactly what the passages with "pivot" alone do (log 2 + log 2 = log 4 in a double too).
  const passages = [passage(1, "pivot"), passage(2, "pivot"), passage(9, "quartz rune"),
    ...[3, 4, 5, 6, 7].map((number) => passage(number, "quartz")), ...[10, 11, 12, 13, 14].map((number) => passage(number, "rune"))];
  const index = buildVariantIndex(passages, CURRENT);
  assert.equal(Math.log(1 + 6 / 6) + Math.log(1 + 6 / 6), Math.log(1 + 6 / 2));
  assert.deepEqual(rankPassages({ index, query: "pivot quartz rune", population: 6 }), ["passage:009", "passage:001", "passage:002",
    "passage:003", "passage:004", "passage:005", "passage:006", "passage:007", "passage:010", "passage:011", "passage:012",
    "passage:013", "passage:014"]);
});

test("the last tie-break is the id compared with localeCompare, as the search does, not by character codes", () => {
  const ids = ["passage:b", "passage:A", "passage:a", "passage:B", "passage:a-1", "passage:10", "passage:9", "passage:_x"];
  const index = buildVariantIndex(ids.map((id) => ({ id, quote: "kettle" })), CURRENT);
  assert.deepEqual(rankPassages({ index, query: "kettle", population: 9 }), [...ids].sort((left, right) => left.localeCompare(right)));
});

test("ranking refuses input it cannot rank", () => {
  const index = buildVariantIndex([passage(1, "kettle")], CURRENT);
  assert.throws(() => rankPassages(), INVALID);
  assert.throws(() => rankPassages({ index: null, query: "kettle", population: 1 }), INVALID);
  assert.throws(() => rankPassages({ index: { variant: CURRENT, postings: {} }, query: "kettle", population: 1 }), INVALID);
  assert.throws(() => rankPassages({ index, query: 5, population: 1 }), INVALID);
  assert.throws(() => rankPassages({ index, query: "kettle" }), INVALID);
  assert.throws(() => rankPassages({ index, query: "kettle", population: -1 }), INVALID);
  assert.throws(() => rankPassages({ index, query: "kettle", population: 1.5 }), INVALID);
  assert.throws(() => rankPassages({ index, query: "kettle", population: 1, termsMax: 0 }), INVALID);
});

test("an index for a BM25 scoring must be the one buildVariantIndex made, while the other scorings rank any index of postings", () => {
  const passages = [passage(1, "kettle kettle"), passage(2, "kettle")];
  assert.deepEqual(rankPassages({ index: buildVariantIndex(passages, BM25), query: "kettle", population: 3 }), idsOf(1, 2));
  // A copy of the record, or one put together from its parts, has lost what BM25 counted. It is refused before the query is read.
  for (const variant of [BM25, BM25_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION]) {
    const index = buildVariantIndex(passages, variant);
    for (const query of ["kettle", ""]) {
      assert.throws(() => rankPassages({ index: { ...index }, query, population: 3 }), INVALID, variant.id);
      assert.throws(() => rankPassages({ index: { variant, postings: index.postings }, query, population: 3 }), INVALID, variant.id);
    }
  }
  // An index made for another scoring does not become a BM25 one by changing its variant.
  const exact = buildVariantIndex(passages, CURRENT);
  assert.throws(() => rankPassages({ index: { ...exact, variant: BM25 }, query: "kettle", population: 3 }), INVALID);
  // The idf_sum and coordination scorings need the postings alone, as idf_sum always did (the term in them is the variant's reading).
  for (const variant of [CURRENT, COORDINATION, FORMS, FORMS_COORDINATION]) {
    const postings = new Map([[variantTerm("kettle", variant), ["passage:001", "passage:002"]]]);
    assert.deepEqual(rankPassages({ index: { variant, postings }, query: "kettle", population: 3 }), idsOf(1, 2), variant.id);
  }
  // Under every scoring a query with no terms, or none that a passage holds, ranks nothing.
  for (const variant of SEARCH_CHECK_VARIANTS) {
    const index = buildVariantIndex(passages, variant);
    for (const query of ["", "... --", "delta", "the and"]) assert.deepEqual(rankPassages({ index, query, population: 3 }), [], variant.id);
  }
});

test("coordination puts the passages that hold more of the query's words first, then the idf_sum score, then the id", () => {
  // Population 10. "quince" is in 1 passage, "ripple" and "saddle" in 5 each, and passage 1 holds both of those two. By idf_sum,
  // passage 10 (log(11) = 2.40) leads passage 1 (2 * log(3) = 2.20). Under coordination passage 1 comes first, as it holds two words.
  const passages = [passage(1, "ripple saddle"), ...[2, 3, 4, 5].map((number) => passage(number, "ripple")),
    ...[6, 7, 8, 9].map((number) => passage(number, "saddle")), passage(10, "quince")];
  const query = "quince ripple saddle";
  assert.deepEqual(rankWith(CURRENT, passages, query), idsOf(10, 1, 2, 3, 4, 5, 6, 7, 8, 9));
  // Passages with one word each stay in the idf_sum order: passage 10, with the rarest word, ahead of the rest though its id is last.
  assert.deepEqual(rankWith(COORDINATION, passages, query), idsOf(1, 10, 2, 3, 4, 5, 6, 7, 8, 9));
  assert.deepEqual(rankWith(FORMS_COORDINATION, passages, query), idsOf(1, 10, 2, 3, 4, 5, 6, 7, 8, 9));
  // Among passages that hold as many words, the idf_sum score decides, so the population it is computed with does too. Passage 1 holds
  // the rarest word and a common one, passage 2 two middling ones. A population of 1 favours the first (log(1 + 1 / 1) + log(1 + 1 / 6)
  // = 0.85 against 2 * log(1 + 1 / 2) = 0.81) and a population of 100 the second (4.6 + 2.9 = 7.5 against 2 * 3.9 = 7.9).
  const flip = [passage(1, "aaa bbb"), passage(2, "ccc ddd"), ...[3, 4, 5, 6, 7].map((number) => passage(number, "bbb")),
    passage(8, "ccc"), passage(9, "ddd")];
  assert.deepEqual(rankWith(COORDINATION, flip, "aaa bbb ccc ddd", 1), idsOf(1, 2, 8, 9, 3, 4, 5, 6, 7));
  assert.deepEqual(rankWith(COORDINATION, flip, "aaa bbb ccc ddd", 100), idsOf(2, 1, 8, 9, 3, 4, 5, 6, 7));
  // The terms are chosen as for every scoring: stop words are left out, and so are the terms past termsMax.
  const index = buildVariantIndex(flip, COORDINATION);
  assert.deepEqual(rankPassages({ index, query: "the aaa of bbb", population: 100 }), idsOf(1, 3, 4, 5, 6, 7));
  assert.deepEqual(rankPassages({ index, query: "ccc ddd aaa bbb", population: 100, termsMax: 2 }), idsOf(2, 8, 9));
});

test("bm25 lets a passage that uses a word more often, or is shorter, outrank another that holds the same word", () => {
  // "tide" is in three of the four passages. Passage 1 uses it once among 12 tokens, passage 2 twice among 3, passage 3 once among 3. By
  // idf_sum the three score alike and the ids settle it. BM25 puts the short passage that uses the word twice first, then the short one
  // that uses it once, and the long one last.
  const passages = [passage(1, `tide ${repeat(11, "gull")}`), passage(2, "tide tide pier"), passage(3, "tide pier gull"),
    passage(4, "rope")];
  assert.deepEqual(rankWith(CURRENT, passages, "tide"), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(COORDINATION, passages, "tide"), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(BM25, passages, "tide"), idsOf(2, 3, 1));
  assert.deepEqual(rankWith(BM25_COORDINATION, passages, "tide"), idsOf(2, 3, 1), "one word: every passage holds one");
  assert.deepEqual(rankWith(FORMS_BM25, passages, "tide"), idsOf(2, 3, 1));
});

test("bm25 follows the Okapi formula with k1 = 1.2 and b = 0.75, checked against a hand computation", () => {
  // Five passages, so P = 5, and a query of two words:
  //   passage 1  "bell"                         1 token,  bell once
  //   passage 2  "rope" six times               6 tokens, neither word
  //   passage 3  "lamp" and "rope" five times   6 tokens, lamp once
  //   passage 4  "rope" four times              4 tokens, neither word
  //   passage 5  "bell rope"                    2 tokens, bell once
  // The mean length is (1 + 6 + 6 + 4 + 2) / 5 = 3.8. "lamp" is in one passage: idf = ln(1 + (5 - 1 + 0.5) / (1 + 0.5)) = ln 4 = 1.3863.
  // "bell" is in two: idf = ln(1 + (5 - 2 + 0.5) / (2 + 0.5)) = ln 2.4 = 0.8755. With k1 + 1 = 2.2, a passage that uses a word once scores
  // idf * 2.2 / (1 + 1.2 * (0.25 + 0.75 * length / 3.8)), so
  //   passage 1  0.8755 * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 1 / 3.8)) = 1.2532
  //   passage 3  1.3863 * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 6 / 3.8)) = 1.1208
  //   passage 5  0.8755 * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 2 / 3.8)) = 1.0859
  // and the order is 1, 3, 5. By idf_sum passage 3 leads, as "lamp" is the rarer word, and 1 and 5 follow by id.
  const passages = [passage(1, "bell"), passage(2, repeat(6, "rope")), passage(3, `lamp ${repeat(5, "rope")}`),
    passage(4, repeat(4, "rope")), passage(5, "bell rope")];
  const idfOf = (count, holding) => Math.log(1 + (count - holding + 0.5) / (holding + 0.5));
  // The same sum written out for [passage, idf of its word, its length]. Each option changes one part of the formula or of the counts.
  const hand = ({ k1 = 1.2, b = 0.75, mean = 3.8, count = 5, idf = idfOf } = {}) => [[1, idf(count, 2), 1], [3, idf(count, 1), 6],
    [5, idf(count, 2), 2]].map(([number, weight, length]) => [number, weight * (k1 + 1) / (1 + k1 * (1 - b + b * length / mean))]);
  const handOrder = (options) => hand(options).sort((left, right) => right[1] - left[1] || left[0] - right[0]).map(([number]) => number);
  assert.deepEqual(hand().map(([, score]) => score.toFixed(4)), ["1.2532", "1.1208", "1.0859"]);
  assert.deepEqual(handOrder(), [1, 3, 5]);
  assert.deepEqual(rankWith(BM25, passages, "lamp bell"), idsOf(1, 3, 5));
  assert.deepEqual(rankWith(FORMS_BM25, passages, "lamp bell"), idsOf(1, 3, 5), "the same words under the forms reading");
  assert.deepEqual(rankWith(CURRENT, passages, "lamp bell"), idsOf(3, 1, 5));
  // The passages are chosen so that the order tells the constants and the counts apart: each of these changes it when worked by hand.
  const changes = { "b = 0": { b: 0 }, "b = 1": { b: 1 }, "b = 0.5": { b: 0.5 }, "b = 0.9": { b: 0.9 }, "k1 = 0.8": { k1: 0.8 },
    "k1 = 2": { k1: 2 }, "a mean over the three passages that hold a word": { mean: 3 }, "P counted as 3": { count: 3 },
    "an idf that can go negative": { idf: (count, holding) => Math.log((count - holding + 0.5) / (holding + 0.5)) } };
  for (const [name, options] of Object.entries(changes)) assert.notDeepEqual(handOrder(options), [1, 3, 5], name);
});

test("bm25 counts every token in a passage's length, stop words included, though the query leaves its stop words out", () => {
  // Both passages use "tide" once. Passage 2 has 2 tokens and passage 1 has 6, of which four are stop words. The query's "the" is left out.
  const passages = [passage(1, "the tide the and of pier"), passage(2, "tide pier"), passage(3, "rope")];
  assert.deepEqual(rankWith(CURRENT, passages, "the tide"), idsOf(1, 2));
  assert.deepEqual(rankWith(BM25, passages, "the tide"), idsOf(2, 1));
  assert.deepEqual(rankWith(BM25_COORDINATION, passages, "the tide"), idsOf(2, 1));
  // A query of nothing but stop words ranks by them all, as under every scoring; only passage 1 holds "the" or "and".
  assert.deepEqual(rankWith(BM25, passages, "the and"), idsOf(1));
});

test("bm25 does not use the population, and chooses the query's words as every scoring does", () => {
  const passages = [passage(1, "bell"), passage(2, repeat(6, "rope")), passage(3, `lamp ${repeat(5, "rope")}`),
    passage(4, repeat(4, "rope")), passage(5, "bell rope")];
  for (const variant of [BM25, BM25_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION]) {
    const index = buildVariantIndex(passages, variant);
    const ranked = (population, extra = {}) => rankPassages({ index, query: "lamp bell", population, ...extra });
    assert.equal(ranked(5).length, 3, variant.id);
    assert.deepEqual(ranked(0), ranked(1), variant.id);
    assert.deepEqual(ranked(5), ranked(1_000_000), variant.id);
    // termsMax keeps the first words of the query ("lamp"), and a word no passage holds is skipped.
    assert.deepEqual(ranked(5, { termsMax: 1 }), idsOf(3), variant.id);
    assert.deepEqual(rankPassages({ index, query: "delta lamp bell", population: 5 }), ranked(5), variant.id);
    assert.deepEqual(rankPassages({ index, query: "delta lamp bell", population: 5, termsMax: 2 }), idsOf(3), variant.id);
    assert.deepEqual(rankPassages({ index, query: "Lamp, LAMP! bell", population: 5 }), ranked(5), "a repeated word counts once");
  }
});

test("under bm25 a passage with no words still counts as a passage of the index, and a passage listed twice counts once", () => {
  // Query "mast sail". Three passages of 4, 1 and 2 tokens (P = 3, mean 7 / 3) rank 1, 2, 3. A fourth passage that has no words makes
  // P = 4 and the mean 7 / 4, and then passage 2 comes first. Counted in only one of the two it would leave the order as it was.
  const [first, second, third] = [passage(1, `mast ${repeat(3, "rope")}`), passage(2, "sail"), passage(3, "sail rope")];
  const passages = [first, second, third];
  assert.deepEqual(rankWith(BM25, passages, "mast sail"), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(BM25, [...passages, passage(9, "... !")], "mast sail"), idsOf(2, 1, 3));
  assert.deepEqual(rankWith(BM25, [...passages, passage(9, "")], "mast sail"), idsOf(2, 1, 3));
  assert.deepEqual(rankWith(BM25_COORDINATION, [...passages, passage(9, "")], "mast sail"), idsOf(2, 1, 3));
  assert.deepEqual(rankWith(CURRENT, [...passages, passage(9, "")], "mast sail"), rankWith(CURRENT, passages, "mast sail"),
    "idf_sum does not count the passages: it takes the population");
  // A passage listed twice is read once, from its first listing: it is not another passage, and its words are not counted again.
  assert.deepEqual(rankWith(BM25, [...passages, first, third, first], "mast sail"), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(BM25, [second, first, third, second, third], "mast sail"), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(BM25, [first, { ...first, quote: repeat(5, "sail") }, second, third], "mast sail"), idsOf(1, 2, 3),
    "the first listing is the one read");
  assert.deepEqual(rankWith(BM25, [...passages, passage(9, ""), passage(9, "")], "mast sail"), idsOf(2, 1, 3), "an empty one too, once");
});

test("bm25's constants are k1 = 1.2 and b = 0.75: the order of these passages changes if either moves a little", () => {
  // Query "mast sail", four passages, P = 4, mean length 11 / 4 = 2.75, each word in two passages (idf = ln 2).
  //   passage 1  "sail" twice and "rope"                3 tokens
  //   passage 2  "mast", "sail" and "rope" four times    6 tokens
  //   passage 3  "rope"                                 1 token, neither word
  //   passage 4  "mast"                                 1 token
  // The scores are close: passage 4 0.9371, passage 2 0.9345, passage 1 0.9293. The order 4, 2, 1 holds for k1 only from about 1.19 to
  // 1.22 and for b only from about 0.747 to 0.763, so it is a different order if either constant is moved even by 0.05.
  const passages = [passage(1, `${repeat(2, "sail")} rope`), passage(2, `mast sail ${repeat(4, "rope")}`), passage(3, "rope"),
    passage(4, "mast")];
  const idf = Math.log(1 + (4 - 2 + 0.5) / (2 + 0.5));
  // The sum worked out here, for [passage, its length, how often it uses each query word it holds].
  const hand = ({ k1 = 1.2, b = 0.75 } = {}) => {
    const scores = [[1, 3, [2]], [2, 6, [1, 1]], [4, 1, [1]]].map(([number, length, uses]) => [number,
      uses.reduce((sum, tf) => sum + idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * length / 2.75)), 0)]);
    return scores.sort((left, right) => right[1] - left[1] || left[0] - right[0]).map(([number]) => number);
  };
  assert.deepEqual(hand(), [4, 2, 1]);
  assert.deepEqual(rankWith(BM25, passages, "mast sail"), idsOf(4, 2, 1));
  assert.deepEqual(rankWith(FORMS_BM25, passages, "mast sail"), idsOf(4, 2, 1));
  assert.deepEqual(rankWith(BM25_COORDINATION, passages, "mast sail"), idsOf(2, 4, 1), "the passage with both words first");
  assert.deepEqual(rankWith(CURRENT, passages, "mast sail"), idsOf(2, 1, 4));
  for (const options of [{ k1: 1.1 }, { k1: 1.15 }, { k1: 1.25 }, { k1: 1.3 }, { b: 0.7 }, { b: 0.8 }]) {
    assert.notDeepEqual(hand(options), [4, 2, 1], JSON.stringify(options));
  }
  assert.deepEqual(hand({ k1: 1.15 }), [2, 4, 1]);
  assert.deepEqual(hand({ k1: 1.25 }), [4, 1, 2]);
});

test("bm25_coordination puts the passages that hold more of the query's words first, then orders them by BM25, then by id", () => {
  // "anchor" and "buoy" are each in two of the six passages. Passage 1 holds both, among 30 tokens. Passage 2 is "buoy" alone, passage 3 is
  // "anchor" three times in three tokens. By idf_sum (and coordination) passages 2 and 3 score the same and the id puts 2 first. BM25 puts
  // 3 first, as it uses its word three times in a short passage, and the long passage 1 last, though it holds both words.
  const passages = [passage(1, `anchor buoy ${repeat(28, "rope")}`), passage(2, "buoy"), passage(3, "anchor anchor anchor"),
    passage(4, "rope"), passage(5, "chain"), passage(6, "rope chain")];
  const query = "anchor buoy";
  assert.deepEqual(rankWith(CURRENT, passages, query), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(COORDINATION, passages, query), idsOf(1, 2, 3));
  assert.deepEqual(rankWith(BM25, passages, query), idsOf(3, 2, 1));
  assert.deepEqual(rankWith(BM25_COORDINATION, passages, query), idsOf(1, 3, 2));
  assert.deepEqual(rankWith(FORMS_BM25_COORDINATION, passages, query), idsOf(1, 3, 2));
  // Passages that tie on the words they hold and on the score are told apart by the id.
  const tied = [passage(1, "anchor rope"), passage(2, "buoy rope"), passage(3, "anchor buoy"), passage(4, "anchor buoy"),
    passage(5, "rope rope")];
  assert.deepEqual(rankWith(BM25_COORDINATION, tied, query), idsOf(3, 4, 1, 2));
});

test("the forms variants put walking and walked together by the Porter stem, and déjà and deja by folding the accent", () => {
  const passages = [passage(1, "She was walking along the pier."), passage(2, "He walked home, and walks on."),
    passage(3, "Déjà vu, again."), passage(4, "A quiet pier."), passage(5, "Les chevaux dorment."), passage(6, "Les nuages passent.")];
  const exact = [CURRENT, COORDINATION, BM25, BM25_COORDINATION];
  const forms = [FORMS, FORMS_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION];
  for (const variant of exact) {
    assert.deepEqual(rankWith(variant, passages, "walked"), idsOf(2), variant.id);
    assert.deepEqual(rankWith(variant, passages, "deja"), [], variant.id);
    assert.deepEqual(rankWith(variant, passages, "cheval"), [], variant.id);
  }
  for (const variant of forms) {
    assert.deepEqual(rankWith(variant, passages, "walked").sort(), idsOf(1, 2), `${variant.id}: walked meets walking and walks`);
    assert.deepEqual(rankWith(variant, passages, "walking").sort(), idsOf(1, 2), variant.id);
    assert.deepEqual(rankWith(variant, passages, "deja"), idsOf(3), `${variant.id}: deja meets déjà`);
    assert.deepEqual(rankWith(variant, passages, "DÉJÀ"), idsOf(3), variant.id);
    assert.deepEqual(rankWith(variant, passages, "cheval"), idsOf(5), `${variant.id}: cheval meets chevaux`);
  }
  // The French stop words stay in the query under forms ("les" counts there), and go out of it under "all".
  assert.deepEqual(rankWith(FORMS, passages, "les dorment"), idsOf(5, 6));
  assert.deepEqual(rankWith(ALL, passages, "les dorment"), idsOf(5));
  // BM25 counts the uses of a term as the variant reads it. "walked", "walking" and "walks" are three uses of "walk" under forms, so
  // passage 1, short and using the term thrice, leads passage 3, which uses it once in a single token, and passage 2, once among three.
  const uses = [passage(1, "walked walking walks"), passage(2, "walk pier gull"), passage(3, "walking"), passage(4, "rope")];
  assert.deepEqual(rankWith(FORMS, uses, "walking"), idsOf(1, 2, 3), "idf_sum: the three score the same");
  assert.deepEqual(rankWith(FORMS_BM25, uses, "walking"), idsOf(1, 3, 2));
  // Under the exact reading only the passages that hold the word itself match, and each counts its own uses.
  assert.deepEqual(rankWith(BM25, uses, "walking"), idsOf(3, 1));
});

// A synthetic corpus of invented paragraphs. The words are drawn by a fixed arithmetic sequence (no clock, no randomness), so every run
// holds the same text. Most paragraphs hold "tide", so a search for it has more matches than one call returns.
const WORDS = ["alder", "brisk", "cobble", "dusk", "ember", "fable", "gleam", "hollow", "ivory", "jasper", "kiln", "lantern", "mossy",
  "nectar", "orchid", "pebble", "quill", "russet", "saffron", "thistle", "umber", "velvet", "willow", "yarrow"];
const FRENCH_LINES = [
  "Marguerite était déprimée par la pluie, et elle relut la lettre.",
  "La déprime de Marguerite dura sept jours, puis le vent changea.",
  "Les lettres de Marguerite étaient posées sur la table de la cuisine.",
  "Il a déprimé toute la semaine, les chevaux dormaient dans les champs."
];

function inventedParagraphs() {
  let state = 7;
  const next = (limit) => {
    state = (state * 75 + 74) % 65537;
    return state % limit;
  };
  const paragraphs = [];
  for (let number = 0; number < 64; number += 1) {
    const words = Array.from({ length: 4 + next(5) }, () => WORDS[next(WORDS.length)]);
    if (number % 5 !== 0) words.push("tide");
    paragraphs.push(`${words.join(" ")}.`);
  }
  return [...paragraphs, ...FRENCH_LINES];
}

// The corpus stored as the search reads it: a quote generation, persisted and opened. Returns its passages and node count, and a search.
async function openedCorpus(t, { wordList = false, generation = "search-check-generation", cursorSecret = randomBytes(32),
  paragraphs = inventedParagraphs() } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "search-check-"));
  let reader = null;
  t.after(async () => {
    reader?.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const caseId = "search-check-case", corpusId = "search-check-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const text = paragraphs.join("\n\n");
  const representations = [{ representation_id: "test:page:0", text, page_number: 1, parse_status: "readable" }];
  const built = buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId: "original:test", mediaType: "application/pdf",
    representations, unitOptions: { minimumBytes: 0 }, version: wordList ? 3 : 2 });
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph,
    sourceRepresentations: Object.fromEntries(representations.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, ...(wordList ? { quote_terms: buildQuoteTermsFromGraph(built.graph) } : {}) },
    indexRepresentations: true });
  reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret });
  return {
    reader,
    passages: built.graph.nodes.filter((node) => node.kind === "passage").map((node) => ({ id: node.id, quote: node.data.quote })),
    population: persisted.manifest.node_count,
    // What the search returns by words alone, as the measurement reads it, with room for everything one call can hold.
    searched: async (query) => (await reader.findQuotes({ query, limit: 40, byteBudget: 48_000, matchTags: false })).quotes
      .map((quote) => quote.quote_id)
  };
}

test("under the current variant, ranking returns the passages in the order the real quote search gives them", async (t) => {
  const { passages, population, searched } = await openedCorpus(t);
  assert.equal(passages.length, 64 + FRENCH_LINES.length);
  assert.ok(Number.isSafeInteger(population) && population >= passages.length);
  const index = buildVariantIndex(passages, CURRENT);
  const ranked = (query, termsMax) => rankPassages({ index, query, population, ...(termsMax === undefined ? {} : { termsMax }) });
  const queries = ["alder", "alder cobble", "Alder, COBBLE; alder!", "tide", "the tide and the alder", "the and of to", "quartz",
    "alder quartz", "kiln lantern mossy nectar", "ember ember ember", "déprimée", "Marguerite lettres", "les de la",
    "la déprime des chevaux", `${WORDS.join(" ")} tide`];
  for (const query of queries) {
    const real = await searched(query);
    assert.deepEqual(ranked(query).slice(0, 40), real, query);
  }
  // The queries are not all alike: some tie, some are cut at one call's limit, some find nothing.
  assert.equal(ranked("tide").length, 51);
  assert.equal((await searched("tide")).length, 40);
  assert.deepEqual(ranked("quartz"), []);
  assert.deepEqual(await searched("quartz"), []);
  assert.ok(ranked("alder").length > 5);
  // At most 24 terms count: the 25th word of the last query is left out by both.
  const long = `${WORDS.join(" ")} tide`;
  assert.notDeepEqual(ranked(long, 25).slice(0, 40), ranked(long).slice(0, 40), "the 25th term would change the order");
  // A smaller limit on terms reads as a shorter query to the real search.
  assert.deepEqual(ranked("kiln lantern mossy nectar", 2).slice(0, 40), await searched("kiln lantern"));
});

test("on a generation with a word list, the quote search gives the order of forms_bm25_coordination, whole and paged", async (t) => {
  const { passages, population, reader } = await openedCorpus(t, { wordList: true });
  const index = buildVariantIndex(passages, FORMS_BM25_COORDINATION);
  const ranked = (query) => rankPassages({ index, query, population });
  const all = async (query) => {
    const ids = [];
    let cursor = null;
    do {
      const page = await reader.findQuotes({ query, limit: 40, byteBudget: 48_000, matchTags: false, cursor });
      ids.push(...page.quotes.map((quote) => quote.quote_id));
      cursor = page.next_cursor;
    } while (cursor);
    return ids;
  };
  const queries = ["alder", "alder cobble", "Alder, COBBLE; alder!", "tide", "the tide and the alder", "the and of to", "quartz",
    "alder quartz", "kiln lantern mossy nectar", "ember ember ember", "déprimée", "deprime", "Marguerite lettres", "les de la",
    "la déprime des chevaux", "cheval chevaux horse horses", "running walks walked", `${WORDS.join(" ")} tide`];
  for (const query of queries) assert.deepEqual(await all(query), ranked(query), query);
  // The queries are not all alike: some tie, some run past one call's limit, some find nothing, and the forms reading finds more.
  assert.equal(ranked("tide").length, 51);
  assert.equal((await all("tide")).length, 51);
  assert.deepEqual(await all("quartz"), []);
  assert.equal(ranked("deprime").length, 3, "accents and French endings read alike: déprime, déprimé, déprimée");
  assert.ok(ranked("la déprime des chevaux").length > ranked("deprime").length);
  const exact = buildVariantIndex(passages, CURRENT);
  assert.notDeepEqual(ranked("la déprime des chevaux"), rankPassages({ index: exact, query: "la déprime des chevaux", population }), "not the search's own order");
  // What a page says about how the words matched: the query's own words, not the stems the ranking goes by.
  const found = await reader.findQuotes({ query: "deprimé chevaux", limit: 40, byteBudget: 48_000, matchTags: false });
  assert.deepEqual(found.coverage.terms_ranked, ["deprimé", "chevaux"]);
  assert.equal(found.coverage.ranking, "word_forms", "the result says how its words matched");
  assert.deepEqual(found.coverage.terms_ignored, []);
  assert.equal(found.coverage.matching_quotes, ranked("deprimé chevaux").length);
  const both = found.quotes.find((quote) => quote.text.startsWith("Il a déprimé"));
  assert.deepEqual(both.matched_terms, ["deprimé", "chevaux"]);
  assert.equal(found.quotes[0].quote_id, both.quote_id, "the quote that holds both words ranks first");
  assert.deepEqual(found.quotes.find((quote) => quote.text.startsWith("Marguerite était déprimée")).matched_terms, ["deprimé"]);
  const common = await reader.findQuotes({ query: "the and of", limit: 3, matchTags: false });
  assert.deepEqual(common.coverage.terms_ranked, ["the", "and", "of"], "a query of only common words still searches by them");
  const mixed = await reader.findQuotes({ query: "the tide and of", limit: 3, matchTags: false });
  assert.deepEqual(mixed.coverage.terms_ranked, ["tide"]);
  assert.deepEqual(mixed.coverage.terms_ignored, ["the", "and", "of"]);
});

test("quotes with the same words and length tie, and the word list orders them by id as the check does", async (t) => {
  const paragraphs = ["Lantern and kiln.", "Lantern and kiln.", "Kiln and lantern.", "Lantern kiln lantern kiln.", "The kiln glowed.", "The kiln glowed.",
    "Only a lantern here.", "Only a lantern here.", "Nothing at all.", "A lantern and a kiln and a mossy stone and a long wall."];
  const { passages, population, reader } = await openedCorpus(t, { wordList: true, paragraphs });
  const index = buildVariantIndex(passages, FORMS_BM25_COORDINATION);
  for (const query of ["lantern kiln", "kiln", "lantern", "kiln glowed", "Lantern, KILN!"]) {
    const page = await reader.findQuotes({ query, limit: 40, byteBudget: 48_000, matchTags: false });
    const order = rankPassages({ index, query, population });
    assert.deepEqual(page.quotes.map((quote) => quote.quote_id), order, query);
    const ties = page.quotes.slice(1).filter((quote, number) => quote.score === page.quotes[number].score && quote.matched_terms.length === page.quotes[number].matched_terms.length);
    assert.ok(ties.length > 0, `${query} has tied quotes`);
    for (const quote of ties) {
      const before = page.quotes[page.quotes.indexOf(quote) - 1];
      assert.ok(before.quote_id.localeCompare(quote.quote_id) < 0, "tied quotes are in id order");
    }
  }
});

test("a cursor from a generation without a word list is refused on one with it, and the other way round", async (t) => {
  const cursorSecret = randomBytes(32);
  const query = "tide";
  const [plain, listed] = [await openedCorpus(t, { cursorSecret }), await openedCorpus(t, { wordList: true, cursorSecret })];
  const first = (corpus) => corpus.reader.findQuotes({ query, limit: 5, matchTags: false });
  const [plainCursor, listedCursor] = [(await first(plain)).next_cursor, (await first(listed)).next_cursor];
  assert.ok(plainCursor && listedCursor && plainCursor !== listedCursor, "the two rankings sign different cursors");
  // The same generation and the same query: only the ranking differs.
  await assert.rejects(listed.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: plainCursor }), { code: "CURSOR_QUERY_MISMATCH" });
  await assert.rejects(plain.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: listedCursor }), { code: "CURSOR_QUERY_MISMATCH" });
  // Each pages its own.
  assert.equal((await listed.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: listedCursor })).quotes.length, 5);
  assert.equal((await plain.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: plainCursor })).quotes.length, 5);
  // Generations named for different versions are different snapshots as well.
  const named = await openedCorpus(t, { wordList: true, generation: "search-check:quotes:quote-index-v3-month-first", cursorSecret });
  await assert.rejects(named.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: plainCursor }), { code: "CURSOR_SNAPSHOT_INVALID" });
  await assert.rejects(plain.reader.findQuotes({ query, limit: 5, matchTags: false, cursor: (await first(named)).next_cursor }), { code: "CURSOR_SNAPSHOT_INVALID" });
});

test("a generation with a word list needs its totals, and a search reads only the terms it asks for", async (t) => {
  const { reader } = await openedCorpus(t, { wordList: true });
  const found = await reader.findQuotes({ query: "alder", limit: 2, matchTags: false });
  assert.ok(found.coverage.encrypted_objects_read > 0 && found.coverage.encrypted_objects_read < 12, "a few index shards, not the whole index");
  assert.equal(found.coverage.full_archive_loaded, false);
});

// 130 passages that all hold "zorbit", so a search for it ranks them by id: passage number n has rank n + 1.
// Number 100 also holds "ranker".
const RANKED = Array.from({ length: 130 }, (_, number) => passage(number, number === 100 ? "zorbit ranker" : "zorbit"));
const question = (name, number, queries, extra = {}) => ({ question_id: `question:${name}`, unit_id: `unit:${number}`, queries, ...extra });
const passageOfUnit = (unitId) => (unitId === "unit:500" ? "passage:999" : `passage:${unitId.slice("unit:".length).padStart(3, "0")}`);

const RANK_UNITS = [
  { status: "complete", questions: [question("r1", 0, ["zorbit"]), question("r12", 11, ["zorbit"]), question("r13", 12, ["zorbit"]),
    question("r24", 23, ["zorbit"]), question("r25", 24, ["zorbit"])] },
  { status: "marked", questions: [question("r40", 39, ["zorbit"]), question("r41", 40, ["zorbit"]), question("r100", 99, ["zorbit"]),
    question("r101", 100, ["zorbit"]), question("r130", 129, ["zorbit"])] },
  { status: "complete", questions: [
    question("none", 5, ["unmatchable"]),
    question("late", 20, ["unmatchable", "zorbit"]),
    question("best", 100, ["zorbit", "zorbit ranker", "zorbit"]),
    question("absent", 500, ["zorbit"]),
    question("bare", 7, [])
  ] },
  // Left out: a question flagged as copying its quote, units with another status, and a unit that has no questions to look at.
  { status: "complete", questions: [question("copied", 3, ["zorbit"], { copied: true }),
    question("kept", 4, ["zorbit"], { copied: false })] },
  { status: "unconfirmed", questions: [question("unconfirmed", 1, ["zorbit"])] },
  { status: "nonresponse" }
];

test("questions are counted by the best rank of their passage across their queries, in the same ranges for every variant", () => {
  const result = checkQuestions({ units: RANK_UNITS, passageIdForUnit: passageOfUnit, passages: RANKED, population: 131 });
  assert.equal(result.questions, 16, "the 16 questions of complete and marked units that are not flagged as copied");
  assert.deepEqual(Object.keys(result.variants), VARIANT_IDS, "all thirteen variants by default");
  const names = (set) => [...set].map((id) => id.slice("question:".length)).sort();
  const current = result.variants.current;
  assert.deepEqual(Object.keys(current), ["found", "counts", "buckets"]);
  assert.deepEqual(Object.keys(current.found), ["12", "24", "40"]);
  assert.deepEqual(names(current.found[12]), ["best", "kept", "r1", "r12"]);
  assert.deepEqual(names(current.found[24]), ["best", "kept", "late", "r1", "r12", "r13", "r24"]);
  assert.deepEqual(names(current.found[40]), ["best", "kept", "late", "r1", "r12", "r13", "r24", "r25", "r40"]);
  assert.deepEqual(current.counts, { 12: 4, 24: 7, 40: 9 });
  assert.deepEqual(current.buckets, { top_12: 4, from_13_to_24: 3, from_25_to_40: 2, from_41_to_100: 2, over_100: 2, not_ranked: 3 });
  assert.deepEqual(Object.keys(current.buckets), ["top_12", "from_13_to_24", "from_25_to_40", "from_41_to_100", "over_100", "not_ranked"]);
  assert.equal(Object.values(current.buckets).reduce((total, count) => total + count, 0), result.questions);
  // These words read the same under every variant, and the passages hold them once each, so every variant finds the same questions.
  // The BM25 ones do put passage 100, the only passage of two tokens, last instead of 101st, and move 101 to 129 up by one. All of them
  // stay beyond the 100th place, so the counts and the ranges do not change here.
  for (const variant of SEARCH_CHECK_VARIANTS) assert.deepEqual(result.variants[variant.id], current, variant.id);
  assert.equal(rankWith(CURRENT, RANKED, "zorbit", 131).indexOf("passage:100"), 100);
  assert.equal(rankWith(BM25, RANKED, "zorbit", 131).indexOf("passage:100"), 129);
});

test("a question is found at a cutoff exactly when its best rank is at most the cutoff", () => {
  const units = [{ status: "complete", questions: [question("a", 0, ["zorbit"]), question("b", 1, ["zorbit"]), question("c", 2, ["zorbit"]),
    question("d", 10, ["zorbit"])] }];
  const result = checkQuestions({ units, passageIdForUnit: passageOfUnit, passages: RANKED, population: 131, variants: [CURRENT],
    cutoffs: [1, 3, 11] });
  const { found, counts, buckets } = result.variants.current;
  assert.deepEqual(Object.keys(found), ["1", "3", "11"]);
  assert.deepEqual([...found[1]], ["question:a"]);
  assert.deepEqual([...found[3]].sort(), ["question:a", "question:b", "question:c"]);
  assert.deepEqual([...found[11]].sort(), ["question:a", "question:b", "question:c", "question:d"]);
  assert.deepEqual(counts, { 1: 1, 3: 3, 11: 4 });
  assert.deepEqual(buckets, { top_12: 4, from_13_to_24: 0, from_25_to_40: 0, from_41_to_100: 0, over_100: 0, not_ranked: 0 });
  assert.deepEqual(Object.keys(result.variants), ["current"]);
});

test("the order of the units and of the queries does not change the counts", () => {
  const forward = checkQuestions({ units: RANK_UNITS, passageIdForUnit: passageOfUnit, passages: RANKED, population: 131 });
  const turned = RANK_UNITS.map((unit) => (Array.isArray(unit.questions)
    ? { ...unit, questions: [...unit.questions].reverse().map((item) => ({ ...item, queries: [...item.queries].reverse() })) }
    : unit)).reverse();
  const backward = checkQuestions({ units: turned, passageIdForUnit: passageOfUnit, passages: [...RANKED].reverse(), population: 131 });
  assert.deepEqual(backward, forward);
});

test("each variant finds the questions its word matching makes alike", () => {
  const passages = [passage(1, "Il était déprimé ce matin-là."), passage(2, "The gulls counted nothing at dawn."),
    passage(3, "Le cheval dort dans le champ.")];
  const units = [{ status: "complete", questions: [
    { question_id: "accent", unit_id: "one", queries: ["deprime"] },
    { question_id: "english", unit_id: "two", queries: ["count"] },
    { question_id: "french", unit_id: "three", queries: ["chevaux"] }
  ] }];
  const passageIds = { one: "passage:001", two: "passage:002", three: "passage:003" };
  const result = checkQuestions({ units, passageIdForUnit: (unitId) => passageIds[unitId], passages, population: 4 });
  const found = (variant) => [...result.variants[variant].found[12]].sort();
  assert.deepEqual(found("current"), []);
  assert.deepEqual(found("accents"), ["accent"]);
  assert.deepEqual(found("french_stopwords"), []);
  assert.deepEqual(found("english_forms"), ["english"]);
  assert.deepEqual(found("french_forms"), ["french"]);
  assert.deepEqual(found("all"), ["accent", "english", "french"]);
  // The scoring does not change which questions their words find: the variants that only change it read like "current", the four
  // "forms" like "all".
  for (const id of ["coordination", "bm25", "bm25_coordination"]) assert.deepEqual(found(id), [], id);
  for (const id of ["forms", "forms_coordination", "forms_bm25", "forms_bm25_coordination"]) {
    assert.deepEqual(found(id), ["accent", "english", "french"], id);
  }
  const buckets = (top, notRanked) => ({ top_12: top, from_13_to_24: 0, from_25_to_40: 0, from_41_to_100: 0, over_100: 0,
    not_ranked: notRanked });
  assert.deepEqual(result.variants.current.buckets, buckets(0, 3));
  assert.deepEqual(result.variants.all.buckets, buckets(3, 0));
  assert.deepEqual(result.variants.bm25_coordination.buckets, buckets(0, 3));
  assert.deepEqual(result.variants.forms_bm25.buckets, buckets(3, 0));
});

// 130 passages that all hold "zorbit" once, with other words besides: passage number n has n % 7 of them, so 1 + n % 7 tokens. By
// idf_sum a search for "zorbit" ranks them by id, and by BM25 the shortest first (the ones of equal length by id).
const LENGTHS = Array.from({ length: 130 }, (_, number) => passage(number, `zorbit ${repeat(number % 7, "filler")}`));
const SHORTEST_FIRST = Array.from({ length: 130 }, (_, number) => number).sort((left, right) => (left % 7) - (right % 7) || left - right);
const rangeOf = (rank) => {
  if (rank === Infinity) return "not_ranked";
  if (rank <= 12) return "top_12";
  if (rank <= 24) return "from_13_to_24";
  if (rank <= 40) return "from_25_to_40";
  return rank <= 100 ? "from_41_to_100" : "over_100";
};

test("all thirteen variants are counted the same way: found sets, counts and ranges agree with each variant's own ranking", () => {
  // Each question is named n<number> after its passage, and the three others are the odd ones out: no passage holds its word, its
  // passage is not among the passages, and the best of its two queries counts.
  const units = [{ status: "complete", questions: [
    ...Array.from({ length: 130 }, (_, number) => question(`n${number}`, number, ["zorbit"])),
    question("none", 5, ["unmatchable"]),
    question("absent", 500, ["zorbit"]),
    question("either", 129, ["unmatchable", "zorbit"])
  ] }];
  const result = checkQuestions({ units, passageIdForUnit: passageOfUnit, passages: LENGTHS, population: 131 });
  assert.equal(result.questions, 133);
  assert.deepEqual(Object.keys(result.variants), VARIANT_IDS);
  // [question, the passage that ranks for it or null]
  const subjects = [...Array.from({ length: 130 }, (_, number) => [`n${number}`, idsOf(number)[0]]), ["none", null], ["absent", null],
    ["either", idsOf(129)[0]]];
  const names = (set) => [...set].map((id) => id.slice("question:".length)).sort();
  for (const variant of SEARCH_CHECK_VARIANTS) {
    const { found, counts, buckets } = result.variants[variant.id];
    // The variant's own ranking of the one query that finds anything gives every question's best rank.
    const rankOf = new Map(rankWith(variant, LENGTHS, "zorbit", 131).map((id, position) => [id, position + 1]));
    const best = (passageId) => (passageId === null ? Infinity : rankOf.get(passageId));
    const expectedBuckets = { top_12: 0, from_13_to_24: 0, from_25_to_40: 0, from_41_to_100: 0, over_100: 0, not_ranked: 0 };
    for (const [, passageId] of subjects) expectedBuckets[rangeOf(best(passageId))] += 1;
    assert.deepEqual(buckets, expectedBuckets, variant.id);
    for (const cutoff of [12, 24, 40]) {
      const expected = subjects.filter(([, passageId]) => best(passageId) <= cutoff).map(([name]) => name).sort();
      assert.deepEqual(names(found[cutoff]), expected, `${variant.id} at ${cutoff}`);
      assert.equal(counts[cutoff], found[cutoff].size, `${variant.id} at ${cutoff}`);
    }
    // The ranges add up to the questions, the first is what is found at 12, and what is found at one cutoff is found at the next.
    assert.equal(Object.values(buckets).reduce((total, count) => total + count, 0), result.questions, variant.id);
    assert.equal(buckets.top_12, counts[12], variant.id);
    assert.equal(buckets.top_12 + buckets.from_13_to_24, counts[24], variant.id);
    assert.equal(buckets.top_12 + buckets.from_13_to_24 + buckets.from_25_to_40, counts[40], variant.id);
    for (const name of found[12]) assert.ok(found[24].has(name) && found[40].has(name), `${variant.id}: ${name}`);
    for (const name of found[24]) assert.ok(found[40].has(name), `${variant.id}: ${name}`);
    assert.equal(buckets.not_ranked, 2, `${variant.id}: the question no passage answers and the one whose passage is not there`);
  }
  // Where the scorings differ is the order. By idf_sum (and coordination, and the forms readings) the first twelve places go to passages
  // 0 to 11. By BM25 they go to the twelve shortest passages that come first by id: 0, 7, 14 and so on, and the next twelve places to the
  // rest of the one-token passages and the first two-token ones.
  const top = (id, cutoff) => names(result.variants[id].found[cutoff]).filter((name) => name.startsWith("n"));
  const named = (numbers) => numbers.map((number) => `n${number}`).sort();
  for (const id of ["current", "coordination", "forms", "forms_coordination"]) {
    assert.deepEqual(top(id, 12), named(Array.from({ length: 12 }, (_, number) => number)), id);
  }
  assert.deepEqual(SHORTEST_FIRST.slice(0, 12), [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77]);
  for (const id of ["bm25", "bm25_coordination", "forms_bm25", "forms_bm25_coordination"]) {
    assert.deepEqual(top(id, 12), named(SHORTEST_FIRST.slice(0, 12)), id);
    assert.deepEqual(top(id, 24), named(SHORTEST_FIRST.slice(0, 24)), id);
  }
  // A variant is counted on its own: a shorter list gives the same numbers for the variants it names, in the order it names them.
  const some = checkQuestions({ units, passageIdForUnit: passageOfUnit, passages: LENGTHS, population: 131,
    variants: [FORMS_BM25_COORDINATION, CURRENT] });
  assert.deepEqual(Object.keys(some.variants), ["forms_bm25_coordination", "current"]);
  assert.deepEqual(some.variants.forms_bm25_coordination, result.variants.forms_bm25_coordination);
  assert.deepEqual(some.variants.current, result.variants.current);
});

test("the result is frozen, holds ids and counts only, is the same on every run, and the input is not changed", () => {
  const input = deepFreeze({ units: structuredClone(RANK_UNITS), passages: structuredClone(RANKED) });
  const run = () => checkQuestions({ units: input.units, passageIdForUnit: passageOfUnit, passages: input.passages, population: 131 });
  const result = run();
  assert.deepEqual(run(), result);
  for (const value of [result, result.variants, result.variants.current, result.variants.all.found, result.variants.all.counts,
    result.variants.all.buckets]) {
    assert.ok(Object.isFrozen(value));
  }
  for (const set of Object.values(result.variants.current.found)) assert.ok(set instanceof Set);
  const text = JSON.stringify(result, (key, value) => (value instanceof Set ? [...value] : value));
  assert.ok(!/zorbit|ranker|unmatchable/u.test(text), "no text from the passages or the queries");
  assert.ok(text.includes("question:r1"), "question ids are what it holds");
});

test("the passage of a question is asked for only when the question is counted, and must be an id", () => {
  const asked = [];
  const passageIdForUnit = (unitId) => {
    asked.push(unitId);
    return passageOfUnit(unitId);
  };
  checkQuestions({ units: RANK_UNITS, passageIdForUnit, passages: RANKED, population: 131, variants: [CURRENT] });
  assert.equal(asked.length, 16, "once for each counted question, never for a copied one or a unit that is not searched");
  assert.ok(!asked.includes("unit:3"), "the copied question's quote is not asked for");
  assert.ok(!asked.includes("unit:1"), "nor that of a unit that was not searched");
  const units = [{ status: "complete", questions: [question("a", 0, ["zorbit"])] }];
  for (const answer of [undefined, null, 5, {}]) {
    assert.throws(() => checkQuestions({ units, passageIdForUnit: () => answer, passages: RANKED, population: 131 }), INVALID);
  }
});

test("checkQuestions refuses input it cannot count, with a bare code", () => {
  const good = { units: RANK_UNITS, passageIdForUnit: passageOfUnit, passages: RANKED, population: 131 };
  assert.doesNotThrow(() => checkQuestions(good));
  assert.throws(() => checkQuestions(), INVALID);
  for (const bad of [{ units: {} }, { units: null }, { passageIdForUnit: "passageOfUnit" }, { passages: {} }, { population: undefined },
    { population: -1 }, { population: 1.5 }, { population: "131" }, { variants: [] }, { variants: [{ id: "x" }] },
    { variants: [CURRENT, CURRENT] }, { variants: [BM25, { ...BM25 }] }, { variants: [{ ...CURRENT, scoring: "tf_idf" }] },
    { variants: [CURRENT, { ...BM25, scoring: undefined }] },
    { variants: "all" }, { cutoffs: [] }, { cutoffs: [0] }, { cutoffs: [12, 12] }, { cutoffs: [1.5] }, { cutoffs: "12" }]) {
    assert.throws(() => checkQuestions({ ...good, ...bad }), INVALID, JSON.stringify(Object.keys(bad)));
  }
  const unitsWith = (questions) => [{ status: "complete", questions }];
  for (const questions of [
    [null],
    [{ unit_id: "unit:0", queries: ["zorbit"] }],
    [{ question_id: "a", unit_id: "unit:0", queries: "zorbit" }],
    [{ question_id: "a", unit_id: "unit:0", queries: [7] }],
    [question("same", 0, ["zorbit"]), question("same", 1, ["zorbit"])]
  ]) {
    assert.throws(() => checkQuestions({ ...good, units: unitsWith(questions) }), INVALID);
  }
  assert.throws(() => checkQuestions({ ...good, units: [{ status: "complete" }] }), INVALID);
  assert.throws(() => checkQuestions({ ...good, units: [null] }), INVALID);
  assert.throws(() => checkQuestions({ ...good, passages: [{ id: "entity:1", quote: "zorbit" }] }), INVALID);
  // Units that are not counted are not looked into.
  assert.doesNotThrow(() => checkQuestions({ ...good, units: [{ status: "unconfirmed" }, { status: "nonresponse", questions: 7 }] }));
  assert.equal(checkQuestions({ ...good, units: [] }).questions, 0);
  assert.deepEqual(checkQuestions({ ...good, units: [] }).variants.all.counts, { 12: 0, 24: 0, 40: 0 });
});

test("the word reading lives in word-forms.mjs, which search-check re-exports, and its forms reading is the forms variants' reading", () => {
  assert.equal(foldAccents, wordForms.foldAccents);
  assert.equal(porterStem, wordForms.porterStem);
  assert.equal(frenchLightStem, wordForms.frenchLightStem);
  assert.equal(FRENCH_STOPWORDS, wordForms.FRENCH_STOPWORDS);
  const text = "Déprimée, les chevaux couraient; Running RUNS ran 3 fois — l'amie d'Hélène œuvre, naïve café 2019!";
  for (const variant of [FORMS, FORMS_COORDINATION, FORMS_BM25, FORMS_BM25_COORDINATION]) {
    assert.deepEqual(wordForms.formsReadingTokens(text), variantTokensOf(text, variant));
    assert.deepEqual(wordForms.formsReadingTokens(text, new Map()), variantTokensOf(text, variant), "a memo changes nothing");
    assert.deepEqual([...wordForms.formsReadingStopwords()].sort(), [...variantStopwords(variant)].sort(), "English stop words only, French kept in");
  }
  assert.deepEqual(wordForms.formsReadingTokens(null), []);
  assert.equal(wordForms.formsReadingTerm("déprimées"), variantTerm("déprimées", FORMS));
  // The query's terms: read, each once in order, the stop words left out unless none is left, cut to the first `termsMax`.
  const query = "The running of the Horses, la déprimée; horse RUNNING and the";
  const { all, terms } = wordForms.formsQueryTerms(query, 24);
  assert.deepEqual(all, variantTermsOf(query, FORMS_BM25_COORDINATION));
  assert.deepEqual(terms, all.filter((term) => !variantStopwords(FORMS_BM25_COORDINATION).has(term)));
  assert.deepEqual(wordForms.formsQueryTerms(query, 2).terms, terms.slice(0, 2));
  assert.deepEqual(wordForms.formsQueryTerms("the and of", 24).terms, wordForms.formsQueryTerms("the and of", 24).all, "only common words: all of them");
  assert.throws(() => wordForms.formsQueryTerms("horses", 0), INVALID);
  assert.throws(() => wordForms.formsQueryTerms(7, 24), INVALID);
});
