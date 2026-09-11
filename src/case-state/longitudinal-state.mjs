import { ValidationError } from "../core/errors.mjs";
import { INNER_SIGNAL_CONSTITUTION_VERSION } from "../therapy/constitution.mjs";
import {
  threatPathwayDecision,
  updateThreatPathwayState,
  validateThreatPathwayState
} from "../case-formulation/threat-pathway.mjs";
import {
  developmentalCapacityObservationIds,
  validateDevelopmentalCapacity
} from "../case-formulation/developmental-capacity.mjs";

export const CASE_STATE_VERSION = 1;
export const CASE_STATE_STATUSES = Object.freeze(["direct_report", "supervisor_report", "observed_pattern", "hypothesis", "inference", "unresolved_conflict"]);
export const CASE_STATE_CONFIDENCE = Object.freeze(["low", "medium", "high"]);
export const DECISION_RELEVANCE = Object.freeze(["low", "medium", "high"]);
export const TRAJECTORY_OBSERVABILITY = Object.freeze(["poor", "mixed", "adequate", "unknown"]);
export const CASE_STATE_LIMITS = Object.freeze({
  items: 500,
  contradiction_clusters: 200,
  answered_questions: 500,
  intervention_history: 500,
  retrieval_hints: 200,
  episode_list: 100,
  trajectory_domains: 100
});

