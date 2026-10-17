import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { projectEvidenceAuthority } from "../case-state/evidence-authority.mjs";

// The plan in the case record (issue #172, change B): `case_state.roadmap`, a ranked, revisable set of goals in which every
// priority keeps its source. Deterministic: nothing here reads text for meaning or calls a model. The design and the rules
// on who can change what are in docs/superpowers/specs/2026-10-17-case-roadmap.md.

export const CASE_ROADMAP_VERSION = "case-roadmap-v1";
export const ROADMAP_GOAL_KINDS = Object.freeze(["primary_aim", "goal_within", "actionable_step", "independent_track", "safety_track", "medical_track"]);
export const ROADMAP_TRACK_KINDS = Object.freeze(["independent_track", "safety_track", "medical_track"]);
export const ROADMAP_GOAL_STATUSES = Object.freeze(["active", "parked", "blocked", "completed", "superseded"]);
export const ROADMAP_PRIORITY_SOURCES = Object.freeze(["client", "authorized_plan", "provisional"]);
export const ROADMAP_CLIENT_AGREEMENT = Object.freeze(["agreed", "declined", "not_asked", "unknown"]);
export const ROADMAP_LIMITS = Object.freeze({
  goals: 60,
  history: 40,
  applied_decisions: 100,
  list: 20,
  changes: 40,
  title: 300,
  text: 600,
  ref: 200
});

const GOAL_ID = /^goal:[a-z0-9][a-z0-9_-]{0,79}$/u;
// At most 120 characters, so the state diff a decision records (`roadmap:<decision id>`) fits the store's id limit.
const DECISION_ID = /^[A-Za-z0-9:_-]{1,120}$/u;
// Statuses that need a reason, so a reader can say why a goal waits.
const REASON_REQUIRED = new Set(["parked", "blocked", "superseded"]);
const NOTE_FIELDS = Object.freeze(["review_condition", "expected_progress", "next_step_tests", "uncertainty"]);
const TEXT_LIST_FIELDS = Object.freeze(["blockers", "counterevidence"]);
const UPDATABLE_FIELDS = Object.freeze(["title", "status", "status_reason", "client_agreement", "evidence_refs", "serves_episode_id", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS]);
// What the client decides about a goal they chose: an authorized plan may add working notes to it, never change these.
const CLIENT_OWNED_FIELDS = new Set(["title", "status", "status_reason", "client_agreement"]);
const GOAL_FIELDS = Object.freeze(["id", "title", "kind", "parent_id", "status", "status_reason", "rank", "priority_source", "client_agreement",
  "evidence_refs", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS, "serves_episode_id", "created_at", "updated_at", "history", "history_dropped"]);
const HISTORY_FIELDS = new Set(["created", "title", "status", "rank", "client_agreement", "priority_source", "notes"]);

function fail(message, code = "ROADMAP_INVALID") {
  throw new ValidationError(message, { code });
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value;
}

function text(value, name, max, { empty = false } = {}) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) fail(`${name} must be bounded text.`);
  return value;
}

function optionalText(value, name, max) {
  if (value === null) return null;
  return text(value, name, max);
}

function timestamp(value, name) {
  text(value, name, 80);
  if (Number.isNaN(Date.parse(value))) fail(`${name} must be a timestamp.`);
  return value;
}

function textList(value, name, max = ROADMAP_LIMITS.text) {
  if (!Array.isArray(value) || value.length > ROADMAP_LIMITS.list) fail(`${name} must be a bounded list.`);
  value.forEach((item, index) => text(item, `${name}[${index}]`, max));
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail(`${name} is invalid.`);
  return value;
}

const groupOf = (goal) => `${goal.parent_id ?? ""}\u0000${ROADMAP_TRACK_KINDS.includes(goal.kind) ? "track" : "goal"}`;

