import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { SAFETY_ORIENTATION_ROUTE_ID, SUICIDE_FAMILY_ROUTE_IDS } from "../src/case-state/trajectory-digest.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { ROLE_BELIEF_BLOCKING_CODES } from "../src/prompts/role-belief-integrity.mjs";
import { projectCommunicationState } from "../src/storage/private-case-communication.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE, OWNER_FALLBACK_ROUTE_IDS, OWNER_FALLBACK_SAFETY_ROUTE_ID } from "../src/supervisor/owner-fallback-message.mjs";
import { isDeliverableDiscriminatorQuestion, validatePrivateRuntimeTurn } from "../src/supervisor/private-runtime-turn-lifecycle.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { BLOCKING_FINDING, openScriptedRiskRuntime } from "./fixtures/scripted-risk-runtime.mjs";

// Owner question 55, answer A (1 Nov 2026, 12:00 UTC): the fixed fallback message covers four routes, and on them it is also delivered
// where an unresolved role or belief finding would otherwise stop the turn. All of it applies only while INNER_SIGNAL_OWNER_FALLBACK is
// on; with it off every route behaves as it did on main. Everything here is synthetic: numbered placeholder messages, findings chosen by
// the test, and scripted providers. A passing run shows that the code paths behave as stated, not how a real model would report anything.
const CALM = "IC.CREDIBILITY_REPAIR";
const SAFETY = "IC.SAFETY_ORIENTATION";
const INQUIRY = "IC.SUICIDAL_SELF_DEATH_INQUIRY";
const ADULT_SEAT = "IC.SUICIDAL_ADULT_SEAT";
const PRECIOUS = "IC.PRECIOUS_HUMAN_OPPORTUNITY";
const OTHER = "IC.SOMETHING_ELSE";
const QUESTION = "Which part of this stays unsettled for you?";
const ROLE_BELIEF_FINDING = Object.freeze({ id: "synthetic-role-belief", code: "HARMFUL_BELIEF_ENDORSEMENT", severity: "substantive", summary: "Synthetic role or belief defect." });
const unavailable = (code) => (error) => error?.code === code;
const everythingIn = (record) => JSON.stringify(record);

// How each route is reached through the real pipeline. The planner chooses the first three from the extraction's variables. It does not
// make the precious-opportunity route the primary job (the inquiry and adult-seat routes that outrank it are active whenever it is; the
// planner test below checks that), so that one is set on the stored episode after the candidate is produced (forcedRoute in the
// fixture); everything after that is real.
const ROUTES = Object.freeze([
  { name: "safety", route: SAFETY, reading: "imminent" },
  { name: "inquiry", route: INQUIRY, reading: "ideation" },
  { name: "adult-seat", route: ADULT_SEAT, reading: { state: "ideation", variables: { inner_adult_access: "low", witness_capacity: "absent" } } },
  { name: "precious", route: PRECIOUS, reading: "ideation", forcedRoute: PRECIOUS }
]);

// The first user turn reads `spec.reading` (and gets the forced route, if the spec has one); later turns read `later` (default: no risk
// reading) and take the planner's own route.
function openRoute(t, spec, { later = ["absent"], ...options } = {}) {
  return openScriptedRiskRuntime(t, {
    caseId: `synthetic-${spec.name}`,
    readings: [spec.reading, ...later],
    ...(spec.forcedRoute ? { forcedRoute: ({ turn }) => (turn === 1 ? spec.forcedRoute : null) } : {}),
    ...options
  });
}

const firstTurnOnly = (findings) => ({ turn }) => (turn === 1 ? findings : []);

// ---- The route list ---------------------------------------------------------------------------------------------------------

