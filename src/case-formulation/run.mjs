import { ValidationError } from "../core/errors.mjs";
import { hasCanonicalRomanceReference } from "../core/romance-reference.mjs";
import { withdrawDeliveryEvidence } from "./delivery-system-assessment.mjs";
import { evaluatePathPerformance, CASE_RISK_SIGNALS, validateRepresentationSelection } from "./path-performance.mjs";
import {
  relationalReadinessDecision,
  preparePathPriorForReadiness,
  applyRelationalReadinessToPath,
  decoratePlanWithRelationalReadiness,
  validateRelationalEvidence
} from "./relational-readiness.mjs";
import {
  applyRomanceGuideRouteConstraint,
  composeRomanceGuidePlan,
  validateRomanceGuideContext
} from "./romance-guide.mjs";
import {
  decoratePlanWithAntiBypass,
  decoratePlanWithThreatPathway,
  threatPathwayDecision,
  threatPathwayObservationIds,
  validateThreatPathwayAssessment
} from "./threat-pathway.mjs";
import { deriveCaseVariables } from "../guide-graph/planner.mjs";
import { validateTurnTask, reconcileIssueScope, immediateProtectionNeeded } from "./turn-task.mjs";
import { parseModelJson } from "../core/json.mjs";
import { caseSnapshotGenerationSchema, caseAuditGenerationSchema } from "./schemas.mjs";
import { validateCaseSnapshot, validateCaseAudit } from "./validators.mjs";
import { caseExtractionPrompt } from "../prompts/case-extract.mjs";
import { caseAuditPrompt } from "../prompts/case-audit.mjs";
import {
  relationalReadinessExtractionRules,
  relationalReadinessAuditRules,
  romanceGuideContextExtractionRules,
  romanceGuideContextAuditRules
} from "../prompts/relational-readiness.mjs";
import { threatPathwayExtractionRules, threatPathwayAuditRules } from "../prompts/threat-pathway.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { planFromGraphs } from "../guide-graph/planner.mjs";
import { validateCaseVariables } from "../guide-graph/validate.mjs";
import { asCaseStageError, safeCaseStageFailure } from "./stage-failure.mjs";
import {
  applyDevelopmentalCapacityToVariables,
  decoratePlanWithDevelopmentalCapacity,
  developmentalCapacityDecision,
  developmentalCapacityObservationIds,
  validateDevelopmentalCapacity,
  validateQuestionEligibilityFindings
} from "./developmental-capacity.mjs";

async function structuredCall(provider, prompt, metadata, validator, outputSchema, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: metadata.stage, status: "started", detail: `${provider.id}/${provider.model}` });
  try {
    const raw = await provider.generate({ ...prompt, metadata, outputSchema });
    const parsed = parseModelJson(raw.text, `${provider.id} ${metadata.stage}`);
    const value = validator(parsed);
    const durationMs = Date.now() - started;
    onProgress?.({ stage: metadata.stage, status: "completed", detail: `${(durationMs / 1000).toFixed(1)}s` });
    return { value, raw, durationMs };
  } catch (error) {
    throw asCaseStageError(error, { stage: metadata.stage, provider });
  }
}

function readinessObservationIds(readiness) {
  if (!readiness) return [];
  return [...new Set([
    ...readiness.stability_observation_ids,
    ...readiness.harm_observation_ids,
    ...readiness.trajectory_observation_ids,
    ...readiness.support_observation_ids,
    ...readiness.supports_observation_ids,
    ...readiness.risk_signals.flatMap(signal => signal.observation_ids)
  ])];
}

function romanceGuideObservationIds(context) {
  if (!context) return [];
  return [...new Set([
    ...context.observation_ids,
    ...context.audience_observation_ids,
    ...context.interest_observation_ids
  ])];
}

