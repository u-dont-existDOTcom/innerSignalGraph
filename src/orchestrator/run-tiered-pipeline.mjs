import { runUnauditedCaseFormulation, runCaseAuditWithRecovery, applyCaseAudit, planCaseSnapshot } from "../case-formulation/run.mjs";
import { runAdversarialPipeline, runCompactAdversarialPipeline, realizeAdjudication } from "./run-pipeline.mjs";
import { writeLedger } from "./ledger.mjs";
import { enforceResponseContract } from "./response-contract.mjs";
import {
  assertHardAuthorityPreserved,
  classifyInterventionAuthority,
  normalizeTherapyScaffoldMode
} from "./scaffold-authority.mjs";
import {
  runBoundedGraphAudit,
  runModelFirstIntegration,
  runSemanticFormulation
} from "./model-first-scaffold.mjs";

const HARD_INTENTS = new Set(["deep_dialogue", "hypnosis", "memory_processing", "photo_work", "altered_state", "advanced_release"]);
const CRITICAL_DELTA_FIELDS = [
  "present_safety", "orientation", "ability_to_stop", "ability_to_return", "activation", "dissociation", "altered_state",
  "memory_source_risk", "current_intent", "credibility_conflict", "age_agency_ambiguity", "resentment_toward_younger_self",
  "inner_adult_access", "witness_capacity", "protective_response", "self_directed_love", "credibility_evidence_state",
  "internal_speaker_relation", "target_type"
];

function criticalDeltaCount(snapshot, priorSnapshot) {
  if (!priorSnapshot?.variables) return Number.POSITIVE_INFINITY;
  const now = snapshot?.variables ?? {};
  const before = priorSnapshot.variables ?? {};
  return CRITICAL_DELTA_FIELDS.reduce((count, field) => count + (now[field] !== before[field] ? 1 : 0), 0);
}

export function classifyTherapyTier(snapshot, requested = "auto", session = {}) {
  const v = snapshot?.variables ?? {};
  const safetyHard = v.present_safety === "unsafe"
    || v.orientation === "disoriented"
    || v.ability_to_stop === "no"
    || v.ability_to_return === "no"
    || v.dissociation === "high"
    || v.altered_state === "altered"
    || v.memory_source_risk === "present";
  const ambiguityHard = v.age_agency_ambiguity === "present"
    && v.resentment_toward_younger_self === "present"
    && v.credibility_conflict === "present";
  const graphStructuredAmbiguity = ambiguityHard
    && v.current_intent === "conversation"
    && ["none", "adverse", "mixed", "positive"].includes(v.credibility_evidence_state)
    && ["present", "partial"].includes(v.witness_capacity)
    && ["same", "distinct", "blend", "unresolved"].includes(v.internal_speaker_relation);
  const intentHard = HARD_INTENTS.has(v.current_intent);
  const importantUnknown = Math.max(0, ...(snapshot?.unknowns ?? []).map((item) => item.importance ?? 0));
  const reviewedSignal = v.protective_response === "present"
    || v.self_directed_love === "unsafe"
    || v.credibility_conflict === "present"
    || ["low", "partial"].includes(v.inner_adult_access)
    || ["moderate", "high"].includes(v.activation)
    || v.dissociation === "mild"
    || importantUnknown >= 4;
  const priorDeep = ["deep", "forensic", "adversarial"].includes(session.priorProcessingTier ?? "");
  const deltaCount = criticalDeltaCount(snapshot, session.priorCaseSnapshot);

  if (safetyHard) return { tier: "forensic", reason: "safety-sensitive formulation", forced: true, deltaCount };
  if (requested === "forensic") return { tier: "forensic", reason: "user-selected forensic council", forced: false, deltaCount };
  if (["deep", "adversarial"].includes(requested)) return { tier: "deep", reason: "user-selected deep review", forced: false, deltaCount };
  if (requested === "reviewed") return { tier: "reviewed", reason: "user-selected reviewed mode", forced: false, deltaCount };
  if (requested === "fast" && !intentHard && !ambiguityHard) return { tier: "fast", reason: "user-selected fast mode", forced: false, deltaCount };

  if (intentHard) return { tier: "deep", reason: "deep/high-stakes intent", forced: false, deltaCount };
  if (ambiguityHard) {
    if (graphStructuredAmbiguity) {
      return { tier: "reviewed", reason: "graph-structured responsibility and speaker ambiguity", forced: false, deltaCount };
    }
    if (priorDeep && deltaCount <= 2) {
      return { tier: "reviewed", reason: "continuing a previously deep-reviewed formulation with a narrow update", forced: false, deltaCount };
    }
    return { tier: "deep", reason: "unresolved responsibility and speaker ambiguity", forced: false, deltaCount };
  }
  if (reviewedSignal) return { tier: "reviewed", reason: "moderate ambiguity or protective conflict", forced: false, deltaCount };
  return { tier: "fast", reason: "low-ambiguity graph-following", forced: false, deltaCount };
}

