import { ValidationError } from "../core/errors.mjs";
import { evaluatePathPerformance, CASE_RISK_SIGNALS } from "./path-performance.mjs";
import { relationalReadinessDecision, preparePathPriorForReadiness } from "./relational-readiness.mjs";
import { deriveCaseVariables } from "../guide-graph/planner.mjs";
import { validateTurnTask, reconcileIssueScope, immediateProtectionNeeded } from "./turn-task.mjs";
import { parseModelJson } from "../core/json.mjs";
import { caseSnapshotSchema, caseAuditSchema } from "./schemas.mjs";
import { validateCaseSnapshot, validateCaseAudit } from "./validators.mjs";
import { caseExtractionPrompt } from "../prompts/case-extract.mjs";
import { caseAuditPrompt } from "../prompts/case-audit.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { planFromGraphs } from "../guide-graph/planner.mjs";
import { validateCaseVariables } from "../guide-graph/validate.mjs";
import { asCaseStageError, safeCaseStageFailure } from "./stage-failure.mjs";

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
  const pathInvalidated = Boolean(snapshot._path_invalidated || activeWithdrawn || (pathUpdate && [
    ...(pathUpdate.strategy?.observation_ids ?? []), ...pathUpdate.signals.filter(episodeSignal).map(s => s.observation_id),
    ...pathUpdate.failure_hypotheses.flatMap(h => h.observation_ids)
  ].some(id => removeObservations.has(id))));
  const withdraw = episode => {
    if (!episode || !episodeRefs(episode).some(id => removeObservations.has(id))) return;
    episode.reviews = []; episode.failure_evidence_ids = []; episode.delivery = null;
    episode.invalidated = true; episode.switch_pending = true;
  };
  if (priorState) {
    withdraw(priorState.active);
    for (const closed of priorState.closed) withdraw(closed.retained_episode);
    priorState.risk_signals = (priorState.risk_signals ?? []).filter(s => !removeObservations.has(s.observation_id));
  }
  if (pathUpdate) {
    pathUpdate.signals = pathUpdate.signals.filter(s => !removeObservations.has(s.observation_id));
    pathUpdate.failure_hypotheses = pathUpdate.failure_hypotheses.filter(h => !h.observation_ids.some(id => removeObservations.has(id)));
    if (pathUpdate.strategy?.observation_ids.some(id => removeObservations.has(id))) pathUpdate.strategy = null;
  }
  return {
    ...snapshot,
    ...(priorState ? { _path_prior: priorState } : {}),
    ...(Object.hasOwn(snapshot, "path_update") || snapshot._path_prior ? { path_update: pathUpdate, _path_invalidated: pathInvalidated } : {}),
    direct_observations: snapshot.direct_observations.filter((item) => !removeObservations.has(item.id)),
    ...((Object.hasOwn(snapshot, "turn_task") || audit.corrected_turn_task || audit.invalidate_turn_task) ? { turn_task: audit.invalidate_turn_task ? null : validateTurnTask(audit.corrected_turn_task ?? snapshot.turn_task, {
      issue: snapshot.current_issue,
      observationIds: new Set(snapshot.direct_observations.filter(item => !removeObservations.has(item.id)).map(item => item.id))
    }) } : {}),
    hypotheses: snapshot.hypotheses.filter((item) => !removeHypotheses.has(item.id)),
    variables: validateCaseVariables(variables),
    unknowns: [...snapshot.unknowns, ...audit.add_unknowns],
    audit: {
      verdict: audit.verdict,
      summary: audit.summary,
      safety_flags: audit.safety_flags,
      variable_corrections: audit.variable_corrections
    }
  };
}

