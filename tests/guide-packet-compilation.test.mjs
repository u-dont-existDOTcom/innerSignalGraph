import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { compileGuidePacketCandidate } from "../src/guide-packet/model-compiler.mjs";
import { ensureBundledGuidePacketCandidate } from "../src/guide-packet/autopilot.mjs";
import { readGuidePacketStatus } from "../src/guide-packet/store.mjs";

const packetPath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");

class JsonProvider {
  constructor(id, model, value) {
    this.id = id;
    this.model = model;
    this.value = value;
    this.calls = 0;
    this.requests = [];
    this.entitlementEvidence = { ok: true, requestedModel: model, responseId: `${id}-entitlement`, probedAt: new Date().toISOString() };
  }
  async generate(request) { this.calls += 1; this.requests.push(request); return { text: JSON.stringify(this.value), requestId: `${this.id}-${this.calls}` }; }
}

function compilationValue() {
  return {
    verdict: "compiled",
    summary: "Source roles and graph changes are explicit; substantive policy remains owner-gated.",
    unresolved_material_disagreement: false,
    source_roles: [
      { node_id: "IC.CREDIBILITY_REPAIR", role: "canonical-source-prose", source_refs: ["IC.LOVE_UNSAFE"], confidence: "high", notes: "Source explicitly distinguishes adverse credibility from no record." }
    ],
    graph_changes: [
      { node_id: "SOM.DELAYED_RESPONSE_REASSESSMENT", change_type: "add", source_refs: ["SOM.JUDGE_HELP"], behavioral_effect: "Adds delayed dose reassessment.", certainty: "author-framework" }
    ],
    findings: [],
    worst_plausible_failure: "A source nuance could be compiled too broadly."
  };
}

function reviewValue() {
  return {
    verdict: "pass",
    summary: "Compilation report and deterministic diff are source-supported.",
    unresolved_material_disagreement: false,
    findings: [],
    recommended_owner_decisions: [],
    worst_plausible_failure: "A route could activate too broadly."
  };
}

test("Opus compilation produces a structured source-role report without approving policy", async () => {
  const compiler = new JsonProvider("anthropic", "claude-opus-5", compilationValue());
  const result = await compileGuidePacketCandidate({ packetBuffer: await fs.readFile(packetPath), compiler });
  assert.equal(result.status, "compiled");
  assert.equal(result.compiler.model, "claude-opus-5");
  assert.equal(result.report.verdict, "compiled");
  assert.equal(result.report.source_roles[0].node_id, "IC.CREDIBILITY_REPAIR");
  assert.match(compiler.requests[0].system, /do not approve.*owner/i);
});

test("source-role compilation rejects any model other than exact Claude Opus 5 before calling it", async () => {
  const compiler = new JsonProvider("anthropic", "claude-sonnet-4-6", compilationValue());
  const packetBuffer = await fs.readFile(packetPath);
  await assert.rejects(
    () => compileGuidePacketCandidate({ packetBuffer, compiler }),
    /requires exact model claude-opus-5/i
  );
  assert.equal(compiler.calls, 0);
});

test("bundled packet autopilot runs Opus compilation before Codex audit and persists both", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-compile-autopilot-"));
  const config = loadConfig({ mode: "cli", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const compiler = new JsonProvider("anthropic", "claude-opus-5", compilationValue());
  const reviewer = new JsonProvider("openai", "gpt-5.6-sol", reviewValue());
  const result = await ensureBundledGuidePacketCandidate({ config, fixturePath: packetPath, compiler, reviewer });
  assert.equal(result.compiled, true);
  assert.equal(result.reviewed, true);
  assert.equal(compiler.calls, 1);
  assert.equal(reviewer.calls, 1);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.candidate.compilation.status, "compiled");
  assert.equal(status.candidate.independentReview.status, "reviewed");
  assert.match(reviewer.requests[0].user, /Source-role compilation report/i);
});