function planAdjudication(snapshot, plan, safetyFlags = []) {
  return {
    answer: "",
    what_is_clear: (snapshot.direct_observations ?? []).map((item) => item.statement),
    uncertainties: [
      ...(snapshot.hypotheses ?? []).filter((item) => item.confidence !== "high").map((item) => item.claim),
      ...(snapshot.unknowns ?? []).map((item) => item.question)
    ],
    next_question: plan.nextQuestion || "",
    accepted_insights: [
      ...(plan.requiredNuance ?? []),
      ...(plan.selectedNodes ?? []).flatMap((node) => node.recommendations ?? [])
    ],
    rejected_claims: [
      ...(plan.forbiddenOverclaims ?? []),
      ...(plan.avoid ?? [])
    ],
    safety_flags: safetyFlags,
    decision_summary: `Follow the deterministic primary job ${plan.primaryJob?.title ?? "none"}; expose only the uncertainty that changes the next move.`
  };
}

async function realizePlan({ context, formulation, provider, onProgress, scaffoldMode = "current" }) {
  const authority = formulation.authority ?? classifyInterventionAuthority({ snapshot: formulation.snapshot, plan: formulation.plan });
  const effectiveScaffoldMode = scaffoldMode === "advisory" && authority.HARD.safety.length ? "current" : scaffoldMode;
  const enriched = {
    ...context,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    graphBundleVersion: formulation.graphBundleVersion,
    ...(effectiveScaffoldMode === "current" ? {} : { therapyScaffoldMode: effectiveScaffoldMode, interventionAuthority: authority })
  };
  const adjudication = planAdjudication(
    formulation.snapshot,
    formulation.plan,
    formulation.snapshot.audit?.safety_flags ?? []
  );
  const realization = await realizeAdjudication({
    context: enriched,
    adjudication,
    provider,
    onProgress,
    fixtureKey: "realization"
  });
  return { enriched, adjudication, realization, authority, deterministicSafetyGateActive: effectiveScaffoldMode !== scaffoldMode };
}

function caseAuditNotRun(reason) {
  return Object.freeze({
    remove_observation_ids: [],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "not-run",
    summary: reason
  });
}

function nonDestructiveTrace({ formulation, authority, rawSemanticFormulation = null, graphAudit = null, finalIntegrationTrace = null }) {
  return {
    version: "therapy-scaffold-trace-v1",
    rawSemanticFormulation,
    rawCaseExtraction: formulation.rawSnapshot,
    caseAuditDelta: formulation.caseAuditDelta ?? caseAuditNotRun("The current fast route did not run case audit."),
    auditedVariables: formulation.snapshot.variables,
    interventionPlan: formulation.plan,
    graphAudit,
    authority,
    finalIntegrationTrace
  };
}