export function applyCaseAudit(snapshot, audit) {
  const removeObservations = new Set(audit.remove_observation_ids);
  const removeHypotheses = new Set(audit.remove_hypothesis_ids);
  const variables = { ...snapshot.variables };
  for (const correction of audit.variable_corrections) variables[correction.field] = correction.value;
  if (audit.remove_observation_ids.length || audit.invalidate_turn_task === true) {
    for (const field of ["relational_check_status", "loop_target_relation", "guard_engagement", "leave_alone_eligibility"]) variables[field] = "unknown";
  }
  const pathUpdate = snapshot.path_update ? structuredClone(snapshot.path_update) : null;
  let priorState = snapshot._path_prior ? structuredClone(snapshot._path_prior) : null;
  const episodeSignal = signal => !CASE_RISK_SIGNALS.includes(signal.kind) || Boolean(signal.prediction_id);
  const episodeRefs = episode => episode ? [
    ...episode.strategy.observation_ids, ...(episode.failure_evidence_ids ?? []),
    ...episode.reviews.flatMap(r => r.observed_signals.filter(episodeSignal).map(s => s.observation_id))
  ] : [];
  const activeWithdrawn = episodeRefs(priorState?.active).some(id => removeObservations.has(id));
  const pathInvalidated = Boolean(snapshot._path_invalidated || audit.invalidate_path_strategy === true || activeWithdrawn || (pathUpdate && [
    ...(pathUpdate.strategy?.observation_ids ?? []), ...pathUpdate.signals.filter(episodeSignal).map(s => s.observation_id),
    ...pathUpdate.failure_hypotheses.flatMap(h => h.observation_ids)
  ].some(id => removeObservations.has(id))));
  const withdraw = episode => {
    if (!episode || !episodeRefs(episode).some(id => removeObservations.has(id))) return;
    episode.reviews = []; episode.failure_evidence_ids = []; episode.delivery = null;
    episode.invalidated = true; episode.switch_pending = true;
  };
  const withdrawRepresentation = episode => {
    if (!episode?.representation?.observation_ids.some(id => removeObservations.has(id))) return;
    episode.representation = null;
    episode.delivery = null;
    for (const review of episode.reviews ?? []) {
      const refs = [...(review.representation?.observed?.observation_ids ?? []), ...(review.representation?.selected?.observation_ids ?? [])];
      if (refs.some(id => removeObservations.has(id))) delete review.representation;
    }
  };
  if (priorState) {
    withdrawDeliveryEvidence(priorState.delivery_system_state, removeObservations);
    withdraw(priorState.active);
    withdrawRepresentation(priorState.active);
    for (const closed of priorState.closed) { withdraw(closed.retained_episode); withdrawRepresentation(closed.retained_episode); }
    const latestRepresentationRefs = [...(priorState.latest?.representation?.observed?.observation_ids ?? []), ...(priorState.latest?.representation?.selected?.observation_ids ?? [])];
    if (latestRepresentationRefs.some(id => removeObservations.has(id))) delete priorState.latest.representation;
    priorState.risk_signals = (priorState.risk_signals ?? []).filter(s => !removeObservations.has(s.observation_id));
  }
  if (pathUpdate) {
    // Withdraw only dependent delivery facts. Do not invalidate unrelated method predictions.
    if (pathUpdate.delivery_review) {
      const a = pathUpdate.delivery_review.assessment;
      if (a.observation_ids.some(id => removeObservations.has(id))) pathUpdate.delivery_review = null;
      else {
        a.facts = a.facts.filter(f => !f.observation_ids.some(id => removeObservations.has(id)));
        if (a.method.observation_ids.some(id => removeObservations.has(id))) a.method = { ...a.method, benefit: "UNKNOWN", durability: "UNKNOWN", current: false, observation_ids: [] };
        if (a.financial?.observation_ids.some(id => removeObservations.has(id))) a.financial = null;
      }
    }
    pathUpdate.signals = pathUpdate.signals.filter(s => !removeObservations.has(s.observation_id));
    pathUpdate.failure_hypotheses = pathUpdate.failure_hypotheses.filter(h => !h.observation_ids.some(id => removeObservations.has(id)));
    if (pathUpdate.strategy?.observation_ids.some(id => removeObservations.has(id))) pathUpdate.strategy = null;
    if (pathUpdate.representation?.observation_ids.some(id => removeObservations.has(id))) pathUpdate.representation = null;
    if (audit.invalidate_path_strategy === true) {
      pathUpdate.strategy = null;
      pathUpdate.representation = null;
    }
  }

  const remainingObservations = snapshot.direct_observations.filter(item => !removeObservations.has(item.id));
  const remainingIds = new Set(remainingObservations.map(item => item.id));
  const correctedRepresentationProvided = audit.corrected_path_representation != null;
  const representationWasTracked = Boolean((pathUpdate && Object.hasOwn(pathUpdate, "representation")) || priorState?.active?.representation || correctedRepresentationProvided || audit.invalidate_path_representation === true);
  const currentRepresentationProcess = pathUpdate?.strategy?.process_id ?? pathUpdate?.representation?.process_id ?? priorState?.active?.strategy.process_id ?? null;
  if (pathUpdate && representationWasTracked) {
    if (audit.invalidate_path_representation === true) pathUpdate.representation = null;
    else if (correctedRepresentationProvided) {
      const corrected = validateRepresentationSelection(audit.corrected_path_representation, remainingIds);
      if (currentRepresentationProcess && corrected.process_id !== currentRepresentationProcess) throw new ValidationError("Corrected representation must match the current update process.");
      pathUpdate.representation = corrected;
    }
  }
  const priorRepresentationIsCurrent = Boolean(priorState?.active && (!pathUpdate || currentRepresentationProcess === priorState.active.strategy.process_id));
  if (priorRepresentationIsCurrent && representationWasTracked) {
    if (audit.invalidate_path_representation === true || audit.invalidate_path_strategy === true) {
      priorState.active.representation = null;
      priorState.active.delivery = null;
    } else if (correctedRepresentationProvided) {
      const corrected = validateRepresentationSelection(audit.corrected_path_representation, remainingIds);
      if (corrected.process_id !== priorState.active.strategy.process_id) throw new ValidationError("Corrected representation must match the active process.");
      priorState.active.representation = corrected;
      priorState.active.delivery = null;
    }
  }
  const originalReadiness = snapshot.relational_readiness ?? null;
  const originalReadinessWithdrawn = readinessObservationIds(originalReadiness).some(id => removeObservations.has(id));
  const correctedProvided = audit.corrected_relational_readiness != null;
  let readiness = correctedProvided ? audit.corrected_relational_readiness : originalReadiness;
  if (audit.invalidate_relational_readiness === true || (!correctedProvided && originalReadinessWithdrawn)) readiness = null;
  if (readiness) {
    readiness = validateRelationalEvidence(readiness, { issue: snapshot.current_issue, observationIds: remainingIds }, message => { throw new ValidationError(message); });
  }
  const readinessWasTracked = Object.hasOwn(snapshot, "relational_readiness") || correctedProvided || audit.invalidate_relational_readiness === true;
  const originalRomanceContext = snapshot.romance_guide_context ?? null;
  const originalRomanceContextWithdrawn = romanceGuideObservationIds(originalRomanceContext).some(id => removeObservations.has(id));
  const correctedRomanceContextProvided = audit.corrected_romance_guide_context != null;
  let romanceGuideContext = correctedRomanceContextProvided ? audit.corrected_romance_guide_context : originalRomanceContext;
  if (audit.invalidate_romance_guide_context === true || (!correctedRomanceContextProvided && originalRomanceContextWithdrawn)) romanceGuideContext = null;
  if (romanceGuideContext) {
    romanceGuideContext = validateRomanceGuideContext(romanceGuideContext, {
      issue: snapshot.current_issue,
      observationIds: remainingIds
    }, message => { throw new ValidationError(message); });
  }
  const romanceContextWasTracked = Object.hasOwn(snapshot, "romance_guide_context")
    || correctedRomanceContextProvided || audit.invalidate_romance_guide_context === true;
  const originalThreatPathway = snapshot.threat_pathway ?? null;
  const originalThreatPathwayWithdrawn = threatPathwayObservationIds(originalThreatPathway).some(id => removeObservations.has(id));
  const correctedThreatPathwayProvided = audit.corrected_threat_pathway != null;
  let threatPathway = correctedThreatPathwayProvided ? audit.corrected_threat_pathway : originalThreatPathway;
  if (audit.invalidate_threat_pathway === true || (!correctedThreatPathwayProvided && originalThreatPathwayWithdrawn)) threatPathway = null;
  if (threatPathway) {
    threatPathway = validateThreatPathwayAssessment(threatPathway, {
      issue: snapshot.current_issue,
      observationIds: remainingIds
    });
  }
  const threatPathwayWasTracked = Object.hasOwn(snapshot, "threat_pathway")
    || correctedThreatPathwayProvided || audit.invalidate_threat_pathway === true;
  const originalDevelopmentalCapacity = snapshot.developmental_capacity ?? null;
  const originalDevelopmentalCapacityWithdrawn = developmentalCapacityObservationIds(originalDevelopmentalCapacity)
    .some(id => removeObservations.has(id));
  const correctedDevelopmentalCapacityProvided = audit.corrected_developmental_capacity != null;
  let developmentalCapacity = correctedDevelopmentalCapacityProvided
    ? audit.corrected_developmental_capacity : originalDevelopmentalCapacity;
  if (audit.invalidate_developmental_capacity === true
      || (!correctedDevelopmentalCapacityProvided && originalDevelopmentalCapacityWithdrawn)) developmentalCapacity = null;
  if (developmentalCapacity) {
    developmentalCapacity = validateDevelopmentalCapacity(developmentalCapacity, {
      issue: snapshot.current_issue,
      observationIds: remainingIds
    });
  }
  const developmentalCapacityWasTracked = Object.hasOwn(snapshot, "developmental_capacity")
    || correctedDevelopmentalCapacityProvided || audit.invalidate_developmental_capacity === true;
  const questionEligibilityFindings = validateQuestionEligibilityFindings(audit.question_eligibility_findings ?? [], {
    observationIds: remainingIds
  });
  const ineligibleVariables = new Set(questionEligibilityFindings.map(item => item.variable));
  const auditedUnknowns = [...snapshot.unknowns, ...audit.add_unknowns]
    .filter(item => item.changes_next_action !== false
      && item.developmental_prerequisite_valid !== false
      && !ineligibleVariables.has(item.variable));

  return {
    ...snapshot,
    ...(priorState ? { _path_prior: priorState } : {}),
    ...(Object.hasOwn(snapshot, "path_update") || snapshot._path_prior ? { path_update: pathUpdate, _path_invalidated: pathInvalidated } : {}),
    direct_observations: remainingObservations,
    ...((Object.hasOwn(snapshot, "turn_task") || audit.corrected_turn_task || audit.invalidate_turn_task) ? { turn_task: audit.invalidate_turn_task ? null : validateTurnTask(audit.corrected_turn_task ?? snapshot.turn_task, {
      issue: snapshot.current_issue,
      observationIds: remainingIds
    }) } : {}),
    ...(readinessWasTracked ? { relational_readiness: readiness } : {}),
    ...(romanceContextWasTracked ? { romance_guide_context: romanceGuideContext } : {}),
    ...(threatPathwayWasTracked ? { threat_pathway: threatPathway } : {}),
    ...(developmentalCapacityWasTracked ? { developmental_capacity: developmentalCapacity } : {}),
    hypotheses: snapshot.hypotheses.filter((item) => !removeHypotheses.has(item.id)),
    variables: validateCaseVariables(variables),
    unknowns: auditedUnknowns,
    audit: {
      verdict: audit.verdict,
      summary: audit.summary,
      safety_flags: audit.safety_flags,
      variable_corrections: audit.variable_corrections,
      question_eligibility_findings: questionEligibilityFindings,
      ...(audit.invalidate_path_strategy === true ? { path_strategy_invalidated: true } : {}),
      ...(readinessWasTracked ? { relational_readiness_reviewed: true } : {}),
      ...(representationWasTracked ? { path_representation_reviewed: true } : {}),
      ...(romanceContextWasTracked ? { romance_guide_context_reviewed: true } : {}),
      ...(threatPathwayWasTracked ? { threat_pathway_reviewed: true } : {}),
      ...(developmentalCapacityWasTracked ? { developmental_capacity_reviewed: true } : {})
    }
  };
}

