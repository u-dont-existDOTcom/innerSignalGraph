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
  history_refs: 5,
  applied_decisions: 100,
  list: 20,
  changes: 40,
  title: 300,
  text: 600,
  ref: 400,
  episode_id: 200,
  // A decision may be dated at most this far ahead of the clock it is checked against.
  future_ms: 24 * 60 * 60 * 1000
});

const GOAL_ID = /^goal:[a-z0-9][a-z0-9_-]{0,79}$/u;
// At most 120 characters, so the state diff a decision records (`roadmap:<decision id>`) fits the store's id limit.
const DECISION_ID = /^[A-Za-z0-9:_-]{1,120}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
// Statuses that need a reason, so a reader can say why a goal waits.
const REASON_REQUIRED = new Set(["parked", "blocked", "superseded"]);
const NOTE_FIELDS = Object.freeze(["review_condition", "expected_progress", "next_step_tests", "uncertainty"]);
const TEXT_LIST_FIELDS = Object.freeze(["blockers", "counterevidence"]);
const UPDATABLE_FIELDS = Object.freeze(["title", "status", "status_reason", "client_agreement", "evidence_refs", "serves_episode_id", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS]);
// What the client decides about a goal they chose or answered: another source may add working notes to it and evidence
// references, never change these. `rank` is client-owned too.
const CLIENT_OWNED_FIELDS = new Set(["title", "status", "status_reason", "client_agreement", "review_condition", "serves_episode_id", "rank"]);
// A change to one of these by another source makes the goal's current priority that source's, and the history says so.
const SOURCE_FIELDS = new Set(["title", "status", "client_agreement", "rank"]);
const GOAL_FIELDS = Object.freeze(["id", "title", "kind", "parent_id", "status", "status_reason", "rank", "priority_source", "client_agreement",
  "evidence_refs", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS, "serves_episode_id", "created_at", "updated_at", "history", "history_dropped"]);
const HISTORY_FIELDS = new Set(["created", "title", "status", "rank", "client_agreement", "priority_source", "notes"]);

function fail(message, code = "ROADMAP_INVALID") {
  throw new ValidationError(message, { code });
}

function refused(message) {
  fail(message, "ROADMAP_CHANGE_NOT_ALLOWED");
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

// An ISO 8601 UTC time, such as 2026-10-18T10:00:00.000Z: nothing looser, so dates compare as written.
function timestamp(value, name) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) fail(`${name} must be an ISO 8601 UTC time.`);
  return value;
}

function textList(value, name, max = ROADMAP_LIMITS.text, limit = ROADMAP_LIMITS.list) {
  if (!Array.isArray(value) || value.length > limit) fail(`${name} must be a bounded list.`);
  value.forEach((item, index) => text(item, `${name}[${index}]`, max));
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail(`${name} is invalid.`);
  return value;
}

const isTrack = (goal) => ROADMAP_TRACK_KINDS.includes(goal.kind);
const groupOf = (goal) => `${goal.parent_id ?? ""}\u0000${isTrack(goal) ? "track" : "goal"}`;
// A goal the client chose, or agreed to or declined, is the client's to change.
const clientConfirmed = (goal) => goal.priority_source === "client" || ["agreed", "declined"].includes(goal.client_agreement);
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedTitle = (title) => title.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
  optionalText(goal.serves_episode_id, `${name}.serves_episode_id`, ROADMAP_LIMITS.episode_id);
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
    if (entry.refs !== undefined) textList(entry.refs, `${label}.refs`, ROADMAP_LIMITS.ref, ROADMAP_LIMITS.history_refs);
  });
  if (goal.history[0].field !== "created") fail(`${name}.history must start with the goal's creation.`);
  if (!Number.isSafeInteger(goal.history_dropped) || goal.history_dropped < 0) fail(`${name}.history_dropped is invalid.`);
  return goal;
}

