import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderError } from "../src/core/errors.mjs";
import { QUOTE_UNIT_DEFAULTS } from "../src/journal-import/quote-index.mjs";
import { evidenceWordsShared } from "../src/journal-import/retrieval.mjs";
import { createPrivateCaseAccessService, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { QUESTIONS_HELD_BACK_FILE, addQuestionsHeldBack, clientJournalFolder, readQuestionsHeldBack } from "../src/runner-trial/clients.mjs";
import { PLANTED_KINDS } from "../src/runner-trial/cold-test-rule.mjs";
import { COLD_QUESTIONS_TOOL, INVENTED_JOURNAL_SENTINEL, QUESTION_SUBJECTS, QUESTION_VERBS, answerableForFile, eligibleSubjects, journalLanguage, openingPassageId,
  passageDigest, seededRandom, writeColdQuestions } from "../src/runner-trial/cold-questions.mjs";
import { createGptQuestionsWriter, runColdTestJob } from "../src/runner-trial/cold-test-job.mjs";
import { resolveColdKey, validateColdQuestionsFile } from "../src/runner-trial/journal-cold-test.mjs";
import { openSessionUseReader } from "../src/runner-trial/journal-gate.mjs";
import { PLANTED, questionWriter, riddleWord } from "./helpers/cold-workers.mjs";
import { LENT_THINGS, dyingEntry, inventedPages, lentEntry, persistInventedJournal } from "./helpers/invented-journal.mjs";

// The tool that writes a copy's cold-test questions (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, section 3;
// the owner's answers i77 3a and i81 5b): what it samples, what each call of GPT's worker gets, what the program checks and drops, when it
// has enough, what it spends, and what it holds back. Every journal is invented and every worker a stand-in (tests/helpers/cold-workers.mjs):
// no model is called. The command that runs the tool and then the test has its tests in tests/runner-journal-copy.test.mjs.

const LONG = Object.freeze(Array.from({ length: 100 }, (_, place) => lentEntry(place, { long: true })));
const normal = (text) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
const journalOf = (texts) => texts.map((quote, index) => Object.freeze({ id: `passage:${String(index).padStart(4, "0")}`, quote, order: index, written: null }));
// One run of the tool on an invented journal held in memory, as readQuestionPassages gives one, its key passages the same; the replies'
// reader stands in as one that finds two passages for any question.
function write(texts, writer, { wordList = true, askReader = async () => 2, seed = 1, ...options } = {}) {
  const passages = journalOf(texts);
  return writeColdQuestions({ passages, keyPassages: passages, wordList, worker: writer, askReader, random: seededRandom(seed), ...options });
}
// A run that may stop: what it gave, or its code and its report.
const outcomeOf = (running) => running.then((result) => ({ code: null, ...result }), (error) => {
  if (!error?.details?.report) throw error;
  return { code: error.code, report: error.details.report };
});
// The passages a stand-in's packets held, from the call numbered `from` (0 for all): those of the writing and unanswerable batches, and
// those of the key checks.
const wordsIn = (packet) => [...(packet.passages ?? []).map(({ words }) => words), ...(packet.items ?? []).map(({ passage }) => passage.words)];
const passagesSent = (writer, from = 0) => new Set(writer.sent.slice(from).flatMap(({ packet }) => wordsIn(packet)));
const countsOf = (questions) => ({ answerable: questions.questions.filter(({ answerable }) => answerable).length,
  unanswerable: questions.questions.filter(({ answerable }) => !answerable).length, planted: questions.questions.filter(({ planted }) => planted).length });
const WEEKDAYS = Object.freeze(["Sunday.", "Monday.", "Tuesday.", "Wednesday.", "Thursday.", "Friday.", "Saturday."]);
const DATE_LINE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.$/u;
const NO_DROPS = Object.freeze({ question_invalid: 0, quote_not_in_passage: 0, quote_length: 0, quote_not_specific: 0, passage_used_twice: 0, other_passage_words: 0, repeated: 0,
  verb_not_on_list: 0, phrase_invalid: 0, phrase_not_from_batch: 0, reader_found_nothing: 0, key_doubted: 0, in_dropped_key_checks: 0,
  passage_held_back: 0, held_back_words: 0, plant_held_back_words: 0, plant_not_written: 0, plant_invalid: 0, plant_doubted: 0 });
const SKIP = Object.freeze({ skip: true, question: "", evidence_quote: "", wording: "none", planted_kind: "none", planted_answer: "" });
const taskOf = (request) => JSON.parse(request.user).task;

// ---- What it samples and sends ---------------------------------------------------------------------------------------------------

test("a run's questions: sixty passages to write about, fifteen of each quarter, in packets of fifteen under opaque names, and a file the cold test takes, its report numbers only", async () => {
  const texts = [INVENTED_JOURNAL_SENTINEL, ...LONG];
  const writer = questionWriter();
  const { questions, report } = await write(texts, writer, { exclude: new Set(["passage:0000"]) });
  // GPT's file, valid, its key found in the copy, with what the tool aims at: 48 questions in their passages' words, 12 in other words,
  // 26 the journal doesn't answer and 28 planted wrong answers, at least five of each kind.
  assert.equal(validateColdQuestionsFile(questions), questions);
  assert.deepEqual([questions.schema_version, questions.kind, questions.author], [1, "journal_cold_questions", "openai"]);
  assert.deepEqual(questions.questions.map(({ id }) => id), questions.questions.map((_, index) => `gpt-${index + 1}`));
  assert.equal(resolveColdKey(questions, journalOf(texts)).length, 86);
  const answerable = questions.questions.filter((entry) => entry.answerable);
  const sharing = answerable.filter((entry) => evidenceWordsShared(entry.question, entry.evidence_quotes[0], { wordList: true }).length > 0);
  assert.deepEqual([sharing.length, answerable.length - sharing.length, countsOf(questions).unanswerable, countsOf(questions).planted], [48, 12, 26, 28]);
  const byKind = Object.fromEntries(PLANTED_KINDS.map((kind) => [kind, questions.questions.filter((entry) => entry.planted?.kind === kind).length]));
  for (const kind of PLANTED_KINDS) assert.ok(byKind[kind] >= 5, kind);
  // Sixty passages to write about, each once, fifteen of each quarter of the copy's source order, in four packets of fifteen: under
  // opaque names, with their words and dates, how to word each question, and the planted answers asked for, seven a packet.
  const quarterOf = (words) => Math.min(3, Math.floor((LONG.indexOf(words) * 4) / LONG.length));
  const writing = writer.packets("answerable");
  const asked = writing.flatMap((packet) => packet.passages.map(({ words }) => words));
  assert.deepEqual([writing.length, asked.length, new Set(asked).size], [4, 60, 60]);
  assert.deepEqual([0, 1, 2, 3].map((quarter) => asked.filter((words) => quarterOf(words) === quarter).length), [15, 15, 15, 15]);
  for (const packet of writing) {
    assert.deepEqual([Object.keys(packet), packet.task, packet.language], [["task", "language", "passages"], "answerable", "en"]);
    assert.deepEqual(packet.passages.map(({ name }) => name), Array.from({ length: 15 }, (_, index) => `p${index + 1}`));
    for (const passage of packet.passages) {
      assert.deepEqual(Object.keys(passage), ["name", "words", "written", "wording", "plant"]);
      assert.ok(LONG.includes(passage.words));
    }
    assert.deepEqual([packet.passages.filter(({ wording }) => wording === "other").length, packet.passages.filter(({ plant }) => plant !== null).length], [3, 7]);
  }
  const plants = writing.flatMap((packet) => packet.passages.map(({ plant }) => plant).filter(Boolean));
  for (const kind of PLANTED_KINDS) assert.ok(plants.filter((plant) => plant === kind).length >= 5, kind);
  // Thirty passages as context for fifteen subjects each, in two packets, with the verbs to choose from; then four checks of fifteen keys.
  const context = writer.packets("unanswerable");
  assert.equal(context.length, 2);
  for (const packet of context) {
    assert.deepEqual(Object.keys(packet), ["task", "language", "verbs", "subjects", "passages"]);
    assert.deepEqual([packet.verbs, packet.subjects.length, packet.passages.length], [[...QUESTION_VERBS.en], 15, 15]);
    assert.ok(packet.subjects.every(({ name, words }, index) => name === `s${index + 1}` && QUESTION_SUBJECTS.some((entry) => entry.en === words)));
    assert.ok(packet.passages.every(({ name, words }, index) => name === `p${index + 1}` && LONG.includes(words)));
  }
  assert.deepEqual(writer.packets("check_keys").map(({ items }) => items.length), [15, 15, 15, 15]);
  // The sentinel's passage goes to none of the tool's calls.
  assert.equal([...passagesSent(writer)].some((words) => words.includes(INVENTED_JOURNAL_SENTINEL)), false);
  // The report: numbers, the tool's version and the questions' language.
  assert.equal(writer.sent.length, 10);
  assert.deepEqual(report, { version: COLD_QUESTIONS_TOOL.version, language: "en",
    passages: { usable: 101, excluded: 1, held_back: 0, population: 100, sent: passagesSent(writer).size, skipped: 0, replaced: 0, in_dropped_batches: 0,
      held_back_in_run: 0 },
    calls: { made: 10, asked_again: 0 }, subjects: { eligible: QUESTION_SUBJECTS.length, used: 30 },
    batches: { answerable: 4, unanswerable: 2, key_checks: 4, dropped_for_form: 0, refused: 0 }, dropped: NO_DROPS,
    kept: { same_words: 48, other_words: 12, unanswerable: 26, planted: 28, planted_by_kind: byKind } });
  for (const words of [...LENT_THINGS.filter((thing) => thing.length > 5), "Riddle", PLANTED, "zq"]) assert.equal(JSON.stringify(report).includes(words), false, words);
});

test("passages about dying are sampled, sent and given planted answers as any other passage (i81 5b): no list leaves them out", async () => {
  // Thirty passages, six of them about dying: every passage is written about twice, so all six are sent, and planted answers are asked
  // for on them as on any other.
  const dying = Array.from({ length: 6 }, (_, place) => dyingEntry(place, 60 + place));
  const texts = Array.from({ length: 30 }, (_, place) => (place % 5 === 3 ? dying[(place - 3) / 5] : lentEntry(place)));
  for (const seed of [1, 2, 3]) {
    const writer = questionWriter();
    const { questions } = await write(texts, writer, { seed });
    const asked = writer.packets("answerable").flatMap((packet) => packet.passages);
    for (const entry of dying) assert.equal(asked.filter(({ words }) => words === entry).length, 2, `${seed}: ${entry}`);
    assert.ok(asked.some(({ words, plant }) => dying.includes(words) && plant !== null), `${seed}: planted answers asked for on them`);
    assert.ok(questions.questions.some((entry) => entry.planted && dying.some((words) => words.includes(entry.evidence_quotes[0]))), `${seed}: and kept`);
  }
  // A copy that tells of nothing else gets its whole file all the same.
  const { questions, report } = await write(Array.from({ length: 40 }, (_, place) => dyingEntry(place)), questionWriter());
  assert.deepEqual([report.passages.population, report.passages.sent, countsOf(questions)], [40, 40, { answerable: 60, unanswerable: 26, planted: 28 }]);
});

test("a passage of fewer than four words may be its question's evidence whole; one with nothing to ask about is skipped, counted and replaced from its quarter", async () => {
  // Thirty passages, each written about twice: five short ones, with something to ask, and two date lines alone. The stand-in quotes "Rain"
  // alone from "Rain again.", which is no evidence.
  const SHORT = ["Rain again.", "Lent the anvil.", "Kiln cold.", "Bought quills.", "Lost the monocle."];
  const texts = Array.from({ length: 30 }, (_, place) => (place % 6 === 1 ? SHORT[(place - 1) / 6] : place === 4 ? "Sunday." : place === 22 ? "Monday." : lentEntry(place)));
  const writer = questionWriter({ skip: (words) => DATE_LINE.test(words), reply: async (count, request, usual) => {
    const value = await usual();
    if (taskOf(request) === "answerable") for (const item of value.items) if (item.evidence_quote === "Rain again.") item.evidence_quote = "Rain";
    return value;
  } });
  const { report } = await outcomeOf(write(texts, writer));
  const checked = writer.packets("check_keys").flatMap(({ items }) => items);
  for (const words of SHORT.slice(1)) assert.equal(checked.filter(({ evidence_quote: quote }) => quote === words).length, 2, words);
  assert.equal(checked.some(({ passage }) => passage.words === "Rain again." || DATE_LINE.test(passage.words)), false);
  assert.deepEqual([report.passages.skipped, report.passages.replaced, report.dropped.quote_length], [4, 0, 2], "none left to replace them with");

  // Eighty passages, seven of them date lines: each skipped one is replaced by a passage of its own quarter that wasn't sent before, in one
  // more call; one that is a date line too is skipped and counted, and not replaced again.
  const many = Array.from({ length: 80 }, (_, place) => (place % 10 === 9 && place < 70 ? WEEKDAYS[(place - 9) / 10] : lentEntry(place)));
  const replacing = questionWriter({ skip: (words) => DATE_LINE.test(words) });
  const replaced = await outcomeOf(write(many, replacing, { seed: 5 }));
  const writing = replacing.packets("answerable");
  const firstFour = writing.slice(0, 4).flatMap(({ passages }) => passages.map(({ words }) => words));
  const skipped = firstFour.filter((words) => DATE_LINE.test(words));
  assert.ok(skipped.length > 0);
  const replacements = writing[4].passages.map(({ words }) => words);
  const quarterOf = (words) => Math.min(3, Math.floor((many.indexOf(words) * 4) / many.length));
  assert.deepEqual(replacements.map(quarterOf), skipped.map(quarterOf));
  assert.equal(replacements.some((words) => firstFour.includes(words)), false);
  assert.deepEqual([replaced.report.passages.replaced, replaced.report.passages.skipped], [replacements.length, [...firstFour, ...replacements].filter((words) => DATE_LINE.test(words)).length]);
});

test("a journal in French gets its questions in French: the verbs, the subjects' names and the shapes", async () => {
  const french = Array.from({ length: 60 }, (_, place) => `Ce printemps-là, j'ai prêté le ${LENT_THINGS[place]} à ma voisine, et il m'est revenu une semaine plus tard.`);
  assert.deepEqual([journalLanguage(french), journalLanguage(LONG)], ["fr", "en"]);
  // Phrases with an apostrophe, letters with accents, a hyphen inside a word, decimal digits, and a tab, read as one space: words, which
  // pass.
  let unanswerable = 0;
  const phrases = [];
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const value = await usual();
    if (taskOf(request) === "unanswerable" && (unanswerable += 1) === 1) {
      const word = (item) => item.phrase.split(" ").at(-1);
      value.items[0].phrase = `après l'été du ${word(value.items[0])}`;
      value.items[1].phrase = `avec le ${word(value.items[1])} d'à côté`;
      value.items[2].phrase = `près du ${word(value.items[2])} de l’après-midi`;
      value.items[3].phrase = `avant le ${word(value.items[3])} du 14 juillet`;
      value.items[4].phrase = `avant\tla fin du ${word(value.items[4])}`;
      phrases.push(...value.items.slice(0, 5).map(({ phrase }) => phrase.replace(/\s+/gu, " ")));
    }
    return value;
  } });
  const { questions, report } = await write(french, writer);
  assert.equal(report.language, "fr");
  for (const packet of writer.packets("unanswerable")) {
    assert.deepEqual(packet.verbs, [...QUESTION_VERBS.fr]);
    assert.ok(packet.subjects.every(({ words }) => QUESTION_SUBJECTS.some((entry) => entry.fr === words)));
  }
  assert.equal(report.dropped.phrase_invalid, 0);
  const unanswered = questions.questions.filter(({ answerable }) => !answerable).map(({ question }) => question);
  for (const phrase of phrases) assert.ok(unanswered.some((question) => question.endsWith(` ${phrase} ?`)), phrase);
  for (const question of unanswered.filter((entry) => !phrases.some((phrase) => entry.includes(phrase)))) assert.match(question, /^(Quand ai-je|Ai-je déjà) visité .+ après le \p{L}+ \?$/u);
});

