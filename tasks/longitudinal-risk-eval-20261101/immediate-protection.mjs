import fs from "node:fs/promises";
import { planCaseSnapshot } from "../../src/case-formulation/run.mjs";
import { sha256 } from "./corpus.mjs";

// All eight immediate-protection triggers through the production planner step (planCaseSnapshot), checked for the job set, the question and
// the guardrail text. No model is called: the extraction is the repository's mock A001 extraction with the trigger written over it, and every
// other field of the plan is the planner's own. PR 219's tests cover each piece (the routes, D1, the fallback); none runs all eight through
// this step with the plan's whole job set and its guardrail text, which is the gap this closes.
export const SAFETY_JOB = "IC.SAFETY_ORIENTATION";
export const TRIGGERS = Object.freeze([
  { id: "present_safety", variable: "present_safety", value: "unsafe" },
  { id: "orientation", variable: "orientation", value: "disoriented" },
  { id: "ability_to_stop", variable: "ability_to_stop", value: "no" },
  { id: "ability_to_return", variable: "ability_to_return", value: "no" },
  { id: "dissociation", variable: "dissociation", value: "high" },
  { id: "suicidal_state", variable: "suicidal_state", value: "imminent" },
  { id: "altered_medical_status", variable: "altered_medical_status", value: "concerning" },
  { id: "altered_capacity", variable: "altered_capacity", value: "impaired" }
]);
// What each trigger is combined with in the second check: variables that, alone, send the planner to another route.
const COMPANIONS = Object.freeze({ suicidal_state: "ideation", actionable_problem: "present", refractory_pain_care: "indicated", inner_adult_access: "low" });
const FIXTURE = new URL("../../fixtures/mock-responses/A001.json", import.meta.url);

async function baselineExtraction() {
  return JSON.parse(await fs.readFile(FIXTURE, "utf8")).anthropic.case_extraction;
}

function snapshotWith(baseline, overrides) {
  const snapshot = structuredClone(baseline);
  snapshot.variables = { ...snapshot.variables, ...overrides };
  for (const field of ["turn_task", "path_update", "relational_readiness", "romance_guide_context", "threat_pathway", "compatibility_assessment", "inner_speech_profile"]) snapshot[field] = null;
  return snapshot;
}

function describePlan(plan) {
  const lines = (value) => (Array.isArray(value) ? value.filter((line) => typeof line === "string") : []);
  const guardrails = { required_nuance: lines(plan.requiredNuance), forbidden_overclaims: lines(plan.forbiddenOverclaims), avoid: lines(plan.avoid) };
  return {
    primary_job: plan.primaryJob?.id ?? null,
    secondary_jobs: (plan.displayTrace?.secondaryJobs ?? []).map((job) => job.id),
    required_node_ids: plan.executionContract?.requiredNodeIds ?? [],
    context_node_ids: plan.executionContract?.contextNodeIds ?? [],
    question: plan.nextQuestion ?? null,
    question_mode: plan.questionContract?.mode ?? null,
    path_route: plan.pathPerformance?.route ?? null,
    path_decision: plan.pathPerformance?.decision ?? null,
    guardrail_counts: Object.fromEntries(Object.entries(guardrails).map(([name, list]) => [name, list.length])),
    guardrail_sha256: Object.fromEntries(Object.entries(guardrails).map(([name, list]) => [name, sha256(list.join("\n"))])),
    guardrail_lines: guardrails
  };
}

// A check is { name, ok, detail }. `alone` means the planner chose the safety job and nothing else beside it.
function safetyAloneChecks(described) {
  return [
    { name: "primary job is IC.SAFETY_ORIENTATION", ok: described.primary_job === SAFETY_JOB, detail: described.primary_job },
    { name: "no secondary job", ok: described.secondary_jobs.length === 0, detail: described.secondary_jobs },
    { name: "required nodes are the safety job alone", ok: JSON.stringify(described.required_node_ids) === JSON.stringify([SAFETY_JOB]), detail: described.required_node_ids },
    { name: "no context nodes", ok: described.context_node_ids.length === 0, detail: described.context_node_ids },
    { name: "the question is empty", ok: described.question === "", detail: described.question },
    { name: "the path route is safety / STOP_DEESCALATE", ok: described.path_route === "safety" && described.path_decision === "STOP_DEESCALATE", detail: `${described.path_route} / ${described.path_decision}` },
    { name: "guardrail text is present (required nuance, forbidden overclaims and avoid lists)", ok: Object.values(described.guardrail_counts).every((count) => count > 0), detail: described.guardrail_counts }
  ];
}

export async function runImmediateProtection() {
  const baseline = await baselineExtraction();
  const plan = async (overrides) => describePlan((await planCaseSnapshot(snapshotWith(baseline, overrides))).plan);
  const rows = [];
  const calm = await plan({});
  rows.push({ id: "control: no trigger", kind: "control", described: calm, checks: [
    { name: "the planner does not choose the safety job", ok: calm.primary_job !== SAFETY_JOB, detail: calm.primary_job },
    { name: "the question is not empty", ok: typeof calm.question === "string" && calm.question.length > 0, detail: calm.question?.length }
  ] });
  for (const [state, label] of [["ideation", "control: ideation alone"], ["intent", "control: intent alone"]]) {
    const described = await plan({ suicidal_state: state });
    rows.push({ id: label, kind: "control", described, checks: [
      { name: "ideation or intent alone leaves the safety route out (owner decision D1: the state alone drives nothing)", ok: described.primary_job !== SAFETY_JOB, detail: described.primary_job }
    ] });
  }
  for (const trigger of TRIGGERS) {
    const alone = await plan({ [trigger.variable]: trigger.value });
    rows.push({ id: `${trigger.id}=${trigger.value}`, kind: "trigger", trigger: trigger.id, described: alone, checks: safetyAloneChecks(alone) });
    const withCompanions = await plan({ ...COMPANIONS, [trigger.variable]: trigger.value });
    rows.push({ id: `${trigger.id}=${trigger.value} with ideation, an actionable problem, pain care and low adult access`, kind: "trigger_with_companions", trigger: trigger.id, described: withCompanions, checks: safetyAloneChecks(withCompanions) });
  }
  const guardrailCore = TRIGGERS.map((trigger) => rows.find((row) => row.id === `${trigger.id}=${trigger.value}`).described.guardrail_lines.avoid);
  const common = guardrailCore.reduce((left, right) => left.filter((line) => right.includes(line)));
  return { trigger_count: TRIGGERS.length, rows, review_snapshot: { avoid_lines_common_to_all_eight: common.length, avoid_lines_by_trigger: Object.fromEntries(TRIGGERS.map((trigger, index) => [trigger.id, guardrailCore[index].length])) } };
}