async function planSnapshot(snapshot, {
  onPlanningPass,
  loadPlanningGraphBundle = loadCompiledGuideGraphBundle,
  romanceGuideAlreadyOffered = false
} = {}) {
  onPlanningPass?.();
  const bundle = await loadPlanningGraphBundle();
  const enabled = bundle.graphs.length > 0 && bundle.graphs.every(g => g.pathPerformancePolicyVersion === 1);
  const developmentalDecision = developmentalCapacityDecision(snapshot.developmental_capacity ?? null);
  const capacityVariables = applyDevelopmentalCapacityToVariables(snapshot.variables, snapshot.developmental_capacity ?? null, developmentalDecision);
  const threatDecision = threatPathwayDecision(snapshot.threat_pathway ?? null);
  const plannedVariables = threatDecision.level === "IMMINENT_OPERATIONAL_DANGER"
    ? { ...capacityVariables, present_safety: "unsafe" }
    : capacityVariables;
  const derivedVariables = deriveCaseVariables(plannedVariables);
  const readinessDecision = relationalReadinessDecision(snapshot.relational_readiness ?? null, {
    immediateProtection: immediateProtectionNeeded(derivedVariables) || derivedVariables.suicidal_state === "intent"
  });
  const priorForPath = preparePathPriorForReadiness(snapshot._path_prior, readinessDecision, {
    issueChanged: snapshot._relational_issue_changed === true
  });
  const basePathPerformance = enabled && (Object.hasOwn(snapshot, "path_update") || priorForPath)
    ? evaluatePathPerformance({
        prior: priorForPath,
        update: snapshot.path_update,
        variables: derivedVariables,
        observationIds: new Set((snapshot.direct_observations ?? []).map(o => o.id)),
        invalidated: snapshot._path_invalidated
      }) : null;
  const pathPerformance = applyRelationalReadinessToPath(basePathPerformance, readinessDecision);
  if (pathPerformance?.active && !bundle.graphs.some(g => g.nodes.some(n => n.id === pathPerformance.active.strategy.node_id))) throw new TypeError("Strategy references a node outside the current graph.");
  if (pathPerformance) snapshot.path_performance = pathPerformance;
  else delete snapshot.path_performance;
  delete snapshot._path_prior;
  delete snapshot._path_invalidated;
  delete snapshot._relational_issue_changed;
  const routingControl = applyRomanceGuideRouteConstraint(pathPerformance, snapshot.romance_guide_context ?? null);
  const rawPlan = planFromGraphs({
    variables: plannedVariables,
    unknowns: snapshot.unknowns,
    graphs: bundle.graphs,
    turnTask: snapshot.turn_task ?? null,
    pathPerformance: routingControl,
    preferredNodeId: developmentalDecision?.recommendedNodeId ?? null
  });
  const readinessPlan = decoratePlanWithRelationalReadiness(rawPlan, routingControl, readinessDecision);
  const { plan: romancePlan, composition } = composeRomanceGuidePlan(readinessPlan, snapshot.romance_guide_context ?? null, {
    readinessDecision,
    alreadyOffered: romanceGuideAlreadyOffered
  });
  if (!composition.canRealize) throw new ValidationError(`Romance guide context requires replanning before realization: ${composition.action}.`);
  const threatPlan = decoratePlanWithThreatPathway(romancePlan, snapshot.threat_pathway ?? null, threatDecision);
  const developmentalPlan = decoratePlanWithDevelopmentalCapacity(threatPlan, developmentalDecision);
  const plan = decoratePlanWithAntiBypass(developmentalPlan, plannedVariables);
  return { plan, graphBundleVersion: bundle.version };
}

