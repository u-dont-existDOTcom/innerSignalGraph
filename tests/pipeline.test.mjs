import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runFormulatedPipeline } from "../src/orchestrator/run-formulated-pipeline.mjs";
import { evaluateStructuredBenchmark } from "../src/autopilot/benchmark-acceptance.mjs";

test("A001 formulated adversarial pipeline preserves plan and response obligations without overclaim", async () => {
  const casePath = path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json");
  const definition = JSON.parse(await fs.readFile(casePath, "utf8"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const context = await buildContext(definition.input, config);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, definition.mockFixture) });
  const result = await runFormulatedPipeline({ context, providers, config, caseId: definition.id });
  const acceptance = evaluateStructuredBenchmark(result, definition.acceptance);

  assert.equal(acceptance.ok, true, `benchmark failed: ${JSON.stringify(acceptance)}`);
  assert.deepEqual(acceptance.response.missingRequired, []);
  assert.deepEqual(acceptance.response.presentForbidden, []);
  assert.deepEqual(acceptance.plan.missing, []);
  assert.equal(result.interventionContract.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.ok(result.interventionContract.selectedNodes.some((item) => item.id === "IC.BORROW_ONE_FUNCTION"));
  assert.ok(result.interventionContract.requiredNuance.some((item) => /not only the younger state/i.test(item)));
  assert.equal(result.mode, "adversarial");
  assert.equal(result.degraded, false);
  assert.deepEqual(result.providersCompleted, ["openai", "anthropic"]);
  assert.equal(result.realizationContractVersion, "response-realization-v5");
  assert.match(result.answer, /big fuckity whoopty doo/i);
  assert.match(result.answer, /show up again/i);
  assert.match(result.next_question, /which age or version/i);
  assert.ok(result.adjudicationPacket);
});
