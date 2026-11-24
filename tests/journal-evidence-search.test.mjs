import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalResultCache, EVIDENCE_QUOTE_SEARCH, openPrivateJournalGraph, QUOTE_BM25 } from "../src/journal-import/retrieval.mjs";
import { quoteCues } from "../src/journal-import/quote-index.mjs";
import { formsReadingTokens, formsReadingTerm } from "../src/journal-import/word-forms.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { inventedPages, inventedParagraphs, persistInventedJournal } from "./helpers/invented-journal.mjs";

// The ranked search a reply's evidence makes (docs/superpowers/specs/2026-11-24-runner-journal-search-design.md, point 1): which of a
// whole message's words it goes by, which quotes it keeps, in what order, and which of them may be used. Every journal is invented.

const CASE = "evidence-search-case", CORPUS = "evidence-search-corpus";
const ALL = ["quote-index-v4", "quote-index-v2", "none"];

async function journal(t, { paragraphs, dates = new Map(), index = "quote-index-v4", change = null }) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-search-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = createPrivateJournalCorpusStore({ rootDir, caseId: CASE, corpusId: CORPUS, corpusKey: randomBytes(32) });
  const invented = await persistInventedJournal({ corpusStore: store, caseId: CASE, corpusId: CORPUS, pages: inventedPages(paragraphs, { dates }), index, change });
  const cursorSecret = randomBytes(32);
  const open = (options = {}) => openPrivateJournalGraph({ corpusStore: store, manifestObjectId: invented.persisted.manifest_object_id, caseId: CASE, corpusId: CORPUS,
    generation: invented.generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret, ...options });
  const find = async (query, options = {}) => {
    const { limit = 6, ...opened } = options;
    const reader = await open(opened);
    try { return await reader.findEvidenceQuotes({ query, limit }); } finally { reader.close(); }
  };
  return { ...invented, store, open, find, texts: async (query, options) => (await find(query, options)).quotes.map(({ text }) => text) };
}

// Paragraphs whose words are their own, with the words given added: `held` maps a word to how many of them hold it, and a paragraph may
// be given further words. Words with a digit read the same exactly and through the forms reading.
function countedParagraphs(size, held = {}, extra = {}) {
  const words = Array.from({ length: size }, (_, index) => [`own${index}a`, `own${index}b`, `own${index}c`, ...(extra[index] ?? [])]);
  // From the end, each word's holders apart from the next word's as long as there is room.
  let next = 0;
  for (const [word, count] of Object.entries(held)) for (let added = 0; added < count; added += 1) words[(next++) % size].push(word);
  return words.map((list) => `${list.join(" ")}.`);
}
const counts = (entries) => entries.map(({ term, quotes, reason }) => [term, quotes, ...(reason ? [reason] : [])]);

test("the numbers of the search, in one place with their version: a change of one is a change of the version", () => {
  assert.deepEqual(EVIDENCE_QUOTE_SEARCH, { version: "evidence-quotes-v1", common: { share: 0.05, quotes: 20 }, rare: { share: 0.01, quotes: 10 },
    matched: { terms: 2, share: 0.5, atMost: 3 }, candidatesMax: 40, queryCharacters: 40_000 });
  assert.deepEqual(QUOTE_BM25, { k1: 1.2, b: 0.75 }, "the constants of the version 3 ranking");
});

for (const index of ALL) test(`words are read as the generation reads them, without the English and French stop words, and one no quote holds is dropped (${index})`, async (t) => {
  const quote = "Les cerisiers fleurissaient derrière l'école, and I dreamed of climbing one.";
  const { find } = await journal(t, { paragraphs: [...countedParagraphs(12), quote], index });
  const result = await find("Pourquoi est-ce que je rêve encore du cerisier de notre école, what does it mean to you and me?");
  const forms = index === "quote-index-v4";
  // "cerisier" is the quote's "cerisiers" in another form: the forms reading finds it, exact words don't. "école" is written the same.
  assert.deepEqual(counts(result.terms.chosen), forms ? [["cerisi", 1], ["ecol", 1]] : [["école", 1]]);
  const dropped = result.terms.dropped.map(({ term }) => term);
  for (const stopword of ["est", "que", "je", "du", "de", "notre", "what", "does", "it", "to", "you", "and", "me"]) {
    const read = forms ? formsReadingTerm(stopword) : stopword;
    assert.equal(dropped.includes(read) || result.terms.chosen.some(({ term }) => term === read), false, `${stopword} is a stop word`);
  }
  assert.ok(result.terms.dropped.every(({ quotes, reason }) => quotes === 0 && reason === "in_no_quote"));
  assert.equal(result.terms.quotes, 13);
  assert.deepEqual(result.quotes.map(({ text, matched_terms: matched }) => [text, matched]), [[quote, result.terms.chosen.map(({ term }) => term)]]);
});