export async function preflightGraphPlanningAvailability({ loadPreflightGraphBundle = loadCompiledGuideGraphBundle } = {}) {
  const bundle = await loadPreflightGraphBundle();
  return { graphBundleVersion: bundle.version };
}

export async function runCaseExtraction({ context, provider, onProgress }) {
  const prompt = caseExtractionPrompt(context);
  prompt.system += relationalReadinessExtractionRules + romanceGuideContextExtractionRules + threatPathwayExtractionRules;
  const extraction = await structuredCall(
    provider,
    prompt,
    { stage: "case_extraction", fixtureKey: "case_extraction" },
    value => {
      if (context.pathPerformanceEnabled && !String(provider.model).startsWith("mock-")) {
        if (!Object.hasOwn(value, "path_update")) throw new ValidationError("Candidate extraction must declare path_update; missing strategy tracking cannot silently bypass monitoring.");
        if (value.path_update && !Object.hasOwn(value.path_update, "representation")) throw new ValidationError("Candidate path update must declare representation as null or a process-scoped selection.");
        if (value.path_update?.strategy && value.path_update.representation == null) throw new ValidationError("A new candidate strategy requires an explicit process-scoped representation selection.");
        if (value.unknowns.some(item => !Object.hasOwn(item, "changes_next_action"))) throw new ValidationError("Candidate extraction unknowns must declare whether resolving them can change the next therapeutic action.");
        if (value.unknowns.some(item => !Object.hasOwn(item, "developmental_prerequisite_valid"))) throw new ValidationError("Candidate extraction unknowns must independently declare developmental prerequisite validity.");
        if (!Object.hasOwn(value, "relational_readiness")) throw new ValidationError("Candidate extraction must declare relational_readiness as null or an evidenced current assessment.");
        if (!Object.hasOwn(value, "romance_guide_context")) throw new ValidationError("Candidate extraction must declare romance_guide_context as null or an evidenced current-turn selector.");
        if (!Object.hasOwn(value, "threat_pathway")) throw new ValidationError("Candidate extraction must declare threat_pathway as null or a complete evidence-bound current assessment.");
        if (!Object.hasOwn(value, "developmental_capacity")) throw new ValidationError("Candidate extraction must declare developmental_capacity as null or a complete evidence-bound current assessment.");
      }
      return validateCaseSnapshot(value);
    },
    caseSnapshotGenerationSchema,
    onProgress
  );
  // Ignore model-supplied controller state. Only the existing session state owns history.
  delete extraction.value.path_performance;
  delete extraction.value._path_prior;
  const prior = context.priorCaseSnapshot?.path_performance;
  if (prior) extraction.value._path_prior = structuredClone(prior);
  const issueChanged = Boolean(context.priorCaseSnapshot?.current_issue && extraction.value.current_issue !== context.priorCaseSnapshot.current_issue);
  const scoped = reconcileIssueScope(extraction.value, context.priorCaseSnapshot);
  if (issueChanged) scoped._relational_issue_changed = true;
  return { ...extraction, value: scoped };
}

