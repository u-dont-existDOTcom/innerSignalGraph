import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { buildHypnosisContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runHypnosisCompilerPipeline } from "../src/orchestrator/run-hypnosis-compiler.mjs";
import { auditHypnosisDraft } from "../src/hypnosis/deterministic-audit.mjs";
import { buildHypnosisPlaybackPlan, renderHypnosisRoute } from "../src/hypnosis/compiler.mjs";

async function h001() {
  const casePath = path.join(projectRoot, "corpus/difficult-cases/H001-borrowed-adulthood-hypnosis/case.json");
  const definition = JSON.parse(await fs.readFile(casePath, "utf8"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const context = await buildHypnosisContext(definition.input, config);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, definition.mockFixture) });
  return { definition, config, context, providers };
}

test("H001 compiler repairs pre-gate deepening and releases an app-owned plan", async () => {
  const { definition, config, context, providers } = await h001();
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.mode, "hypnosis-compiler");
  assert.equal(result.status, "releaseable");
  assert.equal(result.releaseable, true);
  assert.equal(result.deterministicAudit.ok, true);
  assert.equal(result.finalReview.verdict, "pass");
  assert.ok(result.playbackPlan);
  assert.match(result.playbackPlan.gate.intro, /Playback pauses here/);
  assert.doesNotMatch(result.playbackPlan.preGateTranscript, /close your eyes|deeper|count down/i);
  assert.doesNotMatch(result.playbackPlan.preGateTranscript, /Continue inward|Remain at this distance|Finish here/i);
});

test("app-owned route selection exposes only the selected route and one waking ending", async () => {
  const { definition, config, context, providers } = await h001();
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  const plan = result.playbackPlan;
  const inward = renderHypnosisRoute(plan, "continue_inward");
  const external = renderHypnosisRoute(plan, "stay_external");
  const end = renderHypnosisRoute(plan, "end_session");

  assert.match(inward, /You selected Continue inward/);
  assert.match(inward, /borrowed function/i);
  assert.doesNotMatch(inward, /You selected Remain at this distance/);
  assert.doesNotMatch(external, /three ordinary breaths|borrowed function receives/i);
  assert.match(external, /eyes open/i);
  assert.doesNotMatch(end, /induction|deepening|younger|borrowed function/i);

  for (const text of [inward, external, end]) {
    assert.equal((text.match(/This session is complete\./g) || []).length, 1);
    assert.ok(text.trim().endsWith("This session is complete."));
  }
});

test("deterministic audit rejects model attempts to own gate, ending, or external deepening", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(projectRoot, "fixtures/mock-responses/H001.json"), "utf8"));
  const base = fixture.anthropic.hypnosis_repair;
  const bad = structuredClone(base);
  bad.orientation = "Protector choice point. Playback pauses here.";
  bad.stay_external.grounding = "Close your eyes and go deeper toward the inner child.";
  bad.continue_inward.return_lead = "You are fully awake, clear, and present. This session is complete.";
  const audit = auditHypnosisDraft(bad);
  assert.equal(audit.ok, false);
  const codes = audit.issues.map((issue) => issue.code);
  assert.ok(codes.includes("model_emitted_gate_copy"));
  assert.ok(codes.includes("stay_external_advances_inward"));
  assert.ok(codes.includes("model_emitted_waking_return"));
});

test("playback renderer rejects missing or unknown route authorization", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(projectRoot, "fixtures/mock-responses/H001.json"), "utf8"));
  const plan = buildHypnosisPlaybackPlan(fixture.anthropic.hypnosis_repair);
  assert.throws(() => renderHypnosisRoute(plan, ""), (error) => error.code === "BAD_HYPNOSIS_ROUTE");
  assert.throws(() => renderHypnosisRoute(plan, "continue_anyway"), (error) => error.code === "BAD_HYPNOSIS_ROUTE");
});