// What a message is searched by, for its words, on a journal whose other quotes hold none of them.
const searchedBy = (result) => [...result.terms.chosen, ...result.terms.dropped].map(({ term }) => term).sort();

for (const index of ALL) test(`a stop word is left out as the message writes it, never a word that only reads like one (${index})`, async (t) => {
  // Every word here reads, in the word list, as a stop word does: "shoulder" as "should", "care" as the French "car", "toy" as "toi",
  // "coming" as "comme", "sure" as "sur", "offer" as "off", "mois" as "moi". Thirty quotes hold those stop words.
  const told = ["My left shoulder aches again.", "She took care of me in the hospital.", "The toy horse is in the attic.", "I was sure of it.", "He made an offer for the land.", "Trois mois sans nouvelles.", "Her shoulders were cold."];
  const { find, texts } = await journal(t, { paragraphs: [...countedParagraphs(200, { should1x: 1 }), ...Array.from({ length: 30 }, (_, place) => `own${place}z should and car and toi and comme and sur and off and moi and both.`), ...told], index });
  const found = async (query) => (await texts(query)).filter((text) => told.includes(text)).sort();
  assert.deepEqual(await found("It's my shoulder, I think you should know."), index === "quote-index-v4" ? [told[6], told[0]] : [told[0]], "with its plural, where the list reads word forms");
  assert.deepEqual(await found("My shoulders."), index === "quote-index-v4" ? [told[6], told[0]] : [told[6]]);
  for (const [query, at] of [["Who takes care of me now?", 1], ["Whatever happened to that toy?", 2], ["I'm sure that I was there.", 3], ["What about his offer?", 4], ["Cela fait un mois.", 5]]) assert.deepEqual(await found(query), [told[at]], query);
  // None of the thirty is found by the stop words themselves, and a word and its plural are one word, not two.
  for (const query of ["you should come over, both of us, off and on", "car toi et moi, comme sur la photo"]) assert.deepEqual(searchedBy(await find(query)).filter((term) => ["should", "both", "car", "toi", "moi", "comme", "off", "sur"].includes(term)), [], query);
  const twice = await find("my shoulder and both shoulders");
  assert.deepEqual(counts(twice.terms.chosen), index === "quote-index-v4" ? [["shoulder", 2]] : [["shoulder", 1], ["shoulders", 1]]);
  assert.deepEqual(twice.quotes.map(({ matched_terms: matched }) => matched), index === "quote-index-v4" ? [["shoulder"], ["shoulder"]] : twice.quotes.map(({ text }) => [text.includes("shoulders") ? "shoulders" : "shoulder"]));
});

test("a word looked up as written counts as one use in a quote of mean length", async (t) => {
  // Every quote has four words, so a word the word list holds and one looked up as written weigh the same when three quotes hold each.
  const held = Array.from({ length: 6 }, (_, place) => `${place % 2 ? "shoulder" : "harbour1"} four${place}b four${place}c four${place}d.`);
  const { texts, passageOf } = await journal(t, { paragraphs: [...Array.from({ length: 80 }, (_, place) => `own${place}a own${place}b own${place}c own${place}d.`), ...held] });
  const byId = [...held].sort((left, right) => passageOf(left).localeCompare(passageOf(right)));
  assert.notDeepEqual(byId.map((text) => text.startsWith("shoulder")), [false, false, false, true, true, true], "the ids don't sort the two words apart by themselves");
  assert.deepEqual(await texts("shoulder harbour1"), byId);
});