async function planSnapshot(snapshot, { onPlanningPass, loadPlanningGraphBundle = loadCompiledGuideGraphBundle } = {}) {
  onPlanningPass?.();
  const bundle = await loadPlanningGraphBundle();
  const enabled = bundle.graphs.length > 0 && bundle.graphs.every(g => g.pathPerformancePolicyVersion === 1);
  const derivedVariables = deriveCaseVariables(snapshot.variables);
  const readinessDecision = relationalReadinessDecision(snapshot.turn_task?.relational_readiness ?? null, {
    immediateProtection: immediateProtectionNeeded(derivedVariables) || derivedVariables.suicidal_state === "intent"
  });
  const priorForPath = preparePathPriorForReadiness(snapshot._path_prior, readinessDecision);
  const pathPerformance = enabled && (Object.hasOwn(snapshot, "path_update") || priorForPath)
    ? evaluatePathPerformance({ prior: priorForPath, update: snapshot.path_update,
        variables: derivedVariables,
        observationIds: new Set((snapshot.direct_observations ?? []).map(o => o.id)),
        invalidated: snapshot._path_invalidated,
        relationalReadiness: snapshot.turn_task?.relational_readiness ?? null }) : null;
  if (pathPerformance?.active && !bundle.graphs.some(g => g.nodes.some(n => n.id === pathPerformance.active.strategy.node_id))) throw new TypeError("Strategy references a node outside the current graph.");
  if (pathPerformance) snapshot.path_performance = pathPerformance;
  else delete snapshot.path_performance;
  delete snapshot._path_prior;
  delete snapshot._path_invalidated;
  const plan = planFromGraphs({
    variables: snapshot.variables,
    unknowns: snapshot.unknowns,
    graphs: bundle.graphs,
    turnTask: snapshot.turn_task ?? null,
    pathPerformance
  });
  return { plan, graphBundleVersion: bundle.version };
}

export async function preflightGraphPlanningAvailability({ loadPreflightGraphBundle = loadCompiledGuideGraphBundle } = {}) {
  const bundle = await loadPreflightGraphBundle();
  return { graphBundleVersion: bundle.version };
}

export async function runCaseExtraction({ context, provider, onProgress }) {
  const extraction = await structuredCall(
    provider,
    caseExtractionPrompt(context),
    { stage: "case_extraction", fixtureKey: "case_extraction" },
    value => {
      if (context.pathPerformanceEnabled && !String(provider.model).startsWith("mock-") && !Object.hasOwn(value, "path_update")) throw new ValidationError("Candidate extraction must declare path_update; missing strategy tracking cannot silently bypass monitoring.");
      return validateCaseSnapshot(value);
    },
    caseSnapshotSchema,
    onProgress
  );
  // Ignore model-supplied controller state. Only the existing session state owns history.
  delete extraction.value.path_performance;
  delete extraction.value._path_prior;
  const prior = context.priorCaseSnapshot?.path_performance;
  if (prior) extraction.value._path_prior = structuredClone(prior);
  return { ...extraction, value: reconcileIssueScope(extraction.value, context.priorCaseSnapshot) };
}

export async function resolveCaseExtraction({ context, provider, onProgress, recovery }) {
  const resumed = await recovery?.loadExtraction?.({ provider });
  if (resumed) {
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
  return await structuredCall(
    provider,
    caseAuditPrompt(context, snapshot),
    { stage: "case_audit", fixtureKey: "case_audit" },
    validateCaseAudit,
    caseAuditSchema,
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
  const { plan, graphBundleVersion } = await planSnapshot(initial.snapshot, { onPlanningPass, loadPlanningGraphBundle });
  return { ...initial, plan, graphBundleVersion };
}

export async function runAuditedCaseFormulation({ context, extractorProvider, auditorProvider, onProgress, recovery, loadPlanningGraphBundle }) {
  const extraction = await resolveCaseExtraction({ context, provider: extractorProvider, onProgress, recovery });
  const audit = await runCaseAuditWithRecovery({ context, snapshot: extraction.value, provider: auditorProvider, onProgress, recovery });
  const snapshot = applyCaseAudit(extraction.value, audit.value);
  const { plan, graphBundleVersion } = await planSnapshot(snapshot, { loadPlanningGraphBundle });
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
