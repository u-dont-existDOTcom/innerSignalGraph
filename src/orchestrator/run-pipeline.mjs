import { candidatePrompt } from "../prompts/candidate.mjs";
import { critiquePrompt } from "../prompts/critique.mjs";
import { adjudicationPrompt } from "../prompts/adjudicate.mjs";
import { realizationPrompt } from "../prompts/realize.mjs";
import { parseModelJson } from "../core/json.mjs";
import { validateCandidate, validateCritique, validateAdjudication, validateRealization } from "../schemas/validators.mjs";
import { candidateSchema, critiqueSchema, adjudicationSchema, realizationSchema } from "../schemas/json-schemas.mjs";
import { writeLedger } from "./ledger.mjs";
import { RuntimeError } from "../core/errors.mjs";
import { enforceResponseContract } from "./response-contract.mjs";
import { assertHardAuthorityPreserved } from "./scaffold-authority.mjs";

async function structuredCall(provider, prompt, metadata, validator, outputSchema, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: `${metadata.stage}:${provider.id}`, status: "started", detail: provider.model });
  const request = { ...prompt, metadata, outputSchema };
  let raw;
  let value;
  try {
    raw = await provider.generate(request);
    const parsed = parseModelJson(raw.text, `${provider.id} ${metadata.stage}`);
    value = validator(parsed);
  } catch (error) {
    if (raw) await provider.recordConsumerFailure?.({ request, error });
    throw error;
  }
  const durationMs = Date.now() - started;
  onProgress?.({ stage: `${metadata.stage}:${provider.id}`, status: "completed", detail: `${(durationMs / 1000).toFixed(1)}s` });
  return { value, raw, durationMs };
}

export async function realizeAdjudication({ context, adjudication, provider, onProgress, fixtureKey = "realization" }) {
  const authorityMode = context.therapyScaffoldMode === "advisory" ? "advisory" : "current";
  const attempts = [];
  let rawResult = await structuredCall(
    provider,
    realizationPrompt(context, adjudication, provider.id === "anthropic" ? "Claude" : "OpenAI"),
    { stage: "realization", fixtureKey },
    validateRealization,
    realizationSchema,
    onProgress
  );
  attempts.push({ stage: "realization", durationMs: rawResult.durationMs, provider: provider.id, model: provider.model });
  let enforced = enforceResponseContract(rawResult.value, {
    plan: context.interventionContract,
    adjudication,
    authorityMode,
    authority: context.interventionAuthority
  });
  assertHardAuthorityPreserved(enforced.responseContract, context.interventionAuthority);

  // A selected intervention that disappears during prose realization is a
  // model-contract miss, not a reason to silently misrepresent the route.
  // Retry the renderer once with the exact missing node IDs. This adds no
  // latency when the first realization faithfully covers the plan.
  if (authorityMode === "current" && !enforced.responseContract.realizationCoveragePassed && !String(provider.model || "").startsWith("mock-")) {
    const retryContext = {
      ...context,
      autopilotFeedback: {
        type: "realization-coverage-retry",
        missingNodeIds: enforced.responseContract.missingRealizationNodeIds,
        instruction: "Rewrite the response so every missing selected intervention is materially realized. Preserve the canonical question and all prior epistemic constraints."
      }
    };
    rawResult = await structuredCall(
      provider,
      realizationPrompt(retryContext, adjudication, provider.id === "anthropic" ? "Claude" : "OpenAI"),
      { stage: "realization_retry", fixtureKey },
      validateRealization,
      realizationSchema,
      onProgress
    );
    attempts.push({ stage: "realization_retry", durationMs: rawResult.durationMs, provider: provider.id, model: provider.model });
    enforced = enforceResponseContract(rawResult.value, {
      plan: context.interventionContract,
      adjudication,
      authorityMode,
      authority: context.interventionAuthority
    });
    assertHardAuthorityPreserved(enforced.responseContract, context.interventionAuthority);
  }

  return {
    ...rawResult,
    value: { ...rawResult.value, ...enforced },
    timing: { totalMs: attempts.reduce((sum, item) => sum + item.durationMs, 0), attempts }
  };
}



function uniqueStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.flat(Infinity)) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function compactAdjudicationPacket(context, candidate, critique) {
  const snapshot = context.caseFormulation ?? {};
  const plan = context.interventionContract ?? {};
  const hypotheses = Array.isArray(snapshot.hypotheses) ? snapshot.hypotheses : [];
  const unknowns = Array.isArray(snapshot.unknowns) ? snapshot.unknowns : [];
  const observations = Array.isArray(snapshot.direct_observations) ? snapshot.direct_observations : [];
  const rejected = uniqueStrings([
    critique.unsupported_assignments,
    critique.generic_therapy_scripts,
    critique.premature_siding,
    critique.age_or_agency_conflations,
    critique.guide_misapplications,
    plan.forbiddenOverclaims,
    plan.avoid
  ]);
  const accepted = uniqueStrings([
    critique.strongest_insights,
    candidate.proposed_intervention,
    plan.requiredNuance,
    (plan.selectedNodes ?? []).flatMap((node) => node.recommendations ?? [])
  ]);
  return {
    answer: candidate.response_draft,
    what_is_clear: uniqueStrings([
      observations.map((item) => item.statement),
      candidate.direct_observations
    ]),
    uncertainties: uniqueStrings([
      hypotheses.filter((item) => item.confidence !== "high").map((item) => item.claim),
      unknowns.map((item) => item.question),
      candidate.unresolved_questions
    ]),
    next_question: plan.nextQuestion || candidate.unresolved_questions?.[0] || "",
    accepted_insights: accepted,
    rejected_claims: rejected,
    safety_flags: uniqueStrings([
      snapshot.audit?.safety_flags ?? [],
      candidate.risk_flags,
      critique.safety_or_memory_risks
    ]),
    decision_summary: `Deep review used one Opus formulation against the deterministic ${plan.primaryJob?.title ?? "case"} plan and one independent GPT adversarial critique. Preserve the candidate's strong insights, apply every required correction, and do not reintroduce rejected claims.`
  };
}

export async function runCompactAdversarialReasoning({ context, providers, onProgress }) {
  const thinker = providers.anthropic;
  const critic = providers.openai;
  const candidate = await structuredCall(
    thinker,
    candidatePrompt(context, "Anthropic"),
    { stage: "deep_analysis", fixtureKey: "candidate" },
    validateCandidate,
    candidateSchema,
    onProgress
  );
  const critique = await structuredCall(
    critic,
    critiquePrompt(context, candidate.value, "OpenAI", "Anthropic"),
    { stage: "deep_critique", fixtureKey: "critique_anthropic" },
    validateCritique,
    critiqueSchema,
    onProgress
  );
  const adjudication = compactAdjudicationPacket(context, candidate.value, critique.value);
  return {
    adjudication,
    evidence: { anthropicDeepAnalysis: candidate.value, openaiCritique: critique.value },
    providerMetadata: {
      thinker: { provider: thinker.id, model: thinker.model, requestId: candidate.raw.requestId },
      critic: { provider: critic.id, model: critic.model, requestId: critique.raw.requestId }
    },
    providerStages: [
      { stage: "deep_analysis", provider: thinker.id, model: thinker.model, requestId: candidate.raw.requestId ?? null, durationMs: candidate.durationMs },
      { stage: "deep_critique", provider: critic.id, model: critic.model, requestId: critique.raw.requestId ?? null, durationMs: critique.durationMs }
    ],
    performance: { deepAnalysisMs: candidate.durationMs, deepCritiqueMs: critique.durationMs }
  };
}

