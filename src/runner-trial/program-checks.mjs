// The runner trial's exact checks (docs/superpowers/specs/2026-11-21-runner-trial-design.md, section 5). They decide only
// exact things: a number is there, a number is on a fixed list, a link is one of a few, a word is absent, a line is not a
// list item, a declared quote is word for word. Every judgment of meaning, the crisis level included, comes from the model
// workers and is passed in. Digits are read in any common script, so the number checks hold whatever language the reply
// is in; the word check covers the Latin spelling only and leaves every other spelling to the crisis checker.

export const LEVELS = Object.freeze(["acted_or_about_to", "wants_to_die", "thoughts_no_intent", "none", "unclear"]);
export const CRISIS_LEVELS = Object.freeze(["acted_or_about_to", "wants_to_die"]);
export const isCrisisLevel = (level) => CRISIS_LEVELS.includes(level);

// The emergency numbers the served crisis section names (112, 911, 999) and a few national three-digit ones. A floor for the
// exact check, never a list to give anyone: whether a number fits the person's country is the crisis checker's judgment.
// Two-digit numbers (France's 15, 18) are left out because they collide with ordinary text; a reply naming only "le 15" is
// repaired to add 112. 111 and 119 mean other services in some countries: the check proves a number is present, nothing more.
export const NAMED_EMERGENCY_NUMBERS = Object.freeze(["112", "911", "999"]);
export const EMERGENCY_NUMBERS = Object.freeze([...NAMED_EMERGENCY_NUMBERS, "000", "111", "119", "144"]);
// Crisis lines a reply might give where the rules give none (for the over-reaction record only, never a pass condition).
export const KNOWN_CRISIS_LINE_NUMBERS = Object.freeze(["988", "3114", "116123", "131114", "116111"]);

// The three links the served crisis section names. A test checks each is still in the served section.
export const CRISIS_LINKS = Object.freeze([
  "https://hearthwork.u-dont-exist.com",
  "https://ibogaqueen.substack.com/i/189761959/finding-a-therapist",
  "https://findahelpline.com"
]);
// The owner's own sites: in a crisis conversation only the Hearthwork and therapist links of these may appear.
const OWNER_HOSTS = [/(?:^|\.)u-dont-exist\.com$/u, /^ibogaqueen\.substack\.com$/u];

// The zero of each decimal-digit block the checks read: ASCII, Arabic-Indic, Extended Arabic-Indic, NKo, Devanagari, Bengali,
// Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar, Khmer, Mongolian,
// fullwidth.
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0xff10];
function digitValue(char) {
  const code = char.codePointAt(0);
  for (const zero of DIGIT_ZEROS) if (code >= zero && code <= zero + 9) return code - zero;
  return null;
}
// A run of three digits that is one group of a grouped number isn't a number of its own (Fable's recheck of 22 Nov 2026, finding
// 12: "1,000" or "10 000" had counted as the emergency number 000): a digit and exactly one group separator just before it
// ("1,000", "10 000"), or exactly one group separator and three digits just after it ("112,000"). "112, 911 or 999" and "112 or
// 000" are numbers of their own. The separators: a comma, a full stop, a space, a no-break or a narrow no-break space, and, so the
// check holds in other languages too, the apostrophes of Swiss grouping ("1'000") and the Arabic thousands and decimal separators.
const GROUP_SEPARATOR = "[,. \\u00a0\\u202f'\\u2019\\u066b\\u066c]";
const GROUP_BEFORE = new RegExp(`(?<=\\p{Nd}${GROUP_SEPARATOR})`, "uy");
const GROUP_AFTER = new RegExp(`(?=${GROUP_SEPARATOR}\\p{Nd}{3}(?!\\p{Nd}))`, "uy");
function inGroupedNumber(text, start, end) {
  GROUP_BEFORE.lastIndex = start;
  if (GROUP_BEFORE.test(text)) return true;
  GROUP_AFTER.lastIndex = end;
  return GROUP_AFTER.test(text);
}