for (const index of ALL) test(`a stop word of one language that is a word of the other is left out only in a message written in its own (${index})`, async (t) => {
  const told = ["My son drove the old car into the pond.", "Mon ours en peluche avait un seul œil.", "Son père tenait le but du terrain vague.", "The aura before a migraine is green."];
  const { texts, find } = await journal(t, { paragraphs: [...countedParagraphs(60), ...told], index });
  assert.equal((await texts("I had a fight with my son about the car"))[0], told[0], "a word that both hold finds the other language's too, after it");
  assert.deepEqual((await texts("son")).sort(), [told[0], told[2]], "a message of that word alone is searched by it");
  assert.deepEqual(await texts("Is that aura back?"), [told[3]]);
  assert.deepEqual((await texts("Je cherche mon ours dans le grenier"))[0], told[1]);
  assert.deepEqual((await texts("Quel est le but de tout cela pour moi ?"))[0], told[2]);
  // In a message of their own language they are what they are there: nothing to search by.
  for (const query of ["Je ne sais pas, car il y aura son frère et ma mère pour elle", "It was neither theirs nor ours but hers, or an attempt"]) {
    const words = searchedBy(await find(query));
    for (const word of ["car", "aura", "son", "ma", "pour", "elle", "ours", "but", "or", "an"]) assert.equal(words.includes(word), false, `${word} in: ${query}`);
  }
  // One other word of a language doesn't say that a message is written in it.
  for (const [query, word] of [["le son", "son"], ["the ours", "ours"]]) assert.ok(searchedBy(await find(query)).includes(word), query);
  // Typed without its accents a French stop word is one; with one it doesn't have, it isn't.
  assert.deepEqual(searchedBy(await find("meme apres etre avant")), []);
  assert.deepEqual(searchedBy(await find("je suis sûr")), ["sûr"]);
});

test("everyday words of both languages that aren't content are left out, and a summer isn't", async (t) => {
  const { find, texts } = await journal(t, { paragraphs: [...countedParagraphs(60), "Un bel été au bord de la mer.", "aujourd hui quelqu un", "not no nor cannot didnt"] });
  // Typed without its apostrophe, such a word is one too, unless that makes another word of it.
  assert.deepEqual(searchedBy(await find("im here, ive had it, youre what theyve got and thats all, whos there, hes off, shes out, itll do, we wouldve")), ["got"]);
  assert.deepEqual(searchedBy(await find("jai vu quil y etait, cest tout, cetait aujourdhui, quelquun et quon")), ["vu"]);
  assert.deepEqual(searchedBy(await find("she was ill in the shed, as well as wed")), ["ill", "shed", "wed", "well"].map(formsReadingTerm).sort());
  for (const query of ["not no nor cannot", "I didnt, we couldnt, it isnt, they dont", "aujourd'hui, quelqu'un", "jusqu'à présent quoiqu'il"]) {
    const words = searchedBy(await find(query));
    for (const word of ["not", "no", "nor", "cannot", "didnt", "couldnt", "isnt", "dont", "aujourd", "hui", "quelqu", "quoiqu", "didn", "couldn"]) assert.equal(words.includes(word), false, `${word} in: ${query}`);
  }
  assert.deepEqual(await texts("Je pense à cet été, au bord de la mer"), ["Un bel été au bord de la mer."]);
  assert.deepEqual(await texts("C'était un été."), ["Un bel été au bord de la mer."], "searched by that word itself");
});

test("an English negation is left out whole, however its apostrophe is written", async (t) => {
  const { find, texts } = await journal(t, { paragraphs: [...countedParagraphs(60), "couldn and wouldn and don are no words.", "I slept in the greenhouse."] });
  for (const query of ["I couldn't and wouldn't, I don't", "I couldn’t and WOULDN’T, I don’t", "couldn't", "she isn't", "I couldn`t, I don´t, they wouldnʼt", "we couldn‘t"]) assert.deepEqual(searchedBy(await find(query)), [], query);
  assert.deepEqual(await texts("I couldn't sleep in the greenhouse"), ["I slept in the greenhouse."]);
  // A name with an apostrophe, and a "t" that isn't a negation's, stay words.
  assert.deepEqual(searchedBy(await find("O'Tooles greenhouse't")), ["greenhou", "tool"]);
});

test("a whole message is searched, so its point counts past its first 4,000 characters", async (t) => {
  const everyday = inventedParagraphs({ size: 400, seed: 5 }).filter((_, place) => place % 3 !== 2).join(" ").slice(0, 30_000);
  assert.ok(everyday.length > 29_000, String(everyday.length));
  const quote = "The weathercock1 squeaked above the cowshed2 and the scythe3 shone.";
  const { texts } = await journal(t, { paragraphs: [...inventedParagraphs(), quote] });
  assert.equal((await texts(`${everyday} And what I came to say is about the weathercock1, the cowshed2 and the scythe3.`))[0], quote);
});

