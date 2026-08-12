import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordDevelopmentFeedback } from "../src/dev/feedback-store.mjs";

test("human response feedback is persisted locally for later development automation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-feedback-"));
  const ledgerDir = path.join(root, "ledgers");
  await fs.mkdir(ledgerDir, { recursive: true });
  await fs.writeFile(path.join(ledgerDir, "decision.json"), JSON.stringify({ ledgerId: "abc-123", evidence: { route: "credibility" } }));
  const config = { autopilotStateDir: root, ledgerDir };
  const result = await recordDevelopmentFeedback(config, {
    ledgerId: "abc-123",
    rating: "needs-work",
    note: "It sided too strongly with the child.",
    processingTier: "reviewed",
    processingMs: 1234,
    graphBundleVersion: "graph-r5"
  });
  assert.equal(result.ok, true);
  const stored = JSON.parse(await fs.readFile(result.filePath, "utf8"));
  assert.equal(stored.feedback.ledgerId, "abc-123");
  assert.equal(stored.feedback.rating, "needs-work");
  assert.match(stored.feedback.note, /sided too strongly/i);
  assert.equal(stored.ledgerFound, true);
  assert.equal(stored.ledger.evidence.route, "credibility");
  assert.equal(stored.automationState, "pending-development-review");
});