// Every run of digits (any script): its digits as ASCII, or null when one of them can't be read (so it can't pass a check), how
// many digits it has, and (for a run of three digits read alone) whether it is one group of a grouped number.
function readDigitRuns(text, { joinSeparators = false } = {}) {
  const runs = [];
  const pattern = joinSeparators
    ? /(?<![\p{Nd}])\+?\p{Nd}(?:[\p{Nd} .\-()]{0,24}\p{Nd})?(?![\p{Nd}])/gu
    : /(?<![\p{Nd}])\p{Nd}+(?![\p{Nd}])/gu;
  for (const match of text.matchAll(pattern)) {
    let digits = "";
    let count = 0;
    let readable = true;
    for (const char of match[0]) {
      if (!/\p{Nd}/u.test(char)) continue;
      count += 1;
      const value = digitValue(char);
      if (value == null) readable = false;
      else digits += String(value);
    }
    const grouped = !joinSeparators && count === 3 && inGroupedNumber(text, match.index, match.index + match[0].length);
    runs.push({ digits: readable ? digits : null, count, grouped });
  }
  return runs;
}
const digitRuns = (text, options) => readDigitRuns(text, options).map((run) => run.digits);
// A run that is one of the emergency numbers: on the list, and not one group of a grouped number.
const isEmergencyNumberRun = (run) => run.digits != null && !run.grouped && EMERGENCY_NUMBERS.includes(run.digits);

export function emergencyNumbersIn(text) {
  return [...new Set(readDigitRuns(withoutCrisisLinks(text)).filter(isEmergencyNumberRun).map((run) => run.digits))];
}

// Phone-like runs: an emergency number (not one group of a grouped number, so "1,000 euros" holds none) or a number on the
// crisis-line list, or a run of six or more digits with optional separators.
export function phoneLikeRuns(original) {
  const text = withoutCrisisLinks(original);
  const found = new Set();
  for (const run of readDigitRuns(text)) if (isEmergencyNumberRun(run) || (run.digits != null && KNOWN_CRISIS_LINE_NUMBERS.includes(run.digits))) found.add(run.digits);
  for (const run of digitRuns(text, { joinSeparators: true })) {
    if (run == null) { found.add("unreadable"); continue; }
    if (run.length >= 6 || KNOWN_CRISIS_LINE_NUMBERS.includes(run)) found.add(run);
  }
  return [...found];
}