for (const index of ALL) test(`a word over 5% of the quotes hold, and over 20, isn't ranked by; nothing is found without another, whatever the message (${index})`, async (t) => {
  // Two quotes hold the stop words of the messages below, which nothing may be found by.
  const { find } = await journal(t, { paragraphs: countedParagraphs(60, { often1: 21, often2: 20 }, { 50: ["why", "me"], 51: ["et", "moi"] }), index });
  const result = await find("often1 often2");
  assert.deepEqual(counts(result.terms.chosen), [["often2", 20]]);
  assert.deepEqual(counts(result.terms.dropped), [["often1", 21, "common"]]);
  assert.deepEqual([result.kept, result.returned, result.examined], [0, 0, 0], "one word that isn't rare keeps nothing by itself");
  // The search never falls back to the words it leaves out: not to the common ones, not to the stop words, not to anything.
  for (const query of ["often1", "why me", "et moi", "…", "?!", "", "nowhere1 nowhere2"]) {
    const none = await find(query);
    assert.deepEqual([none.quotes, none.kept, none.terms.chosen], [[], 0, []], query);
  }
});

test("a message of everyday words alone, or a bare yes, finds nothing in a journal of a few hundred quotes", async (t) => {
  const paragraphs = inventedParagraphs().map((paragraph, index) => (index % 9 === 0 ? `${paragraph} Yes, I said so.` : paragraph));
  for (const index of ["quote-index-v4", "none"]) {
    const { find } = await journal(t, { paragraphs, index });
    for (const query of ["I feel so tired today and I don't know what I want.", "Je ne sais plus quoi faire, je me sens lourde aujourd'hui.", "yes", "Yes!", "why me"]) {
      assert.equal((await find(query)).kept, 0, `${index}: ${query}`);
    }
    assert.ok((await find("yes")).terms.dropped.every(({ reason }) => reason === "common"), "held by 40 of 360 quotes");
  }
});

test("in a large journal the shares count: 5% of the quotes for a common word, 1% for a rare one", async (t) => {
  const { find } = await journal(t, { paragraphs: countedParagraphs(1200, { big1: 60, big2: 61, few1: 12, few2: 13 }), index: "none" });
  assert.deepEqual(counts((await find("big1 big2")).terms.dropped), [["big2", 61, "common"]]);
  assert.equal((await find("few1")).kept, 12, "1% of 1,200: rare by itself");
  assert.equal((await find("few2")).kept, 0);
});

for (const index of ["quote-index-v4", "none"]) test(`a long message's subject counts beside its incidental words: every word that isn't common is ranked by (${index})`, async (t) => {
  // Forty words one quote each holds, and three that make up the subject, which fifteen quotes hold each and one quote all.
  const incidental = Array.from({ length: 40 }, (_, place) => `incidental${place + 1}`);
  const subject = ["subject1", "subject2", "subject3"];
  const { find, texts } = await journal(t, { paragraphs: countedParagraphs(360, { ...Object.fromEntries(incidental.map((word) => [word, 1])), ...Object.fromEntries(subject.map((word) => [word, 14])) }, { 300: subject }), index });
  const query = `${incidental.join(" and then ")}, and what this was about: ${subject.join(", ")}.`;
  const result = await find(query);
  assert.equal(result.terms.chosen.length, 43);
  assert.deepEqual(counts(result.terms.chosen).slice(-3), [["subject1", 15], ["subject2", 15], ["subject3", 15]], "the rarest first, the others as they stand in the message");
  assert.deepEqual(result.terms.dropped, []);
  assert.match((await texts(query))[0], /own300a .*subject1 subject2 subject3/u, "the quote of the subject before any that shares one incidental word");
  // Wherever the subject stands.
  assert.deepEqual(await texts(`${subject.join(", ")}: ${incidental.join(" and then ")}.`), await texts(query));
});