test("the routes are one named, frozen list of exactly the four the owner chose, and the runtime spells none of them", async () => {
  assert.deepEqual([...OWNER_FALLBACK_ROUTE_IDS].sort(), [ADULT_SEAT, INQUIRY, PRECIOUS, SAFETY].sort());
  assert.equal(OWNER_FALLBACK_ROUTE_IDS.length, 4);
  assert.equal(Object.isFrozen(OWNER_FALLBACK_ROUTE_IDS), true);
  assert.equal(OWNER_FALLBACK_SAFETY_ROUTE_ID, SAFETY);
  assert.equal(OWNER_FALLBACK_ROUTE_IDS.includes(OWNER_FALLBACK_SAFETY_ROUTE_ID), true);
  assert.equal(OWNER_FALLBACK_ROUTE_IDS.includes(CALM), false);
  // The digest counts the suicide family and the safety route; the same four routes can deliver the fallback. If either list changes, this
  // fails so that the change is made on purpose for both, as an owner decision.
  assert.deepEqual([...new Set([SAFETY_ORIENTATION_ROUTE_ID, ...SUICIDE_FAMILY_ROUTE_IDS])].sort(), [...OWNER_FALLBACK_ROUTE_IDS].sort());
  const runtimeSource = await fs.readFile(new URL("../src/supervisor/private-therapy-model-runtime.mjs", import.meta.url), "utf8");
  assert.equal(/IC\.[A-Z]/u.test(runtimeSource), false, "the runtime reads the list and names no route");
});

test("the planner makes the safety, inquiry and adult-seat routes the primary job, and does not make the precious-opportunity route the primary job", async () => {
  // Why that route's whole-loop tests set it on the stored episode (forcedRoute) instead of reaching it through a reading. If a graph change
  // makes it reachable, this fails: replace forcedRoute in this file with a reading that reaches it.
  const bundle = await compileGuideGraphs({ write: false });
  const calm = { ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent",
    activation: "low", dissociation: "none", altered_state: "sober", inner_adult_access: "partial", witness_capacity: "present", coherent_child_state: "present",
    body_capacity: "adequate", current_intent: "conversation" };
  const values = {
    suicidal_state: ["ideation", "intent", "imminent"],
    inner_adult_access: ["low", "unknown", "partial", "available"],
    witness_capacity: ["absent", "unknown", "partial", "present"],
    identity_blur: ["present", "absent"],
    present_safety: ["safe", "unsafe"],
    orientation: ["oriented", "disoriented"],
    altered_state: ["sober", "altered"],
    ability_to_stop: ["yes", "no"],
    ability_to_return: ["yes", "no"]
  };
  let combinations = [{}];
  for (const [field, options] of Object.entries(values)) combinations = combinations.flatMap((partial) => options.map((option) => ({ ...partial, [field]: option })));
  const primaries = new Map();
  let preciousAsSecondary = 0;
  for (const combination of combinations) {
    const plan = planFromGraphs({ variables: deriveCaseVariables({ ...calm, ...combination }), graphs: bundle.graphs });
    primaries.set(plan.primaryJob.id, (primaries.get(plan.primaryJob.id) ?? 0) + 1);
    if (plan.selectedNodes.some((node) => node.id === PRECIOUS)) preciousAsSecondary += 1;
  }
  assert.equal(combinations.length, 3 * 4 * 4 * 2 * 2 * 2 * 2 * 2 * 2);
  for (const route of [SAFETY, INQUIRY, ADULT_SEAT]) assert.ok(primaries.get(route) > 0, `${route} is the primary job for some variable sets`);
  assert.equal(primaries.has(PRECIOUS), false, "the precious-opportunity route is never the primary job");
  assert.ok(preciousAsSecondary > 0, "it is selected as a secondary job for some variable sets, so the variables above are the ones that reach it");
});

// ---- produceDiscriminator, row by row ---------------------------------------------------------------------------------------

function discriminatorRuntime({ activeStep, route = activeStep, nextQuestion, findings = [], config }) {
  const source = {
    async loadPrivateRuntimeCase() {
      return {
        case_state: { current_episode: activeStep === undefined && route === undefined ? undefined : { active_step: activeStep, route, next_question: nextQuestion } },
        candidate_responses: [{ id: "candidate-1", audit_history: [{ findings }] }]
      };
    }
  };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: {}, config });
  return () => runtime.produceDiscriminator({ caseId: "synthetic-case", runtimeTurn: { id: "runtime-turn-1", current_candidate_id: "candidate-1" }, authContext: null, attemptContextId: "attempt-1" });
}
const on = Object.freeze({ ownerFallbackEnabled: true });
const off = Object.freeze({ ownerFallbackEnabled: false });
const hold = [{ ...ROLE_BELIEF_FINDING, unresolved: true }];
const isFallback = (produced) => produced.kind === OWNER_FALLBACK_KIND && produced.exactText === OWNER_FALLBACK_MESSAGE && produced.providerReceipt.provider === "deterministic-owner-fallback";

