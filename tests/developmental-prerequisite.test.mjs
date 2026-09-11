import test from "node:test";
import assert from "node:assert/strict";

import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import {
  DEVELOPMENTAL_PREREQUISITE_VIOLATION,
  DEVELOPMENTAL_BREAKDOWN_QUESTION,
  DEVELOPMENTAL_SUCCESS_QUESTION,
  applyDevelopmentalCapacityToVariables,
  decoratePlanWithDevelopmentalCapacity,
  developmentalCapacityDecision,
  validateDevelopmentalCapacity
} from "../src/case-formulation/developmental-capacity.mjs";
import { validateCaseAudit, validateCaseSnapshot } from "../src/case-formulation/validators.mjs";
import { applyCaseAudit } from "../src/case-formulation/run.mjs";
import { caseAuditGenerationSchema, caseSnapshotGenerationSchema } from "../src/case-formulation/schemas.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import {
  createEmptyCaseState,
  mergeRuntimeSnapshotIntoCaseState,
  projectCaseStateForInspection
} from "../src/case-state/longitudinal-state.mjs";

function observation(id, evidence) {
  return { id, statement: evidence, evidence };
}

function capacity(overrides = {}) {
  return {
    issue: "Difficulty sustaining self-care under distress.",
    language_mode: "FUNCTIONAL",
    status: "UNKNOWN",
    access: "UNKNOWN",
    reliability: "UNKNOWN",
    younger_state_trust: "UNKNOWN",
    observation_ids: [],
    practice: null,
    contrast: null,
    functions: [],
    ...overrides
  };
}

function practice(overrides = {}) {
  return {
    approaches: ["REPARENTING", "SELF_LOVE"],
    helpfulness: "HELPS_SOMETIMES",
    consistency: "DIFFICULT_OR_INCONSISTENT",
    observation_ids: ["obs-practice"],
    ...overrides
  };
}

function functionState(kind, access, observationIds = ["obs-function"]) {
  return { kind, access, observation_ids: observationIds };
}

function pairCapacity(overrides = {}) {
  return capacity({
    status: "PARTIAL_INTERMITTENT_STATE_DEPENDENT",
    access: "PARTIAL",
    reliability: "STATE_DEPENDENT",
    younger_state_trust: "LOW",
    observation_ids: ["obs-practice", "obs-function"],
    practice: practice(),
    contrast: {
      successful_exception: "UNRESOLVED",
      breakdown_state: "UNRESOLVED",
      pair_tolerated: "YES",
      preferred_order: "SUCCESS_FIRST",
      observation_ids: ["obs-practice"]
    },
    functions: [functionState("STAYING_PRESENT", "PARTIAL")],
    ...overrides
  });
}

function ordinaryPlan(overrides = {}) {
  return {
    contractVersion: "case-plan-v5",
    primaryJob: { id: "IC.DEVELOPMENTAL_CAPACITY_CONTRAST", title: "Establish caregiving capacity", tier: 2 },
    nextQuestion: "A stale one-question fallback?",
    nextQuestionSource: { type: "case-unknown", variable: "stale" },
    questionContract: { mode: "canonical", question: "A stale one-question fallback?", source: { type: "case-unknown", variable: "stale" } },
    executionContract: {
      version: 1,
      requiredNodeIds: ["IC.DEVELOPMENTAL_CAPACITY_CONTRAST"],
      contextNodeIds: [],
      task: null,
      taskGuidance: [],
      reason: "Synthetic developmental plan."
    },
    requiredNuance: [],
    forbiddenOverclaims: [],
    avoid: [],
    ...overrides
  };
}