async function simpleResult({ context, formulation, routing, extractor, tier, config, startedAt, caseAudit = null, stageTimings = {}, onProgress }) {
  const realizationStarted = Date.now();
  const scaffoldMode = normalizeTherapyScaffoldMode(config.therapyScaffoldMode);
  const { enriched, adjudication, realization, authority, deterministicSafetyGateActive } = await realizePlan({ context, formulation, provider: extractor, onProgress, scaffoldMode });
  const realizationMs = realization.timing?.totalMs ?? (Date.now() - realizationStarted);
  const result = {
    answer: realization.value.answer,
    mode: `${tier}-graph`,
    processingTier: tier,
    routingReason: routing.reason,
    routingDeltaCount: routing.deltaCount,
    degraded: false,
    graphBundleVersion: formulation.graphBundleVersion,
    guidePacketVersion: context.guidePacketVersion ?? null,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    next_question: realization.value.next_question || formulation.plan.nextQuestion || "",
    safety_flags: formulation.snapshot.audit?.safety_flags ?? [],
    rendererProvider: extractor.id,
    rendererModel: extractor.model,
    realizationContractVersion: "response-realization-v5",
    responseContract: realization.value.responseContract,
    performance: { ...stageTimings, realizationMs, totalMs: Date.now() - Date.parse(startedAt) },
    processingMs: Date.now() - Date.parse(startedAt)
  };
  if (scaffoldMode !== "current") {
    result.therapyScaffoldMode = scaffoldMode;
    result.scaffoldTrace = nonDestructiveTrace({
      formulation,
      authority,
      finalIntegrationTrace: {
        provider: extractor.id,
        model: extractor.model,
        requestId: realization.raw.requestId ?? realization.raw.responseId ?? null,
        deterministicSafetyGateActive,
        responseContract: realization.value.responseContract
      }
    });
  }
  const ledger = await writeLedger(config, {
    caseId: null,
    startedAt,
    completedAt: new Date().toISOString(),
    context: enriched,
    evidence: { routing, caseAudit: caseAudit?.value ?? null, planAdjudication: adjudication, realization: realization.value },
    result
  });
  return { ...result, decisionLedgerId: ledger.id, decisionLedgerPath: ledger.path };
}

async function auditedFormulation({ context, initial, providers, onProgress, caseRecovery }) {
  const audit = await runCaseAuditWithRecovery({ context, snapshot: initial.snapshot, provider: providers.openai, onProgress, recovery: caseRecovery });
  const auditedSnapshot = applyCaseAudit(initial.snapshot, audit.value);
  const planningStarted = Date.now();
  const planned = await planCaseSnapshot(auditedSnapshot);
  return {
    formulation: {
      rawSnapshot: initial.rawSnapshot,
      caseAuditDelta: audit.value,
      snapshot: auditedSnapshot,
      plan: planned.plan,
      graphBundleVersion: planned.graphBundleVersion,
      providerMetadata: {
        extractor: initial.providerMetadata.extractor,
        auditor: { provider: providers.openai.id, model: providers.openai.model, requestId: audit.raw.requestId, durationMs: audit.durationMs }
      }
    },
    audit,
    planningMs: Date.now() - planningStarted
  };
}

