import { checkBoundedSchema as check } from "./bounded-schema.mjs";
import { ValidationError } from "../core/errors.mjs";
import { deliveryAssessmentSchema, validateDeliveryAssessment, updateDeliveryAssessment, deliverySystemGuidance } from "./delivery-system-assessment.mjs";
import { immediateProtectionNeeded } from "./turn-task.mjs";

// Candidate engineering policy, not a clinical instrument or diagnosis.
export const MOVEMENT_SIGNALS = Object.freeze(["new_information", "specificity", "agency", "emotion_access", "need_access", "ordinary_life_transfer", "functional_change", "durable_movement"]);
export const HARM_SIGNALS = Object.freeze(["confusion", "dissociation", "fragmentation", "shame", "compulsion", "dependency", "destabilization", "reality_testing_instability"]);
export const FAILURE_SOURCES = Object.freeze(["FORMULATION_MISMATCH", "TARGET_MISMATCH", "METHOD_MISMATCH", "PACING_MISMATCH", "DELIVERY_MISMATCH", "REPRESENTATION_MISMATCH", "STATE_CONSTRAINT", "PROCESS_COMPLETE"]);
export const REPRESENTATION_MODES = Object.freeze(["CLEAR", "EXPERIENTIAL", "BRIDGE"]);
export const REPRESENTATION_CHANNELS = Object.freeze(["PROSE_ANALYSIS", "FELT_SENSE_BODY", "IMAGE_DRAWING", "METAPHOR_STORY_POEM", "ENACTMENT_ROLE_DIALOGUE", "MOVEMENT_GESTURE"]);
export const REPRESENTATION_TRANSITIONS = Object.freeze(["INITIAL", "CONTINUE", "SWITCH", "STAY_SYMBOLIC", "TRANSLATE_TO_PLAIN"]);
export const CASE_RISK_SIGNALS = Object.freeze(["significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator", "instrumental_partner_seeking", "romance_regulation_risk_cleared"]);
const SIGNALS = [...MOVEMENT_SIGNALS, ...HARM_SIGNALS, "prediction_failed", "praise", "relief", "repetition", "low_information", "complexity_without_information", "verbosity_without_information", "expressiveness_without_information", "expressiveness", "vivid_imagery", "felt_intensity", "representation_mismatch", "representation_declined", "representation_switch_requested", "translation_requested", "mechanism_supported", "delivery_problem", "dose_problem", "external_stabilization_needed", "process_complete", "alternative_supported", "significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator", "instrumental_partner_seeking", "new_process", "romance_regulation_risk_cleared"];
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const str = { type: "string", minLength: 1, maxLength: 1200 };
const id = { type: "string", minLength: 1, maxLength: 120 };
const choice = values => ({ type: "string", enum: values });
const list = (items, maxItems = 24) => ({ type: "array", items, maxItems });
const nullable = schema => ({ anyOf: [{ type: "null" }, schema] });
const refs = { ...list(id, 12), minItems: 1 };
export const strategySchema = record({
  process_id: id, target: str, formulation: str, family: str, node_id: id,
  selection_reason: str, observation_ids: refs,
  predictions: { ...list(record({ id, sign: choice(MOVEMENT_SIGNALS), description: str, horizon: choice(["immediate", "durable"]) }), 8), minItems: 1 },
  adverse_signs: { ...list(choice(HARM_SIGNALS), 8), minItems: 1 }
});
export const representationSchema = record({
  process_id: id,
  mode: choice(REPRESENTATION_MODES),
  channel: choice(REPRESENTATION_CHANNELS),
  transition: choice(REPRESENTATION_TRANSITIONS),
  selection_reason: str,
  observation_ids: refs,
  predicted_useful_signals: { ...list(choice(MOVEMENT_SIGNALS), 8), minItems: 1 }
});

export function validateRepresentationSelection(value, observationIds) {
  if (value == null) return null;
  check(value, representationSchema, "representation");
  if (value.mode === "CLEAR" && value.channel !== "PROSE_ANALYSIS") throw new ValidationError("CLEAR representation must use ordinary prose/analysis.");
  if (value.mode === "EXPERIENTIAL" && value.channel === "PROSE_ANALYSIS") throw new ValidationError("EXPERIENTIAL representation must use a non-prose channel.");
  if (value.transition === "TRANSLATE_TO_PLAIN" && value.mode !== "BRIDGE") throw new ValidationError("Plain-language translation must use BRIDGE mode.");
  if (value.transition === "STAY_SYMBOLIC" && (value.mode === "CLEAR" || value.channel === "PROSE_ANALYSIS")) throw new ValidationError("Staying symbolic requires a non-prose experiential form.");
  if (observationIds && value.observation_ids.some(ref => !observationIds.has(ref))) throw new ValidationError("Representation selection references unavailable observations.");
  return structuredClone(value);
}
export const pathUpdateSchema = nullable(record({
  strategy: nullable(strategySchema),
  response: choice(["not_observed", "meaningful", "declined"]),
  signals: list(record({ observation_id: id, kind: choice(SIGNALS), prediction_id: { type: "string", maxLength: 120 }, timing: choice(["immediate", "durable"]), severity: choice(["ordinary", "significant"]) })),
  failure_hypotheses: list(record({ kind: choice(FAILURE_SOURCES), observation_ids: refs }), 7),
  probe: nullable(record({ question: str, alternatives: { ...list(record({ hypothesis: str, if_observed: str, next_strategy: str }), 3), minItems: 2 } }))
}));

