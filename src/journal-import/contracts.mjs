import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { ValidationError } from "../core/errors.mjs";

export const JOURNAL_PROTOCOL_VERSION = "1.0";
export const JOURNAL_SCHEMA_NAMES = Object.freeze([
  "answer-result",
  "checkpoint",
  "extraction-result",
  "graph",
  "pattern-result",
  "reconciliation-result",
  "reference-result",
  "restricted-anchor",
  "review-result",
  "visual-result"
]);

const utf8 = new TextDecoder("utf-8", { fatal: true });
const active = (record) => !["deleted", "revoked"].includes(record.lifecycle);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code, details = undefined) {
  if (!condition) throw new ValidationError(code, { code, details });
}

function loadJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const schemaRoot = "../../schemas/journal-import/";
const schemas = Object.freeze(Object.fromEntries(JOURNAL_SCHEMA_NAMES.map((name) => [
  name,
  loadJson(`${schemaRoot}${name}.schema.json`)
])));
export const JOURNAL_GRAPH_CONTRACT = Object.freeze(loadJson(`${schemaRoot}contracts.json`));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));

export function journalSchema(name) {
  invariant(Object.hasOwn(schemas, name), "JOURNAL_SCHEMA_UNKNOWN");
  return structuredClone(schemas[name]);
}

export function validateJournalSchema(name, value) {
  const validator = validators.get(name);
  invariant(Boolean(validator), "JOURNAL_SCHEMA_UNKNOWN");
  if (!validator(value)) {
    throw new ValidationError("Journal payload does not satisfy its versioned schema.", {
      code: "JOURNAL_SCHEMA_INVALID",
      details: validator.errors.map(({ instancePath, keyword, message, params }) => ({ instancePath, keyword, message, params }))
    });
  }
  return structuredClone(value);
}

export function validateExtractionReferences(value, assignedUnitIds = []) {
  const result = validateJournalSchema("extraction-result", value);
  const entityIds = new Set(result.entities.map(({ local_id }) => local_id));
  const episodeIds = new Set(result.episodes.map(({ local_id }) => local_id));
  const assertionIds = new Set();
  const unitIds = new Set(assignedUnitIds);
  for (const assertion of result.assertions) {
    invariant(!assertionIds.has(assertion.local_id), "DUPLICATE_LOCAL_ASSERTION_ID");
    assertionIds.add(assertion.local_id);
    invariant(entityIds.has(assertion.speaker_local_id), "MISSING_LOCAL_SPEAKER");
    invariant(assertion.subject_local_ids.every((id) => entityIds.has(id)), "MISSING_LOCAL_SUBJECT");
    invariant(assertion.episode_local_id === null || episodeIds.has(assertion.episode_local_id), "MISSING_LOCAL_EPISODE");
    for (const anchor of assertion.anchors) {
      if (unitIds.size) invariant(unitIds.has(anchor.unit_id), "ANCHOR_OUTSIDE_ASSIGNED_UNITS");
    }
  }
  const covered = new Set();
  for (const item of result.coverage) {
    invariant(!covered.has(item.unit_id), "DUPLICATE_UNIT_COVERAGE");
    covered.add(item.unit_id);
    invariant(item.assertion_local_ids.every((id) => assertionIds.has(id)), "COVERAGE_UNKNOWN_ASSERTION");
  }
  if (unitIds.size) invariant([...unitIds].every((id) => covered.has(id)), "UNIT_COVERAGE_INCOMPLETE");
  return result;
}

export function splitUtf8(text, maximumBytes = JOURNAL_GRAPH_CONTRACT.source_defaults.core_target_utf8_bytes) {
  invariant(typeof text === "string" && Number.isSafeInteger(maximumBytes) && maximumBytes >= 4, "INVALID_PARTITION_INPUT");
  invariant(text.isWellFormed(), "MALFORMED_UNICODE");
  const bytes = Buffer.from(text, "utf8");
  const units = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + maximumBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    invariant(end > start, "INVALID_PARTITION_BOUNDARY");
    const slice = bytes.subarray(start, end);
    units.push({ start_byte: start, end_byte: end, text: utf8.decode(slice), sha256: sha256(slice) });
    start = end;
  }
  return units;
}