async function runModelFirstTiered({ context, providers, config, processingMode, onProgress, caseRecovery }) {
  const startedAt = new Date().toISOString();
  const extractor = providers.renderer ?? providers.anthropic;
  const [semantic, initial] = await Promise.all([
    runSemanticFormulation({ context, provider: extractor, onProgress }),
    runUnauditedCaseFormulation({ context, provider: extractor, onProgress, recovery: caseRecovery })
  ]);
  const routing = classifyTherapyTier(initial.snapshot, processingMode, {
    priorCaseSnapshot: context.priorCaseSnapshot,
    priorProcessingTier: context.priorProcessingTier
  });
  onProgress?.({ stage: "therapy-routing", status: "completed", detail: `${routing.tier}: ${routing.reason}` });

  let formulation = initial;
  let caseAudit = null;
  let planningMs = null;
  if (routing.tier !== "fast") {
    const audited = await auditedFormulation({ context, initial, providers, onProgress, caseRecovery });
    formulation = audited.formulation;
    caseAudit = audited.audit;
    planningMs = audited.planningMs;
  }
  const authority = classifyInterventionAuthority({ snapshot: formulation.snapshot, plan: formulation.plan });
  const graphAudit = await runBoundedGraphAudit({
    context,
    semanticFormulation: semantic.value,
    rawCaseExtraction: formulation.rawSnapshot,
    caseAuditDelta: formulation.caseAuditDelta ?? caseAuditNotRun("The current fast route did not run case audit."),
    auditedSnapshot: formulation.snapshot,
    plan: formulation.plan,
    authority,
    provider: providers.openai,
    onProgress
  });
  const deterministicSafetyGateActive = authority.HARD.safety.length > 0;
  const integration = deterministicSafetyGateActive
    ? null
    : await runModelFirstIntegration({
        context,
        semanticFormulation: semantic.value,
        rawCaseExtraction: formulation.rawSnapshot,
        caseAuditDelta: formulation.caseAuditDelta ?? caseAuditNotRun("The current fast route did not run case audit."),
        auditedSnapshot: formulation.snapshot,
        plan: formulation.plan,
        graphAudit: graphAudit.value,
        authority,
        provider: extractor,
        onProgress
      });
  const safetyRealization = deterministicSafetyGateActive
    ? await realizePlan({ context, formulation: { ...formulation, authority }, provider: extractor, onProgress, scaffoldMode: "current" })
    : null;
  const integrationValue = safetyRealization?.realization.value ?? integration.value;
  const integrationRaw = safetyRealization?.realization.raw ?? integration.raw;
  const integrationDurationMs = safetyRealization?.realization.timing?.totalMs ?? integration.durationMs;
  const enforced = enforceResponseContract(integrationValue, {
    plan: formulation.plan,
    adjudication: planAdjudication(formulation.snapshot, formulation.plan, formulation.snapshot.audit?.safety_flags ?? []),
    authorityMode: "model-first",
    authority
  });
  assertHardAuthorityPreserved(enforced.responseContract, authority);
  const completedAt = new Date().toISOString();
  const result = {
    answer: enforced.answer,
    mode: `${routing.tier}-model-first-graph-audit`,
    processingTier: routing.tier,
    routingReason: routing.reason,
    routingDeltaCount: routing.deltaCount,
    therapyScaffoldMode: "model-first",
    degraded: false,
    graphBundleVersion: formulation.graphBundleVersion,
    guidePacketVersion: context.guidePacketVersion ?? null,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    next_question: enforced.next_question,
    safety_flags: formulation.snapshot.audit?.safety_flags ?? [],
    rendererProvider: extractor.id,
    rendererModel: extractor.model,
    realizationContractVersion: "response-realization-v6-model-first",
    responseContract: enforced.responseContract,
    scaffoldTrace: nonDestructiveTrace({
      formulation,
      authority,
      rawSemanticFormulation: semantic.value,
      graphAudit: graphAudit.value,
      finalIntegrationTrace: {
        provider: extractor.id,
        model: extractor.model,
        requestId: integrationRaw.requestId ?? integrationRaw.responseId ?? null,
        deterministicSafetyGateActive,
        responseContract: enforced.responseContract
      }
    }),
    formulationProviders: {
      semantic: { provider: extractor.id, model: extractor.model, requestId: semantic.raw.requestId ?? semantic.raw.responseId ?? null },
      extractor: formulation.providerMetadata.extractor,
      auditor: formulation.providerMetadata.auditor,
      graphAuditor: { provider: providers.openai.id, model: providers.openai.model, requestId: graphAudit.raw.requestId ?? graphAudit.raw.responseId ?? null },
      integrator: { provider: extractor.id, model: extractor.model, requestId: integrationRaw.requestId ?? integrationRaw.responseId ?? null, deterministicSafetyGateActive }
    },
    performance: {
      semanticFormulationMs: semantic.durationMs,
      caseExtractionMs: initial.providerMetadata?.extractor?.durationMs ?? null,
      caseAuditMs: caseAudit?.durationMs ?? 0,
      planningMs,
      graphAuditMs: graphAudit.durationMs,
      finalIntegrationMs: integrationDurationMs,
      totalMs: Date.now() - Date.parse(startedAt)
    },
    processingMs: Date.now() - Date.parse(startedAt)
  };
  const ledgerContext = {
    ...context,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    graphBundleVersion: formulation.graphBundleVersion,
    therapyScaffoldMode: "model-first",
    interventionAuthority: authority
  };
  const ledger = await writeLedger(config, {
    caseId: null,
    startedAt,
    completedAt,
    context: ledgerContext,
    evidence: {
      rawSemanticFormulation: semantic.value,
      rawCaseExtraction: formulation.rawSnapshot,
      caseAuditDelta: formulation.caseAuditDelta ?? null,
      graphAudit: graphAudit.value,
      finalIntegration: integrationValue,
      deterministicSafetyGateActive
    },
    result
  });
  return { ...result, decisionLedgerId: ledger.id, decisionLedgerPath: ledger.path };
}