function validateGoal(goal, name) {
  object(goal, name);
  for (const key of Object.keys(goal)) if (!GOAL_FIELDS.includes(key)) fail(`${name}.${key} is not a roadmap goal field.`);
  if (typeof goal.id !== "string" || !GOAL_ID.test(goal.id)) fail(`${name}.id is invalid.`);
  text(goal.title, `${name}.title`, ROADMAP_LIMITS.title);
  enumValue(goal.kind, ROADMAP_GOAL_KINDS, `${name}.kind`);
  if (goal.parent_id !== null && (typeof goal.parent_id !== "string" || !GOAL_ID.test(goal.parent_id))) fail(`${name}.parent_id is invalid.`);
  enumValue(goal.status, ROADMAP_GOAL_STATUSES, `${name}.status`);
  optionalText(goal.status_reason, `${name}.status_reason`, ROADMAP_LIMITS.text);
  if (REASON_REQUIRED.has(goal.status) && goal.status_reason === null) fail(`${name} is ${goal.status} without a reason.`);
  if (goal.status === "active" && goal.status_reason !== null) fail(`${name} is active and still has a status reason.`);
  if (goal.status === "active" ? !(Number.isSafeInteger(goal.rank) && goal.rank >= 1) : goal.rank !== null) fail(`${name}.rank is invalid for its status.`);
  enumValue(goal.priority_source, ROADMAP_PRIORITY_SOURCES, `${name}.priority_source`);
  enumValue(goal.client_agreement, ROADMAP_CLIENT_AGREEMENT, `${name}.client_agreement`);
  if (goal.status === "active" && goal.client_agreement === "declined") fail(`${name} is active although the client declined it.`);
  textList(goal.evidence_refs, `${name}.evidence_refs`, ROADMAP_LIMITS.ref);
  for (const field of TEXT_LIST_FIELDS) textList(goal[field], `${name}.${field}`);
  for (const field of NOTE_FIELDS) text(goal[field], `${name}.${field}`, ROADMAP_LIMITS.text, { empty: true });
  optionalText(goal.serves_episode_id, `${name}.serves_episode_id`, 160);
  timestamp(goal.created_at, `${name}.created_at`);
  timestamp(goal.updated_at, `${name}.updated_at`);
  if (!Array.isArray(goal.history) || goal.history.length < 1 || goal.history.length > ROADMAP_LIMITS.history) fail(`${name}.history must be a bounded list.`);
  goal.history.forEach((entry, index) => {
    const label = `${name}.history[${index}]`;
    object(entry, label);
    timestamp(entry.at, `${label}.at`);
    if (typeof entry.decision_id !== "string" || !DECISION_ID.test(entry.decision_id)) fail(`${label}.decision_id is invalid.`);
    enumValue(entry.source, ROADMAP_PRIORITY_SOURCES, `${label}.source`);
    if (!HISTORY_FIELDS.has(entry.field)) fail(`${label}.field is invalid.`);
    for (const side of ["from", "to"]) {
      const value = entry[side];
      if (!(value === null || Number.isSafeInteger(value) || (typeof value === "string" && value.length <= ROADMAP_LIMITS.title))) fail(`${label}.${side} is invalid.`);
    }
  });
  if (goal.history[0].field !== "created") fail(`${name}.history must start with the goal's creation.`);
  if (!Number.isSafeInteger(goal.history_dropped) || goal.history_dropped < 0) fail(`${name}.history_dropped is invalid.`);
  return goal;
}

