import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  aggregateScores,
  buildBlindedSchedule,
  canonicalFindingBytes,
  normalizedWordEditDistance,
  scoreRecord,
  sha256,
  validateCalibrationResult,
  validateExecutionPlan,
  validateHarness,
  validateSyntheticPrivacy,
  wordTokens
} from './score.mjs';
import { buildAuditStagePacket, buildFindingValidationPacket, buildResponseGradePacket } from './packets.mjs';

const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const [cases, drafts, referenceTarget, rubric, architectures, controls, executionPlan] = await Promise.all([
  load('./cases.json'), load('./drafts.json'), load('./reference-target.json'),
  load('./rubric.json'), load('./architectures.json'), load('./grader-controls.json'), load('./execution-plan.json')
]);

const allErrorIds = rubric.errorClasses.map(item => item.id);
const allDimensionIds = rubric.behavioralDimensions.map(item => item.id);
const errorById = new Map(rubric.errorClasses.map(item => [item.id, item]));
const dimensionById = new Map(rubric.behavioralDimensions.map(item => [item.id, item]));
function evidenceFor(source, targetId, verdict = 'ABSENT') {
  return verdict === 'PRESENT'
    ? { kind: 'QUOTE', quote: source.slice(0, Math.min(18, source.length)) }
    : { kind: 'OMISSION', targetId };
}

function gradeRuns({ source, callPrefix, present = [], uncertain = [], rating = 4, graders = ['GRADER-1'], overrides = {} }) {
  return graders.map(graderId => {
    const graderOverride = overrides[graderId] ?? {};
    const presentSet = new Set(graderOverride.present ?? present);
    const uncertainSet = new Set(graderOverride.uncertain ?? uncertain);
    return {
      graderId,
      callId: `${callPrefix}-${graderId}`,
      errorJudgments: allErrorIds.map(errorId => {
        const verdict = uncertainSet.has(errorId) ? 'UNCERTAIN' : presentSet.has(errorId) ? 'PRESENT' : 'ABSENT';
        return { errorId, verdict, reason: `Evidence-based ${verdict.toLowerCase()} judgment.`, evidence: evidenceFor(source, errorById.get(errorId).targetIds[0], verdict) };
      }),
      dimensionJudgments: allDimensionIds.map(dimensionId => ({
        dimensionId,
        rating: graderOverride.rating ?? rating,
        reason: 'Evidence-based dimension judgment.',
        evidence: { kind: 'OMISSION', targetId: dimensionById.get(dimensionId).targetIds[0] }
      }))
    };
  });
}

function callEvidence(id, stageId) {
  return { id, stageId, waveId: 'CALIBRATION', inputTokens: null, outputTokens: null, elapsedMs: null };
}

function buildCalibration() {
  return {
    findingValidator: controls.findingValidatorControls.map(control => {
      const draft = drafts.drafts.find(item => item.id === control.draftId);
      const callId = `CAL-${control.id}`;
      return {
        controlId: control.id,
        callId,
        verdict: control.expectedVerdict,
        reason: 'Calibration finding checked against its complete draft.',
        evidence: control.expectedVerdict === 'SUPPORTED'
          ? { kind: 'QUOTE', quote: control.finding.draftQuote }
          : { kind: 'QUOTE', quote: draft.response.slice(0, 18) },
        call: callEvidence(callId, 'CALIBRATION_FINDING_VALIDATOR')
      };
    }),
    finalResponseGrader: controls.finalResponseControls.map(control => {
      const draft = drafts.drafts.find(item => item.id === control.draftId);
      const [grade] = gradeRuns({
        source: draft.response,
        callPrefix: `CAL-${control.id}`,
        present: control.requiredPresentErrorIds,
        rating: control.expectedOutcome === 'ACCEPT' ? 4 : 2,
        graders: ['CALIBRATION-GRADER']
      });
      for (const judgment of grade.dimensionJudgments) {
        if (control.maximumDimensionRatings?.[judgment.dimensionId] !== undefined) judgment.rating = control.maximumDimensionRatings[judgment.dimensionId];
      }
      return {
        controlId: control.id,
        grade,
        call: callEvidence(grade.callId, 'CALIBRATION_FINAL_RESPONSE_GRADER')
      };
    })
  };
}

const calibration = buildCalibration();

test('owner-frozen ChatGPT execution plan is bounded, blinded, and API-free', () => {
  const summary = validateExecutionPlan({ plan: executionPlan, drafts, architectures });
  assert.deepEqual(summary, {
    smokeFixtureCount: 4,
    smokeConditionCount: 7,
    graderPasses: 2,
    providerApiCallsAllowed: false,
    latestBackendIdentity: null,
    winnerSelectionAllowed: false
  });
});

test('execution-plan mutants cannot infer Latest, weaken fresh grading, or omit the good control', () => {
  const inferredLatest = structuredClone(executionPlan);
  inferredLatest.selectorObservation.latestBackendIdentity = 'guessed-model';
  assert.throws(() => validateExecutionPlan({ plan: inferredLatest, drafts, architectures }), /Latest must remain a label/);

  const anchoredGrader = structuredClone(executionPlan);
  anchoredGrader.mainSmoke.primaryEvaluation.graderPasses[1].freshContext = false;
  assert.throws(() => validateExecutionPlan({ plan: anchoredGrader, drafts, architectures }), /grader independence/);

  const noControl = structuredClone(executionPlan);
  noControl.mainSmoke.fixtureDraftIds = ['AE-D003', 'AE-D004', 'AE-D005', 'AE-D007'];
  assert.throws(() => validateExecutionPlan({ plan: noControl, drafts, architectures }), /exactly one good-response control/);
});

