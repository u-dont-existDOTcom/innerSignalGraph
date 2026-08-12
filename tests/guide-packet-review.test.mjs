import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { stageGuidePacket, readGuidePacketStatus, applyGuidePacketReview, recordGuidePacketDecision } from "../src/guide-packet/store.mjs";
import { reviewGuidePacketCandidate } from "../src/guide-packet/model-review.mjs";

const packetPath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");

class JsonProvider {
  constructor(id, model, value) { this.id = id; this.model = model; this.value = value; this.calls = 0; }
  async generate() { this.calls += 1; return { text: JSON.stringify(this.value), requestId: `${this.id}-${this.calls}`, responseId: `${this.id}-${this.calls}` }; }
}

async function staged() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-review-"));
  const config = loadConfig({ mode: "mock", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const packet = await fs.readFile(packetPath);
  const candidate = await stageGuidePacket(config, packet);
  return { config, packet, candidate };
}

test("Codex independent audit is recorded before substantive decisions can install", async () => {
  const { config, packet, candidate } = await staged();
  const codex = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "pass",
    summary: "The candidate diff is source-supported and correctly requires owner approval.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: candidate.decisionCards.map((card) => ({ card_id: card.id, recommendation: "approve", reason: "Source-backed candidate rule." })),
    worst_plausible_failure: "A new route may activate too broadly."
  });
  const review = await reviewGuidePacketCandidate({ packetBuffer: packet, reviewer: codex });
  assert.equal(review.status, "reviewed");
  assert.equal(review.independentAudit.verdict, "pass");
  await applyGuidePacketReview(config, candidate.packetId, review);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.candidate.independentReview.status, "reviewed");
  assert.equal(status.candidate.status, "awaiting-owner");
});

test("independent audit rejects a non-SOL Codex model before calling it", async () => {
  const { packet } = await staged();
  const codex = new JsonProvider("openai", "gpt-5.6", {
    verdict: "pass",
    summary: "wrong model",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "wrong model"
  });
  await assert.rejects(
    () => reviewGuidePacketCandidate({ packetBuffer: packet, reviewer: codex }),
    /requires exact model gpt-5.6-sol/i
  );
  assert.equal(codex.calls, 0);
});

test("material-disagreement adjudication rejects a non-Fable escalation model", async () => {
  const { packet } = await staged();
  const codex = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "review",
    summary: "Material disagreement remains.",
    unresolved_material_disagreement: true,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "Unsupported inference."
  });
  const escalation = new JsonProvider("anthropic", "claude-opus-5", {
    verdict: "pass",
    summary: "wrong model",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "wrong model"
  });
  await assert.rejects(
    () => reviewGuidePacketCandidate({ packetBuffer: packet, reviewer: codex, escalationReviewer: escalation }),
    /requires exact model claude-fable-5/i
  );
  assert.equal(codex.calls, 0);
  assert.equal(escalation.calls, 0);
});

test("unresolved material disagreement escalates to Fable and a rejected audit blocks owner approval", async () => {
  const { config, packet, candidate } = await staged();
  const codex = new JsonProvider("openai", "gpt-5.6-sol", {
    verdict: "review",
    summary: "One source-role conflict remains.",
    unresolved_material_disagreement: true,
    findings: [{ code: "SOURCE_ROLE_CONFLICT", severity: "review", reason: "Unclear source authority.", required_action: "Adjudicate source role." }],
    recommended_owner_decisions: [],
    worst_plausible_failure: "Model inference could become owner policy."
  });
  const fable = new JsonProvider("anthropic", "claude-fable-5", {
    verdict: "reject",
    summary: "The conflict is substantive and unresolved.",
    unresolved_material_disagreement: false,
    findings: [{ code: "OWNER_POLICY_UNRESOLVED", severity: "block", reason: "Owner amendment is missing.", required_action: "Create an owner decision." }],
    recommended_owner_decisions: [],
    worst_plausible_failure: "Unsupported policy could be installed."
  });
  const review = await reviewGuidePacketCandidate({ packetBuffer: packet, reviewer: codex, escalationReviewer: fable });
  assert.equal(review.status, "rejected");
  assert.equal(fable.calls, 1);
  await applyGuidePacketReview(config, candidate.packetId, review);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.candidate.status, "review-rejected");
  await assert.rejects(() => recordGuidePacketDecision(config, { candidateId: candidate.packetId, cardId: candidate.decisionCards[0].id, decision: "approve" }), /independent review/i);
});