// ---- What the program checks -----------------------------------------------------------------------------------------------------

test("each of the program's checks drops a candidate that fails it, and counts it: nothing is mended by guessing", async () => {
  let writing = 0, unanswerable = 0;
  const corrupted = { questions: [], plants: [] };
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user);
    const value = await usual();
    if (packet.task === "answerable" && (writing += 1) === 1) {
      // A question empty or too long; an evidence quote not in its passage, of three words or of forty-one, or in every passage; a
      // question asked before, in other letters and spacing; one that carries nine words of the next passage of its batch, which its key
      // check, on its own passage alone, would send.
      const [empty, long, nowhere, short, overlong, everywhere, kept, again, carry] = value.items;
      const words = (item) => normal(packet.passages[value.items.indexOf(item)].words).split(" ");
      empty.question = "";
      long.question = `${long.question} ${"and so on ".repeat(40)}`.trim();
      nowhere.evidence_quote = "Words that are in no passage of this journal at all.";
      short.evidence_quote = words(short).slice(0, 3).join(" ");
      overlong.evidence_quote = words(overlong).slice(0, 41).join(" ");
      everywhere.evidence_quote = "and it came back after a week";
      again.question = kept.question.toUpperCase().replaceAll(" ", "  ");
      carry.question = `What happened when ${normal(packet.passages[9].words).split(" ").slice(0, 9).join(" ")}?`;
      corrupted.questions.push(...[long, nowhere, short, overlong, everywhere, again, carry].map(({ question }) => question));
    } else if (packet.task === "answerable" && writing === 2) {
      // A planted answer of another kind than asked, empty, over 300 characters, holding its evidence quote, or carrying nine words of
      // another passage of its batch.
      const [otherKind, empty, long, copy, carryPlant] = value.items.filter((item) => item.planted_kind !== "none");
      otherKind.planted_kind = PLANTED_KINDS.find((kind) => kind !== otherKind.planted_kind);
      empty.planted_answer = "";
      long.planted_answer = `${PLANTED} ${"x".repeat(300)}`;
      copy.planted_answer = `${PLANTED}: ${copy.evidence_quote}`;
      const sibling = packet.passages[(value.items.indexOf(carryPlant) + 1) % packet.passages.length].words;
      carryPlant.planted_answer = `${PLANTED}: ${normal(sibling).split(" ").slice(0, 9).join(" ")}`;
      corrupted.plants.push(...[otherKind, long, copy, carryPlant].map(({ planted_answer: answer }) => answer));
    } else if (packet.task === "unanswerable" && (unanswerable += 1) === 1) {
      // Verbs of saying; phrases with a question word, a joining word, a comma, a question mark, a full stop that starts a second
      // question, more than eight words, a word of no passage of the batch; and one for which the replies' reader finds nothing. Then
      // (the second batch) phrases with other characters than words: a third batch makes up the questions they cost.
      const items = value.items, word = (item) => item.phrase.split(" ").at(-1);
      [items[0].verb, items[1].verb, items[2].verb] = ["mention", "write about", "name"];
      items[3].phrase = `why after the ${word(items[3])}`;
      items[4].phrase = `after the ${word(items[4])} or the bus`;
      items[5].phrase = `rather than the ${word(items[5])}`;
      items[6].phrase = `instead of the ${word(items[6])}`;
      items[7].phrase = `besides the ${word(items[7])}`;
      items[8].phrase = `after the ${word(items[8])}, again`;
      items[9].phrase = `after the ${word(items[9])}?`;
      items[10].phrase = `after the ${word(items[10])} with my old friend from the north side`;
      items[11].phrase = "after the zeppelin";
      items[12].phrase = `near the ${word(items[12])}`;
      items[13].phrase = `after the ${word(items[13])} and the bus`;
      items[14].phrase = `after the ${word(items[14])}. Did I lend it`;
    } else if (packet.task === "unanswerable" && unanswerable === 2) {
      // Phrases of words with a character outside the allowlist, none of them sentence punctuation but a colon, each of which could start
      // or join a second question: a dash, a colon, brackets, quotation marks, a slash, an ampersand, a hyphen between words, a symbol;
      // and a number that isn't a decimal digit.
      const items = value.items, word = (item) => item.phrase.split(" ").at(-1);
      items[0].phrase = `after the ${word(items[0])} — did I lend it`;
      items[1].phrase = `after the ${word(items[1])}: did I lend it`;
      items[2].phrase = `(after the ${word(items[2])})`;
      items[3].phrase = `after the [${word(items[3])}]`;
      items[4].phrase = `after the "${word(items[4])}"`;
      items[5].phrase = `after the ${word(items[5])}/bus`;
      items[6].phrase = `after the ${word(items[6])} & bus`;
      items[7].phrase = `after the ${word(items[7])} - did I lend it`;
      items[8].phrase = `after the ${word(items[8])} ★`;
      items[9].phrase = `after the ${word(items[9])} ½`;
    }
    return value;
  } });
  const { questions, report } = await write(LONG, writer, { askReader: async (question) => (question.includes(" near the ") ? 0 : 2) });
  assert.deepEqual(report.dropped, { ...NO_DROPS, question_invalid: 2, quote_not_in_passage: 1, quote_length: 2, quote_not_specific: 1, repeated: 1,
    other_passage_words: 1, verb_not_on_list: 3, phrase_invalid: 20, phrase_not_from_batch: 1, reader_found_nothing: 1, plant_not_written: 1, plant_invalid: 4 });
  assert.deepEqual([report.batches.unanswerable, report.kept.unanswerable], [3, 20], "a third batch made up for the second's");
  // No key check carried a dropped question or planted answer: each holds its own passage and nothing of another's.
  const checkedText = JSON.stringify(writer.packets("check_keys"));
  for (const words of [...corrupted.questions, ...corrupted.plants]) assert.equal(checkedText.includes(JSON.stringify(words).slice(1, -1)), false, words);
  const asked = questions.questions.map(({ question }) => question);
  for (const question of corrupted.questions) assert.equal(asked.includes(question), false, question);
  const plantedAnswers = questions.questions.map(({ planted }) => planted?.answer).filter(Boolean);
  for (const answer of corrupted.plants) assert.equal(plantedAnswers.includes(answer), false, answer);
  // The questions the journal doesn't answer are the program's shapes, with a verb of its list and a phrase that passed.
  for (const { question } of questions.questions.filter(({ answerable }) => !answerable)) {
    const [, verb] = /^(?:When did I|Did I ever) (\S+) .+ after the \p{L}+\?$/u.exec(question) ?? [];
    assert.ok(QUESTION_VERBS.en.includes(verb), question);
    for (const words of ["zeppelin", " near ", "why", " or ", "rather", "instead", "besides", ",", "north", " and ", ". ", "lend it", "—", ":", "(", "[", "\"", "/", "&", " - ",
      "★", "½"]) assert.equal(question.includes(words), false, `${words} in ${question}`);
  }
});