export async function runCompactAdversarialPipeline({ context, providers, config, caseId = null, onProgress }) {
  const startedAt = new Date().toISOString();
  const reasoning = await runCompactAdversarialReasoning({ context, providers, onProgress });
  const adjudication = reasoning.adjudication;
  const renderer = providers.renderer ?? providers.anthropic;
  const realization = await realizeAdjudication({ context, adjudication, provider: renderer, onProgress });

  const result = {
    answer: realization.value.answer,
    mode: "deep-compact",
    degraded: false,
    guideVersion: context.guideManifest.version,
    providersCompleted: ["anthropic", "openai"],
    adjudicatorProvider: "deterministic-compact",
    rendererProvider: renderer.id,
    rendererModel: renderer.model,
    realizationContractVersion: "response-realization-v5",
    responseContract: realization.value.responseContract,
    what_is_clear: adjudication.what_is_clear,
    uncertainties: adjudication.uncertainties,
    next_question: realization.value.next_question || adjudication.next_question,
    accepted_insights: adjudication.accepted_insights,
    rejected_claims: adjudication.rejected_claims,
    safety_flags: adjudication.safety_flags,
    decision_summary: adjudication.decision_summary
  };

  const ledger = await writeLedger(config, {
    caseId,
    startedAt,
    completedAt: new Date().toISOString(),
    context,
    evidence: {
      ...reasoning.evidence,
      adjudication,
      realization: realization.value,
      providerMetadata: {
        ...reasoning.providerMetadata,
        renderer: { provider: renderer.id, model: renderer.model, requestId: realization.raw.requestId }
      }
    },
    result
  });

  return { ...result, adjudicationPacket: adjudication, decisionLedgerId: ledger.id, decisionLedgerPath: ledger.path };
}

export async function runAdversarialReasoning({ context, providers, config, onProgress }) {
  const openaiCandidatePrompt = candidatePrompt(context, "OpenAI");
  const anthropicCandidatePrompt = candidatePrompt(context, "Anthropic");

  let candidateResults;
  try {
    candidateResults = await Promise.all([
      structuredCall(providers.openai, openaiCandidatePrompt, { stage: "candidate", fixtureKey: "candidate" }, validateCandidate, candidateSchema, onProgress),
      structuredCall(providers.anthropic, anthropicCandidatePrompt, { stage: "candidate", fixtureKey: "candidate" }, validateCandidate, candidateSchema, onProgress)
    ]);
  } catch (error) {
    if (!config.allowDegraded) throw error;
    throw new RuntimeError("Degraded mode is not implemented; adversarial review requires both providers.", {
      code: "DEGRADED_UNAVAILABLE",
      cause: error
    });
  }

  const [openaiCandidate, anthropicCandidate] = candidateResults;
  const [openaiCritique, anthropicCritique] = await Promise.all([
    structuredCall(
      providers.openai,
      critiquePrompt(context, anthropicCandidate.value, "OpenAI", "Anthropic"),
      { stage: "critique", fixtureKey: "critique_anthropic" },
      validateCritique,
      critiqueSchema,
      onProgress
    ),
    structuredCall(
      providers.anthropic,
      critiquePrompt(context, openaiCandidate.value, "Anthropic", "OpenAI"),
      { stage: "critique", fixtureKey: "critique_openai" },
      validateCritique,
      critiqueSchema,
      onProgress
    )
  ]);

  const evidence = {
    openaiCandidate: openaiCandidate.value,
    anthropicCandidate: anthropicCandidate.value,
    openaiCritiqueOfAnthropic: openaiCritique.value,
    anthropicCritiqueOfOpenAI: anthropicCritique.value
  };

  const adjudicator = providers[config.adjudicatorProvider];
  const adjudication = await structuredCall(
    adjudicator,
    adjudicationPrompt(context, evidence, config.adjudicatorProvider),
    { stage: "adjudication", fixtureKey: "adjudication" },
    validateAdjudication,
    adjudicationSchema,
    onProgress
  );

  const providerMetadata = {
    openai: {
      model: providers.openai.model,
      candidateRequestId: openaiCandidate.raw.requestId,
      critiqueRequestId: openaiCritique.raw.requestId
    },
    anthropic: {
      model: providers.anthropic.model,
      candidateRequestId: anthropicCandidate.raw.requestId,
      critiqueRequestId: anthropicCritique.raw.requestId
    },
    adjudicator: {
      provider: config.adjudicatorProvider,
      model: adjudicator.model,
      requestId: adjudication.raw.requestId
    }
  };

  return {
    adjudication: adjudication.value,
    evidence,
    providerMetadata,
    providerStages: [
      { stage: "candidate_openai", provider: providers.openai.id, model: providers.openai.model, requestId: openaiCandidate.raw.requestId ?? null, durationMs: openaiCandidate.durationMs },
      { stage: "candidate_anthropic", provider: providers.anthropic.id, model: providers.anthropic.model, requestId: anthropicCandidate.raw.requestId ?? null, durationMs: anthropicCandidate.durationMs },
      { stage: "critique_openai", provider: providers.openai.id, model: providers.openai.model, requestId: openaiCritique.raw.requestId ?? null, durationMs: openaiCritique.durationMs },
      { stage: "critique_anthropic", provider: providers.anthropic.id, model: providers.anthropic.model, requestId: anthropicCritique.raw.requestId ?? null, durationMs: anthropicCritique.durationMs },
      { stage: "adjudication", provider: adjudicator.id, model: adjudicator.model, requestId: adjudication.raw.requestId ?? null, durationMs: adjudication.durationMs }
    ],
    performance: {
      openaiCandidateMs: openaiCandidate.durationMs,
      anthropicCandidateMs: anthropicCandidate.durationMs,
      openaiCritiqueMs: openaiCritique.durationMs,
      anthropicCritiqueMs: anthropicCritique.durationMs,
      adjudicationMs: adjudication.durationMs
    }
  };
}