/** Validates a stored roadmap: its goals, their tree, their ranks and the decisions applied to it. */
export function validateCaseRoadmap(value, name = "caseState.roadmap") {
  object(value, name);
  if (value.version !== CASE_ROADMAP_VERSION) fail(`${name}.version is invalid.`);
  if (!Array.isArray(value.goals) || value.goals.length > ROADMAP_LIMITS.goals) fail(`${name}.goals must be a bounded list.`);
  const byId = new Map();
  value.goals.forEach((goal, index) => {
    validateGoal(goal, `${name}.goals[${index}]`);
    if (byId.has(goal.id)) fail(`${name} holds goal ${goal.id} twice.`);
    byId.set(goal.id, goal);
  });
  const ranks = new Map();
  for (const goal of value.goals) {
    if (goal.parent_id === null) {
      if (["goal_within", "actionable_step"].includes(goal.kind)) fail(`${name}: ${goal.id} must sit under a primary aim or a goal within it.`);
    } else {
      if (!["goal_within", "actionable_step"].includes(goal.kind)) fail(`${name}: a ${goal.kind} has no parent goal.`);
      const parent = byId.get(goal.parent_id);
      if (!parent) fail(`${name}: ${goal.id} has an unknown parent.`);
      if (!["primary_aim", "goal_within"].includes(parent.kind)) fail(`${name}: ${goal.id} sits under a ${parent.kind}.`);
    }
    if (goal.status === "active") {
      const group = groupOf(goal);
      const taken = ranks.get(group) ?? new Set();
      if (taken.has(goal.rank)) fail(`${name}: two active goals share rank ${goal.rank} in one group.`);
      taken.add(goal.rank);
      ranks.set(group, taken);
    }
  }
  // Parents come from earlier goals only, so the tree has no cycle; check it all the same.
  for (const goal of value.goals) {
    const seen = new Set([goal.id]);
    for (let parent = goal.parent_id; parent !== null; parent = byId.get(parent).parent_id) {
      if (seen.has(parent)) fail(`${name}: the goals form a cycle.`);
      seen.add(parent);
    }
  }
  if (value.safety_override !== null) {
    object(value.safety_override, `${name}.safety_override`);
    text(value.safety_override.reason, `${name}.safety_override.reason`, ROADMAP_LIMITS.text);
    timestamp(value.safety_override.since_at, `${name}.safety_override.since_at`);
    if (!DECISION_ID.test(value.safety_override.decision_id ?? "")) fail(`${name}.safety_override.decision_id is invalid.`);
  }
  if (!Array.isArray(value.applied_decisions) || value.applied_decisions.length > ROADMAP_LIMITS.applied_decisions) fail(`${name}.applied_decisions must be a bounded list.`);
  const decisionIds = new Set();
  value.applied_decisions.forEach((entry, index) => {
    const label = `${name}.applied_decisions[${index}]`;
    object(entry, label);
    if (!DECISION_ID.test(entry.decision_id ?? "")) fail(`${label}.decision_id is invalid.`);
    if (decisionIds.has(entry.decision_id)) fail(`${name} applied decision ${entry.decision_id} twice.`);
    decisionIds.add(entry.decision_id);
    timestamp(entry.at, `${label}.at`);
    enumValue(entry.source, ROADMAP_PRIORITY_SOURCES, `${label}.source`);
    if (typeof entry.digest !== "string" || !/^[a-f0-9]{64}$/u.test(entry.digest)) fail(`${label}.digest is invalid.`);
  });
  timestamp(value.updated_at, `${name}.updated_at`);
  if (!DECISION_ID.test(value.updated_by_decision ?? "")) fail(`${name}.updated_by_decision is invalid.`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The digest a decision is replayed by: the same id with the same content is a replay, with other content a conflict. */
export function roadmapDecisionDigest(decision) {
  return createHash("sha256").update(canonical(decision), "utf8").digest("hex");
}

function validateDecision(decision) {
  object(decision, "decision");
  if (typeof decision.decision_id !== "string" || !DECISION_ID.test(decision.decision_id)) fail("decision.decision_id is invalid.");
  enumValue(decision.source, ROADMAP_PRIORITY_SOURCES, "decision.source");
  timestamp(decision.at, "decision.at");
  if (decision.turn_id != null) text(decision.turn_id, "decision.turn_id", 160);
  textList(decision.evidence_refs ?? [], "decision.evidence_refs", ROADMAP_LIMITS.ref);
  if (decision.source === "client" && !(decision.evidence_refs ?? []).length) {
    fail("A client decision needs evidence references to where the client said it.", "ROADMAP_CLIENT_EVIDENCE_REQUIRED");
  }
  if (decision.note != null) text(decision.note, "decision.note", ROADMAP_LIMITS.text);
  if (!Array.isArray(decision.changes) || decision.changes.length < 1 || decision.changes.length > ROADMAP_LIMITS.changes) fail("decision.changes must hold 1 to 40 changes.");
  return decision;
}

function refused(message) {
  fail(message, "ROADMAP_CHANGE_NOT_ALLOWED");
}

// Whether a decision of `source` may change `field` of `goal`: the client any goal; an authorized plan any goal but the
// client-owned fields of a goal the client chose; a model's proposal only its own kind.
function mayChange(source, goal, field) {
  if (source === "client") return true;
  if (source === "provisional") return goal.priority_source === "provisional";
  return !(goal.priority_source === "client" && (CLIENT_OWNED_FIELDS.has(field) || field === "rank"));
}

function pushHistory(goal, entry) {
  goal.history.push(entry);
  if (goal.history.length > ROADMAP_LIMITS.history) {
    goal.history.splice(1, 1);
    goal.history_dropped += 1;
  }
}

const shortValue = (value) => (typeof value === "string" ? value.slice(0, ROADMAP_LIMITS.title) : value);

function nextRank(goals, goal) {
  const group = groupOf(goal);
  return goals.filter((other) => other !== goal && other.status === "active" && groupOf(other) === group)
    .reduce((highest, other) => Math.max(highest, other.rank), 0) + 1;
}

function addGoal(roadmap, change, decision) {
  const input = object(change.goal, "change.goal");
  const allowed = new Set(["id", "title", "kind", "parent_id", "status", "status_reason", "client_agreement", "evidence_refs", "serves_episode_id", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`change.goal.${key} cannot be set when adding a goal.`);
  if (typeof input.id !== "string" || !GOAL_ID.test(input.id)) fail("change.goal.id is invalid.");
  if (roadmap.goals.some((goal) => goal.id === input.id)) fail(`Goal ${input.id} already exists.`, "ROADMAP_GOAL_EXISTS");
  if (roadmap.goals.length >= ROADMAP_LIMITS.goals) fail("The roadmap holds the most goals it can.", "ROADMAP_FULL");
  const agreement = input.client_agreement ?? (decision.source === "client" ? "agreed" : "not_asked");
  if (decision.source !== "client" && ["agreed", "declined"].includes(agreement)) refused("Only the client can agree to or decline a goal.");
  const goal = {
    id: input.id,
    title: input.title,
    kind: input.kind,
    parent_id: input.parent_id ?? null,
    status: input.status ?? "active",
    status_reason: input.status_reason ?? null,
    rank: null,
    priority_source: decision.source,
    client_agreement: agreement,
    evidence_refs: structuredClone(input.evidence_refs ?? decision.evidence_refs ?? []),
    blockers: structuredClone(input.blockers ?? []),
    counterevidence: structuredClone(input.counterevidence ?? []),
    review_condition: input.review_condition ?? "",
    expected_progress: input.expected_progress ?? "",
    next_step_tests: input.next_step_tests ?? "",
    uncertainty: input.uncertainty ?? "",
    serves_episode_id: input.serves_episode_id ?? null,
    created_at: decision.at,
    updated_at: decision.at,
    history: [{ at: decision.at, decision_id: decision.decision_id, source: decision.source, field: "created", from: null, to: input.status ?? "active" }],
    history_dropped: 0
  };
  if (goal.status === "active") goal.rank = nextRank(roadmap.goals, goal);
  roadmap.goals.push(goal);
}

function updateGoal(roadmap, change, decision) {
  const goal = roadmap.goals.find((candidate) => candidate.id === change.goal_id);
  if (!goal) fail(`Goal ${change.goal_id} does not exist.`, "ROADMAP_GOAL_NOT_FOUND");
  const set = object(change.set, "change.set");
  const fields = Object.keys(set);
  if (!fields.length) fail("change.set is empty.");
  for (const field of fields) {
    if (!UPDATABLE_FIELDS.includes(field)) fail(`${field} cannot be changed; supersede the goal and add another instead.`);
    if (!mayChange(decision.source, goal, field)) {
      refused(decision.source === "provisional"
        ? `A model's proposal cannot change ${goal.id}, which the client or an authorized plan set.`
        : `An authorized plan cannot change the ${field} of ${goal.id}, which the client chose; the client can.`);
    }
  }
  if (Object.hasOwn(set, "client_agreement") && decision.source !== "client" && ["agreed", "declined"].includes(set.client_agreement)) {
    refused("Only the client can agree to or decline a goal.");
  }
  const before = structuredClone(goal);
  const noteFields = [];
  for (const field of fields) {
    goal[field] = structuredClone(set[field]);
    if (!["title", "status", "status_reason", "client_agreement"].includes(field)) noteFields.push(field);
  }
  if (goal.status === "active" && goal.client_agreement === "declined") {
    // Withdrawn consent: a goal the client declines stops being active, unless this change sets another state for it. It
    // becomes active again only when the client agrees to it again.
    if (Object.hasOwn(set, "status")) refused(`${goal.id} is declined by the client; it becomes active again only with the client's agreement.`);
    goal.status = "parked";
    if (!Object.hasOwn(set, "status_reason")) goal.status_reason = "The client declined this goal.";
  } else if (goal.status !== before.status && REASON_REQUIRED.has(goal.status) && !Object.hasOwn(set, "status_reason")) {
    fail(`${goal.id} needs a reason when it becomes ${goal.status}.`);
  }
  if (goal.status === "active") {
    if (before.status !== "active") {
      goal.rank = nextRank(roadmap.goals, goal);
      if (!Object.hasOwn(set, "status_reason")) goal.status_reason = null;
    }
  } else {
    goal.rank = null;
    if (goal.status === "completed" && !Object.hasOwn(set, "status_reason") && before.status !== "completed") goal.status_reason = null;
  }
  const entry = (field, from, to) => pushHistory(goal, { at: decision.at, decision_id: decision.decision_id, source: decision.source, field, from: shortValue(from), to: shortValue(to) });
  if (before.title !== goal.title) entry("title", before.title, goal.title);
  if (before.status !== goal.status) entry("status", before.status, goal.status);
  if (before.rank !== goal.rank) entry("rank", before.rank, goal.rank);
  if (before.client_agreement !== goal.client_agreement) entry("client_agreement", before.client_agreement, goal.client_agreement);
  if (noteFields.length) entry("notes", null, noteFields.sort().join(","));
  // A change of status by another source makes the goal's current priority that source's, and the history says so.
  if (before.status !== goal.status && goal.priority_source !== decision.source) {
    entry("priority_source", goal.priority_source, decision.source);
    goal.priority_source = decision.source;
  }
  goal.updated_at = decision.at;
}

function orderGroup(roadmap, change, decision) {
  const parentId = change.parent_id ?? null;
  if (parentId !== null && !roadmap.goals.some((goal) => goal.id === parentId)) fail(`Goal ${parentId} does not exist.`, "ROADMAP_GOAL_NOT_FOUND");
  const tracks = change.tracks === true;
  if (!Array.isArray(change.goal_ids) || !change.goal_ids.length) fail("change.goal_ids must list the group's active goals.");
  const members = roadmap.goals.filter((goal) => goal.status === "active" && (goal.parent_id ?? null) === parentId
    && ROADMAP_TRACK_KINDS.includes(goal.kind) === tracks);
  const memberIds = new Set(members.map((goal) => goal.id));
  if (new Set(change.goal_ids).size !== change.goal_ids.length || change.goal_ids.length !== members.length || change.goal_ids.some((id) => !memberIds.has(id))) {
    fail("change.goal_ids must list each active goal of the group exactly once.");
  }
  change.goal_ids.forEach((id, index) => {
    const goal = members.find((candidate) => candidate.id === id);
    const rank = index + 1;
    if (goal.rank === rank) return;
    if (!mayChange(decision.source, goal, "rank")) {
      refused(decision.source === "provisional"
        ? `A model's proposal cannot move ${goal.id}, which the client or an authorized plan set.`
        : `An authorized plan cannot move ${goal.id}, which the client chose; the client can.`);
    }
    pushHistory(goal, { at: decision.at, decision_id: decision.decision_id, source: decision.source, field: "rank", from: goal.rank, to: rank });
    goal.rank = rank;
    if (goal.priority_source !== decision.source) {
      pushHistory(goal, { at: decision.at, decision_id: decision.decision_id, source: decision.source, field: "priority_source", from: goal.priority_source, to: decision.source });
      goal.priority_source = decision.source;
    }
    goal.updated_at = decision.at;
  });
}

function setSafetyOverride(roadmap, change, decision) {
  if (decision.source === "provisional") refused("A model's proposal cannot set or clear the safety override.");
  if (change.reason === null) {
    roadmap.safety_override = null;
    return;
  }
  roadmap.safety_override = { reason: text(change.reason, "change.reason", ROADMAP_LIMITS.text), since_at: decision.at, decision_id: decision.decision_id };
}

function emptyRoadmap(at, decisionId) {
  return { version: CASE_ROADMAP_VERSION, goals: [], safety_override: null, applied_decisions: [], updated_at: at, updated_by_decision: decisionId };
}

/**
 * Applies one decision to a roadmap (null when the case has none yet) and returns the new roadmap; the input is not changed.
 * Every change is checked against who may make it before any is kept, so a decision applies whole or not at all. A decision
 * replayed with the same id and content returns the roadmap unchanged; the same id with other content is refused.
 */
export function applyRoadmapDecision(previous, decision) {
  validateDecision(decision);
  if (previous !== null && previous !== undefined) validateCaseRoadmap(previous);
  const digest = roadmapDecisionDigest(decision);
  const earlier = previous?.applied_decisions.find((entry) => entry.decision_id === decision.decision_id);
  if (earlier) {
    if (earlier.digest !== digest) fail(`Decision ${decision.decision_id} was already applied with other content.`, "ROADMAP_DECISION_CONFLICT");
    return structuredClone(previous);
  }
  // Only the latest decisions are kept for replay checks. Once the list is full, a decision dated before the oldest kept one
  // can't be told from an old one replayed, so it is refused rather than applied a second time.
  const kept = previous?.applied_decisions ?? [];
  if (kept.length >= ROADMAP_LIMITS.applied_decisions && Date.parse(decision.at) < Date.parse(kept[0].at)) {
    fail(`Decision ${decision.decision_id} is older than the decisions kept for replay checks.`, "ROADMAP_DECISION_TOO_OLD");
  }
  const roadmap = previous ? structuredClone(previous) : emptyRoadmap(decision.at, decision.decision_id);
  for (const [index, change] of decision.changes.entries()) {
    object(change, `decision.changes[${index}]`);
    if (change.op === "add") addGoal(roadmap, change, decision);
    else if (change.op === "update") updateGoal(roadmap, change, decision);
    else if (change.op === "order") orderGroup(roadmap, change, decision);
    else if (change.op === "safety_override") setSafetyOverride(roadmap, change, decision);
    else fail(`decision.changes[${index}].op is invalid.`);
  }
  roadmap.applied_decisions.push({ decision_id: decision.decision_id, at: decision.at, source: decision.source, digest });
  if (roadmap.applied_decisions.length > ROADMAP_LIMITS.applied_decisions) roadmap.applied_decisions.shift();
  roadmap.updated_at = decision.at;
  roadmap.updated_by_decision = decision.decision_id;
  return validateCaseRoadmap(roadmap);
}

const SOURCE_LABEL = Object.freeze({
  client: "the client's choice",
  authorized_plan: "an authorized plan",
  provisional: "a model's proposal, not yet confirmed"
});

function goalView(goal) {
  return {
    id: goal.id,
    title: goal.title,
    kind: goal.kind,
    status: goal.status,
    rank: goal.rank,
    priority_source: goal.priority_source,
    source_means: SOURCE_LABEL[goal.priority_source],
    client_agreement: goal.client_agreement,
    ...(goal.status_reason ? { why: goal.status_reason } : {}),
    ...(goal.review_condition ? { review_condition: goal.review_condition } : {}),
    ...(goal.expected_progress ? { expected_progress: goal.expected_progress } : {}),
    ...(goal.next_step_tests ? { next_step_tests: goal.next_step_tests } : {}),
    ...(goal.uncertainty ? { uncertainty: goal.uncertainty } : {}),
    ...(goal.blockers.length ? { blockers: goal.blockers } : {}),
    ...(goal.counterevidence.length ? { counterevidence: goal.counterevidence } : {}),
    ...(goal.serves_episode_id ? { serves_episode_id: goal.serves_episode_id } : {})
  };
}

const byRank = (left, right) => left.rank - right.rank;

function safetyOverride(state) {
  const reasons = [];
  if (state.roadmap?.safety_override) reasons.push(state.roadmap.safety_override.reason);
  if (state.threat_pathway?.current?.level === "IMMINENT_OPERATIONAL_DANGER") reasons.push("The record's threat pathway shows imminent operational danger.");
  return { ordinary_order_suspended: reasons.length > 0, reasons };
}

function episodeView(episode) {
  return episode ? { id: episode.id, target: episode.target, route: episode.route, next_question: episode.next_question, started_turn_id: episode.started_turn_id } : null;
}

function recordedPlan(state) {
  const goals = state.roadmap.goals;
  const active = goals.filter((goal) => goal.status === "active");
  const children = (parentId) => active.filter((goal) => goal.parent_id === parentId && !ROADMAP_TRACK_KINDS.includes(goal.kind)).sort(byRank);
  const primary = active.filter((goal) => goal.kind === "primary_aim").sort(byRank);
  const tracks = active.filter((goal) => ROADMAP_TRACK_KINDS.includes(goal.kind)).sort(byRank);
  const within = [];
  const collect = (parentId, depth) => {
    for (const goal of children(parentId)) {
      within.push({ ...goalView(goal), parent_id: goal.parent_id, depth });
      collect(goal.id, depth + 1);
    }
  };
  for (const aim of primary) collect(aim.id, 1);
  // Active goals under a goal that waits are held by it; they are listed apart, never as current work.
  const reached = new Set([...primary, ...tracks].map((goal) => goal.id).concat(within.map((goal) => goal.id)));
  const held = active.filter((goal) => !reached.has(goal.id))
    .map((goal) => ({ ...goalView(goal), parent_id: goal.parent_id, why_held: "Its parent goal is not active." }));
  // The step being worked on: the goal linked to the operational episode, else the first active step under the first aim. A
  // model's proposal is shown as the current step only when nothing the client or an authorized plan set is there.
  const episode = state.current_episode ?? null;
  const preferConfirmed = (candidates) => candidates.find((goal) => goal.priority_source !== "provisional") ?? candidates[0] ?? null;
  const serving = episode ? active.filter((goal) => goal.serves_episode_id === episode.id) : [];
  const linked = preferConfirmed(serving.filter((goal) => reached.has(goal.id)));
  const steps = [];
  const walk = (parentId) => {
    for (const goal of children(parentId)) {
      if (goal.kind === "actionable_step") steps.push(goal);
      else walk(goal.id);
    }
  };
  if (primary.length) walk(primary[0].id);
  const first = preferConfirmed(steps);
  const episodeLink = !episode ? "no_episode"
    : linked ? "linked"
      : serving.length ? "held_by_parent"
        : active.some((goal) => goal.serves_episode_id && goal.serves_episode_id !== episode.id) ? "stale" : "unlinked";
  return {
    status: "recorded",
    note: "The plan recorded in this case. Each goal says whose priority it is; a model's proposal is not a decision. A safety need or withdrawn consent comes before this order while it lasts, recorded or not.",
    primary: primary.map(goalView),
    now: {
      step: linked ? goalView(linked) : first ? goalView(first) : null,
      current_episode: episodeView(episode),
      episode_link: episodeLink
    },
    within,
    tracks: tracks.map((goal) => ({ ...goalView(goal), note: "Separately available; not an exercise, and reparenting does not replace it." })),
    waiting: goals.filter((goal) => ["parked", "blocked"].includes(goal.status)).map(goalView),
    held_by_parent: held,
    finished: goals.filter((goal) => ["completed", "superseded"].includes(goal.status)).map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, ...(goal.status_reason ? { why: goal.status_reason } : {}) })),
    priorities_change_when: active.filter((goal) => goal.review_condition).map((goal) => ({ goal_id: goal.id, review_condition: goal.review_condition })),
    sources: Object.fromEntries(ROADMAP_PRIORITY_SOURCES.map((source) => [source, goals.filter((goal) => goal.priority_source === source).length])),
    safety: safetyOverride(state),
    updated_at: state.roadmap.updated_at
  };
}

