// Stand-in workers for the journal's cold test (src/runner-trial/journal-cold-test.mjs), given where the trial's signed-in ones go and called
// through the real port: no model is called. Like the sealed workers, one makes its preparation, asks `beforeSend`, and only then sends the
// packet. Everything that leaves is kept in `sent`, in order, with the role whose worker sent it.
//
// The consumer's stand-in sees only its packet: it says "supported" and cites every passage it was given, or "not_found" when it was given
// none, except for the questions `script` answers otherwise, by their words (a model judges a false premise itself); `words` gives the answer
// to a question, by its words. The judge's says "right", or what `verdict` returns for a packet, and for a planted answer (one that begins as
// PLANTED does) "wrong", or what `planted` returns for its packet. `prepare(count, request)` is the preparation and `reply(count, request,
// usual)` the answer, where `count` numbers the calls of both and `usual()` gives the stand-in's own.

import { PLANTED_KINDS } from "../../src/runner-trial/cold-test-rule.mjs";

export const JUDGE_REASON = "A synthetic reason that stays with the judge.";
export const ANSWER = "A synthetic answer.";
export const PLANTED = "A planted wrong answer";
/** The wrong answer planted on a question, by its place: the kinds in turn. */
export const plantOn = (place) => Object.freeze({ kind: PLANTED_KINDS[place % PLANTED_KINDS.length], answer: `${PLANTED} ${place}.` });
export const RECEIPTS = Object.freeze({ W: Object.freeze({ provider: "stand-in-w", model: "consumer 1.5" }), CW: Object.freeze({ provider: "stand-in-c", model: "judge-2" }) });

export function coldWorkers({ script = {}, words = {}, verdict = () => "right", planted = () => "wrong", prepare = null, reply = null } = {}) {
  const sent = [];
  let count = 0;
  const consumer = ({ question_id, question, passages }) => {
    const answerability = script[question] ?? (passages.length ? "supported" : "not_found");
    return { question_id, answerability, answer: words[question] ?? ANSWER, evidence_ids: answerability === "not_found" ? [] : passages.map(({ id }) => id) };
  };
  const judge = (packet) => ({ question_id: packet.question_id, verdict: packet.answer.startsWith(PLANTED) ? planted(packet, sent) : verdict(packet, sent), reason: JUDGE_REASON });
  return {
    sent,
    // What left for one role, as packets.
    packets: (role) => sent.filter((entry) => entry.role === role).map(({ packet }) => packet),
    workerFor: (role) => ({
      async call(request) {
        const index = count += 1;
        if (prepare) await prepare(index, request);
        if (request.beforeSend) await request.beforeSend();
        const packet = JSON.parse(request.user);
        sent.push({ role, request, packet });
        const usual = async () => (role === "W" ? consumer : judge)(packet);
        return { value: reply ? await reply(index, request, usual) : await usual(), receipt: { ...RECEIPTS[role], session_id: `synthetic-${index}` } };
      }
    })
  };
}

export const questionsFile = (questions, author = "person") => ({ schema_version: 1, kind: "journal_cold_questions", author, questions });

// A stand-in for GPT writing a copy's cold-test questions (src/runner-trial/cold-questions.mjs), given where the trial's sealed Codex
// worker goes and answering from its packet alone, in the tool's schemas: no model is called. Like the sealed worker it makes its
// preparation (`prepare(count, request)`), asks `beforeSend`, and only then sends; everything that leaves is kept in `sent`, in order,
// with its task.
// - For each passage of a writing batch: a question in the passage's words, which holds all of its evidence quote (the passage's first
//   forty words, or all of it), or, where the packet asks for other words, one in none of its words ("Riddle <letters>: who was it?");
//   the planted answer the packet asks for, which begins as PLANTED does; or a skip for the passages `skip(words)` names. A passage
//   asked about again gets another question.
// - For each subject: the list's first verb, and "after the" (in French "après le") with the rarest word of one of the batch's passages
//   (the one fewest of them hold, then the longest).
// - For a key check: every key confirmed and every planted answer contradicted.
// `reply(count, request, usual)` may answer otherwise, where `count` numbers the calls and `usual()` gives the stand-in's own answer.
export const QUESTION_RECEIPT = Object.freeze({ provider: "stand-in-gpt", model: "questions-1" });
const wordsOf = (text) => text.normalize("NFC").replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
/** A word of letters only that no journal holds, different for each number. */
export const riddleWord = (number) => {
  let letters = "";
  let left = number;
  do { letters = String.fromCharCode(97 + (left % 26)) + letters; left = Math.floor(left / 26); } while (left > 0);
  return `zq${letters}`;
};
const lettersOf = (text) => text.normalize("NFC").toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 4);
/** The word of `text` (of letters, four or more) that fewest of `texts` hold, then the longest, then the first in alphabetical order. */
export const rarestWord = (text, texts) => {
  const held = (word) => texts.filter((other) => lettersOf(other).includes(word)).length;
  return [...new Set(lettersOf(text))].sort((left, right) => held(left) - held(right) || right.length - left.length || left.localeCompare(right))[0] ?? "";
};

export function questionWriter({ skip = () => false, prepare = null, reply = null } = {}) {
  const sent = [];
  const asked = new Map();
  let count = 0, riddles = 0;
  const quoteOf = (words) => wordsOf(words).slice(0, 40).join(" ");
  const question = (passage, language) => {
    if (passage.wording === "other") return `Riddle ${riddleWord(riddles += 1)}: who was it?`;
    const times = (asked.get(passage.words) ?? 0) + 1;
    asked.set(passage.words, times);
    const quote = quoteOf(passage.words).replace(/[.!?…]+$/u, "");
    if (language === "fr") return times === 1 ? `Que s'est-il passé quand ${quote} ?` : `Et après ${quote}, qu'est-il arrivé ?`;
    return times === 1 ? `What happened when ${quote}?` : `And after ${quote}, what came next?`;
  };
  const answers = {
    answerable: (packet) => ({ items: packet.passages.map((passage) => (skip(passage.words)
      ? { passage: passage.name, skip: true, question: "", evidence_quote: "", wording: "none", planted_kind: "none", planted_answer: "" }
      : { passage: passage.name, skip: false, question: question(passage, packet.language), evidence_quote: quoteOf(passage.words), wording: passage.wording,
        planted_kind: passage.plant ?? "none", planted_answer: passage.plant ? `${PLANTED} (${passage.plant}) ${count}.${passage.name}.` : "" })) }),
    unanswerable: (packet) => ({ items: packet.subjects.map((subject, index) => ({ subject: subject.name, verb: packet.verbs[0],
      phrase: `${packet.language === "fr" ? "après le" : "after the"} ${rarestWord(packet.passages[index % packet.passages.length].words, packet.passages.map(({ words }) => words))}` })) }),
    check_keys: (packet) => ({ items: packet.items.map(({ id, planted }) => ({ id, answers: true, planted: planted ? "contradicted" : "none" })) })
  };
  return {
    sent,
    // What left for one task, as packets.
    packets: (task) => sent.filter((entry) => entry.task === task).map(({ packet }) => packet),
    async call(request) {
      const index = count += 1;
      if (prepare) await prepare(index, request);
      if (request.beforeSend) await request.beforeSend();
      const packet = JSON.parse(request.user);
      sent.push({ task: packet.task, request, packet });
      const usual = async () => answers[packet.task](packet);
      return { value: reply ? await reply(index, request, usual) : await usual(), receipt: { ...QUESTION_RECEIPT, session_id: `synthetic-questions-${index}` } };
    }
  };
}
