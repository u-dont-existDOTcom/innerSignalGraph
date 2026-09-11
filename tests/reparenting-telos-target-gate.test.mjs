import test from "node:test";
import assert from "node:assert/strict";

import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { validateCaseSnapshot, validateCaseAudit } from "../src/case-formulation/validators.mjs";
import { applyCaseAudit } from "../src/case-formulation/run.mjs";
import { caseSnapshotGenerationSchema, caseAuditGenerationSchema } from "../src/case-formulation/schemas.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";

function observation(id, evidence) {
  return { id, statement: evidence, evidence };
}

function baseSnapshot() {
  return {
    user_goal: "Build a trustworthy inner-adult response rather than merely suppress the presenting feeling.",
    current_issue: "A recent rejection activated shame during ongoing reparenting work.",
    direct_observations: [observation("obs-1", "I felt ashamed after being rejected.")],
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
    remove_observation_ids: [],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "accept",
    summary: "Synthetic audit.",
    ...overrides
  };
}

test("current generation schemas require question utility and path-target review", () => {
  assert.ok(caseSnapshotGenerationSchema.properties.unknowns.items.required.includes("changes_next_action"));
  assert.ok(caseAuditGenerationSchema.required.includes("invalidate_path_strategy"));
  assert.ok(caseAuditGenerationSchema.properties.add_unknowns.items.required.includes("changes_next_action"));
});

test("explicitly non-action-changing curiosity is removed before deterministic planning", () => {
  const snapshot = baseSnapshot();
  snapshot.unknowns = [
    {
      variable: "shame_function",
      question: "Is the shame trying to protect you from rejection?",
      importance: 5,
      changes_next_action: false
    },
    {
      variable: "adult_response",
      question: "Would the younger state need protection or reassurance from the Adult in this situation?",
      importance: 5,
      changes_next_action: true
    }
  ];

  const validated = validateCaseSnapshot(snapshot);
  assert.deepEqual(validated.unknowns.map(item => item.variable), ["adult_response"]);
});

test("audit-added non-action-changing curiosity is also removed", () => {
  const audit = baseAudit({
    add_unknowns: [
      {
        variable: "rejection_detail",
        question: "Which exact aspect of the rejection hurt most?",
        importance: 5,
        changes_next_action: false
      },
      {
        variable: "repair_choice",
        question: "Would the supported alternatives require a Protector response or a Nurturer response?",
        importance: 5,
        changes_next_action: true
      }
    ]
  });

  const validated = validateCaseAudit(audit);
  assert.deepEqual(validated.add_unknowns.map(item => item.variable), ["repair_choice"]);
});

test("target invalidation preserves true observations while withdrawing the symptom-level strategy", () => {
  const snapshot = {
    ...baseSnapshot(),
    path_update: {
      strategy: {
        process_id: "reparenting-1",
        target: "Understand whether shame protects against rejection",
        formulation: "Shame may be trying to prevent rejection.",
        family: "functional-analysis",
        node_id: "IC.CREDIBILITY_REPAIR",
        selection_reason: "The feeling is salient.",
        observation_ids: ["obs-1"],
        predictions: [
          { id: "p1", sign: "new_information", description: "More detail about the function of shame.", horizon: "immediate" }
        ],
        adverse_signs: ["low_information"]
      },
      response: "not_observed",
      signals: [],
      failure_hypotheses: [],
      probe: null,
      delivery_review: null,
      representation: null
    }
  };

  const audited = applyCaseAudit(snapshot, baseAudit({
    invalidate_path_strategy: true,
    verdict: "revise",
    summary: "The observations are supported but the proposed target is downstream of the reparenting repair decision."
  }));

  assert.equal(audited.path_update.strategy, null);
  assert.equal(audited.path_update.representation, null);
  assert.equal(audited._path_invalidated, true);
  assert.equal(audited.audit.path_strategy_invalidated, true);
  assert.deepEqual(audited.direct_observations, snapshot.direct_observations);
});

test("prompt contract contains both downstream-tangent failure and the discriminating control case", () => {
  const context = {
    priorCaseSnapshot: null,
    pathPerformanceEnabled: true,
    guideManifest: { version: "synthetic" },
    guideExcerpts: "Synthetic inner-child guide excerpt.",
    pathPerformanceNodes: [],
    priorInterventionContract: null,
    recentTranscript: "Synthetic transcript.",
    userMessage: "I feel shame after rejection.",
    userFacts: [],
    durableCaseContext: null
  };

  const extraction = caseExtractionPrompt(context).system;
  const audit = caseAuditPrompt(context, baseSnapshot()).system;

  assert.match(extraction, /build a Nurturer, Protector, and Guide\/Leader capacity/i);
  assert.match(extraction, /If every plausible answer leaves the same repair action unchanged/i);
  assert.match(extraction, /If the answers genuinely discriminate different actions, the symptom-level question remains eligible/i);

  assert.match(audit, /presenting signal from the developmental repair target/i);
  assert.match(audit, /set invalidate_path_strategy=true/i);
  assert.match(audit, /not a blanket ban on symptom-level questions/i);
  assert.match(audit, /Protector versus Nurturer\/Guide/i);
});
