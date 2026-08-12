import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "../core/hash.mjs";

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
        repairedAudit: payload.evidence.repairedAudit,
        adversarialVerdict: payload.evidence.adversarialReview?.verdict,
        finalVerdict: payload.evidence.finalReview?.verdict
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
        finalReview: payload.result.finalReview
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