const RECONSTRUCTION_LIMITS = Object.freeze({ routes: 10, parked: 10, high_relevance: 15, statement: 400 });

function reconstruction(state) {
  const routes = new Map();
  state.intervention_history.forEach((item, index) => {
    if (item.domain !== "intervention_route") return;
    const key = item.statement;
    const entry = routes.get(key) ?? { statement: key.slice(0, RECONSTRUCTION_LIMITS.statement), times: 0, first_ref: item.source?.turn_id ?? item.source?.ref ?? null, last_ref: null, last_index: -1 };
    entry.times += 1;
    entry.last_ref = item.source?.turn_id ?? item.source?.ref ?? null;
    entry.last_index = index;
    routes.set(key, entry);
  });
  const parked = (state.focus_discipline?.threads ?? []).filter((thread) => thread.status === "parked")
    .sort((left, right) => right.importance - left.importance)
    .slice(0, RECONSTRUCTION_LIMITS.parked)
    .map((thread) => ({ id: thread.id, question: thread.question, why_it_matters: thread.why_it_matters, importance: thread.importance }));
  // Model-extracted observations read as the low-confidence inferences they are, as everywhere a state is shown.
  const highRelevance = projectEvidenceAuthority(state).items.filter((item) => item.decision_relevance === "high" && item.still_current !== false)
    .slice(-RECONSTRUCTION_LIMITS.high_relevance)
    .map((item) => ({ id: item.id, status: item.status, statement: item.statement.slice(0, RECONSTRUCTION_LIMITS.statement) }));
  return {
    status: "proposed_reconstruction",
    note: "No plan is recorded for this case. This is rebuilt from the record on each read: a proposal, not a decision, and not stored. It names no primary aim: that is the client's to choose, or an authorized person's to record. Present any priority here as a proposal and ask before treating it as the plan.",
    priority_source: "provisional",
    now: { step: null, current_episode: episodeView(state.current_episode ?? null), episode_link: state.current_episode ? "unlinked" : "no_episode" },
    routes_tried: [...routes.values()].sort((left, right) => right.last_index - left.last_index).slice(0, RECONSTRUCTION_LIMITS.routes)
      .map(({ statement, times, first_ref, last_ref }) => ({ statement, times, first_ref, last_ref })),
    parked_questions: parked,
    high_relevance_items: highRelevance,
    safety: safetyOverride(state)
  };
}

/**
 * The case's plan as a session reads it first: the recorded roadmap's view (what is primary, what is being worked on now,
 * what waits and why, when priorities would change, whose priority each one is), or, when nothing is recorded, a
 * reconstruction from the record that is labeled a proposal and never stored. Takes a validated case state.
 */
export function projectCasePlan(state) {
  object(state, "caseState");
  return Object.freeze(state.roadmap ? recordedPlan(state) : reconstruction(state));
}