test("an evidence quote in more than three passages is dropped, and so is a question whose evidence is a passage already the evidence of two", async () => {
  // Thirty passages, each written about twice: four share a sentence, three another, which the stand-in quotes as their evidence.
  const SHARED = "The kiln stayed cold all week.", TRIPLED = "Snow fell on the market roofs.";
  const texts = Array.from({ length: 30 }, (_, place) => (place < 4 ? `${SHARED} I lent the ${LENT_THINGS[place]} to my cousin.`
    : place < 7 ? `${TRIPLED} I lent the ${LENT_THINGS[place]} to my aunt.` : lentEntry(place)));
  let tag = 0;
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user), value = await usual();
    if (packet.task !== "answerable") return value;
    value.items.forEach((item, index) => {
      for (const quote of [SHARED, TRIPLED]) {
        if (packet.passages[index].words.startsWith(quote)) Object.assign(item, { evidence_quote: quote, question: `${riddleWord(tag += 1)}: what happened when ${quote.toLowerCase().slice(0, -1)}?` });
      }
    });
    return value;
  } });
  const { report } = await outcomeOf(write(texts, writer));
  assert.deepEqual([report.dropped.quote_not_specific, report.dropped.passage_used_twice], [8, 4]);
  const checked = writer.packets("check_keys").flatMap(({ items }) => items);
  assert.deepEqual([SHARED, TRIPLED].map((quote) => checked.filter(({ evidence_quote: evidence }) => evidence === quote).length), [0, 2]);
});

test("while there are passages enough for the sixty places, a passage is the evidence of one question only: two that share a quoted sentence give one question, not two", async () => {
  // Sixty passages, each written about once; the first two share a sentence, which the stand-in quotes as the evidence of both.
  const SHARED = "The kiln stayed cold all week.";
  const texts = Array.from({ length: 60 }, (_, place) => (place < 2 ? `${SHARED} I lent the ${LENT_THINGS[place]} to my cousin.` : lentEntry(place)));
  let tag = 0;
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user), value = await usual();
    if (packet.task !== "answerable") return value;
    value.items.forEach((item, index) => {
      if (packet.passages[index].words.startsWith(SHARED)) Object.assign(item, { evidence_quote: SHARED, question: `${riddleWord(tag += 1)}: what happened when the kiln stayed cold all week?` });
    });
    return value;
  } });
  const { report } = await outcomeOf(write(texts, writer));
  assert.deepEqual([report.passages.population, report.dropped.passage_used_twice], [60, 1]);
  const checked = writer.packets("check_keys").flatMap(({ items }) => items);
  assert.equal(checked.filter(({ evidence_quote: evidence }) => evidence === SHARED).length, 1);
});

test("GPT checks each answerable key on its evidence passage alone: a key it doubts goes, a planted answer it doesn't find contradicted goes, and the check sends no other passage", async () => {
  let checks = 0;
  const doubted = [], undone = [];
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user), value = await usual();
    if (packet.task === "check_keys" && (checks += 1) === 1) {
      value.items.slice(0, 3).forEach((item, index) => { item.answers = false; doubted.push(packet.items[index].question); });
      value.items.filter((item, index) => index >= 3 && packet.items[index].planted).slice(0, 2).forEach((item) => {
        item.planted = "not_contradicted";
        undone.push(packet.items.find(({ id }) => id === item.id).planted.answer);
      });
    }
    return value;
  } });
  const { questions, report } = await write(LONG, writer);
  assert.deepEqual([report.dropped.key_doubted, report.dropped.plant_doubted, doubted.length, undone.length], [3, 2, 3, 2]);
  const asked = questions.questions.map(({ question }) => question);
  for (const question of doubted) assert.equal(asked.includes(question), false, question);
  for (const answer of undone) assert.equal(questions.questions.some(({ planted }) => planted?.answer === answer), false, answer);
  // Each item: its question, its key and its own passage as the writing packet gave it, never what a search returns, and nothing else.
  const written = writer.packets("answerable").flatMap(({ passages }) => passages);
  for (const packet of writer.packets("check_keys")) {
    assert.deepEqual(Object.keys(packet), ["task", "items"]);
    packet.items.forEach((item, index) => {
      assert.deepEqual([Object.keys(item), item.id], [["id", "question", "evidence_quote", "passage", "planted"], `q${index + 1}`]);
      const from = written.filter(({ words }) => normal(words).includes(normal(item.evidence_quote)));
      assert.equal(from.length, 1);
      assert.deepEqual(item.passage, { words: from[0].words, written: from[0].written });
    });
  }
  assert.equal(report.passages.sent, new Set([...written.map(({ words }) => words), ...writer.packets("unanswerable").flatMap(({ passages }) => passages.map(({ words }) => words))]).size,
    "a key check sends only passages already sent");
});