function baseSnapshot(developmentalCapacity = capacity()) {
  return {
    user_goal: "Build reliable self-care rather than assume it already exists.",
    current_issue: developmentalCapacity.issue,
    turn_task: null,
    path_update: null,
    relational_readiness: null,
    romance_guide_context: null,
    threat_pathway: null,
    developmental_capacity: developmentalCapacity,
    direct_observations: [
      observation("obs-practice", "Reparenting and self-love help sometimes, but are difficult and inconsistent."),
      observation("obs-function", "When calm I can stay with myself a little, but under distress that disappears.")
    ],
    variables: blankCaseVariables(),
    hypotheses: [],
    unknowns: []
  };
}

function baseAudit(overrides = {}) {
  return {
    corrected_turn_task: null,
    invalidate_turn_task: false,
    invalidate_path_strategy: false,
    corrected_path_representation: null,
    invalidate_path_representation: false,
    corrected_relational_readiness: null,
    invalidate_relational_readiness: false,
    corrected_romance_guide_context: null,
    invalidate_romance_guide_context: false,
    corrected_threat_pathway: null,
    invalidate_threat_pathway: false,
    corrected_developmental_capacity: null,
    invalidate_developmental_capacity: false,
    question_eligibility_findings: [],
    remove_observation_ids: [],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "accept",
    summary: "Synthetic developmental audit.",
    ...overrides
  };
}

test("R-ADULT-01: prerequisite violations are explicit and an assumed Adult question is removed", () => {
  assert.ok(caseSnapshotGenerationSchema.required.includes("developmental_capacity"));
  assert.ok(caseAuditGenerationSchema.required.includes("question_eligibility_findings"));
  const snapshot = baseSnapshot(capacity());
  snapshot.unknowns = [{
    variable: "adult_action",
    question: "What should your Adult or Protector do now?",
    importance: 5,
    changes_next_action: true,
    developmental_prerequisite_valid: false
  }];
  assert.deepEqual(validateCaseSnapshot(structuredClone(snapshot)).unknowns, []);

  const audited = applyCaseAudit(snapshot, validateCaseAudit(baseAudit({
    invalidate_path_strategy: true,
    question_eligibility_findings: [{
      variable: "adult_action",
      code: DEVELOPMENTAL_PREREQUISITE_VIOLATION,
      presupposed_functions: ["GUIDING"],
      observation_ids: []
    }],
    verdict: "revise"
  })));
  assert.equal(audited.audit.question_eligibility_findings[0].code, DEVELOPMENTAL_PREREQUISITE_VIOLATION);
  assert.equal(audited.unknowns.some(item => item.variable === "adult_action"), false);
});

test("R-ADULT-02: stable established capacity permits direct role-specific action", () => {
  const state = capacity({
    status: "INCREASINGLY_RELIABLE_CREDIBLE",
    access: "AVAILABLE",
    reliability: "RELIABLE",
    younger_state_trust: "ESTABLISHED",
    observation_ids: ["obs-function"],
    functions: [functionState("PROTECTING", "AVAILABLE")]
  });
  validateDevelopmentalCapacity(state, { issue: state.issue, observationIds: new Set(["obs-function"]) });
  assert.equal(developmentalCapacityDecision(state).route, "ROLE_SPECIFIC_ACTION_ALLOWED");
});

test("R-ADULT-03: capacity that disappears under distress targets access and generalization", () => {
  const decision = developmentalCapacityDecision(pairCapacity({ practice: null }));
  assert.equal(decision.route, "STRENGTHEN_ACCESS_GENERALIZATION");
  assert.equal(decision.recommendedNodeId, "IC.ADULT_APPRENTICE");
});

test("R-ADULT-04: functional language remains valid without imposing literal parts", () => {
  const state = capacity({
    language_mode: "FUNCTIONAL",
    status: "AVAILABLE",
    access: "AVAILABLE",
    reliability: "RELIABLE",
    younger_state_trust: "UNTESTED",
    observation_ids: ["obs-function"],
    functions: [functionState("CARING", "AVAILABLE")]
  });
  const decision = developmentalCapacityDecision(state);
  assert.equal(decision.languageMode, "FUNCTIONAL");
  const prompt = realizationPrompt({ userMessage: "I do not use parts language.", recentTranscript: "", interventionContract: ordinaryPlan() }, { next_question: "" }, "Claude");
  assert.match(prompt.system, /functional role labels, not proof of literal internal entities/i);
});

