import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeProposal } from "../src/authoring/proposal-builder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function nodeById(bundle, id) {
  return bundle.graphs.flatMap((graph) => graph.nodes).find((node) => node.id === id);
}

function hasNoneGate(node, field, value) {
  return (node.activation.none ?? []).some((condition) => condition.field === field && condition.op === "eq" && condition.value === value);
}

test("love-horizon proposal is coverage-complete and gates existential/spiritual routing during immediate instability", async () => {
  const built = await materializeProposal({ root, id: "love-horizon-r1", enforceCoverage: true });
  assert.equal(built.regressionImpact.ok, true);
  assert.deepEqual(built.receipt.regressionStatus, { ok: true, count: 24, passed: 24 });
  assert.equal(built.packetVerification.ok, true);

  for (const id of ["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.SUICIDAL_ADULT_SEAT"]) {
    const node = nodeById(built.candidateBundle, id);
    assert.ok(node, id);
    assert.ok(hasNoneGate(node, "present_safety", "unsafe"), `${id} must wait for present safety`);
    assert.ok(hasNoneGate(node, "orientation", "disoriented"), `${id} must wait for orientation`);
    assert.ok(hasNoneGate(node, "ability_to_stop", "no"), `${id} must wait until the person can stop`);
    assert.ok(hasNoneGate(node, "ability_to_return", "no"), `${id} must wait until the person can return`);
    assert.ok(hasNoneGate(node, "altered_state", "altered"), `${id} must not run during a current altered state`);
  }

  const suicidalAdultSeat = nodeById(built.candidateBundle, "IC.SUICIDAL_ADULT_SEAT");
  assert.ok(suicidalAdultSeat);
  assert.equal(suicidalAdultSeat.tier, 1);
  assert.equal(suicidalAdultSeat.priority, 100);
  assert.ok(suicidalAdultSeat.effects.deferNodes.includes("IC.SUICIDAL_SELF_DEATH_INQUIRY"));
  assert.ok(suicidalAdultSeat.effects.forbiddenOverclaims.some((item) => /every suicidal state/i.test(item)));

  const suicidalSelfDeath = nodeById(built.candidateBundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");
  assert.ok(suicidalSelfDeath);
  assert.equal(suicidalSelfDeath.tier, 1);
  assert.equal(suicidalSelfDeath.priority, 99);
  assert.ok(suicidalSelfDeath.activation.all.some((condition) => condition.field === "suicidal_state"));
  assert.ok(!suicidalSelfDeath.activation.all.some((condition) => condition.field === "spiritual_curiosity"));
  assert.ok(suicidalSelfDeath.effects.deferNodes.includes("IC.LOVE_HORIZON_EXPLORATION"));
  assert.ok(suicidalSelfDeath.effects.forbiddenOverclaims.some((item) => /postmortem outcome/i.test(item)));

  const deepLove = nodeById(built.candidateBundle, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(deepLove);
  assert.equal(deepLove.priority, 95);
  assert.ok(deepLove.effects.forbiddenOverclaims.some((item) => /stronger altered state/i.test(item)));
});