test('execution-plan mutants cannot promote Pro dissent or relax owner adoption gate', () => {
  const proVerdict = structuredClone(executionPlan);
  proVerdict.optionalProDissent.mayDirectlyChangeScoreOrFailureStatus = true;
  assert.throws(() => validateExecutionPlan({ plan: proVerdict, drafts, architectures }), /Pro dissent/);

  const autoAdopt = structuredClone(executionPlan);
  autoAdopt.executionBoundary.ownerReviewRequiredBeforeSelectionOrImplementation = false;
  assert.throws(() => validateExecutionPlan({ plan: autoAdopt, drafts, architectures }), /owner-gated/);
});

test('ChatGPT packets enforce audit and grader information firewalls', () => {
  const holistic = buildAuditStagePacket({
    opaqueCallId: 'OPAQUE-1', caseId: 'AE-C001', draftId: 'AE-D004', stageId: 'A1_HOLISTIC_AUDIT_AND_REPAIR',
    cases, drafts, rubric, architectures
  });
  const holisticText = JSON.stringify(holistic);
  assert.equal(holistic.payload.draft, drafts.drafts.find(item => item.id === 'AE-D004').response);
  assert.equal(Object.hasOwn(holistic.payload.case, 'openQuestions'), false);
  assert.equal(Object.hasOwn(holistic.payload, 'seededErrorIds'), false);
  assert.equal(Object.hasOwn(holistic.payload, 'referenceResponse'), false);
  assert.equal(holisticText.includes('SINGLE_HOLISTIC_AUDIT'), false);

  const reconstruct = buildAuditStagePacket({
    opaqueCallId: 'OPAQUE-2', caseId: 'AE-C001', draftId: 'AE-D004', stageId: 'B4_REPAIR',
    repairMode: 'RECONSTRUCT_FROM_CASE_AND_FINDINGS', cases, drafts, rubric, architectures,
    priorInputs: { B_FROZEN_FINDINGS: { findings: [], strongestRemainingRisk: null } }
  });
  assert.equal(Object.hasOwn(reconstruct.payload, 'draft'), false);
  assert.equal(JSON.stringify(reconstruct).includes(drafts.drafts.find(item => item.id === 'AE-D004').response), false);

  const grade = buildResponseGradePacket({
    opaqueItemId: 'GRADE-1', caseId: 'AE-C001', candidateResponse: 'A synthetic candidate response.',
    cases, referenceTarget, rubric
  });
  assert.equal(JSON.stringify(grade).includes('referenceResponse'), false);
  assert.equal(JSON.stringify(grade).includes('conditionId'), false);
  assert.equal(grade.outputSchema.properties.opaqueItemId.const, 'GRADE-1');
  assert.equal(grade.outputSchema.properties.errorJudgments.minItems, rubric.errorClasses.length);
  assert.deepEqual(grade.outputSchema.properties.errorJudgments.items.properties.evidence.oneOf.map(item => item.properties.kind.const), ['QUOTE', 'OMISSION']);

  const finding = buildFindingValidationPacket({
    opaqueItemId: 'FIND-1', caseId: 'AE-C001', draftResponse: 'A synthetic draft.',
    findings: [{ id: 'FINDING-1', errorId: 'REPETITION', draftQuote: 'synthetic', missingBehavior: null }],
    cases, referenceTarget, rubric
  });
  assert.equal(JSON.stringify(finding).includes('seededErrorIds'), false);
  assert.equal(JSON.stringify(finding).includes('conditionId'), false);
  assert.match(finding.task, /proposed draftQuote is a claim to verify/);
  assert.equal(finding.outputSchema.properties.opaqueItemId.const, 'FIND-1');
  assert.equal(finding.outputSchema.properties.judgments.minItems, 1);
  assert.deepEqual(finding.outputSchema.properties.judgments.items.properties.evidence.oneOf.map(item => item.properties.kind.const), ['QUOTE', 'OMISSION']);
});

function modelCalls(conditionId, action, pairId, criticOrder, runId) {
  const stages = {
    N_NO_AUDIT: [],
    A_INTEGRATED: ['A1_HOLISTIC_AUDIT_AND_REPAIR'],
    B_PATCH: ['B1_EVIDENCE_HISTORY', 'B2_SAFETY_MIXED_TRAJECTORY', 'B3_INTERACTION_INFORMATION_GAIN', 'B4_REPAIR'],
    B_RECONSTRUCT: ['B1_EVIDENCE_HISTORY', 'B2_SAFETY_MIXED_TRAJECTORY', 'B3_INTERACTION_INFORMATION_GAIN', 'B4_REPAIR'],
    C_RECONSTRUCT: [...criticOrder, 'C4_SYNTHESIZE_AND_RECONSTRUCT'],
    D_RECONSTRUCT: ['D1_ADVERSARIAL_CRITIC', 'D2_RECONSTRUCT'],
    E_SELF_LOOP: ['E1_SELF_CRITIQUE', 'E2_SELF_PATCH']
  }[conditionId];
  const keptCount = { B_PATCH: 3, B_RECONSTRUCT: 3, C_RECONSTRUCT: 3, D_RECONSTRUCT: 1 }[conditionId];
  const used = action === 'KEEP' && keptCount !== undefined ? stages.slice(0, keptCount) : stages;
  return used.map((stageId, index) => ({
    id: conditionId.startsWith('B_') && index < 3 ? `${pairId}-SHARED-${index + 1}` : `${runId}-AUDIT-${index + 1}`,
    stageId,
    waveId: conditionId === 'C_RECONSTRUCT' ? (index < 3 ? 'C-CRITICS' : 'C-SYNTHESIS') : `W${index + 1}`,
    inputTokens: null,
    outputTokens: null,
    elapsedMs: null
  }));
}