test("R-ADULT-05: recent evidence prevents a generic capacity re-check", () => {
  const state = capacity({
    status: "AVAILABLE",
    access: "AVAILABLE",
    reliability: "RELIABLE",
    younger_state_trust: "UNTESTED",
    observation_ids: ["obs-function"],
    functions: [functionState("CARING", "AVAILABLE")]
  });
  const decision = developmentalCapacityDecision(state);
  assert.equal(decision.route, "ROLE_SPECIFIC_ACTION_ALLOWED");
  assert.equal(decision.requiresCapacityQuestion, false);
  const snapshot = baseSnapshot(state);
  const plan = ordinaryPlan({ nextQuestion: "", questionContract: { mode: "none", question: "", source: null } });
  const stored = mergeRuntimeSnapshotIntoCaseState(createEmptyCaseState({ caseId: "developmental-r05" }), snapshot, {
    turnId: "R05-T1",
    interventionContract: plan
  });
  const carried = mergeRuntimeSnapshotIntoCaseState(stored, { ...snapshot, developmental_capacity: null }, {
    turnId: "R05-T2",
    interventionContract: plan
  });
  assert.equal(projectCaseStateForInspection(carried).developmentalCapacity.status, "AVAILABLE");
});

test("R-ADULT-06: absent capacity permits a borrowed scaffold directed toward internal capacity", () => {
  const state = capacity({
    status: "ABSENT_OR_INACCESSIBLE",
    access: "ABSENT_OR_INACCESSIBLE",
    reliability: "ABSENT",
    younger_state_trust: "UNTESTED",
    observation_ids: ["obs-function"],
    functions: [functionState("STAYING_PRESENT", "ABSENT_OR_INACCESSIBLE")]
  });
  const decision = developmentalCapacityDecision(state);
  assert.equal(decision.route, "BOOTSTRAP_SCAFFOLD");
  assert.equal(decision.recommendedNodeId, "IC.BORROW_ONE_FUNCTION");
  assert.match(decision.guidance.join(" "), /temporary external modeling or scaffolding/i);
  assert.match(decision.guidance.join(" "), /internal capacity/i);
});

test("R-ADULT-07: credibility repair cannot precede established capacity", () => {
  const state = capacity({
    status: "ABSENT_OR_INACCESSIBLE",
    access: "ABSENT_OR_INACCESSIBLE",
    reliability: "ABSENT",
    younger_state_trust: "LOW",
    observation_ids: ["obs-function"],
    functions: [functionState("FOLLOWING_THROUGH", "ABSENT_OR_INACCESSIBLE")]
  });
  const decision = developmentalCapacityDecision(state);
  assert.equal(decision.route, "BOOTSTRAP_SCAFFOLD");
  assert.notEqual(decision.route, "CREDIBILITY_FOLLOW_THROUGH");
});

test("R-ADULT-08: operational safety keeps its question ahead of developmental inquiry", () => {
  const state = pairCapacity();
  const decision = developmentalCapacityDecision(state);
  const safety = ordinaryPlan({
    primaryJob: { id: "IC.SAFETY_ORIENTATION", title: "Immediate safety", tier: 1 },
    nextQuestion: "Are you physically safe right now?",
    questionContract: { mode: "canonical", question: "Are you physically safe right now?", source: { type: "graph-node", id: "IC.SAFETY_ORIENTATION" } },
    variables: { present_safety: "unsafe" },
    threatPathwayContract: { level: "IMMINENT_OPERATIONAL_DANGER", route: "IMMEDIATE_SAFETY_ACTION" }
  });
  const decorated = decoratePlanWithDevelopmentalCapacity(safety, decision);
  assert.equal(decorated.nextQuestion, "Are you physically safe right now?");
  assert.notEqual(decorated.questionContract.mode, "canonical-pair");
});

