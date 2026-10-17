import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { projectEvidenceAuthority } from "../case-state/evidence-authority.mjs";

// The plan in the case record (issue #172, change B): `case_state.roadmap`, a ranked, revisable set of goals, each of which
// says whose it is (`priority_source`): the client's, an authorized plan's, or a model's proposal. Deterministic: nothing here
// reads text for meaning or calls a model. The design and the rules on who can change what are in
// docs/superpowers/specs/2026-10-17-case-roadmap.md.

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
  // A decision may be dated at most this far ahead of the clock it is checked against: room for clocks that differ a little,
  // not for a wrong date.
  future_ms: 5 * 60 * 1000
});

const GOAL_ID = /^goal:[a-z0-9][a-z0-9_-]{0,79}$/u;
// At most 120 characters, so the state diff a decision records (`roadmap:<decision id>`) fits the store's id limit.
const DECISION_ID = /^[A-Za-z0-9:_-]{1,120}$/u;
const EXACT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
// Statuses that need a reason, so a reader can say why a goal waits.
const REASON_REQUIRED = new Set(["parked", "blocked", "superseded"]);
const NOTE_FIELDS = Object.freeze(["review_condition", "expected_progress", "next_step_tests", "uncertainty"]);
const TEXT_LIST_FIELDS = Object.freeze(["blockers", "counterevidence"]);
const UPDATABLE_FIELDS = Object.freeze(["title", "status", "status_reason", "client_agreement", "evidence_refs", "serves_episode_id", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS]);
// What the client decides about a goal that is theirs or that they answered (agreed to or declined): no other source changes
// these.
const CLIENT_OWNED_FIELDS = new Set(["title", "status", "status_reason", "client_agreement", "review_condition", "serves_episode_id", "rank"]);
// On such a goal another source keeps every item of these lists and only adds to them...
const ADD_ONLY_FIELDS = Object.freeze(["evidence_refs", ...TEXT_LIST_FIELDS]);
// ...and writes these working notes only while they are empty.
const SET_WHILE_EMPTY_FIELDS = Object.freeze(["expected_progress", "next_step_tests", "uncertainty"]);
// The fields whose changes the history records under their own names; the other working notes share a "notes" entry. On any
// goal, another source can't change a field whose latest entry is the client's. A status and its reason count as one.
const OWN_ENTRY_FIELDS = Object.freeze(["title", "status", "status_reason", "rank", "client_agreement", "review_condition", "serves_episode_id"]);
const GOAL_FIELDS = Object.freeze(["id", "title", "kind", "parent_id", "status", "status_reason", "rank", "priority_source", "client_agreement",
  "evidence_refs", ...TEXT_LIST_FIELDS, ...NOTE_FIELDS, "serves_episode_id", "created_at", "updated_at", "history", "history_dropped"]);
const HISTORY_FIELDS = new Set(["created", ...OWN_ENTRY_FIELDS, "priority_source", "notes"]);
// Articles a title may start with, in English and French ("l" is what "l'" leaves), dropped when titles are compared.
const LEADING_ARTICLES = new Set(["a", "an", "the", "le", "la", "les", "l", "un", "une", "des"]);
const SOURCE_NAME = Object.freeze({ authorized_plan: "An authorized plan", provisional: "A model's proposal" });

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

