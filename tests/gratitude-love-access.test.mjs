import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";

test("gratitude is an ongoing essential practice inside the chosen path, not forced emotion", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const byId = new Map(bundle.graphs.flatMap(graph => graph.nodes).map(node => [node.id, node]));
  const horizon = byId.get("IC.LOVE_HORIZON_EXPLORATION");
  assert.ok(horizon.sourceRefs.includes("AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014"));
  assert.ok(horizon.recommendations.some(s => /gratitude for one concretely true present good/i.test(s)));
  assert.ok(horizon.recommendations.some(s => /gratitude even for suffering itself/i.test(s) && /compassion, wisdom/i.test(s)));
  assert.ok(horizon.recommendations.some(s => /actually opens in the heart/i.test(s)));
  assert.ok(horizon.avoid.some(s => /not demand gratitude as an emotion/i.test(s)));
  assert.ok(horizon.avoid.some(s => /essential in this path without the person being compelled/i.test(s)));
  assert.ok(horizon.effects.requiredNuance.some(s => /distinct observations/i.test(s)));
  const values = { present_safety:"safe", orientation:"oriented", ability_to_stop:"yes", ability_to_return:"yes", altered_state:"sober", suicidal_state:"absent", spiritual_curiosity:"present", deep_love_access:"none_known", activation:"moderate", dissociation:"none" };
  assert.ok(horizon.recommendations.some(s => /essential ongoing cultivation/i.test(s)));
  assert.equal(horizon.activation.all.length, 1, "current love access must not stop ongoing cultivation");
  const curious = planFromGraphs({ graphs: bundle.graphs, variables: values });
  assert.ok(curious.selectedNodes.some(n => n.id === "IC.LOVE_HORIZON_EXPLORATION"));
  assert.equal(curious.primaryJob.id, "IC.LOVE_HORIZON_EXPLORATION", "when love is inaccessible, cultivation is the primary task");
  const onceKnown = planFromGraphs({ graphs: bundle.graphs, variables: { ...values, deep_love_access: "past_glimpse" } });
  assert.ok(onceKnown.selectedNodes.some(n => n.id === "IC.LOVE_HORIZON_EXPLORATION"));
  const presentlyLoved = planFromGraphs({ graphs: bundle.graphs, variables: { ...values, deep_love_access: "reliable", child_love_inclusion: "reliable" } });
  assert.ok(presentlyLoved.selectedNodes.some(n => n.id === "IC.LOVE_HORIZON_EXPLORATION"));
  assert.equal(presentlyLoved.primaryJob.id, "IC.LOVE_HORIZON_EXPLORATION", "when integration is already reliable, continue the practice");
  const presentlyAvailableToChild = planFromGraphs({ graphs: bundle.graphs, variables: { ...values, deep_love_access: "intermittent", child_love_inclusion: "untested" } });
  assert.ok(presentlyAvailableToChild.selectedNodes.some(n => n.id === "IC.LOVE_HORIZON_EXPLORATION"));
  assert.ok(presentlyAvailableToChild.selectedNodes.some(n => n.id === "IC.DEEP_LOVE_TO_CHILD"));
  assert.equal(presentlyAvailableToChild.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD", "available love should reach the inner child before exploratory practice");
  const uninterested = planFromGraphs({ graphs: bundle.graphs, variables: { ...values, spiritual_curiosity:"absent" } });
  assert.ok(!uninterested.selectedNodes.some(n => n.id === "IC.LOVE_HORIZON_EXPLORATION"));
});

test("even a spiritual opening does not certify inner-child reception or authorize coercion", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const node = bundle.graphs.flatMap(graph => graph.nodes).find(n => n.id === "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(node.sourceRefs.includes("AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014"));
  assert.ok(node.recommendations.some(s => /without interpreting refusal as a deliberate test/i.test(s)));
  assert.ok(node.effects.requiredNuance.some(s => /separate/i.test(s) && /reception/i.test(s)));
  assert.ok(node.effects.forbiddenOverclaims.some(s => /testing whether the adult/i.test(s)));
  const values = { present_safety:"safe", orientation:"oriented", ability_to_stop:"yes", ability_to_return:"yes", activation:"moderate", dissociation:"none", altered_state:"sober", deep_love_access:"intermittent", child_love_inclusion:"blocked", suicidal_state:"absent" };
  const plan = planFromGraphs({ graphs: bundle.graphs, variables: values });
  assert.ok(plan.selectedNodes.some(n => n.id === "IC.DEEP_LOVE_TO_CHILD"));
  assert.ok(plan.requiredNuance.some(s => /younger self’s actual reception are separate/i.test(s)));
  assert.ok(plan.forbiddenOverclaims.some(s => /testing whether the adult/i.test(s)));
});

test("extraction instructions do not conflate saying thanks with felt deep love", async () => {
  const prompt = await fs.readFile(new URL("../src/prompts/case-extract.mjs", import.meta.url), "utf8");
  assert.match(prompt, /Saying thanks, naming one good thing amid suffering/);
  assert.match(prompt, /does not by itself establish deep_love_access/);
  assert.match(prompt, /clinical recovery as an observation/);
  assert.match(prompt, /Gratitude even for suffering itself/);
  assert.match(prompt, /essential ongoing cultivation/);
  assert.match(prompt, /not an enforceable demand to feel grateful/);
});
