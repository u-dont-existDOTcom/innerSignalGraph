import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "../core/hash.mjs";
import { HYPNOSIS_REVIEW_TARGET_IDS } from "../hypnosis/component-repair.mjs";

const HYPNOSIS_REVIEW_CATEGORIES = new Set([
  "structural",
  "semantic",
  "consent",
  "hypnosis_craft",
  "target_scope",
  "return"
]);
const HYPNOSIS_REVIEW_DISPOSITIONS = new Set(["repair", "block"]);
const HYPNOSIS_REVIEW_TARGETS = new Set(HYPNOSIS_REVIEW_TARGET_IDS);
const HYPNOSIS_REVIEW_VERDICTS = new Set(["accept", "revise", "reject"]);

function safeHypnosisFindings(review) {
  if (!Array.isArray(review?.findings)) return [];
  return review.findings.filter((finding) => finding && typeof finding === "object").map((finding) => ({
    category: HYPNOSIS_REVIEW_CATEGORIES.has(finding.category) ? finding.category : null,
    disposition: HYPNOSIS_REVIEW_DISPOSITIONS.has(finding.disposition) ? finding.disposition : null,
    target_ids: Array.isArray(finding.target_ids)
      ? finding.target_ids.filter((id) => HYPNOSIS_REVIEW_TARGETS.has(id))
      : []
  }));
}

function redactContext(context) {
  return {
    guideManifest: context.guideManifest,
    userMessageHash: sha256(context.userMessage),
    recentTranscriptHash: sha256(context.recentTranscript),
    guideExcerptsHash: sha256(context.guideExcerpts),
    userFactCount: context.userFacts.length
  };
}

export async function writeLedger(config, payload) {
  const id = randomUUID();
  if (config.ledgerMode === "off") return { id, path: null };

  await fs.mkdir(config.ledgerDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(config.ledgerDir, `${timestamp}-${id}.json`);
  let safePayload;
  if (config.ledgerMode === "full") {
    safePayload = payload;
  } else if (payload.kind === "hypnosis-compiler") {
    safePayload = {
      ...payload,
      context: redactContext(payload.context),
      evidence: {
        providerMetadata: payload.evidence.providerMetadata,
        initialAudit: payload.evidence.initialAudit,
        adversarialReview: payload.evidence.adversarialReview ? {
          verdict: HYPNOSIS_REVIEW_VERDICTS.has(payload.evidence.adversarialReview.verdict)
            ? payload.evidence.adversarialReview.verdict
            : null,
          findings: safeHypnosisFindings(payload.evidence.adversarialReview)
        } : null,
        repairScope: payload.evidence.repairScope,
        preservation: payload.evidence.preservation,
        repairedAudit: payload.evidence.repairedAudit,
        repairFailure: payload.evidence.repairFailure,
        finalVerdict: payload.evidence.finalReview?.verdict ?? null
      },
      result: {
        mode: payload.result.mode,
        status: payload.result.status,
        releaseable: payload.result.releaseable,
        contractVersion: payload.result.contractVersion,
        guideVersion: payload.result.guideVersion,
        targetHash: sha256(payload.result.target),
        relationship: payload.result.relationship,
        deterministicAudit: payload.result.deterministicAudit,
        repairScope: payload.result.repairScope,
        repairFailure: payload.result.repairFailure,
        finalVerdict: payload.result.finalReview?.verdict ?? null
      }
    };
  } else {
    safePayload = {
      ...payload,
      context: redactContext(payload.context),
      evidence: {
        providerMetadata: payload.evidence.providerMetadata,
        acceptedInsights: payload.result.accepted_insights,
        rejectedClaims: payload.result.rejected_claims,
        safetyFlags: payload.result.safety_flags
      }
    };
  }
  await fs.writeFile(filePath, `${JSON.stringify({ ledgerId: id, ...safePayload }, null, 2)}\n`, "utf8");
  return { id, path: filePath };
}
