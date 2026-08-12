import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readZipEntries } from "../src/core/zip.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { buildHypnosisContext } from "../src/orchestrator/context-builder.mjs";
import { runHypnosisCompilerPipeline } from "../src/orchestrator/run-hypnosis-compiler.mjs";
import { stageGuidePacket, readGuidePacketStatus, recordGuidePacketDecision, installApprovedGuidePacket } from "../src/guide-packet/store.mjs";

const packetPath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");

test("candidate packet A001 routing preserves speaker uncertainty and developmental-age discrimination", async () => {
  const entries = readZipEntries(await fs.readFile(packetPath));
  const bundle = JSON.parse(entries.get("graphs/bundle.json").toString("utf8"));
  const definition = JSON.parse(await fs.readFile("corpus/graph-cases/G001.json", "utf8"));
  const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: bundle.graphs });
  assert.equal(plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.ok(plan.selectedNodes.some((node) => node.id === "IC.BORROW_ONE_FUNCTION"));
  assert.ok(plan.selectedNodes.some((node) => node.id === "IC.AGE_RESPONSIBILITY_CLARIFICATION"));
  assert.match(plan.requiredNuance.join("\n"), /Chronological adulthood does not establish.*same speaker/i);
  assert.match(plan.forbiddenOverclaims.join("\n"), /Do not merge the resentful voice/i);
  assert.match(plan.nextQuestion, /Which age or version of you/);
  assert.match(plan.nextQuestion, /knowledge, support, safety, money, and freedom/);
});

test("approved packet activation does not weaken H001 app-owned gate, route isolation, or waking return", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-h001-"));
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets")
  });
  const packet = await fs.readFile(packetPath);
  const staged = await stageGuidePacket(config, packet);
  let status = await readGuidePacketStatus(config);
  for (const card of status.candidate.decisionCards) {
    await recordGuidePacketDecision(config, { candidateId: staged.packetId, cardId: card.id, decision: "approve" });
  }
  await installApprovedGuidePacket(config, staged.packetId);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, "fixtures/mock-responses/H001.json") });
  const context = await buildHypnosisContext({
    userMessage: "Create a bounded awake session that builds one borrowed adult function without claiming change already happened.",
    recentTranscript: "",
    userFacts: [],
    hypnosisRequest: {
      target: "Build one credible adult function through observable action without pretending trust or transformation already exists.",
      relationship: "communion",
      depth: "classic",
      sessionType: "awake",
      durationMinutes: 10,
      protectorGateRequired: true,
      fullyAwakeAfterward: true
    }
  }, config);
  const result = await runHypnosisCompilerPipeline({ context, providers, config });
  assert.equal(result.releaseable, true);
  assert.deepEqual(result.playbackPlan.gate.routeIds, ["continue_inward", "stay_external", "end_session"]);
  assert.match(result.playbackPlan.appOwned.wakingReturn, /fully awake|awake and clear|fully alert/i);
  assert.equal(result.graphBundleVersion, "inner-child-somatic-packet-2026.08.11-r01-candidate");
});