test("an unanswerable question asks about a subject of the program's list that no passage names, in any of its names, read as the replies' search reads words", async () => {
  const naming = ["We walked out to the phare at low tide.", "My brother kept his kayak under the stairs.", "Two dromedaries stood behind the fence at the fair."];
  const texts = [...naming, ...LONG.slice(0, 60)];
  const named = ["lighthouse", "canoe", "camel"].map((id) => QUESTION_SUBJECTS.find((entry) => entry.id === id));
  // Its French name or another word for it names it, and so does another form of a name, as the search reads it with a word list: on a
  // copy without one too, so that a subject the journal names is never keyed as one it doesn't answer.
  const plurals = ["We counted the lighthouses along the coast.", "The camels slept by the well.", "Two kayaks lay upside down on the beach."];
  for (const wordList of [true, false]) {
    assert.deepEqual(eligibleSubjects(texts, { wordList }).filter((entry) => named.includes(entry)), [], `${wordList}`);
    assert.deepEqual(eligibleSubjects([...plurals, ...LONG.slice(0, 60)], { wordList }).filter((entry) => named.includes(entry)), [], `plurals, ${wordList}`);
  }
  assert.equal(eligibleSubjects(LONG.slice(0, 60), { wordList: false }).filter((entry) => named.includes(entry)).length, 3, "named nowhere, eligible");
  for (const seed of [1, 2, 3]) {
    const writer = questionWriter();
    await write(texts, writer, { seed });
    const subjects = writer.packets("unanswerable").flatMap((packet) => packet.subjects.map(({ words }) => words));
    assert.equal(subjects.length, 30);
    assert.equal(subjects.some((words) => named.some((entry) => entry.en === words)), false, `${seed}`);
  }
  // With fewer than twenty such subjects, no call is made.
  const many = QUESTION_SUBJECTS.slice(0, QUESTION_SUBJECTS.length - COLD_QUESTIONS_TOOL.needs.unanswerable + 1).map((entry) => `I saw the ${entry.names[0]} that day.`);
  const idle = questionWriter();
  const stop = await outcomeOf(write([...many, ...LONG.slice(0, 40)], idle));
  assert.deepEqual([stop.code, stop.report.subjects.eligible, idle.sent.length], ["COLD_QUESTIONS_TOO_FEW_SUBJECTS", COLD_QUESTIONS_TOOL.needs.unanswerable - 1, 0]);
});

// ---- Enough, or not --------------------------------------------------------------------------------------------------------------

test("too few passages, or too few questions of any kind, the eight in other words included: one more batch of what is short, then no file, and a code with counts", async () => {
  // Twenty-four passages to draw from is the tool's floor: with twenty-three, no call is made; with twenty-four, each is written about
  // twice, 40 in its words and 8 in other words, which is enough when nothing is dropped.
  const few = (count) => [INVENTED_JOURNAL_SENTINEL, ...Array.from({ length: count }, (_, place) => lentEntry(place))];
  const exclude = new Set(["passage:0000"]);
  const idle = questionWriter();
  const stop = await outcomeOf(write(few(23), idle, { exclude }));
  assert.deepEqual([stop.code, idle.sent.length], ["COLD_QUESTIONS_TOO_FEW_PASSAGES", 0]);
  assert.deepEqual(stop.report.passages, { usable: 24, excluded: 1, held_back: 0, population: 23, sent: 0, skipped: 0, replaced: 0, in_dropped_batches: 0,
    held_back_in_run: 0 });
  const floor = await write(few(24), questionWriter(), { exclude });
  assert.deepEqual([floor.report.kept.same_words, floor.report.kept.other_words, floor.report.kept.planted], [40, 8, 24]);

  // Each kind short in turn: the program's count of the words a question shares with its evidence, not GPT's label, decides its kind.
  let riddles = 0;
  const rewrite = (change) => questionWriter({ reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user), value = await usual();
    if (packet.task === "answerable") value.items.forEach((item, index) => change(item, packet.passages[index]));
    return value;
  } });
  const cases = [
    ["in other words", rewrite((item, passage) => { if (passage.wording === "other") item.question = `What happened when ${item.evidence_quote}?`; }), {}, (kept) => kept.other_words === 0, "answerable"],
    ["in the passages' words", rewrite((item, passage) => { if (passage.wording === "same") item.question = `Riddle ${riddleWord(1000 + (riddles += 1))}: who was it?`; }), {}, (kept) => kept.same_words === 0, "answerable"],
    ["planted answers", rewrite((item) => { item.planted_kind = "none"; item.planted_answer = ""; }), {}, (kept) => kept.planted === 0, "answerable"],
    ["planted answers of one kind", rewrite((item, passage) => { if (passage.plant === "time") item.planted_kind = "none"; }), {}, (kept) => kept.planted >= 20 && kept.planted_by_kind.time === 0, "answerable"],
    ["questions the journal doesn't answer that find something", questionWriter(), { askReader: async () => 0 }, (kept) => kept.unanswerable === 0, "unanswerable"]
  ];
  for (const [what, writer, options, short, task] of cases) {
    const { code, report } = await outcomeOf(write(LONG, writer, options));
    assert.equal(code, "COLD_QUESTIONS_NOT_ENOUGH", what);
    assert.ok(short(report.kept), `${what}: ${JSON.stringify(report.kept)}`);
    assert.equal(report.batches[task], task === "answerable" ? 5 : 3, `${what}: one more batch`);
  }
});

test("one budget a run: every call of the worker counts, those asked again included, and the twenty-first isn't made; the passages sent are counted, at most 150", async () => {
  // Most passages hold nothing to ask about, and from the fifth call on every answer is outside its schema.
  let writing = 0;
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const value = await usual();
    if (count >= 5) return { items: [] };
    if (taskOf(request) === "answerable" && (writing += 1) <= 4) value.items.forEach((item, index) => { if (index > 0) Object.assign(item, SKIP); });
    return value;
  } });
  const stop = await outcomeOf(write(LONG, writer));
  assert.equal(stop.code, "COLD_QUESTIONS_CALL_BUDGET");
  assert.equal(writer.sent.length, COLD_QUESTIONS_TOOL.budget.calls);
  assert.deepEqual(stop.report.calls, { made: 20, asked_again: 10 });
  assert.deepEqual(stop.report.batches, { answerable: 6, unanswerable: 3, key_checks: 1, dropped_for_form: 5, refused: 0 });
  assert.deepEqual([stop.report.passages.skipped, stop.report.passages.replaced, stop.report.passages.sent], [56, 15, passagesSent(writer).size]);
  assert.ok(stop.report.passages.sent <= COLD_QUESTIONS_TOOL.budget.passages);

  // The twentieth call ends a key check, and the next packet would be the twenty-first call: it isn't sent either.
  const checks = new Map();
  const spending = questionWriter({ reply: async (count, request, usual) => {
    const task = taskOf(request);
    if (task === "check_keys" && !checks.has(request.user)) checks.set(request.user, checks.size + 1);
    return task === "unanswerable" || (task === "check_keys" && checks.get(request.user) <= 3) ? { items: [] } : usual();
  } });
  const spent = await outcomeOf(write(LONG, spending));
  assert.deepEqual([spent.code, spending.sent.length, spent.report.calls, taskOf(spending.sent.at(-1).request)],
    ["COLD_QUESTIONS_CALL_BUDGET", 20, { made: 20, asked_again: 10 }, "check_keys"]);

  // The passages: a run's draws send at most 135 (60 to write about, 30 as context, 15 replacements and two extra batches of 15), so only
  // a smaller budget shows the stop. With as many as a whole run sends, the same run; with one fewer, the packet that would pass it isn't
  // sent, nor any after it; with 59, the fourth writing batch isn't.
  const whole = questionWriter();
  const sentByAll = (await write(LONG, whole)).report.passages.sent;
  assert.ok(sentByAll <= 135 && sentByAll > 60, `${sentByAll}`);
  for (const [passages, code, calls] of [[sentByAll, null, whole.sent.length], [sentByAll - 1, "COLD_QUESTIONS_PASSAGE_BUDGET", null], [59, "COLD_QUESTIONS_PASSAGE_BUDGET", 3]]) {
    const capped = questionWriter();
    const outcome = await outcomeOf(write(LONG, capped, { budget: { passages, calls: 20 } }));
    assert.equal(outcome.code, code, `${passages}`);
    assert.ok(passagesSent(capped).size <= passages && outcome.report.passages.sent === passagesSent(capped).size, `${passages}`);
    assert.equal(outcome.report.calls.made, capped.sent.length, `${passages}`);
    if (calls !== null) assert.equal(capped.sent.length, calls, `${passages}`);
    else assert.ok(capped.sent.length < whole.sent.length && capped.sent.every(({ request }, index) => request.user === whole.sent[index].request.user), `${passages}`);
  }
  for (const budget of [{ passages: 0, calls: 20 }, { passages: 150 }, null]) await assert.rejects(write(LONG, questionWriter(), { budget }), { code: "COLD_QUESTIONS_INPUT_INVALID" });
});

// ---- What it holds back ----------------------------------------------------------------------------------------------------------