for (const index of ALL) test(`a quote is kept for a word at most 10 quotes hold, or for two and half of the words ranked by, or three (${index})`, async (t) => {
  const { find, texts } = await journal(t, { index, paragraphs: countedParagraphs(120, { rare1: 10, mid1: 11, mid2: 11, mid3: 11, mid4: 11, mid5: 11, often1: 30 },
    { 100: ["mid1", "mid2", "both1"], 101: ["mid1", "mid2", "mid3"], 102: ["often1", "lone1"], 103: ["often1"] }) });
  assert.equal((await find("rare1", { limit: 40 })).kept, 10, "a rare word by itself");
  assert.equal((await find("mid1", { limit: 40 })).kept, 0, "held by more than 10");
  // Two of two, and two of four: at least half. Two of five isn't; three of five is.
  assert.deepEqual((await texts("mid1 mid2", { limit: 40 })).length, 2);
  assert.deepEqual((await texts("mid1 mid2 mid3 mid4", { limit: 40 })).length, 2);
  assert.deepEqual((await texts("mid1 mid2 mid3 mid4 mid5", { limit: 40 })).map((text) => text.includes("own101a")), [true]);
  // However many words the message has, three are enough: the same quote with three of nine.
  const nine = await journal(t, { index, paragraphs: countedParagraphs(120, Object.fromEntries(Array.from({ length: 9 }, (_, place) => [`part${place + 1}`, 11])), { 100: ["part1", "part2", "part3"], 101: ["part1", "part2"] }) });
  const parts = await nine.texts(Array.from({ length: 9 }, (_, place) => `part${place + 1}`).join(" "), { limit: 40 });
  assert.ok(parts.some((text) => text.includes("own100a")) && !parts.some((text) => text.includes("own101a")));
  // The quote that shares one rare word with a message is kept; one that shares only common words isn't.
  const shared = await texts("often1 and lone1");
  assert.deepEqual(shared.map((text) => text.includes("own102a")), [true]);
});

test("the order is Okapi BM25 over the chosen words, and a quote that holds more of them doesn't go first for it", async (t) => {
  const { find, texts } = await journal(t, { paragraphs: countedParagraphs(120, { weak1: 14, weak2: 14, weak3: 14 }, { 90: ["weak1", "weak2", "weak3"], 91: ["strong1", "strong2"] }) });
  const order = (await texts("weak1 weak2 weak3 strong1 strong2")).map((text) => (text.includes("strong1") ? "two strong words" : "three weak words"));
  assert.deepEqual(order, ["two strong words", "three weak words"]);
  const result = await find("weak1 weak2 weak3 strong1 strong2");
  assert.deepEqual(result.quotes.map(({ matched_terms: matched }) => [...matched].sort()), [["strong1", "strong2"], ["weak1", "weak2", "weak3"]]);
});

test("how often a quote uses a word and how long it is count as BM25 counts them; equal quotes go by id", async (t) => {
  const { texts, passageOf } = await journal(t, { paragraphs: [...countedParagraphs(40), "term1 pad1 pad2 pad3.", "term1 term1 pad1 pad2.", "term1 pad1.",
    "same1 tail1.", "same1 tail2."] });
  assert.deepEqual(await texts("term1"), ["term1 term1 pad1 pad2.", "term1 pad1.", "term1 pad1 pad2 pad3."]);
  const equal = await texts("same1");
  assert.deepEqual(equal, [...equal].sort((left, right) => passageOf(left).localeCompare(passageOf(right))));
});

test("on a journal of a few hundred quotes the order agrees with BM25 worked out from the quotes themselves", async (t) => {
  const paragraphs = inventedParagraphs();
  const { find, passageOf } = await journal(t, { paragraphs });
  const read = paragraphs.map((text) => ({ text, tokens: formsReadingTokens(text) }));
  const mean = read.reduce((sum, { tokens }) => sum + tokens.length, 0) / read.length;
  for (const query of ["the boathouse in the meadow with my goddaughter and the compass", "le métronome et le belvédère sous la grêle, avec des crêpes", "lentils, rhubarb and the kitchen viaduct in thunder"]) {
    const result = await find(query, { limit: 40 });
    const score = ({ tokens }) => result.terms.chosen.reduce((sum, { term }) => {
      const holders = read.filter((quote) => quote.tokens.includes(term)).length;
      const uses = tokens.filter((token) => token === term).length;
      return sum + Math.log(1 + (read.length - holders + 0.5) / (holders + 0.5)) * uses * 2.2 / (uses + 1.2 * (0.25 + 0.75 * tokens.length / mean));
    }, 0);
    const keeps = ({ tokens }) => {
      const held = result.terms.chosen.filter(({ term }) => tokens.includes(term));
      return held.some(({ quotes }) => quotes <= 10) || (held.length >= 2 && held.length * 2 >= result.terms.chosen.length);
    };
    const expected = read.filter(keeps).map((quote) => ({ text: quote.text, score: score(quote) }))
      .sort((left, right) => Math.abs(right.score - left.score) > 1e-9 ? right.score - left.score : passageOf(left.text).localeCompare(passageOf(right.text)));
    assert.ok(expected.length >= 3, query);
    assert.equal(result.kept, expected.length, query);
    assert.deepEqual(result.quotes.map(({ text }) => text), expected.slice(0, 40).map(({ text }) => text), query);
  }
});

