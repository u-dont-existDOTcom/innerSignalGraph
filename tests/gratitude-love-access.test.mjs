import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { CASE_VARIABLE_ENUMS } from "../src/guide-graph/contract.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { evaluatePathPerformance } from "../src/case-formulation/path-performance.mjs";

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
  const node = byId.get("ROUTE.GRATITUDE_PRACTICE");
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
  // Child-free, so it stays when inner-child work is declined or paused (Codex, 4cfc8f3f); the child route carries the
  // rule that gratitude is never a gate before the child.
  assert.ok([node.title, ...node.recommendations, ...node.avoid, ...node.effects.requiredNuance].every((line) => !/child|younger/i.test(line)));
  assert.equal(plan({ deep_love_access: "none_known", ic_status: "declined" }).primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  assert.ok(node.avoid.some((line) => /Do not preach, lecture or insist/.test(line)));
  assert.ok(node.effects.requiredNuance.some((line) => /someone can love their pets and still feel no unconditional love/.test(line)));
  // No spiritual curiosity, no religion: an angry man who loves his cats, hates himself, and feels no unconditional love.
  const louka = plan({ love_access: "accessible", deep_love_access: "none_known", spiritual_curiosity: "absent", self_directed_love: "inaccessible",
    self_criticism: "present" });
  assert.equal(louka.primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  assert.ok(!selected(louka).includes("IC.LOVE_HORIZON_EXPLORATION"), "exploring a deeper horizon is for the curious");
  // With curiosity, gratitude still leads and the horizon supports it.
  const curious = plan({ love_access: "accessible", deep_love_access: "none_known", spiritual_curiosity: "present", self_directed_love: "inaccessible" });
  assert.equal(curious.primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  assert.ok(selected(curious).includes("IC.LOVE_HORIZON_EXPLORATION"));
});

test("where gratitude leads, and where something else comes first", () => {
  // Numb, with a little love left for the dog: that love leads, and gratitude comes back later.
  const numbWithDog = plan({ activation: "low", love_access: "limited", deep_love_access: "none_known" });
  assert.equal(numbWithDog.primaryJob.id, "IC.BORROW_LOVE");
  assert.ok(!selected(numbWithDog).includes("ROUTE.GRATITUDE_PRACTICE"));
  assert.ok(numbWithDog.deferredNodes.some((node) => node.id === "ROUTE.GRATITUDE_PRACTICE"), "gratitude waits rather than disappears");
  // Once unconditional love is felt, gratitude goes on, however little ordinary love there is (Codex, 00d81e51).
  const feltWithLittleOrdinaryLove = plan({ love_access: "limited", deep_love_access: "reliable", child_love_inclusion: "reliable" });
  assert.equal(feltWithLittleOrdinaryLove.primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  assert.ok(!feltWithLittleOrdinaryLove.deferredNodes.some((node) => node.id === "ROUTE.GRATITUDE_PRACTICE"));
  assert.ok(byId.get("IC.BORROW_LOVE").recommendations.some((line) => /gratitude comes back later either way/.test(line)));
  // Numb, with no love for anyone: once unconditional love is assessed (not felt), gratitude itself.
  assert.equal(plan({ activation: "low", love_access: "absent", deep_love_access: "none_known" }).primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  // Unconditional love felt and not yet brought to the child: the child route leads, gratitude continues beside it.
  const untested = plan({ deep_love_access: "reliable", child_love_inclusion: "untested" });
  assert.equal(untested.primaryJob.id, "IC.DEEP_LOVE_TO_CHILD");
  assert.ok(selected(untested).includes("ROUTE.GRATITUDE_PRACTICE"));
  // It reaches the child already: gratitude goes on as the practice.
  assert.equal(plan({ deep_love_access: "reliable", child_love_inclusion: "reliable" }).primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  // An obvious contradiction is looked at first.
  const contradiction = plan({ love_access: "accessible", deep_love_access: "state_dependent", spiritual_bypass_pattern: "attainment_outpaces_love" });
  assert.equal(contradiction.primaryJob.id, "IC.REALIZATION_LOVE_INTEGRATION");
  assert.ok(contradiction.deferredNodes.some((node) => node.id === "ROUTE.GRATITUDE_PRACTICE"), "gratitude waits until it has been looked at");
  assert.ok(!selected(contradiction).includes("ROUTE.GRATITUDE_PRACTICE"));
  assert.ok(byId.get("IC.REALIZATION_LOVE_INTEGRATION").recommendations.some((line) => /I love everyone, I just hate my dad/.test(line)));
  // An objection to gratitude is heard inside the gratitude route, with the guard beside it.
  const objection = plan({ love_access: "accessible", deep_love_access: "none_known", protective_response: "present" });
  assert.equal(objection.primaryJob.id, "ROUTE.GRATITUDE_PRACTICE");
  assert.ok(selected(objection).includes("IC.MEET_GUARD"));
  // Crisis states wait for stabilization or urgent care first (Codex, bce5ceae).
  for (const crisis of [{ medical_urgency: "urgent" }, { dissociation: "high" }, { altered_medical_status: "concerning" }, { altered_capacity: "impaired" }]) {
    assert.ok(!selected(plan({ deep_love_access: "none_known", ...crisis })).includes("ROUTE.GRATITUDE_PRACTICE"), JSON.stringify(crisis));
  }
  // Not unknown: until unconditional love has been asked about, gratitude isn't routed for someone who feels ordinary love.
  assert.ok(!selected(plan({ love_access: "accessible" })).includes("ROUTE.GRATITUDE_PRACTICE"));
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
  assert.ok(!selected(grief).includes("ROUTE.GRATITUDE_PRACTICE"));
  assert.ok(grief.deferredNodes.some((node) => node.id === "ROUTE.GRATITUDE_PRACTICE"));
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
  // Grief comes before every route but immediate safety (Codex, 713e5f86): a trust check at the same old tier...
  const griefAndTrust = plan({ love_access: "accessible", fresh_grief: "present", external_authority_pull: "strong" });
  assert.ok(griefAndTrust.trace.some((item) => item.id === "IC.INTUITION_TRUST_CALIBRATION"));
  assert.equal(griefAndTrust.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  // ...and an active strategy, which yields to it as to a protective route.
  const observationIds = new Set(["O1", "O2"]);
  const active = evaluatePathPerformance({ prior: null, variables: { ...steady, unresolved_inner_material: "present" }, observationIds,
    update: { strategy: { process_id: "self-attack", target: "access the blocked need", formulation: "Care may soften self-attack",
      family: "responsive_care", node_id: "ROUTE.GO_INWARD", selection_reason: "Synthetic", observation_ids: ["O1"],
      predictions: [{ id: "P1", sign: "need_access", description: "Identify a blocked need", horizon: "immediate" }], adverse_signs: ["shame"] },
    response: "not_observed", signals: [], failure_hypotheses: [], probe: null } });
  active.active.delivery = { node_id: "ROUTE.GO_INWARD", review: 0, evidence: "synthetic_delivered_intervention" };
  const continuing = planFromGraphs({ graphs: bundle.graphs, variables: { ...steady, unresolved_inner_material: "present" }, pathPerformance: structuredClone(active) });
  assert.equal(continuing.primaryJob.id, "ROUTE.GO_INWARD", "without grief the strategy continues");
  const interrupted = planFromGraphs({ graphs: bundle.graphs, variables: { ...steady, unresolved_inner_material: "present", fresh_grief: "present" },
    pathPerformance: structuredClone(active) });
  assert.equal(interrupted.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  // While grief is fresh, borrowed love and the rest of the inward work wait too (Codex, 4cfc8f3f); support and gentle
  // settling of the body stay.
  const griefWithOrdinaryLove = plan({ love_access: "accessible", fresh_grief: "present" });
  assert.equal(griefWithOrdinaryLove.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  for (const id of ["IC.BORROW_LOVE", "IC.BORROW_ONE_FUNCTION"]) {
    assert.ok(!selected(griefWithOrdinaryLove).includes(id), id);
  }
  assert.ok(griefWithOrdinaryLove.deferredNodes.some((item) => item.id === "IC.BORROW_LOVE"));
  assert.ok(selected(griefWithOrdinaryLove).includes("SOM.GENTLE_REGULATION"));
  // Nonurgent chronic-pain navigation is tier 1 too, but it is referral work, not immediate safety: it waits (Codex,
  // 5d6f6aaf); an urgent medical problem still leads.
  const griefAndPain = plan({ fresh_grief: "present", refractory_pain_care: "indicated", medical_urgency: "none" });
  assert.equal(griefAndPain.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(griefAndPain.deferredNodes.some((item) => item.id === "ROUTE.REFRACTORY_PAIN_NAVIGATION"));
  assert.equal(plan({ fresh_grief: "present", medical_urgency: "urgent" }).primaryJob.id, "ROUTE.MEDICAL_RED_FLAG");
  // Music that overwhelms is stopped first; the grief route comes once it is (Codex, 54a46dbf).
  assert.equal(plan({ fresh_grief: "present", music_emotional_access: "overwhelming" }).primaryJob.id, "IC.MUSIC_EMOTIONAL_ACCESS_STOP");
  // ...and the gratitude practice waits meanwhile, though the grief route isn't there to defer it (Codex, 50975677).
  const musicAndGrief = plan({ fresh_grief: "present", music_emotional_access: "overwhelming", deep_love_access: "none_known" });
  assert.ok(!selected(musicAndGrief).includes("ROUTE.GRATITUDE_PRACTICE"));
  assert.ok(musicAndGrief.deferredNodes.some((item) => item.id === "ROUTE.GRATITUDE_PRACTICE"));
  // No stop or safety state switches the grief route off, so its holds stay while that route leads (Codex, df7befda).
  // Immediate safety leads with grief beside it...
  const unsafeGrief = plan({ love_access: "accessible", fresh_grief: "present", present_safety: "unsafe" });
  assert.equal(unsafeGrief.primaryJob.id, "IC.SAFETY_ORIENTATION");
  assert.ok(selected(unsafeGrief).includes("ROUTE.FRESH_GRIEF_FIRST"));
  assert.ok(!selected(unsafeGrief).includes("IC.BORROW_LOVE"));
  // ...an acute altered state and overwhelming music hold the grief route back while they lead...
  const acuteGrief = plan({ love_access: "accessible", fresh_grief: "present", altered_state: "altered", activation: "high",
    altered_capacity: "coherent", altered_medical_status: "stable" });
  assert.equal(acuteGrief.primaryJob.id, "ROUTE.ALTERED_ACUTE_STABILIZATION");
  for (const id of ["ROUTE.FRESH_GRIEF_FIRST", "IC.BORROW_LOVE"]) assert.ok(acuteGrief.deferredNodes.some((item) => item.id === id), id);
  const musicInward = plan({ love_access: "accessible", fresh_grief: "present", music_emotional_access: "overwhelming",
    unresolved_inner_material: "present" });
  for (const id of ["ROUTE.FRESH_GRIEF_FIRST", "ROUTE.GO_INWARD", "IC.BORROW_LOVE"]) {
    assert.ok(!selected(musicInward).includes(id), id);
    assert.ok(musicInward.deferredNodes.some((item) => item.id === id), id);
  }
  // ...and an active strategy yields to the music stop, with or without grief, instead of continuing past it.
  const musicVariables = { ...steady, unresolved_inner_material: "present", music_emotional_access: "overwhelming" };
  for (const fresh_grief of ["present", "absent"]) {
    const stopped = planFromGraphs({ graphs: bundle.graphs, variables: { ...musicVariables, fresh_grief }, pathPerformance: structuredClone(active) });
    assert.equal(stopped.primaryJob.id, "IC.MUSIC_EMOTIONAL_ACCESS_STOP", fresh_grief);
  }
  // In a stable altered state grief leads, and going inward waits, with the stable-state therapy and the altered-state
  // routes that continue inner-child work or rehearse it (Codex, fffb9049).
  const stableGrief = plan({ fresh_grief: "present", unresolved_inner_material: "present", altered_state: "altered",
    altered_capacity: "coherent", altered_medical_status: "stable" });
  assert.equal(stableGrief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  for (const id of ["ROUTE.GO_INWARD", "ROUTE.ALTERED_STABLE_THERAPY", "IC.ALTERED_STATE_GATE"]) {
    assert.ok(stableGrief.trace.some((item) => item.id === id), id);
    assert.ok(!selected(stableGrief).includes(id), id);
  }
  // (The plan lists a waiting node only when something beyond the state gates triggered it.)
  assert.ok(stableGrief.deferredNodes.some((item) => item.id === "ROUTE.GO_INWARD"));
  // Afterwards, sober, rehearsing what the altered state opened waits too.
  const transferGrief = plan({ fresh_grief: "present", altered_state_transfer: "state_bound" });
  assert.equal(transferGrief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(!selected(transferGrief).includes("ROUTE.ALTERED_STATE_TRANSFER"));
  assert.ok(transferGrief.deferredNodes.some((item) => item.id === "ROUTE.ALTERED_STATE_TRANSFER"));
  // ...and so does the aftermath route's meaning-making, while its safety cautions stay in the plan (Codex, 59e8d2f6).
  const aftermathGrief = plan({ fresh_grief: "present", altered_phase: "aftermath" });
  assert.equal(aftermathGrief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(aftermathGrief.trace.some((item) => item.id === "ROUTE.ALTERED_AFTERMATH"));
  assert.ok(!selected(aftermathGrief).includes("ROUTE.ALTERED_AFTERMATH"));
  assert.ok(aftermathGrief.requiredNuance.some((line) => /psychotic-type reaction/.test(line)));
  // Preparing a planned session waits too, its safety cautions staying; and so does titrating inner-child work, which
  // is waiting anyway (Codex, c975bcef).
  const plannedGrief = plan({ fresh_grief: "present", altered_phase: "planned" });
  assert.equal(plannedGrief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(plannedGrief.trace.some((item) => item.id === "ROUTE.ALTERED_PREPARATION"));
  assert.ok(!selected(plannedGrief).includes("ROUTE.ALTERED_PREPARATION"));
  assert.ok(plannedGrief.requiredNuance.some((line) => /psychotic-type reaction/.test(line)));
  const titrationGrief = plan({ fresh_grief: "present", ic_status: "active", ic_titration_needed: "yes" });
  assert.equal(titrationGrief.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(titrationGrief.trace.some((item) => item.id === "IC.CONTINUITY_TITRATION"));
  assert.ok(!selected(titrationGrief).includes("IC.CONTINUITY_TITRATION"));
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
  assert.ok(guard.recommendations.some((line) => /child owes no thanks/i.test(line)));
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
  assert.ok(lines.some((line) => /never a prerequisite that must be completed before the child can receive care/.test(line)));
  assert.ok(lines.every((line) => !/gratitude path|different or secular practice/i.test(line)), "no path scoping");
  // Only the gratitude route asks for gratitude, so its waits (a crisis, an altered state, fresh grief) hold: neither child
  // route recommends it (Codex, 32c6fee0).
  for (const id of ["IC.DEEP_LOVE_TO_CHILD", "IC.GUARD_BEFORE_CHILD_LOVE"]) {
    assert.ok(byId.get(id).recommendations.every((line) => !/gratitude/i.test(line) || /owes no thanks|never/i.test(line)), id);
  }
  const crisis = plan({ deep_love_access: "intermittent", child_love_inclusion: "untested", suicidal_state: "ideation" });
  assert.ok(!crisis.selectedNodes.flatMap((item) => item.recommendations).some((line) => /gratitude (continues|goes on)|Gratitude is the practice|gratitude even for suffering/i.test(line)));
  assert.ok(byId.get("ROUTE.GRATITUDE_PRACTICE").recommendations.some((line) => /for the chance to care for whoever is hurting, oneself included/.test(line)));
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
  // Time-sensitive: checked again every turn against dated evidence (Codex, 440a75e2), but a turn about something else
  // is no evidence that the loss has eased (Codex, 535a1b20).
  assert.match(prompt, /A time-sensitive state \(fresh_grief\) is checked again on every turn, but a turn that says nothing about the loss is no evidence/);
  assert.match(prompt, /don't change it, or set it to unknown, because a message is about something else/);
  assert.match(prompt, /or the turn times and the current message time show the loss is no longer recent/);
  assert.match(prompt, /set it absent, not unknown, once the person says or shows that the rawness has eased/);
  assert.doesNotMatch(prompt, /author’s gratitude path/);
});

test("fresh grief is checked against each turn's time and never lapses on a turn about something else", async () => {
  const { caseExtractionPrompt } = await import("../src/prompts/case-extract.mjs");
  const { caseAuditPrompt } = await import("../src/prompts/case-audit.mjs");
  const { runCaseExtraction, carryFreshGrief } = await import("../src/case-formulation/run.mjs");
  const { blankCaseVariables } = await import("../src/guide-graph/contract.mjs");
  const base = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], userMessage: "Work was busy today.",
    recentTranscript: "USER: synthetic", pathPerformanceEnabled: false, perspectivePracticesEnabled: false };
  // The extractor and the auditor see when each turn was recorded and when the current message came (Codex, 68154e71),
  // though the shared verbatim window has no timestamps.
  const timed = { ...base, currentTurnAt: "2026-10-16T09:00:00Z", recentTranscriptEntries: [
    { id: "t1", exchange_id: "e1", role: "user", text: "My mother died yesterday.", at: "2026-10-14T21:00:00Z" },
    { id: "t2", exchange_id: "e1", role: "assistant", text: "I'm so sorry.", at: "2026-10-14T21:01:00Z" }] };
  const snapshot = (fresh_grief) => ({ user_goal: "synthetic", current_issue: "synthetic", direct_observations: [], hypotheses: [], unknowns: [],
    variables: { ...blankCaseVariables(), fresh_grief } });
  for (const prompt of [caseExtractionPrompt(timed).user, caseAuditPrompt(timed, snapshot("present")).user]) {
    assert.match(prompt, /RECENT TRANSCRIPT \(each turn with the time it was recorded\):\n\[2026-10-14T21:00:00Z\] USER: My mother died yesterday\.\n\n\[2026-10-14T21:01:00Z\] ASSISTANT: I'm so sorry\./);
    assert.match(prompt, /CURRENT MESSAGE TIME: 2026-10-16T09:00:00Z/);
  }
  const untimed = caseExtractionPrompt(base).user;
  assert.match(untimed, /RECENT TRANSCRIPT \(turn times not supplied\):\nUSER: synthetic/);
  assert.match(untimed, /CURRENT MESSAGE TIME: \(not supplied\)/);
  const audit = caseAuditPrompt(timed, snapshot("present")).system;
  assert.match(audit, /fresh_grief from an earlier turn corrected because the current message is about something else/);
  // An extraction of unknown keeps a prior present, and so does an audit correction to unknown; absent, from evidence,
  // clears it.
  const extract = async (prior, extracted) => (await runCaseExtraction({ context: { ...base, priorCaseSnapshot: snapshot(prior) },
    provider: { id: "synthetic", model: "synthetic", async generate() { return { text: JSON.stringify(snapshot(extracted)) }; } } })).value.variables.fresh_grief;
  assert.equal(await extract("present", "unknown"), "present");
  assert.equal(await extract("present", "absent"), "absent");
  assert.equal(await extract("unknown", "unknown"), "unknown");
  assert.equal(await extract("absent", "present"), "present");
  assert.equal(carryFreshGrief(snapshot("unknown"), snapshot("present")).variables.fresh_grief, "present");
  assert.equal(carryFreshGrief(snapshot("absent"), snapshot("present")).variables.fresh_grief, "absent");
  for (const file of ["../src/case-formulation/run.mjs", "../src/orchestrator/run-tiered-pipeline.mjs"]) {
    const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /carryFreshGrief\(applyCaseAudit\(/, file);
  }
});

test("fresh grief is carried by the durable case state, and the current time is trusted, in every runtime", async () => {
  const { carryFreshGrief } = await import("../src/case-formulation/run.mjs");
  const { blankCaseVariables } = await import("../src/guide-graph/contract.mjs");
  const { createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState, validateCaseState, diffCaseStates } = await import("../src/case-state/longitudinal-state.mjs");
  const { loadConfig } = await import("../src/core/config.mjs");
  const { buildContext } = await import("../src/orchestrator/context-builder.mjs");
  const snapshot = (fresh_grief) => ({ user_goal: "synthetic", current_issue: "synthetic", direct_observations: [], hypotheses: [], unknowns: [],
    variables: { ...blankCaseVariables(), fresh_grief } });
  // The encrypted private runtime passes no prior snapshot, so the durable state keeps whether grief is present and since
  // when (Codex, b62b4029); a historical state without the record stays valid.
  const empty = createEmptyCaseState({ caseId: "synthetic-grief" });
  assert.doesNotThrow(() => validateCaseState(structuredClone(empty)));
  const first = mergeRuntimeSnapshotIntoCaseState(empty, snapshot("present"), { turnId: "u1", recordedAt: "2026-10-14T21:00:00Z" });
  assert.deepEqual(first.fresh_grief, { status: "present", since_at: "2026-10-14T21:00:00Z", since_turn_id: "u1",
    updated_at: "2026-10-14T21:00:00Z", updated_turn_id: "u1" });
  assert.equal(diffCaseStates(empty, first).fresh_grief_changed, true);
  const second = mergeRuntimeSnapshotIntoCaseState(first, snapshot("present"), { turnId: "u2", recordedAt: "2026-10-15T08:00:00Z" });
  assert.equal(second.fresh_grief.since_at, "2026-10-14T21:00:00Z");
  assert.equal(second.fresh_grief.updated_turn_id, "u2");
  assert.deepEqual(mergeRuntimeSnapshotIntoCaseState(second, snapshot("unknown"), { turnId: "u3", recordedAt: "2026-10-15T09:00:00Z" }).fresh_grief,
    second.fresh_grief);
  const eased = mergeRuntimeSnapshotIntoCaseState(second, snapshot("absent"), { turnId: "u4", recordedAt: "2026-11-20T09:00:00Z" });
  assert.deepEqual([eased.fresh_grief.status, eased.fresh_grief.since_at], ["absent", null]);
  assert.throws(() => validateCaseState({ ...structuredClone(empty), fresh_grief: { status: "raw" } }), /fresh_grief.status/);
  // The carry reads that record where no prior snapshot is passed.
  assert.equal(carryFreshGrief(snapshot("unknown"), null, second).variables.fresh_grief, "present");
  assert.equal(carryFreshGrief(snapshot("unknown"), null, eased).variables.fresh_grief, "unknown");
  assert.equal(carryFreshGrief(snapshot("absent"), null, second).variables.fresh_grief, "absent");
  // Every live entry point passes a trusted current time: the private runtime its receipt time, the server and the CLI
  // their clock; a time in request input is ignored, and replays and evaluations, which pass none, stay deterministic.
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const given = await buildContext({ userMessage: "synthetic", currentTurnAt: "1999-01-01T00:00:00Z" }, config, { currentTurnAt: "2026-10-15T03:00:00Z" });
  assert.equal(given.currentTurnAt, "2026-10-15T03:00:00Z");
  assert.equal((await buildContext({ userMessage: "synthetic", currentTurnAt: "1999-01-01T00:00:00Z" }, config)).currentTurnAt, null);
  const source = async (file) => fs.readFile(new URL(file, import.meta.url), "utf8");
  assert.match(await source("../src/supervisor/private-therapy-model-runtime.mjs"), /\{ currentTurnAt: runtimeTurn\.inbound\.received_at \}/);
  assert.equal((await source("../src/server/create-server.mjs")).match(/\{ currentTurnAt: new Date\(\)\.toISOString\(\) \}/g).length, 2);
  assert.match(await source("../src/cli/respond.mjs"), /buildContext\(input, config, \{ currentTurnAt: new Date\(\)\.toISOString\(\) \}\)/);
});

test("while grief is fresh, a bounded protective or caring step stays beside it (Codex, fb19ca19)", () => {
  // IC.PROTECTOR_ACTION carries concrete steps (a meal, sleep, a boundary, an unsafe exchange ended, help asked for) and
  // says not to postpone a necessary protective action; the grief route keeps practical help beside it.
  for (const variables of [{ protective_response: "present" }, { inner_adult_access: "partial" }]) {
    const result = plan({ fresh_grief: "present", ...variables });
    assert.equal(result.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
    assert.ok(selected(result).includes("IC.PROTECTOR_ACTION"), JSON.stringify(variables));
    assert.ok(!result.deferredNodes.some((node) => node.id === "IC.PROTECTOR_ACTION"), JSON.stringify(variables));
  }
  const grief = byId.get("ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(!grief.effects.deferNodes.includes("IC.PROTECTOR_ACTION"));
  assert.ok(grief.recommendations.some((line) => /one bounded protective or caring step/.test(line)));
});

test("every node either waits during fresh grief or is named as staying beside it (Codex, ec09f8d9)", () => {
  // Music used as a doorway into feeling or memory waits like the other inward work. Naming what stays makes a new node
  // a decision: it fails here until it is put on one side.
  const grief = byId.get("ROUTE.FRESH_GRIEF_FIRST");
  const held = new Set(grief.effects.deferNodes);
  assert.ok(held.has("IC.MUSIC_EMOTIONAL_ACCESS"));
  const stays = new Set([
    "IC.BEST_FRIEND_PERSPECTIVE",
    "IC.CARING_COMPANY",
    "IC.CHALLENGE_CHECK_IN",
    "IC.COMMON_HUMANITY",
    "IC.COMPASSIONATE_STORY",
    "IC.CRITICISM_KERNEL",
    "IC.DRAFT_EDITOR",
    "IC.DRAFT_RETURN_TO_CARE",
    "IC.GOODWILL_BRIDGE",
    "IC.INTUITION_TRUST_CALIBRATION",
    "IC.MEET_GUARD",
    "IC.MUSIC_EMOTIONAL_ACCESS_STOP",
    "IC.PAST_COMPETENCE",
    "IC.PHOTO_EPISTEMIC_CAUTION",
    "IC.PRECIOUS_HUMAN_OPPORTUNITY",
    "IC.PROTECTOR_ACTION",
    "IC.SAFETY_ORIENTATION",
    "IC.SPIRITUAL_STRUGGLE",
    "IC.SUICIDAL_ADULT_SEAT",
    "IC.SUICIDAL_SELF_DEATH_INQUIRY",
    "IC.WISER_SELF_PERSPECTIVE",
    "ROUTE.ACT_OUTWARD",
    "ROUTE.ALTERED_ACTION_LOCK",
    "ROUTE.ALTERED_ACUTE_STABILIZATION",
    "ROUTE.ALTERED_MEDICAL_SAFETY",
    "ROUTE.COMMUNITY_SUPPORT",
    "ROUTE.DEFINED_WAIT",
    "ROUTE.EXTERNAL_EMBODIMENT",
    "ROUTE.INFLUENCE_INTERNAL",
    "ROUTE.INFLUENCE_LOVE_CAPACITY",
    "ROUTE.INFLUENCE_NONORDINARY_METTA",
    "ROUTE.INFLUENCE_ONTOLOGY_UNCERTAIN",
    "ROUTE.INFLUENCE_SOCIAL_PROTECTION",
    "ROUTE.LEAVE_ALONE",
    "ROUTE.MEDICAL_RED_FLAG",
    "ROUTE.RELATIONAL_REALITY_CHECK",
    "ROUTE.THREE_WAY_GATE",
    "SOM.ADVANCED_RELEASE_BLOCK",
    "SOM.BYPASS_AUDIT",
    "SOM.CONSENSUAL_TOUCH",
    "SOM.DISCHARGE_SETTLE_STACK",
    "SOM.EFT_PORTABLE",
    "SOM.EMDR_DEVELOPMENTAL_DEFER",
    "SOM.GENTLE_REGULATION",
    "SOM.GENTLE_SHAKING",
    "SOM.SAFETY_STABILIZATION",
  ]);
  assert.deepEqual([...byId.keys()].filter((id) => id !== grief.id && !held.has(id) && !stays.has(id)), []);
  assert.deepEqual([...stays].filter((id) => held.has(id)), []);
  const music = plan({ fresh_grief: "present", current_intent: "conversation", love_access: "limited" });
  assert.equal(music.primaryJob.id, "ROUTE.FRESH_GRIEF_FIRST");
  assert.ok(!selected(music).includes("IC.MUSIC_EMOTIONAL_ACCESS"));
});