const bounded = (value, name, max = 4000, { empty = false } = {}) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new ValidationError(`${name} must be bounded text.`);
  return value;
};
const record = (value, name) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${name} must be an object.`);
  return value;
};
const unique = (values) => [...new Set(values)];
const clone = (value) => structuredClone(value);

function validateSource(source, name) {
  record(source, name);
  bounded(source.kind, `${name}.kind`, 80);
  bounded(source.ref, `${name}.ref`, 240);
  if (source.turn_id != null) bounded(source.turn_id, `${name}.turn_id`, 160);
  if (source.recorded_at != null) bounded(source.recorded_at, `${name}.recorded_at`, 80);
  if (source.claimed_prior_consensus != null && typeof source.claimed_prior_consensus !== "boolean") throw new ValidationError(`${name}.claimed_prior_consensus must be boolean.`);
  return source;
}

export function validateStateItem(item, name = "caseState.items[]") {
  record(item, name);
  bounded(item.id, `${name}.id`, 160);
  bounded(item.domain, `${name}.domain`, 120);
  bounded(item.statement, `${name}.statement`);
  if (!CASE_STATE_STATUSES.includes(item.status)) throw new ValidationError(`${name}.status is invalid.`);
  if (!CASE_STATE_CONFIDENCE.includes(item.confidence)) throw new ValidationError(`${name}.confidence is invalid.`);
  validateSource(item.source, `${name}.source`);
  if (![true, false, null].includes(item.still_current)) throw new ValidationError(`${name}.still_current must be true, false, or null.`);
  if (!Array.isArray(item.supersedes) || item.supersedes.some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError(`${name}.supersedes must contain IDs.`);
  if (!DECISION_RELEVANCE.includes(item.decision_relevance)) throw new ValidationError(`${name}.decision_relevance is invalid.`);
  return item;
}

function validateContradiction(cluster, name) {
  record(cluster, name);
  bounded(cluster.id, `${name}.id`, 160);
  if (!Array.isArray(cluster.item_ids) || cluster.item_ids.length < 2 || cluster.item_ids.some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError(`${name}.item_ids must contain at least two IDs.`);
  bounded(cluster.question, `${name}.question`);
  if (!["open", "resolved"].includes(cluster.status)) throw new ValidationError(`${name}.status is invalid.`);
  if (!DECISION_RELEVANCE.includes(cluster.decision_relevance)) throw new ValidationError(`${name}.decision_relevance is invalid.`);
  return cluster;
}

function validateAnsweredQuestion(item, name) {
  record(item, name);
  bounded(item.id, `${name}.id`, 160);
  bounded(item.question, `${name}.question`);
  bounded(item.answer, `${name}.answer`);
  if (!Array.isArray(item.source_item_ids) || item.source_item_ids.some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError(`${name}.source_item_ids must contain IDs.`);
  if (![true, false, null].includes(item.still_current)) throw new ValidationError(`${name}.still_current must be true, false, or null.`);
  return item;
}

function validateEpisode(episode, name = "caseState.current_episode") {
  if (episode == null) return null;
  record(episode, name);
  for (const field of ["id", "target", "route", "prediction", "next_question", "started_turn_id"]) bounded(episode[field], `${name}.${field}`, 2400, { empty: field === "next_question" });
  if (episode.question_mode != null && !["none", "canonical", "canonical-pair"].includes(episode.question_mode)) throw new ValidationError(`${name}.question_mode is invalid.`);
  if (episode.ordered_questions != null) {
    if (!Array.isArray(episode.ordered_questions) || episode.ordered_questions.length > 2
        || episode.ordered_questions.some(value => typeof value !== "string" || !value.trim())) {
      throw new ValidationError(`${name}.ordered_questions must contain at most two non-empty questions.`);
    }
    if (episode.question_mode === "canonical-pair" && episode.ordered_questions.length !== 2) throw new ValidationError(`${name}.canonical-pair requires two ordered questions.`);
  }
  for (const field of ["constitutional_aim_ids", "adverse_signs", "stay_conditions", "switch_conditions", "stop_conditions", "source_item_ids"]) {
    if (!Array.isArray(episode[field]) || episode[field].length > CASE_STATE_LIMITS.episode_list || episode[field].some((value) => typeof value !== "string" || !value.trim())) throw new ValidationError(`${name}.${field} must contain bounded strings.`);
  }
  return episode;
}

function validateTrajectory(value, name = "caseState.trajectory_observability") {
  record(value, name);
  if (!TRAJECTORY_OBSERVABILITY.includes(value.overall)) throw new ValidationError(`${name}.overall is invalid.`);
  bounded(value.note, `${name}.note`);
  record(value.domains, `${name}.domains`);
  if (Object.keys(value.domains).length > CASE_STATE_LIMITS.trajectory_domains) throw new ValidationError(`${name}.domains exceeds the bounded domain limit.`);
  for (const [domain, state] of Object.entries(value.domains)) {
    bounded(domain, `${name}.domain`, 120);
    record(state, `${name}.domains.${domain}`);
    if (!TRAJECTORY_OBSERVABILITY.includes(state.observability)) throw new ValidationError(`${name}.domains.${domain}.observability is invalid.`);
    for (const field of ["intensity", "function", "duration", "timing", "delayed_effects", "external_observation", "note"]) {
      bounded(state[field] ?? "", `${name}.domains.${domain}.${field}`, 1200, { empty: true });
    }
  }
  return value;
}

export function createEmptyCaseState({ caseId = "local-case" } = {}) {
  return {
    schema_version: CASE_STATE_VERSION,
    case_id: bounded(caseId, "caseId", 120),
    constitution_ref: { version: INNER_SIGNAL_CONSTITUTION_VERSION },
    trajectory_observability: {
      overall: "unknown",
      note: "No longitudinal observability assessment has been recorded.",
      domains: {}
    },
    items: [],
    contradiction_clusters: [],
    answered_questions: [],
    intervention_history: [],
    current_episode: null,
    threat_pathway: null,
    developmental_capacity: null,
    retrieval_hints: []
  };
}

export function validateCaseState(value) {
  record(value, "caseState");
  if (value.schema_version !== CASE_STATE_VERSION) throw new ValidationError("caseState.schema_version is invalid.");
  bounded(value.case_id, "caseState.case_id", 120);
  record(value.constitution_ref, "caseState.constitution_ref");
  if (value.constitution_ref.version !== INNER_SIGNAL_CONSTITUTION_VERSION) throw new ValidationError("caseState constitution reference is stale or invalid.");
  validateTrajectory(value.trajectory_observability);
  for (const field of ["items", "contradiction_clusters", "answered_questions", "intervention_history", "retrieval_hints"]) {
    if (!Array.isArray(value[field])) throw new ValidationError(`caseState.${field} must be an array.`);
    if (value[field].length > CASE_STATE_LIMITS[field]) throw new ValidationError(`caseState.${field} exceeds the bounded item limit.`);
  }
  const ids = new Set();
  value.items.forEach((item, index) => {
    validateStateItem(item, `caseState.items[${index}]`);
    if (ids.has(item.id)) throw new ValidationError(`Duplicate case state item ${item.id}.`);
    ids.add(item.id);
  });
  const contradictionIds = new Set();
  value.contradiction_clusters.forEach((item, index) => {
    validateContradiction(item, `caseState.contradiction_clusters[${index}]`);
    if (contradictionIds.has(item.id)) throw new ValidationError(`Duplicate contradiction cluster ${item.id}.`);
    contradictionIds.add(item.id);
    if (item.item_ids.some((id) => !ids.has(id))) throw new ValidationError(`Contradiction cluster ${item.id} references an unknown item.`);
  });
  const questionIds = new Set();
  value.answered_questions.forEach((item, index) => {
    validateAnsweredQuestion(item, `caseState.answered_questions[${index}]`);
    if (questionIds.has(item.id)) throw new ValidationError(`Duplicate answered question ${item.id}.`);
    questionIds.add(item.id);
    if (item.source_item_ids.some((id) => !ids.has(id))) throw new ValidationError(`Answered question ${item.id} references an unknown item.`);
  });
  value.intervention_history.forEach((item, index) => validateStateItem(item, `caseState.intervention_history[${index}]`));
  value.retrieval_hints.forEach((item, index) => bounded(item, `caseState.retrieval_hints[${index}]`, 240));
  validateEpisode(value.current_episode);
  if (Object.hasOwn(value, "threat_pathway")) validateThreatPathwayState(value.threat_pathway);
  if (Object.hasOwn(value, "developmental_capacity") && value.developmental_capacity) {
    const ids = new Set(developmentalCapacityObservationIds(value.developmental_capacity));
    validateDevelopmentalCapacity(value.developmental_capacity, { issue: value.developmental_capacity.issue, observationIds: ids });
  }
  return value;
}

function mergeById(previous, incoming, validator, name) {
  const result = previous.map(clone);
  const positions = new Map(result.map((item, index) => [item.id, index]));
  for (const item of incoming ?? []) {
    validator(item, `${name}.${item?.id ?? "unknown"}`);
    if (positions.has(item.id)) result[positions.get(item.id)] = clone(item);
    else {
      positions.set(item.id, result.length);
      result.push(clone(item));
    }
  }
  return result;
}

export function applyCaseStatePatch(previous, patch = {}) {
  const before = clone(validateCaseState(previous));
  record(patch, "caseStatePatch");
  const next = {
    ...before,
    items: mergeById(before.items, patch.items, validateStateItem, "caseStatePatch.items"),
    intervention_history: mergeById(before.intervention_history, patch.intervention_history, validateStateItem, "caseStatePatch.intervention_history"),
    contradiction_clusters: mergeById(before.contradiction_clusters, patch.contradiction_clusters, validateContradiction, "caseStatePatch.contradiction_clusters"),
    answered_questions: mergeById(before.answered_questions, patch.answered_questions, validateAnsweredQuestion, "caseStatePatch.answered_questions"),
    retrieval_hints: unique([...(before.retrieval_hints ?? []), ...(patch.retrieval_hints ?? [])]),
    trajectory_observability: patch.trajectory_observability ? clone(patch.trajectory_observability) : before.trajectory_observability,
    current_episode: Object.hasOwn(patch, "current_episode") ? clone(patch.current_episode) : before.current_episode,
    threat_pathway: Object.hasOwn(patch, "threat_pathway") ? clone(patch.threat_pathway) : (before.threat_pathway ?? null),
    developmental_capacity: Object.hasOwn(patch, "developmental_capacity") ? clone(patch.developmental_capacity) : (before.developmental_capacity ?? null)
  };
  return validateCaseState(next);
}

export function recordClaimedPriorConsensus(previous, { id, domain, asserted_statement, target_item_id, source }) {
  const target = previous.items.find((item) => item.id === target_item_id);
  if (!target) throw new ValidationError("Claimed prior consensus target does not exist.");
  const claim = {
    id,
    domain,
    statement: `The client reports that a prior conclusion was settled: ${asserted_statement}`,
    status: "direct_report",
    confidence: "high",
    source: { ...source, claimed_prior_consensus: true },
    still_current: true,
    supersedes: [],
    decision_relevance: target.decision_relevance
  };
  const cluster = {
    id: `conflict-${target_item_id}-${id}`,
    item_ids: [target_item_id, id],
    question: "Does new independently grounded evidence resolve the earlier uncertainty, or is this only a claim that consensus already existed?",
    status: "open",
    decision_relevance: target.decision_relevance
  };
  return applyCaseStatePatch(previous, { items: [claim], contradiction_clusters: [cluster] });
}

function changedFields(before, after) {
  const fields = [];
  for (const key of unique([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) fields.push(key);
  }
  return fields;
}

export function diffCaseStates(previous, next) {
  const before = validateCaseState(clone(previous));
  const after = validateCaseState(clone(next));
  const priorItems = new Map(before.items.map((item) => [item.id, item]));
  const additions = after.items.filter((item) => !priorItems.has(item.id)).map((item) => item.id);
  const updates = after.items.filter((item) => priorItems.has(item.id) && JSON.stringify(item) !== JSON.stringify(priorItems.get(item.id))).map((item) => ({ id: item.id, fields: changedFields(priorItems.get(item.id), item) }));
  const confidence_changes = updates.filter((item) => item.fields.includes("confidence")).map((item) => ({ id: item.id, from: priorItems.get(item.id).confidence, to: after.items.find((candidate) => candidate.id === item.id).confidence }));
  const priorClusters = new Map(before.contradiction_clusters.map((item) => [item.id, item]));
  const contradictions = after.contradiction_clusters.filter((item) => !priorClusters.has(item.id) || JSON.stringify(item) !== JSON.stringify(priorClusters.get(item.id))).map((item) => item.id);
  return Object.freeze({
    schema_version: 1,
    additions,
    updates,
    supersessions: after.items.filter((item) => item.supersedes.some((id) => !priorItems.get(item.id)?.supersedes.includes(id))).map((item) => ({ id: item.id, supersedes: item.supersedes })),
    contradictions,
    confidence_changes,
    provenance_changes: updates.filter((item) => item.fields.includes("source")).map((item) => item.id),
    answered_question_changes: changedFields(before.answered_questions, after.answered_questions).length ? after.answered_questions.map((item) => item.id) : [],
    current_episode_changed: JSON.stringify(before.current_episode) !== JSON.stringify(after.current_episode),
    threat_pathway_changed: JSON.stringify(before.threat_pathway ?? null) !== JSON.stringify(after.threat_pathway ?? null),
    developmental_capacity_changed: JSON.stringify(before.developmental_capacity ?? null) !== JSON.stringify(after.developmental_capacity ?? null),
    trajectory_observability_changed: JSON.stringify(before.trajectory_observability) !== JSON.stringify(after.trajectory_observability)
  });
}

export function projectCaseStateForInspection(state) {
  const value = clone(validateCaseState(state));
  return Object.freeze({
    constitution: value.constitution_ref,
    trajectoryObservability: value.trajectory_observability,
    currentEpisode: value.current_episode,
    threatPathway: value.threat_pathway ?? null,
    developmentalCapacity: value.developmental_capacity ?? null,
    factsAndHypotheses: value.items,
    contradictions: value.contradiction_clusters,
    settledAnswers: value.answered_questions,
    interventionHistory: value.intervention_history,
    retrievalHints: value.retrieval_hints,
    hiddenReasoningIncluded: false,
    rawTranscriptIncluded: false
  });
}

export function mergeRuntimeSnapshotIntoCaseState(previous, snapshot, { turnId, recordedAt = new Date().toISOString(), interventionContract = null } = {}) {
  const source = { kind: "current_turn_model_extraction", ref: turnId, turn_id: turnId, recorded_at: recordedAt };
  const items = [
    ...(snapshot?.direct_observations ?? []).map((observation) => ({
      id: `obs:${turnId}:${observation.id}`,
      domain: "runtime_observation",
      statement: observation.statement,
      status: "direct_report",
      confidence: "high",
      source,
      still_current: true,
      supersedes: [],
      decision_relevance: "medium"
    })),
    ...(snapshot?.hypotheses ?? []).map((hypothesis) => ({
      id: `hyp:${turnId}:${hypothesis.id}`,
      domain: "runtime_hypothesis",
      statement: hypothesis.claim,
      status: "hypothesis",
      confidence: CASE_STATE_CONFIDENCE.includes(hypothesis.confidence) ? hypothesis.confidence : "low",
      source,
      still_current: null,
      supersedes: [],
      decision_relevance: "medium"
    }))
  ];
  let currentEpisode = previous.current_episode;
  const primary = interventionContract?.primaryJob;
  const interventionHistory = [];
  if (primary?.id && primary?.title) {
    const continuing = previous.current_episode?.route === primary.id;
    const episodeId = continuing ? previous.current_episode.id : `episode:${turnId}`;
    const selected = interventionContract.selectedNodes?.find((node) => node.id === primary.id);
    const successSignals = selected?.successSignals?.filter((value) => typeof value === "string" && value.trim()) ?? [];
    const safetyVariables = interventionContract.variables ?? snapshot?.variables ?? {};
    const stopConditions = [
      ...(safetyVariables.dissociation === "high" ? ["high dissociation is present"] : []),
      ...(safetyVariables.orientation === "disoriented" ? ["orientation is impaired"] : []),
      ...(safetyVariables.ability_to_stop === "no" ? ["ability to stop is lost"] : []),
      ...(safetyVariables.ability_to_return === "no" ? ["ability to return is lost"] : []),
      ...(safetyVariables.present_safety === "unsafe" ? ["present safety becomes unsafe"] : []),
      ...(interventionContract?.threatPathway?.level === "IMMINENT_OPERATIONAL_DANGER" ? ["near-term operational violence risk is present"] : [])
    ];
    currentEpisode = {
      id: episodeId,
      target: snapshot?.user_goal || snapshot?.current_issue || primary.title,
      route: primary.id,
      prediction: successSignals[0] || `The selected route should produce observable movement toward ${primary.title.toLowerCase()}.`,
      next_question: interventionContract.nextQuestion ?? "",
      question_mode: interventionContract.questionContract?.mode ?? (interventionContract.nextQuestion ? "canonical" : "none"),
      ordered_questions: interventionContract.questionContract?.mode === "canonical-pair"
        ? [...interventionContract.questionContract.questions]
        : (interventionContract.nextQuestion ? [interventionContract.nextQuestion] : []),
      started_turn_id: continuing ? previous.current_episode.started_turn_id : turnId,
      constitutional_aim_ids: continuing ? previous.current_episode.constitutional_aim_ids : ["CARE", "LEADERSHIP", "PROTECTION", "INTEGRATION_VITALITY"],
      adverse_signs: continuing ? previous.current_episode.adverse_signs : ["reduced choice", "destabilization", "increasing alienation"],
      stay_conditions: successSignals.length ? successSignals : ["more choice or flexibility", "observable ordinary-life transfer"],
      switch_conditions: ["the prediction is not observed", "the route produces repeated low-information responses", "the client declines this route"],
      stop_conditions: stopConditions,
      source_item_ids: unique([...(continuing ? previous.current_episode.source_item_ids : []), ...items.map((item) => item.id)])
    };
    interventionHistory.push({
      id: `intervention:${episodeId}:${turnId}`,
      domain: "intervention_route",
      statement: `Selected ${primary.id}: ${primary.title}.`,
      status: "observed_pattern",
      confidence: "high",
      source,
      still_current: true,
      supersedes: [],
      decision_relevance: "medium"
    });
  }
  const assessment = snapshot?.threat_pathway ?? null;
  const threatPathway = assessment
    ? updateThreatPathwayState(previous.threat_pathway ?? null, assessment, threatPathwayDecision(assessment), { turnId, recordedAt })
    : (previous.threat_pathway ?? null);
  const currentDevelopmentalCapacity = snapshot?.developmental_capacity
    ? clone(snapshot.developmental_capacity)
    : (previous.developmental_capacity ?? null);
  return applyCaseStatePatch(previous, {
    items,
    intervention_history: interventionHistory,
    current_episode: currentEpisode,
    threat_pathway: threatPathway,
    developmental_capacity: currentDevelopmentalCapacity
  });
}
