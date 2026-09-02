import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proposalRoot = path.join(root, "authoring", "obsidian", "proposals", "intuition-calibration-r1");

function nodeById(bundle, id) {
  return bundle.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === id);
}

function hasNoneGate(node, field, value) {
  return (node.activation.none ?? []).some((condition) => condition.field === field && condition.op === "eq" && condition.value === value);
}

test("reconciled intuition-calibration authority preserves all proposal regressions and safety distinctions", async () => {
  const proposal = await fs.readFile(path.join(proposalRoot, "proposal.md"), "utf8");
  assert.match(proposal, /^status: reconciled$/m);

  const bundle = await compileGuideGraphs({ root, write: false });
  const caseFiles = Array.from({ length: 8 }, (_, index) => `G${String(index + 25).padStart(3, "0")}.json`);
  const cases = await Promise.all(caseFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(proposalRoot, "tests", file), "utf8"))));
  const regressions = await runGraphRegressionSuite({ root, bundle, cases });
  assert.equal(regressions.ok, true, JSON.stringify(regressions.results.filter((item) => !item.ok), null, 2));
  assert.equal(regressions.count, 8);

  const selfDeath = nodeById(bundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");
  const precious = nodeById(bundle, "IC.PRECIOUS_HUMAN_OPPORTUNITY");
  for (const node of [selfDeath, precious]) {
    assert.ok(node);
    assert.ok(hasNoneGate(node, "present_safety", "unsafe"));
    assert.ok(hasNoneGate(node, "orientation", "disoriented"));
    assert.ok(hasNoneGate(node, "ability_to_stop", "no"));
    assert.ok(hasNoneGate(node, "ability_to_return", "no"));
    assert.ok(hasNoneGate(node, "altered_state", "altered"));
  }
  assert.equal(selfDeath.tier, 1);
  assert.equal(selfDeath.priority, 99);
  assert.equal(precious.tier, 1);
  assert.equal(precious.priority, 98);
  assert.ok(selfDeath.recommendations.some((item) => /precious-human-opportunity/i.test(item)));
  assert.ok(precious.effects.requiredNuance.some((item) => /regardless of prior spiritual curiosity/i.test(item)));
  assert.ok(precious.effects.requiredNuance.some((item) => /hellish states/i.test(item)));

  const calibration = nodeById(bundle, "IC.INTUITION_TRUST_CALIBRATION");
  assert.ok(calibration);
  assert.equal(calibration.tier, 2);
  assert.equal(calibration.priority, 100);
  assert.ok(calibration.effects.requiredNuance.some((item) => /Neither receives unilateral control/i.test(item)));
  assert.ok(calibration.effects.requiredNuance.some((item) => /Separate the raw signal/i.test(item)));
  assert.ok(calibration.effects.forbiddenOverclaims.some((item) => /strong intuitive click proves/i.test(item)));
  assert.ok(calibration.avoid.some((item) => /simplistic left-brain\/right-brain anatomy claim/i.test(item)));

  const semanticAssets = bundle.sourceMaps.find((item) => item.guideId === "semantic-assets");
  assert.ok(semanticAssets);
  assert.ok(semanticAssets.sections.some((item) => item.id === "ASSET.IC.SUICIDE.COSMIC_JACKPOT"));
});