export function verifyUtf8Coverage(text, units) {
  invariant(typeof text === "string" && Array.isArray(units), "INVALID_COVERAGE_INPUT");
  const source = Buffer.from(text, "utf8");
  let next = 0;
  for (const unit of units) {
    invariant(unit.start_byte === next && Number.isSafeInteger(unit.end_byte) && unit.end_byte > next, "COVERAGE_GAP_OR_OVERLAP");
    invariant(unit.end_byte <= source.length, "COVERAGE_OUT_OF_RANGE");
    const slice = source.subarray(next, unit.end_byte);
    invariant(utf8.decode(slice) === unit.text && sha256(slice) === unit.sha256, "COVERAGE_BYTES_CHANGED");
    next = unit.end_byte;
  }
  invariant(next === source.length, "COVERAGE_INCOMPLETE");
  return Object.freeze({ bytes: next, units: units.length, byte_coverage: 1 });
}

export function resolveExactQuote(text, quote, occurrence = null) {
  invariant(typeof text === "string" && typeof quote === "string" && quote.length > 0, "INVALID_QUOTE");
  invariant(text.isWellFormed() && quote.isWellFormed(), "MALFORMED_UNICODE");
  const source = Buffer.from(text, "utf8");
  const target = Buffer.from(quote, "utf8");
  const hits = [];
  for (let at = 0; at <= source.length - target.length;) {
    const found = source.indexOf(target, at);
    if (found < 0) break;
    hits.push(found);
    at = found + 1;
  }
  invariant(hits.length > 0, "QUOTE_NOT_FOUND");
  invariant(occurrence !== null || hits.length === 1, "QUOTE_AMBIGUOUS");
  const index = occurrence ?? 0;
  invariant(Number.isSafeInteger(index) && index >= 0 && index < hits.length, "QUOTE_OCCURRENCE_INVALID");
  return Object.freeze({
    start_byte: hits[index],
    end_byte: hits[index] + target.length,
    quote,
    quote_sha256: sha256(target)
  });
}

// A time bound is an ISO 8601 calendar value at the precision its source supports, from a year to
// a millisecond, without a numeric offset: "2021", "2021-05", "2021-05-14", "2021-05-14T09:30",
// "2021-05-14T09:30:15" or "2021-05-14T09:30:15.250", a date-time optionally marked "Z". A known
// zone is kept in the time's separate timezone field. A bound names a period ("2021-05" is the
// whole of May 2021), and with the "Z" set aside, text order in this form is time order, so the
// timeline sorts and filters bounds without parsing them. Vague wording ("last summer") is not a
// bound; it stays in the time's raw text.
export const JOURNAL_TIME_BOUND_FORMS = Object.freeze(["YYYY", "YYYY-MM", "YYYY-MM-DD", "YYYY-MM-DDTHH:MM", "YYYY-MM-DDTHH:MM:SS", "YYYY-MM-DDTHH:MM:SS.sss", "any date-time form followed by Z"]);
const TIME_BOUND = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?Z?)?)?)?$/u;

