import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { CASE_VARIABLE_ENUMS } from "../src/guide-graph/contract.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

// The owner's answers of 14 Oct 2026 (22:15 and 23:26 UTC, AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014): gratitude is what
// he advises basically everyone, with or without a religion, aimed at unconditional love; the guard comes first when the
// younger self doesn't want the love; an obvious contradiction is looked at first; after a fresh death or harm, grief
// and support lead and gratitude comes in sideways.

const steady = { present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent",
  activation: "moderate", dissociation: "none", altered_state: "sober", witness_capacity: "present", inner_adult_access: "available" };
const bundle = await compileGuideGraphs({ write: false });
const byId = new Map(bundle.graphs.flatMap((graph) => graph.nodes).map((node) => [node.id, node]));
const plan = (variables) => planFromGraphs({ graphs: bundle.graphs, variables: { ...steady, ...variables } });
const selected = (result) => result.selectedNodes.map((node) => node.id);

test("gratitude is offered to everyone, with or without a religion, toward unconditional love, by asking rather than preaching", () => {
  const node = byId.get("IC.GRATITUDE_PRACTICE");
  assert.deepEqual(node.sourceRefs.filter((ref) => ref.startsWith("AMEND.")),
    ["AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014", "AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014"]);
  const says = (pattern) => node.recommendations.some((line) => pattern.test(line));
  assert.ok(says(/basically everyone, with or without a religion/));
  assert.ok(says(/unconditional love and acceptance/));
  assert.ok(says(/anger and self-hatred often come from life or oneself not being how they “should” be/));
  assert.ok(says(/why to be grateful for suffering/) && says(/without an ego battle/));
  assert.ok(says(/Ask rather than preach/) && says(/would they be happy if they had everything they want/));
  assert.ok(says(/if only I had X/) && says(/without letting the story run on/));
  assert.ok(says(/Start where there’s a grip/) && says(/Switching angles abandons nothing/));
  assert.ok(says(/gratitude never has to come first before the child can be invited/));
  assert.ok(node.avoid.some((line) => /Do not preach, lecture or insist/.test(line)));
  assert.ok(node.effects.requiredNuance.some((line) => /someone can love their pets and still feel no unconditional love/.test(line)));
  // No spiritual curiosity, no religion: an angry man who loves his cats, hates himself, and feels no unconditional love.
  const louka = plan({ love_access: "accessible", deep_love_access: "none_known", spiritual_curiosity: "absent", self_directed_love: "inaccessible",
    self_criticism: "present" });
  assert.equal(louka.primaryJob.id, "IC.GRATITUDE_PRACTICE");
  assert.ok(!selected(louka).includes("IC.LOVE_HORIZON_EXPLORATION"), "exploring a deeper horizon is for the curious");
  // With curiosity, gratitude still leads and the horizon supports it.
  const curious = plan({ love_access: "accessible", deep_love_access: "none_known", spiritual_curiosity: "present", self_directed_love: "inaccessible" });
  assert.equal(curious.primaryJob.id, "IC.GRATITUDE_PRACTICE");
  assert.ok(selected(curious).includes("IC.LOVE_HORIZON_EXPLORATION"));
});