test("R-ADULT-09: contrast selection is evidence-bound, optional, and context-ordered", () => {
  const state = pairCapacity();
  const decision = developmentalCapacityDecision(state);
  const variables = applyDevelopmentalCapacityToVariables(blankCaseVariables(), state, decision);
  assert.equal(variables.developmental_capacity_state, "partial_intermittent_state_dependent");
  const plan = decoratePlanWithDevelopmentalCapacity(ordinaryPlan({ variables }), decision);
  assert.equal(plan.questionContract.mode, "canonical-pair");
  assert.deepEqual(plan.questionContract.questions, [DEVELOPMENTAL_SUCCESS_QUESTION, DEVELOPMENTAL_BREAKDOWN_QUESTION]);
  assert.equal(plan.nextQuestion, `${DEVELOPMENTAL_SUCCESS_QUESTION}\n\n${DEVELOPMENTAL_BREAKDOWN_QUESTION}`);
  assert.equal(plan.developmentalCapacityContract.oneDiscriminatingComparison, true);

  const acknowledgement = "It sounds as though the self-love and reparenting work is already helping sometimes, while still becoming hard to sustain under distress.";
  const realized = enforceResponseContract({
    answer: acknowledgement,
    next_question: plan.nextQuestion,
    realized_nodes: [
      { id: "IC.DEVELOPMENTAL_CAPACITY_CONTRAST", evidence_quote: acknowledgement },
      { id: "POLICY.DEVELOPMENTAL_PAIRED_CONTRAST", evidence_quote: acknowledgement }
    ]
  }, { plan });
  assert.ok(realized.answer.indexOf(DEVELOPMENTAL_SUCCESS_QUESTION) < realized.answer.indexOf(DEVELOPMENTAL_BREAKDOWN_QUESTION));
  assert.equal((realized.next_question.match(/\?/g) ?? []).length, 2);
  assert.equal(realized.responseContract.pathPerformanceAdherencePassed, true);

  const localizedQuestions = [
    { kind: "successful-exception", text: "Peux-tu penser à un moment récent où ce travail t'a aidé et me dire ce que tu as fait différemment envers toi-même ?" },
    { kind: "breakdown-under-distress", text: "Quand tu te sens perdu ou hors de contrôle, qu'est-ce qui se passe en toi envers toi-même, et quelque chose peut-il rester avec toi pour t'aider un peu ?" }
  ];
  const localized = enforceResponseContract({
    answer: acknowledgement,
    next_question: localizedQuestions.map(item => item.text).join("\n\n"),
    developmental_questions: localizedQuestions,
    realized_nodes: [
      { id: "IC.DEVELOPMENTAL_CAPACITY_CONTRAST", evidence_quote: acknowledgement },
      { id: "POLICY.DEVELOPMENTAL_PAIRED_CONTRAST", evidence_quote: acknowledgement }
    ]
  }, { plan });
  assert.equal(localized.next_question, localizedQuestions.map(item => item.text).join("\n\n"));
  assert.equal(localized.responseContract.developmentalQuestionShapePassed, true);
  assert.equal(localized.responseContract.pathPerformanceAdherencePassed, true);

  const breakdownFirst = developmentalCapacityDecision(pairCapacity({
    contrast: {
      successful_exception: "UNRESOLVED",
      breakdown_state: "UNRESOLVED",
      pair_tolerated: "YES",
      preferred_order: "BREAKDOWN_FIRST",
      observation_ids: ["obs-practice"]
    }
  }));
  assert.deepEqual(breakdownFirst.questions, [DEVELOPMENTAL_BREAKDOWN_QUESTION, DEVELOPMENTAL_SUCCESS_QUESTION]);

  const successKnown = developmentalCapacityDecision(pairCapacity({
    contrast: {
      successful_exception: "ESTABLISHED",
      breakdown_state: "UNRESOLVED",
      pair_tolerated: "YES",
      preferred_order: "SUCCESS_FIRST",
      observation_ids: ["obs-practice"]
    }
  }));
  const single = decoratePlanWithDevelopmentalCapacity(ordinaryPlan(), successKnown);
  assert.equal(single.questionContract.mode, "canonical");
  assert.equal(single.nextQuestion, DEVELOPMENTAL_BREAKDOWN_QUESTION);

  const pairNotTolerated = developmentalCapacityDecision(pairCapacity({
    contrast: {
      successful_exception: "UNRESOLVED",
      breakdown_state: "UNRESOLVED",
      pair_tolerated: "NO",
      preferred_order: "BREAKDOWN_FIRST",
      observation_ids: ["obs-practice"]
    }
  }));
  assert.equal(pairNotTolerated.questionMode, "single");
  assert.deepEqual(pairNotTolerated.questions, [DEVELOPMENTAL_BREAKDOWN_QUESTION]);
});