test("setting on, after the second failed repair: the inquiry, adult-seat and precious-opportunity routes never send the stored question; the safety route sends it only when it can be sent", async () => {
  const fixed = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, config: on })();
  assert.equal(isFallback(fixed), true);
  for (const activeStep of [INQUIRY, ADULT_SEAT, PRECIOUS]) {
    for (const nextQuestion of [QUESTION, "", undefined, "Tell me more"]) {
      assert.deepEqual(await discriminatorRuntime({ activeStep, nextQuestion, config: on })(), fixed, `${activeStep} ${JSON.stringify(nextQuestion)}: the same result on every route`);
    }
  }
  for (const nextQuestion of ["", undefined, "   ", "Tell me more", "First part? Second part?", "First line?\nSecond line", `${"x".repeat(1_001)}?`]) {
    assert.deepEqual(await discriminatorRuntime({ activeStep: SAFETY, nextQuestion, config: on })(), fixed, `safety ${String(JSON.stringify(nextQuestion)).slice(0, 40)}`);
  }
  const stored = await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: QUESTION, config: on })();
  assert.equal(stored.exactText, QUESTION);
  assert.equal(Object.hasOwn(stored, "kind"), false);
  assert.equal(stored.providerReceipt.provider, "deterministic-current-episode");
});

test("setting on: any route outside the list is unchanged, and the route is read from the active step first, then the episode route", async () => {
  for (const activeStep of [CALM, OTHER, null]) {
    const produced = await discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: QUESTION, config: on })();
    assert.equal(produced.exactText, QUESTION, String(activeStep));
    assert.equal(Object.hasOwn(produced, "kind"), false, String(activeStep));
    await assert.rejects(discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: "", config: on }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), String(activeStep));
  }
  await assert.rejects(discriminatorRuntime({ activeStep: undefined, route: undefined, nextQuestion: "", config: on }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), "a case with no episode");
  for (const [activeStep, route, expected] of [
    [PRECIOUS, OTHER, true], [ADULT_SEAT, CALM, true], [null, PRECIOUS, true], [null, ADULT_SEAT, true], [undefined, INQUIRY, true],
    [CALM, PRECIOUS, false], [OTHER, ADULT_SEAT, false], [CALM, INQUIRY, false]
  ]) {
    assert.equal(isFallback(await discriminatorRuntime({ activeStep, route, nextQuestion: QUESTION, config: on })()), expected, `${activeStep} / ${route}`);
  }
});

test("setting on, role or belief hold: the fixed message on each of the four routes, whatever the stored question; the same hold on any other route still blocks", async () => {
  const fixed = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, config: on })();
  for (const activeStep of OWNER_FALLBACK_ROUTE_IDS) {
    for (const nextQuestion of [QUESTION, "", undefined]) {
      assert.deepEqual(await discriminatorRuntime({ activeStep, nextQuestion, findings: hold, config: on })(), fixed, `${activeStep} ${JSON.stringify(nextQuestion)}`);
    }
  }
  for (const activeStep of [CALM, OTHER, null]) {
    await assert.rejects(discriminatorRuntime({ activeStep, route: activeStep ?? CALM, nextQuestion: QUESTION, findings: hold, config: on }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), String(activeStep));
  }
  await assert.rejects(discriminatorRuntime({ activeStep: undefined, route: undefined, nextQuestion: QUESTION, findings: hold, config: on }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), "a case with no episode");
});

