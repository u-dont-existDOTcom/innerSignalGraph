import { parseModelJson } from "../core/json.mjs";
import {
  hypnosisDraftSchema,
  hypnosisReviewSchema,
  hypnosisFinalReviewSchema
} from "../schemas/json-schemas.mjs";
import {
  validateHypnosisDraft,
  validateHypnosisReview,
  validateHypnosisFinalReview
} from "../hypnosis/validate-draft.mjs";
import { auditHypnosisDraft } from "../hypnosis/deterministic-audit.mjs";
import { buildHypnosisPlaybackPlan } from "../hypnosis/compiler.mjs";
import { hypnosisDraftPrompt } from "../prompts/hypnosis-draft.mjs";
import { hypnosisReviewPrompt } from "../prompts/hypnosis-review.mjs";
import { hypnosisRepairPrompt } from "../prompts/hypnosis-repair.mjs";
import { hypnosisFinalReviewPrompt } from "../prompts/hypnosis-final-review.mjs";
import { writeLedger } from "./ledger.mjs";

async function structuredCall(provider, prompt, metadata, validator, outputSchema, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: metadata.stage, status: "started", detail: `${provider.id}/${provider.model}` });
  const raw = await provider.generate({ ...prompt, metadata, outputSchema });
  const parsed = parseModelJson(raw.text, `${provider.id} ${metadata.stage}`);
  const value = validator(parsed);
  onProgress?.({ stage: metadata.stage, status: "completed", detail: `${((Date.now() - started) / 1000).toFixed(1)}s` });
  return { value, raw };
}

export async function runHypnosisCompilerPipeline({ context, providers, config, caseId = null, onProgress }) {
  const startedAt = new Date().toISOString();
  const writer = providers[config.hypnosisWriterProvider];
  const reviewer = providers[config.hypnosisReviewerProvider];
  const repairer = providers[config.hypnosisRepairProvider];
  const finalReviewer = providers[config.hypnosisFinalReviewerProvider];

  const initial = await structuredCall(
    writer,
    hypnosisDraftPrompt(context, config.hypnosisWriterProvider),
    { stage: "hypnosis_draft", fixtureKey: "hypnosis_draft" },
    validateHypnosisDraft,
    hypnosisDraftSchema,
    onProgress
  );
  const initialAudit = auditHypnosisDraft(initial.value);

  const review = await structuredCall(
    reviewer,
    hypnosisReviewPrompt(
      context,
      initial.value,
      initialAudit,
      config.hypnosisReviewerProvider,
      config.hypnosisWriterProvider
    ),
    { stage: "hypnosis_review", fixtureKey: "hypnosis_review" },
    validateHypnosisReview,
    hypnosisReviewSchema,
    onProgress
  );

  const repaired = await structuredCall(
    repairer,
    hypnosisRepairPrompt(context, initial.value, initialAudit, review.value, config.hypnosisRepairProvider),
    { stage: "hypnosis_repair", fixtureKey: "hypnosis_repair" },
    validateHypnosisDraft,
    hypnosisDraftSchema,
    onProgress
  );
  const repairedAudit = auditHypnosisDraft(repaired.value);

  const finalReview = await structuredCall(
    finalReviewer,
    hypnosisFinalReviewPrompt(context, repaired.value, repairedAudit, config.hypnosisFinalReviewerProvider),
    { stage: "hypnosis_final_review", fixtureKey: "hypnosis_final_review" },
    validateHypnosisFinalReview,
    hypnosisFinalReviewSchema,
    onProgress
  );

  const releaseable = repairedAudit.ok && finalReview.value.verdict === "pass";
  const playbackPlan = releaseable ? buildHypnosisPlaybackPlan(repaired.value) : null;
  const providerMetadata = {
    writer: { provider: config.hypnosisWriterProvider, model: writer.model, requestId: initial.raw.requestId },
    reviewer: { provider: config.hypnosisReviewerProvider, model: reviewer.model, requestId: review.raw.requestId },
    repairer: { provider: config.hypnosisRepairProvider, model: repairer.model, requestId: repaired.raw.requestId },
    finalReviewer: { provider: config.hypnosisFinalReviewerProvider, model: finalReviewer.model, requestId: finalReview.raw.requestId }
  };

  const result = {
    mode: "hypnosis-compiler",
    status: releaseable ? "releaseable" : "blocked",
    releaseable,
    contractVersion: repaired.value.contract_version,
    guideVersion: context.guideManifest.version,
    guidePacketVersion: context.guidePacketVersion ?? null,
    graphBundleVersion: context.graphBundleVersion,
    target: repaired.value.target,
    relationship: repaired.value.relationship,
    deterministicAudit: repairedAudit,
    finalReview: finalReview.value,
    playbackPlan,
    aftercare: releaseable ? repaired.value.aftercare : null
  };

  const ledger = await writeLedger(config, {
    kind: "hypnosis-compiler",
    caseId,
    startedAt,
    completedAt: new Date().toISOString(),
    context,
    evidence: {
      initialDraft: initial.value,
      initialAudit,
      adversarialReview: review.value,
      repairedDraft: repaired.value,
      repairedAudit,
      finalReview: finalReview.value,
      providerMetadata
    },
    result
  });

  return { ...result, decisionLedgerId: ledger.id, decisionLedgerPath: ledger.path };
}
