import fs from "node:fs/promises";
import path from "node:path";
import { parseModelJson } from "../core/json.mjs";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["no-action", "investigate", "repair-candidate"] },
    likely_layer: { type: "string", enum: ["extractor", "case-audit", "planner", "tier-router", "renderer", "response-contract", "guide-graph", "hypnosis-compiler", "performance", "unknown"] },
    findings: { type: "array", items: { type: "string" } },
    proposed_regression: { type: "string" },
    suggested_change: { type: "string" },
    human_decision_required: { type: "boolean" },
    human_decision_reason: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["verdict", "likely_layer", "findings", "proposed_regression", "suggested_change", "human_decision_required", "human_decision_reason", "confidence"]
};

export async function runDevelopmentAudit({ config, provider, developmentCase }) {
  if (!developmentCase?.feedback) throw new Error("Development audit requires a feedback case.");
  const system = `You are the read-only Inner Signal development auditor. Diagnose why a specific user-rated response was good, wrong, or too slow using the complete locally stored decision ledger. Do not rewrite the therapy answer and do not propose weakening any safety, epistemic, consent, or guide-graph contract. Identify the narrowest likely layer that caused the observed issue. Prefer a regression test that reproduces the behavior before suggesting a code change. If the requested change would alter substantive therapy policy rather than repair fidelity to already-approved policy, set human_decision_required=true.`;
  const user = `DEVELOPMENT CASE:\n${JSON.stringify(developmentCase, null, 2)}`;
  const raw = await provider.generate({
    system,
    user,
    outputSchema,
    metadata: { stage: "development_audit" }
  });
  const value = parseModelJson(raw.text, "development audit");
  const result = {
    format: "inner-signal-development-audit-v1",
    auditedAt: new Date().toISOString(),
    provider: provider.id,
    model: provider.model,
    requestId: raw.requestId,
    ...value
  };
  const dir = path.join(config.autopilotStateDir, "development-audits");
  await fs.mkdir(dir, { recursive: true });
  const ledgerId = developmentCase.feedback.ledgerId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(dir, `${result.auditedAt.replace(/[:.]/g, "-")}-${ledgerId}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { result, filePath };
}
