import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { CASE_VARIABLE_ENUMS } from "../guide-graph/contract.mjs";
import { immediateProtectionNeeded } from "./turn-task.mjs";

// Owner decision 2026-09-26 (tasks/focus-discipline-20260926/OWNER-DECISIONS.json):
// ask what moves the current therapeutic focus forward, park side questions
// instead of discarding them, surface a parked one when the focus allows, judge
// side-ness by relevance rather than topic, and keep the session on point when
// the client drifts. This module is the deterministic part of that behavior; the
// models classify questions and focus strength, the runtime owns memory,
// pacing and the pile-up bound.
export const FOCUS_DISCIPLINE_VERSION = "focus-discipline-v1";
export const FOCUS_RELATIONS = Object.freeze(["advances_focus", "load_bearing", "side"]);
export const FOCUS_STRENGTHS = Object.freeze(["high", "moderate", "light"]);
export const CLIENT_DIVERSIONS = Object.freeze(["none", "tangent", "avoidance"]);
export const PARKED_THREAD_STATUSES = Object.freeze(["parked", "promoted", "resolved", "retired"]);
export const FOCUS_LIMITS = Object.freeze({
  // Above this many parked threads, an important one may surface even while the
  // focus is only moderately urgent, so important side questions cannot pile up.
  softActive: 4,
  // Never hold more parked threads than this; the least important are retired.
  hardActive: 6,
  storedThreads: 40,
  offerCooldownTurns: 3,
  maxOffers: 2,
  moderateSurfaceAgeTurns: 4,
  moderateSurfaceImportance: 4
});

const HOLDING_THREAT_LEVELS = new Set(["ESCALATING_MOBILIZING_RISK", "IMMINENT_OPERATIONAL_DANGER"]);

export const unknownFocusProperties = Object.freeze({
  focus_relation: { type: "string", enum: FOCUS_RELATIONS },
  why_it_matters: { type: "string" }
});

export const sessionFocusSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string" },
        strength: { type: "string", enum: FOCUS_STRENGTHS },
        natural_pause: { type: "boolean" },
        client_diversion: { type: "string", enum: CLIENT_DIVERSIONS },
        diversion_topic: { type: "string" }
      },
      required: ["target", "strength", "natural_pause", "client_diversion", "diversion_topic"]
    }
  ]
};

export const focusReclassificationsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      variable: { type: "string" },
      focus_relation: { type: "string", enum: FOCUS_RELATIONS },
      why_it_matters: { type: "string" },
      reason: { type: "string" }
    },
    required: ["variable", "focus_relation", "why_it_matters", "reason"]
  }
};

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function bounded(value, label, max, { empty = true } = {}) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new ValidationError(`${label} must be bounded text.`);
  return value;
}

export function validateUnknownFocus(item, label) {
  if (Object.hasOwn(item, "focus_relation") && !FOCUS_RELATIONS.includes(item.focus_relation)) throw new ValidationError(`${label}.focus_relation is invalid.`);
  if (Object.hasOwn(item, "why_it_matters")) bounded(item.why_it_matters, `${label}.why_it_matters`, 1200);
  return item;
}

export function validateSessionFocus(value, label = "caseSnapshot.session_focus") {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${label} must be null or an object.`);
  bounded(value.target, `${label}.target`, 400);
  if (!FOCUS_STRENGTHS.includes(value.strength)) throw new ValidationError(`${label}.strength is invalid.`);
  if (typeof value.natural_pause !== "boolean") throw new ValidationError(`${label}.natural_pause must be boolean.`);
  if (!CLIENT_DIVERSIONS.includes(value.client_diversion)) throw new ValidationError(`${label}.client_diversion is invalid.`);
  bounded(value.diversion_topic, `${label}.diversion_topic`, 400);
  return value;
}

export function validateFocusReclassifications(value, label = "caseAudit.focus_reclassifications") {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array.`);
  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ValidationError(`${label}[${index}] must be an object.`);
    bounded(item.variable, `${label}[${index}].variable`, 160, { empty: false });
    if (!FOCUS_RELATIONS.includes(item.focus_relation)) throw new ValidationError(`${label}[${index}].focus_relation is invalid.`);
    bounded(item.why_it_matters, `${label}[${index}].why_it_matters`, 1200);
    bounded(item.reason, `${label}[${index}].reason`, 1200);
  });
  return value;
}