// Optional for preserved historical snapshots; current extraction declares it when relevant.
pathUpdateSchema.anyOf[1].properties.delivery_review = nullable(record({ process_id: id, node_id: id, assessment: deliveryAssessmentSchema }));
pathUpdateSchema.anyOf[1].properties.representation = nullable(representationSchema);

export function validatePathUpdate(value, observationIds) {
  if (value == null) return null;
  check(value, pathUpdateSchema, "path_update");
  if (value.representation != null) value.representation = validateRepresentationSelection(value.representation, observationIds);
  if (value.signals.some(signal => signal.kind === "reality_testing_instability" && signal.severity !== "significant")) throw new ValidationError("Reality-testing instability requires significant, directly supported evidence.");
  const referenced = [...(value.strategy?.observation_ids ?? []), ...(value.representation?.observation_ids ?? []), ...value.signals.map(s => s.observation_id), ...value.failure_hypotheses.flatMap(h => h.observation_ids)];
  if (observationIds && referenced.some(ref => !observationIds.has(ref))) throw new ValidationError("path_update references unavailable observations.");
  if (value.delivery_review != null) {
    const review = value.delivery_review;
    if (Object.keys(review).some(k => !["process_id", "node_id", "assessment"].includes(k))) throw new ValidationError("Undeclared delivery review field.");
    check(review.process_id, id, "delivery_review.process_id"); check(review.node_id, id, "delivery_review.node_id");
    validateDeliveryAssessment(review.assessment, observationIds);
  }
  const predictions = value.strategy?.predictions ?? [];
  if (new Set(predictions.map(p => p.id)).size !== predictions.length) throw new ValidationError("Prediction IDs must be unique within a strategy.");
  if (value.strategy && value.representation && value.strategy.process_id !== value.representation.process_id) throw new ValidationError("Representation selection must match the proposed strategy process.");
  return structuredClone(value);
}

const unique = values => [...new Set(values)];
const key = strategy => JSON.stringify([strategy.process_id, strategy.node_id]);
const RECONSIDER = ["process", "formulation", "target", "external_stabilization", "mechanism", "pacing_delivery", "completion_checking_loop"];
const defaultProbe = "What, if anything, changed after that step, and was it useful in what you could feel, choose, or do?";
const rethinkProbe = "Are we missing what actually needs help here, or would support with the situation outside this exercise be more useful now?";
const representationProbe = "Would it be more useful to keep this plain and direct, try a different experiential form, or translate what is already here between the two?";
const representationIdentity = value => value ? JSON.stringify([value.process_id, value.mode, value.channel]) : null;