export function isJournalTimeBound(value) {
  const match = typeof value === "string" ? TIME_BOUND.exec(value) : null;
  if (!match) return false;
  const [year, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match.slice(1).map((part) => (part === undefined ? undefined : Number(part)));
  // Built field by field so a month, day or time that does not exist (February 30, 24:00) shows up
  // as a value that changed, and so years before 100 are not read as 19xx.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

/** The text a bound is ordered by: the bound itself, without a trailing "Z". */
export function timeBoundOrderKey(bound) {
  return bound.endsWith("Z") ? bound.slice(0, -1) : bound;
}

/**
 * Whether the period one bound names begins no later than the period another names ends. A period
 * ends after every value that begins with its text, so it is enough to compare the first bound
 * with the second cut to the second's precision: "2021-05-20" begins before "2021-05" ends.
 */
export function timeBoundStartsByEndOf(earlier, later) {
  const end = timeBoundOrderKey(later);
  return timeBoundOrderKey(earlier).slice(0, end.length) <= end;
}

export function validateJournalGraph(graph, sourceRepresentations, contract = JOURNAL_GRAPH_CONTRACT) {
  validateJournalSchema("graph", graph);
  invariant(sourceRepresentations && typeof sourceRepresentations === "object" && !Array.isArray(sourceRepresentations), "REPRESENTATIONS_INVALID");
  const nodes = new Map();
  const ids = new Set();
  const sourceBindings = new Set();
  const representationBytes = new Map();
  const supportLinks = new Map();
  for (const record of [...graph.nodes, ...graph.edges]) {
    invariant(record.case_id === graph.case_id && record.corpus_id === graph.corpus_id, "CROSS_CASE_OR_CORPUS");
    invariant(!ids.has(record.id), "DUPLICATE_GRAPH_ID");
    ids.add(record.id);
  }
  for (const node of graph.nodes) {
    invariant(contract.node_kinds.includes(node.kind), "UNKNOWN_NODE_KIND");
    nodes.set(node.id, node);
    if (node.kind === "source") sourceBindings.add(`${node.data.representation_id}\0${node.data.original_object_id}`);
  }
  for (const edge of graph.edges) if (active(edge) && edge.relation === "supported_by") {
    if (!supportLinks.has(edge.from)) supportLinks.set(edge.from, []);
    supportLinks.get(edge.from).push(edge.to);
  }
  const requireNode = (id, kinds) => {
    const node = nodes.get(id);
    invariant(node && kinds.includes(node.kind), "DANGLING_OR_WRONG_KIND");
    return node;
  };
  const evidence = (evidenceIds, owner) => {
    invariant(Array.isArray(evidenceIds), "INVALID_EVIDENCE");
    for (const id of evidenceIds) {
      const passage = requireNode(id, ["passage"]);
      invariant(!active(owner) || active(passage), "ACTIVE_DEPENDS_ON_REVOKED");
    }
  };
  const validateTime = (value, owner) => {
    invariant(value && typeof value === "object", "TIME_MISSING");
    evidence(value.evidence_ids, owner);
    if (value.precision === "unknown") {
      invariant(value.from === null && value.to === null && value.timezone === null, "FALSE_TIME_PRECISION");
    }
    // Every bound that is present must be a calendar value the timeline can order: an interval open
    // at one end ("after May 2021") checks its one bound, and a closed one also checks that it does
    // not end before it starts.
    for (const bound of [value.from, value.to]) {
      invariant(bound === null || isJournalTimeBound(bound), "INVALID_TIME_BOUND", { expected: JOURNAL_TIME_BOUND_FORMS });
    }
    if (value.from !== null && value.to !== null) invariant(timeBoundStartsByEndOf(value.from, value.to), "INVALID_TIME_INTERVAL");
    if (value.precision !== "unknown") invariant(value.evidence_ids.length > 0, "TIME_WITHOUT_EVIDENCE");
  };
  for (const node of graph.nodes) {
    const data = node.data;
    if (node.kind === "source") {
      invariant(Object.hasOwn(sourceRepresentations, data.representation_id), "REPRESENTATION_MISSING");
      invariant(Buffer.byteLength(sourceRepresentations[data.representation_id], "utf8") === data.byte_length, "REPRESENTATION_LENGTH_MISMATCH");
    }
    if (node.kind === "passage") {
      invariant(Object.hasOwn(sourceRepresentations, data.representation_id), "REPRESENTATION_MISSING");
      if (!representationBytes.has(data.representation_id)) representationBytes.set(data.representation_id, Buffer.from(sourceRepresentations[data.representation_id], "utf8"));
      const bytes = representationBytes.get(data.representation_id);
      invariant(Number.isSafeInteger(data.start_byte) && Number.isSafeInteger(data.end_byte)
        && data.start_byte >= 0 && data.end_byte > data.start_byte && data.end_byte <= bytes.length, "SPAN_RANGE_INVALID");
      const piece = bytes.subarray(data.start_byte, data.end_byte);
      invariant(sha256(piece) === data.quote_sha256, "SPAN_INTEGRITY_FAILED");
      if (data.disclosure === "restricted") invariant(data.quote === null, "RESTRICTED_QUOTE_EXPOSED");
      else invariant(utf8.decode(piece) === data.quote, "SPAN_INTEGRITY_FAILED");
      invariant(sourceBindings.has(`${data.representation_id}\0${data.locator.original_object_id}`), "PASSAGE_SOURCE_BINDING_MISSING");
    }
    if (["entity", "episode", "theme", "assertion"].includes(node.kind)) evidence(data.evidence_ids, node);
    if (["episode", "assertion"].includes(node.kind)) {
      validateTime(data.authored_time, node);
      validateTime(data.event_time, node);
    }
    if (node.kind === "assertion") {
      invariant(data.evidence_ids.length > 0, "ASSERTION_WITHOUT_SOURCE");
      invariant(data.still_current === null, "IMPORT_PROMOTED_TO_CURRENT");
      requireNode(data.speaker_id, ["entity"]);
      data.subject_ids.forEach((id) => requireNode(id, ["entity"]));
      if (data.episode_id !== null) requireNode(data.episode_id, ["episode"]);
      if (data.assertion_kind === "dream") invariant(data.narrative_mode === "dream", "DREAM_SCOPE_LOST");
      if (data.assertion_kind === "imaginal_experience") invariant(data.narrative_mode === "imaginal", "IMAGINAL_SCOPE_LOST");
      const links = [...(supportLinks.get(node.id) ?? [])].sort();
      if (active(node)) invariant(JSON.stringify([...data.evidence_ids].sort()) === JSON.stringify(links), "EVIDENCE_EDGE_MISMATCH");
    }
    if (node.kind === "pattern") {
      invariant(data.support_assertion_ids.length > 0, "PATTERN_WITHOUT_SUPPORT");
      for (const id of [...data.support_assertion_ids, ...data.counter_assertion_ids]) {
        const assertion = requireNode(id, ["assertion"]);
        invariant(!active(node) || active(assertion), "PATTERN_REVOKED_SUPPORT");
      }
      if (data.pattern_kind === "recurrent") {
        const groups = new Set(data.support_assertion_ids.map((id) => nodes.get(id).data.support_group_id));
        invariant(groups.size >= 2, "RECURRENCE_FROM_ONE_EPISODE");
      }
      if (data.review_state === "reviewed") {
        invariant(data.disconfirmation.status === "complete" && data.disconfirmation.search_receipt_ref
          && data.independent_review_ref, "PATTERN_REVIEW_EVIDENCE_MISSING");
      }
    }
  }
  for (const edge of graph.edges) {
    const specification = contract.relations[edge.relation];
    invariant(specification, "UNAUTHORIZED_EDGE_TYPE");
    const from = requireNode(edge.from, specification.from_kinds);
    const to = requireNode(edge.to, specification.to_kinds);
    if (active(edge)) invariant(active(from) && active(to), "ACTIVE_EDGE_TO_REVOKED");
    evidence(edge.evidence_ids, edge);
    invariant(edge.evidence_ids.length > 0, "EDGE_WITHOUT_EVIDENCE");
    if (["derived_proposal", "reviewed_derivation"].includes(edge.basis)) invariant(edge.derivation_ref, "DERIVATION_MISSING");
    if (edge.relation === "corrects") invariant(from.data.assertion_kind === "explicit_correction", "CORRECTION_WITHOUT_CORRECTION_ASSERTION");
    if (edge.relation === "reported_effect_of") {
      invariant(edge.basis === "author_attribution", "CAUSAL_PROMOTION");
      invariant(from.data.assertion_kind === "reported_outcome" && to.data.assertion_kind === "reported_action", "INTENTION_CONFUSED_WITH_EFFECTIVE_ACTION");
    }
  }
  return Object.freeze({ result: "PASS_STRUCTURAL_GRAPH_ONLY", nodes: nodes.size, edges: graph.edges.length });
}

export function correctionClosure(graph, seedIds, maximumNodes = 100) {
  invariant(Number.isSafeInteger(maximumNodes) && maximumNodes > 0, "INVALID_BUDGET");
  const nodeMap = new Map(graph.nodes.filter(active).map((node) => [node.id, node]));
  const mandatory = new Set(JOURNAL_GRAPH_CONTRACT.mandatory_closure_relations);
  const selected = new Set();
  const queue = [];
  const add = (id) => {
    invariant(nodeMap.has(id), "UNAVAILABLE_SEED_OR_DEPENDENCY");
    if (!selected.has(id)) { selected.add(id); queue.push(id); }
  };
  seedIds.forEach(add);
  while (queue.length) {
    const id = queue.shift();
    const node = nodeMap.get(id);
    if (selected.size > maximumNodes) return { status: "insufficient_context", nodes: [], edges: [], more_available: true };
    for (const edge of graph.edges.filter(active)) {
      if (mandatory.has(edge.relation) && (edge.from === id || edge.to === id)) {
        add(edge.from);
        add(edge.to);
        edge.evidence_ids.forEach(add);
      }
    }
    (node.data.evidence_ids ?? []).forEach(add);
    if (node.kind === "pattern") [...node.data.support_assertion_ids, ...node.data.counter_assertion_ids].forEach(add);
    if (node.kind === "passage") {
      const source = graph.nodes.find((candidate) => candidate.kind === "source"
        && candidate.data.original_object_id === node.data.locator.original_object_id
        && candidate.data.representation_id === node.data.representation_id);
      invariant(source, "PASSAGE_SOURCE_BINDING_MISSING");
      add(source.id);
    }
    if (node.kind === "assertion") {
      add(node.data.speaker_id);
      node.data.subject_ids.forEach(add);
      if (node.data.episode_id) add(node.data.episode_id);
    }
  }
  if (selected.size > maximumNodes) return { status: "insufficient_context", nodes: [], edges: [], more_available: true };
  return Object.freeze({
    status: "complete_for_seeds",
    nodes: [...selected].map((id) => nodeMap.get(id)),
    edges: graph.edges.filter((edge) => active(edge) && selected.has(edge.from) && selected.has(edge.to)),
    more_available: false
  });
}

export function affectedJournalDependents(graph, removedIds) {
  const result = new Set(removedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const dependencies = [
        ...(node.data.evidence_ids ?? []),
        ...(node.data.support_assertion_ids ?? []),
        ...(node.data.counter_assertion_ids ?? [])
      ];
      if (node.kind === "passage") {
        const source = graph.nodes.find((candidate) => candidate.kind === "source"
          && candidate.data.original_object_id === node.data.locator.original_object_id
          && candidate.data.representation_id === node.data.representation_id);
        if (source) dependencies.push(source.id);
      }
      if (dependencies.some((id) => result.has(id)) && !result.has(node.id)) { result.add(node.id); changed = true; }
    }
    for (const edge of graph.edges) {
      if ([edge.from, edge.to, ...edge.evidence_ids].some((id) => result.has(id)) && !result.has(edge.id)) {
        result.add(edge.id);
        changed = true;
      }
    }
  }
  return [...result].sort();
}

export function scoreJournalReference(referenceIds, assessments) {
  invariant(new Set(referenceIds).size === referenceIds.length, "DUPLICATE_REFERENCE");
  const counts = { preserved: 0, omitted: 0, distorted: 0, unassessed: 0 };
  const records = new Map();
  for (const assessment of assessments) {
    invariant(referenceIds.includes(assessment.target_id), "UNKNOWN_REFERENCE");
    invariant(!records.has(assessment.target_id), "DUPLICATE_ASSESSMENT");
    invariant(Object.hasOwn(counts, assessment.outcome), "INVALID_OUTCOME");
    records.set(assessment.target_id, assessment);
  }
  for (const id of referenceIds) counts[records.get(id)?.outcome ?? "unassessed"] += 1;
  return Object.freeze({
    denominator: referenceIds.length,
    counts,
    reference_set_recall: referenceIds.length ? counts.preserved / referenceIds.length : null,
    global_recall: null,
    scope: "frozen_reference_set_only"
  });
}

export function checkIndependentJournalReceipt(receipt, binding) {
  invariant(receipt?.authority === "trusted_transport", "UNTRUSTED_RECEIPT");
  invariant(receipt.target_generation === binding.target_generation, "STALE_GENERATION");
  invariant(receipt.protocol_digest === binding.protocol_digest, "WRONG_PROTOCOL");
  invariant(receipt.producer_context_id === binding.producer_context_id, "WRONG_PRODUCER");
  invariant(typeof receipt.context_id === "string" && receipt.context_id && receipt.context_id !== binding.producer_context_id, "SAME_CONTEXT");
  invariant(receipt.source_first_frozen === true && receipt.input_manifest_ref && receipt.output_ref, "REVIEW_NOT_FROZEN");
  invariant(receipt.information_firewall === "source_first_then_candidate", "INFORMATION_FIREWALL_MISSING");
  return Object.freeze({ metadata_compatible: true, receipt_authenticity: "must_be_checked_by_runtime_adapter" });
}