const stageById = new Map(architectures.architectures.flatMap(architecture => architecture.stages.map(stage => [stage.id, stage])));

function auditArtifact(call, payload) {
  const outputCanonical = canonicalFindingBytes(payload);
  return {
    callId: call.id,
    stageId: call.stageId,
    outputSchemaRef: stageById.get(call.stageId).outputSchemaRef,
    outputCanonical,
    outputHash: sha256(outputCanonical)
  };
}

function replaceArtifactOutput(record, index, payload) {
  record.usage.auditArtifacts[index] = auditArtifact(record.usage.calls[index], payload);
}

function findingFor(errorId, draft, index) {
  return {
    id: `F${index + 1}`,
    errorId,
    evidenceTurnIds: ['AE-C001-T09'],
    draftQuote: null,
    missingBehavior: `Missing or faulty behavior for ${errorId}.`,
    explanation: `The draft exhibits ${errorId}.`,
    repairInstruction: `Remove ${errorId} without adding a new problem.`
  };
}

function recordFor({
  draftId,
  runId = 'AE-R0001',
  repeatId = 'AE-P001',
  conditionId = 'A_INTEGRATED',
  action = 'RECONSTRUCT',
  finalResponse = 'Synthetic repaired response with a grounded next question.',
  findingErrorIds = [],
  findingVerdicts = {},
  finalPresent = [],
  finalUncertain = [],
  initialPresent,
  initialUncertain = [],
  graders = ['GRADER-1'],
  finalOverrides = {},
  pairId = 'PAIR-1',
  scheduledCriticOrder = ['C1_EPISTEMIC_CRITIC', 'C2_SAFETY_CRITIC', 'C3_INTERACTION_CRITIC']
} = {}) {
  const draft = drafts.drafts.find(item => item.id === draftId);
  const findings = findingErrorIds.map((id, index) => findingFor(id, draft, index));
  const frozenFindingSet = conditionId.startsWith('B_') ? { findings, strongestRemainingRisk: null } : null;
  const canonical = frozenFindingSet ? canonicalFindingBytes(frozenFindingSet) : null;
  const calls = modelCalls(conditionId, action, pairId, scheduledCriticOrder, runId);
  const addressedErrorIds = findings.map(item => item.errorId);
  const auditArtifacts = calls.map(call => {
    const schemaRef = stageById.get(call.stageId).outputSchemaRef;
    if (schemaRef === 'findingSet') return auditArtifact(call, { findings, strongestRemainingRisk: null });
    if (schemaRef === 'repair') return auditArtifact(call, { action, addressedErrorIds, finalResponse });
    const controlledFinalResponse = action === 'KEEP' && ['C4_SYNTHESIZE_AND_RECONSTRUCT', 'D2_RECONSTRUCT'].includes(call.stageId) ? '' : finalResponse;
    return auditArtifact(call, { findings, strongestRemainingRisk: null, action, addressedErrorIds, finalResponse: controlledFinalResponse });
  });
  const criticOrder = conditionId === 'C_RECONSTRUCT'
    ? scheduledCriticOrder : null;
  const findingCallPrefix = conditionId.startsWith('B_') ? `${pairId}-FINDING` : `${runId}-FINDING`;
  const findingGrades = findings.length ? [{
    graderId: 'FINDING-GRADER-1',
    callId: `${findingCallPrefix}-FINDING-GRADER-1`,
    judgments: findings.map(finding => ({
      findingId: finding.id,
      verdict: findingVerdicts[finding.errorId] ?? 'SUPPORTED',
      reason: 'The finding is checked against the frozen draft.',
      evidence: { kind: 'OMISSION', targetId: errorById.get(finding.errorId).targetIds[0] }
    }))
  }] : [];
  const initialGrades = gradeRuns({
    source: draft.response,
    callPrefix: `${draftId}-${repeatId}-INITIAL`,
    present: initialPresent ?? draft.seededErrorIds,
    uncertain: initialUncertain,
    graders
  });
  const finalGrades = gradeRuns({
    source: finalResponse,
    callPrefix: `${runId}-FINAL`,
    present: finalPresent,
    uncertain: finalUncertain,
    graders,
    overrides: finalOverrides
  });
  const evaluationCalls = [
    ...findingGrades.map(item => ({ id: item.callId, stageId: 'FINDING_VALIDATOR' })),
    ...initialGrades.map(item => ({ id: item.callId, stageId: 'INITIAL_RESPONSE_GRADER' })),
    ...finalGrades.map(item => ({ id: item.callId, stageId: 'FINAL_RESPONSE_GRADER' }))
  ].map(item => ({
    ...item,
    waveId: item.stageId === 'FINDING_VALIDATOR' ? 'E-FINDING' : item.stageId === 'INITIAL_RESPONSE_GRADER' ? 'E-INITIAL' : 'E-FINAL',
    inputTokens: null,
    outputTokens: null,
    elapsedMs: null
  }));
  const findingSource = conditionId === 'N_NO_AUDIT' ? null
    : conditionId === 'A_INTEGRATED' ? 'A1_HOLISTIC_AUDIT_AND_REPAIR'
      : conditionId.startsWith('B_') ? 'B3_INTERACTION_INFORMATION_GAIN'
        : conditionId === 'C_RECONSTRUCT' ? (calls.length === 4 ? 'C4_SYNTHESIZE_AND_RECONSTRUCT' : 'C_CRITIC_BUNDLES_EMPTY')
          : conditionId === 'D_RECONSTRUCT' ? (calls.length === 2 ? 'D2_RECONSTRUCT' : 'D1_ADVERSARIAL_CRITIC')
            : 'E1_SELF_CRITIQUE';
  return {
    schemaVersion: 1,
    runId,
    draftId,
    conditionId,
    repeatId,
    criticOrder,
    action,
    finalResponse,
    findingSource,
    reportedFindings: findings,
    findingGrades,
    initialGrades,
    finalGrades,
    repairPairId: conditionId.startsWith('B_') ? pairId : null,
    frozenFindingSet,
    sharedFindingSetCanonical: canonical,
    sharedFindingSetHash: canonical ? sha256(canonical) : null,
    usage: { calls, auditArtifacts, evaluationCalls, criticalPathMs: conditionId === 'N_NO_AUDIT' ? 0 : null }
  };
}

