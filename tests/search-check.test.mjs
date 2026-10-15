import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { QUOTE_STOPWORDS, buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { FRENCH_STOPWORDS, SEARCH_CHECK_VARIANTS, buildVariantIndex, checkQuestions, foldAccents, frenchLightStem, porterStem,
  rankPassages, variantStopwords, variantTerm, variantTermsOf } from "../src/journal-import/search-check.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

// The search check (src/journal-import/search-check.mjs): the journal quote search's word ranking computed again in memory, for the
// search as it is and for variants of its word matching, and the count of test questions each variant would find. All text here is
// invented.

const [CURRENT, ACCENTS, FRENCH_STOP, ENGLISH_FORMS, FRENCH_FORMS, ALL] = SEARCH_CHECK_VARIANTS;
const INVALID = { code: "SEARCH_CHECK_INPUT_INVALID" };

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};
const passage = (number, quote) => ({ id: `passage:${String(number).padStart(3, "0")}`, quote });

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

test("the variants are the six ways of matching words, in order, each a frozen record of four flags", () => {
  assert.ok(Object.isFrozen(SEARCH_CHECK_VARIANTS));
  assert.deepEqual(SEARCH_CHECK_VARIANTS.map(({ id }) => id),
    ["current", "accents", "french_stopwords", "english_forms", "french_forms", "all"]);
  const flags = (variant) => Object.keys(variant).filter((key) => variant[key] === true);
  assert.deepEqual(flags(CURRENT), []);
  assert.deepEqual(flags(ACCENTS), ["foldAccents"]);
  assert.deepEqual(flags(FRENCH_STOP), ["frenchStopwords"]);
  assert.deepEqual(flags(ENGLISH_FORMS), ["englishForms"]);
  assert.deepEqual(flags(FRENCH_FORMS), ["frenchForms"]);
  assert.deepEqual(flags(ALL), ["foldAccents", "frenchStopwords", "englishForms", "frenchForms"]);
  for (const variant of SEARCH_CHECK_VARIANTS) {
    assert.ok(Object.isFrozen(variant));
    assert.deepEqual(Object.keys(variant), ["id", "foldAccents", "frenchStopwords", "englishForms", "frenchForms"]);
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
    () => buildVariantIndex([passage(1, secret)], null)
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (error) => error.code === "SEARCH_CHECK_INPUT_INVALID" && error.message === "SEARCH_CHECK_INPUT_INVALID"
      && !JSON.stringify(error.details ?? {}).includes("secret"));
  }
});

test("words match only under the variants that make them alike", () => {
  const matches = (stored, query) => Object.fromEntries(SEARCH_CHECK_VARIANTS.map((variant) => [variant.id,
    rankPassages({ index: buildVariantIndex([passage(1, stored)], variant), query, population: 2 }).length === 1]));
  // An accent: "déprimé" and "deprime" match under accents and all.
  assert.deepEqual(matches("Il était déprimé ce matin", "deprime"), { current: false, accents: true, french_stopwords: false,
    english_forms: false, french_forms: false, all: true });
  // An English word form.
  assert.deepEqual(matches("The gulls counted nothing", "count"), { current: false, accents: false, french_stopwords: false,
    english_forms: true, french_forms: false, all: true });
  // A French word form.
  assert.deepEqual(matches("Le cheval dort", "chevaux"), { current: false, accents: false, french_stopwords: false,
    english_forms: false, french_forms: true, all: true });
  assert.deepEqual(matches("Elle est déprimée", "déprimé"), { current: false, accents: false, french_stopwords: false,
    english_forms: false, french_forms: true, all: true });
  // The same word matches everywhere.
  assert.deepEqual(matches("The harbour wall", "harbour"), { current: true, accents: true, french_stopwords: true, english_forms: true,
    french_forms: true, all: true });
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
async function openedCorpus(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "search-check-"));
  let reader = null;
  t.after(async () => {
    reader?.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const caseId = "search-check-case", corpusId = "search-check-corpus:quotes", generation = "search-check-generation";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const text = inventedParagraphs().join("\n\n");
  const representations = [{ representation_id: "test:page:0", text, page_number: 1, parse_status: "readable" }];
  const built = buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId: "original:test", mediaType: "application/pdf",
    representations, unitOptions: { minimumBytes: 0 } });
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph,
    sourceRepresentations: Object.fromEntries(representations.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths }, indexRepresentations: true });
  reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  return {
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
  assert.deepEqual(Object.keys(result.variants), ["current", "accents", "french_stopwords", "english_forms", "french_forms", "all"]);
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
  // These words read the same under every variant, so every variant finds the same questions.
  for (const variant of SEARCH_CHECK_VARIANTS) assert.deepEqual(result.variants[variant.id], current, variant.id);
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
  const buckets = (top, notRanked) => ({ top_12: top, from_13_to_24: 0, from_25_to_40: 0, from_41_to_100: 0, over_100: 0,
    not_ranked: notRanked });
  assert.deepEqual(result.variants.current.buckets, buckets(0, 3));
  assert.deepEqual(result.variants.all.buckets, buckets(3, 0));
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
    { variants: [CURRENT, CURRENT] },
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