test("a word's quotes are counted among the passages alone, whatever their ids, on a generation that also holds what was drawn from them", async (t) => {
  const fixture = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
  const graph = await fixture("synthetic-graph.json"), rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-search-fixture-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = createPrivateJournalCorpusStore({ rootDir, caseId: graph.case_id, corpusId: graph.corpus_id, corpusKey: randomBytes(32) });
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: await fixture("synthetic-sources.json"), permittedUses: ["session_use"] });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id, corpusId: graph.corpus_id,
    generation: graph.generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const result = await reader.findEvidenceQuotes({ query: "asking for help again", limit: 6 });
    assert.deepEqual(counts(result.terms.chosen), [["help", 3]]);
    assert.equal(result.terms.quotes, 7);
    assert.deepEqual([result.quotes.map(({ record_id: id }) => id), result.omitted], [["p1", "p2", "p3"], []]);
  } finally { reader.close(); }
});

// ---- Which of the kept quotes may be used -------------------------------------------------------------------------------------------

const unusable = (texts) => (node) => { for (const [text, change] of texts) if (node.data.quote === text) change(node); };
const revoked = (node) => { node.lifecycle = "revoked"; };

test("a revoked, deleted or restricted match, and one whose words aren't the stored bytes, is counted with its reason and fails nothing", async (t) => {
  const lines = ["harbour1 revoked.", "harbour1 deleted.", "harbour1 restricted.", "harbour1 superseded.", "harbour1 candidate.", "harbour1 active.", "harbour1 altered."];
  const { find, store, open, graph } = await journal(t, { paragraphs: [...countedParagraphs(30), ...lines], change: unusable([
    [lines[0], revoked], [lines[1], (node) => { node.lifecycle = "deleted"; }],
    [lines[2], (node) => { node.data.quote = null; node.data.disclosure = "restricted"; }],
    [lines[3], (node) => { node.lifecycle = "superseded"; }], [lines[4], (node) => { node.lifecycle = "candidate"; }]
  ]) });
  // The altered quote's stored words no longer match its record: the store hands out other bytes for its page.
  const altered = graph.nodes.find((node) => node.kind === "passage" && node.data.quote === lines[6]);
  const tampered = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    return value.representation_id === altered.data.representation_id ? { ...value, text: value.text.replace("harbour1 altered.", "harbour1 ALTERED.") } : value;
  } };
  const result = await find("harbour1", { corpusStore: tampered });
  assert.deepEqual(result.quotes.map(({ text, lifecycle }) => [text, lifecycle]).sort(), [["harbour1 active.", "active"], ["harbour1 candidate.", "candidate"], ["harbour1 superseded.", "superseded"]]);
  assert.deepEqual([...result.omitted].sort((left, right) => left.reason.localeCompare(right.reason)), [
    { reason: "deleted_or_revoked_quotation", count: 2 }, { reason: "restricted_quotation", count: 1 }, { reason: "words_not_verified", count: 1 }
  ]);
  assert.deepEqual([result.kept, result.examined, result.returned], [7, 7, 3]);
  // A record the generation lists that isn't there, or isn't a passage, is one more that can't be used.
  const missing = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    return value.name === "record_lookup" ? { ...value, entries: value.entries.map(([id, locations]) => (id === altered.id ? [id, []] : [id, locations])) } : value;
  } };
  assert.ok((await find("harbour1", { corpusStore: missing })).omitted.some(({ reason }) => reason === "record_unavailable"));
  const otherKind = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    return value.records ? { ...value, records: value.records.map((record) => (record.id === altered.id ? { ...record, kind: "entity" } : record)) } : value;
  } };
  assert.ok((await find("harbour1", { corpusStore: otherKind })).omitted.some(({ reason }) => reason === "not_a_quotation"));
  // What isn't one record's own failure still fails the whole search: another case's record, and a store that can't be read.
  const foreign = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    return value.records ? { ...value, records: value.records.map((record) => (record.id === altered.id ? { ...record, case_id: "another-case" } : record)) } : value;
  } };
  await assert.rejects(find("harbour1", { corpusStore: foreign }), { code: "GRAPH_RECORD_SCOPE_MISMATCH" });
  const broken = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    if (value.records) throw Object.assign(new Error("A synthetic read error."), { code: "EIO" });
    return value;
  } };
  await assert.rejects(find("harbour1", { corpusStore: broken }), { code: "EIO" });
  const reader = await open();
  try { for (const limit of [0, 41, 1.5]) await assert.rejects(reader.findEvidenceQuotes({ query: "harbour1", limit }), { code: "QUOTE_LIMIT_INVALID" }); } finally { reader.close(); }
});

