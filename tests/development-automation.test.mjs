import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCandidateWorkspace, candidateChanges, copyManagedTree, classifyChangeRisk } from "../src/dev/workspace.mjs";
import { listPendingDevelopmentCases, writeJobState, writeHumanDecision, readHumanDecision } from "../src/dev/queue.mjs";

async function tempRoot(prefix) { return await fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test("candidate workspaces isolate source code from local configuration and runtime state", async () => {
  const root = await tempRoot("inner-signal-candidate-");
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.mkdir(path.join(source, ".inner-signal-autopilot"), { recursive: true });
  await fs.writeFile(path.join(source, "src", "a.mjs"), "export const a = 1;\n");
  await fs.writeFile(path.join(source, ".env"), "SECRET=nope\n");
  await fs.writeFile(path.join(source, ".inner-signal-autopilot", "private.json"), "{}\n");
  const workspace = await createCandidateWorkspace({ sourceRoot: source, candidateRoot: candidate, jobId: "j1" });
  assert.ok(workspace.baseline["src/a.mjs"]);
  await assert.rejects(fs.access(path.join(candidate, ".env")));
  await assert.rejects(fs.access(path.join(candidate, ".inner-signal-autopilot", "private.json")));
  await fs.writeFile(path.join(candidate, "src", "a.mjs"), "export const a = 2;\n");
  const change = await candidateChanges(candidate, workspace.baseline);
  assert.deepEqual(change.changes.map((item) => [item.file, item.status]), [["src/a.mjs", "modified"]]);
});

test("high-risk guide and hypnosis-contract paths always require substantive review", () => {
  const risk = classifyChangeRisk([
    { file: "src/prompts/realize.mjs", status: "modified" },
    { file: "guides/inner-child-guide.txt", status: "modified" },
    { file: "src/hypnosis/app-owned-copy.mjs", status: "modified" }
  ]);
  assert.equal(risk.level, "substantive-review-required");
  assert.deepEqual(risk.highRiskFiles.sort(), ["guides/inner-child-guide.txt", "src/hypnosis/app-owned-copy.mjs"]);
});

test("promotion sync replaces managed code while preserving .env and autopilot state", async () => {
  const root = await tempRoot("inner-signal-promote-");
  const target = path.join(root, "target");
  const candidate = path.join(root, "candidate");
  await fs.mkdir(path.join(target, "src"), { recursive: true });
  await fs.mkdir(path.join(target, ".inner-signal-autopilot"), { recursive: true });
  await fs.mkdir(path.join(candidate, "src"), { recursive: true });
  await fs.writeFile(path.join(target, "src", "old.mjs"), "old\n");
  await fs.writeFile(path.join(target, "src", "keep.mjs"), "before\n");
  await fs.writeFile(path.join(target, ".env"), "LOCAL=1\n");
  await fs.writeFile(path.join(target, ".inner-signal-autopilot", "state.json"), "{\"ok\":true}\n");
  await fs.writeFile(path.join(candidate, "src", "keep.mjs"), "after\n");
  await fs.writeFile(path.join(candidate, "src", "new.mjs"), "new\n");
  await copyManagedTree(candidate, target);
  assert.equal(await fs.readFile(path.join(target, "src", "keep.mjs"), "utf8"), "after\n");
  assert.equal(await fs.readFile(path.join(target, "src", "new.mjs"), "utf8"), "new\n");
  await assert.rejects(fs.access(path.join(target, "src", "old.mjs")));
  assert.equal(await fs.readFile(path.join(target, ".env"), "utf8"), "LOCAL=1\n");
  assert.match(await fs.readFile(path.join(target, ".inner-signal-autopilot", "state.json"), "utf8"), /true/);
});

test("development queue consumes only needs-work and too-slow cases and preserves human decisions", async () => {
  const root = await tempRoot("inner-signal-queue-");
  const config = { autopilotStateDir: root, devJobRoot: path.join(root, "development-jobs") };
  const feedbackDir = path.join(root, "development-feedback");
  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.writeFile(path.join(feedbackDir, "a.json"), JSON.stringify({ feedback: { ledgerId: "a", rating: "good" } }));
  await fs.writeFile(path.join(feedbackDir, "b.json"), JSON.stringify({ feedback: { ledgerId: "b", rating: "needs-work" } }));
  await fs.writeFile(path.join(feedbackDir, "c.json"), JSON.stringify({ feedback: { ledgerId: "c", rating: "too-slow" } }));
  const pending = await listPendingDevelopmentCases(config);
  assert.equal(pending.length, 2);
  const first = pending[0];
  await writeJobState(config, first.jobId, { status: "awaiting-human" });
  const after = await listPendingDevelopmentCases(config);
  assert.equal(after.length, 1);
  await writeHumanDecision(config, first.jobId, "approve");
  assert.equal((await readHumanDecision(config, first.jobId)).decision, "approve");
});

import { runClaudeCodingAgent } from "../src/dev/coding-agent.mjs";
import { runCandidateCodeReview, runReplayComparisonReview } from "../src/dev/review.mjs";
import { fileURLToPath } from "node:url";

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function executableWrapper(root, name, targetFile) {
  const bin = path.join(root, name);
  await fs.writeFile(bin, `#!/usr/bin/env bash\nexec node "${targetFile}" "$@"\n`);
  await fs.chmod(bin, 0o755);
  return bin;
}

test("Opus coding-agent runner is tool-enabled and edits only the isolated candidate", async () => {
  const root = await tempRoot("inner-signal-code-agent-");
  const candidate = path.join(root, "candidate");
  await fs.mkdir(candidate, { recursive: true });
  const command = await executableWrapper(root, "claude", path.join(testRoot, "tests/fixtures/fake-claude-coding-cli.mjs"));
  const result = await runClaudeCodingAgent({
    command,
    model: "claude-opus-5",
    candidateRoot: candidate,
    developmentCase: { feedback: { ledgerId: "l1", rating: "needs-work", note: "fidelity" } },
    audit: { verdict: "repair-candidate", human_decision_required: false },
    cycle: 1,
    timeoutMs: 30000
  });
  assert.equal(result.status, "implemented");
  assert.equal(result.policy_change_claim, "none");
  assert.equal(await fs.readFile(path.join(candidate, "src/autonomous-repair-marker.txt"), "utf8"), "repaired\n");
});

test("Codex development review distinguishes restorative patch approval from exact-case comparison", async () => {
  const root = await tempRoot("inner-signal-dev-review-");
  const candidate = path.join(root, "candidate");
  await fs.mkdir(candidate, { recursive: true });
  const command = await executableWrapper(root, "codex", path.join(testRoot, "tests/fixtures/fake-codex-development-review.mjs"));
  const config = { codexCommand: command, devReviewModel: "gpt-5.6-sol", requestTimeoutMs: 30000 };
  const developmentCase = { feedback: { rating: "needs-work", note: "too certain" }, ledger: { result: { answer: "old" } } };
  const audit = { verdict: "repair-candidate" };
  const review = await runCandidateCodeReview({ config, candidateRoot: candidate, developmentCase, audit, gates: { ok: true }, changes: { changes: [] } });
  assert.equal(review.verdict, "approve");
  assert.equal(review.policy_change, "restorative");
  const comparison = await runReplayComparisonReview({ config, candidateRoot: candidate, developmentCase, audit, candidateResult: { answer: "new" } });
  assert.equal(comparison.verdict, "improved");
  assert.equal(comparison.addresses_feedback, true);
});

import { recordAutomaticDevelopmentIncident } from "../src/dev/incidents.mjs";

test("deterministic runtime failures can enqueue development cases without human log transport", async () => {
  const root = await tempRoot("inner-signal-auto-incident-");
  const ledgerDir = path.join(root, "ledgers");
  await fs.mkdir(ledgerDir, { recursive: true });
  await fs.writeFile(path.join(ledgerDir, "l.json"), JSON.stringify({ ledgerId: "ledger-auto", context: { userMessage: "x" }, result: { answer: "y" } }));
  const config = { autopilotStateDir: root, ledgerDir };
  const queued = await recordAutomaticDevelopmentIncident(config, {
    origin: "response-contract",
    ledgerId: "ledger-auto",
    note: "Renderer omitted a selected intervention.",
    incident: { missingNodeIds: ["IC.BORROW_ONE_FUNCTION"] }
  });
  assert.equal(queued.record.origin, "response-contract");
  assert.equal(queued.record.ledgerFound, true);
  assert.equal(queued.record.automationState, "pending-development-review");
  assert.ok((await fs.stat(queued.filePath)).isFile());
});