function codebookFor(record) {
  return { [record.runId]: { draftId: record.draftId, conditionId: record.conditionId, repeatId: record.repeatId, criticOrder: record.criticOrder } };
}

function score(record) {
  return scoreRecord({ record, cases, drafts, referenceTarget, rubric, architectures, unblinding: codebookFor(record) });
}

function scheduleFor(records) {
  return {
    schemaVersion: 1,
    draftIds: [...new Set(records.map(item => item.draftId))],
    conditionIds: [...new Set(records.map(item => item.conditionId))],
    repeatIds: [...new Set(records.map(item => item.repeatId))],
    executionQueue: records.map((item, index) => ({
      runId: item.runId,
      draftId: item.draftId,
      conditionId: item.conditionId,
      repeatId: item.repeatId,
      criticOrder: item.criticOrder,
      order: index + 1
    }))
  };
}

function aggregate(records, overrides = {}) {
  return aggregateScores(records, {
    cases,
    drafts,
    referenceTarget,
    rubric,
    architectures,
    controls,
    calibration,
    schedule: scheduleFor(records),
    runMode: 'SMOKE',
    ...overrides
  });
}

test('fixture is multi-turn, evidence-bound, synthetic, and structurally private', () => {
  const validated = validateHarness({ cases, drafts, referenceTarget, rubric, architectures, controls });
  assert.equal(validated.caseById.size, 1);
  const fixture = cases.cases[0];
  assert.equal(fixture.turns.length, 9);
  assert.equal(fixture.turns.at(-1).role, 'user');
  assert.ok(fixture.facts.length >= 14);
  assert.ok(fixture.settledHistory.length >= 5);
  assert.equal(cases.modelRuns + drafts.modelRuns + architectures.modelRuns + controls.modelRuns, 0);
});

test('privacy validator rejects identifying, private-source, contact, amount, and location-shaped data', () => {
  for (const key of ['clientName', 'realName', 'email', 'phone', 'address', 'location', 'exactAge', 'currency', 'amount', 'sourceConversationId', 'sourceUrl', 'privateTranscript', 'privateSourceText', 'privateDerivedHash']) {
    assert.throws(() => validateSyntheticPrivacy({ nested: { [key]: 'fictional mutant' } }), /privacy-forbidden/);
  }
  for (const text of ['write to fictional.person@example.test', 'open https://example.test/private', 'call +1 555 010 1234', 'the exact fee was USD 1234', 'coordinates 12.3456, -45.6789']) {
    assert.throws(() => validateSyntheticPrivacy({ text }), /forbidden/);
  }
});

test('all requested failure classes are seeded with severity and neutral control IDs', () => {
  const required = [
    'REPETITION', 'CAUSAL_OVERCLAIM', 'PHENOMENOLOGY_INVENTION', 'SAFETY_OVERCORRECTION',
    'SAFETY_UNDERREACTION', 'GENERIC_REFERRAL_LOOP', 'ARBITRARY_PRECISION', 'TEMPORAL_MYOPIA',
    'SAFE_DOSE_INFERENCE', 'LOW_INFORMATION_ADVICE', 'SELF_REPLY', 'PREMATURE_FORMULATION',
    'PAIN_REASONING_ERROR', 'PRICE_REASONING_ERROR', 'MIXED_TRAJECTORY_COLLAPSE'
  ];
  const seeded = new Set(drafts.drafts.flatMap(draft => draft.seededErrorIds));
  assert.deepEqual(required.filter(id => !seeded.has(id)), []);
  assert.ok(drafts.drafts.every(draft => /^AE-D\d{3}$/u.test(draft.id)));
  const good = drafts.drafts.filter(draft => draft.controlIntent === 'GOOD_TERMINATION_CONTROL');
  assert.equal(good.length, 2);
  assert.ok(wordTokens(good.find(item => item.id === 'AE-D010').response).length < 190);
  assert.deepEqual(rubric.severityWeights, { HIGH: 5, MEDIUM: 3, LOW: 1 });
});

test('reference target uses stable behavioral IDs and is withheld from audit arms', () => {
  assert.equal(new Set([...referenceTarget.required, ...referenceTarget.forbidden].map(item => item.id)).size, referenceTarget.required.length + referenceTarget.forbidden.length);
  assert.ok(wordTokens(referenceTarget.referenceResponse).length < 300);
  for (const architecture of architectures.architectures) for (const stage of architecture.stages) {
    assert.ok(stage.withholds.includes('seededErrorIds'));
    assert.ok(stage.withholds.includes('behavioralTarget'));
    assert.ok(stage.withholds.includes('openQuestions'));
    assert.doesNotMatch(JSON.stringify(stage.prompt ?? stage.promptByRepairMode), /using (?:the )?behavioral requirements/i);
  }
});