test("at most 40 candidates are looked at, and no more once the quotes asked for are found", async (t) => {
  // Five words, nine quotes each: 45 equal quotes, in the order of their ids, all revoked but the last.
  const words = ["five1", "five2", "five3", "five4", "five5"];
  const paragraphs = countedParagraphs(60, Object.fromEntries(words.map((word) => [word, 9])));
  const holders = paragraphs.filter((text) => words.some((word) => text.includes(word)));
  assert.equal(holders.length, 45);
  let last = null;
  const { passageOf } = await journal(t, { paragraphs });
  last = [...holders].sort((left, right) => passageOf(left).localeCompare(passageOf(right))).at(-1);
  const revokedButLast = await journal(t, { paragraphs, change: (node) => { if (holders.includes(node.data.quote) && node.data.quote !== last) revoked(node); } });
  const result = await revokedButLast.find(words.join(" "));
  assert.deepEqual([result.kept, result.examined, result.returned], [45, 40, 0]);
  assert.deepEqual(result.omitted, [{ reason: "deleted_or_revoked_quotation", count: 40 }]);
  const open = await journal(t, { paragraphs });
  const found = await open.find(words.join(" "), { limit: 3 });
  assert.deepEqual([found.kept, found.examined, found.returned], [45, 3, 3]);
});

test("quotes the caller has already are gone past, and stay counted", async (t) => {
  const { open, find } = await journal(t, { paragraphs: countedParagraphs(60, { lantern1: 9 }) });
  const all = await find("lantern1", { limit: 9 });
  assert.deepEqual([all.kept, all.excluded, all.examined, all.returned], [9, 0, 9, 9]);
  const ids = all.quotes.map(({ record_id: id }) => id);
  const reader = await open();
  try {
    const rest = await reader.findEvidenceQuotes({ query: "lantern1", limit: 3, exclude: [...ids.slice(0, 4), "passage:of-another-search"] });
    assert.deepEqual([rest.quotes.map(({ record_id: id }) => id), rest.kept, rest.excluded, rest.examined, rest.returned], [ids.slice(4, 7), 9, 4, 3, 3]);
    for (const exclude of ["passage", [1], null]) await assert.rejects(reader.findEvidenceQuotes({ query: "lantern1", limit: 3, exclude }), { code: "EVIDENCE_IDS_INVALID" });
  } finally { reader.close(); }
});

// ---- What a quote comes back with, the cache, the snapshot ---------------------------------------------------------------------------

test("each quote comes back with its record, span, lifecycle, the date it was written under, its cues and the words it matched", async (t) => {
  const quote = "I dreamt the lighthouse1 was empty. Maybe it was only a dream.", later = "The lighthouse1 again, a week on.", undated = "lighthouse1 with no date at all.";
  const paragraphs = [undated, quote, "Some other1 day.", later];
  const dates = new Map([[1, "March 3, 2019"], [3, "Sunday"]]);
  for (const index of ["quote-index-v4", "quote-index-v2", "none"]) {
    const { find, passageOf, graph } = await journal(t, { paragraphs, dates, index });
    const result = await find("lighthouse1 dreams");
    const found = result.quotes.find(({ text }) => text === quote);
    const passage = graph.nodes.find((node) => node.id === passageOf(quote));
    assert.deepEqual([found.record_id, found.start_byte, found.end_byte, found.lifecycle], [passage.id, passage.data.start_byte, passage.data.end_byte, "active"]);
    assert.deepEqual(found.cues, quoteCues(quote));
    assert.deepEqual(found.matched_terms, index === "quote-index-v4" ? ["dream", "lighthouse1"] : ["lighthouse1"]);
    assert.deepEqual(found.written, index === "none" ? null : { from: "2019-03-03", to: "2019-03-03", precision: "day", between: false, ambiguous: false, year_inferred: false });
    assert.equal(JSON.stringify(result).includes("March 3, 2019"), false, "not the date line's words");
    const first = result.quotes.find(({ text }) => text === undated);
    // Before the first date, a version 4 index knows only that it was written by then: an open range.
    assert.deepEqual(first.written, index === "quote-index-v4" ? { from: null, to: "2019-03-03", precision: "interval", between: true, ambiguous: false, year_inferred: false } : null);
  }
});