/** Validates a stored roadmap: its goals, their tree, their ranks (1 to n within each group) and the decisions applied. */
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
      ranks.set(group, [...(ranks.get(group) ?? []), goal.rank]);
    }
  }
  // Ranks are the order within a group, kept as 1 to n with no gaps, so a rank that keeps its number keeps its place.
  for (const taken of ranks.values()) {
    const sorted = [...taken].sort((left, right) => left - right);
    if (sorted.some((rank, index) => rank !== index + 1)) fail(`${name}: the active goals of a group must have ranks 1 to ${sorted.length}.`);
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
    enumValue(value.safety_override.source, ["client", "authorized_plan"], `${name}.safety_override.source`);
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
    if (entry.turn_id !== null) text(entry.turn_id, `${label}.turn_id`, 160);
  });
  timestamp(value.updated_at, `${name}.updated_at`);
  if (!DECISION_ID.test(value.updated_by_decision ?? "")) fail(`${name}.updated_by_decision is invalid.`);
  return value;
}

/**
 * The light check a case record gets on every read: a plan is an object with a version. The full check runs where the plan is
 * read for use (`readCaseRoadmap`), so a plan this version can't read never makes the rest of the case unreadable.
 */
export function validateCaseRoadmapShape(value, name = "caseState.roadmap") {
  object(value, name);
  if (typeof value.version !== "string" || !value.version.trim() || value.version.length > 80) fail(`${name}.version is invalid.`);
  return value;
}

function trimHistory(goal) {
  while (goal.history.length > ROADMAP_LIMITS.history) {
    // Working notes go first; the creation entry and the record of rank, status, agreement and source changes go last.
    const notes = goal.history.findIndex((entry, index) => index > 0 && entry.field === "notes");
    goal.history.splice(notes > 0 ? notes : 1, 1);
    goal.history_dropped += 1;
  }
}

/**
 * Reads a stored plan for use: brings a plan of this version within the current limits, then checks it in full. Returns
 * { roadmap, problem }: the plan, or null with a content-free problem code when this version can't read it.
 */
