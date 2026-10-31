// The owner-approved Inner Child guide refinements of issue 215 (31 October 2026), written exactly as they stand in the guide:
// the issue's approved wording with typographic apostrophes. They were made inside r9 itself (no r10), so reversing them gives the
// question 51 revision of r9 back byte for byte. Tests use this one copy so the approved bytes are written down once.

// Edit 1: a new paragraph in "The Parent You Inherited", right after the paragraph that ends with this sentence.
export const PARENT_ANCHOR = "No wonder the inner child doesn’t immediately answer when a new adult voice appears and says, “Trust me.”";
export const CRITICAL_VOICE = "A critical voice may be replaying something you learned from a parent, trying to protect you from rejection or failure, pointing to a real problem in a cruel way, or doing several of these at once. You don’t have to settle which one it is before protecting yourself. You can reject the insult, take seriously anything useful in the message, and ask what the voice is afraid of or trying to accomplish, if that helps. Understanding where the criticism comes from doesn’t mean agreeing with it or allowing it to keep attacking you.";

// Edit 2: in "Two Common Protective Patterns", the unconditional "inner critic" in the list of proactive protection becomes a qualified one.
export const GUARD_OLD = "the skeptic, intellectualizer, inner critic, or voice watching for weakness and self-indulgence.";
export const GUARD_NEW = "the skeptic, intellectualizer, a self-critical strategy that is trying to prevent a feared outcome, or voice watching for weakness and self-indulgence.";
export const GUARD_PHRASE = "a self-critical strategy that is trying to prevent a feared outcome";

// Edit 3: one short optional practice under "Simple Practices", directly after "Journal With Each Hand" and before the next heading.
export const JOURNAL_ANCHOR = "Don’t demand the child before the guard has spoken.";
// The heading was chosen in this change: issue 215 gave the practice's wording but no heading, so the owner may rename it.
export const DRAWING_HEADING = "Draw or Scribble the Anger";
export const DRAWING = "If anger is hard to put into words, try drawing or scribbling how it feels. You don’t need to make anything recognizable. When you’re finished, notice whether something has become clearer: a feeling, an unmet need, a boundary, or something you’d like the adult in you to do. The drawing doesn’t have to reveal a hidden memory or produce emotional release to be useful.";
export const NEXT_HEADING = "“And So That’s the Way It Happened!”";

// The question 51 revision of r9 (before issue 215) and the revision as it stands now.
export const QUESTION_51_R9_SHA256 = "266af0240da3091552438fb89b10f73186d2718d28c35675e0527d763c453404";
export const CURRENT_R9_SHA256 = "0e27b0e92e520d5300c9a7f778c08cfbae48013614693d2f3a330c1e18781ccb";

const once = (text, part, label) => {
  const found = text.split(part).length - 1;
  if (found !== 1) throw new Error(`${label}: expected exactly one match, found ${found}`);
};

// r9 as it stood after question 51 -> r9 as it stands now.
export function withIssue215(text) {
  once(text, `${PARENT_ANCHOR}\n\n`, "parent anchor");
  once(text, GUARD_OLD, "guard example");
  once(text, `${JOURNAL_ANCHOR}\n\n${NEXT_HEADING}\n`, "journal anchor");
  return text
    .replace(`${PARENT_ANCHOR}\n\n`, () => `${PARENT_ANCHOR}\n\n${CRITICAL_VOICE}\n\n`)
    .replace(GUARD_OLD, () => GUARD_NEW)
    .replace(`${JOURNAL_ANCHOR}\n\n${NEXT_HEADING}\n`, () => `${JOURNAL_ANCHOR}\n\n${DRAWING_HEADING}\n\n${DRAWING}\n\n${NEXT_HEADING}\n`);
}

// r9 as it stands now -> r9 as it stood after question 51.
export function withoutIssue215(text) {
  once(text, `${PARENT_ANCHOR}\n\n${CRITICAL_VOICE}\n\n`, "critical-voice paragraph");
  once(text, GUARD_NEW, "qualified guard example");
  once(text, `${JOURNAL_ANCHOR}\n\n${DRAWING_HEADING}\n\n${DRAWING}\n\n${NEXT_HEADING}\n`, "drawing practice");
  return text
    .replace(`${PARENT_ANCHOR}\n\n${CRITICAL_VOICE}\n\n`, () => `${PARENT_ANCHOR}\n\n`)
    .replace(GUARD_NEW, () => GUARD_OLD)
    .replace(`${JOURNAL_ANCHOR}\n\n${DRAWING_HEADING}\n\n${DRAWING}\n\n${NEXT_HEADING}\n`, () => `${JOURNAL_ANCHOR}\n\n${NEXT_HEADING}\n`);
}
