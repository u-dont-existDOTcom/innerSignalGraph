import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  decoratePlanWithFocusDiscipline,
  FOCUS_LIMITS,
  partitionUnknownsByFocus,
  prepareFocusDiscipline,
  validateFocusState
} from "../src/case-formulation/focus-discipline.mjs";
import { validateCaseAudit, validateCaseSnapshot } from "../src/case-formulation/validators.mjs";
import { applyCaseStatePatch, createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState, validateCaseState } from "../src/case-state/longitudinal-state.mjs";
import { focusDisciplineAuditRules, focusDisciplineExtractionRules, focusDisciplineRules } from "../src/prompts/focus-discipline.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { THERAPY_PROTOCOL_FILES, loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";

const focus = (strength, extra = {}) => ({ target: "keep one small promise", strength, natural_pause: false, client_diversion: "none", diversion_topic: "", ...extra });
const side = (variable, importance = 3) => ({ variable, question: `${variable}?`, importance, focus_relation: "side", why_it_matters: `${variable} may matter later` });
const basePlan = (extra = {}) => ({ variables: { present_safety: "safe" }, primaryJob: { id: "IC.BORROW_ONE_FUNCTION" }, nextQuestion: "", questionContract: { mode: "none", question: "" }, ...extra });

test("historical snapshots without focus fields keep their previous planning behavior", () => {
  const unknowns = [{ variable: "a", question: "A?", importance: 5 }, { variable: "b", question: "B?", importance: 4 }];
  const prepared = prepareFocusDiscipline({ unknowns });
  assert.equal(prepared.engaged, false);
  assert.equal(prepared.frontalUnknowns, unknowns);
  const plan = basePlan();
  const decorated = decoratePlanWithFocusDiscipline(plan, prepared);
  assert.equal(decorated.plan, plan);
  assert.equal(decorated.state, null);
  assert.deepEqual(partitionUnknownsByFocus(unknowns).side, []);
});

test("load-bearing questions stay frontal and side questions are parked with their reason", () => {
  const prepared = prepareFocusDiscipline({ sessionFocus: focus("moderate"), unknowns: [
    { variable: "sleep", question: "Sleep?", importance: 4, focus_relation: "load_bearing", why_it_matters: "explains the collapse" },
    side("holiday", 5)
  ] });
  assert.deepEqual(prepared.frontalUnknowns.map((item) => item.variable), ["sleep"]);
  assert.equal(prepared.state.threads.length, 1);
  assert.equal(prepared.state.threads[0].why_it_matters, "holiday may matter later");
  assert.equal(prepared.state.threads[0].status, "parked");
});

test("a parked question keyed to a case variable resolves once that variable is answered", () => {
  const first = prepareFocusDiscipline({ sessionFocus: focus("moderate"), unknowns: [side("support_available")] });
  const second = prepareFocusDiscipline({ prior: first.state, sessionFocus: focus("moderate"), unknowns: [], variables: { support_available: "present" } });
  assert.equal(second.state.threads[0].status, "resolved");
  assert.equal(second.state.threads[0].close_reason, "answered");
});

test("urgent context holds side questions; the hold never becomes a safety bypass", () => {
  let state = prepareFocusDiscipline({ sessionFocus: focus("moderate"), unknowns: [side("sister", 5)] }).state;
  const next = (plan, sessionFocus) => {
    const prepared = prepareFocusDiscipline({ prior: state, sessionFocus, unknowns: [] });
    return decoratePlanWithFocusDiscipline(plan, prepared).plan.focusContract;
  };
  assert.equal(next(basePlan({ variables: { present_safety: "unsafe" } }), focus("light", { client_diversion: "tangent" })).hold, "immediate_protection");
  assert.equal(next(basePlan({ variables: { suicidal_state: "imminent" } }), focus("light")).hold, "immediate_protection");
  assert.equal(next(basePlan({ threatPathway: { level: "ESCALATING_MOBILIZING_RISK" } }), focus("light")).hold, "threat_pathway");
  assert.equal(next(basePlan({ protectiveCompatibility: { gate: "HOLD" } }), focus("light")).hold, "protective_compatibility");
  assert.equal(next(basePlan({ primaryJob: { id: "ROUTE.LEAVE_ALONE" } }), focus("light")).hold, "leave_alone");
  const safety = next(basePlan({ variables: { present_safety: "unsafe" } }), focus("light", { client_diversion: "tangent" }));
  assert.equal(safety.redirect, null);
  assert.equal(safety.surface, null);
  assert.equal(next(basePlan(), focus("light")).surface.mode, "question");
});

test("a light focus does not override a real canonical question, a closing task, or a declined task", () => {
  const state = prepareFocusDiscipline({ sessionFocus: focus("moderate"), unknowns: [side("sister", 5)] }).state;
  const decorate = (plan) => decoratePlanWithFocusDiscipline(plan, prepareFocusDiscipline({ prior: state, sessionFocus: focus("light"), unknowns: [] })).plan;
  const canonical = decorate(basePlan({ nextQuestion: "Main?", questionContract: { mode: "canonical", question: "Main?" }, nextQuestionSource: { type: "graph-node", id: "X" } }));
  assert.equal(canonical.nextQuestion, "Main?");
  assert.equal(canonical.focusContract.surface.mode, "mention");
  for (const task of [{ phase: "close" }, { phase: "practice", agreement: "declined" }, { phase: "practice", question_focus: "none" }]) {
    const plan = decorate(basePlan({ executionContract: { task } }));
    assert.equal(plan.nextQuestion, "");
    assert.equal(plan.focusContract.surface.mode, "mention");
  }
  const generic = decorate(basePlan({ nextQuestion: "Generic?", questionContract: { mode: "canonical", question: "Generic?" }, nextQuestionSource: { type: "path-performance", episode: null } }));
  assert.equal(generic.nextQuestion, "sister?");
});