test("R-ADULT-10: information value permits a justified pair without forcing one", async () => {
  const state = pairCapacity();
  const decision = developmentalCapacityDecision(state);
  const variables = applyDevelopmentalCapacityToVariables({
    ...blankCaseVariables(),
    present_safety: "safe",
    orientation: "oriented",
    ability_to_stop: "yes",
    ability_to_return: "yes",
    activation: "moderate",
    dissociation: "none",
    altered_state: "sober"
  }, state, decision);
  const bundle = await compileGuideGraphs({ write: false });
  const raw = planFromGraphs({ graphs: bundle.graphs, variables, unknowns: [{
    variable: "ordinary_curiosity",
    question: "What else feels interesting?",
    importance: 5
  }] });
  assert.equal(raw.primaryJob.id, "IC.DEVELOPMENTAL_CAPACITY_CONTRAST");
  const plan = decoratePlanWithDevelopmentalCapacity(raw, decision);
  assert.equal(plan.questionContract.mode, "canonical-pair");
  assert.deepEqual(plan.questionContract.questions, [DEVELOPMENTAL_SUCCESS_QUESTION, DEVELOPMENTAL_BREAKDOWN_QUESTION]);

  const singleDecision = developmentalCapacityDecision(pairCapacity({ contrast: null }));
  const singleVariables = applyDevelopmentalCapacityToVariables(variables, pairCapacity({ contrast: null }), singleDecision);
  const singleRaw = planFromGraphs({ graphs: bundle.graphs, variables: singleVariables, unknowns: [] });
  const singlePlan = decoratePlanWithDevelopmentalCapacity(singleRaw, singleDecision);
  assert.equal(singlePlan.questionContract.mode, "canonical");
  assert.equal(singlePlan.nextQuestion, DEVELOPMENTAL_SUCCESS_QUESTION);
});

test("R-ADULT-11: selected developmental inquiry rejects tangent question bundling", () => {
  const plan = decoratePlanWithDevelopmentalCapacity(ordinaryPlan(), developmentalCapacityDecision(pairCapacity()));
  const acknowledgement = "The work is helping sometimes and is still hard to sustain.";
  const realized = enforceResponseContract({
    answer: `${acknowledgement}\n\nBefore that, what exactly did rejection mean to you?`,
    next_question: plan.nextQuestion,
    realized_nodes: [
      { id: "IC.DEVELOPMENTAL_CAPACITY_CONTRAST", evidence_quote: acknowledgement },
      { id: "POLICY.DEVELOPMENTAL_PAIRED_CONTRAST", evidence_quote: acknowledgement }
    ]
  }, { plan });
  assert.equal(realized.responseContract.unexpectedPairedRouteQuestionCount, 1);
  assert.equal(realized.responseContract.pathPerformanceAdherencePassed, false);
  assert.deepEqual(plan.developmentalCapacityContract.prohibitedTangentTopics, [
    "rejection-investigation",
    "shame-function-investigation",
    "false-self-theory",
    "substance-discussion",
    "shaking-discussion",
    "generic-consent-boundary-teaching"
  ]);

  const singleDecision = developmentalCapacityDecision(pairCapacity({ contrast: null }));
  const singlePlan = decoratePlanWithDevelopmentalCapacity(ordinaryPlan(), singleDecision);
  const singleTangent = enforceResponseContract({
    answer: `${acknowledgement}\n\nWhat exactly did the rejection mean?`,
    next_question: singlePlan.nextQuestion,
    realized_nodes: [{ id: "IC.DEVELOPMENTAL_CAPACITY_CONTRAST", evidence_quote: acknowledgement }]
  }, { plan: singlePlan });
  assert.equal(singleTangent.responseContract.unexpectedDevelopmentalRouteQuestionCount, 1);
  assert.equal(singleTangent.responseContract.pathPerformanceAdherencePassed, false);
});

