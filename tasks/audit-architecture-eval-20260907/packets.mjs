import {
  GRADER_OUTPUT_CONTRACT_VERSION,
  buildSourceSegments,
  graderEnvelopeInstructions
} from './grading-contract.mjs';

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

function publicSegments(source) {
  return buildSourceSegments(source).map(({ id, text }) => ({ id, text }));
}

function evidenceSchema(segmentIds, targetIds) {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'segmentIds'],
        properties: {
          kind: { const: 'SOURCE_SEGMENTS' },
          segmentIds: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { enum: segmentIds }
          }
        }
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'targetId'],
        properties: {
          kind: { const: 'TARGET_OMISSION' },
          targetId: { enum: targetIds }
        }
      }
    ]
  };
}

function responseGradeBodySchema(rubric, segmentIds) {
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
          oneOf: rubric.errorClasses.map(item => ({
            type: 'object',
            additionalProperties: false,
            required: ['errorId', 'verdict', 'evidence'],
            properties: {
              errorId: { const: item.id },
              verdict: { enum: ['PRESENT', 'ABSENT', 'UNCERTAIN'] },
              evidence: evidenceSchema(segmentIds, item.targetIds)
            }
          }))
        }
      },
      dimensionJudgments: {
        type: 'array',
        minItems: rubric.behavioralDimensions.length,
        maxItems: rubric.behavioralDimensions.length,
        items: {
          oneOf: rubric.behavioralDimensions.map(item => ({
            type: 'object',
            additionalProperties: false,
            required: ['dimensionId', 'rating', 'evidence'],
            properties: {
              dimensionId: { const: item.id },
              rating: { type: 'integer', minimum: 0, maximum: 4 },
              evidence: evidenceSchema(segmentIds, item.targetIds)
            }
          }))
        }
      }
    }
  };
}

function responseGradeSchema(opaqueItemId, rubric, segmentIds) {
  const body = responseGradeBodySchema(rubric, segmentIds);
  return {
    ...body,
    required: ['opaqueItemId', ...body.required],
    properties: { opaqueItemId: { const: opaqueItemId }, ...body.properties }
  };
}

function findingValidationBodySchema(findings, rubric, segmentIds) {
  const errorById = new Map(rubric.errorClasses.map(item => [item.id, item]));
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
          oneOf: findings.map(finding => {
            const criterion = errorById.get(finding.errorId);
            invariant(criterion, `finding ${finding.id} has an unknown errorId`);
            return {
              type: 'object',
              additionalProperties: false,
              required: ['findingId', 'verdict', 'evidence'],
              properties: {
                findingId: { const: finding.id },
                verdict: { enum: ['SUPPORTED', 'UNSUPPORTED', 'UNRESOLVED'] },
                evidence: evidenceSchema(segmentIds, criterion.targetIds)
              }
            };
          })
        }
      }
    }
  };
}

function findingValidationSchema(opaqueItemId, findings, rubric, segmentIds) {
  const body = findingValidationBodySchema(findings, rubric, segmentIds);
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
  const sourceSegments = publicSegments(candidateResponse);
  return {
    schemaVersion: 2,
    graderOutputContractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    opaqueItemId,
    role: 'BLINDED_COMPLETE_RESPONSE_GRADER',
    task: 'Judge the response exhaustively against every error class and behavioral dimension. Treat the behavioral target as a reference and rubric, not proof of one uniquely correct therapeutic answer. Use only case evidence. Do not infer the producing architecture, model, or rationale. Cover each error and dimension ID exactly once. Cite one to three supplied source segment IDs for text evidence, or a criterion-allowed target ID for an omission. Do not copy quotations or put explanations inside the gating JSON. Do not rewrite the answer.',
    responseEnvelope: graderEnvelopeInstructions(),
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    behavioralDimensions: rubric.behavioralDimensions,
    candidateResponse,
    sourceSegments,
    outputSchema: responseGradeSchema(opaqueItemId, rubric, sourceSegments.map(item => item.id))
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
  const segmentedItems = items.map(item => ({ ...item, sourceSegments: publicSegments(item.candidateResponse) }));
  return {
    schemaVersion: 2,
    graderOutputContractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    opaqueBatchId,
    role: 'BLINDED_COMPLETE_RESPONSE_GRADER_BATCH',
    task: 'Independently judge every opaque response exhaustively against every error class and behavioral dimension. Treat the behavioral target as a reference and rubric, not proof of one uniquely correct therapeutic answer. Use only case evidence. The items are randomly ordered and may not be mapped to architectures, models, or run roles. Cover every opaque item, error ID, and dimension ID exactly once. For each judgment, cite one to three supplied source segment IDs or a criterion-allowed target omission ID. Do not copy quotations or put explanations inside the gating JSON. Do not rewrite any answer.',
    responseEnvelope: graderEnvelopeInstructions(),
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    behavioralDimensions: rubric.behavioralDimensions,
    candidateResponses: segmentedItems,
    outputSchema: batchSchema(opaqueBatchId, segmentedItems, item => responseGradeBodySchema(rubric, item.sourceSegments.map(segment => segment.id)))
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
  const sourceSegments = publicSegments(draftResponse);
  return {
    schemaVersion: 2,
    graderOutputContractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    opaqueItemId,
    role: 'BLINDED_FINDING_SUPPORT_VALIDATOR',
    task: 'Judge only whether each frozen finding is supported by the case and draft. Cover each finding ID exactly once. Cite one to three supplied source segment IDs for text evidence, or an error-class-allowed target ID for a missing behavior. Do not copy quotations or put explanations inside the gating JSON. A proposed draftQuote is a claim to verify, not proof of an error. Do not decide whether a finding was seeded, infer the producing architecture, or repair the response.',
    responseEnvelope: graderEnvelopeInstructions(),
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    draftResponse,
    sourceSegments,
    findings,
    outputSchema: findingValidationSchema(opaqueItemId, findings, rubric, sourceSegments.map(item => item.id))
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
  const segmentedItems = items.map(item => ({ ...item, sourceSegments: publicSegments(item.draftResponse) }));
  return {
    schemaVersion: 2,
    graderOutputContractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    opaqueBatchId,
    role: 'BLINDED_FINDING_SUPPORT_VALIDATOR_BATCH',
    task: 'Independently judge only whether every frozen finding in every opaque item is supported by that item\'s case and draft. The items are randomly ordered and may not be mapped to architectures, models, or run roles. Cover every opaque item and finding ID exactly once. For each judgment, cite one to three supplied source segment IDs or an error-class-allowed target omission ID. Do not copy quotations or put explanations inside the gating JSON. A proposed draftQuote is a claim to verify, not proof of an error. Do not decide whether a finding was seeded and do not repair responses.',
    responseEnvelope: graderEnvelopeInstructions(),
    caseEvidence: publicCaseEvidence(caseFixture),
    settledHistory: caseFixture.settledHistory,
    behavioralTarget: {
      required: referenceTarget.required,
      forbidden: referenceTarget.forbidden
    },
    errorTaxonomy: rubric.errorClasses,
    items: segmentedItems,
    outputSchema: batchSchema(opaqueBatchId, segmentedItems, item => findingValidationBodySchema(item.findings, rubric, item.sourceSegments.map(segment => segment.id)))
  };
}