test("the parked-thread memory is bounded and validated", () => {
  let state = null;
  for (let turn = 1; turn <= 15; turn += 1) {
    state = prepareFocusDiscipline({ prior: state, sessionFocus: focus("high"), unknowns: [side(`topic_${turn}`, turn % 5 === 0 ? 5 : 1)] }).state;
    assert.ok(state.threads.filter((thread) => thread.status === "parked").length <= FOCUS_LIMITS.hardActive);
  }
  assert.ok(state.threads.filter((thread) => thread.status === "parked" && thread.importance === 5).length === 3);
  const overfull = structuredClone(state);
  overfull.threads = overfull.threads.map((thread) => ({ ...thread, status: "parked" }));
  assert.throws(() => validateFocusState(overfull), /parked-thread bound/);
  assert.throws(() => validateFocusState({ ...state, threads: [{ ...state.threads[0], status: "forgotten" }] }), /status is invalid/);
});

test("snapshot, audit, and durable case-state contracts accept focus fields and reject invalid ones", async () => {
  const baseline = JSON.parse(await fs.readFile(new URL("../fixtures/mock-responses/A001.json", import.meta.url), "utf8")).anthropic.case_extraction;
  const snapshot = structuredClone(baseline);
  snapshot.unknowns = [side("sister")];
  snapshot.session_focus = focus("moderate");
  assert.doesNotThrow(() => validateCaseSnapshot(structuredClone(snapshot)));
  assert.throws(() => validateCaseSnapshot({ ...structuredClone(snapshot), unknowns: [{ ...side("x"), focus_relation: "tangential" }] }), /focus_relation/);
  assert.throws(() => validateCaseSnapshot({ ...structuredClone(snapshot), session_focus: focus("urgent") }), /strength/);
  const audit = { corrected_turn_task: null, invalidate_turn_task: false, remove_observation_ids: [], remove_hypothesis_ids: [], variable_corrections: [],
    add_unknowns: [], safety_flags: [], verdict: "accept", summary: "ok", corrected_session_focus: null,
    focus_reclassifications: [{ variable: "x", focus_relation: "side", why_it_matters: "later", reason: "no change to next step" }] };
  assert.doesNotThrow(() => validateCaseAudit(structuredClone(audit)));
  assert.throws(() => validateCaseAudit({ ...audit, focus_reclassifications: [{ variable: "x", focus_relation: "maybe", why_it_matters: "", reason: "" }] }), /focus_relation/);

  const empty = createEmptyCaseState({ caseId: "synthetic" });
  assert.equal(Object.hasOwn(empty, "focus_discipline"), false);
  const prepared = prepareFocusDiscipline({ sessionFocus: focus("moderate"), unknowns: [side("sister")] });
  const merged = mergeRuntimeSnapshotIntoCaseState(empty, { ...structuredClone(snapshot), focus_discipline: prepared.state }, { turnId: "t1", recordedAt: "2026-09-26T00:00:00.000Z" });
  assert.deepEqual(merged.focus_discipline, prepared.state);
  assert.deepEqual(applyCaseStatePatch(merged, {}).focus_discipline, prepared.state);
  assert.doesNotThrow(() => validateCaseState(structuredClone(empty)));
});

test("focus rules reach each reasoning consumer exactly once and gate the protective-function probe", () => {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], userMessage: "A synthetic report.", recentTranscript: "" };
  for (const prompt of [caseExtractionPrompt(context), caseAuditPrompt(context, {}), candidatePrompt(context, "synthetic"),
    realizationPrompt(context, {}, "synthetic"), privateRuntimeAuditPrompt({}), privateRuntimeRepairPrompt({})]) {
    assert.equal(prompt.system.split(focusDisciplineRules).length - 1, 1);
  }
  assert.equal(caseExtractionPrompt(context).system.split(focusDisciplineExtractionRules).length - 1, 1);
  assert.equal(caseAuditPrompt(context, {}).system.split(focusDisciplineAuditRules).length - 1, 1);
  assert.match(realizationPrompt(context, {}, "synthetic").system, /28\. focusContract/);
  // Root cause: the shared rules used to require testing a symptom's protective function unconditionally.
  assert.equal(longitudinalClinicalRules.includes("while still treating it as a hypothesis. Test it concretely:"), false);
  assert.match(longitudinalClinicalRules, /It is not automatically the agenda\. When confirming or disconfirming it could change what is done next for the current focus, test it concretely/);
  assert.match(longitudinalClinicalRules, /otherwise park that question rather than investigating the symptom's function merely because it is available/);
});

test("the plugin and MCP-served protocol carry the focus rules and every always-read reference", async () => {
  const base = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/", import.meta.url);
  const skill = await fs.readFile(new URL("SKILL.md", base), "utf8");
  const reference = await fs.readFile(new URL("references/FOCUS-DISCIPLINE.md", base), "utf8");
  assert.ok(reference.endsWith(focusDisciplineRules));
  const readLine = skill.split("\n").find((line) => line.startsWith("Read `references/") && line.endsWith("before responding."));
  const alwaysRead = [...readLine.matchAll(/`(references\/[A-Z0-9-]+\.md)`/g)].map((match) => match[1]);
  assert.ok(alwaysRead.includes("references/FOCUS-DISCIPLINE.md"));
  assert.ok(alwaysRead.includes("references/ROLE-BELIEF-INTEGRITY.md"));
  for (const relative of alwaysRead) assert.ok(THERAPY_PROTOCOL_FILES.includes(relative), `${relative} is served over MCP`);
  const served = loadTherapyProtocol().files.find((file) => file.path === "references/FOCUS-DISCIPLINE.md");
  assert.equal(served.content, reference);
});
