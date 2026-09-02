import { parseModelJson } from "../core/json.mjs";
import {
  hypnosisDraftSchema,
  hypnosisReviewSchema,
  hypnosisRepairPatchSchema,
  hypnosisFinalReviewSchema
} from "../schemas/json-schemas.mjs";
import {
  validateHypnosisDraft,
  validateHypnosisReview,
  validateHypnosisRepairPatch,
  validateHypnosisFinalReview
} from "../hypnosis/validate-draft.mjs";
import { auditHypnosisDraft } from "../hypnosis/deterministic-audit.mjs";
import {
  attributeHypnosisAuditIssues,
  attributeHypnosisReviewFindings,
  buildHypnosisRepairScope,
  mergeHypnosisRepairPatch
} from "../hypnosis/component-repair.mjs";
import { buildHypnosisPlaybackPlan } from "../hypnosis/compiler.mjs";
import { hypnosisDraftPrompt } from "../prompts/hypnosis-draft.mjs";
import { hypnosisReviewPrompt } from "../prompts/hypnosis-review.mjs";
import { hypnosisRepairPrompt } from "../prompts/hypnosis-repair.mjs";
import { hypnosisFinalReviewPrompt } from "../prompts/hypnosis-final-review.mjs";
import { writeLedger } from "./ledger.mjs";

const SCOPED_REPAIR_FAILURE_CODES = new Set([
  "REVIEW_SCOPE_INVALID",
  "PATCH_SCOPE_MISMATCH",
  "UNKNOWN_PATCH_COMPONENT",
  "DEPENDENCY_INVARIANT_FAILURE",
  "PRESERVATION_INVARIANT_FAILURE"
]);

async function structuredCall(provider, prompt, metadata, validator, outputSchema, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: metadata.stage, status: "started", detail: `${provider.id}/${provider.model}` });
  const raw = await provider.generate({ ...prompt, metadata, outputSchema });
  const parsed = parseModelJson(raw.text, `${provider.id} ${metadata.stage}`);
  try {
    const value = validator(parsed);
    onProgress?.({ stage: metadata.stage, status: "completed", detail: `${((Date.now() - started) / 1000).toFixed(1)}s` });
    return { value, raw };
  } catch (error) {
    error.structuredCallEvidence = { parsed, raw };
    throw error;
  }
}

function providerRecord(configuredProvider, provider, call) {
  if (!call) return null;
  return {
    provider: configuredProvider,
    model: provider.model,
    requestId: call.raw.requestId
  };
}

function repairFailure(code, stage, targetIds = []) {
  return { code, stage, targetIds: [...new Set(targetIds)] };
}

