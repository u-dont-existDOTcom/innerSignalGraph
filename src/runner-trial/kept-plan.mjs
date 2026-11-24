import { ValidationError } from "../core/errors.mjs";
import { foldWhitespace } from "./program-checks.mjs";

// The plan kept for next time (docs/superpowers/specs/2026-11-21-runner-trial-design.md, section 9; the owner's 5b, question i62),
// behind INNER_SIGNAL_RUNNER_KEPT_PLAN. The rules here decide only exact things from stored records: what the readers and the
// crisis checker read, what the writer declared, whether a line is word for word in an earlier reply, and dates. The runtime uses
// them to decide what goes into a packet, and the encrypted store applies the same ones again before it keeps anything, so no
// caller can keep a plan the rules don't allow.

export const KEPT_PLAN_DAYS = 30;
export const KEPT_PLAN_LIFETIME_MS = KEPT_PLAN_DAYS * 24 * 60 * 60 * 1000;
export const KEPT_PLAN_LIMITS = Object.freeze({ lines: 12, lineCharacters: 1_000, plans: 500 });
// Why a kept plan was deleted: 30 days passed, the person asked in the conversation or with the page's button, or a newer plan
// was kept in its place (one plan is kept at a time).
export const KEPT_PLAN_DELETION_REASONS = Object.freeze(["expired", "asked_in_conversation", "deleted_on_page", "replaced"]);

const ID = /^[A-Za-z0-9:_-]{1,200}$/u;
const PLAN_FIELDS = Object.freeze(["conversation_id", "deleted_at", "deletion_reason", "id", "kept_at", "lines", "runtime_turn_id", "schema_version"]);
const invalid = (message) => new ValidationError(message);
const timestamp = (value) => typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value));

// A refusal of the store, in fixed words: the reason is a code, never case text.
export function keptPlanRefusal(reason) {
  return new ValidationError("The kept plan's rules don't allow keeping a plan here.", { code: "RUNNER_KEPT_PLAN_REFUSED", details: { reason } });
}

// The crisis reader's reading of a turn, when it gave one (not the stand-in stored when it gave none).
export function crisisReadingOf(turn) {
  const crisis = turn?.runner_reading?.readers?.crisis;
  return crisis && typeof crisis === "object" && crisis.unread !== true ? crisis : null;
}

// Never offered, kept or shown: any stored crisis reading in the case, of any turn in any conversation, says the person may be
// under 18 or home isn't safe. Any value but an absent or false one counts, so a malformed reading refuses rather than allows.
export function keptPlanNeverAllowed(record) {
  return (record?.runtime_turns ?? []).some((turn) => {
    const crisis = turn.runner_reading?.readers?.crisis;
    return Boolean(crisis?.may_be_under_18) || Boolean(crisis?.home_unsafe);
  });
}

const conversationOf = (turn) => turn?.runner_reading?.conversation_id ?? null;

// The turns stored before this one in its conversation, in order.
export function earlierTurnsInConversation(record, turn) {
  const conversationId = conversationOf(turn);
  if (!conversationId) return [];
  const index = record.runtime_turns.findIndex((entry) => entry.id === turn.id);
  return record.runtime_turns.slice(0, index < 0 ? record.runtime_turns.length : index).filter((entry) => conversationOf(entry) === conversationId);
}

// What the writer returned for the exact reply a turn delivered, from the turn's own completed writer call.
export function deliveredWriterResult(turn) {
  if (turn?.state !== "DELIVERED" || turn.delivery?.kind !== "candidate") return null;
  const event = [...turn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED" && ["candidate", "repair"].includes(entry.stage)
    && entry.details?.output?.exactText === turn.delivery.exact_text);
  return event?.details?.output?.result ?? null;
}

// The reply a turn delivered offered to keep the plan: the program gave the writer leave to offer before it wrote (stored with
// the turn's readings, once per conversation), and the writer declared that the reply it sent holds the offer.
export function offeredToKeepPlan(turn) {
  return turn?.runner_reading?.readers?.kept_plan_offer?.may_offer === true && deliveredWriterResult(turn)?.keptPlan?.offered === true;
}

// The reply a turn delivered reached the plan for the next hours (step 5 of the crisis replies): the writer said so of the reply
// it sent, or the crisis checker (the whole checker in its arm) said so on the audit of that exact reply.
export function planReachedOn(turn) {
  const written = deliveredWriterResult(turn);
  if (!written) return false;
  if (written.keptPlan?.planReached === true) return true;
  return (turn.runner_reading?.checker_levels ?? []).some((entry) => entry.plan_reached === true && entry.candidate_id === turn.delivery.candidate_id);
}

// The crisis checker confirmed on an audit of this turn that the person's latest message says yes to keeping the plan.
export const keepPlanYesConfirmed = (turn) => (turn?.runner_reading?.checker_levels ?? []).some((entry) => entry.confirms_keep_plan_yes === true);

// Whether this turn may keep a plan (design, section 9), and whether the crisis checker must confirm the yes first:
// - never without the crisis reader's reading of this turn, and never when the case's readings rule it out;
// - only when the crisis reader read that the person asks to keep the plan (or says yes to the offer);
// - when the reply just before offered to keep it, the yes counts only once the crisis checker confirms it.
export function keepPlanBasis(record, turn) {
  const crisis = crisisReadingOf(turn);
  if (!crisis) return Object.freeze({ allowed: false, reason: "no_reading" });
  if (keptPlanNeverAllowed(record)) return Object.freeze({ allowed: false, reason: "never" });
  if (crisis.asks_to_keep_plan !== true) return Object.freeze({ allowed: false, reason: "not_asked" });
  const previous = earlierTurnsInConversation(record, turn).at(-1) ?? null;
  return Object.freeze({ allowed: true, needsConfirmation: offeredToKeepPlan(previous) });
}