export async function runAdversarialPipeline({ context, providers, config, caseId = null, onProgress }) {
  const startedAt = new Date().toISOString();
  const reasoning = await runAdversarialReasoning({ context, providers, config, onProgress });

  // The renderer deliberately receives the completed reasoning packet rather than
  // being asked to rediscover the case. By default the active Anthropic model
  // realizes the response; a later benchmark can safely substitute a cheaper
  // renderer without changing formulation or planning.
  const renderer = providers.renderer ?? providers.anthropic;
  const realization = await realizeAdjudication({
    context,
    adjudication: reasoning.adjudication,
    provider: renderer,
    onProgress
  });

  const providerMetadata = {
    ...reasoning.providerMetadata,
    renderer: {
      provider: renderer.id,
      model: renderer.model,
      requestId: realization.raw.requestId,
      contractVersion: "response-realization-v5"
    }
  };

  const result = {
    answer: realization.value.answer,
    mode: "adversarial",
    degraded: false,
    guideVersion: context.guideManifest.version,
    providersCompleted: ["openai", "anthropic"],
    adjudicatorProvider: config.adjudicatorProvider,
    rendererProvider: renderer.id,
    rendererModel: renderer.model,
    realizationContractVersion: "response-realization-v5",
    responseContract: realization.value.responseContract,
    what_is_clear: reasoning.adjudication.what_is_clear,
    uncertainties: reasoning.adjudication.uncertainties,
    next_question: realization.value.next_question || reasoning.adjudication.next_question,
    accepted_insights: reasoning.adjudication.accepted_insights,
    rejected_claims: reasoning.adjudication.rejected_claims,
    safety_flags: reasoning.adjudication.safety_flags,
    decision_summary: reasoning.adjudication.decision_summary
  };

  const ledger = await writeLedger(config, {
    caseId,
    startedAt,
    completedAt: new Date().toISOString(),
    context,
    evidence: {
      ...reasoning.evidence,
      adjudication: reasoning.adjudication,
      realization: realization.value,
      providerMetadata
    },
    result
  });

  return {
    ...result,
    adjudicationPacket: reasoning.adjudication,
    decisionLedgerId: ledger.id,
    decisionLedgerPath: ledger.path
  };
}
