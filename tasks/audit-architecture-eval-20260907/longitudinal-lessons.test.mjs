import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyLongitudinalAuditSupplement } from './effective-architectures.mjs';

const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const [cases, drafts, target, rubric, architectures, supplement, decisions] = await Promise.all([
  load('./cases.json'),
  load('./drafts.json'),
  load('./reference-target.json'),
  load('./rubric.json'),
  load('./architectures.json'),
  load('./LONGITUDINAL-AUDIT-SUPPLEMENT.json'),
  load('./OWNER-DECISIONS-20260908.json')
]);

const requiredNewErrors = [
  'CLIENT_APPRAISAL_OVERDEFERENCE',
  'LONGITUDINAL_TARGET_LOSS',
  'PROBE_FAILURE_TARGET_ABANDONMENT',
  'INADEQUATE_EXAMPLE_OVERUPDATE',
  'HISTORY_OBLIVIOUS_REQUESTIONING',
  'CLIENT_HYPOTHESIS_MISHANDLING',
  'SALIENCE_CENTRALITY_COLLAPSE',
  'INTEGRATION_FRAGMENTATION_BINARY'
];

const allText = value => JSON.stringify(value);
const words = text => text.trim().split(/\s+/u).filter(Boolean);

test('longitudinal error classes are defined, seeded, and mapped to stable targets', () => {
  const classIds = new Set(rubric.errorClasses.map(item => item.id));
  const seeded = new Set(drafts.drafts.flatMap(item => item.seededErrorIds));
  for (const id of requiredNewErrors) {
    assert.ok(classIds.has(id), `missing rubric class ${id}`);
    assert.ok(seeded.has(id), `missing seeded draft for ${id}`);
  }
  const requiredTargetIds = new Set(target.required.map(item => item.id));
  const forbiddenTargetIds = new Set(target.forbidden.map(item => item.id));
  for (let n = 15; n <= 23; n += 1) assert.ok(requiredTargetIds.has(`AE-RT${n}`));
  for (let n = 12; n <= 19; n += 1) assert.ok(forbiddenTargetIds.has(`AE-RF${n}`));
});

test('synthetic chronology retains the longitudinal target and settled nonverbal/history facts', () => {
  const fixture = cases.cases[0];
  assert.equal(fixture.turns.length, 9);
  assert.equal(fixture.turns.at(-1).role, 'user');
  assert.ok(fixture.facts.some(fact => fact.id === 'AE-F015' && /self-support/iu.test(fact.claim)));
  assert.ok(fixture.facts.some(fact => fact.id === 'AE-F016' && /nonverbal/iu.test(fact.claim)));
  assert.ok(fixture.facts.some(fact => fact.id === 'AE-F018' && /sleep/iu.test(fact.claim)));
  assert.ok(fixture.facts.some(fact => fact.id === 'AE-F019' && /appraises/iu.test(fact.claim)));
  assert.ok(fixture.settledHistory.some(item => /long-term targets/iu.test(item)));
  assert.ok(fixture.settledHistory.some(item => /nonverbal/iu.test(item)));
  assert.ok(fixture.settledHistory.some(item => /Sleep is explicitly unchanged/u.test(item)));
  assert.ok(fixture.openQuestions.some(item => /shame makes the client do or avoid/iu.test(item)));
  assert.ok(fixture.openQuestions.some(item => /curiosity\/inclusion\/integration/iu.test(item)));
});

test('good controls preserve the new longitudinal invariants without seeded defects', () => {
  const good = drafts.drafts.filter(item => item.controlIntent === 'GOOD_TERMINATION_CONTROL');
  assert.equal(good.length, 2);
  for (const draft of good) {
    assert.deepEqual(draft.seededErrorIds, []);
    for (const id of requiredNewErrors) assert.ok(!draft.seededErrorIds.includes(id));
  }
  const compact = good.find(item => item.id === 'AE-D010');
  assert.ok(words(compact.response).length < 190);
  assert.match(compact.response, /shame may protect/u);
  assert.match(compact.response, /longer goal/u);
  assert.match(compact.response, /division relevant but non-central/u);
  assert.match(compact.response, /Sleep is already unchanged/u);
});