// The replies a kept plan's lines may come from: what InnerSignal delivered in this conversation before this turn.
export function earlierRepliesInConversation(record, turn) {
  return earlierTurnsInConversation(record, turn).map((entry) => (entry.state === "DELIVERED" && entry.delivery?.kind === "candidate" ? entry.delivery.exact_text : null)).filter((text) => typeof text === "string");
}

// The lines the writer returned that are word for word (whitespace folded) in one of those replies, once each, in order, at most
// KEPT_PLAN_LIMITS.lines. A line that isn't found anywhere is dropped.
export function keptPlanLinesFound(lines, replies) {
  const folded = replies.map(foldWhitespace);
  const found = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (typeof line !== "string") continue;
    const text = foldWhitespace(line);
    if (!text || text.length > KEPT_PLAN_LIMITS.lineCharacters || found.includes(text)) continue;
    if (folded.some((reply) => reply.includes(text))) found.push(text);
    if (found.length === KEPT_PLAN_LIMITS.lines) break;
  }
  return found;
}

export const keptPlanExpired = (plan, nowMs) => plan?.deleted_at == null && Date.parse(plan.kept_at) + KEPT_PLAN_LIFETIME_MS <= nowMs;

// The plan that is kept now (one at a time): not deleted and not past its 30 days.
export function currentKeptPlan(record, nowMs) {
  return [...(record?.runner_kept_plans ?? [])].reverse().find((plan) => plan.deleted_at == null && !keptPlanExpired(plan, nowMs)) ?? null;
}

export function hasExpiredKeptPlan(record, nowMs) {
  return (record?.runner_kept_plans ?? []).some((plan) => keptPlanExpired(plan, nowMs));
}

// A deleted plan keeps only when it was kept and when and why it was deleted: its lines are removed from the record.
export function markKeptPlanDeleted(plan, reason, at) {
  if (!KEPT_PLAN_DELETION_REASONS.includes(reason)) throw invalid("The kept plan's deletion reason is invalid.");
  plan.lines = [];
  plan.deleted_at = at;
  plan.deletion_reason = reason;
  return plan;
}

function validateKeptPlan(plan, index) {
  const name = `runner_kept_plans[${index}]`;
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(PLAN_FIELDS)) throw invalid(`${name} is invalid.`);
  if (plan.schema_version !== 1) throw invalid(`${name} version is invalid.`);
  for (const field of ["id", "conversation_id", "runtime_turn_id"]) if (typeof plan[field] !== "string" || !ID.test(plan[field])) throw invalid(`${name}.${field} is invalid.`);
  if (!timestamp(plan.kept_at)) throw invalid(`${name}.kept_at is invalid.`);
  if (plan.deleted_at == null) {
    if (plan.deletion_reason !== null || plan.deleted_at !== null) throw invalid(`${name} deletion is invalid.`);
    if (!Array.isArray(plan.lines) || plan.lines.length === 0 || plan.lines.length > KEPT_PLAN_LIMITS.lines
        || plan.lines.some((line) => typeof line !== "string" || !line || line.length > KEPT_PLAN_LIMITS.lineCharacters || foldWhitespace(line) !== line)) {
      throw invalid(`${name}.lines is invalid.`);
    }
  } else if (!timestamp(plan.deleted_at) || !KEPT_PLAN_DELETION_REASONS.includes(plan.deletion_reason) || !Array.isArray(plan.lines) || plan.lines.length !== 0) {
    throw invalid(`${name} deletion is invalid: a deleted plan keeps no lines.`);
  }
  return plan;
}

// The record's kept plans, when it has any (a case never offered one has no such field). Each names a turn of the case, at most one
// is kept at a time, and a deleted one holds no lines.
export function validateKeptPlans(value, record) {
  if (!Array.isArray(value) || value.length > KEPT_PLAN_LIMITS.plans) throw invalid("runner_kept_plans exceeds its limit or is invalid.");
  const turnIds = new Set((record?.runtime_turns ?? []).map((turn) => turn.id));
  const ids = new Set();
  const turns = new Set();
  value.forEach((plan, index) => {
    validateKeptPlan(plan, index);
    if (ids.has(plan.id) || turns.has(plan.runtime_turn_id)) throw invalid("A kept plan is listed twice.");
    if (!turnIds.has(plan.runtime_turn_id)) throw invalid("A kept plan names a turn the case doesn't hold.");
    ids.add(plan.id);
    turns.add(plan.runtime_turn_id);
  });
  if (value.filter((plan) => plan.deleted_at == null).length > 1) throw invalid("At most one plan is kept at a time.");
  return value;
}

// Kept plans are append-only: none is removed or reordered, what was kept and when never changes, and the only change a kept plan
// takes is its deletion (lines removed, the date and reason kept), after which it never changes again.
export function assertKeptPlansAppendOnly(previous = [], next = []) {
  const before = previous ?? [];
  const after = next ?? [];
  if (after.length < before.length) throw invalid("Kept plans are append-only.");
  before.forEach((plan, index) => {
    const later = after[index];
    if (!later || ["schema_version", "id", "conversation_id", "runtime_turn_id", "kept_at"].some((field) => JSON.stringify(plan[field]) !== JSON.stringify(later[field]))) {
      throw invalid("A kept plan's identity is immutable.");
    }
    if (plan.deleted_at != null) {
      if (JSON.stringify(plan) !== JSON.stringify(later)) throw invalid("A deleted kept plan is immutable.");
    } else if (later.deleted_at == null && JSON.stringify(plan.lines) !== JSON.stringify(later.lines)) {
      throw invalid("A kept plan's lines change only by its deletion.");
    }
  });
}
