import { createHash } from 'node:crypto';
import Ajv from 'ajv';

export const GRADER_OUTPUT_CONTRACT_VERSION = 'AE-GRADER-SEGMENT-EVIDENCE-V2';
export const GATING_JSON_START = 'BEGIN_GATING_JSON';
export const GATING_JSON_END = 'END_GATING_JSON';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nextNonWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
  return cursor;
}

function sentenceEnd(source, punctuationIndex) {
  let cursor = punctuationIndex + 1;
  while (cursor < source.length && /[.!?…"'’”\)\]]/u.test(source[cursor])) cursor += 1;
  return cursor;
}

export function buildSourceSegments(source) {
  invariant(typeof source === 'string' && source.trim(), 'evidence source must be non-empty text');
  const ranges = [];
  let start = nextNonWhitespace(source, 0);
  let cursor = start;
  while (cursor < source.length) {
    if (/[.!?…]/u.test(source[cursor])) {
      const end = sentenceEnd(source, cursor);
      if (end === source.length || /\s/u.test(source[end])) {
        ranges.push([start, end]);
        start = nextNonWhitespace(source, end);
        cursor = start;
        continue;
      }
    }
    cursor += 1;
  }
  if (start < source.length) ranges.push([start, source.length]);
  invariant(ranges.length > 0, 'evidence source produced no segments');
  return ranges.map(([startOffset, endOffset], index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    startOffset,
    endOffset,
    text: source.slice(startOffset, endOffset)
  }));
}

export function graderEnvelopeInstructions() {
  return {
    contractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    gatingJsonStart: GATING_JSON_START,
    gatingJsonEnd: GATING_JSON_END,
    requiredOrder: [GATING_JSON_START, 'JSON_MATCHING_OUTPUT_SCHEMA', GATING_JSON_END, 'OPTIONAL_NON_GATING_RATIONALE'],
    rules: [
      'Put only the score-bearing JSON between the two gating markers, with no Markdown fence.',
      'The gating JSON may contain only the enum values, numeric ratings, opaque IDs, source segment IDs, and target omission IDs permitted by outputSchema.',
      'Do not put explanations, quotations, or other free-form prose inside the gating JSON.',
      'After END_GATING_JSON, you may add concise prose keyed by judgment ID. It is archived exactly for human review but is never parsed, scored, repaired, or required for admission.'
    ]
  };
}

export function parseGraderOutputEnvelope({ rawOutput, outputSchema }) {
  invariant(typeof rawOutput === 'string' && rawOutput.length > 0, 'raw grader output is required');
  invariant(outputSchema && typeof outputSchema === 'object' && !Array.isArray(outputSchema), 'grader output schema is required');
  const starts = [...rawOutput.matchAll(new RegExp(GATING_JSON_START, 'gu'))];
  const ends = [...rawOutput.matchAll(new RegExp(GATING_JSON_END, 'gu'))];
  invariant(starts.length === 1 && ends.length === 1, 'grader output must contain exactly one gating marker pair');
  const start = starts[0].index + GATING_JSON_START.length;
  const end = ends[0].index;
  invariant(start <= end, 'grader gating markers are out of order');
  const gatingJson = rawOutput.slice(start, end).trim();
  invariant(gatingJson.length > 0, 'grader gating JSON is empty');
  let gatingResult;
  try {
    gatingResult = JSON.parse(gatingJson);
  } catch (error) {
    throw new Error(`grader gating JSON is invalid: ${error.message}`);
  }
  const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
  let validate;
  try {
    validate = ajv.compile(outputSchema);
  } catch {
    throw new Error('grader output schema is invalid');
  }
  invariant(validate(gatingResult), 'grader gating JSON violates outputSchema');
  const before = rawOutput.slice(0, starts[0].index);
  const after = rawOutput.slice(ends[0].index + GATING_JSON_END.length);
  invariant(before.trim().length === 0, 'grader output cannot contain prose before the gating JSON');
  return {
    contractVersion: GRADER_OUTPUT_CONTRACT_VERSION,
    rawOutput,
    gatingResult,
    gatingJson,
    gatingOutputHash: sha256(gatingJson),
    nonGatingRationale: after,
    rawOutputHash: sha256(rawOutput)
  };
}
