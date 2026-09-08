function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function byId(items, id, label) {
  const item = items.find(candidate => candidate.id === id);
  invariant(item, `${label} ${id} was not found`);
  return item;
}

function publicCaseEvidence(caseFixture) {
  return {
    id: caseFixture.id,
    actors: caseFixture.actors,
    turns: caseFixture.turns,
    facts: caseFixture.facts
  };
}

function genericTaxonomy(rubric) {
  return rubric.errorClasses.map(({ id, severity, definition, repairTarget }) => ({ id, severity, definition, repairTarget }));
}

function stageContract(architectures, stageId) {
  for (const architecture of architectures.architectures) {
    const stage = architecture.stages.find(candidate => candidate.id === stageId);
    if (stage) return stage;
  }
  throw new Error(`stage ${stageId} was not found`);
}

function stageViews(stage, repairMode) {
  if (stage.seesByRepairMode || stage.promptByRepairMode) {
    invariant(repairMode && stage.seesByRepairMode?.[repairMode] && stage.promptByRepairMode?.[repairMode], `stage repair mode ${repairMode} is invalid`);
    return { sees: stage.seesByRepairMode[repairMode], prompt: stage.promptByRepairMode[repairMode] };
  }
  return { sees: stage.sees, prompt: stage.prompt };
}

export function buildAuditStagePacket({
  opaqueCallId,
  caseId,
  draftId,
  stageId,
  repairMode = null,
  cases,
  drafts,
  rubric,
  architectures,
  priorInputs = {}
}) {
  invariant(typeof opaqueCallId === 'string' && opaqueCallId.trim(), 'opaqueCallId is required');
  const caseFixture = byId(cases.cases, caseId, 'case');
  const draft = byId(drafts.drafts, draftId, 'draft');
  invariant(drafts.caseId === caseId, 'draft and case binding is invalid');
  const stage = stageContract(architectures, stageId);
  const { sees, prompt } = stageViews(stage, repairMode);
  const allowed = {
    case: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    draft: draft.response,
    currentDraft: priorInputs.currentDraft ?? draft.response,
    errorTaxonomy: genericTaxonomy(rubric)
  };
  const payload = {};
  for (const key of sees) {
    if (Object.hasOwn(allowed, key)) payload[key] = allowed[key];
    else {
      invariant(Object.hasOwn(priorInputs, key), `stage input ${key} is required`);
      payload[key] = priorInputs[key];
    }
  }
  return {
    schemaVersion: 1,
    opaqueCallId,
    role: 'SYNTHETIC_THERAPY_RESPONSE_AUDIT_STAGE',
    sharedRules: architectures.sharedRules,
    task: prompt,
    payload,
    outputSchema: architectures.schemas[stage.outputSchemaRef]
  };
}

export function buildResponseGradePacket({
  opaqueItemId,
  caseId,
  candidateResponse,
  cases,
  referenceTarget,
  rubric
}) {
  invariant(typeof opaqueItemId === 'string' && opaqueItemId.trim(), 'opaqueItemId is required');
  invariant(typeof candidateResponse === 'string' && candidateResponse.trim(), 'candidateResponse is required');
  const caseFixture = byId(cases.cases, caseId, 'case');
  invariant(referenceTarget.caseId === caseId, 'reference target and case binding is invalid');
  return {
    schemaVersion: 1,
    opaqueItemId,
    role: 'BLINDED_COMPLETE_RESPONSE_GRADER',
    task: 'Judge the response exhaustively against every error class and behavioral dimension. Treat the behavioral target as a reference and rubric, not proof of one uniquely correct therapeutic answer. Use only case evidence. Do not infer the producing architecture, model, or rationale. Return evidence for every judgment; do not rewrite the answer.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    behavioralDimensions: rubric.behavioralDimensions,
    candidateResponse,
    outputContract: {
      opaqueItemId,
      errorJudgments: rubric.errorClasses.map(item => ({ errorId: item.id, verdict: 'PRESENT|ABSENT|UNCERTAIN', reason: 'nonempty', evidence: 'exact quote or criterion-specific target omission ID' })),
      dimensionJudgments: rubric.behavioralDimensions.map(item => ({ dimensionId: item.id, rating: 'integer 0..4', reason: 'nonempty', evidence: 'exact quote or criterion-specific target omission ID' }))
    }
  };
}

export function buildFindingValidationPacket({
  opaqueItemId,
  caseId,
  draftResponse,
  findings,
  cases,
  referenceTarget,
  rubric
}) {
  invariant(typeof opaqueItemId === 'string' && opaqueItemId.trim(), 'opaqueItemId is required');
  invariant(typeof draftResponse === 'string' && draftResponse.trim(), 'draftResponse is required');
  invariant(Array.isArray(findings), 'findings must be an array');
  const caseFixture = byId(cases.cases, caseId, 'case');
  return {
    schemaVersion: 1,
    opaqueItemId,
    role: 'BLINDED_FINDING_SUPPORT_VALIDATOR',
    task: 'Judge only whether each frozen finding is supported by the case and draft. Do not decide whether it was seeded, infer the producing architecture, or repair the response.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    draftResponse,
    findings,
    outputContract: {
      opaqueItemId,
      judgments: findings.map(item => ({ findingId: item.id, verdict: 'SUPPORTED|UNSUPPORTED|UNRESOLVED', reason: 'nonempty', evidence: 'exact draft quote or criterion-specific target omission ID' }))
    }
  };
}
