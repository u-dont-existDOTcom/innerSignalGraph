import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { POINTER_RULES } from "./pointer-reference.mjs";

// The operator's view of why the reference step didn't confirm pieces of the journal (owner, 14 Oct 2026: "i'd like to
// see what exactly is failing ... can you show me examples and why they fail?"). From the step's result and what its
// question writer and coverage judges answered (runPointerReference's `observe`), it gathers each piece that wasn't
// confirmed: its quotes, the questions of each try, and the judges' verdicts with their reasons, and renders them as one
// self-contained HTML page with nothing loaded from elsewhere. It follows the rules the run ran under: under owner
// decision 32's, Codex is the one judge and the pieces shown are the ones marked as not understood. What these functions return holds journal text: only the
// `pointer-examples` command calls them, and it writes the page to a new private file in the directory the run config
// names for operator review, never to an output or a log.

const invariant = (condition, code) => { if (!condition) throw new ValidationError(code, { code }); };
const JUDGES = Object.freeze([["standard", "Codex"], ["hardest", "Claude"]]);
// The judges a run's rules use (pointer-reference.mjs, pointerJudgeTiers): both, or under owner decision 32's, Codex alone.
const judgesFor = (rules) => (rules === 3 ? JUDGES.slice(0, 1) : JUDGES);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ids = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

function verdict(entry, judge, copyRunWords, rules) {
  if (!entry) return { judge, status: "not_judged" };
  if (entry.status !== "answered") return { judge, status: entry.status };
  const judgment = entry.judgment;
  const repeated = ids(judgment.repeated_question_ids);
  const combined = ids(judgment.combined_question_ids);
  const copied = ids(judgment.copied_question_ids);
  // The rule the step judged by (pointer-reference.mjs, referenceUnitStep): under owner decision 32's rules any split
  // into questions is fine, so a covered quote is confirmed; before, a repeated or a combined question held it back too,
  // and in a run from before owner decision 30 (`copyRunWords` null) so did a judge's copying flag.
  const confirmed = judgment.covered === true && (rules === 3 || (repeated.length === 0 && combined.length === 0
    && (copyRunWords !== null || copied.length === 0)));
  return { judge, status: confirmed ? "confirmed" : "held_back", covered: judgment.covered === true,
    missing: typeof judgment.missing === "string" ? judgment.missing : "", repeated, combined, copied };
}

// Whether a try's questions were confirmed: complete, every judge confirmed every quote, and the code's copy check held
// none back (under owner decision 32's rules it only flags a question). Such a piece fell short only after its questions
// (its searches), so it isn't an example of what fails here.
const triedAndConfirmed = (attempt, rules) => Boolean(attempt && attempt.writer.status === "complete" && attempt.verdicts.length > 0
  && attempt.verdicts.every((entry) => entry.judges.every((judge) => judge.status === "confirmed"))
  && (rules === 3 || attempt.questions.every((item) => item.copied_words === null)));

/**
 * Each sampled piece whose questions the reference step didn't confirm, oldest try first: not complete, and its last
 * try's questions not confirmed (a piece stopped only at its searches is left out).
 * `reference` is runPointerReference's result, `units` the quote units it ran on (unit_id, page, text), `events` what
 * its `observe` was told, `copyRunWords` the run's copy setting (null for a run from before owner decision 30) and
 * `rules` the run's rules (pointer-reference.mjs, POINTER_RULES). Under owner decision 32's rules (3) the pieces are the
 * ones marked as not understood, with their reason (`marked`), and those whose questions fell short or ran out of time;
 * a marked piece whose searches then fell short, recorded as a nonresponse, is shown with the reason its last try gives.
 */