test("R-ADULT-12: the observed contrast selects the missing function rather than a fixed role order", () => {
  const soothingButUnguided = pairCapacity({
    practice: null,
    functions: [
      functionState("SOOTHING", "AVAILABLE"),
      functionState("GUIDING", "ABSENT_OR_INACCESSIBLE")
    ]
  });
  assert.equal(developmentalCapacityDecision(soothingButUnguided).route, "STRENGTHEN_LEADER_GUIDE");

  const protectedButSelfAttacking = pairCapacity({
    practice: null,
    functions: [
      functionState("PROTECTING", "AVAILABLE"),
      functionState("CARING", "ABSENT_OR_INACCESSIBLE")
    ]
  });
  assert.equal(developmentalCapacityDecision(protectedButSelfAttacking).route, "STRENGTHEN_NURTURER_NON_ABANDONMENT");

  const noException = capacity({
    status: "ABSENT_OR_INACCESSIBLE",
    access: "ABSENT_OR_INACCESSIBLE",
    reliability: "ABSENT",
    younger_state_trust: "UNTESTED",
    observation_ids: ["obs-function"],
    practice: practice({ helpfulness: "NO_SUCCESSFUL_EXCEPTION" }),
    functions: [functionState("STAYING_PRESENT", "ABSENT_OR_INACCESSIBLE")]
  });
  assert.equal(developmentalCapacityDecision(noException).route, "BOOTSTRAP_SCAFFOLD");

  const reliableButDistrusted = capacity({
    status: "AVAILABLE_LOW_CREDIBILITY",
    access: "AVAILABLE",
    reliability: "RELIABLE",
    younger_state_trust: "LOW",
    observation_ids: ["obs-function"],
    functions: [functionState("FOLLOWING_THROUGH", "AVAILABLE")]
  });
  assert.equal(developmentalCapacityDecision(reliableButDistrusted).route, "CREDIBILITY_FOLLOW_THROUGH");
});

test("extraction and audit prompts encode both independent gates and context-sensitive contrast selection", () => {
  const context = {
    priorCaseSnapshot: null,
    pathPerformanceEnabled: true,
    guideManifest: { version: "synthetic" },
    guideExcerpts: "Synthetic guide excerpt.",
    pathPerformanceNodes: [],
    priorInterventionContract: null,
    recentTranscript: "Synthetic transcript.",
    userMessage: "Self-love helps sometimes but disappears when I am distressed.",
    userFacts: []
  };
  const extraction = caseExtractionPrompt(context).system;
  const audit = caseAuditPrompt(context, baseSnapshot()).system;
  for (const prompt of [extraction, audit]) {
    assert.match(prompt, /treatment utility/i);
    assert.match(prompt, /developmental prerequisite validity/i);
    assert.match(prompt, /DEVELOPMENTAL_PREREQUISITE_VIOLATION/);
    assert.match(prompt, /separate (?:question classes|options)/i);
    assert.match(prompt, /breakdown first/i);
    assert.match(prompt, /ask only one|require one question/i);
    assert.match(prompt, /same[- ]reply/i);
  }
});