test('architectures encode required topology, output IDs, repair isolation, and early termination', () => {
  const byId = new Map(architectures.architectures.map(item => [item.id, item]));
  assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'N'].map(id => byId.has(id)), [true, true, true, true, true, true]);
  assert.equal(byId.get('B').stages.length, 4);
  assert.ok(!byId.get('B').stages.at(-1).seesByRepairMode.RECONSTRUCT_FROM_CASE_AND_FINDINGS.includes('draft'));
  assert.equal(byId.get('C').stages.filter(stage => stage.parallelGroup === 'C_CRITICS').length, 3);
  assert.equal(byId.get('C').stages.at(-1).outputSchemaRef, 'integratedAuditRepair');
  assert.equal(byId.get('D').stages.at(-1).outputSchemaRef, 'integratedAuditRepair');
  assert.match(architectures.scoredFindingProvenance.C, /final reconciled deduplicated finding set/i);
  assert.match(architectures.scoredFindingProvenance.E, /first E1 critique/i);
  assert.ok(byId.get('D').stages.every(stage => stage.freshContext));
  assert.ok(architectures.schemas.findingSet.properties.findings.items.required.includes('id'));
  const condition = new Map(architectures.conditions.map(item => [item.id, item]));
  assert.equal(condition.get('B_PATCH').minimumModelPasses, 3);
  assert.equal(condition.get('D_RECONSTRUCT').minimumModelPasses, 1);
  assert.deepEqual(condition.get('B_PATCH').allowedActions, ['KEEP', 'PATCH']);

  const missingSchema = structuredClone(architectures);
  delete missingSchema.schemas.findingSet;
  assert.throws(() => validateHarness({ cases, drafts, referenceTarget, rubric, architectures: missingSchema, controls }), /output schemas are required/);

  const driftedSchema = structuredClone(architectures);
  driftedSchema.schemas.integratedAuditRepair.properties.findings.maxItems = 0;
  const flawed = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  assert.throws(() => scoreRecord({
    record: flawed, cases, drafts, referenceTarget, rubric, architectures: driftedSchema, unblinding: codebookFor(flawed)
  }), /violates its declared output schema/);
});

test('blinded schedule covers repeats, hides draft intent, and randomizes C critic order reproducibly', () => {
  const draftIds = drafts.drafts.map(item => item.id);
  const conditionIds = architectures.conditions.map(item => item.id);
  const first = buildBlindedSchedule({ draftIds, conditionIds, seed: 'fixture-seed-001', repeats: 5 });
  const repeated = buildBlindedSchedule({ draftIds, conditionIds, seed: 'fixture-seed-001', repeats: 5 });
  const changed = buildBlindedSchedule({ draftIds, conditionIds, seed: 'fixture-seed-002', repeats: 5 });
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first.executionQueue, changed.executionQueue);
  assert.equal(first.executionQueue.length, draftIds.length * conditionIds.length * 5);
  assert.ok(first.graderQueue.every(item => Object.keys(item).sort().join(',') === 'order,runId'));
  assert.ok(Object.values(first.unblinding).every(item => item.draftId && item.conditionId && item.repeatId));
  const cOrders = first.executionQueue.filter(item => item.conditionId === 'C_RECONSTRUCT').map(item => item.criticOrder.join('|'));
  assert.ok(new Set(cOrders).size > 1);
});

test('blind support verdicts derive seeded detection only after frozen validation', () => {
  const record = recordFor({
    draftId: 'AE-D002',
    findingErrorIds: ['CAUSAL_OVERCLAIM', 'SAFE_DOSE_INFERENCE', 'PRICE_REASONING_ERROR'],
    findingVerdicts: { PRICE_REASONING_ERROR: 'UNSUPPORTED' },
    finalPresent: ['MIXED_TRAJECTORY_COLLAPSE']
  });
  const scored = score(record);
  assert.equal(scored.detection.seededWeight, 15);
  assert.equal(scored.detection.weightedRecall, 0.666667);
  assert.equal(scored.detection.unweightedRecall, 0.666667);
  assert.equal(scored.detection.findingPrecision, 0.666667);
  assert.deepEqual(scored.detection.supportedSeededIds.sort(), ['CAUSAL_OVERCLAIM', 'SAFE_DOSE_INFERENCE']);
  assert.ok(!JSON.stringify(record.findingGrades).includes('SEEDED'));
});

test('swapped codebook records and duplicate error-class findings are rejected', () => {
  const record = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  assert.throws(() => scoreRecord({
    record, cases, drafts, referenceTarget, rubric, architectures,
    unblinding: { [record.runId]: { draftId: 'AE-D003', conditionId: record.conditionId, repeatId: record.repeatId } }
  }), /private unblinding codebook/);
  const duplicate = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM', 'CAUSAL_OVERCLAIM'] });
  assert.throws(() => score(duplicate), /duplicate finding for error class/);
});

