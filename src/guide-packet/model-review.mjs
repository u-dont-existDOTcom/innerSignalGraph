import { parseModelJson } from "../core/json.mjs";
import { verifyGuidePacket } from "./verifier.mjs";
import { assertExactGuidePacketModel } from "./model-policy.mjs";

const auditSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "unresolved_material_disagreement", "findings", "recommended_owner_decisions", "worst_plausible_failure"],
  properties: {
    verdict: { type: "string", enum: ["pass", "review", "reject"] },
    summary: { type: "string" },
    unresolved_material_disagreement: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "reason", "required_action"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "review", "block"] },
          reason: { type: "string" },
          required_action: { type: "string" }
        }
      }
    },
    recommended_owner_decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["card_id", "recommendation", "reason"],
        properties: {
          card_id: { type: "string" },
          recommendation: { type: "string", enum: ["approve", "keep-current", "edit"] },
          reason: { type: "string" }
        }
      }
    },
    worst_plausible_failure: { type: "string" }
  }
};

function validateAudit(value) {
  if (!value || typeof value !== "object") throw new Error("Guide packet review must return an object.");
  if (!["pass", "review", "reject"].includes(value.verdict)) throw new Error("Guide packet review verdict must be pass, review, or reject.");
  if (typeof value.summary !== "string") throw new Error("Guide packet review summary is required.");
  if (typeof value.unresolved_material_disagreement !== "boolean") throw new Error("Guide packet review must declare unresolved_material_disagreement.");
  if (!Array.isArray(value.findings)) throw new Error("Guide packet review findings must be an array.");
  if (!Array.isArray(value.recommended_owner_decisions)) throw new Error("Guide packet review owner recommendations must be an array.");
  if (typeof value.worst_plausible_failure !== "string") throw new Error("Guide packet review worst plausible failure is required.");
  return value;
}

function auditInput(verified, compilationReport = null) {
  return {
    manifest: {
      packetId: verified.manifest.packetId,
      packetVersion: verified.manifest.packetVersion,
      packetRevision: verified.manifest.packetRevision,
      guides: verified.manifest.guides.map((guide) => ({ id: guide.id, revision: guide.revision, sourceSha256: guide.sourceSha256, graphSha256: guide.graphSha256 })),
      sourceFamilyPackages: verified.manifest.sourceFamilyPackages
    },
    deterministicVerification: {
      warnings: verified.warnings,
      qualityAudit: verified.qualityAudit,
      behavioralDiff: verified.behavioralDiff
    },
    decisionCards: verified.decisionCards,
    provenanceRoles: Object.values(verified.provenance?.nodes ?? {}).reduce((counts, item) => {
      counts[item.role ?? "unknown"] = (counts[item.role ?? "unknown"] ?? 0) + 1;
      return counts;
    }, {}),
    authorityRules: verified.certainty?.rules ?? [],
    sourceRoleCompilationReport: compilationReport
  };
}

async function callReviewer(provider, input, { escalation = false, priorAudit = null } = {}) {
  const prompt = escalation
    ? {
        system: "You are Claude Fable 5 adjudicating a difficult unresolved Guide Packet source-role disagreement. Preserve owner authority. Do not rewrite policy. Return only the requested JSON schema.",
        user: `Independent Codex audit:\n${JSON.stringify(priorAudit, null, 2)}\n\nVerified candidate packet summary:\n${JSON.stringify(input, null, 2)}\n\nDecide whether the unresolved disagreement is source-supported, requires an owner decision, or must reject installation.`
      }
    : {
        system: "You are the independent Codex auditor for an Inner Signal Guide Packet. Audit source support, provenance, certainty, behavioral decision cards, stale source/graph risk, regression implications, and owner-authority boundaries. Do not approve policy on Joel's behalf. Return only the requested JSON schema.",
        user: `Source-role compilation report:\n${JSON.stringify(input.sourceRoleCompilationReport, null, 2)}\n\nAudit this deterministically verified candidate Guide Packet:\n${JSON.stringify(input, null, 2)}`
      };
  const raw = await provider.generate({ ...prompt, outputSchema: auditSchema, metadata: { stage: escalation ? "guide_packet_fable_adjudication" : "guide_packet_independent_audit" } });
  return { value: validateAudit(parseModelJson(raw.text, `${provider.id} guide packet review`)), raw };
}