function validateThread(thread, label) {
  if (!thread || typeof thread !== "object" || Array.isArray(thread)) throw new ValidationError(`${label} must be an object.`);
  bounded(thread.id, `${label}.id`, 120, { empty: false });
  bounded(thread.key, `${label}.key`, 400, { empty: false });
  bounded(thread.variable, `${label}.variable`, 160);
  bounded(thread.question, `${label}.question`, 1200, { empty: false });
  bounded(thread.why_it_matters, `${label}.why_it_matters`, 1200);
  bounded(thread.close_reason, `${label}.close_reason`, 80);
  if (!PARKED_THREAD_STATUSES.includes(thread.status)) throw new ValidationError(`${label}.status is invalid.`);
  if (!Number.isInteger(thread.importance) || thread.importance < 1 || thread.importance > 5) throw new ValidationError(`${label}.importance is invalid.`);
  for (const field of ["parked_turn", "offer_count"]) {
    if (!Number.isInteger(thread[field]) || thread[field] < 0) throw new ValidationError(`${label}.${field} is invalid.`);
  }
  for (const field of ["last_offered_turn", "closed_turn"]) {
    if (thread[field] !== null && (!Number.isInteger(thread[field]) || thread[field] < 0)) throw new ValidationError(`${label}.${field} is invalid.`);
  }
  return thread;
}