test("a batch or a key check without an answer in its schema after two more asks, or one the worker refused, is dropped whole: its passages go to no later call, of this run or the next, and are counted", async () => {
  // The second writing packet answered outside its schema three times; the first key check refused (as Claude's worker can say); the
  // second outside its schema three times.
  const ordinal = new Map(), seen = { answerable: 0, unanswerable: 0, check_keys: 0 };
  const which = (request) => {
    if (!ordinal.has(request.user)) ordinal.set(request.user, (seen[taskOf(request)] += 1));
    return ordinal.get(request.user);
  };
  const writer = questionWriter({ reply: async (count, request, usual) => {
    const task = taskOf(request), n = which(request);
    if (task === "answerable" && n === 2) return { items: [] };
    if (task === "check_keys" && n === 1) throw new ProviderError("A synthetic refusal.", { code: "REFUSED" });
    if (task === "check_keys" && n === 2) return { items: [] };
    return usual();
  } });
  const held = new Set();
  const first = await outcomeOf(write(LONG, writer, { holdBack: async (digests) => { for (const digest of digests) held.add(digest); } }));
  const packetsOf = (task, n) => writer.sent.filter(({ request }) => taskOf(request) === task && ordinal.get(request.user) === n);
  const dropped = [packetsOf("answerable", 2), packetsOf("check_keys", 1), packetsOf("check_keys", 2)];
  assert.deepEqual(dropped.map((entries) => entries.length), [3, 1, 3], "asked twice more for its form; a refusal not again");
  for (const entries of dropped) {
    const words = new Set(wordsIn(entries[0].packet));
    assert.equal(words.size, 15);
    for (const later of passagesSent(writer, writer.sent.indexOf(entries.at(-1)) + 1)) assert.equal(words.has(later), false, later);
    for (const passage of words) assert.ok(held.has(passageDigest(passage)));
  }
  assert.equal(held.size, 45);
  const { report } = first;
  assert.deepEqual([report.batches.dropped_for_form, report.batches.refused, report.passages.in_dropped_batches, report.dropped.in_dropped_key_checks, report.calls.asked_again],
    [2, 1, 45, 30, 4]);
  // The next run, given what was held back, sends none of it, in the same words written another way either.
  assert.equal(passageDigest(`${LONG[0].replaceAll(" ", "  ")}\n`), passageDigest(LONG[0]));
  const next = questionWriter();
  const second = await outcomeOf(write(LONG.map((text) => (held.has(passageDigest(text)) ? `${text.replaceAll(" ", "  ")}\n` : text)), next, { heldBack: held, seed: 2 }));
  assert.deepEqual([second.report.passages.held_back, second.report.passages.population], [45, 55]);
  for (const words of passagesSent(next)) assert.equal(held.has(passageDigest(words)), false, words);

  // A key check dropped for its form takes its fifteen questions out of the file, unchecked as they are: one more writing batch makes up
  // for them, and the file holds none of them.
  const checkOrdinal = new Map();
  const checking = questionWriter({ reply: async (count, request, usual) => {
    if (taskOf(request) === "check_keys" && !checkOrdinal.has(request.user)) checkOrdinal.set(request.user, checkOrdinal.size + 1);
    return taskOf(request) === "check_keys" && checkOrdinal.get(request.user) === 1 ? { items: [] } : usual();
  } });
  const made = await outcomeOf(write(LONG, checking));
  assert.equal(made.code, null, JSON.stringify(made.report?.kept));
  const unchecked = checking.packets("check_keys")[0].items.map(({ question }) => question);
  assert.equal(unchecked.length, 15);
  for (const question of unchecked) assert.equal(made.questions.questions.some((entry) => entry.question === question), false, question);
  assert.deepEqual([made.report.dropped.in_dropped_key_checks, made.report.batches.dropped_for_form, made.report.batches.answerable], [15, 1, 5]);
});

test("the context of the questions the journal doesn't answer is drawn from the passages not held back: a writing packet dropped before it leaves both context packets their fifteen", async () => {
  let failed = 0;
  const writer = questionWriter({ reply: async (count, request, usual) => (taskOf(request) === "answerable" && (failed += 1) <= 3 ? { items: [] } : usual()) });
  const held = new Set();
  await outcomeOf(write(LONG, writer, { holdBack: async (digests) => { for (const digest of digests) held.add(digest); } }));
  assert.equal(held.size, 15);
  const context = writer.packets("unanswerable").slice(0, 2);
  assert.deepEqual(context.map(({ passages }) => passages.length), [15, 15]);
  for (const { passages } of context) for (const { words } of passages) assert.equal(held.has(passageDigest(words)), false, words);
});

// Sixty passages, each written about once. A and B both hold the sentence the stand-in quotes as A's evidence, so both are A's evidence
// passages, and A's question carries B's words whole, which its key check would send with it. Seed 1 puts A's writing batch before B's,
// seed 5 after it.
const SHARED_QUOTE = "I left the spare key under the mat", B_WORDS = `${SHARED_QUOTE} by the blue bench`;
const PASSAGE_A = `On Monday ${SHARED_QUOTE} for my neighbour, and the abacus stayed in the shed all week.`, PASSAGE_B = `${B_WORDS}.`;
const SHARING = Object.freeze(Array.from({ length: 60 }, (_, place) => (place === 3 ? PASSAGE_A : place === 40 ? PASSAGE_B : lentEntry(place))));
const carryingB = ({ drop = () => false, ...options } = {}) => questionWriter({ ...options, reply: async (count, request, usual) => {
  const packet = JSON.parse(request.user);
  if (drop(packet)) return { items: [] };
  const value = await usual();
  if (packet.task === "answerable") {
    value.items.forEach((item, index) => { if (packet.passages[index].words === PASSAGE_A) Object.assign(item, { evidence_quote: SHARED_QUOTE, question: `What happened when ${B_WORDS}?` }); });
  }
  return value;
} });
const batchOf = (writer, words) => writer.packets("answerable").findIndex(({ passages }) => passages.some((passage) => passage.words === words));

test("a question whose evidence quote another passage holds too is dropped before its key check once that passage is held back: its check would carry that passage's words", async () => {
  // B's writing batch is answered outside its schema three times, so this run holds B back, before A's batch is written or after: A's
  // question is dropped before its key check, and no key check holds B's words.
  for (const [seed, bFirst] of [[1, false], [5, true]]) {
    const writer = carryingB({ drop: (packet) => packet.task === "answerable" && packet.passages.some(({ words }) => words === PASSAGE_B) });
    const { report } = await outcomeOf(write(SHARING, writer, { seed }));
    assert.equal(batchOf(writer, PASSAGE_B) < batchOf(writer, PASSAGE_A), bFirst, `${seed}: B's batch and A's are apart, in this order`);
    assert.deepEqual([report.batches.dropped_for_form, report.passages.in_dropped_batches, report.dropped.passage_held_back], [1, 15, 1], `${seed}`);
    assert.equal(JSON.stringify(writer.packets("check_keys")).includes(B_WORDS), false, `${seed}`);
  }
});

test("a key check is guarded against every passage holding its questions' evidence quotes: one another run holds back right before it leaves stops the run, though it isn't one of the check's own passages", async () => {
  // B has no question of its own: it has nothing to ask about (skipped), or it is a passage the cold test reads a key in but a reply may
  // not quote, never sampled. Another run holds B back right before the key check that holds A's question leaves.
  const all = journalOf(SHARING);
  for (const [what, passages, skip] of [["skipped", all, (words) => words === PASSAGE_B], ["a key passage only", all.filter(({ quote }) => quote !== PASSAGE_B), () => false]]) {
    let meanwhile = false;
    const writer = carryingB({ skip, prepare: async (count, request) => { if (taskOf(request) === "check_keys" && request.user.includes(B_WORDS)) meanwhile = true; } });
    const { code } = await outcomeOf(writeColdQuestions({ passages, keyPassages: all, wordList: true, worker: writer, askReader: async () => 2, random: seededRandom(1),
      readHeldBack: async () => (meanwhile ? [passageDigest(PASSAGE_B)] : []) }));
    assert.deepEqual([meanwhile, code], [true, "COLD_QUESTIONS_HELD_BACK_MEANWHILE"], what);
    assert.equal(writer.packets("check_keys").some((packet) => JSON.stringify(packet).includes(B_WORDS)), false, `${what}: nothing of that packet is sent`);
  }
  // With no hold-back the run goes on, and B, a key passage only, guarded with A's key check but in no packet, isn't counted as sent:
  // the passages counted are those the packets held.
  const going = carryingB();
  const { report } = await outcomeOf(writeColdQuestions({ passages: all.filter(({ quote }) => quote !== PASSAGE_B), keyPassages: all, wordList: true, worker: going,
    askReader: async () => 2, random: seededRandom(1) }));
  assert.ok(going.packets("check_keys").some((packet) => JSON.stringify(packet).includes(B_WORDS)), "A's question, with B's words, was checked");
  assert.equal(report.passages.sent, passagesSent(going).size);
});

// Sixty passages, each written about once. One of four words has nothing to ask about (skipped), and a question or a planted answer GPT
// wrote in its batch holds its words whole, in other letters, which the six-word check can't find in a passage that short.
const SHORT_HELD = "Goats chewed the kazoo.", SHORT_WORDS = "goats chewed the kazoo";
const WITH_SHORT = Object.freeze(Array.from({ length: 60 }, (_, place) => (place === 40 ? SHORT_HELD : lentEntry(place))));
const carryingShort = (where, options) => {
  const carrier = { question: null };
  const writer = questionWriter({ ...options, skip: (words) => words === SHORT_HELD, reply: async (count, request, usual) => {
    const packet = JSON.parse(request.user);
    const value = await usual();
    if (packet.task === "answerable" && carrier.question === null && packet.passages.some(({ words }) => words === SHORT_HELD)) {
      const item = value.items.find((entry, index) => packet.passages[index].words !== SHORT_HELD && (where === "question" || entry.planted_kind !== "none"));
      if (where === "question") item.question = `${item.question.slice(0, -1)}, when the ${SHORT_WORDS}?`;
      else item.planted_answer = `${PLANTED}: the ${SHORT_WORDS}`;
      carrier.question = item.question;
    }
    return value;
  } });
  return { writer, carrier };
};
const holdsShort = (packets) => JSON.stringify(packets).toLowerCase().includes(SHORT_WORDS);