export function collectPointerExamples({ reference, units, events, copyRunWords, rules = 2 } = {}) {
  invariant(isObject(reference) && Array.isArray(reference.units) && Array.isArray(units) && Array.isArray(events)
    && (copyRunWords === null || Number.isSafeInteger(copyRunWords)) && POINTER_RULES.includes(rules)
    && (rules === 2 || copyRunWords !== null), "POINTER_EXAMPLES_INPUT_INVALID");
  const judges = judgesFor(rules);
  const quotes = new Map(units.map((unit) => [unit.unit_id, unit]));
  const writers = new Map();
  const judged = new Map();
  for (const event of events) {
    if (event?.kind === "writer") writers.set(`${event.unit_id}\u0000${event.round}`, event);
    else if (event?.kind === "judge") {
      for (const id of event.quote_ids) {
        const judgment = Array.isArray(event.judgments) ? event.judgments.find((item) => isObject(item) && item.unit_id === id) : null;
        judged.set(`${id}\u0000${event.round}\u0000${event.tier}`, judgment ? { status: "answered", judgment }
          : { status: event.status === "answered" ? "invalid" : event.status });
      }
    }
  }
  const pieces = reference.units.filter((unit) => unit.status !== "complete").map((unit) => {
    const attempts = [0, 1].filter((round) => writers.has(`${unit.unit_id}\u0000${round}`)).map((round) => {
      const writer = writers.get(`${unit.unit_id}\u0000${round}`);
      const set = writer.set;
      const copied = new Map((set?.copied ?? []).map((item) => [item.question_id, item]));
      // A complete set's questions, with their IDs and the copy check; an incomplete one keeps none, so the writer's own.
      const questions = set?.complete
        ? set.questions.map((item) => ({ question_id: item.question_id, quote_id: item.unit_id, question: item.question,
          critical: item.critical === true, event: item.event === true, copied_words: copied.get(item.question_id)?.words ?? null }))
        : (Array.isArray(writer.raw_questions) ? writer.raw_questions : []).filter(isObject).map((item, position) => ({
          question_id: `written:${round}:${position}`, quote_id: typeof item.unit_id === "string" ? item.unit_id : "",
          question: typeof item.question === "string" ? item.question : "", critical: item.critical === true,
          event: item.event === true, copied_words: null }));
      const shortfall = writer.status !== "answered" ? { status: writer.status }
        : !set ? { status: "invalid" }
          : set.complete ? { status: "complete" }
            : { status: "incomplete", answer_valid: set.answer_valid, quotes_without_question: set.quotes_without_question,
              foreign_questions: set.foreign_questions, quotes_too_long: set.quotes_too_long };
      return { round, writer: shortfall, coverage_notes: Array.isArray(writer.coverage_notes) ? writer.coverage_notes : [], questions,
        verdicts: unit.quote_ids.map((id) => ({ quote_id: id,
          judges: judges.map(([tier, name]) => verdict(judged.get(`${id}\u0000${round}\u0000${tier}`), name, copyRunWords, rules)) })) };
    });
    const last = attempts.at(-1);
    const judgeFailed = Boolean(last?.verdicts.some((entry) => entry.judges.some((judge) => !["confirmed", "held_back"].includes(judge.status))));
    const marked = rules !== 3 ? null : unit.status === "marked" ? unit.reason ?? null
      : unit.reason === "searches_incomplete" && !triedAndConfirmed(last, rules) ? (judgeFailed ? "coverage_check_failed" : "coverage_unconfirmed")
        : null;
    return { unit_id: unit.unit_id, status: unit.status, reason: unit.reason ?? null, deadline_cause: unit.deadline_cause ?? null, marked,
      quotes: unit.quote_ids.map((id) => ({ quote_id: id, page: quotes.get(id)?.page ?? null, text: quotes.get(id)?.text ?? "" })),
      attempts };
  }).filter((piece) => (rules === 3 || piece.reason !== "searches_incomplete") && !triedAndConfirmed(piece.attempts.at(-1), rules));
  // In journal order: by the first quote's page, then the step's order.
  const page = (piece) => piece.quotes.find((quote) => Number.isSafeInteger(quote.page))?.page ?? Number.MAX_SAFE_INTEGER;
  const ordered = pieces.map((piece, index) => ({ piece, index })).sort((a, b) => page(a.piece) - page(b.piece) || a.index - b.index)
    .map(({ piece }) => piece);
  return { sampled: reference.units.length, pieces: ordered, copy_run_words: copyRunWords, rules };
}