test('audit supplement covers every new failure across each architecture family', () => {
  assert.deepEqual(supplement.newErrorIds, requiredNewErrors);
  const coverageText = allText(supplement.stageCoverage);
  for (const id of requiredNewErrors) assert.match(coverageText, new RegExp(id, 'u'));
  for (const stageId of [
    'A1_HOLISTIC_AUDIT_AND_REPAIR',
    'B1_EVIDENCE_HISTORY',
    'B2_SAFETY_MIXED_TRAJECTORY',
    'B3_INTERACTION_INFORMATION_GAIN',
    'C1_EPISTEMIC_CRITIC',
    'C2_SAFETY_CRITIC',
    'C3_INTERACTION_CRITIC',
    'D1_ADVERSARIAL_CRITIC',
    'E1_SELF_CRITIQUE'
  ]) assert.ok(Object.hasOwn(supplement.stageCoverage, stageId), `missing stage coverage ${stageId}`);
  assert.equal(supplement.modelRuns, 0);
});

test('effective audit contracts actually receive the longitudinal supplement', () => {
  const effective = applyLongitudinalAuditSupplement(architectures, supplement);
  assert.ok(effective.sharedRules.length > architectures.sharedRules.length);
  assert.deepEqual(effective.longitudinalSupplement.newErrorIds, requiredNewErrors);
  for (const architecture of effective.architectures) {
    for (const stage of architecture.stages) {
      if (!Object.hasOwn(supplement.stageCoverage, stage.id)) continue;
      const promptText = [stage.prompt, ...Object.values(stage.promptByRepairMode ?? {})].filter(Boolean).join('\n');
      assert.match(promptText, /LONGITUDINAL AUDIT SUPPLEMENT/u, `supplement absent from ${stage.id}`);
      assert.match(promptText, /Treat client first-person reports as privileged evidence/u);
    }
  }
  assert.equal(architectures.longitudinalSupplement, undefined, 'base contract must remain frozen');
});

test('current experiment decisions forbid paid API execution and encode the chosen grading design', () => {
  assert.equal(decisions.developmentExecution.paidApiSpendAuthorized, false);
  assert.equal(decisions.developmentExecution.providerApiCallsAuthorized, false);
  assert.equal(decisions.developmentExecution.orchestration, 'CHATGPT_TABS_VIA_CODEX_AND_MISSION_CONTROL');
  assert.equal(decisions.auditCandidateModel.label, 'GPT-5.6 Sol Extra High');
  assert.equal(decisions.semanticEvaluation.primaryGraderCount, 2);
  assert.equal(decisions.semanticEvaluation.proRole, 'OPTIONAL_DISSENTING_SPECIALIST_ONLY');
  assert.equal(decisions.semanticEvaluation.behavioralTargetAuthority, 'REFERENCE_RUBRIC_NOT_UNIQUE_GROUND_TRUTH');
  assert.equal(decisions.smoke.caseCount, 4);
  assert.equal(decisions.latestModelComparison.comparisonLabel, 'Latest');
  assert.equal(decisions.latestModelComparison.inferBackendIdentity, false);
  assert.equal(decisions.adoption.automaticRuntimeAdoption, false);
});

test('new public artifacts remain synthetic and contain no private identifiers or exact personal amounts', () => {
  const text = [cases, drafts, target, rubric, supplement, decisions].map(allText).join('\n');
  assert.doesNotMatch(text, /Louka|Joel|Prague|Czech|Ziguinchor|Dakar/iu);
  assert.doesNotMatch(text, /€\s*(?:1000|2500)|\b(?:1000|2500)\s*€/u);
  assert.equal(cases.modelRuns + drafts.modelRuns + supplement.modelRuns, 0);
});
