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

function evidenceSchema() {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'quote'],
        properties: {
          kind: { const: 'QUOTE' },
          quote: { type: 'string', minLength: 1 }
        }
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'targetId'],
        properties: {
          kind: { const: 'OMISSION' },
          targetId: { type: 'string', minLength: 1 }
        }
      }
    ]
  };
}

function responseGradeBodySchema(rubric) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['errorJudgments', 'dimensionJudgments'],
    properties: {
      errorJudgments: {
        type: 'array',
        minItems: rubric.errorClasses.length,
        maxItems: rubric.errorClasses.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['errorId', 'verdict', 'reason', 'evidence'],
          properties: {
            errorId: { enum: rubric.errorClasses.map(item => item.id) },
            verdict: { enum: ['PRESENT', 'ABSENT', 'UNCERTAIN'] },
            reason: { type: 'string', minLength: 1 },
            evidence: evidenceSchema()
          }
        }
      },
      dimensionJudgments: {
        type: 'array',
        minItems: rubric.behavioralDimensions.length,
        maxItems: rubric.behavioralDimensions.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dimensionId', 'rating', 'reason', 'evidence'],
          properties: {
            dimensionId: { enum: rubric.behavioralDimensions.map(item => item.id) },
            rating: { type: 'integer', minimum: 0, maximum: 4 },
            reason: { type: 'string', minLength: 1 },
            evidence: evidenceSchema()
          }
        }
      }
    }
  };
}

function responseGradeSchema(opaqueItemId, rubric) {
  const body = responseGradeBodySchema(rubric);
  return {
    ...body,
    required: ['opaqueItemId', ...body.required],
    properties: { opaqueItemId: { const: opaqueItemId }, ...body.properties }
  };
}

function findingValidationBodySchema(findings) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['judgments'],
    properties: {
      judgments: {
        type: 'array',
        minItems: findings.length,
        maxItems: findings.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['findingId', 'verdict', 'reason', 'evidence'],
          properties: {
            findingId: { enum: findings.map(item => item.id) },
            verdict: { enum: ['SUPPORTED', 'UNSUPPORTED', 'UNRESOLVED'] },
            reason: { type: 'string', minLength: 1 },
            evidence: evidenceSchema()
          }
        }
      }
    }
  };
}

function findingValidationSchema(opaqueItemId, findings) {
  const body = findingValidationBodySchema(findings);
  return {
    ...body,
    required: ['opaqueItemId', ...body.required],
    properties: { opaqueItemId: { const: opaqueItemId }, ...body.properties }
  };
}

function batchSchema(opaqueBatchId, items, bodySchemaFor) {
  const itemIds = items.map(item => item.opaqueItemId);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['opaqueBatchId', 'results'],
    properties: {
      opaqueBatchId: { const: opaqueBatchId },
      results: {
        type: 'object',
        additionalProperties: false,
        required: itemIds,
        properties: Object.fromEntries(items.map(item => [item.opaqueItemId, bodySchemaFor(item)]))
      }
    }
  };
}

function validateBatchIdentity(opaqueBatchId, items) {
  invariant(typeof opaqueBatchId === 'string' && opaqueBatchId.trim(), 'opaqueBatchId is required');
  invariant(Array.isArray(items) && items.length > 0, 'batch items are required');
  const itemIds = items.map(item => item.opaqueItemId);
  invariant(itemIds.every(id => typeof id === 'string' && id.trim()), 'every batch item needs an opaqueItemId');
  invariant(new Set(itemIds).size === itemIds.length, 'batch opaqueItemIds must be unique');
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
    task: 'Judge the response exhaustively against every error class and behavioral dimension. Treat the behavioral target as a reference and rubric, not proof of one uniquely correct therapeutic answer. Use only case evidence. Do not infer the producing architecture, model, or rationale. Return only JSON matching outputSchema exactly and cover each error and dimension ID exactly once. QUOTE evidence must be an exact nonempty substring of candidateResponse. OMISSION evidence must use a targetId allowed by that criterion. Do not rewrite the answer.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    behavioralDimensions: rubric.behavioralDimensions,
    candidateResponse,
    outputSchema: responseGradeSchema(opaqueItemId, rubric)
  };
}