// The operator's review directory as checked before the work: a real directory (not a link), the process's own, closed to
// everyone else. Returns its identity for writeReviewFile.
export async function checkReviewDirectory(dir) {
  const where = await fs.lstat(dir).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  invariant(where && where.isDirectory() && !where.isSymbolicLink() && (where.mode & 0o077) === 0
    && (typeof process.getuid !== "function" || where.uid === process.getuid()), "POINTER_EXAMPLES_DIR_UNSAFE");
  return { dev: where.dev, ino: where.ino };
}

/**
 * Creates `name` in the review directory checked earlier (`verified`, from checkReviewDirectory) and writes `content`
 * through the new file's own handle, so a path swapped in the meantime can't redirect the text. The file is created
 * owner-only, never over one that exists or through a link; before anything is written, the directory must still be
 * the one checked and the name in it must be the file just created. If not, the empty file is removed when it can be
 * found there, and nothing is written.
 */
export async function writeReviewFile({ dir, name, verified, content } = {}) {
  invariant(typeof name === "string" && /^[A-Za-z0-9._-]{1,200}$/u.test(name) && verified && typeof content === "string", "POINTER_EXAMPLES_INPUT_INVALID");
  const target = path.join(dir, name);
  const { O_CREAT, O_EXCL, O_WRONLY, O_NOFOLLOW } = fs.constants;
  const handle = await fs.open(target, O_CREAT | O_EXCL | O_WRONLY | (O_NOFOLLOW ?? 0), 0o600);
  let opened = null;
  let bound = false;
  try {
    opened = await handle.stat();
    const again = await fs.lstat(dir).catch(() => null);
    const named = await fs.lstat(target).catch(() => null);
    bound = Boolean(again && again.isDirectory() && !again.isSymbolicLink() && again.dev === verified.dev && again.ino === verified.ino
      && named && named.isFile() && named.dev === opened.dev && named.ino === opened.ino && (opened.mode & 0o077) === 0);
    if (bound) await handle.writeFile(content);
  } finally { await handle.close(); }
  if (!bound) {
    const named = await fs.lstat(target).catch(() => null);
    if (named && opened && named.dev === opened.dev && named.ino === opened.ino) await fs.unlink(target).catch(() => {});
    invariant(false, "POINTER_EXAMPLES_DIR_UNSAFE");
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);

const STATUS_WORDS = Object.freeze({
  unconfirmed: "not confirmed, even after the rewrite",
  coverage_unconfirmed: "not confirmed, even after the rewrite",
  questions_incomplete: "the question writer's questions fell short twice",
  coverage_check_failed: "a judge gave no usable answer",
  deadline: "the step's time ran out before its questions were confirmed"
});
// Under owner decision 32's rules a piece whose questions weren't confirmed is marked as not understood.
const MARKED_WORDS = Object.freeze({
  coverage_unconfirmed: "marked as not understood: not covered, even after the rewrite",
  coverage_check_failed: "marked as not understood: the judge gave no usable answer"
});
const pieceStatus = (piece) => (piece.marked
  ? `${MARKED_WORDS[piece.marked] ?? `marked (${piece.marked})`}${piece.status === "nonresponse" ? "; its searches didn't finish either" : ""}`
  : STATUS_WORDS[piece.status === "unconfirmed" ? "unconfirmed" : piece.reason] ?? `stopped short (${piece.reason ?? piece.status})`);
const writerWords = (writer) => (writer.status === "complete" ? null : ({
  deadline: "The question writer gave no answer before the time ran out.",
  invalid: "The question writer's answer wasn't usable.",
  incomplete: `The question writer's questions fell short: ${[
    writer.answer_valid === false ? "the answer wasn't in the expected form" : null,
    writer.quotes_without_question ? `${writer.quotes_without_question} quote(s) got no question` : null,
    writer.foreign_questions ? `${writer.foreign_questions} question(s) named a quote outside this piece` : null,
    writer.quotes_too_long ? `${writer.quotes_too_long} quote(s) with their questions were too long to judge` : null
  ].filter(Boolean).join("; ") || "incomplete"}.`
})[writer.status] ?? `The question writer's call ended: ${writer.status}.`);

function verdictHtml(item, labels, rules) {
  const name = `<strong>${escapeHtml(item.judge)}</strong>`;
  if (item.status === "confirmed") return `<li class="ok">${name}: confirmed.</li>`;
  if (item.status === "not_judged") return `<li class="muted">${name}: didn't judge this try.</li>`;
  if (item.status !== "held_back") return `<li class="muted">${name}: no usable answer (${escapeHtml(item.status)}).</li>`;
  const label = (list) => list.map((id) => labels.get(id) ?? id).join(", ");
  // Under owner decision 32's rules only something left out holds a quote back.
  const reasons = [
    item.covered ? null : "something left out",
    rules !== 3 && item.repeated.length ? `repeated: ${escapeHtml(label(item.repeated))}` : null,
    rules !== 3 && item.combined.length ? `two things in one: ${escapeHtml(label(item.combined))}` : null,
    rules !== 3 && item.copied.length ? `copies the passage's words: ${escapeHtml(label(item.copied))}` : null
  ].filter(Boolean);
  const note = item.missing.trim() ? `<div class="note">Its note: “${escapeHtml(item.missing.trim())}”</div>` : "";
  return `<li class="held">${name}: held back (${reasons.join("; ") || "no reason listed"}).${note}</li>`;
}

/** The examples as one self-contained HTML page. */
export function renderPointerExamples(collected, { runId, generatedAt } = {}) {
  invariant(isObject(collected) && Array.isArray(collected.pieces), "POINTER_EXAMPLES_INPUT_INVALID");
  const rules = collected.rules ?? 2;
  const title = rules === 3 ? "Journal pieces marked as not understood" : "Journal pieces the reference step didn't confirm";
  const parts = [];
  collected.pieces.forEach((piece, index) => {
    const quoteHtml = piece.quotes.map((quote) => `<figure><figcaption>${quote.page === null ? "Passage" : `Page ${escapeHtml(quote.page)}`}`
      + ` · ${escapeHtml(quote.quote_id)}</figcaption><blockquote>${escapeHtml(quote.text)}</blockquote></figure>`).join("");
    const tries = piece.attempts.map((attempt) => {
      const labels = new Map(attempt.questions.map((item, position) => [item.question_id, `Q${position + 1}`]));
      const notes = attempt.coverage_notes.length
        ? `<p class="small">Notes the judges gave the writer for this rewrite:</p><ul class="small">${attempt.coverage_notes
          .map((note) => `<li>${escapeHtml(note.missing ?? "")}</li>`).join("")}</ul>` : "";
      const writer = writerWords(attempt.writer);
      const questions = attempt.questions.length ? `<ol class="questions">${attempt.questions.map((item) => `<li><span class="q">${escapeHtml(labels.get(item.question_id))}</span> `
        + `${escapeHtml(item.question)}${item.critical ? " <span class=\"tag\">essential</span>" : ""}${item.event ? " <span class=\"tag\">event</span>" : ""}`
        + `${item.copied_words !== null ? ` <span class="tag warn">code: copies ${escapeHtml(item.copied_words)} words in a row${rules === 3 ? "; flagged, left out of recall" : ""}</span>` : ""}`
        + `${piece.quotes.length > 1 ? ` <span class="small">(${escapeHtml(item.quote_id)})</span>` : ""}</li>`).join("")}</ol>` : "";
      const verdicts = attempt.verdicts.map((entry) => `<div class="verdict">${piece.quotes.length > 1 ? `<p class="small">${escapeHtml(entry.quote_id)}</p>` : ""}`
        + `<ul>${entry.judges.map((item) => verdictHtml(item, labels, rules)).join("")}</ul></div>`).join("");
      return `<div class="try"><h3>${attempt.round === 0 ? "First try" : "Rewrite"}</h3>${notes}${writer ? `<p class="small">${escapeHtml(writer)}</p>` : ""}`
        + `${questions}${attempt.questions.length ? verdicts : ""}</div>`;
    }).join("");
    parts.push(`<section><h2>Piece ${index + 1}: ${escapeHtml(pieceStatus(piece))}</h2>${quoteHtml}${tries || "<p class=\"small\">No question was written for it.</p>"}</section>`);
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${rules === 3 ? "Journal pieces marked as not understood" : "Journal pieces not confirmed"}</title>
<style>
  :root { --ink: #1d2422; --muted: #5a6662; --ground: #f5f7f6; --panel: #ffffff; --rule: #d6dfdb; --ok: #2f6b3a; --held: #8a3b12; --tag: #e7eeeb; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e3ebe8; --muted: #9fb1ab; --ground: #101614; --panel: #18211e; --rule: #2c3a35; --ok: #8fcf9b; --held: #f0a46c; --tag: #22302b; } }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px 16px 64px; }
  main { max-width: 46rem; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
  h1 { font-size: 1.6rem; margin: 0; } h2 { font-size: 1.1rem; margin: 0 0 10px; } h3 { font-size: 0.95rem; margin: 14px 0 6px; color: var(--muted); }
  section, .intro { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 16px; }
  blockquote { margin: 6px 0 0; padding: 10px 12px; border-left: 3px solid var(--rule); white-space: pre-wrap; overflow-wrap: anywhere; }
  figure { margin: 0 0 10px; } figcaption { font-size: 0.8rem; color: var(--muted); }
  .questions { margin: 6px 0; padding-left: 1.4rem; } .questions li { margin: 3px 0; overflow-wrap: anywhere; }
  .q { font-weight: 700; } .tag { font-size: 0.75rem; background: var(--tag); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .tag.warn { color: var(--held); } .verdict ul { margin: 6px 0; padding-left: 1.2rem; }
  .ok { color: var(--ok); } .held { color: var(--held); } .held strong, .ok strong { color: var(--ink); }
  .note { color: var(--ink); font-size: 0.92rem; margin-top: 2px; overflow-wrap: anywhere; } .muted, .small { color: var(--muted); font-size: 0.9rem; }
  dl { margin: 8px 0 0; } dt { font-weight: 700; } dd { margin: 0 0 6px; color: var(--muted); }
</style>
</head>
<body>
<main>
<div class="intro">
<h1>${title}</h1>
<p>Run ${escapeHtml(runId ?? "")}, written ${escapeHtml(generatedAt ?? "")}. Of the ${escapeHtml(collected.sampled)} pieces in the sample, ${escapeHtml(collected.pieces.length)} didn't get their questions confirmed, and all of them are below. ${rules === 3
  ? "For each one: the passage, the questions the writer asked, and what Codex, this run's one judge, decided. Any way of splitting a passage into questions is fine, so a piece's questions are confirmed when Codex finds every one of its quotes covered. A piece still not covered after its rewrite, or whose judge gave no usable answer, is marked as not understood: it keeps its questions and is searched and measured like any other."
  : "For each one: the passage, the questions the writer asked, and what each judge decided. A piece's questions are confirmed only when both judges confirm every one of its quotes and no question copies its passage's words."}</p>
<dl>
<dt>Something left out</dt><dd>The judge says the questions miss something the passage says; its note says what.</dd>
${rules === 3 ? "" : `<dt>Repeated</dt><dd>A question asks again about something another question already covers, often a detail asked on its own.</dd>
<dt>Two things in one</dt><dd>One question asks about two separate things.</dd>
`}<dt>Copies the passage's words</dt><dd>The question repeats a run of the passage's own words. ${collected.copy_run_words === null ? "In this run the judges' flag held a quote back."
  : rules === 3 ? `Code checks this (${escapeHtml(collected.copy_run_words)} words in a row): the question is flagged and left out of the recall measure, and holds nothing back.`
    : `Code checks this (${escapeHtml(collected.copy_run_words)} words in a row); a judge's flag decides nothing.`}</dd>
</dl>
<p class="small">This file holds journal text. It's for you to read on this computer; please don't upload or share it.</p>
</div>
${parts.join("\n")}
</main>
</body>
</html>
`;
}