export async function resolveCaseExtraction({ context, provider, onProgress, recovery }) {
  const resumed = await recovery?.loadExtraction?.({ provider });
  if (resumed && (!context.pathPerformanceEnabled || (Object.hasOwn(resumed.value, "relational_readiness")
      && Object.hasOwn(resumed.value, "romance_guide_context")
      && Object.hasOwn(resumed.value, "threat_pathway")
      && Object.hasOwn(resumed.value, "developmental_capacity")
      && (!resumed.value.path_update || Object.hasOwn(resumed.value.path_update, "representation"))))) {
    onProgress?.({
      stage: "case_extraction",
      status: "resumed",
      detail: `${provider.id}/${provider.model}; completed extraction checkpoint reused`
    });
    return resumed;
  }
  const extraction = await runCaseExtraction({ context, provider, onProgress });
  await recovery?.saveExtraction?.({
    value: extraction.value,
    providerMetadata: {
      provider: provider.id,
      model: provider.model,
      requestId: extraction.raw.requestId ?? null,
      durationMs: extraction.durationMs
    }
  });
  return extraction;
}

export async function runCaseAudit({ context, snapshot, provider, onProgress }) {
  const prompt = caseAuditPrompt(context, snapshot);
  prompt.system += relationalReadinessAuditRules + romanceGuideContextAuditRules + threatPathwayAuditRules;
  return await structuredCall(
    provider,
    prompt,
    { stage: "case_audit", fixtureKey: "case_audit" },
    value => {
      if (context.pathPerformanceEnabled && !String(provider.model).startsWith("mock-")) {
        if (!Object.hasOwn(value, "invalidate_path_strategy")) {
          throw new ValidationError("Candidate audit must explicitly review whether the active/proposed path strategy target remains valid.");
        }
        if (value.add_unknowns.some(item => !Object.hasOwn(item, "changes_next_action"))) {
          throw new ValidationError("Candidate audit unknowns must declare whether resolving them can change the next therapeutic action.");
        }
        if (value.add_unknowns.some(item => !Object.hasOwn(item, "developmental_prerequisite_valid"))) {
          throw new ValidationError("Candidate audit unknowns must independently declare developmental prerequisite validity.");
        }
        if (!Object.hasOwn(value, "corrected_romance_guide_context") || !Object.hasOwn(value, "invalidate_romance_guide_context")) {
          throw new ValidationError("Candidate audit must explicitly review romance_guide_context.");
        }
        if (!Object.hasOwn(value, "corrected_threat_pathway") || !Object.hasOwn(value, "invalidate_threat_pathway")) {
          throw new ValidationError("Candidate audit must explicitly review threat_pathway.");
        }
        if (!Object.hasOwn(value, "corrected_developmental_capacity")
            || !Object.hasOwn(value, "invalidate_developmental_capacity")
            || !Object.hasOwn(value, "question_eligibility_findings")) {
          throw new ValidationError("Candidate audit must explicitly review developmental capacity and question prerequisites.");
        }
      }
      return validateCaseAudit(value);
    },
    caseAuditGenerationSchema,
    onProgress
  );
}