test("a cached search gives the same result from fewer reads, holds ids and counts alone, and checks every record again", async (t) => {
  const paragraphs = inventedParagraphs();
  const { find, store, generation, persisted } = await journal(t, { paragraphs });
  const cache = createJournalResultCache(), keys = [], values = [];
  const resultCache = { get: (key) => cache.get(key), set(key, value) { keys.push(key); values.push(value); cache.set(key, value); } };
  let reads = 0;
  const counted = { ...store, async readJsonObject(input) { reads += 1; return store.readJsonObject(input); } };
  const query = "The boathouse, the meadow and my goddaughter's compass.";
  const first = await find(query, { resultCache, corpusStore: counted }), firstReads = reads;
  const second = await find(query, { resultCache, corpusStore: counted });
  assert.ok(first.returned >= 1);
  assert.deepEqual(second, first);
  assert.ok(reads - firstReads < firstReads, "the word list isn't read again");
  assert.equal(values.length, 1);
  const words = first.terms.chosen.length + first.terms.dropped.length;
  assert.deepEqual(values[0].slice(0, 2 + words).map(Number).every(Number.isSafeInteger), true);
  assert.ok(values[0].slice(2 + words).every((id) => /^passage:[a-f0-9]{32}$/u.test(id)) && values[0].length === 2 + words + first.kept);
  assert.ok(first.shared >= first.kept && Number(values[0][1]) === first.shared);
  // The key names the case, the corpus, the purpose, the publication and what was asked by a digest, the method with its numbers included.
  assert.deepEqual(JSON.parse(keys[0]).slice(0, 8), [CASE, CORPUS, "session_use", generation, 0, persisted.manifest_object_id, "evidence-quotes", EVIDENCE_QUOTE_SEARCH.version]);
  assert.match(JSON.parse(keys[0])[8], /^[a-f0-9]{64}$/u);
  assert.equal(JSON.parse(keys[0]).length, 9);
  // The order is the same for any number of quotes asked for, and a record that may no longer be used isn't returned from the cache.
  assert.deepEqual((await find(query, { resultCache, limit: 1 })).quotes, first.quotes.slice(0, 1));
  const gone = { ...store, async readJsonObject(input) {
    const value = await store.readJsonObject(input);
    return value.records ? { ...value, records: value.records.map((record) => (record.id === first.quotes[0].record_id ? { ...record, lifecycle: "revoked" } : record)) } : value;
  } };
  const after = await find(query, { resultCache, corpusStore: gone });
  assert.equal(after.quotes.some(({ record_id: id }) => id === first.quotes[0].record_id), false);
  // Another publication's order is never taken for this one's.
  assert.equal((await find("métronome", { resultCache })).quotes.every(({ text }) => text.includes("métronome")), true);
  assert.equal(new Set(keys).size, 2);
});

test("a snapshot that isn't current is refused before the search and after it", async (t) => {
  const { open } = await journal(t, { paragraphs: ["lantern1 in the window.", ...countedParagraphs(5)] });
  for (const currentFor of [0, 1]) {
    let asked = 0;
    const reader = await open({ assertSnapshotCurrent: async () => (asked++) < currentFor });
    try { await assert.rejects(reader.findEvidenceQuotes({ query: "lantern1", limit: 6 }), { code: "CURSOR_STALE" }); } finally { reader.close(); }
    assert.equal(asked, currentFor + 1);
  }
  const reader = await open();
  try { for (const query of [null, 7, "x".repeat(40_001)]) await assert.rejects(reader.findEvidenceQuotes({ query, limit: 6 }), { code: "QUOTE_QUERY_INVALID" }); } finally { reader.close(); }
});