test("setting on: every blocking role or belief code, at substantive and at high severity, is replaced by the fixed message on the four routes, and a finding that does not block still does not", async () => {
  const fixed = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, config: on })();
  assert.ok(ROLE_BELIEF_BLOCKING_CODES.length > 0);
  for (const code of ROLE_BELIEF_BLOCKING_CODES) {
    for (const severity of ["substantive", "high"]) {
      for (const unresolved of [true, undefined]) {
        const findings = [{ id: "synthetic", code, severity, ...(unresolved === undefined ? {} : { unresolved }), summary: "Synthetic." }];
        for (const activeStep of OWNER_FALLBACK_ROUTE_IDS) assert.deepEqual(await discriminatorRuntime({ activeStep, nextQuestion: QUESTION, findings, config: on })(), fixed, `${code} ${severity} ${activeStep}`);
        await assert.rejects(discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, findings, config: on }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), `${code} ${severity} calm`);
      }
    }
  }
  // Findings that do not block are treated as no finding: the safety route sends its sendable question, and the others take the fallback only for the route.
  const quiet = [[{ ...ROLE_BELIEF_FINDING, unresolved: false }], [{ ...ROLE_BELIEF_FINDING, severity: "medium" }], [{ ...ROLE_BELIEF_FINDING, severity: "low" }], [BLOCKING_FINDING], [{ ...ROLE_BELIEF_FINDING, code: "UNRELATED_UNCERTAINTY" }]];
  for (const findings of quiet) {
    assert.equal((await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: QUESTION, findings, config: on })()).exactText, QUESTION);
    assert.equal((await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, findings, config: on })()).exactText, QUESTION);
    assert.equal(isFallback(await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, findings, config: on })()), true);
  }
});

test("setting off (or a config that does not carry it): every route takes main's path, a stored question or PRIVATE_DISCRIMINATOR_UNAVAILABLE, and a hold is PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED", async () => {
  for (const config of [off, {}, { ownerFallbackEnabled: "true" }, { ownerFallbackEnabled: 1 }, { ownerFallbackEnabled: undefined }]) {
    const label = JSON.stringify(config);
    const ordinary = await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, config })();
    assert.equal(ordinary.providerReceipt.provider, "deterministic-current-episode", label);
    for (const activeStep of OWNER_FALLBACK_ROUTE_IDS) {
      assert.deepEqual(await discriminatorRuntime({ activeStep, nextQuestion: QUESTION, config })(), ordinary, `${label} ${activeStep}`);
      for (const nextQuestion of ["", undefined, "   "]) {
        await assert.rejects(discriminatorRuntime({ activeStep, nextQuestion, config }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), `${label} ${activeStep} ${JSON.stringify(nextQuestion)}`);
      }
      for (const nextQuestion of [QUESTION, "", undefined]) {
        await assert.rejects(discriminatorRuntime({ activeStep, nextQuestion, findings: hold, config }), unavailable("PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED"), `${label} ${activeStep} hold`);
      }
    }
  }
});

// ---- Through the whole audit loop, setting on -------------------------------------------------------------------------------

test("setting on, after the second failed repair: each of the four routes delivers the fixed message as its own kind, and the next message is accepted", async (t) => {
  for (const spec of ROUTES) {
    const runtime = await openRoute(t, spec, { auditFindings: firstTurnOnly([BLOCKING_FINDING]), ownerFallback: true });
    const result = await runtime.run(1);
    assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND, spec.name);
    assert.equal(result.answer, OWNER_FALLBACK_MESSAGE, spec.name);
    assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2], `${spec.name}: the audit and both repairs ran first`);

    const record = await runtime.load();
    const episode = record.case_state.current_episode;
    assert.equal(episode.active_step, spec.route, `${spec.name}: the route under test`);
    const [turn] = record.runtime_turns;
    assert.deepEqual([turn.state, turn.discriminator.kind, turn.delivery.kind], ["DELIVERED", OWNER_FALLBACK_KIND, OWNER_FALLBACK_KIND], spec.name);
    assert.deepEqual([turn.discriminator.exact_text, turn.delivery.exact_text], [OWNER_FALLBACK_MESSAGE, OWNER_FALLBACK_MESSAGE], spec.name);
    assert.deepEqual(record.raw_transcript.map((entry) => [entry.role, entry.text]), [["user", "Synthetic message 1."], ["assistant", OWNER_FALLBACK_MESSAGE]], spec.name);
    assert.deepEqual(record.candidate_responses.map((candidate) => candidate.status), ["superseded", "superseded", "superseded"], `${spec.name}: no candidate was sent`);
    assert.equal(record.candidate_responses.at(-1).metadata.superseded_by_owner_fallback_runtime_turn_id, turn.id, spec.name);
    assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(turn)), spec.name);
    if (spec.route !== SAFETY) {
      assert.equal(isDeliverableDiscriminatorQuestion(episode.next_question), true, `${spec.name}: a sendable stored question existed, and was not sent`);
      assert.notEqual(result.answer, episode.next_question, spec.name);
    }
    const outbound = projectCommunicationState(record);
    const delivered = outbound.confirmed_or_reported_client_outbound.filter((entry) => entry.assistant_turn_id === "risk-1-assistant");
    assert.deepEqual([delivered.length, delivered[0]?.source.route], [1, "runtime_owner_fallback"], `${spec.name}: recorded as the fallback`);
    assert.deepEqual(outbound.unresolved_delivery, [], spec.name);

    const next = await runtime.run(2);
    assert.equal(next.deliveryKind, "candidate", `${spec.name}: the next message is accepted`);
    assert.deepEqual((await runtime.load()).runtime_turns.map((entry) => entry.state), ["DELIVERED", "DELIVERED"], spec.name);
  }
});