export async function runCaseAuditWithRecovery({ context, snapshot, provider, onProgress, recovery }) {
  const maxAttempts = recovery?.maxAuditAttempts ?? 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const audit = await runCaseAudit({ context, snapshot, provider, onProgress });
      await recovery?.recordAuditAttempt?.({
        attempt,
        completed: {
          provider: provider.id,
          model: provider.model,
          requestId: audit.raw.requestId ?? null,
          durationMs: audit.durationMs,
          completedAt: new Date().toISOString()
        }
      });
      return audit;
    } catch (error) {
      const failure = safeCaseStageFailure(error);
      await recovery?.recordAuditAttempt?.({ attempt, failure });
      if (!failure?.retryable || attempt >= maxAttempts) throw error;
      onProgress?.({
        stage: "case_audit",
        status: "retrying",
        detail: `attempt ${attempt + 1}/${maxAttempts}; completed extraction checkpoint reused`
      });
    }
  }
  throw new Error("Unreachable A001 audit retry state.");
}

export async function planCaseSnapshot(snapshot, instrumentation = {}) {
  return await planSnapshot(snapshot, instrumentation);
}

export async function runUnauditedCaseSnapshot({ context, provider, onProgress, recovery }) {
  const extraction = await resolveCaseExtraction({ context, provider, onProgress, recovery });
  const snapshot = {
    ...extraction.value,
    audit: {
      verdict: "not-run",
      summary: "Fast-path extraction was routed without adversarial case audit.",
      safety_flags: [],
      variable_corrections: []
    }
  };
  return {
    snapshot,
    providerMetadata: {
      extractor: { provider: provider.id, model: provider.model, requestId: extraction.raw.requestId, durationMs: extraction.durationMs, resumed: Boolean(extraction.resumed) },
      auditor: null
    }
  };
}