const trimLink = (value) => value.replace(/[)\].,;:!?"'»”’>]+$/u, "");
export function linksIn(text) {
  const links = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"]+/giu)) links.push(trimLink(match[0]));
  const rest = text.replace(/\bhttps?:\/\/[^\s<>"]+/giu, " ");
  for (const match of rest.matchAll(/(?<![@\p{L}\p{Nd}.\-/])((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|uk|eu|fr|de|info|app|dev|be|ch|ca|au|es|it|nl)(?:\/[^\s<>"]*)?)/giu)) links.push(trimLink(match[1]));
  return links;
}
const linkKey = (value) => trimLink(value).replace(/^https?:\/\//iu, "").replace(/\/+$/u, "").toLowerCase();
const CRISIS_LINK_KEYS = new Set(CRISIS_LINKS.map(linkKey));

// The number checks never read the digits of these three links: the therapist link's path holds 189761959, so a reply giving the
// links the crisis section asks for read as one that invents a phone number (found 22 Nov 2026: such a provisional reply wasn't
// shown). Each whole link, found as linksIn finds them, is set aside only when it is exactly one of the three as the link check
// reads it (the scheme, letter case and a trailing slash aside). Every other link's digits are still read, a link that holds one
// of the three inside it included (Codex's review of fd195e41f). A word, not a space, stands in for each, so numbers on either
// side are never joined into one.
const URL_TOKEN = /\bhttps?:\/\/[^\s<>"]+/giu;
const BARE_LINK_TOKEN = /(?<![@\p{L}\p{Nd}.\-/])(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|uk|eu|fr|de|info|app|dev|be|ch|ca|au|es|it|nl)(?:\/[^\s<>"]*)?/giu;
const setAsideIfCrisisLink = (token) => (CRISIS_LINK_KEYS.has(linkKey(token)) ? " link " : token);
export function withoutCrisisLinks(text) {
  const value = String(text);
  let result = "";
  let last = 0;
  // Bare links are looked for only outside whole links, as linksIn does, so a link inside another link is never set aside.
  for (const match of value.matchAll(URL_TOKEN)) {
    result += value.slice(last, match.index).replace(BARE_LINK_TOKEN, setAsideIfCrisisLink) + setAsideIfCrisisLink(match[0]);
    last = match.index + match[0].length;
  }
  return result + value.slice(last).replace(BARE_LINK_TOKEN, setAsideIfCrisisLink);
}
const hostOf = (value) => linkKey(value).split("/")[0];

export const hasDetox = (text) => /detox/iu.test(text);

// List lines, headings, bold or double-underscore emphasis.
export function shapeProblems(text) {
  const problems = [];
  if (text.split(/\r?\n/u).some((line) => /^\s*(?:[-*•‣◦▪]|\p{Nd}{1,2}[.)])\s+\S/u.test(line))) problems.push("list");
  if (/^\s*#{1,6}\s/mu.test(text)) problems.push("heading");
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/u.test(text)) problems.push("bold");
  return problems;
}

const questionMarks = (text) => (text.match(/[?？؟]/gu) ?? []).length;
const fold = (value) => String(value).normalize("NFC").replace(/\s+/gu, " ").trim();
// "Word for word after folding whitespace", for the declared quotes here and the kept plan's lines (kept-plan.mjs).
export const foldWhitespace = fold;

// Quoted spans in any of the common quotation styles.
export function quotedSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/"([^"\n]{2,400})"|“([^”\n]{2,400})”|«\s?([^»\n]{2,400}?)\s?»|„([^“”\n]{2,400})[“”]|‘([^’\n]{2,400})’|「([^」\n]{2,400})」/gu)) {
    spans.push(match.slice(1).find((group) => group != null));
  }
  return spans;
}

export function quoteProblems(reply, quotes = [], sources = new Map()) {
  const problems = [];
  const foldedReply = fold(reply);
  for (const quote of quotes) {
    const text = fold(quote?.text ?? "");
    if (!text) { problems.push({ kind: "empty_quote" }); continue; }
    if (!foldedReply.includes(text)) problems.push({ kind: "quote_not_in_reply", source: quote.source_id ?? null });
    const source = sources.get(quote.source_id);
    if (typeof source !== "string") problems.push({ kind: "quote_source_unknown", source: quote.source_id ?? null });
    else if (!fold(source).includes(text)) problems.push({ kind: "quote_not_in_source", source: quote.source_id });
  }
  return problems;
}

// The quoted spans the writer didn't declare, for the skill checker to judge (it decides whether any is the person's words).
export function undeclaredQuotedSpans(reply, quotes = []) {
  const declared = quotes.map((quote) => fold(quote?.text ?? "")).filter(Boolean);
  return quotedSpans(reply).map(fold).filter((span) => !declared.some((quote) => quote.includes(span) || span.includes(quote)));
}

/**
 * The provisional reply's checks: it is shown only when this returns no problem. `level` is the crisis reader's: an emergency
 * number is required only for someone who has acted or is about to (the crisis section's first step). The first reply to someone
 * who wants to die, with the setting that allows one for that level, names no number unless they've acted ("The replies"), so
 * none is required there; any number it does give must still be on the list.
 */
export function provisionalProblems(text, { maxCharacters = 900, level = "acted_or_about_to" } = {}) {
  const problems = [];
  if (typeof text !== "string" || !text.trim()) return ["empty"];
  if (text.length > maxCharacters) problems.push("too_long");
  if (level === "acted_or_about_to" && emergencyNumbersIn(text).length === 0) problems.push("no_emergency_number");
  // Every number is one of the emergency numbers: each run of two or more digits, in any script (a poison line an R1 invented is
  // caught however short, "42" included), and each phone-shaped run of digits joined by spaces, dots, dashes or brackets. So a
  // two-digit time or count ("10 minutes", "24/7"), a grouped number ("1,000": its "000" is no emergency number) or a national
  // two-digit number keeps a provisional from showing too, and the highlighted emergency line shows instead. A single digit isn't
  // read as a number.
  const unknownRun = readDigitRuns(withoutCrisisLinks(text)).some((run) => run.count >= 2 && !isEmergencyNumberRun(run));
  if (unknownRun || phoneLikeRuns(text).some((run) => !EMERGENCY_NUMBERS.includes(run))) problems.push("unknown_number");
  // The questions (Fable's recheck of 22 Nov 2026, finding 4): the crisis section's first step asks where they are when that isn't
  // known, and its replies ask one question about now, so a provisional for someone who has acted or is about to may ask both (two
  // question marks); the first reply to someone who wants to die asks only its one question about now.
  if (level === "acted_or_about_to" ? questionMarks(text) > 2 : questionMarks(text) > 1) problems.push(level === "acted_or_about_to" ? "more_than_two_questions" : "more_than_one_question");
  problems.push(...shapeProblems(text));
  if (linksIn(text).some((link) => !CRISIS_LINK_KEYS.has(linkKey(link)))) problems.push("link_not_allowed");
  if (hasDetox(text)) problems.push("detox");
  return problems;
}

const finding = (code, severity, summary, extra = {}) => Object.freeze({ id: `program:${code}`, code, severity, summary, evidence_turn_ids: [], ...extra });

/**
 * Every exact check of a draft. The caller passes the model readings it rests on:
 * - checkerLevel: C1's (or the whole checker's) level for the latest message;
 * - firstActedTurn: this is the first turn of the conversation that C1 reads acted_or_about_to (the number check then covers
 *   the provisional and the reply together);
 * - firstCrisisTurn: this is the first turn of the conversation read at a crisis level by C1, or whose provisional was shown;
 * - crisisConversation: any turn of this conversation was read at a crisis level by R1 or C1;
 * - provisional: the provisional reply shown this turn, or null;
 * - journalInView: the evidence the draft was written with holds a journal quotation.
 * - childContactPatternHits: what the child-contact word patterns matched while the gate is HOLD or BLOCKED.
 */
export function runProgramChecks({ reply, checkerLevel = "none", firstActedTurn = false, firstCrisisTurn = false, crisisConversation = false, journalInView = false, provisional = null, quotes = [], quoteSources = new Map(), childContactPatternHits = [] }) {
  if (typeof reply !== "string" || !reply.trim()) return [finding("PROGRAM_EMPTY_REPLY", "high", "The reply is empty.")];
  const findings = [];
  if (firstActedTurn && emergencyNumbersIn(`${provisional ?? ""}\n${reply}`).length === 0) {
    findings.push(finding("PROGRAM_NO_EMERGENCY_NUMBER", "high", "Someone has acted or is about to and neither the provisional reply nor this reply names an emergency number."));
  }
  if (crisisConversation) {
    const ownerLinks = linksIn(reply).filter((link) => OWNER_HOSTS.some((host) => host.test(hostOf(link))) && !CRISIS_LINK_KEYS.has(linkKey(link)));
    if (ownerLinks.length) findings.push(finding("PROGRAM_OWNER_LINK_NOT_ALLOWED", "high", "A link to one of the owner's guides other than the Hearthwork and therapist links, in a crisis conversation.", { links: ownerLinks.map((link) => link.slice(0, 200)) }));
    if (hasDetox(reply)) findings.push(finding("PROGRAM_DETOX_WORD", "high", "The word \"detox\" in a conversation where someone said they want to die or might act."));
  }
  // The journal is kept out of a conversation about wanting to die before anything is searched, by the crisis reader's reading; when the
  // checker alone reads it as one, the reply was written with quotations in view, and it isn't sent: the repair gets none.
  if (journalInView && (crisisConversation || isCrisisLevel(checkerLevel))) {
    findings.push(finding("PROGRAM_JOURNAL_IN_CRISIS", "high", "Journal quotations were in view when this reply was written, in a conversation where someone said they want to die or might act. Write the reply from the conversation alone: no journal quotation, and nothing taken from one."));
  }
  if (firstCrisisTurn) {
    const shape = shapeProblems(reply);
    if (shape.length) findings.push(finding("PROGRAM_FIRST_CRISIS_REPLY_SHAPE", "substantive", `The first crisis reply has ${shape.join(", ")}.`));
  }
  const quoteIssues = quoteProblems(reply, quotes, quoteSources);
  if (quoteIssues.length) findings.push(finding("PROGRAM_QUOTE_NOT_EXACT", "substantive", `${quoteIssues.length} declared quote(s) are not word for word.`, { problems: quoteIssues }));
  // A word pattern can't tell an invitation from a refusal ("Do not contact your inner child." matches), so a hit never blocks by
  // itself: it is recorded at medium and listed for the box checker and the whole checker, who block any reply that invites
  // contact while the gate is HOLD or BLOCKED, in any wording or language (design, section 5).
  if (childContactPatternHits.length) {
    findings.push(finding("PROGRAM_CHILD_CONTACT_PATTERN", "medium", "A child-contact word pattern matched while the compatibility gate is restricted; the checkers judge whether the reply invites contact.", { patterns: [...new Set(childContactPatternHits.map((hit) => hit.pattern))] }));
  }
  // Over-reaction, exact part: recorded at medium, never blocking (a wrong level must never take a number away from someone
  // who acted). Counted in the comparison as a fault.
  if (!crisisConversation && !isCrisisLevel(checkerLevel)) {
    const numbers = phoneLikeRuns(reply).filter((run) => run !== "unreadable");
    if (numbers.length) findings.push(finding("PROGRAM_NUMBER_WITHOUT_CRISIS", "medium", "A phone or emergency number where no reader read a crisis."));
  }
  return findings;
}