async function directStageExecutor({ operation, persistResult = async () => {} }) {
  const result = await operation();
  await persistResult(result);
  return result;
}

function restoredStage(progress) {
  if (!progress?.audit) return null;
  return {
    value: progress.audit,
    provider: progress.provider ?? null,
    raw: {
      requestId: progress.provider?.requestId ?? null,
      responseId: progress.provider?.responseId ?? progress.provider?.requestId ?? null
    }
  };
}

function stageProgress(provider, result) {
  return {
    audit: result.value,
    provider: {
      provider: provider.id,
      model: provider.model,
      requestId: result.raw.requestId ?? null,
      responseId: result.raw.responseId ?? result.raw.requestId ?? null
    },
    completedAt: new Date().toISOString()
  };
}

export async function reviewGuidePacketCandidate({
  packetBuffer,
  reviewer,
  escalationReviewer = null,
  escalationReviewerFactory = null,
  installedRevision = null,
  installedBundle = null,
  compilationReport = null,
  priorReviewProgress = null,
  stageExecutor = directStageExecutor,
  onStageResult = async () => {},
  onProgress
}) {
  assertExactGuidePacketModel(reviewer, "reviewer");
  if (escalationReviewer) assertExactGuidePacketModel(escalationReviewer, "adjudicator");
  const verified = verifyGuidePacket(packetBuffer, { installedRevision, installedBundle });
  if (!verified.ok) throw new Error(`Guide packet cannot enter model review: ${verified.errors.join("; ")}`);
  const input = auditInput(verified, compilationReport);
  let first = restoredStage(priorReviewProgress?.codex);
  if (!first) {
    onProgress?.({ stage: "guide-packet-independent-audit", status: "started", detail: `${reviewer.id}/${reviewer.model}` });
    first = await stageExecutor({
      stageId: "codex-independent-audit",
      provider: reviewer,
      expectedNextStage: "fable-adjudication-or-post-review-deterministic-gates",
      operation: async () => await callReviewer(reviewer, input),
      persistResult: async (result) => await onStageResult("codex-independent-audit", stageProgress(reviewer, result))
    });
    onProgress?.({ stage: "guide-packet-independent-audit", status: "completed", detail: first.value.verdict });
  }
  let escalation = restoredStage(priorReviewProgress?.fable);
  if (first.value.unresolved_material_disagreement && !escalationReviewer && escalationReviewerFactory) {
    escalationReviewer = await escalationReviewerFactory();
    assertExactGuidePacketModel(escalationReviewer, "adjudicator");
  }
  if (first.value.unresolved_material_disagreement && escalationReviewer && !escalation) {
    onProgress?.({ stage: "guide-packet-fable-adjudication", status: "started", detail: `${escalationReviewer.id}/${escalationReviewer.model}` });
    escalation = await stageExecutor({
      stageId: "fable-adjudication",
      provider: escalationReviewer,
      expectedNextStage: "post-review-deterministic-gates",
      operation: async () => await callReviewer(escalationReviewer, input, { escalation: true, priorAudit: first.value }),
      persistResult: async (result) => await onStageResult("fable-adjudication", stageProgress(escalationReviewer, result))
    });
    onProgress?.({ stage: "guide-packet-fable-adjudication", status: "completed", detail: escalation.value.verdict });
  }
  const finalAudit = escalation?.value ?? first.value;
  const status = finalAudit.verdict === "reject"
    ? "rejected"
    : first.value.unresolved_material_disagreement && !escalation
      ? "review-pending"
      : "reviewed";
  return {
    contractVersion: "guide-packet-independent-review-v1",
    status,
    reviewedAt: new Date().toISOString(),
    reviewer: { provider: reviewer.id, model: reviewer.model, requestId: first.raw.requestId ?? null },
    independentAudit: first.value,
    escalation: escalation ? {
      provider: escalationReviewer?.id ?? escalation.provider?.provider ?? "anthropic",
      model: escalationReviewer?.model ?? escalation.provider?.model ?? "claude-fable-5",
      requestId: escalation.raw.requestId ?? null,
      audit: escalation.value
    } : null,
    finalAudit
  };
}