test("a question or a planted answer that holds all the words of a held-back passage goes to no key check: dropped before it (the planted answer alone) once the run knows the passage is held back, and one another run holds back right before the check leaves stops the run", async () => {
  for (const where of ["question", "plant"]) {
    // Another run holds the short passage back after the writing batches, read before a context packet that doesn't hold it.
    let holding = false;
    const { writer, carrier } = carryingShort(where, { prepare: async (count, request) => {
      if (taskOf(request) === "unanswerable" && !request.user.includes(SHORT_HELD)) holding = true;
    } });
    const { code, report } = await outcomeOf(write(WITH_SHORT, writer, { readHeldBack: async () => (holding ? [passageDigest(SHORT_HELD)] : []) }));
    assert.deepEqual([code, holding, carrier.question !== null], [null, true, true], where);
    assert.deepEqual([report.dropped.held_back_words, report.dropped.plant_held_back_words, report.dropped.passage_held_back],
      where === "question" ? [1, 0, 0] : [0, 1, 0], where);
    assert.equal(holdsShort(writer.packets("check_keys")), false, `${where}: no key check holds its words`);
    const checked = writer.packets("check_keys").flatMap(({ items }) => items).filter(({ question }) => question === carrier.question);
    assert.deepEqual(checked.map(({ planted }) => planted), where === "question" ? [] : [null], `${where}: the question checked without the planted answer`);
  }
  for (const where of ["question", "plant"]) {
    // Another run holds it back right before the key check that holds those words leaves.
    let meanwhile = false;
    const { writer } = carryingShort(where, { prepare: async (count, request) => {
      if (taskOf(request) === "check_keys" && request.user.toLowerCase().includes(SHORT_WORDS)) meanwhile = true;
    } });
    const { code } = await outcomeOf(write(WITH_SHORT, writer, { readHeldBack: async () => (meanwhile ? [passageDigest(SHORT_HELD)] : []) }));
    assert.deepEqual([meanwhile, code], [true, "COLD_QUESTIONS_HELD_BACK_MEANWHILE"], where);
    assert.equal(holdsShort(writer.packets("check_keys")), false, `${where}: nothing of that packet is sent`);
  }
});

test("a passage another run held back after this one read the list stops this run before the packet that holds it leaves: nothing of that packet is sent, and the ask isn't counted", async () => {
  const writer = questionWriter();
  const all = LONG.map(passageDigest);
  // The list as another run leaves it: empty when this run starts, every passage once this run's first packet has gone.
  const { code, report } = await outcomeOf(write(LONG, writer, { readHeldBack: async () => (writer.sent.length >= 1 ? all : []) }));
  assert.equal(code, "COLD_QUESTIONS_HELD_BACK_MEANWHILE");
  assert.equal(writer.sent.length, 1);
  assert.deepEqual([report.calls.made, report.calls.asked_again, report.passages.sent], [1, 0, 15]);

  // On an ask again: the first packet's answer is outside its schema, and before it is asked again another run holds back one of its
  // passages. The ask again isn't made, nor counted: calls made and asked again are back to the first ask's; the first ask's passages,
  // which left, stay counted as sent.
  const retrying = questionWriter({ reply: async (count, request, usual) => (count === 1 ? { items: [] } : usual()) });
  const first = () => [passageDigest(retrying.sent[0].packet.passages[0].words)];
  const again = await outcomeOf(write(LONG, retrying, { readHeldBack: async () => (retrying.sent.length >= 1 ? first() : []) }));
  assert.deepEqual([again.code, retrying.sent.length], ["COLD_QUESTIONS_HELD_BACK_MEANWHILE", 1]);
  assert.deepEqual([again.report.calls.made, again.report.calls.asked_again, again.report.passages.sent], [1, 0, 15]);
});

test("with thirty passages each is written about twice: one a dropped packet held back goes in no later packet of the run, the writing batch that held it again leaves it out, and its other question goes unchecked, so dropped", async () => {
  // Thirty passages: the first writing batch and the third hold the same fifteen, and so do the first and the third key checks.
  const texts = Array.from({ length: 30 }, (_, place) => lentEntry(place));
  for (const task of ["answerable", "check_keys"]) {
    const ordinal = new Map();
    let seen = 0;
    // The first packet of `task` is answered outside its schema, each time it is asked.
    const writer = questionWriter({ reply: async (count, request, usual) => {
      if (taskOf(request) === task && !ordinal.has(request.user)) ordinal.set(request.user, (seen += 1));
      return taskOf(request) === task && ordinal.get(request.user) === 1 ? { items: [] } : usual();
    } });
    const held = new Set();
    const { code, report } = await outcomeOf(write(texts, writer, { holdBack: async (digests) => { for (const digest of digests) held.add(digest); } }));
    const dropped = writer.sent.filter(({ request }) => taskOf(request) === task && ordinal.get(request.user) === 1);
    assert.equal(dropped.length, 3, `${task}: asked twice more for its form`);
    const words = new Set(wordsIn(dropped[0].packet));
    assert.equal(words.size, 15, task);
    for (const passage of words) assert.ok(held.has(passageDigest(passage)), task);
    assert.equal(held.size, 15, task);
    for (const later of passagesSent(writer, writer.sent.indexOf(dropped.at(-1)) + 1)) assert.equal(words.has(later), false, `${task}: ${later}`);
    // Fifteen places of the third writing batch left empty, and no call for it; or the fifteen questions of the third batch's
    // passages dropped before their check, and no call for that check.
    assert.deepEqual([report.passages.held_back_in_run, report.dropped.passage_held_back, report.batches.answerable, report.batches.key_checks],
      task === "answerable" ? [15, 0, 3, 2] : [0, 15, 4, 3], task);
    assert.deepEqual([report.passages.in_dropped_batches, report.batches.dropped_for_form, code], [15, 1, "COLD_QUESTIONS_NOT_ENOUGH"], task);
  }
});

test("an answer outside its schema and a passing failure are counted apart, so their order changes nothing: a third answer outside it drops the batch, a third passing failure stops the tool", async () => {
  // The first writing packet fails as `sequence` says, each time it is asked, then answers in its schema.
  const run = async (sequence, held = new Set()) => {
    const ordinal = new Map();
    let seen = 0, tries = 0;
    const writer = questionWriter({ reply: async (count, request, usual) => {
      if (taskOf(request) === "answerable" && !ordinal.has(request.user)) ordinal.set(request.user, (seen += 1));
      if (taskOf(request) !== "answerable" || ordinal.get(request.user) !== 1 || tries >= sequence.length) return usual();
      if (sequence[tries++] === "timeout") throw new ProviderError("A synthetic timeout.", { code: "TIMEOUT" });
      return { items: [] };
    } });
    const outcome = await outcomeOf(write(LONG, writer, { holdBack: async (digests) => { for (const digest of digests) held.add(digest); } }));
    return { ...outcome, asked: writer.sent.filter(({ request }) => taskOf(request) === "answerable" && ordinal.get(request.user) === 1).length, held: held.size };
  };
  // Twice outside its schema, then a timeout: asked again, and its third answer outside the schema drops it and holds it back.
  const dropped = await run(["form", "form", "timeout", "form"]);
  assert.deepEqual([dropped.asked, dropped.held, dropped.report.batches.dropped_for_form, dropped.report.calls.asked_again], [4, 15, 1, 3]);
  // Two timeouts, then one answer outside its schema, then one in it: the batch is kept, and nothing is held back.
  const kept = await run(["timeout", "timeout", "form"]);
  assert.deepEqual([kept.code, kept.asked, kept.held, kept.report.batches.dropped_for_form, kept.report.calls.asked_again], [null, 4, 0, 0, 3]);
  // Three timeouts stop the tool with the worker's code, holding nothing back.
  const none = new Set();
  await assert.rejects(run(["timeout", "timeout", "timeout"], none), { code: "TIMEOUT" });
  assert.equal(none.size, 0);
});

// ---- The file ------------------------------------------------------------------------------------------------------------------

test("the file's cut keeps planted answers first, spread over their kinds: a wording with more than its aim takes the kind with the fewest kept first", () => {
  const [k0, k1, k2, k3, k4] = PLANTED_KINDS;
  let made = 0;
  const candidate = (kind, plant = null) => ({ kind, question: `q${made += 1}`, plant: plant ? { kind: plant, answer: `${PLANTED} ${made}.` } : null });
  // In other words: six planted of each of two kinds first, then one of each other kind, then three without; in the passages' words, two
  // of each of those three kinds and forty without.
  const other = [...Array(6).fill(k0), ...Array(6).fill(k1), k2, k3, k4].map((kind) => candidate("other", kind)).concat([1, 2, 3].map(() => candidate("other")));
  const same = [k2, k2, k3, k3, k4, k4].map((kind) => candidate("same", kind)).concat(Array.from({ length: 40 }, () => candidate("same")));
  const chosen = answerableForFile([...other, ...same], COLD_QUESTIONS_TOOL.aims);
  const byKind = (list) => Object.fromEntries(PLANTED_KINDS.map((kind) => [kind, list.filter(({ plant }) => plant?.kind === kind).length]));
  assert.deepEqual([chosen.filter(({ kind }) => kind === "same").length, chosen.filter(({ kind }) => kind === "other").length], [46, 12]);
  assert.ok(chosen.filter(({ kind }) => kind === "other").every(({ plant }) => plant), "planted answers first");
  assert.deepEqual(byKind(chosen), { [k0]: 5, [k1]: 4, [k2]: 3, [k3]: 3, [k4]: 3 });
  // Taken in the run's order alone, the twelve would be the first two kinds', leaving three kinds with two each.
  assert.deepEqual(byKind([...same, ...other.slice(0, 12)]), { [k0]: 6, [k1]: 6, [k2]: 2, [k3]: 2, [k4]: 2 });
  // A wording within its aim keeps all of it, planted ones first, in the run's order.
  assert.deepEqual(answerableForFile(same, COLD_QUESTIONS_TOOL.aims).map(({ question }) => question), same.map(({ question }) => question));
});

