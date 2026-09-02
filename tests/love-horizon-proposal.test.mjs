import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proposalRoot = path.join(root, "authoring", "obsidian", "proposals", "love-horizon-r1");

function nodeById(bundle, id) {
  return bundle.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === id);
}

function hasNoneGate(node, field, value) {
  return (node.activation.none ?? []).some((condition) => condition.field === field && condition.op === "eq" && condition.value === value);
}

test("reconciled love-horizon authority preserves all proposal regressions and immediate-instability gates", async () => {
  const proposal = await fs.readFile(path.join(proposalRoot, "proposal.md"), "utf8");
  assert.match(proposal, /^status: reconciled$/m);

  const bundle = await compileGuideGraphs({ root, write: false });
  const caseFiles = Array.from({ length: 12 }, (_, index) => `G${String(index + 13).padStart(3, "0")}.json`);
  const cases = await Promise.all(caseFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(proposalRoot, "tests", file), "utf8"))));
  const regressions = await runGraphRegressionSuite({ root, bundle, cases });
  assert.equal(regressions.ok, true, JSON.stringify(regressions.results.filter((item) => !item.ok), null, 2));
  assert.equal(regressions.count, 12);

  for (const id of ["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.SUICIDAL_ADULT_SEAT"]) {
    const node = nodeById(bundle, id);
    assert.ok(node, id);
    assert.ok(hasNoneGate(node, "present_safety", "unsafe"), `${id} must wait for present safety`);
    assert.ok(hasNoneGate(node, "orientation", "disoriented"), `${id} must wait for orientation`);
    assert.ok(hasNoneGate(node, "ability_to_stop", "no"), `${id} must wait until the person can stop`);
    assert.ok(hasNoneGate(node, "ability_to_return", "no"), `${id} must wait until the person can return`);
    assert.ok(hasNoneGate(node, "altered_state", "altered"), `${id} must not run during a current altered state`);
  }

  const suicidalAdultSeat = nodeById(bundle, "IC.SUICIDAL_ADULT_SEAT");
  assert.equal(suicidalAdultSeat.tier, 1);
  assert.equal(suicidalAdultSeat.priority, 100);
  assert.ok(suicidalAdultSeat.effects.deferNodes.includes("IC.SUICIDAL_SELF_DEATH_INQUIRY"));
  assert.ok(suicidalAdultSeat.effects.forbiddenOverclaims.some((item) => /every suicidal state/i.test(item)));

  const suicidalSelfDeath = nodeById(bundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");
  assert.equal(suicidalSelfDeath.tier, 1);
  assert.equal(suicidalSelfDeath.priority, 99);
  assert.ok(suicidalSelfDeath.activation.all.some((condition) => condition.field === "suicidal_state"));
  assert.ok(!suicidalSelfDeath.activation.all.some((condition) => condition.field === "spiritual_curiosity"));
  assert.ok(suicidalSelfDeath.effects.deferNodes.includes("IC.LOVE_HORIZON_EXPLORATION"));
  assert.ok(suicidalSelfDeath.effects.forbiddenOverclaims.some((item) => /postmortem outcome/i.test(item)));

  const deepLove = nodeById(bundle, "IC.DEEP_LOVE_TO_CHILD");
  assert.equal(deepLove.priority, 95);
  assert.ok(deepLove.effects.forbiddenOverclaims.some((item) => /stronger altered state/i.test(item)));
});
