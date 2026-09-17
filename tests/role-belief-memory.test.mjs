import test from "node:test";
import assert from "node:assert/strict";
import { applyCaseStatePatch, createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState, projectCaseStateForInspection } from "../src/case-state/longitudinal-state.mjs";

// A malicious or mistaken extractor is intentionally injected. This tests the
// persistence boundary, not the probability that a live model produces it.
test("model-written self-condemnation is not promoted into a high-confidence direct report", () => {
  const state = mergeRuntimeSnapshotIntoCaseState(createEmptyCaseState(), {
    direct_observations: [{ id: "O1", statement: "The client is intrinsically without worth.", evidence: "I feel like I have no value." }], hypotheses: []
  }, { turnId: "synthetic-user-1" });
  assert.equal(state.items[0].status, "inference");
  assert.equal(state.items[0].confidence, "low");
  assert.equal(state.items[0].source.assertion_scope, "model_interpretation_only");
});

import { projectEvidenceAuthority } from "../src/case-state/evidence-authority.mjs";
import { buildDurableCaseContext, decisionRelevantProjection } from "../src/case-state/context-window.mjs";
import { durableCaseContextBlock } from "../src/prompts/common.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";

function item(overrides = {}) {
  return { id: "synthetic-observation", domain: "runtime_observation", statement: "The client has no value.",
    status: "direct_report", confidence: "high", source: { kind: "current_turn_model_extraction", ref: "T1", turn_id: "T1" },
    still_current: true, supersedes: [], decision_relevance: "high", ...overrides };
}

test("legacy extraction authority is repaired in prompt, inspection, audit and compacted decision views without mutating history", () => {
  const legacy = applyCaseStatePatch(createEmptyCaseState(), { items: [item()] });
  const before = structuredClone(legacy);
  const context = buildDurableCaseContext({ caseState: legacy });
  const projected = context.case_state.items[0];
  assert.equal(projected.status, "inference");
  assert.equal(projected.confidence, "low");
  assert.equal(projected.source.legacy_asserted_status, "direct_report");
  assert.equal(projectCaseStateForInspection(legacy).factsAndHypotheses[0].status, "inference");
  assert.deepEqual(decisionRelevantProjection(context).high_relevance_items[0].source, projected.source);
  assert.ok(durableCaseContextBlock({ durableCaseState: legacy }).includes('"assertion_scope": "model_interpretation_only"'));
  for (const makePrompt of [privateRuntimeAuditPrompt, privateRuntimeRepairPrompt]) {
    const packet = { case_state: legacy, candidate_response: "EXACT_UNCHANGED_CANDIDATE" };
    const rendered = JSON.parse(makePrompt(packet).user.split("\n").slice(1).join("\n"));
    assert.equal(rendered.case_state.items[0].status, "inference");
    assert.equal(rendered.candidate_response, packet.candidate_response);
  }
  assert.deepEqual(legacy, before);
  assert.deepEqual(projectEvidenceAuthority(projectEvidenceAuthority(legacy)), projectEvidenceAuthority(legacy));
});

test("fifty repeated extraction claims never acquire direct-report status or increased confidence", () => {
  let state = createEmptyCaseState();
  for (let i = 1; i <= 50; i += 1) {
    state = mergeRuntimeSnapshotIntoCaseState(state, {
      direct_observations: [{ id: "O1", statement: "The client's self-condemnation is correct.", evidence: "I keep thinking this." }], hypotheses: []
    }, { turnId: `synthetic-${i}` });
    assert.ok(state.items.every((entry) => entry.status === "inference" && entry.confidence === "low"));
    assert.ok(state.items.every((entry) => entry.source.assertion_scope === "model_interpretation_only"));
  }
  assert.equal(state.items.length, 50);
  assert.equal(state.items[49].source.proposed_evidence, "I keep thinking this.");
});

test("a proposed evidence citation remains explicit, bounded and unverified", () => {
  const state = mergeRuntimeSnapshotIntoCaseState(createEmptyCaseState(), {
    direct_observations: [{ id: "O1", statement: "A proposed interpretation.", evidence: "x".repeat(4001) }],
    hypotheses: [{ id: "H1", claim: "A revisable model hypothesis.", evidence: "Model-proposed support.", confidence: "medium" }]
  }, { turnId: "synthetic-citation" });
  assert.equal(state.items[0].source.proposed_evidence.length, 4000);
  assert.equal(state.items[0].source.proposed_evidence_truncated, true);
  assert.equal(state.items[1].status, "hypothesis");
  assert.equal(state.items[1].source.assertion_scope, "model_hypothesis_only");
  assert.equal(state.items[1].source.proposed_evidence, "Model-proposed support.");
});

test("human reports, corrections, accountability, and explicit hypotheses are preserved", () => {
  const reports = [
    item({ id: "reported-feeling", domain: "self_appraisal", statement: 'The client reports thinking "I have no value".', source: { kind: "user_report", ref: "U1" } }),
    item({ id: "reported-action", domain: "accountability", statement: "The client reports having broken a promise and wants to repair the harm.", source: { kind: "user_report", ref: "U2" } }),
    item({ id: "correction", domain: "correction", statement: "The client corrects the earlier account: the event happened after, not before, the argument.", source: { kind: "user_report", ref: "U3" }, supersedes: ["reported-action"] }),
    item({ id: "hypothesis", domain: "runtime_hypothesis", statement: "The link to earlier criticism remains uncertain.", status: "hypothesis", confidence: "low" })
  ];
  const state = applyCaseStatePatch(createEmptyCaseState(), { items: reports });
  assert.deepEqual(projectEvidenceAuthority(state).items, reports);
  const restored = mergeRuntimeSnapshotIntoCaseState(state, { direct_observations: [], hypotheses: [] }, { turnId: "U4" });
  assert.deepEqual(restored.items, reports);
});