test("setting on, role or belief hold: each of the four routes delivers the fixed message instead of leaving the turn unfinished, and the next message is accepted", async (t) => {
  for (const spec of ROUTES) {
    const runtime = await openRoute(t, spec, { auditFindings: firstTurnOnly([ROLE_BELIEF_FINDING]), ownerFallback: true });
    const result = await runtime.run(1);
    assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND, spec.name);
    assert.equal(result.answer, OWNER_FALLBACK_MESSAGE, spec.name);
    assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2], `${spec.name}: the audit loop is the same`);

    const record = await runtime.load();
    assert.equal(record.case_state.current_episode.active_step, spec.route, spec.name);
    const [turn] = record.runtime_turns;
    assert.deepEqual([turn.state, turn.discriminator.kind, turn.delivery.kind], ["DELIVERED", OWNER_FALLBACK_KIND, OWNER_FALLBACK_KIND], spec.name);
    assert.equal(record.candidate_responses.at(-1).audit_history.at(-1).findings.some((finding) => finding.code === ROLE_BELIEF_FINDING.code), true, `${spec.name}: the finding stays in the record`);
    assert.deepEqual(record.raw_transcript.map((entry) => [entry.role, entry.text]), [["user", "Synthetic message 1."], ["assistant", OWNER_FALLBACK_MESSAGE]], `${spec.name}: only the fixed message was sent`);
    assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(turn)), spec.name);
    const delivered = projectCommunicationState(record).confirmed_or_reported_client_outbound.filter((entry) => entry.assistant_turn_id === "risk-1-assistant");
    assert.deepEqual([delivered.length, delivered[0]?.source.route], [1, "runtime_owner_fallback"], `${spec.name}: recorded as the fallback`);

    const next = await runtime.run(2);
    assert.equal(next.deliveryKind, "candidate", `${spec.name}: not refused PRIVATE_RUNTIME_CASE_BUSY`);
    assert.deepEqual((await runtime.load()).runtime_turns.map((entry) => entry.state), ["DELIVERED", "DELIVERED"], spec.name);
  }
});

test("setting on, role or belief hold on a route outside the list: the turn still stops, nothing is delivered, and the next message is refused as before", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["absent", "absent"], auditFindings: firstTurnOnly([ROLE_BELIEF_FINDING]), ownerFallback: true });
  await assert.rejects(() => runtime.run(1), (error) => error?.code === "THERAPY_RUNTIME_UNAVAILABLE" && error.details?.stage === "discriminator");
  const record = await runtime.load();
  assert.equal(OWNER_FALLBACK_ROUTE_IDS.includes(record.case_state.current_episode.active_step), false);
  assert.deepEqual([record.runtime_turns[0].state, record.runtime_turns[0].discriminator, record.runtime_turns[0].delivery], ["DISCRIMINATING_QUESTION_REQUIRED", null, null]);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"]);
  assert.equal(everythingIn(record).includes(OWNER_FALLBACK_KIND), false);
  await assert.rejects(() => runtime.run(2), unavailable("PRIVATE_RUNTIME_CASE_BUSY"));
});