test("where gratitude leads, and where something else comes first", () => {
  // Numb, with a little love left for the dog: that love leads, and gratitude comes back later.
  const numbWithDog = plan({ activation: "low", love_access: "limited", deep_love_access: "none_known" });
  assert.equal(numbWithDog.primaryJob.id, "IC.BORROW_LOVE");
  assert.ok(!selected(numbWithDog).includes("IC.GRATITUDE_PRACTICE"));
  assert.ok(numbWithDog.deferredNodes.some((node) => node.id === "IC.GRATITUDE_PRACTICE"), "gratitude waits rather than disappears");
  // Once unconditional love is felt, gratitude goes on, however little ordinary love there is (Codex, 00d81e51).
  const feltWithLittleOrdinaryLove = plan({ love_access: "limited", deep_love_access: "reliable", child_love_inclusion: "reliable" });
  assert.equal(feltWithLittleOrdinaryLove.primaryJob.id, "IC.GRATITUDE_PRACTICE");
  assert.ok(!feltWithLittleOrdinaryLove.deferredNodes.some((node) => node.id === "IC.GRATITUDE_PRACTICE"));
  assert.ok(byId.get("IC.BORROW_LOVE").recommendations.some((line) => /gratitude comes back later either way/.test(line)));
  // Numb, with no love for anyone: once unconditional love is assessed (not felt), gratitude itself.
  assert.equal(plan({ activation: "low", love_access: "absent", deep_love_access: "none_known" }).primaryJob.id, "IC.GRATITUDE_PRACTICE");
  // Unconditional love felt and not yet brought to the child: the child route leads, gratitude continues beside it.
  const untested = plan({ deep_love_access: "reliable", child_love_inclusion: "untested" });
  assert.equal(untested.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(selected(untested).includes("IC.GRATITUDE_PRACTICE"));
  // It reaches the child already: gratitude goes on as the practice.
  assert.equal(plan({ deep_love_access: "reliable", child_love_inclusion: "reliable" }).primaryJob.id, "IC.GRATITUDE_PRACTICE");
  // An obvious contradiction is looked at first.
  const contradiction = plan({ love_access: "accessible", deep_love_access: "state_dependent", spiritual_bypass_pattern: "attainment_outpaces_love" });
  assert.equal(contradiction.primaryJob.id, "IC.REALIZATION_LOVE_INTEGRATION");
  assert.ok(contradiction.deferredNodes.some((node) => node.id === "IC.GRATITUDE_PRACTICE"), "gratitude waits until it has been looked at");
  assert.ok(!selected(contradiction).includes("IC.GRATITUDE_PRACTICE"));
  assert.ok(byId.get("IC.REALIZATION_LOVE_INTEGRATION").recommendations.some((line) => /I love everyone, I just hate my dad/.test(line)));
  // An objection to gratitude is heard inside the gratitude route, with the guard beside it.
  const objection = plan({ love_access: "accessible", deep_love_access: "none_known", protective_response: "present" });
  assert.equal(objection.primaryJob.id, "IC.GRATITUDE_PRACTICE");
  assert.ok(selected(objection).includes("IC.MEET_GUARD"));
  // Not unknown: until unconditional love has been asked about, gratitude isn't routed for someone who feels ordinary love.
  assert.ok(!selected(plan({ love_access: "accessible" })).includes("IC.GRATITUDE_PRACTICE"));
});

test("after a fresh death or harm, grief and support lead and gratitude comes in sideways", () => {
  assert.deepEqual(CASE_VARIABLE_ENUMS.fresh_grief, ["present", "absent", "unknown"]);
  const node = byId.get("ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(node.recommendations.some((line) => /Encourage crying, support from loved ones, and prayer if they pray/.test(line)));
  assert.ok(node.recommendations.some((line) => /send love to the one who died/.test(line) && /Don’t present that as fact/.test(line)));
  assert.ok(node.recommendations.some((line) => /Gratitude can come in sideways/.test(line) && /never made the priority/.test(line)));
  const grief = plan({ love_access: "accessible", deep_love_access: "none_known", fresh_grief: "present" });
  assert.equal(grief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  // The full practice (gratitude even for suffering) waits; the grief step's own line brings gratitude in sideways
  // (Codex, 4c4a80bd: a selected node's recommendations all reach the reply).
  assert.ok(!selected(grief).includes("IC.GRATITUDE_PRACTICE"));
  assert.ok(grief.deferredNodes.some((node) => node.id === "IC.GRATITUDE_PRACTICE"));
  assert.ok(!grief.selectedNodes.flatMap((node) => node.recommendations).some((line) => /gratitude even for suffering/i.test(line)));
  assert.ok(grief.avoid.some((line) => /grateful for the loss/.test(line)));
  // The death line is for a death only (Codex, 62fe3220).
  assert.ok(node.recommendations.filter((line) => /the one who died/.test(line)).every((line) => /^After a death,/.test(line)));
  // Grief leads ahead of contradiction work, which waits (Codex, 62fe3220).
  const griefAndContradiction = plan({ love_access: "accessible", deep_love_access: "state_dependent", spiritual_bypass_pattern: "attainment_outpaces_love",
    fresh_grief: "present" });
  assert.equal(griefAndContradiction.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(griefAndContradiction.deferredNodes.some((item) => item.id === "IC.REALIZATION_LOVE_INTEGRATION"));
  // With felt love and the child not yet reached, the love route waits too, so no selected line asks a bereaved
  // person for gratitude (Codex, 6fba89a8).
  const griefAndLove = plan({ deep_love_access: "reliable", child_love_inclusion: "untested", fresh_grief: "present" });
  assert.equal(griefAndLove.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(griefAndLove.deferredNodes.some((item) => item.id === "IC.DEEP_LOVE_TO_CHILD"));
  assert.ok(!griefAndLove.selectedNodes.filter((item) => item.id !== "ROUTE.FRESH_GRIEF_FIRST").flatMap((item) => item.recommendations)
    .some((line) => /gratitude/i.test(line)));
  // Grief isn't inner-child work: its route stays when inner-child work is declined (Codex, 6fba89a8).
  assert.equal(plan({ love_access: "accessible", fresh_grief: "present", ic_status: "declined" }).primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  // A sensitive signal: it asks for a reviewed formulation, like a spiritual struggle.
  const calm = { ...steady, activation: "low", inner_adult_access: "available", witness_capacity: "present" };
  assert.equal(classifyTherapyTier({ variables: calm }).tier, "fast");
  assert.equal(classifyTherapyTier({ variables: { ...calm, fresh_grief: "present" } }).tier, "reviewed");
  // A prior snapshot saved before the field existed counts it as unknown, not as a change (Codex, 272662d7).
  const legacy = { variables: { ...calm } };
  assert.equal(classifyTherapyTier({ variables: { ...calm, fresh_grief: "unknown" } }, "auto", { priorCaseSnapshot: legacy }).deltaCount, 0);
  assert.equal(classifyTherapyTier({ variables: { ...calm, fresh_grief: "present" } }, "auto", { priorCaseSnapshot: legacy }).deltaCount, 1);
});

test("when the younger self doesn't want the love, the guard comes first and the love route waits", () => {
  const refuses = plan({ deep_love_access: "intermittent", child_love_inclusion: "blocked", protective_response: "present" });
  assert.equal(refuses.primaryJob.id, "IC.GUARD_BEFORE_CHILD_LOVE");
  assert.ok(!selected(refuses).includes("IC.DEEP_LOVE_TO_CHILD"));
  assert.ok(refuses.deferredNodes.some((node) => node.id === "IC.DEEP_LOVE_TO_CHILD"));
  // The waiting route's cautions still hold.
  assert.ok(refuses.requiredNuance.some((line) => /younger self’s actual reception are separate/i.test(line)));
  assert.ok(refuses.forbiddenOverclaims.some((line) => /testing whether the adult/i.test(line)));
  const guard = byId.get("IC.GUARD_BEFORE_CHILD_LOVE");
  assert.ok(guard.recommendations.some((line) => /hear its guard first/.test(line)));
  assert.ok(guard.recommendations.some((line) => /the child owes no thanks/.test(line)));
  // "Blocked" also covers numbness or inability; with no guard showing, the love route keeps leading (Codex, 06a84b8c).
  const numbChild = plan({ deep_love_access: "intermittent", child_love_inclusion: "blocked", protective_response: "absent", urge_to_escape: "absent" });
  assert.equal(numbChild.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(!selected(numbChild).includes("IC.GUARD_BEFORE_CHILD_LOVE"));
  // Once the guard allows it, the love route leads again.
  const allows = plan({ deep_love_access: "intermittent", child_love_inclusion: "blocked", protective_response: "present", guard_engagement: "willing_to_allow" });
  assert.equal(allows.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(!selected(allows).includes("IC.GUARD_BEFORE_CHILD_LOVE"));
});

test("even a spiritual opening does not certify inner-child reception or authorize coercion", () => {
  const node = byId.get("IC.DEEP_LOVE_TO_CHILD");
  assert.ok(node.sourceRefs.includes("AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014"));
  assert.ok(node.recommendations.some((line) => /without interpreting refusal as a deliberate test/i.test(line)));
  assert.ok(node.effects.requiredNuance.some((line) => /separate/i.test(line) && /reception/i.test(line)));
  assert.ok(node.effects.forbiddenOverclaims.some((line) => /testing whether the adult/i.test(line)));
  const partial = plan({ deep_love_access: "intermittent", child_love_inclusion: "partial" });
  assert.equal(partial.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(partial.requiredNuance.some((line) => /younger self’s actual reception are separate/i.test(line)));
  assert.ok(partial.forbiddenOverclaims.some((line) => /testing whether the adult/i.test(line)));
});

test("the child route asks gratitude of everyone, and never as a gate before the child", () => {
  const node = byId.get("IC.DEEP_LOVE_TO_CHILD");
  const lines = [...node.recommendations, ...node.effects.requiredNuance];
  assert.ok(lines.some((line) => /^Gratitude continues even when profound love is currently accessible/.test(line)));
  assert.ok(lines.some((line) => /never a prerequisite that must be completed before the child can receive care/.test(line)));
  assert.ok(lines.every((line) => !/gratitude path|different or secular practice/i.test(line)), "no path scoping");
});

test("the horizon node is back to exploring a deeper horizon for the curious, just below gratitude", () => {
  const node = byId.get("IC.LOVE_HORIZON_EXPLORATION");
  assert.equal(node.title, "Explore a deeper horizon of wellbeing when curiosity is genuine");
  assert.deepEqual([node.tier, node.priority], [3, 93]);
  assert.ok(node.activation.all.some((condition) => condition.field === "spiritual_curiosity" && condition.value === "present"));
  assert.ok(!node.recommendations.some((line) => /gratitude/i.test(line)));
});

test("extraction instructions tell ordinary love from unconditional love, and saying thanks from felt love", async () => {
  const prompt = await fs.readFile(new URL("../src/prompts/case-extract.mjs", import.meta.url), "utf8");
  assert.match(prompt, /Saying thanks, naming one good thing amid suffering/);
  assert.match(prompt, /does not by itself establish deep_love_access/);
  assert.match(prompt, /clinical recovery as an observation/);
  assert.match(prompt, /Gratitude even for suffering itself/);
  assert.match(prompt, /essential ongoing cultivation/);
  assert.match(prompt, /not an enforceable demand to feel grateful/);
  assert.match(prompt, /Gratitude is the practice the author advises everyone, with or without a religion/);
  assert.match(prompt, /deep_love_access tracks unconditional love and acceptance/);
  assert.match(prompt, /Someone numb who can still feel a little love for a pet or a person is limited/);
  assert.match(prompt, /I love everyone, I just hate my dad/);
  assert.match(prompt, /fresh_grief is present when the person reports a recent death or other loss/);
  assert.doesNotMatch(prompt, /author’s gratitude path/);
});
