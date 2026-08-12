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
  return {
    ...snapshot,
    direct_observations: snapshot.direct_observations.filter((item) => !removeObservations.has(item.id)),
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

async function planSnapshot(snapshot) {
  const bundle = await loadCompiledGuideGraphBundle();
  const plan = planFromGraphs({
    variables: snapshot.variables,
    unknowns: snapshot.unknowns,
    graphs: bundle.graphs
  });
  return { plan, graphBundleVersion: bundle.version };
}

export async function runCaseExtraction({ context, provider, onProgress }) {
  const extraction = await structuredCall(
    provider,
    caseExtractionPrompt(context),
    { stage: "case_extraction", fixtureKey: "case_extraction" },
    validateCaseSnapshot,
    caseSnapshotSchema,
    onProgress
  );
  return extraction;
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

export async function planCaseSnapshot(snapshot) {
  return await planSnapshot(snapshot);
}

export async function runUnauditedCaseFormulation({ context, provider, onProgress, recovery }) {
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
  const { plan, graphBundleVersion } = await planSnapshot(snapshot);
  return {
    snapshot,
    plan,
    graphBundleVersion,
    providerMetadata: {
      extractor: { provider: provider.id, model: provider.model, requestId: extraction.raw.requestId, durationMs: extraction.durationMs, resumed: Boolean(extraction.resumed) },
      auditor: null
    }
  };
}

export async function runAuditedCaseFormulation({ context, extractorProvider, auditorProvider, onProgress, recovery }) {
  const extraction = await resolveCaseExtraction({ context, provider: extractorProvider, onProgress, recovery });
  const audit = await runCaseAuditWithRecovery({ context, snapshot: extraction.value, provider: auditorProvider, onProgress, recovery });
  const snapshot = applyCaseAudit(extraction.value, audit.value);
  const { plan, graphBundleVersion } = await planSnapshot(snapshot);
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

export async function runCaseFormulation({ context, providers, onProgress, recovery }) {
  return await runAuditedCaseFormulation({
    context,
    extractorProvider: providers.anthropic,
    auditorProvider: providers.openai,
    onProgress,
    recovery
  });
}