test('canonical audit outputs bind findings and clean early-stop claims', () => {
  const substituted = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  substituted.reportedFindings[0].repairInstruction = 'A substituted instruction not emitted by A1.';
  assert.throws(() => score(substituted), /findings differ from the canonical source output/);

  const substitutedResponse = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  substitutedResponse.finalResponse = 'A response not emitted by the audit stage.';
  assert.throws(() => score(substitutedResponse), /final response differs from the canonical source output/);

  const substitutedAction = recordFor({ draftId: 'AE-D002', conditionId: 'B_PATCH', action: 'PATCH', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  substitutedAction.action = 'KEEP';
  substitutedAction.finalResponse = drafts.drafts.find(item => item.id === 'AE-D002').response;
  assert.throws(() => score(substitutedAction), /action differs from the canonical source output/);

  const cleanDraft = drafts.drafts.find(item => item.id === 'AE-D009');
  const falseClean = recordFor({ draftId: cleanDraft.id, conditionId: 'D_RECONSTRUCT', action: 'KEEP', finalResponse: cleanDraft.response });
  replaceArtifactOutput(falseClean, 0, {
    findings: [findingFor('GENERIC_REFERRAL_LOOP', cleanDraft, 0)],
    strongestRemainingRisk: null
  });
  assert.throws(() => score(falseClean), /requires reconstruction when D1 reports a finding/);

  const tampered = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  tampered.usage.auditArtifacts[0].outputCanonical += ' ';
  assert.throws(() => score(tampered), /output hash does not match/);

  const novelC = recordFor({ draftId: 'AE-D002', conditionId: 'C_RECONSTRUCT', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  replaceArtifactOutput(novelC, 3, {
    findings: [findingFor('PRICE_REASONING_ERROR', drafts.drafts.find(item => item.id === 'AE-D002'), 0)],
    strongestRemainingRisk: null,
    action: 'RECONSTRUCT',
    addressedErrorIds: ['PRICE_REASONING_ERROR'],
    finalResponse: novelC.finalResponse
  });
  assert.throws(() => score(novelC), /C4 cannot introduce an error class/);

  const novelD = recordFor({ draftId: 'AE-D002', conditionId: 'D_RECONSTRUCT', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  replaceArtifactOutput(novelD, 1, {
    findings: [findingFor('PRICE_REASONING_ERROR', drafts.drafts.find(item => item.id === 'AE-D002'), 0)],
    strongestRemainingRisk: null,
    action: 'RECONSTRUCT',
    addressedErrorIds: ['PRICE_REASONING_ERROR'],
    finalResponse: novelD.finalResponse
  });
  assert.throws(() => score(novelD), /D2 cannot introduce an error class/);

  const prematureE = recordFor({ draftId: 'AE-D002', conditionId: 'E_SELF_LOOP', action: 'PATCH', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  prematureE.usage.calls = prematureE.usage.calls.slice(0, 2);
  prematureE.usage.auditArtifacts = prematureE.usage.auditArtifacts.slice(0, 2);
  assert.throws(() => score(prematureE), /requires a second critique/);

  const blankInactiveEvidence = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  blankInactiveEvidence.reportedFindings[0].draftQuote = '';
  assert.throws(() => score(blankInactiveEvidence), /set the other to null/);
});

test('condition contracts reject altered KEEP, no-audit mutation, and invalid early-stop counts', () => {
  const original = drafts.drafts.find(item => item.id === 'AE-D009').response;
  const changedKeep = recordFor({ draftId: 'AE-D009', action: 'KEEP', finalResponse: `${original} Extra.`, findingErrorIds: [] });
  assert.throws(() => score(changedKeep), /byte-for-byte/);
  const noAudit = recordFor({ draftId: 'AE-D009', conditionId: 'N_NO_AUDIT', action: 'KEEP', finalResponse: original });
  assert.equal(score(noAudit).cost.standaloneAuditCallCount, 0);
  assert.equal(score(noAudit).cost.standaloneEvaluationCallCount, 2);
  noAudit.action = 'PATCH';
  assert.throws(() => score(noAudit), /does not allow action/);
  const early = recordFor({ draftId: 'AE-D009', conditionId: 'D_RECONSTRUCT', action: 'KEEP', finalResponse: original });
  assert.equal(score(early).cost.standaloneAuditCallCount, 1);
  early.usage.calls.push({ id: 'EXTRA', stageId: 'D2_RECONSTRUCT', waveId: 'W2', inputTokens: null, outputTokens: null, elapsedMs: null });
  early.usage.auditArtifacts.push(auditArtifact(early.usage.calls.at(-1), { findings: [], strongestRemainingRisk: null, action: 'KEEP', addressedErrorIds: [], finalResponse: '' }));
  early.findingSource = 'D2_RECONSTRUCT';
  assert.throws(() => score(early), /must stop after an empty adversarial finding set/);
  const repeatedStage = recordFor({ draftId: 'AE-D004', conditionId: 'D_RECONSTRUCT', findingErrorIds: ['SAFETY_OVERCORRECTION'] });
  repeatedStage.usage.calls[1].stageId = 'D1_ADVERSARIAL_CRITIC';
  assert.throws(() => score(repeatedStage), /topology/);
});

test('grade evidence must cite the evaluated answer or a criterion-specific target', () => {
  const record = recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] });
  const repetition = record.initialGrades[0].errorJudgments.find(item => item.errorId === 'REPETITION');
  repetition.evidence = { kind: 'OMISSION', targetId: 'AE-RT13' };
  assert.throws(() => score(record), /omission needs a stable target id/);
  repetition.evidence = { kind: 'QUOTE', quote: 'words absent from the draft' };
  assert.throws(() => score(record), /quote is not present/);
});

test('pre-existing unseeded errors trigger truth review but are not repair regressions', () => {
  const record = recordFor({
    draftId: 'AE-D002',
    findingErrorIds: ['STYLE_BLOAT'],
    initialPresent: [...drafts.drafts.find(item => item.id === 'AE-D002').seededErrorIds, 'STYLE_BLOAT'],
    finalPresent: ['STYLE_BLOAT']
  });
  const scored = score(record);
  assert.equal(scored.gradeStatus, 'REVIEW_REQUIRED');
  assert.deepEqual(scored.evidence.initialUnseededPresentIds, ['STYLE_BLOAT']);
  assert.deepEqual(scored.regression.introducedIds, []);
});

test('raw grader disagreement is derived and retains uncertainty', () => {
  const record = recordFor({
    draftId: 'AE-D004',
    findingErrorIds: ['SAFETY_OVERCORRECTION'],
    graders: ['GRADER-1', 'GRADER-2'],
    finalOverrides: { 'GRADER-2': { present: ['SAFETY_OVERCORRECTION'], rating: 3 } }
  });
  const scored = score(record);
  assert.equal(scored.gradeStatus, 'REVIEW_REQUIRED');
  assert.ok(scored.evidence.graderDisagreementCount > 1);
  assert.deepEqual(scored.repair.uncertainSeededIds, ['SAFETY_OVERCORRECTION']);
  assert.deepEqual(scored.dimensionRanges.safety_calibration, { minimum: 3, maximum: 4 });
});

test('good controls reward clean exact termination and expose audit-induced conservatism', () => {
  const original = drafts.drafts.find(item => item.id === 'AE-D010').response;
  const kept = score(recordFor({ draftId: 'AE-D010', action: 'KEEP', finalResponse: original }));
  assert.equal(kept.termination.cleanAuditTermination, true);
  assert.equal(kept.termination.noOpSuccess, true);
  assert.equal(kept.termination.normalizedWordEditDistance, 0);

  const rewritten = score(recordFor({
    draftId: 'AE-D010',
    action: 'RECONSTRUCT',
    finalResponse: `${original} You must also seek generic professional care.`,
    findingErrorIds: ['GENERIC_REFERRAL_LOOP'],
    findingVerdicts: { GENERIC_REFERRAL_LOOP: 'UNSUPPORTED' },
    finalPresent: ['GENERIC_REFERRAL_LOOP']
  }));
  assert.equal(rewritten.termination.noOpSuccess, false);
  assert.deepEqual(rewritten.regression.highIntroducedIds, ['GENERIC_REFERRAL_LOOP']);
  assert.ok(rewritten.length.inflationRatio > 1);
});

test('B repair arms require identical frozen finding bytes and deduplicate shared calls', () => {
  const patch = recordFor({ draftId: 'AE-D002', runId: 'AE-R0101', conditionId: 'B_PATCH', action: 'PATCH', findingErrorIds: ['CAUSAL_OVERCLAIM'], pairId: 'PAIR-B-1' });
  const reconstruct = recordFor({ draftId: 'AE-D002', runId: 'AE-R0102', conditionId: 'B_RECONSTRUCT', action: 'RECONSTRUCT', findingErrorIds: ['CAUSAL_OVERCLAIM'], pairId: 'PAIR-B-1' });
  const scoredPatch = score(patch);
  const scoredReconstruct = score(reconstruct);
  const summary = aggregate([scoredPatch, scoredReconstruct]);
  assert.equal(summary.experimentCost.runUniqueCallCount, 9);
  assert.equal(summary.experimentCost.calibrationCallCount, 6);
  assert.equal(summary.experimentCost.uniqueCallCount, 15);
  assert.equal(summary.bPairComparisons[0].marginalPairedAuditCallCount, 5);
  assert.equal(summary.bPairComparisons[0].marginalPairedTotalCallCount, 9);

  reconstruct.sharedFindingSetHash = '0'.repeat(64);
  assert.throws(() => score(reconstruct), /hash is invalid/);
  const mismatchedRisk = recordFor({ draftId: 'AE-D002', runId: 'AE-R0103', conditionId: 'B_RECONSTRUCT', action: 'RECONSTRUCT', findingErrorIds: ['CAUSAL_OVERCLAIM'], pairId: 'PAIR-B-2' });
  mismatchedRisk.frozenFindingSet.strongestRemainingRisk = 'A risk string not emitted by B3.';
  mismatchedRisk.sharedFindingSetCanonical = canonicalFindingBytes(mismatchedRisk.frozenFindingSet);
  mismatchedRisk.sharedFindingSetHash = sha256(mismatchedRisk.sharedFindingSetCanonical);
  assert.throws(() => score(mismatchedRisk), /complete B3 output/);
  const mismatched = { ...scoredReconstruct, pairing: { ...scoredReconstruct.pairing, sharedFindingSetHash: '1'.repeat(64) } };
  assert.throws(() => aggregate([scoredPatch, mismatched]), /mismatched finding hashes/);
  const rerunSpecialists = structuredClone(scoredReconstruct);
  rerunSpecialists.cost.auditCalls[0].id = 'DIFFERENT-B1-CALL';
  rerunSpecialists.cost.calls[0].id = 'DIFFERENT-B1-CALL';
  assert.throws(() => aggregate([scoredPatch, rerunSpecialists]), /identical specialist calls/);
});

test('micro weighting, unweighted recall, qualification, and Pareto data remain separate', () => {
  const first = score(recordFor({ draftId: 'AE-D001', runId: 'AE-R0201', findingErrorIds: ['REPETITION', 'LOW_INFORMATION_ADVICE'] }));
  const second = score(recordFor({ draftId: 'AE-D002', runId: 'AE-R0202', findingErrorIds: ['CAUSAL_OVERCLAIM'], finalPresent: ['SAFE_DOSE_INFERENCE', 'MIXED_TRAJECTORY_COLLAPSE'] }));
  const summary = aggregate([first, second]);
  const condition = summary.conditions[0];
  assert.notEqual(condition.macroWeightedDetectionRecall, condition.microWeightedDetectionRecall);
  assert.equal(condition.microDetectedSeeds, 3);
  assert.equal(condition.microSeededErrors, 5);
  assert.equal(summary.winner, null);
  assert.equal(summary.status, 'INCOMPLETE_DESCRIPTIVE_ONLY');
  assert.equal(summary.comparisonEnabled, false);
  assert.equal(condition.safetyQualified, null);
  assert.deepEqual(summary.paretoFrontierConditionIds, []);
});

test('aggregation requires exact schedule coverage and consistent reused grader outputs', () => {
  const first = score(recordFor({ draftId: 'AE-D002', runId: 'AE-R0301', conditionId: 'A_INTEGRATED', findingErrorIds: ['CAUSAL_OVERCLAIM'] }));
  const second = score(recordFor({ draftId: 'AE-D002', runId: 'AE-R0302', conditionId: 'D_RECONSTRUCT', findingErrorIds: ['CAUSAL_OVERCLAIM'] }));
  const frozenSchedule = scheduleFor([first, second]);
  assert.equal(aggregate([first, second], { schedule: frozenSchedule }).comparisonEnabled, false);

  const missingCell = structuredClone(frozenSchedule);
  missingCell.executionQueue.pop();
  assert.throws(() => aggregate([first, second], { schedule: missingCell }), /complete cross-product|cover the frozen schedule/);
  assert.throws(() => aggregate([first, second], { schedule: frozenSchedule, runMode: 'FULL' }), /every frozen draft/);

  const inconsistent = structuredClone(second);
  inconsistent.rawGrades.initial[0].errorJudgments[0].verdict = 'PRESENT';
  assert.throws(() => aggregate([first, inconsistent], { schedule: frozenSchedule }), /inconsistent reused output/);
});

test('a full crossed schedule enables qualification and Pareto reporting without selecting a winner', () => {
  const conditionIds = architectures.conditions.map(item => item.id).filter(id => id !== 'E_SELF_LOOP');
  const schedule = buildBlindedSchedule({
    draftIds: drafts.drafts.map(item => item.id),
    conditionIds,
    seed: 'full-fixture-seed-001',
    repeats: 1
  });
  const records = schedule.executionQueue.map(run => {
    const draft = drafts.drafts.find(item => item.id === run.draftId);
    const good = draft.controlIntent === 'GOOD_TERMINATION_CONTROL';
    const noAudit = run.conditionId === 'N_NO_AUDIT';
    const action = noAudit || good ? 'KEEP'
      : run.conditionId === 'B_PATCH' ? 'PATCH' : 'RECONSTRUCT';
    return recordFor({
      draftId: run.draftId,
      runId: run.runId,
      repeatId: run.repeatId,
      conditionId: run.conditionId,
      action,
      finalResponse: noAudit || good ? draft.response : 'Synthetic repaired response with a grounded next question.',
      findingErrorIds: noAudit || good ? [] : draft.seededErrorIds,
      finalPresent: noAudit ? draft.seededErrorIds : [],
      pairId: `PAIR-${run.draftId}-${run.repeatId}`,
      scheduledCriticOrder: run.criticOrder ?? undefined
    });
  });
  const scored = records.map(record => scoreRecord({
    record, cases, drafts, referenceTarget, rubric, architectures, unblinding: schedule.unblinding
  }));
  const summary = aggregateScores(scored, {
    cases, drafts, referenceTarget, rubric, architectures, controls, calibration, schedule, runMode: 'FULL'
  });
  assert.equal(summary.comparisonEnabled, true);
  assert.equal(summary.status, 'SCORED_NO_WINNER_SELECTED');
  assert.deepEqual(summary.paretoFrontierConditionIds, ['A_INTEGRATED']);
  assert.equal(summary.winner, null);
});

test('calibration is split by role and blocks scoring when any control fails', () => {
  assert.equal(validateCalibrationResult({ calibration, controls, drafts, referenceTarget, rubric }).passed, true);
  const failed = structuredClone(calibration);
  failed.findingValidator[0].verdict = 'UNSUPPORTED';
  assert.throws(() => validateCalibrationResult({ calibration: failed, controls, drafts, referenceTarget, rubric }), /gate failed/);
  const record = score(recordFor({ draftId: 'AE-D002', findingErrorIds: ['CAUSAL_OVERCLAIM'] }));
  assert.throws(() => aggregate([record], { calibration: failed }), /gate failed/);
  const badDimension = structuredClone(calibration);
  badDimension.finalResponseGrader[0].grade.dimensionJudgments[0].rating = 0;
  assert.throws(() => validateCalibrationResult({ calibration: badDimension, controls, drafts, referenceTarget, rubric }), /gate failed dimensions/);
});

test('word metrics are deterministic for fixture prose', () => {
  assert.deepEqual(wordTokens("Choice isn't proof; l'expérience compte."), ['choice', "isn't", 'proof', "l'expérience", 'compte']);
  assert.equal(normalizedWordEditDistance('same words', 'same words'), 0);
  assert.ok(normalizedWordEditDistance('short answer', 'a substantially different answer') > 0.5);
});
