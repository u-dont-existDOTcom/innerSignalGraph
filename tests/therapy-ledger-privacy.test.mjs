import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeLedger } from "../src/orchestrator/ledger.mjs";

test("redacted therapy ledger excludes response prose, case reasoning, and finding prose", async (t) => {
  const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-redacted-ledger-"));
  t.after(() => fs.rm(ledgerDir, { recursive: true, force: true }));
  const privateMarkers = [
    "SYNTHETIC_PRIVATE_USER_MESSAGE",
    "SYNTHETIC_PRIVATE_RECENT_TRANSCRIPT",
    "SYNTHETIC_PRIVATE_GUIDE_EXCERPT",
    "SYNTHETIC_PRIVATE_FINAL_RESPONSE",
    "SYNTHETIC_PRIVATE_ACCEPTED_INSIGHT",
    "SYNTHETIC_PRIVATE_REJECTED_CLAIM",
    "SYNTHETIC_PRIVATE_SAFETY_FLAG",
    "SYNTHETIC_PRIVATE_REASONING_EVIDENCE"
  ];
  const ledger = await writeLedger({ ledgerMode: "redacted", ledgerDir }, {
    caseId: "synthetic-case",
    startedAt: "2026-09-11T00:00:00.000Z",
    completedAt: "2026-09-11T00:00:01.000Z",
    context: {
      guideManifest: { version: "synthetic" },
      userMessage: privateMarkers[0],
      recentTranscript: privateMarkers[1],
      guideExcerpts: privateMarkers[2],
      userFacts: [{ statement: "synthetic" }]
    },
    evidence: {
      providerMetadata: { renderer: { provider: "synthetic", requestId: "request:synthetic" } },
      realization: { hidden: privateMarkers[7] }
    },
    result: {
      answer: privateMarkers[3],
      accepted_insights: [privateMarkers[4]],
      rejected_claims: [privateMarkers[5]],
      safety_flags: [privateMarkers[6]],
      caseFormulation: { hidden: privateMarkers[7] },
      mode: "synthetic",
      processingTier: "fast"
    }
  });
  const text = await fs.readFile(ledger.path, "utf8");
  for (const marker of privateMarkers) assert.doesNotMatch(text, new RegExp(marker, "u"));
  const value = JSON.parse(text);
  assert.equal(value.result.answerPresent, true);
  assert.equal(Object.hasOwn(value.result, "answer"), false);
  assert.equal(value.evidence.acceptedInsightCount, 1);
  assert.equal(Object.hasOwn(value.evidence, "realization"), false);
});