export function buildResponseGradeBatchPacket({
  opaqueBatchId,
  caseId,
  items,
  cases,
  referenceTarget,
  rubric
}) {
  validateBatchIdentity(opaqueBatchId, items);
  invariant(items.every(item => typeof item.candidateResponse === 'string' && item.candidateResponse.trim()), 'every response batch item needs candidateResponse');
  const responseBytes = items.map(item => item.candidateResponse);
  invariant(new Set(responseBytes).size === responseBytes.length, 'response batches must deduplicate exact candidateResponse bytes');
  const caseFixture = byId(cases.cases, caseId, 'case');
  invariant(referenceTarget.caseId === caseId, 'reference target and case binding is invalid');
  return {
    schemaVersion: 1,
    opaqueBatchId,
    role: 'BLINDED_COMPLETE_RESPONSE_GRADER_BATCH',
    task: 'Independently judge every opaque response exhaustively against every error class and behavioral dimension. Treat the behavioral target as a reference and rubric, not proof of one uniquely correct therapeutic answer. Use only case evidence. The items are randomly ordered and may not be mapped to architectures, models, or run roles. Return only JSON matching outputSchema exactly and cover every opaque item, error ID, and dimension ID exactly once. For each item, QUOTE evidence must be an exact nonempty substring of that item\'s candidateResponse. OMISSION evidence must use a targetId allowed by that criterion. Keep reasons concise. Do not rewrite any answer.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    behavioralDimensions: rubric.behavioralDimensions,
    candidateResponses: items,
    outputSchema: batchSchema(opaqueBatchId, items, () => responseGradeBodySchema(rubric))
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
    task: 'Judge only whether each frozen finding is supported by the case and draft. Return only JSON matching outputSchema exactly and cover each finding ID exactly once. QUOTE evidence must be an exact nonempty substring of draftResponse. OMISSION evidence must use a targetId allowed by the finding error class. A proposed draftQuote is a claim to verify, not evidence that the text appears in draftResponse. Do not decide whether a finding was seeded, infer the producing architecture, or repair the response.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    draftResponse,
    findings,
    outputSchema: findingValidationSchema(opaqueItemId, findings)
  };
}

export function buildFindingValidationBatchPacket({
  opaqueBatchId,
  caseId,
  items,
  cases,
  referenceTarget,
  rubric
}) {
  validateBatchIdentity(opaqueBatchId, items);
  for (const item of items) {
    invariant(typeof item.draftResponse === 'string' && item.draftResponse.trim(), `${item.opaqueItemId} needs draftResponse`);
    invariant(Array.isArray(item.findings) && item.findings.length > 0, `${item.opaqueItemId} needs findings`);
  }
  const bundleBytes = items.map(item => JSON.stringify({ draftResponse: item.draftResponse, findings: item.findings }));
  invariant(new Set(bundleBytes).size === bundleBytes.length, 'finding batches must deduplicate exact draft-and-finding bundles');
  const caseFixture = byId(cases.cases, caseId, 'case');
  return {
    schemaVersion: 1,
    opaqueBatchId,
    role: 'BLINDED_FINDING_SUPPORT_VALIDATOR_BATCH',
    task: 'Independently judge only whether every frozen finding in every opaque item is supported by that item\'s case and draft. The items are randomly ordered and may not be mapped to architectures, models, or run roles. Return only JSON matching outputSchema exactly and cover every opaque item and finding ID exactly once. For each item, QUOTE evidence must be an exact nonempty substring of that item\'s draftResponse. OMISSION evidence must use a targetId allowed by the finding error class. A proposed draftQuote is a claim to verify, not evidence that the text appears. Keep reasons concise. Do not decide whether a finding was seeded and do not repair responses.',
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    items,
    outputSchema: batchSchema(opaqueBatchId, items, item => findingValidationBodySchema(item.findings))
  };
}