export function readCaseRoadmap(value) {
  if (value === null || value === undefined) return { roadmap: null, problem: null };
  if (!value || typeof value !== "object" || value.version !== CASE_ROADMAP_VERSION) return { roadmap: null, problem: "ROADMAP_VERSION_UNKNOWN" };
  const roadmap = structuredClone(value);
  if (Array.isArray(roadmap.applied_decisions) && roadmap.applied_decisions.length > ROADMAP_LIMITS.applied_decisions) {
    roadmap.applied_decisions = roadmap.applied_decisions.slice(-ROADMAP_LIMITS.applied_decisions);
  }
  for (const goal of Array.isArray(roadmap.goals) ? roadmap.goals : []) {
    if (goal && Array.isArray(goal.history) && Number.isSafeInteger(goal.history_dropped)) trimHistory(goal);
  }
  try {
    // Renumbering keeps every order, so a plan stored with gaps in its ranks reads the same.
    if (Array.isArray(roadmap.goals) && roadmap.goals.every((goal) => goal && typeof goal === "object" && (goal.status !== "active" || Number.isFinite(goal.rank)))) compactRanks(roadmap);
    return { roadmap: validateCaseRoadmap(roadmap), problem: null };
  } catch {
    return { roadmap: null, problem: "ROADMAP_UNREADABLE" };
  }
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

// Whether a decision of `source` may change `field` of `goal`: the client any goal; an authorized plan any goal but the
// client-owned fields of a goal the client chose, agreed to or declined; a model's proposal only unconfirmed proposals.
function mayChange(source, goal, field) {
  if (source === "client") return true;
  if (source === "provisional") return goal.priority_source === "provisional" && !clientConfirmed(goal);
  return !(clientConfirmed(goal) && CLIENT_OWNED_FIELDS.has(field));
}

const shortValue = (value) => (typeof value === "string" ? value.slice(0, ROADMAP_LIMITS.title) : value);

function historyEntry(decision, field, from, to) {
  return {
    at: decision.at,
    decision_id: decision.decision_id,
    source: decision.source,
    field,
    from: shortValue(from),
    to: shortValue(to),
    // A client decision says where the client said it; the first references are kept with the change.
    ...(decision.source === "client" && field !== "notes" ? { refs: (decision.evidence_refs ?? []).slice(0, ROADMAP_LIMITS.history_refs) } : {})
  };
}

function pushHistory(goal, entry) {
  goal.history.push(entry);
  trimHistory(goal);
}

// Ranks are kept 1 to n within each group, in their order, after every change: a goal leaving or joining the active goals
// never leaves a gap another source could use to slip ahead of a goal it may not move. Renumbering keeps every relative
// order and records nothing.
function compactRanks(roadmap) {
  const groups = new Map();
  for (const goal of roadmap.goals) {
    if (goal.status !== "active") continue;
    groups.set(groupOf(goal), [...(groups.get(groupOf(goal)) ?? []), goal]);
  }
  for (const members of groups.values()) members.sort((left, right) => left.rank - right.rank).forEach((goal, index) => { goal.rank = index + 1; });
}

function nextRank(goals, goal) {
  const group = groupOf(goal);
  return goals.filter((other) => other !== goal && other.status === "active" && groupOf(other) === group).length + 1;
}

// Any change of title, status, agreement or rank by a source other than the goal's makes its current priority that source's.
function takeOver(goal, decision) {
  if (goal.priority_source === decision.source) return;
  pushHistory(goal, historyEntry(decision, "priority_source", goal.priority_source, decision.source));
  goal.priority_source = decision.source;
}

function addGoal(roadmap, change, decision) {
  const input = object(change.goal, "change.goal");
  const allowed = new Set(["id", "title", "kind", "parent_id", "status", "status_reason", "client_agreement", "evidence_refs", "serves_episode_id", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`change.goal.${key} cannot be set when adding a goal.`);
  if (typeof input.id !== "string" || !GOAL_ID.test(input.id)) fail("change.goal.id is invalid.");
  if (roadmap.goals.some((goal) => goal.id === input.id)) fail(`Goal ${input.id} already exists.`, "ROADMAP_GOAL_EXISTS");
  if (roadmap.goals.length >= ROADMAP_LIMITS.goals) fail("The roadmap holds the most goals it can.", "ROADMAP_FULL");
  text(input.title, "change.goal.title", ROADMAP_LIMITS.title);
  const agreement = input.client_agreement ?? (decision.source === "client" ? "agreed" : "not_asked");
  if (decision.source !== "client" && ["agreed", "declined"].includes(agreement)) refused("Only the client can agree to or decline a goal.");
  // A goal the client declined isn't offered again under another id by anyone but the client.
  if (decision.source !== "client") {
    const title = normalizedTitle(input.title);
    if (roadmap.goals.some((goal) => goal.client_agreement === "declined" && normalizedTitle(goal.title) === title)) {
      refused("The client declined a goal with this title; only the client can bring it back.");
    }
  }
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
    history: [historyEntry(decision, "created", null, input.status ?? "active")],
    history_dropped: 0
  };
  if (goal.status === "active") goal.rank = nextRank(roadmap.goals, goal);
  roadmap.goals.push(goal);
}

function updateGoal(roadmap, change, decision, touched) {
  const goal = roadmap.goals.find((candidate) => candidate.id === change.goal_id);
  if (!goal) fail(`Goal ${change.goal_id} does not exist.`, "ROADMAP_GOAL_NOT_FOUND");
  if (touched.has(goal.id)) fail(`A decision updates ${goal.id} at most once.`);
  touched.add(goal.id);
  const set = object(change.set, "change.set");
  const fields = Object.keys(set);
  if (!fields.length) fail("change.set is empty.");
  for (const field of fields) {
    if (!UPDATABLE_FIELDS.includes(field)) fail(`${field} cannot be changed; supersede the goal and add another instead.`);
    if (sameValue(goal[field], set[field])) continue;
    if (!mayChange(decision.source, goal, field)) {
      refused(decision.source === "provisional"
        ? `A model's proposal cannot change ${goal.id}, which the client or an authorized plan set or the client answered.`
        : `An authorized plan cannot change the ${field} of ${goal.id}, which the client chose or answered; the client can.`);
    }
  }
  if (Object.hasOwn(set, "client_agreement") && decision.source !== "client" && ["agreed", "declined"].includes(set.client_agreement)) {
    refused("Only the client can agree to or decline a goal.");
  }
  // References to where something was said are added to, never taken away, on a goal the client confirmed.
  if (Object.hasOwn(set, "evidence_refs") && decision.source !== "client" && clientConfirmed(goal) && goal.evidence_refs.some((ref) => !set.evidence_refs.includes(ref))) {
    refused(`An authorized plan can add evidence references to ${goal.id}, not remove them.`);
  }
  const before = structuredClone(goal);
  for (const field of fields) goal[field] = structuredClone(set[field]);
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
  const changed = UPDATABLE_FIELDS.filter((field) => !sameValue(before[field], goal[field]));
  if (!changed.length && before.rank === goal.rank) return;
  if (before.title !== goal.title) pushHistory(goal, historyEntry(decision, "title", before.title, goal.title));
  if (before.status !== goal.status) pushHistory(goal, historyEntry(decision, "status", before.status, goal.status));
  if (before.rank !== goal.rank) pushHistory(goal, historyEntry(decision, "rank", before.rank, goal.rank));
  if (before.client_agreement !== goal.client_agreement) pushHistory(goal, historyEntry(decision, "client_agreement", before.client_agreement, goal.client_agreement));
  const notes = changed.filter((field) => !["title", "status", "status_reason", "client_agreement"].includes(field));
  if (notes.length) pushHistory(goal, historyEntry(decision, "notes", null, notes.sort().join(",")));
  if (changed.some((field) => SOURCE_FIELDS.has(field))) takeOver(goal, decision);
  goal.updated_at = decision.at;
}

function orderGroup(roadmap, change, decision) {
  const parentId = change.parent_id ?? null;
  if (parentId !== null && !roadmap.goals.some((goal) => goal.id === parentId)) fail(`Goal ${parentId} does not exist.`, "ROADMAP_GOAL_NOT_FOUND");
  const tracks = change.tracks === true;
  if (!Array.isArray(change.goal_ids) || !change.goal_ids.length) fail("change.goal_ids must list the group's active goals.");
  const members = roadmap.goals.filter((goal) => goal.status === "active" && (goal.parent_id ?? null) === parentId && isTrack(goal) === tracks);
  const memberIds = new Set(members.map((goal) => goal.id));
  if (new Set(change.goal_ids).size !== change.goal_ids.length || change.goal_ids.length !== members.length || change.goal_ids.some((id) => !memberIds.has(id))) {
    fail("change.goal_ids must list each active goal of the group exactly once.");
  }
  // Ranks are 1 to n, so a goal whose number changes is a goal whose place changes.
  const moved = change.goal_ids.map((id, index) => [members.find((candidate) => candidate.id === id), index + 1]).filter(([goal, rank]) => goal.rank !== rank);
  for (const [goal] of moved) {
    if (!mayChange(decision.source, goal, "rank")) {
      refused(decision.source === "provisional"
        ? `A model's proposal cannot move ${goal.id}, which the client or an authorized plan set or the client answered.`
        : `An authorized plan cannot move ${goal.id}, which the client chose or answered; the client can.`);
    }
  }
  for (const [goal, rank] of moved) {
    pushHistory(goal, historyEntry(decision, "rank", goal.rank, rank));
    goal.rank = rank;
    takeOver(goal, decision);
    goal.updated_at = decision.at;
  }
}

function setSafetyOverride(roadmap, change, decision) {
  if (decision.source === "provisional") refused("A model's proposal cannot set or clear the safety override.");
  if (change.reason === null) {
    roadmap.safety_override = null;
    return;
  }
  roadmap.safety_override = { reason: text(change.reason, "change.reason", ROADMAP_LIMITS.text), since_at: decision.at, decision_id: decision.decision_id, source: decision.source };
}

function emptyRoadmap(at, decisionId) {
  return { version: CASE_ROADMAP_VERSION, goals: [], safety_override: null, applied_decisions: [], updated_at: at, updated_by_decision: decisionId };
}

/**
 * Applies one decision to a roadmap (null when the case has none yet) and returns the new roadmap; the input is not changed.
 * Every change is checked against who may make it before any is kept, so a decision applies whole or not at all. A decision
 * replayed with the same id and content returns the roadmap unchanged; the same id with other content is refused. Decisions
 * come in time order: one dated before the plan's last change is refused, and so is one dated more than a day after `now`
 * when a clock is given.
 */
export function applyRoadmapDecision(previous, decision, { now = null } = {}) {
  validateDecision(decision);
  const read = readCaseRoadmap(previous);
  if (read.problem) fail("This version can't read the case's stored plan; repair it before recording a decision.", read.problem);
  const current = read.roadmap;
  const digest = roadmapDecisionDigest(decision);
  const earlier = current?.applied_decisions.find((entry) => entry.decision_id === decision.decision_id);
  if (earlier) {
    if (earlier.digest !== digest) fail(`Decision ${decision.decision_id} was already applied with other content.`, "ROADMAP_DECISION_CONFLICT");
    return current;
  }
  if (current && Date.parse(decision.at) < Date.parse(current.updated_at)) {
    fail(`Decision ${decision.decision_id} is dated before the plan's last change; decisions are recorded in time order.`, "ROADMAP_DECISION_OUT_OF_ORDER");
  }
  if (now !== null && Date.parse(decision.at) > Date.parse(now) + ROADMAP_LIMITS.future_ms) {
    fail(`Decision ${decision.decision_id} is dated in the future.`, "ROADMAP_DECISION_IN_FUTURE");
  }
  const roadmap = current ?? emptyRoadmap(decision.at, decision.decision_id);
  const touched = new Set();
  for (const [index, change] of decision.changes.entries()) {
    object(change, `decision.changes[${index}]`);
    if (change.op === "add") addGoal(roadmap, change, decision);
    else if (change.op === "update") updateGoal(roadmap, change, decision, touched);
    else if (change.op === "order") orderGroup(roadmap, change, decision);
    else if (change.op === "safety_override") setSafetyOverride(roadmap, change, decision);
    else fail(`decision.changes[${index}].op is invalid.`);
    compactRanks(roadmap);
  }
  roadmap.applied_decisions.push({ decision_id: decision.decision_id, at: decision.at, source: decision.source, digest, turn_id: decision.turn_id ?? null });
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
const confirmed = (goal) => goal.priority_source !== "provisional";

// What each kind of track is, as a reader of the plan needs it said: beside the aim, never an exercise within it.
const TRACK_NOTES = Object.freeze({
  independent_track: "Help from outside (people, groups or services): separately available; not an exercise, and reparenting does not replace it.",
  safety_track: "Independent safety services or an urgent safety need: separately available; not an exercise. Everyday protective acts the person takes for themselves belong within the aim when that frame is welcome.",
  medical_track: "Medical or specialist care: separately available; not an exercise, and reparenting does not replace it."
});

function safetyOverride(state) {
  const reasons = [];
  if (state.roadmap?.safety_override) reasons.push(state.roadmap.safety_override.reason);
  if (state.threat_pathway?.current?.level === "IMMINENT_OPERATIONAL_DANGER") reasons.push("The record's threat pathway shows imminent operational danger.");
  return {
    ordinary_order_suspended: reasons.length > 0,
    reasons,
    ...(state.roadmap?.safety_override ? { set_by: state.roadmap.safety_override.source } : {}),
    note: "A safety need or withdrawn consent comes before this order while it lasts, whether or not it is recorded here."
  };
}

function episodeView(episode) {
  return episode ? { id: episode.id, target: episode.target, route: episode.route, next_question: episode.next_question, started_turn_id: episode.started_turn_id } : null;
}

function recordedPlan(state, roadmap) {
  const goals = roadmap.goals;
  const active = goals.filter((goal) => goal.status === "active");
  const children = (parentId) => active.filter((goal) => goal.parent_id === parentId && !isTrack(goal)).sort(byRank);
  const primary = active.filter((goal) => goal.kind === "primary_aim").sort(byRank);
  const tracks = active.filter(isTrack).sort(byRank);
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
  // The step being worked on: a confirmed goal linked to the operational episode, else the first confirmed step under the
  // first confirmed aim; a model's proposal only when nothing the client or an authorized plan set is there.
  const episode = state.current_episode ?? null;
  const serving = episode ? active.filter((goal) => goal.serves_episode_id === episode.id) : [];
  const linked = serving.filter((goal) => reached.has(goal.id));
  const firstAim = primary.find(confirmed) ?? primary[0] ?? null;
  const steps = [];
  const walk = (parentId) => {
    for (const goal of children(parentId)) {
      if (goal.kind === "actionable_step") steps.push(goal);
      else walk(goal.id);
    }
  };
  if (firstAim) walk(firstAim.id);
  const step = linked.find(confirmed) ?? steps.find(confirmed) ?? linked[0] ?? steps[0] ?? null;
  const episodeLink = !episode ? "no_episode"
    : step && linked.includes(step) ? "linked"
      : serving.length ? (linked.length ? "linked_to_a_proposal" : "held_by_parent")
        : active.some((goal) => goal.serves_episode_id && goal.serves_episode_id !== episode.id) ? "stale" : "unlinked";
  const safety = safetyOverride(state);
  const anyConfirmed = goals.some(confirmed);
  return {
    status: anyConfirmed ? "recorded" : "proposals_only",
    note: anyConfirmed
      ? "The plan recorded in this case. Each goal says whose priority it is; a model's proposal is not a decision."
      : "Only a model's proposals are recorded for this case: nothing here is a decision, and the primary aim is the client's to choose or an authorized person's to record. Present every part as a proposal.",
    primary: primary.map(goalView),
    now: {
      step: step ? goalView(step) : null,
      current_episode: episodeView(episode),
      episode_link: episodeLink,
      ...(safety.ordinary_order_suspended ? { waits_for_safety: true } : {})
    },
    within,
    tracks: tracks.map((goal) => ({ ...goalView(goal), note: TRACK_NOTES[goal.kind] })),
    waiting: goals.filter((goal) => ["parked", "blocked"].includes(goal.status)).map(goalView),
    held_by_parent: held,
    finished: goals.filter((goal) => ["completed", "superseded"].includes(goal.status))
      .map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, priority_source: goal.priority_source, ...(goal.status_reason ? { why: goal.status_reason } : {}) })),
    priorities_change_when: active.filter((goal) => goal.review_condition)
      .map((goal) => ({ goal_id: goal.id, review_condition: goal.review_condition, priority_source: goal.priority_source })),
    sources: Object.fromEntries(ROADMAP_PRIORITY_SOURCES.map((source) => [source, goals.filter((goal) => goal.priority_source === source).length])),
    safety,
    updated_at: roadmap.updated_at
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
 * what waits and why, when priorities would change, whose priority each one is), a reconstruction from the record labeled a
 * proposal and never stored when nothing is recorded, or `unavailable` with a content-free problem code when a stored plan
 * can't be read by this version. Takes a case state.
 */
export function projectCasePlan(state) {
  object(state, "caseState");
  if (state.roadmap === null || state.roadmap === undefined) return Object.freeze(reconstruction(state));
  const read = readCaseRoadmap(state.roadmap);
  if (read.problem) {
    return Object.freeze({
      status: "unavailable",
      problem: read.problem,
      note: "A plan is stored for this case but this version can't read it. Nothing here is the plan: don't present a plan as recorded, and read the case state directly."
    });
  }
  return Object.freeze(recordedPlan(state, read.roadmap));
}