// An exact UTC time as JavaScript writes it, such as 2026-10-18T10:00:00.000Z, and a real one: nothing looser, no 30 February
// and no 24:00, so dates compare as written.
function timestamp(value, name) {
  const parsed = typeof value === "string" && EXACT_UTC.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(`${name} must be an ISO 8601 UTC time written as 2026-10-18T10:00:00.000Z.`);
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
// A goal that is the client's, or that the client agreed to or declined, is the client's to change.
const clientConfirmed = (goal) => goal.priority_source === "client" || ["agreed", "declined"].includes(goal.client_agreement);
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// A title as the declined-goal check compares it: accents and case folded, punctuation and spacing ignored, a leading
// article dropped.
function normalizedTitle(title) {
  const words = title.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("und").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (words.length > 1 && LEADING_ARTICLES.has(words[0])) words.shift();
  return words.join(" ");
}

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

// Histories are bounded. Working notes go first, then the oldest entries, but never the creation entry or the latest entry
// of a field, which says who decided it last.
function trimHistory(goal) {
  while (goal.history.length > ROADMAP_LIMITS.history) {
    const latest = new Set();
    const fields = new Set();
    for (let index = goal.history.length - 1; index > 0; index -= 1) {
      const { field } = goal.history[index];
      if (field !== "notes" && !fields.has(field)) {
        fields.add(field);
        latest.add(index);
      }
    }
    const notes = goal.history.findIndex((entry, index) => index > 0 && entry.field === "notes");
    const oldest = goal.history.findIndex((entry, index) => index > 0 && !latest.has(index));
    goal.history.splice(notes > 0 ? notes : oldest > 0 ? oldest : 1, 1);
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
  try {
    const roadmap = structuredClone(value);
    if (Array.isArray(roadmap.applied_decisions) && roadmap.applied_decisions.length > ROADMAP_LIMITS.applied_decisions) {
      roadmap.applied_decisions = roadmap.applied_decisions.slice(-ROADMAP_LIMITS.applied_decisions);
    }
    for (const goal of Array.isArray(roadmap.goals) ? roadmap.goals : []) {
      if (goal && Array.isArray(goal.history) && Number.isSafeInteger(goal.history_dropped)) trimHistory(goal);
    }
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

// Whether the latest history entry of `field` is the client's. A status and its reason count as one field.
function clientDecidedLast(goal, field) {
  const fields = ["status", "status_reason"].includes(field) ? ["status", "status_reason"] : [field];
  for (let index = goal.history.length - 1; index > 0; index -= 1) {
    if (fields.includes(goal.history[index].field)) return goal.history[index].source === "client";
  }
  return false;
}

// Whether an active goal that is the client's, or that the client agreed to, sits anywhere beneath `goal`.
function holdsClientGoal(roadmap, goal) {
  const beneath = new Set([goal.id]);
  for (let grown = true; grown;) {
    grown = false;
    for (const other of roadmap.goals) {
      if (other.parent_id === null || !beneath.has(other.parent_id) || beneath.has(other.id)) continue;
      if (other.status === "active" && clientConfirmed(other)) return true;
      beneath.add(other.id);
      grown = true;
    }
  }
  return false;
}

// Why a decision of `source` may not change `field` of `goal`, in a few words, or null when it may. The client may change
// anything. A model's proposal changes only proposals the client hasn't answered. No other source changes the client-owned
// fields of a goal that is the client's or that the client answered, a field the client decided last, or the status or place
// of a goal that holds a goal of the client's beneath it.
function barrier(roadmap, source, goal, field) {
  if (source === "client") return null;
  if (source === "provisional" && (goal.priority_source !== "provisional" || clientConfirmed(goal))) return "it is not a proposal the client hasn't answered";
  if (clientConfirmed(goal) && CLIENT_OWNED_FIELDS.has(field)) return "the client chose or answered it";
  if (OWN_ENTRY_FIELDS.includes(field) && clientDecidedLast(goal, field)) return `the client decided its ${field === "status_reason" ? "status" : field.replaceAll("_", " ")} last`;
  if ((field === "status" || field === "rank") && holdsClientGoal(roadmap, goal)) return "a goal of the client's sits beneath it";
  return null;
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
// never leaves a gap. Renumbering keeps every relative order and records nothing.
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

// Whose goal it is changes only when the client agrees to it, or when an authorized plan adopts a model's proposal.
function endorse(goal, decision, to) {
  pushHistory(goal, historyEntry(decision, "priority_source", goal.priority_source, to));
  goal.priority_source = to;
}

// Goals that aren't finished: active, parked or blocked.
const UNFINISHED_STATUSES = new Set(["active", "parked", "blocked"]);

// Two goals that aren't finished never share a title, compared as the declined-goal check compares titles. So a decline
// reaches the one goal with its title, and no equivalent goal stays active under another id. Whoever wants such a goal
// changes the one that exists; a finished goal's title can be used again.
function refuseDuplicateTitle(roadmap, title, except = null) {
  const wanted = normalizedTitle(title);
  const other = roadmap.goals.find((goal) => goal !== except && UNFINISHED_STATUSES.has(goal.status) && normalizedTitle(goal.title) === wanted);
  if (other) fail(`Goal ${other.id} already has this title; change that goal instead.`, "ROADMAP_DUPLICATE_TITLE");
}

// A goal the client declined isn't offered again by anyone but the client: not under another id, and not as another goal's
// new title.
function refuseDeclinedTitle(roadmap, title, except = null) {
  const wanted = normalizedTitle(title);
  if (roadmap.goals.some((goal) => goal !== except && goal.client_agreement === "declined" && normalizedTitle(goal.title) === wanted)) {
    refused("The client declined a goal with this title; only the client can bring it back.");
  }
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
  if (decision.source !== "client") refuseDeclinedTitle(roadmap, input.title);
  if (UNFINISHED_STATUSES.has(input.status ?? "active")) refuseDuplicateTitle(roadmap, input.title);
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
  const adopt = Object.hasOwn(set, "adopt");
  const fields = Object.keys(set).filter((field) => field !== "adopt");
  if (!fields.length && !adopt) fail("change.set is empty.");
  // An authorized plan adopts a model's proposal the client hasn't answered: the goal becomes the authorized plan's, and
  // nothing else changes, its place included.
  if (adopt) {
    if (set.adopt !== true) fail("change.set.adopt can only be true.");
    if (decision.source !== "authorized_plan") refused("Only an authorized plan adopts a goal.");
    if (goal.priority_source !== "provisional" || clientConfirmed(goal)) refused(`Only a model's proposal the client hasn't answered can be adopted; ${goal.id} is not one.`);
  }
  for (const field of fields) {
    if (!UPDATABLE_FIELDS.includes(field)) fail(`${field} cannot be changed; supersede the goal and add another instead.`);
    if (sameValue(goal[field], set[field])) continue;
    const reason = barrier(roadmap, decision.source, goal, field);
    if (reason) refused(`${SOURCE_NAME[decision.source]} cannot change the ${field} of ${goal.id}: ${reason}; the client can.`);
  }
  if (Object.hasOwn(set, "client_agreement") && decision.source !== "client" && ["agreed", "declined"].includes(set.client_agreement)) {
    refused("Only the client can agree to or decline a goal.");
  }
  // On a goal the client chose or answered, another source only adds: references and list items stay, and a working note is
  // written only while it is empty.
  if (decision.source !== "client" && clientConfirmed(goal)) {
    for (const field of ADD_ONLY_FIELDS) {
      if (!Object.hasOwn(set, field) || sameValue(goal[field], set[field])) continue;
      if (!Array.isArray(set[field])) fail(`change.set.${field} must be a bounded list.`);
      if (goal[field].some((item) => !set[field].includes(item))) refused(`${SOURCE_NAME[decision.source]} can add to the ${field} of ${goal.id}, not take any away; the client chose or answered it.`);
    }
    for (const field of SET_WHILE_EMPTY_FIELDS) {
      if (Object.hasOwn(set, field) && !sameValue(goal[field], set[field]) && goal[field] !== "") {
        refused(`${SOURCE_NAME[decision.source]} can write the ${field} of ${goal.id} only while it is empty; the client chose or answered it.`);
      }
    }
  }
  if (decision.source !== "client" && Object.hasOwn(set, "title") && set.title !== goal.title) {
    refuseDeclinedTitle(roadmap, text(set.title, "change.set.title", ROADMAP_LIMITS.title), goal);
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
  // A new title, or a finished goal brought back, must not repeat the title of another goal that isn't finished.
  if (UNFINISHED_STATUSES.has(goal.status) && (goal.title !== before.title || !UNFINISHED_STATUSES.has(before.status))) refuseDuplicateTitle(roadmap, goal.title, goal);
  const changed = UPDATABLE_FIELDS.filter((field) => !sameValue(before[field], goal[field]));
  if (!changed.length && before.rank === goal.rank && !adopt) return;
  // Every change goes in the history under the deciding source; a reason changed with its status goes with the status entry.
  for (const field of ["title", "status"]) if (before[field] !== goal[field]) pushHistory(goal, historyEntry(decision, field, before[field], goal[field]));
  if (before.status === goal.status && before.status_reason !== goal.status_reason) pushHistory(goal, historyEntry(decision, "status_reason", before.status_reason, goal.status_reason));
  if (before.rank !== goal.rank) pushHistory(goal, historyEntry(decision, "rank", before.rank, goal.rank));
  for (const field of ["client_agreement", "review_condition", "serves_episode_id"]) {
    if (before[field] !== goal[field]) pushHistory(goal, historyEntry(decision, field, before[field], goal[field]));
  }
  const notes = changed.filter((field) => !OWN_ENTRY_FIELDS.includes(field));
  if (notes.length) pushHistory(goal, historyEntry(decision, "notes", null, notes.sort().join(",")));
  if (decision.source === "client" && goal.client_agreement === "agreed" && before.client_agreement !== "agreed" && goal.priority_source !== "client") endorse(goal, decision, "client");
  if (adopt) endorse(goal, decision, "authorized_plan");
  goal.updated_at = decision.at;
}

// The positions of a longest run of goals that an order keeps in their old order (old ranks increasing): the goals outside it
// are the ones the order moves. Of runs equally long, the one found with each run's last old rank kept as low as possible, so
// a goal put first counts as moved rather than the goals it passes.
function keptInOrder(ranks) {
  const tails = [];
  const previous = ranks.map(() => -1);
  ranks.forEach((rank, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ranks[tails[middle]] < rank) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const kept = new Set();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) kept.add(index);
  return kept;
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
  // Another source can't slip a goal ahead of one it may not move, or move that goal: the goals ahead of it stay the same.
  if (decision.source !== "client") {
    for (const goal of members) {
      const reason = barrier(roadmap, decision.source, goal, "rank");
      if (!reason) continue;
      const before = members.filter((other) => other.rank < goal.rank).map((other) => other.id).sort();
      const after = change.goal_ids.slice(0, change.goal_ids.indexOf(goal.id)).sort();
      if (!sameValue(before, after)) refused(`${SOURCE_NAME[decision.source]} cannot change which goals come before ${goal.id}: ${reason}; the client can.`);
    }
  }
  // The history records the goals the order moves; the others are only renumbered, which records nothing.
  const ordered = change.goal_ids.map((id) => members.find((goal) => goal.id === id));
  const kept = keptInOrder(ordered.map((goal) => goal.rank));
  ordered.forEach((goal, index) => {
    const rank = index + 1;
    if (goal.rank !== rank && !kept.has(index)) {
      pushHistory(goal, historyEntry(decision, "rank", goal.rank, rank));
      goal.updated_at = decision.at;
    }
    goal.rank = rank;
  });
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
 * come in time order: one dated before the plan's last change is refused, and so is one dated more than five minutes after
 * `now` when a clock is given.
 */
export function applyRoadmapDecision(previous, decision, { now = null } = {}) {
  validateDecision(decision);
  const read = readCaseRoadmap(previous);
  if (read.problem) fail("This case's plan was written by another version of InnerSignal, which this one can't read; record decisions on it with that version.", read.problem);
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
// A goal the client declined keeps whose it was; the view says the client declined it, never that it is the client's choice.
const DECLINED_LABEL = Object.freeze({
  client: "the client chose it earlier and has since declined it",
  authorized_plan: "an authorized plan; the client declined it",
  provisional: "a model's proposal; the client declined it"
});
const sourceMeans = (goal) => (goal.client_agreement === "declined" ? DECLINED_LABEL : SOURCE_LABEL)[goal.priority_source];

function goalView(goal) {
  return {
    id: goal.id,
    title: goal.title,
    kind: goal.kind,
    status: goal.status,
    rank: goal.rank,
    priority_source: goal.priority_source,
    source_means: sourceMeans(goal),
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

// The view lists goals by whose they are, the client's first, then an authorized plan's, then a model's proposals, each in its
// recorded order. An authorized plan can't change the client's order, and a client who wants another goal first agrees to it,
// which makes it theirs; the served rules already put the client's deliberate reprioritization first.
const ENDORSEMENT_ORDER = Object.freeze({ client: 0, authorized_plan: 1, provisional: 2 });
const inViewOrder = (left, right) => ENDORSEMENT_ORDER[left.priority_source] - ENDORSEMENT_ORDER[right.priority_source] || left.rank - right.rank;

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
  const children = (parentId) => active.filter((goal) => goal.parent_id === parentId && !isTrack(goal)).sort(inViewOrder);
  const primary = active.filter((goal) => goal.kind === "primary_aim").sort(inViewOrder);
  const tracks = active.filter(isTrack).sort(inViewOrder);
  const within = [];
  const steps = [];
  const collect = (parentId, depth) => {
    for (const goal of children(parentId)) {
      within.push({ ...goalView(goal), parent_id: goal.parent_id, depth });
      if (goal.kind === "actionable_step") steps.push(goal);
      collect(goal.id, depth + 1);
    }
  };
  for (const aim of primary) collect(aim.id, 1);
  // Active goals under a goal that waits are held by it; they are listed apart, never as current work.
  const reached = new Set([...primary, ...tracks].map((goal) => goal.id).concat(within.map((goal) => goal.id)));
  const held = active.filter((goal) => !reached.has(goal.id)).sort(inViewOrder)
    .map((goal) => ({ ...goalView(goal), parent_id: goal.parent_id, why_held: "Its parent goal is not active." }));
  // The step being worked on: of the steps in the highest class that has one (the client's, else an authorized plan's, else a
  // model's proposals), the first linked to the operational episode, else the first in order.
  const episode = state.current_episode ?? null;
  const topClass = Math.min(...steps.map((goal) => ENDORSEMENT_ORDER[goal.priority_source]));
  const candidates = steps.filter((goal) => ENDORSEMENT_ORDER[goal.priority_source] === topClass);
  const step = (episode && candidates.find((goal) => goal.serves_episode_id === episode.id)) || candidates[0] || null;
  const serving = episode ? active.filter((goal) => goal.serves_episode_id === episode.id).sort(inViewOrder) : [];
  const episodeLink = !episode ? "no_episode"
    : step && step.serves_episode_id === episode.id ? "linked"
      : serving.length ? (serving.some((goal) => reached.has(goal.id)) ? "linked_elsewhere" : "held_by_parent")
        : active.some((goal) => goal.serves_episode_id && goal.serves_episode_id !== episode.id) ? "stale" : "unlinked";
  const safety = safetyOverride(state);
  // Only a model's proposals: some goal is active and none of the active goals is the client's or an authorized plan's.
  const proposalsOnly = active.length > 0 && active.every((goal) => goal.priority_source === "provisional");
  return {
    status: proposalsOnly ? "proposals_only" : "recorded",
    note: proposalsOnly
      ? "Every active goal in this plan is a model's proposal, not a decision; the primary aim is the client's to choose or an authorized person's to record. Present the active goals as proposals."
      : "The plan recorded in this case. Each goal says whose it is: the client's choice, an authorized plan, or a model's proposal, which is not a decision. Goals are listed by whose they are, the client's first, then an authorized plan's, then a model's proposals, each in its recorded order, and the current step is the first step of the highest of these that has one, or the one of them linked to the operational episode.",
    primary: primary.map(goalView),
    now: {
      step: step ? goalView(step) : null,
      current_episode: episodeView(episode),
      episode_link: episodeLink,
      episode_serves: serving.map((goal) => ({ goal_id: goal.id, priority_source: goal.priority_source })),
      ...(safety.ordinary_order_suspended ? { waits_for_safety: true } : {})
    },
    within,
    tracks: tracks.map((goal) => ({ ...goalView(goal), note: TRACK_NOTES[goal.kind] })),
    waiting: goals.filter((goal) => ["parked", "blocked"].includes(goal.status)).map(goalView),
    held_by_parent: held,
    finished: goals.filter((goal) => ["completed", "superseded"].includes(goal.status))
      .map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, priority_source: goal.priority_source, source_means: sourceMeans(goal), ...(goal.status_reason ? { why: goal.status_reason } : {}) })),
    priorities_change_when: active.filter((goal) => goal.review_condition).sort(inViewOrder)
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
 * what waits and why, when priorities would change, whose each goal is), a reconstruction from the record labeled a proposal
 * and never stored when nothing is recorded, or `unavailable` with a content-free problem code when a stored plan can't be
 * read by this version. Takes a case state.
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