function failureTargets(error) {
  const componentId = error?.details?.componentId;
  return componentId ? [componentId] : [];
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
  let review = null;
  let repair = null;
  let finalReview = null;
  let repairScope = null;
  let repairPatch = null;
  let preservation = null;
  let mergedDraft = null;
  let repairedAudit = null;

  const providerMetadata = {
    writer: providerRecord(config.hypnosisWriterProvider, writer, initial),
    reviewer: null,
    repairer: null,
    finalReviewer: null
  };

  async function finish(failure = null) {
    const releaseable = Boolean(
      mergedDraft && repairedAudit?.ok === true && finalReview?.value?.verdict === "pass" && !failure
    );
    const authoritativeDraft = mergedDraft ?? initial.value;
    const result = {
      mode: "hypnosis-compiler",
      status: releaseable ? "releaseable" : "blocked",
      releaseable,
      contractVersion: authoritativeDraft.contract_version,
      guideVersion: context.guideManifest.version,
      guidePacketVersion: context.guidePacketVersion ?? null,
      graphBundleVersion: context.graphBundleVersion,
      target: authoritativeDraft.target,
      relationship: authoritativeDraft.relationship,
      deterministicAudit: repairedAudit ?? initialAudit,
      finalReview: finalReview?.value ?? null,
      repairScope,
      repairFailure: failure,
      playbackPlan: releaseable ? buildHypnosisPlaybackPlan(authoritativeDraft) : null,
      aftercare: releaseable ? authoritativeDraft.aftercare : null
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
        adversarialReview: review?.value ?? review?.structuredCallEvidence?.parsed ?? null,
        repairScope,
        repairPatch,
        preservation,
        mergedDraft,
        repairedAudit,
        finalReview: finalReview?.value ?? null,
        repairFailure: failure,
        providerMetadata
      },
      result
    });

    return { ...result, decisionLedgerId: ledger.id, decisionLedgerPath: ledger.path };
  }

  try {
    review = await structuredCall(
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
    providerMetadata.reviewer = providerRecord(config.hypnosisReviewerProvider, reviewer, review);
  } catch (error) {
    if (error.code !== "REVIEW_SCOPE_INVALID") throw error;
    review = error;
    providerMetadata.reviewer = error.structuredCallEvidence ? {
      provider: config.hypnosisReviewerProvider,
      model: reviewer.model,
      requestId: error.structuredCallEvidence.raw.requestId
    } : null;
    return finish(repairFailure("REVIEW_SCOPE_INVALID", "hypnosis_review"));
  }

  const deterministicAttribution = attributeHypnosisAuditIssues(initialAudit);
  const reviewAttribution = attributeHypnosisReviewFindings(review.value);
  repairScope = buildHypnosisRepairScope(deterministicAttribution, reviewAttribution);

  if (deterministicAttribution.blockingIssues.length > 0) {
    const code = deterministicAttribution.blockingIssues.some(
      (issue) => issue.failureCode === "UNREPAIRABLE_DETERMINISTIC_ISSUE"
    ) ? "UNREPAIRABLE_DETERMINISTIC_ISSUE" : "UNMAPPED_DETERMINISTIC_ISSUE";
    const targetIds = deterministicAttribution.blockingIssues.flatMap((issue) => issue.targetIds);
    return finish(repairFailure(code, "deterministic_attribution", targetIds));
  }

  if (review.value.verdict === "reject" || reviewAttribution.blockingIssues.length > 0) {
    const targetIds = reviewAttribution.blockingIssues.flatMap((finding) => finding.targetIds);
    return finish(repairFailure("ADVERSARIAL_REJECT", "hypnosis_review", targetIds));
  }

  if (repairScope.componentIds.length === 0) {
    onProgress?.({ stage: "hypnosis_repair", status: "skipped", detail: "No failed component scope" });
    const identity = mergeHypnosisRepairPatch(
      initial.value,
      repairScope,
      { patch_version: "hypnosis-component-patch-v1", replacements: [] },
      { validateDraft: validateHypnosisDraft }
    );
    mergedDraft = identity.mergedDraft;
    preservation = identity.preservation;
  } else {
    try {
      repair = await structuredCall(
        repairer,
        hypnosisRepairPrompt(
          context,
          initial.value,
          initialAudit,
          review.value,
          repairScope,
          config.hypnosisRepairProvider
        ),
        { stage: "hypnosis_repair", fixtureKey: "hypnosis_repair" },
        validateHypnosisRepairPatch,
        hypnosisRepairPatchSchema,
        onProgress
      );
      providerMetadata.repairer = providerRecord(config.hypnosisRepairProvider, repairer, repair);
      repairPatch = repair.value;

      const merged = mergeHypnosisRepairPatch(initial.value, repairScope, repairPatch, {
        validateDraft: validateHypnosisDraft
      });
      mergedDraft = merged.mergedDraft;
      preservation = merged.preservation;
    } catch (error) {
      if (!SCOPED_REPAIR_FAILURE_CODES.has(error.code)) throw error;
      if (error.structuredCallEvidence) {
        repairPatch = error.structuredCallEvidence.parsed;
        providerMetadata.repairer = {
          provider: config.hypnosisRepairProvider,
          model: repairer.model,
          requestId: error.structuredCallEvidence.raw.requestId
        };
      }
      return finish(repairFailure(error.code, "hypnosis_repair", failureTargets(error)));
    }
  }

  repairedAudit = auditHypnosisDraft(mergedDraft);
  finalReview = await structuredCall(
    finalReviewer,
    hypnosisFinalReviewPrompt(context, mergedDraft, repairedAudit, config.hypnosisFinalReviewerProvider),
    { stage: "hypnosis_final_review", fixtureKey: "hypnosis_final_review" },
    validateHypnosisFinalReview,
    hypnosisFinalReviewSchema,
    onProgress
  );
  providerMetadata.finalReviewer = providerRecord(config.hypnosisFinalReviewerProvider, finalReviewer, finalReview);

  if (!repairedAudit.ok) {
    const attribution = attributeHypnosisAuditIssues(repairedAudit);
    const targetIds = attribution.attributions.flatMap((issue) => issue.targetIds);
    return finish(repairFailure("REPAIRED_AUDIT_FAILED", "repaired_audit", targetIds));
  }
  if (finalReview.value.verdict !== "pass") {
    return finish(repairFailure("FINAL_REVIEW_REVISE_OR_REJECT", "hypnosis_final_review"));
  }
  return finish();
}