test("the file, cut to its aims, still meets the rule, or there is no test: GPT may word planted questions in none of their passages' words", async () => {
  // The first seventeen planted questions in the passages' words are written in none of them, so the program counts them in other
  // words, and that wording holds more planted answers than its twelve.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let reworded = 0;
    const writer = questionWriter({ reply: async (count, request, usual) => {
      const value = await usual();
      if (taskOf(request) !== "answerable") return value;
      return { items: value.items.map((item) => (item.planted_kind !== "none" && item.wording === "same" && reworded < 17
        ? { ...item, question: `Riddle ${riddleWord(1000 + (reworded += 1))}: who was it?` } : item)) };
    } });
    const outcome = await outcomeOf(write(LONG, writer, { seed }));
    // Taken kind by kind, the twelve keep the file within the rule here (taken in the run's order alone, seed 4 left a kind with two).
    assert.equal(outcome.code, null, `${seed}: ${JSON.stringify(outcome.report?.kept)}`);
    const planted = outcome.questions.questions.filter((entry) => entry.planted);
    const byKind = Object.fromEntries(PLANTED_KINDS.map((kind) => [kind, planted.filter((entry) => entry.planted.kind === kind).length]));
    assert.ok(planted.length >= COLD_QUESTIONS_TOOL.needs.planted, `${seed}`);
    for (const kind of PLANTED_KINDS) assert.ok(byKind[kind] >= COLD_QUESTIONS_TOOL.needs.plantedOfEachKind, `${seed}: ${JSON.stringify(byKind)}`);
    assert.deepEqual(outcome.report.kept.planted_by_kind, byKind, `${seed}`);
  }
  // A file whose cut leaves it short of the rule (here, aims smaller than the rule's): no test, and the report counts the file.
  const short = await outcomeOf(write(LONG, questionWriter(), { fileAims: { ...COLD_QUESTIONS_TOOL.aims, same: 30 } }));
  assert.deepEqual([short.code, short.report.kept.same_words, short.report.kept.other_words], ["COLD_QUESTIONS_NOT_ENOUGH", 30, 12]);
});

// ---- From the copy itself --------------------------------------------------------------------------------------------------------

const CASE = "case-13131313-1313-4131-8131-131313131313", CORPUS = "corpus:invented-questions", AUTH = Object.freeze({ bearerToken: "synthetic" });
const ACCESS = Object.freeze({ requiredScope: "case:read", requiredPurpose: "session_use" });

// A published copy of an invented journal in a vault of its own, a trial folder with the client's journal folder, and the GPT questions
// writer of the shared cold-test job on them, under no lock (`call` changes what the job gives it). `unitOptions: {}` cuts the journal
// as the import does (by default each paragraph is a passage); `change(node)` may change a passage before the copy is stored.
async function copyWith(t, paragraphs, { dates = new Map(), unitOptions = undefined, change = null } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-questions-"));
  const keys = { routineKek: Buffer.alloc(32, 81), recoverySecretBytes: Buffer.alloc(32, 82) };
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const service = createPrivateCaseAccessService({ rootDir, authorizationProvider: {
    async authorize({ caseId, requiredScope }) { return { allowed: caseId === CASE, principalId: "synthetic-operator", scopes: [requiredScope], purposes: Object.values(PRIVATE_JOURNAL_PURPOSES) }; }
  }, keyProvider: { async getCaseKeyMaterial() {
    return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true };
  } } });
  await service.appendTranscriptTurn(CASE, { id: "turn:1", exchange_id: "exchange:1", role: "user", text: "A synthetic message.", at: "2026-11-24T08:00:00.000Z", episode_id: null }, AUTH);
  await service.createJournalCorpus(CASE, { corpusId: CORPUS, manifestObjectId: "manifest:staging" }, AUTH);
  let invented;
  await service.withJournalCorpus(CASE, CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    invented = await persistInventedJournal({ corpusStore, caseId: CASE, corpusId: CORPUS, pages: inventedPages(paragraphs, { dates }), change, ...(unitOptions ? { unitOptions } : {}) });
  }, AUTH);
  await service.publishJournalGeneration(CASE, { corpusId: CORPUS, generation: invented.generation, manifestObjectId: invented.persisted.manifest_object_id }, AUTH);
  const { reference } = await service.inspectJournalCorpus(CASE, CORPUS, ACCESS, AUTH);
  const trialDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-questions-trial-"));
  t.after(() => fs.rm(trialDir, { recursive: true, force: true }));
  await fs.mkdir(clientJournalFolder(trialDir, CASE), { recursive: true, mode: 0o700 });
  const run = (worker, { writer = {}, call = {} } = {}) => createGptQuestionsWriter({ trialDir, worker, random: seededRandom(3), ...writer })({ service, auth: AUTH, caseId: CASE,
    corpusId: CORPUS, tested: reference, beforeSend: null, underLock: (operation) => operation(), ...call });
  const passages = invented.graph.nodes.filter((node) => node.kind === "passage");
  return { reference, trialDir, run, service, stored: passages.map((node) => node.data.quote), ids: passages.map((node) => node.id) };
}

test("from the copy itself: the passages a reply may quote at the publication tested, the sentinel required as the first passage and never sampled, packets with their words and dates and nothing that names the case, passages held back for good", async (t) => {
  // The sentinel first, then entries, twenty of them under date lines.
  const paragraphs = [INVENTED_JOURNAL_SENTINEL, ...LONG];
  const { run, reference, trialDir, stored, ids } = await copyWith(t, paragraphs, { dates: new Map(Array.from({ length: 20 }, (_, index) => [index * 5 + 1, `March ${index + 1}, 2019`])) });
  const writer = questionWriter();
  const read = [];
  const recording = async (input) => {
    const reader = await openSessionUseReader(input);
    return { ...reader, read: async (request) => {
      const part = await reader.read(request);
      read.push({ question: request.query, found: part.source_items.length });
      return part;
    } };
  };
  const { questions, report } = await run(writer, { writer: { readerFor: recording } });
  assert.deepEqual([questions.author, report.passages.usable, report.passages.excluded, countsOf(questions).answerable, countsOf(questions).planted], ["openai", 121, 1, 60, 28],
    JSON.stringify(report));
  // The replies' reader is asked with each question the journal doesn't answer, as the message: one for which it returns nothing is
  // dropped (here, one whose phrase holds a word too many passages hold for the search to keep a passage by it alone).
  assert.equal(read.length, 30);
  assert.equal(report.dropped.reader_found_nothing, read.filter(({ found }) => found === 0).length);
  for (const { question } of questions.questions.filter(({ answerable }) => !answerable)) assert.ok(read.find((entry) => entry.question === question)?.found > 0, question);
  assert.equal(countsOf(questions).unanswerable, Math.min(26, read.filter(({ found }) => found > 0).length));
  assert.equal([...passagesSent(writer)].some((words) => normal(words).includes(INVENTED_JOURNAL_SENTINEL)), false);
  // The words are the copy's own, with the date its entry gives; no packet names the case, the copy, its publication or a record.
  const writing = writer.packets("answerable").flatMap(({ passages }) => passages);
  for (const { words } of writing) assert.ok(stored.includes(words), words);
  assert.ok(writing.some(({ written }) => written !== null), "an entry's date goes with its passages");
  for (const { written } of writing.filter((passage) => passage.written)) assert.deepEqual(Object.keys(written), ["from", "to", "precision", "between", "ambiguous", "year_inferred"]);
  const shown = JSON.stringify(writer.sent.map(({ request }) => [request.system, request.user]));
  for (const hidden of [CASE, CORPUS, reference.active_generation, reference.manifest_object_id, "invented:page", ...ids]) assert.equal(shown.includes(hidden), false, hidden);
  for (const item of writer.packets("check_keys").flatMap(({ items }) => items)) {
    const from = writing.find(({ words }) => normal(words).includes(normal(item.evidence_quote)));
    assert.deepEqual(item.passage, { words: from.words, written: from.written });
  }

  // A batch dropped for its form: its passages' digests kept in the client's folder (mode 0600), and none of them sent in the next run.
  let failed = 0;
  const failing = questionWriter({ reply: async (count, request, usual) => (taskOf(request) === "answerable" && (failed += 1) <= 3 ? { items: [] } : usual()) });
  await outcomeOf(run(failing));
  const file = path.join(clientJournalFolder(trialDir, CASE), QUESTIONS_HELD_BACK_FILE);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const held = await readQuestionsHeldBack(trialDir, CASE);
  assert.deepEqual([...held].sort(), [...new Set(failing.packets("answerable")[0].passages.map(({ words }) => passageDigest(words)))].sort());
  const after = questionWriter();
  assert.equal((await outcomeOf(run(after))).report.passages.held_back, 15);
  for (const words of passagesSent(after)) assert.equal(held.has(passageDigest(words)), false, words);

  // Another publication than the one tested, and a reader that reads another or none: stopped, before any call or at the first question.
  const stale = questionWriter();
  await assert.rejects(run(stale, { call: { tested: { ...reference, manifest_object_id: "manifest:another" } } }), { code: "COLD_QUESTIONS_SNAPSHOT_CHANGED" });
  assert.equal(stale.sent.length, 0);
  const another = { corpus_id: CORPUS, generation: "another", manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch };
  for (const [part, code] of [[{ availability: "unavailable" }, "COLD_TEST_READER_UNAVAILABLE"], [{ availability: "available", receipts: [another], source_items: [] }, "COLD_TEST_SNAPSHOT_CHANGED"]]) {
    await assert.rejects(run(questionWriter(), { writer: { readerFor: async () => ({ read: async () => part }) } }), { code });
  }
});