export function validateFocusState(value, label = "caseState.focus_discipline") {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${label} must be null or an object.`);
  if (value.version !== FOCUS_DISCIPLINE_VERSION) throw new ValidationError(`${label}.version is invalid.`);
  if (!Number.isInteger(value.turn_counter) || value.turn_counter < 0) throw new ValidationError(`${label}.turn_counter is invalid.`);
  if (value.focus !== null) {
    if (!value.focus || typeof value.focus !== "object") throw new ValidationError(`${label}.focus must be null or an object.`);
    bounded(value.focus.target, `${label}.focus.target`, 400);
    if (!FOCUS_STRENGTHS.includes(value.focus.strength)) throw new ValidationError(`${label}.focus.strength is invalid.`);
  }
  if (!Array.isArray(value.threads) || value.threads.length > FOCUS_LIMITS.storedThreads + FOCUS_LIMITS.hardActive) throw new ValidationError(`${label}.threads must be a bounded array.`);
  const ids = new Set();
  value.threads.forEach((thread, index) => {
    validateThread(thread, `${label}.threads[${index}]`);
    if (ids.has(thread.id)) throw new ValidationError(`Duplicate parked thread ${thread.id}.`);
    ids.add(thread.id);
  });
  if (value.threads.filter((thread) => thread.status === "parked").length > FOCUS_LIMITS.hardActive) throw new ValidationError(`${label} exceeds the parked-thread bound.`);
  return value;
}

// Unknowns without a declared relation (historical snapshots, mock fixtures)
// keep their previous behavior: they compete as ordinary frontal questions.
export function focusRelation(unknown) {
  return FOCUS_RELATIONS.includes(unknown?.focus_relation) ? unknown.focus_relation : "advances_focus";
}

function threadKey(unknown) {
  return clean(unknown?.variable, 160).toLowerCase() || clean(unknown?.question, 400).toLowerCase();
}

function threadId(key, turn) {
  return `thread-${createHash("sha256").update(key).digest("hex").slice(0, 16)}-${turn}`;
}

export function partitionUnknownsByFocus(unknowns = []) {
  const frontal = [];
  const side = [];
  for (const unknown of unknowns ?? []) (focusRelation(unknown) === "side" ? side : frontal).push(unknown);
  return { frontal, side };
}

export function applyFocusReclassifications(unknowns = [], reclassifications = []) {
  if (!reclassifications?.length) return unknowns;
  const byKey = new Map(reclassifications.map((item) => [clean(item.variable, 160).toLowerCase(), item]));
  return unknowns.map((unknown) => {
    const change = byKey.get(clean(unknown?.variable, 160).toLowerCase());
    return change ? { ...unknown, focus_relation: change.focus_relation, why_it_matters: change.why_it_matters } : unknown;
  });
}

export function focusDisciplineEngaged({ unknowns = [], sessionFocus = null, prior = null } = {}) {
  return Boolean(sessionFocus)
    || (unknowns ?? []).some((unknown) => unknown && Object.hasOwn(unknown, "focus_relation"))
    || (prior?.threads ?? []).some((thread) => thread.status === "parked");
}

function close(thread, turn, reason, status) {
  thread.status = status;
  thread.closed_turn = turn;
  thread.close_reason = reason;
}

// Pure pre-planning step: returns the questions the planner may pursue now and
// the updated parked-thread memory. Nothing is surfaced here.
export function prepareFocusDiscipline({ prior = null, unknowns = [], sessionFocus = null, variables = {} } = {}) {
  const priorState = prior ? validateFocusState(structuredClone(prior)) : null;
  if (!focusDisciplineEngaged({ unknowns, sessionFocus, prior: priorState })) return { engaged: false, frontalUnknowns: unknowns ?? [] };
  const focus = validateSessionFocus(sessionFocus ?? null);
  const turn = (priorState?.turn_counter ?? 0) + 1;
  const threads = structuredClone(priorState?.threads ?? []);
  const { frontal, side } = partitionUnknownsByFocus(unknowns);
  const frontalKeys = new Set(frontal.map(threadKey).filter(Boolean));

  for (const thread of threads.filter((item) => item.status === "parked")) {
    const variable = thread.variable;
    if (variable && Object.hasOwn(CASE_VARIABLE_ENUMS, variable) && (variables?.[variable] ?? "unknown") !== "unknown") close(thread, turn, "answered", "resolved");
    else if (frontalKeys.has(thread.key)) close(thread, turn, "became_frontal", "promoted");
  }

  const parkedThisTurn = [];
  for (const unknown of side) {
    const key = threadKey(unknown);
    if (!key) continue;
    const variable = clean(unknown.variable, 160);
    if (variable && Object.hasOwn(CASE_VARIABLE_ENUMS, variable) && (variables?.[variable] ?? "unknown") !== "unknown") continue;
    const importance = Number.isInteger(unknown.importance) ? Math.min(5, Math.max(1, unknown.importance)) : 3;
    const existing = threads.find((thread) => thread.status === "parked" && thread.key === key);
    if (existing) {
      existing.importance = Math.max(existing.importance, importance);
      existing.question = clean(unknown.question, 1200) || existing.question;
      existing.why_it_matters = clean(unknown.why_it_matters, 1200) || existing.why_it_matters;
      continue;
    }
    const question = clean(unknown.question, 1200);
    if (!question) continue;
    const thread = {
      id: threadId(key, turn), key, variable, question, importance,
      why_it_matters: clean(unknown.why_it_matters, 1200),
      status: "parked", parked_turn: turn, last_offered_turn: null, offer_count: 0, closed_turn: null, close_reason: ""
    };
    threads.push(thread);
    parkedThisTurn.push(thread.id);
  }

  // An offered side question the client did not take up is not re-offered forever.
  for (const thread of threads.filter((item) => item.status === "parked")) {
    if (thread.offer_count >= FOCUS_LIMITS.maxOffers && turn - thread.last_offered_turn >= FOCUS_LIMITS.offerCooldownTurns) close(thread, turn, "offered_not_taken", "retired");
  }
  // Hard bound: keep the most important and most recent side questions.
  const active = threads.filter((item) => item.status === "parked");
  if (active.length > FOCUS_LIMITS.hardActive) {
    const retire = [...active].sort((a, b) => a.importance - b.importance || a.parked_turn - b.parked_turn).slice(0, active.length - FOCUS_LIMITS.hardActive);
    for (const thread of retire) close(thread, turn, "capacity_lowest_value", "retired");
  }
  const terminal = threads.filter((item) => item.status !== "parked");
  const keptTerminal = new Set(terminal.slice(Math.max(0, terminal.length - FOCUS_LIMITS.storedThreads)).map((item) => item.id));
  const keptThreads = threads.filter((item) => item.status === "parked" || keptTerminal.has(item.id));

  return {
    engaged: true,
    frontalUnknowns: frontal,
    sessionFocus: focus,
    parkedThisTurn: parkedThisTurn.filter((id) => keptThreads.some((thread) => thread.id === id && thread.status === "parked")),
    state: {
      version: FOCUS_DISCIPLINE_VERSION,
      turn_counter: turn,
      focus: focus ? { target: clean(focus.target, 400), strength: focus.strength } : (priorState?.focus ?? null),
      threads: keptThreads
    }
  };
}

function holdReason(plan, { strength, diversion }) {
  const variables = plan?.variables ?? {};
  if (immediateProtectionNeeded(variables) || plan?.pathPerformance?.route === "safety") return "immediate_protection";
  if (HOLDING_THREAT_LEVELS.has(plan?.threatPathway?.level)) return "threat_pathway";
  if (plan?.protectiveCompatibility?.gate && plan.protectiveCompatibility.gate !== "NOT_BLOCKED") return "protective_compatibility";
  if (plan?.primaryJob?.id === "ROUTE.LEAVE_ALONE") return "leave_alone";
  if (diversion !== "none") return "client_diversion";
  if (strength === "high") return "strong_focus";
  return null;
}

const SAFETY_HOLDS = new Set(["immediate_protection", "threat_pathway", "protective_compatibility"]);

// Post-planning step: decide whether a parked side question may surface now,
// in which form, and whether the client needs a warm redirect back to focus.
export function decoratePlanWithFocusDiscipline(plan, prepared) {
  if (!prepared?.engaged) return { plan, state: null };
  const state = structuredClone(prepared.state);
  const focus = prepared.sessionFocus ?? null;
  const initialHold = holdReason(plan, { strength: focus?.strength ?? "moderate", diversion: focus?.client_diversion ?? "none" });
  const safetyHold = SAFETY_HOLDS.has(initialHold);
  const strength = safetyHold ? "high" : (focus?.strength ?? "moderate");
  const diversion = safetyHold ? "none" : (focus?.client_diversion ?? "none");
  const task = plan?.executionContract?.task ?? null;
  const naturalPause = !safetyHold && (focus?.natural_pause === true || task?.phase === "close");
  const hold = initialHold;
  const turn = state.turn_counter;
  const active = state.threads.filter((thread) => thread.status === "parked");
  const pressure = active.length > FOCUS_LIMITS.softActive;
  const eligible = active
    .filter((thread) => thread.parked_turn < turn)
    .filter((thread) => thread.last_offered_turn === null || turn - thread.last_offered_turn >= FOCUS_LIMITS.offerCooldownTurns)
    .sort((a, b) => b.importance - a.importance || a.parked_turn - b.parked_turn);

  let candidate = null;
  let reason = null;
  if (!hold && eligible.length) {
    if (strength === "light" || naturalPause) {
      candidate = eligible[0];
      reason = strength === "light" ? "light_focus" : "natural_pause";
    } else {
      candidate = eligible.find((thread) => pressure
        || (thread.importance >= FOCUS_LIMITS.moderateSurfaceImportance && turn - thread.parked_turn >= FOCUS_LIMITS.moderateSurfaceAgeTurns)) ?? null;
      reason = candidate ? (pressure ? "parked_pressure" : "important_and_waiting") : null;
    }
  }

  let nextPlan = { ...plan };
  let surface = null;
  if (candidate) {
    const thread = state.threads.find((item) => item.id === candidate.id);
    const hasCanonicalQuestion = Boolean(String(plan?.nextQuestion ?? "").trim()) || plan?.questionContract?.mode === "canonical";
    // With no active strategy episode, the path controller can only ask a generic
    // "what is still unclear" probe; once the focus is light, a parked side question is more useful.
    const genericProbeOnly = plan?.nextQuestionSource?.type === "path-performance" && !plan.nextQuestionSource.episode;
    const frontalAllowed = strength === "light" && (!hasCanonicalQuestion || genericProbeOnly)
      && task?.phase !== "close" && task?.agreement !== "declined" && task?.question_focus !== "none";
    if (frontalAllowed) {
      close(thread, turn, "surfaced_as_frontal", "promoted");
      const source = { type: "parked-thread", id: thread.id };
      nextPlan = { ...nextPlan, nextQuestion: thread.question, nextQuestionSource: source,
        questionContract: { mode: "canonical", question: thread.question, source } };
      surface = { mode: "question", thread_id: thread.id, question: thread.question, why_it_matters: thread.why_it_matters, reason };
    } else {
      thread.offer_count += 1;
      thread.last_offered_turn = turn;
      surface = { mode: "mention", thread_id: thread.id, question: thread.question, why_it_matters: thread.why_it_matters, reason };
    }
  }

  const redirect = diversion !== "none"
    ? { kind: diversion, topic: clean(focus?.diversion_topic, 400), parked_thread_ids: [...prepared.parkedThisTurn] }
    : null;
  const guidance = [];
  if (redirect) {
    guidance.push(redirect.kind === "avoidance"
      ? "The client is steering away from a hard part of the current focus. Name the pull gently and without accusation, keep the conversation on the focus, and if the step seems too big make it smaller rather than pushing through or following the detour."
      : "The client has drifted to a side topic. Acknowledge it in one warm sentence, say it is saved to come back to, and return to the current focus. Do not follow the tangent, lecture about time, or treat the drift as resistance.");
  }
  if (surface?.mode === "mention") {
    guidance.push("After the main move, add at most one brief declarative sentence that the parked side question is still there to come back to. Do not ask it, and do not let it displace the main move.");
  }
  if (surface?.mode === "question") {
    guidance.push("The current focus has loosened, so the parked side question is now the canonical next question. Briefly connect it to what the client said earlier.");
  }
  const focusContract = {
    version: FOCUS_DISCIPLINE_VERSION,
    focus: { target: focus?.target ?? state.focus?.target ?? "", strength, natural_pause: naturalPause },
    hold,
    redirect,
    surface,
    parked_thread_count: state.threads.filter((thread) => thread.status === "parked").length,
    guidance
  };
  return { plan: { ...nextPlan, focusContract }, state };
}