// Prior state is supplied only by the existing session snapshot, never by model output.
export function evaluatePathPerformance({ prior = null, update = null, variables = {}, observationIds = new Set(), invalidated = false }) {
  update = validatePathUpdate(update, observationIds);
  const state = prior ? structuredClone(prior) : { version: 1, sequence: 0, active: null, closed: [], risk_signals: [] };
  if (state.version !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || (!Array.isArray(state.closed) || state.closed.length > 12)) throw new ValidationError("Invalid path-performance session state.");
  if (state.active) {
    check(state.active.strategy, strategySchema, "prior.strategy");
    if (!Array.isArray(state.active.reviews) || !Number.isSafeInteger(state.active.misses) || !Number.isSafeInteger(state.active.unclear) || !Number.isSafeInteger(state.active.review_count) || (state.active.representation_switches != null && !Number.isSafeInteger(state.active.representation_switches)) || (state.active.representation_misses != null && !Number.isSafeInteger(state.active.representation_misses)) || [state.active.misses, state.active.unclear, state.active.review_count, state.active.representation_switches ?? 0, state.active.representation_misses ?? 0].some(n => n < 0)) throw new ValidationError("Invalid strategy episode counters.");
    if (state.active.representation_evidence_ids != null && !Array.isArray(state.active.representation_evidence_ids)) throw new ValidationError("Invalid representation evidence ledger.");
    if (state.active.representation != null) validateRepresentationSelection(state.active.representation);
    if (state.active.representation != null && state.active.representation.process_id !== state.active.strategy.process_id) throw new ValidationError("Prior representation selection does not match the active process.");
  }
  if (!state.active && !update?.strategy) state.untracked_reviews = (state.untracked_reviews ?? 0) + 1;
  const signals = update?.signals ?? [];
  const has = kind => signals.some(s => s.kind === kind);
  const riskKinds = CASE_RISK_SIGNALS.slice(0, 6);
  const consumedRisk = new Set(state.risk_observed_ids ?? (state.risk_signals ?? []).map(s => s.observation_id));
  const freshRiskSignals = signals.filter(s => !consumedRisk.has(s.observation_id));
  const processChanged = state.active && update?.strategy && update.strategy.process_id !== state.active.strategy.process_id && has("new_process");
  const clearRisk = freshRiskSignals.some(s => s.kind === "romance_regulation_risk_cleared") && freshRiskSignals.some(s => s.kind === "durable_movement" && s.timing === "durable") && freshRiskSignals.some(s => s.kind === "agency" && s.timing === "durable");
  const emergency = immediateProtectionNeeded(variables);
  const significantHarm = signals.some(s => HARM_SIGNALS.includes(s.kind) && s.severity === "significant");
  const harm = signals.some(s => HARM_SIGNALS.includes(s.kind));
  const old = state.active;
  // Evidence withdrawal invalidates conclusions; it never silently restarts the old exercise.
  if (invalidated && old) old.invalidated = true;
  const candidate = update?.strategy;
  const canReplace = old && candidate && key(candidate) !== key(old.strategy)
    && ((old.switch_pending && has("alternative_supported")) || processChanged) && !harm && !emergency;
  const previouslyFailed = candidate && state.closed.some(e => e.strategy_key === key(candidate) && ["STALLED", "ADVERSE"].includes(e.status));
  const retained = processChanged ? [...state.closed].reverse().find(e => e.strategy_key === key(candidate)) : null;
  const starts = Boolean(!old && candidate || canReplace && (!previouslyFailed || processChanged));
  if (starts) {
    if (old && state.closed.length >= 12 && !state.closed.some(e => e.episode_id === old.id)) throw new ValidationError("Strategy history capacity reached; retain prior evidence for reassessment instead of dropping failed routes.");
    if (old) state.closed = [...state.closed.filter(e => e.episode_id !== old.id), { episode_id: old.id, strategy_key: key(old.strategy), status: old.status, decision: old.decision, review_count: old.review_count, retained_episode: structuredClone(old) }];
    if (retained?.retained_episode) state.active = structuredClone(retained.retained_episode);
    else {
      state.sequence += 1;
      state.active = { delivery: null, representation: update?.representation ?? null, representation_switches: 0, representation_misses: 0, representation_evidence_ids: [], observed_ids: [], failure_evidence_ids: [], id: `strategy-${state.sequence}`, strategy: candidate, prediction_failures: Object.fromEntries(candidate.predictions.map(p => [p.id, 0])), misses: 0, unclear: 0, review_count: 0, reviews: [], switch_pending: false, invalidated: false, status: "UNCLEAR", decision: "PROBE" };
    }
  }
  const active = state.active;
  const proposedRepresentation = update?.representation ?? null;
  if (proposedRepresentation && (!active || proposedRepresentation.process_id !== active.strategy.process_id)) throw new ValidationError("Representation selection must match the active process.");
  const deliveryReview = update?.delivery_review;
  if (deliveryReview && (!active || deliveryReview.process_id !== active.strategy.process_id || deliveryReview.node_id !== active.strategy.node_id)) throw new ValidationError("Delivery review must match the active strategy process and path.");
  // Provider/method facts and replay tombstones are case-level; episodes carry only
  // the selected key. A topic/process change cannot launder provider risk.
  const deliveryLedger = state.delivery_system_state;
  const scopedLedger = deliveryLedger ? { ...deliveryLedger, selected: active?.delivery_assessment_key ?? null } : null;
  const deliveryResult = active ? updateDeliveryAssessment(scopedLedger, deliveryReview?.assessment, observationIds) : null;
  if (active && (deliveryReview || deliveryLedger)) {
    state.delivery_system_state = deliveryResult.state;
    active.delivery_assessment_key = deliveryResult.state.selected;
  }
  const deliveryAssessment = deliveryResult?.assessment ?? null;
  // This case-level constraint survives a process/topic change; episode failure does not.
  const previousRisk = state.risk_signals ?? [];
  const riskSignals = clearRisk ? [] : [...new Map([...previousRisk, ...freshRiskSignals.filter(s => riskKinds.includes(s.kind))].map(s => [s.kind, s])).values()];
  state.risk_observed_ids = unique([...consumedRisk, ...signals.filter(s => CASE_RISK_SIGNALS.includes(s.kind) || clearRisk && ["durable_movement", "agency"].includes(s.kind)).map(s => s.observation_id)]);
  if (state.risk_observed_ids.length > 512) throw new ValidationError("Case-risk evidence capacity reached; preserve reassessment history instead of replaying cleared evidence.");
  const romancePause = riskKinds.slice(0, 5).every(kind => riskSignals.some(s => s.kind === kind));
  state.risk_signals = riskSignals;
  const external = update?.failure_hypotheses.some(h => h.kind === "STATE_CONSTRAINT") || has("external_stabilization_needed") || romancePause || variables.inward_attention_effect === "worsens";
  const evaluated = old && !starts && !processChanged ? active : null;
  const consumed = new Set(evaluated?.observed_ids ?? []);
  const freshSignals = signals.filter(s => !consumed.has(s.observation_id));
  const hasFresh = kind => freshSignals.some(s => s.kind === kind);
  const duplicateOnly = signals.length > 0 && freshSignals.length === 0;
  const knownPredictions = new Set(evaluated?.strategy.predictions.map(p => p.id) ?? []);
  if (evaluated && signals.some(s => s.prediction_id && !knownPredictions.has(s.prediction_id))) throw new ValidationError("Signal refers to an unknown prior prediction.");
  const evidence = evaluated?.strategy.predictions.map(prediction => {
    const matches = update?.response === "meaningful" && evaluated.delivery?.node_id === evaluated.strategy.node_id && evaluated.delivery.review === evaluated.review_count ? freshSignals.filter(s => s.prediction_id === prediction.id) : [];
    const support = matches.filter(s => s.kind === prediction.sign && (prediction.horizon === "immediate" || s.timing === "durable"));
    const failed = matches.filter(s => s.kind === "prediction_failed" && (prediction.horizon === "immediate" || s.timing === "durable"));
    return { episode_id: evaluated.id, prediction_id: prediction.id, expected: prediction.description, sign: prediction.sign, horizon: prediction.horizon,
      observation_ids: unique(matches.map(s => s.observation_id)), signals: matches, result: failed.length ? "CONTRADICTED" : support.length ? "SUPPORTED" : "UNOBSERVED" };
  }) ?? [];
  // Evidence about a just-proposed strategy cannot retroactively confirm its predictions.
  const predictedMovement = evidence.some(e => e.result === "SUPPORTED");
  const predictionFailure = evidence.some(e => e.result === "CONTRADICTED");
  const lowInformation = freshSignals.some(s => ["repetition", "low_information", "complexity_without_information", "verbosity_without_information", "expressiveness_without_information"].includes(s.kind));
  const explicitRepresentationMismatch = freshSignals.some(s => ["representation_mismatch", "representation_declined", "representation_switch_requested"].includes(s.kind));
  const observedRepresentation = evaluated?.delivery?.representation ?? null;
  const representationTracked = Boolean(active?.representation || observedRepresentation || proposedRepresentation);
  const representationMismatch = representationTracked && (lowInformation || explicitRepresentationMismatch);
  const representationYieldedSignal = Boolean(observedRepresentation && update?.response === "meaningful"
    && freshSignals.some(signal => observedRepresentation.predicted_useful_signals.includes(signal.kind)));
  const representationChanged = Boolean(observedRepresentation && proposedRepresentation && representationIdentity(proposedRepresentation) !== representationIdentity(observedRepresentation));
  const representationTransitionRequested = Boolean(evaluated && proposedRepresentation && (hasFresh("translation_requested") || hasFresh("representation_switch_requested") || ["SWITCH", "TRANSLATE_TO_PLAIN"].includes(proposedRepresentation.transition)));
  const opportunity = update?.response === "meaningful" && Boolean(evaluated);
  const constraintOnlyReview = state.readiness_constraint_review === true;
  delete state.readiness_constraint_review;
  if (evaluated && !duplicateOnly && !((deliveryReview || constraintOnlyReview) && signals.length === 0 && update?.response !== "meaningful")) {
    evaluated.review_count += 1;
    evaluated.observed_ids = unique([...(evaluated.observed_ids ?? []), ...freshSignals.map(s => s.observation_id)]);
    if (evaluated.observed_ids.length > 512) throw new ValidationError("Strategy evidence capacity reached; preserve state and request a bounded reassessment, never reset counters.");
    evaluated.failure_evidence_ids = unique([...(evaluated.failure_evidence_ids ?? []),
      ...evidence.filter(e => e.result === "CONTRADICTED").flatMap(e => e.observation_ids),
      ...freshSignals.filter(s => !representationTracked && ["repetition", "low_information", "complexity_without_information", "verbosity_without_information", "expressiveness_without_information"].includes(s.kind)).map(s => s.observation_id)]);
    evaluated.representation_evidence_ids = unique([...(evaluated.representation_evidence_ids ?? []),
      ...freshSignals.filter(s => representationTracked && ["repetition", "low_information", "complexity_without_information", "verbosity_without_information", "expressiveness_without_information", "representation_mismatch", "representation_declined", "representation_switch_requested"].includes(s.kind)).map(s => s.observation_id)]);
    evaluated.prediction_failures ??= Object.fromEntries(evaluated.strategy.predictions.map(p => [p.id, 0]));
    for (const e of evidence) {
      if (e.result === "CONTRADICTED") evaluated.prediction_failures[e.prediction_id] += 1;
      else if (e.result === "SUPPORTED") evaluated.prediction_failures[e.prediction_id] = 0;
    }
    // UNOBSERVED is uncertainty, not a fabricated failed prediction. It still has a bounded review horizon.
    if (opportunity && (predictionFailure || lowInformation && !representationTracked)) evaluated.misses += 1;
    else if (opportunity && predictedMovement && !harm) evaluated.misses = 0;
    if ((!opportunity || !predictedMovement) && !predictionFailure && !representationMismatch && !representationYieldedSignal) evaluated.unclear += 1;
    else if (predictedMovement && !predictionFailure) evaluated.unclear = 0;
    if (opportunity && representationMismatch) evaluated.representation_misses = (evaluated.representation_misses ?? 0) + 1;
    else if (representationYieldedSignal && !harm) evaluated.representation_misses = 0;
  }
  let status = "UNCLEAR", decision = "PROBE", route = "reconsider", reason = "Prospective movement is not yet observed; one bounded fit/response probe is useful.";
  const hypotheses = update?.failure_hypotheses ?? [];
  const failures = hypotheses.map(h => ({ ...h, attribution: "provisional" }));
  const addFailure = kind => { if (!failures.some(h => h.kind === kind)) failures.push({ kind, observation_ids: unique([...(kind === "REPRESENTATION_MISMATCH" ? active?.representation_evidence_ids ?? [] : active?.failure_evidence_ids ?? []), ...signals.filter(s => HARM_SIGNALS.includes(s.kind) || s.kind === "external_stabilization_needed" || kind === "REPRESENTATION_MISMATCH" && ["repetition", "low_information", "complexity_without_information", "verbosity_without_information", "expressiveness_without_information", "representation_mismatch", "representation_declined", "representation_switch_requested"].includes(s.kind)).map(s => s.observation_id)]), attribution: active?.invalidated ? "evidence_withdrawn_reassessment_required" : "controller_review_required_not_diagnosis" }); };
  if (!active) {
    status = state.untracked_reviews >= 2 ? "STALLED" : "UNCLEAR";
    decision = state.untracked_reviews >= 2 ? "SWITCH" : "PROBE";
    reason = "No prospective strategy is available. Clarify the useful target before offering a therapeutic exercise.";
  }
  if (active && starts) { decision = "CONTINUE"; route = "continue"; reason = "Begin the prospective strategy; no outcome has yet been attributed to it."; }
  if (evaluated && predictedMovement && !predictionFailure && !lowInformation) { status = "MOVING"; decision = "CONTINUE"; route = "continue"; reason = "Observed movement matches a prospective prediction at its stated horizon."; }
  const repeatedPredictionFailure = Object.values(active?.prediction_failures ?? {}).some(count => count >= 2);
  const priorPredictionFailure = Object.values(active?.prediction_failures ?? {}).some(count => count > 0);
  const causalStalled = active && (active.misses >= 2 || repeatedPredictionFailure || active.unclear >= 2 || !representationTracked && (hasFresh("complexity_without_information") || hasFresh("expressiveness_without_information")) || active.switch_pending || active.invalidated);
  const representationStalled = active && representationTracked && ((active.representation_misses ?? 0) >= 2 || hasFresh("complexity_without_information") || hasFresh("expressiveness_without_information"));
  const stalled = Boolean(causalStalled || representationStalled);
  if (causalStalled) { status = "STALLED"; decision = "SWITCH"; route = "reconsider"; reason = active.invalidated ? "Supporting evidence was withdrawn; reassess before further intervention." : "Repeated prediction failure or unresolved causal measurement requires a material reconsideration."; addFailure("FORMULATION_MISMATCH"); }
  if (!causalStalled && representationStalled) { status = "STALLED"; decision = "PROBE"; route = "continue"; reason = "The delivered representation remained low-information or expressive without useful discrimination; change its form without resetting the causal episode."; }
  if (hypotheses.some(h => ["FORMULATION_MISMATCH", "TARGET_MISMATCH", "METHOD_MISMATCH"].includes(h.kind))) {
    status = "STALLED"; decision = "SWITCH"; route = "reconsider";
    reason = "Evidence-supported mismatch warrants changing the causal strategy rather than improving its wording.";
  }
  if (!stalled && decision !== "SWITCH" && !predictionFailure && !harm && has("mechanism_supported") && (has("delivery_problem") || has("dose_problem"))) {
    decision = "ADJUST_DELIVERY"; route = "continue"; reason = "Independent support for target/mechanism permits one change in manner or dose; cumulative evidence is retained.";
    addFailure(has("dose_problem") ? "PACING_MISMATCH" : "DELIVERY_MISMATCH");
  }
  if (representationMismatch) addFailure("REPRESENTATION_MISMATCH");
  if (active && proposedRepresentation && (representationChanged || representationTransitionRequested) && !causalStalled && !harm && !external && !emergency && !significantHarm
      && (representationMismatch || proposedRepresentation.transition !== "CONTINUE")) {
    decision = "SWITCH_REPRESENTATION"; route = "continue";
    reason = hasFresh("translation_requested") || proposedRepresentation.transition === "TRANSLATE_TO_PLAIN"
      ? "Translate the user-owned material into ordinary language without turning it into proof or discarding useful contact."
      : hasFresh("representation_declined")
        ? "The offered channel was declined; keep the process but use the person's selected alternative without typing them globally."
        : "A cheap change of representation can test delivery fit while preserving the process, predictions and cumulative evidence.";
  }
  if (active && representationMismatch && !proposedRepresentation && !causalStalled && !harm && !external && !emergency && !significantHarm
      && !predictionFailure && !priorPredictionFailure && !repeatedPredictionFailure && !active.invalidated
      && !hypotheses.some(h => ["FORMULATION_MISMATCH", "TARGET_MISMATCH", "METHOD_MISMATCH"].includes(h.kind))) {
    status = stalled ? "STALLED" : "UNCLEAR"; decision = "PROBE"; route = "continue";
    reason = "The present representation is not yielding discriminating information. Offer one cheap, consent-based channel choice before changing the causal strategy.";
  }
  if (active && hasFresh("representation_declined") && !proposedRepresentation && !causalStalled && !harm && !external && !emergency) {
    status = stalled ? "STALLED" : "UNCLEAR"; decision = "PROBE"; route = "continue";
    reason = "The offered representation was declined. Do not repeat it; invite a plain or otherwise acceptable route without withdrawing care.";
  }
  if (has("process_complete") && variables.leave_alone_eligibility === "eligible") { status = "MOVING"; decision = "CLOSE"; route = "leave"; reason = "This specific process is complete and renewed processing would maintain checking."; addFailure("PROCESS_COMPLETE"); }
  if (update?.response === "declined" && !hasFresh("representation_declined")) { status = "UNCLEAR"; decision = "SWITCH"; route = "reconsider"; reason = "The exercise was declined; stop that exercise without withdrawing care."; }
  if (harm) { status = "ADVERSE"; decision = "SWITCH"; route = "reconsider"; reason = "The exercise had an adverse response; stop and reconsider its fit without inferring a need for residential or supervised care."; }
  if (external) { status = harm ? "ADVERSE" : "STALLED"; decision = "SWITCH"; route = "external"; reason = "Evidenced state constraints make external stabilization the next strategy."; addFailure("STATE_CONSTRAINT"); }
  if (variables.actionable_problem === "present" && !emergency && !significantHarm) { route = "action"; if (decision === "CONTINUE" || decision === "PROBE") decision = "SWITCH"; reason = "A concrete external problem takes precedence; address the actionable conditions."; }
  if (romancePause) { route = "action"; reason = "Reduce instability and regulator/rescuer substitution through structured supervised non-romantic support."; }
  if (emergency || significantHarm) { status = "ADVERSE"; decision = "STOP_DEESCALATE"; route = "safety"; reason = "Significant destabilization or immediate protection need stops processing now."; addFailure("STATE_CONSTRAINT"); }
  if (["SWITCH", "PROBE"].includes(decision) && route === "action" && old?.strategy.node_id === "ROUTE.ACT_OUTWARD" && stalled && !romancePause) {
    route = "reconsider"; reason = "The external action strategy itself failed; reconsider its target, assumptions and feasibility before another action plan.";
  }
  if (duplicateOnly && evaluated && !harm && !external && !emergency && !stalled) {
    status = evaluated.status; decision = evaluated.decision;
    route = state.latest?.route ?? "reconsider";
    reason = "No new observation opportunity; replayed evidence cannot improve or worsen the trajectory.";
  }
  const methodStatus = status;
  const poorDelivery = deliveryAssessment?.trustStatus === "HIGH_RISK_DELIVERY";
  const benefitReported = ["OBSERVED_PARTIAL", "OBSERVED_USEFUL"].includes(deliveryAssessment?.method.benefit);
  const methodMismatch = hypotheses.some(h => ["FORMULATION_MISMATCH", "TARGET_MISMATCH", "METHOD_MISMATCH"].includes(h.kind));
  const preserveMethod = (status === "MOVING" || benefitReported) && !methodMismatch && deliveryAssessment?.method.benefit !== "NO_BENEFIT";
  const deliveryActions = [...(deliveryAssessment?.actions ?? [])];
  if (poorDelivery && preserveMethod) deliveryActions.push("PRESERVE_METHOD_AS_PARTIAL_TOOL");
  if (poorDelivery && !preserveMethod && (methodMismatch || deliveryAssessment.method.benefit === "NO_BENEFIT" || predictionFailure && active?.misses >= 2)) deliveryActions.push("DISCONTINUE_OR_SWITCH_METHOD");
  const pushThrough = deliveryAssessment?.findings.some(f => f.code === "DESTABILIZATION_DISMISSED_AS_RELEASE");
  if (deliveryAssessment && !emergency && !significantHarm && !external && !romancePause && variables.actionable_problem !== "present" && update?.response !== "declined" && decision !== "CLOSE") {
    if (poorDelivery) {
      decision = !stalled && !harm && !methodMismatch && decision !== "SWITCH" ? "SEEK_ALTERNATIVE_SUPERVISION" : "SWITCH";
      route = "reconsider";
      reason = preserveMethod ? "Preserve the observed method benefit while replacing an unsafe provider or supervision arrangement; benefit is not provider trust." : "Delivery is high risk; reassess method fit and seek a safer provider without inferring motives.";
      addFailure("DELIVERY_MISMATCH");
    }
    const doseIssue = has("dose_problem") || has("delivery_problem") || hypotheses.some(h => ["PACING_MISMATCH", "DELIVERY_MISMATCH"].includes(h.kind));
    if (preserveMethod && doseIssue && !stalled && !harm && !methodMismatch && !predictionFailure) {
      decision = "KEEP_BUT_TITRATE"; route = "reconsider";
      deliveryActions.push("KEEP_BUT_TITRATE");
      if (poorDelivery) deliveryActions.push("SEEK_ALTERNATIVE_SUPERVISION");
      reason = "Retain the observed partial benefit; reassess dose and supervision before further practice. This does not establish a safe dose or confirm the mechanism.";
    }
  }
  if (pushThrough && harm) { decision = "STOP_DEESCALATE"; route = "safety"; reason = "Destabilization is being dismissed as release. Stop and de-escalate; seek alternative supervision."; }
  const safetyRepresentation = active && (emergency || significantHarm) ? {
    process_id: active.strategy.process_id,
    mode: "CLEAR",
    channel: "PROSE_ANALYSIS",
    transition: "SWITCH",
    selection_reason: "Concrete present-time orientation is required while safety or reality testing is unstable.",
    observation_ids: unique([...signals.filter(s => s.severity === "significant").map(s => s.observation_id), ...active.strategy.observation_ids]).slice(0, 12),
    predicted_useful_signals: ["agency", "functional_change"]
  } : null;
  const representationPerformanceStatus = !observedRepresentation ? "NOT_OBSERVED"
    : harm ? "ADVERSE"
      : representationYieldedSignal ? "YIELDED_USEFUL_SIGNAL"
        : representationMismatch ? "STALLED" : "UNCLEAR";
  const trace = {
    episode_id: evaluated?.id ?? active?.id ?? null, next_episode_id: active?.id ?? null,
    review: evaluated?.review_count ?? 0, replayed_observation_ids: signals.filter(s => consumed.has(s.observation_id)).map(s => s.observation_id), delivery: evaluated?.delivery ?? null, predictions: evidence, observed_signals: signals,
    status, decision, route, reason, failure_sources: failures,
    ...(deliveryAssessment ? { method_status: methodStatus, delivery_assessment: deliveryAssessment, delivery_actions: [...new Set(deliveryActions)] } : {}),
    reconsider: ["SWITCH", "STOP_DEESCALATE", "PROBE"].includes(decision) ? RECONSIDER : [],
    goal_substitution: { romance_pause: romancePause, instrumental_socializing: riskSignals.some(s => s.kind === "instrumental_partner_seeking"), evidence_ids: unique(riskSignals.map(s => s.observation_id)), cleared_by_reassessment: clearRisk },
    probe: decision === "PROBE" || route === "reconsider" ? (update?.probe ?? null) : null,
    human_evaluation: "NOT_ESTABLISHED_BY_DETERMINISTIC_TRACE"
  };
  if (active) {
    const selectedRepresentation = safetyRepresentation ?? (hasFresh("representation_declined") && !proposedRepresentation ? null : proposedRepresentation ?? active.representation ?? null);
    trace.representation = {
      process_id: active.strategy.process_id,
      observed: observedRepresentation,
      selected: selectedRepresentation,
      predicted_useful_signals: observedRepresentation?.predicted_useful_signals ?? [],
      next_predicted_useful_signals: selectedRepresentation?.predicted_useful_signals ?? [],
      observed_response: { response: update?.response ?? "not_observed", signal_kinds: unique(freshSignals.map(s => s.kind)), observation_ids: unique(freshSignals.map(s => s.observation_id)) },
      channel_performance_status: representationPerformanceStatus,
      path_performance_status: status,
      action: safetyRepresentation ? "STABILIZE_CLEAR" : hasFresh("representation_declined") && !proposedRepresentation ? "DECLINED" : decision === "SWITCH_REPRESENTATION" ? "SWITCH" : selectedRepresentation ? "CONTINUE" : "UNSELECTED",
      global_user_type: "NOT_INFERRED"
    };
  }
  if (active) {
    if (safetyRepresentation) {
      if (representationIdentity(safetyRepresentation) !== representationIdentity(active.representation)) active.representation_switches = (active.representation_switches ?? 0) + 1;
      active.representation = safetyRepresentation;
    } else if (hasFresh("representation_declined") && !proposedRepresentation && !duplicateOnly && !harm && !external && !emergency) {
      active.representation = null;
    } else if (proposedRepresentation && !duplicateOnly && !harm && !external && !emergency) {
      if (representationChanged || representationTransitionRequested) {
        active.representation_switches = (active.representation_switches ?? 0) + 1;
        active.representation_misses = 0;
      }
      active.representation = proposedRepresentation;
    }
    active.status = status; active.decision = decision;
    // Provider-only reconsideration retains predictions and does not mark the method failed.
    active.switch_pending = ["SWITCH", "STOP_DEESCALATE", "CLOSE"].includes(decision);
    active.reviews = [...active.reviews, trace].slice(-12);
  }
  state.latest = trace;
  return state;
}