test("GPT's questions run only on a copy whose first passage, one a reply may quote, is exactly the code's sentence, byte for byte: the check reads the first passage the import makes, not the file, so files that open with the sentence in other ways run too, and a copy whose first passage is anything else is refused before any call", async (t) => {
  // Each journal is cut as the import cuts one (its own unit sizes). A file that opens with the sentence followed by a long run of spaces
  // and more words on its line (the import cuts in the spaces), or with a date line right under it, gives that first passage as one
  // that opens with the sentence as a paragraph does (review 4 found both): each opens with the code's sentence, and runs.
  const S = INVENTED_JOURNAL_SENTINEL;
  for (const [what, paragraphs] of [
    ["as a paragraph", [S, ...LONG]],
    ["followed by 1,500 spaces and more words on its line", [`${S}${" ".repeat(1500)}That spring I lent the abacus to my aunt.`, ...LONG]],
    ["with a date line right under it", [`${S}\nMarch 1, 2019`, ...LONG]]
  ]) {
    const { run, stored } = await copyWith(t, paragraphs, { unitOptions: {} });
    assert.equal(stored[0], S, what);
    const writer = questionWriter();
    assert.equal((await run(writer)).report.passages.excluded, 1, what);
    assert.equal(writer.sent.some(({ request }) => request.user.includes(S)), false, what);
  }
  // Prose just short enough that, with the sentence after it, the paragraph is over 1,600 bytes: the import cuts it right before the
  // sentence, which is a passage of its own, the second. And the sentence with a blank line inside it: the import joins the short first
  // piece to the next, so the first passage holds the sentence's words with the blank line between them, not the sentence.
  let prose = lentEntry(0);
  for (let place = 1; Buffer.byteLength(`${prose} ${S}`) <= QUOTE_UNIT_DEFAULTS.maximumBytes; place += 1) prose = `${prose} ${lentEntry(place)}`;
  const colon = S.indexOf(":") + 1;
  for (const [what, paragraphs, { first = null, ...options } = {}] of [
    ["inside other words", [`We read it aloud: ${S} Then we went home.`, ...LONG]],
    ["at the end of a first paragraph over 1,600 bytes", [`${prose} ${S}`, ...LONG], { first: (stored) => stored[0] === prose && stored[1] === S }],
    ["at the start of a first paragraph over 1,600 bytes", [`${S} ${prose}`, ...LONG]],
    ["after another paragraph", [LONG[0], S, ...LONG.slice(1)]],
    ["under a date line", [S, ...LONG], { dates: new Map([[0, "March 1, 2019"]]) }],
    ["with more words on the next line", [`${S}\n${LONG[0]}`, ...LONG.slice(1)]],
    ["with a blank line inside it", [S.slice(0, colon), S.slice(colon + 1), ...LONG], { first: (stored) => stored[0] !== S && normal(stored[0]) === S }],
    ["after a passage a reply may not quote", [LONG[0], S, ...LONG.slice(1)], { change: (node) => { if (node.data.quote === LONG[0]) node.lifecycle = "revoked"; } }],
    ["in a first passage a reply may not quote", [S, ...LONG], { first: (stored) => stored[0] === S, change: (node) => { if (node.data.quote === S) node.lifecycle = "revoked"; } }]
  ]) {
    const { run, stored } = await copyWith(t, paragraphs, { unitOptions: {}, ...options });
    if (first) assert.ok(first(stored), `${what}: ${JSON.stringify(stored.slice(0, 2))}`);
    const idle = questionWriter();
    await assert.rejects(run(idle), { code: "COLD_QUESTIONS_NOT_INVENTED" }, what);
    assert.equal(idle.sent.length, 0, what);
  }
});

test("a copy's first passage is the one first in source order of all its passages; it has none when a passage has no place or two share the first", () => {
  const place = (id, order) => ({ id, order });
  assert.equal(openingPassageId([place("b", [0, 120]), place("a", [1, 0]), place("c", [0, 0])]), "c");
  assert.equal(openingPassageId([place("b", 7), place("a", 3)]), "a", "an older index's single numbers");
  assert.equal(openingPassageId([place("b", [0, 0]), place("a", null)]), null, "a passage with no place");
  assert.equal(openingPassageId([place("b", [0, 0]), place("a", [0, "x"])]), null, "a place that isn't one");
  assert.equal(openingPassageId([place("b", [0, 0]), place("a", [0, 0]), place("c", [0, 9])]), null, "two share the first place");
  assert.equal(openingPassageId([]), null);
});

test("right before each packet of the questions tool leaves, the job's consent check and the held-back list run in one hold of the folder's lock", async (t) => {
  const { service, trialDir } = await copyWith(t, [INVENTED_JOURNAL_SENTINEL, ...LONG]);
  // A lock that numbers each hold, and spies that note the hold they run in: the consent check (it reads the client list first), the
  // held-back list, and each packet of the tool as it is prepared. The test's own workers stop it after the questions.
  let holds = 0, holding = null;
  const underLock = async (operation) => {
    holding = holds += 1;
    try { return await operation(); } finally { holding = null; }
  };
  const seen = [];
  const client = { case_id: CASE, journal: { corpus_id: CORPUS, consent: { withdrawn_at: null } } };
  const writer = questionWriter({ prepare: async () => { seen.push({ what: "packet", hold: holding }); } });
  const stopping = { async call() { throw Object.assign(new Error("A synthetic stop after the questions."), { code: "SYNTHETIC_STOP" }); } };
  await assert.rejects(runColdTestJob({ trialDir, underLock, findClient: async () => client,
    readClients: async () => { seen.push({ what: "check", hold: holding }); return { clients: [client] }; },
    openVault: async () => ({ service, auth: AUTH, close() {} }),
    ensureFolder: (folder) => fs.mkdir(folder, { recursive: true, mode: 0o700 }),
    writeFile: (file, text) => fs.writeFile(file, text, { mode: 0o600 }),
    consumer: stopping, judge: stopping,
    writeQuestions: createGptQuestionsWriter({ trialDir, worker: writer, random: seededRandom(3),
      readHeld: async (dir, caseId) => { seen.push({ what: "read", hold: holding }); return readQuestionsHeldBack(dir, caseId); } }) }), { code: "SYNTHETIC_STOP" });
  // Each packet the tool sent: prepared, then the check and the list, both in one hold.
  const packets = seen.flatMap((entry, index) => (entry.what === "packet" ? [seen.slice(index + 1, index + 3)] : []));
  assert.ok(writer.sent.length >= 10, `${writer.sent.length}`);
  assert.equal(packets.length, writer.sent.length);
  for (const [check, read] of packets) {
    assert.deepEqual([check?.what, read?.what], ["check", "read"]);
    assert.ok(check.hold !== null && check.hold === read.hold, JSON.stringify([check, read]));
  }
});

test("a caller that gives the writer no consent check of its own gives beforeSend, which still runs right before each packet leaves", async (t) => {
  const { run } = await copyWith(t, [INVENTED_JOURNAL_SENTINEL, ...LONG]);
  const order = [];
  const writer = questionWriter({ prepare: async () => { order.push("packet"); } });
  await run(writer, { call: { beforeSend: async () => { order.push("beforeSend"); } } });
  assert.ok(writer.sent.length >= 10, `${writer.sent.length}`);
  assert.deepEqual(order, writer.sent.flatMap(() => ["packet", "beforeSend"]));
  // What it refuses stops the run before that packet leaves.
  const refusing = questionWriter();
  const withdrawn = async () => { if (refusing.sent.length === 2) throw Object.assign(new Error("A synthetic withdrawal."), { code: "COLD_TEST_CHANGED" }); };
  await assert.rejects(run(refusing, { call: { beforeSend: withdrawn } }), { code: "COLD_TEST_CHANGED" });
  assert.equal(refusing.sent.length, 2);
});

test("the job reads the client's held-back passages again right before each packet leaves: another run's hold-back of the next packet's passages, written while this one runs, stops it before that packet goes", async (t) => {
  const { run, trialDir } = await copyWith(t, [INVENTED_JOURNAL_SENTINEL, ...LONG]);
  // Another run on the copy holds back the passages of this run's second packet just before it leaves.
  const racing = questionWriter({ prepare: async (count, request) => {
    if (count === 2) await addQuestionsHeldBack(trialDir, CASE, wordsIn(JSON.parse(request.user)).map(passageDigest));
  } });
  await assert.rejects(run(racing), { code: "COLD_QUESTIONS_HELD_BACK_MEANWHILE" });
  assert.equal(racing.sent.length, 1);
});

test("a copy without the invented-journal sentinel: refused before any call while GPT's questions run on invented journals only", async (t) => {
  const { run } = await copyWith(t, LONG);
  const idle = questionWriter();
  await assert.rejects(run(idle), { code: "COLD_QUESTIONS_NOT_INVENTED" });
  assert.equal(idle.sent.length, 0);
  // Under a consent that names them (pull request 3), the same copy gets its questions.
  assert.equal((await run(questionWriter(), { writer: { inventedOnly: false } })).questions.author, "openai");
});