export async function runUnauditedCaseFormulation({ context, provider, onProgress, recovery, onPlanningPass, loadPlanningGraphBundle }) {
  const initial = await runUnauditedCaseSnapshot({ context, provider, onProgress, recovery });
  const { plan, graphBundleVersion } = await planSnapshot(initial.snapshot, {
    onPlanningPass,
    loadPlanningGraphBundle,
    romanceGuideAlreadyOffered: hasCanonicalRomanceReference(context.recentTranscript)
  });
  return { ...initial, plan, graphBundleVersion };
}

export async function runAuditedCaseFormulation({ context, extractorProvider, auditorProvider, onProgress, recovery, loadPlanningGraphBundle }) {
  const extraction = await resolveCaseExtraction({ context, provider: extractorProvider, onProgress, recovery });
  const audit = await runCaseAuditWithRecovery({ context, snapshot: extraction.value, provider: auditorProvider, onProgress, recovery });
  const snapshot = applyCaseAudit(extraction.value, audit.value);
  const { plan, graphBundleVersion } = await planSnapshot(snapshot, {
    loadPlanningGraphBundle,
    romanceGuideAlreadyOffered: hasCanonicalRomanceReference(context.recentTranscript)
  });
  return {
    snapshot,
    plan,
    graphBundleVersion,
    providerMetadata: {
      extractor: { provider: extractorProvider.id, model: extractorProvider.model, requestId: extraction.raw.requestId, durationMs: extraction.durationMs, resumed: Boolean(extraction.resumed) },
      auditor: { provider: auditorProvider.id, model: auditorProvider.model, requestId: audit.raw.requestId, durationMs: audit.durationMs }
    }
  };
}

export async function runCaseFormulation({ context, providers, onProgress, recovery, loadPlanningGraphBundle }) {
  return await runAuditedCaseFormulation({
    context,
    extractorProvider: providers.anthropic,
    auditorProvider: providers.openai,
    onProgress,
    recovery,
    loadPlanningGraphBundle
  });
}