test("setting on: an approved candidate is never replaced on any of the four routes, including one approved after both repairs", async (t) => {
  for (const spec of ROUTES) {
    const direct = await openRoute(t, spec, { later: [], ownerFallback: true });
    const first = await direct.run(1);
    assert.equal(first.deliveryKind, "candidate", spec.name);
    assert.notEqual(first.answer, OWNER_FALLBACK_MESSAGE, spec.name);
    assert.equal(first.runtimeTurn.discriminator, null, spec.name);
    assert.deepEqual([direct.counts.private_candidate_audit, direct.counts.private_candidate_repair ?? 0], [1, 0], spec.name);
    assert.equal((await direct.load()).case_state.current_episode.active_step, spec.route, spec.name);

    for (const finding of [BLOCKING_FINDING, ROLE_BELIEF_FINDING]) {
      const repaired = await openRoute(t, { ...spec, name: `${spec.name}-repaired-${finding.code.toLowerCase().replaceAll("_", "-")}` }, { later: [], auditFindings: ({ auditNumber }) => (auditNumber < 3 ? [finding] : []), ownerFallback: true });
      const result = await repaired.run(1);
      assert.equal(result.deliveryKind, "candidate", `${spec.name} ${finding.code}`);
      assert.notEqual(result.answer, OWNER_FALLBACK_MESSAGE, `${spec.name} ${finding.code}`);
      assert.equal(result.runtimeTurn.discriminator, null, `${spec.name} ${finding.code}`);
      assert.deepEqual([repaired.counts.private_candidate_audit, repaired.counts.private_candidate_repair], [3, 2], `${spec.name} ${finding.code}: it passed the third audit`);
      assert.equal(everythingIn(await repaired.load()).includes(OWNER_FALLBACK_KIND), false, `${spec.name} ${finding.code}`);
    }
  }
});

// ---- Through the whole audit loop, setting off: as on main ------------------------------------------------------------------

test("setting off, after the second failed repair: the stored question on the inquiry, adult-seat and precious-opportunity routes, nothing on the safety route, and no fallback anywhere", async (t) => {
  for (const spec of ROUTES) {
    const runtime = await openRoute(t, spec, { auditFindings: firstTurnOnly([BLOCKING_FINDING]) });
    if (spec.route === SAFETY) {
      await assert.rejects(() => runtime.run(1), (error) => error?.code === "THERAPY_RUNTIME_UNAVAILABLE" && error.details?.stage === "discriminator");
      const record = await runtime.load();
      assert.deepEqual([record.runtime_turns[0].state, record.runtime_turns[0].discriminator, record.runtime_turns[0].delivery], ["DISCRIMINATING_QUESTION_REQUIRED", null, null], spec.name);
      assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"], `${spec.name}: nothing was delivered`);
      assert.equal(everythingIn(record).includes(OWNER_FALLBACK_KIND), false, spec.name);
      continue;
    }
    const result = await runtime.run(1);
    const record = await runtime.load();
    const episode = record.case_state.current_episode;
    assert.equal(episode.active_step, spec.route, spec.name);
    assert.equal(result.deliveryKind, "discriminator", spec.name);
    assert.equal(result.answer, episode.next_question, spec.name);
    assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2], spec.name);
    assert.equal(Object.hasOwn(record.runtime_turns[0].discriminator, "kind"), false, spec.name);
    assert.equal(everythingIn(record).includes(OWNER_FALLBACK_KIND), false, spec.name);
    assert.equal(everythingIn(record).includes("runtime_owner_fallback"), false, spec.name);
    assert.equal(record.raw_transcript.some((entry) => entry.text === OWNER_FALLBACK_MESSAGE), false, spec.name);
  }
});

test("setting off, role or belief hold: every route ends unavailable with the turn unfinished, and the next message is refused PRIVATE_RUNTIME_CASE_BUSY, as on main", async (t) => {
  for (const spec of [...ROUTES, { name: "calm", route: null, reading: "absent" }]) {
    const runtime = await openRoute(t, spec, { auditFindings: firstTurnOnly([ROLE_BELIEF_FINDING]) });
    await assert.rejects(() => runtime.run(1), (error) => error?.code === "THERAPY_RUNTIME_UNAVAILABLE" && error.details?.stage === "discriminator", spec.name);
    const record = await runtime.load();
    assert.deepEqual([record.runtime_turns[0].state, record.runtime_turns[0].discriminator, record.runtime_turns[0].delivery], ["DISCRIMINATING_QUESTION_REQUIRED", null, null], spec.name);
    assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"], `${spec.name}: nothing was delivered`);
    assert.equal(everythingIn(record).includes(OWNER_FALLBACK_KIND), false, spec.name);
    await assert.rejects(() => runtime.run(2), unavailable("PRIVATE_RUNTIME_CASE_BUSY"), spec.name);
  }
});
