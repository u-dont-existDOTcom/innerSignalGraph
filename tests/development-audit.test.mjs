import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDevelopmentAudit } from "../src/dev/audit.mjs";

test("needs-work feedback can trigger a structured read-only development diagnosis", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-dev-audit-"));
  const provider = {
    id: "openai",
    model: "fake-codex",
    async generate({ outputSchema, metadata }) {
      assert.equal(metadata.stage, "development_audit");
      assert.equal(outputSchema.type, "object");
      return {
        requestId: "req-1",
        text: JSON.stringify({
          verdict: "repair-candidate",
          likely_layer: "renderer",
          findings: ["The renderer converted a part's assessment into objective fact."],
          proposed_regression: "Keep the assessment attributed to the internal position.",
          suggested_change: "Strengthen epistemic attribution in the realization contract.",
          human_decision_required: false,
          human_decision_reason: "This restores already-approved epistemic policy.",
          confidence: "high"
        })
      };
    }
  };
  const developmentCase = {
    feedback: { ledgerId: "abc-123", rating: "needs-work", note: "too certain" },
    ledgerFound: true,
    ledger: { evidence: { realization: { answer: "It is objective fact." } } }
  };
  const { result, filePath } = await runDevelopmentAudit({ config: { autopilotStateDir: root }, provider, developmentCase });
  assert.equal(result.likely_layer, "renderer");
  assert.equal(result.human_decision_required, false);
  assert.ok((await fs.stat(filePath)).isFile());
});