export function pathPerformanceGuidance(control) {
  const t = control.latest;
  const guidance = ["Judge this process by prospective movement and adverse response, independently of praise or complaint. A polite answer, cooperation, temporary relief, fluent explanation, vivid imagery, poetic expressiveness, felt intensity or completed surface action is not mechanism confirmation. Formulation and failure attribution remain provisional.", "Use one analytic truth and safety system across many delivery languages. Representation belongs to this process, not a fixed verbal/visual/kinesthetic personality type. The user owns every symbol and metaphor: invite their meaning, never decode it as hidden truth. Image, poem, story, role and body material can establish phenomenological meaning but not external facts; analogy creates hypotheses, drawings are not projective tests, and AI imagery is never revelation. Consequential safety, abuse, medical, legal, external-event and ontological claims require ordinary evidence and reality checks. Be able to explain any suggestion in plain language when asked."];
  if (["SWITCH", "PROBE", "STOP_DEESCALATE", "CLOSE"].includes(t.decision)) guidance.push("Stop repeating the previous exercise or its paraphrase. Reconsider process, formulation, target, need for external stabilization, mechanism, pacing/delivery and whether this is already a completed checking loop. Do not automatically choose an adjacent graph node or infer hidden trauma.");
  if (t.route === "external" || t.goal_substitution.romance_pause) guidance.push("Use external stabilization and practical support before further inward processing. Match intensity to evidenced need; ordinary eyes-open activity can suffice when the issue is inward attention. When structured supervision is actually needed, agree a feasible step toward supervised non-romantic support and mentoring. Where locally appropriate, explore therapeutic community, supported residential, care-farm/green-care, Soteria-like or other supervised non-carceral settings; verify local suitability and availability rather than promising a model, rejecting all clinical care or changing medication.");
  if (t.goal_substitution.narrow_romance_pause ?? t.goal_substitution.romance_pause) guidance.push("For this evidenced current state, recommend pausing active romance-seeking because instability, load and using a partner as regulator/rescuer/proof-of-worth can increase dependency. This is case-level and revisable, not a universal requirement to love oneself before relationships. Do not advise isolation or reannounce this constraint during unrelated work. Preserve supportive community and mentoring; socializing mainly to obtain a partner is goal substitution, not success toward non-romantic stabilization.");
  if (t.decision === "STOP_DEESCALATE") guidance.push("Stop the destabilizing intervention immediately. Keep the response simple and outward-oriented; follow existing safety/consent/return gates and support access. No deeper imagery, memory search, hypnosis, intensification or further inward probe.");
  if (t.decision === "ADJUST_DELIVERY") guidance.push("Change only the supported manner/dose issue once and retain the episode's original predictions and failure history; do not restart the same mechanism under a new label.");
  if (t.decision === "SWITCH_REPRESENTATION") guidance.push(`Keep the same process and cumulative evidence while making one cheap, consent-based delivery switch${t.representation?.selected ? ` to ${t.representation.selected.mode}/${t.representation.selected.channel}` : ""}. Offer rather than impose the channel. Measure client-generated specificity, agency, access to previously blocked emotion or need, new discriminating information and ordinary-life transfer; switch again if those do not appear.`);
  if (t.representation?.selected?.transition === "STAY_SYMBOLIC") guidance.push("The user chose to stay with the image or metaphor. Preserve contact without forcing translation and without making the interpretation unfalsifiable.");
  if (t.representation?.selected?.transition === "TRANSLATE_TO_PLAIN") guidance.push("Bridge the user's own image or metaphor into tentative ordinary language, check the translation with them, and preserve the option to return to the original form.");
  if (t.status === "STALLED" && t.representation?.observed && t.observed_signals?.some(s => ["expressiveness_without_information", "expressiveness", "vivid_imagery", "felt_intensity"].includes(s.kind))) guidance.push("The experiential output was expressive or intense but yielded no independent movement signal. Mark it stalled rather than profound and offer a different route.");
  if (t.decision === "STOP_DEESCALATE" || t.observed_signals?.some(s => ["dissociation", "fragmentation", "destabilization"].includes(s.kind))) guidance.push("As reality testing or continuity becomes unstable, gently mirror only reported experience and move toward concrete present-time orientation. Do not amplify archetypes, synchronicities, ambiguous symbols or supposed unconscious messages into certainty.");
  if (t.delivery_assessment) guidance.push(...deliverySystemGuidance(t.delivery_assessment));
  if (["KEEP_BUT_TITRATE", "SEEK_ALTERNATIVE_SUPERVISION"].includes(t.decision)) guidance.push("Retain any evidenced partial benefit and the original prediction history; unknown benefit remains unknown. The next step is to agree dose limits and safer supervision, not repeat or intensify the exercise now. A supervision change cannot reset failed method predictions or override an existing safety stop.");
  if (t.delivery_actions?.includes("DISCONTINUE_OR_SWITCH_METHOD")) guidance.push("Both method fit/performance and delivery are poor: discontinue or switch this method with appropriate support. Avoid abrupt changes to prescribed treatment.");
  return guidance;
}

export function performanceQuestion(control) {
  const t = control.latest;
  if (t.failure_sources?.some(f => f.kind === "REPRESENTATION_MISMATCH")) return representationProbe;
  if (t.route !== "reconsider") return "";
  if (!t.episode_id) return "What would be useful to change here in what you can feel, choose, or do?";
  if (t.probe && new Set(t.probe.alternatives.map(a => a.next_strategy)).size >= 2) return t.probe.question;
  return t.decision === "PROBE" ? defaultProbe : rethinkProbe;
}