export async function runTieredTherapyPipeline({ context, providers, config, processingMode = "auto", onProgress, caseRecovery }) {
  const scaffoldMode = normalizeTherapyScaffoldMode(config.therapyScaffoldMode ?? "current");
  if (scaffoldMode === "model-first") {
    return await runModelFirstTiered({ context, providers, config, processingMode, onProgress, caseRecovery });
  }
  const startedAt = new Date().toISOString();
  const extractor = providers.renderer ?? providers.anthropic;
  const initial = await runUnauditedCaseFormulation({ context, provider: extractor, onProgress, recovery: caseRecovery });
  const routing = classifyTherapyTier(initial.snapshot, processingMode, {
    priorCaseSnapshot: context.priorCaseSnapshot,
    priorProcessingTier: context.priorProcessingTier
  });
  onProgress?.({ stage: "therapy-routing", status: "completed", detail: `${routing.tier}: ${routing.reason}` });

  if (routing.tier === "fast") {
    return await simpleResult({
      context, formulation: initial, routing, extractor, tier: "fast", config, startedAt, onProgress,
      stageTimings: { caseExtractionMs: initial.providerMetadata?.extractor?.durationMs ?? null, caseAuditMs: 0, planningMs: null }
    });
  }

  const audited = await auditedFormulation({ context, initial, providers, onProgress, caseRecovery });
  const { formulation, audit, planningMs } = audited;

  if (routing.tier === "reviewed") {
    return await simpleResult({
      context, formulation, routing, extractor, tier: "reviewed", config, startedAt, caseAudit: audit, onProgress,
      stageTimings: {
        caseExtractionMs: initial.providerMetadata?.extractor?.durationMs ?? null,
        caseAuditMs: audit.durationMs ?? null,
        planningMs
      }
    });
  }

  const authority = classifyInterventionAuthority({ snapshot: formulation.snapshot, plan: formulation.plan });
  const deterministicSafetyGateActive = scaffoldMode === "advisory" && authority.HARD.safety.length > 0;
  const effectiveScaffoldMode = deterministicSafetyGateActive ? "current" : scaffoldMode;
  const enrichedContext = {
    ...context,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    graphBundleVersion: formulation.graphBundleVersion,
    ...(effectiveScaffoldMode === "current" ? {} : { therapyScaffoldMode: effectiveScaffoldMode, interventionAuthority: authority })
  };

  if (routing.tier === "deep") {
    const deep = await runCompactAdversarialPipeline({ context: enrichedContext, providers, config, onProgress });
    const result = {
      ...deep,
      mode: "deep",
      processingTier: "deep",
      routingReason: routing.reason,
      routingDeltaCount: routing.deltaCount,
      graphBundleVersion: formulation.graphBundleVersion,
      guidePacketVersion: context.guidePacketVersion ?? null,
      caseFormulation: formulation.snapshot,
      interventionContract: formulation.plan,
      formulationProviders: formulation.providerMetadata,
      performance: {
        ...(deep.performance ?? {}),
        caseExtractionMs: initial.providerMetadata?.extractor?.durationMs ?? null,
        caseAuditMs: audit.durationMs ?? null,
        planningMs,
        totalMs: Date.now() - Date.parse(startedAt)
      },
      processingMs: Date.now() - Date.parse(startedAt)
    };
    if (scaffoldMode !== "current") {
      result.therapyScaffoldMode = scaffoldMode;
      result.scaffoldTrace = nonDestructiveTrace({
        formulation,
        authority,
        finalIntegrationTrace: { responseContract: deep.responseContract, model: deep.rendererModel, deterministicSafetyGateActive }
      });
    }
    return result;
  }

  const forensic = await runAdversarialPipeline({ context: enrichedContext, providers, config, onProgress });
  const result = {
    ...forensic,
    mode: "forensic",
    processingTier: "forensic",
    routingReason: routing.reason,
    routingDeltaCount: routing.deltaCount,
    graphBundleVersion: formulation.graphBundleVersion,
    guidePacketVersion: context.guidePacketVersion ?? null,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    formulationProviders: formulation.providerMetadata,
    performance: {
      ...(forensic.performance ?? {}),
      caseExtractionMs: initial.providerMetadata?.extractor?.durationMs ?? null,
      caseAuditMs: audit.durationMs ?? null,
      planningMs,
      totalMs: Date.now() - Date.parse(startedAt)
    },
    processingMs: Date.now() - Date.parse(startedAt)
  };
  if (scaffoldMode !== "current") {
    result.therapyScaffoldMode = scaffoldMode;
    result.scaffoldTrace = nonDestructiveTrace({
      formulation,
      authority,
      finalIntegrationTrace: { responseContract: forensic.responseContract, model: forensic.rendererModel, deterministicSafetyGateActive }
    });
  }
  return result;
}
