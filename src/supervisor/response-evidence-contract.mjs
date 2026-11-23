import { ValidationError } from "../core/errors.mjs";
import { compatibilityStateBinding } from "../case-formulation/protective-compatibility.mjs";
import { applyTranscriptAmendments } from "../storage/transcript-amendments.mjs";
import { projectCommunicationState } from "../storage/private-case-communication.mjs";
import { foreignCommunicationSignature, sha256Json, sha256Text } from "../storage/private-case-supervisor.mjs";

export { sha256Json, sha256Text };
export const RESPONSE_EVIDENCE_POLICY_VERSION = "response-evidence-v1";
export const RESPONSE_EVIDENCE_DIMENSIONS = Object.freeze([
  "prior_delivery", "personal_history", "history_dependent_advice", "source_consultation_claims", "coverage_scope_and_conflicts"
]);
export const RESPONSE_EVIDENCE_ASSESSMENTS = Object.freeze(["supported", "contradicted", "unsupported", "uncertain_but_worded_accurately"]);
// These are provenance capabilities, not an entailment judgment. Accurate qualifications remain the auditor's responsibility.
export const RESPONSE_EVIDENCE_KINDS = Object.freeze({
  exact_client_turn: { from: "effective_user_turn", supports: ["prior_delivery", "personal_history", "history_dependent_advice", "coverage_scope_and_conflicts"], limit: "quoted_words_only_for_delivery" },
  app_committed_client_outbound: { from: "app_committed_projection", supports: ["prior_delivery"], limit: "exact_text_only" },
  owner_reported_client_outbound: { from: "resolved_owner_action_report", supports: ["prior_delivery"], limit: "reported_provenance" },
  agent_relayed_report: { from: "relayed_or_unresolved_report", supports: [], limit: "reported_or_uncertain_wording_only" },
  unsent_draft: { from: "undelivered_candidate", supports: [], limit: "non_delivery_only" },
  unattributed_assistant_turn: { from: "unattributed_assistant_turn", supports: [], limit: "audience_unknown" },
  relayed_client_message: { from: "supervisor_client_message_input", supports: ["personal_history", "history_dependent_advice", "coverage_scope_and_conflicts"], limit: "relayed_with_supplier" },
  supervisor_instruction: { from: "supervisor_revision_input", supports: [], limit: "instruction_only" },
  journal_quotation: { from: "authorized_session_use_excerpt", supports: ["personal_history", "history_dependent_advice", "source_consultation_claims", "coverage_scope_and_conflicts"], limit: "written_account_only" }
});
for (const kind of Object.values(RESPONSE_EVIDENCE_KINDS)) {
  Object.freeze(kind.supports);
  Object.freeze(kind);
}
export const RESPONSE_EVIDENCE_SOURCE_KINDS = Object.freeze(Object.keys(RESPONSE_EVIDENCE_KINDS));
export const RESPONSE_EVIDENCE_BUDGETS = Object.freeze({ max_tokens: 8000, max_bytes: 64000, snapshots: 20000, snapshot_bytes: 192000, source_items: 200, transcript_items: 120, recent_turns: 40, drafts: 10, draft_bytes: 24000, supervisor_inputs: 20, supervisor_input_bytes: 16000, reports: 20, history_requirements: 20, revisions: 3 });
export const RESPONSE_EVIDENCE_CODES = Object.freeze({ required: "RESPONSE_EVIDENCE_REQUIRED", invalid: "RESPONSE_EVIDENCE_INVALID", stale: "RESPONSE_EVIDENCE_STALE", unsupported: "RESPONSE_EVIDENCE_UNSUPPORTED" });
const invalid = (reason = "invalid_structure") => { throw new ValidationError("Response evidence invalid.", { code: RESPONSE_EVIDENCE_CODES.invalid, details: { reasons: [reason] } }); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => sha256Json(a) === sha256Json(b);
const text = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
const id = text(160);
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: "integer", minimum, maximum });
const enumeration = (values) => ({ enum: values });
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const array = (items, maxItems = 200, minItems = 0) => ({ type: "array", items, minItems, maxItems });
const shape = (properties, optional = []) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties).filter((key) => !optional.includes(key)) });
const timeSchema = shape({ at: nullable(text(80)), status: enumeration(["known", "unavailable"]) });
const spanSchema = shape({ start_utf8_byte: integer(), end_utf8_byte: integer(1), span_sha256: sha });
const locatorSchema = { anyOf: [
  shape({ kind: { const: "transcript_turn" }, turn_id: id }),
  shape({ kind: { const: "candidate" }, candidate_id: id, candidate_version: integer(1) }),
  shape({ kind: { const: "supervisor_input" }, entry_id: id }),
  shape({ kind: { const: "journal" }, corpus_id: id, generation: id, visibility_epoch: integer(), record_id: id, start_byte: integer(), end_byte: integer(1) })
] };
export const responseEvidenceSourceItemSchema = shape({
  id: text(340), kind: enumeration(RESPONSE_EVIDENCE_SOURCE_KINDS), actor: enumeration(["client", "assistant", "supervisor", "owner", "unknown"]),
  audience: enumeration(["client", "supervisor", "private_journal", "unknown"]), time: timeSchema,
  epistemic_status: enumeration(["exact_client_words", "app_committed_text", "owner_reported", "agent_relayed_report", "client_written_account", "unsent_draft", "unknown_delivery"]),
  excerpt_sha256: sha, excerpt_bytes: integer(), exact_excerpt: nullable({ type: "string", minLength: 1 }), locator: locatorSchema,
  supplied_by: shape({ channel: enumeration(["owner_ui", "authenticated_agent"]), actor_resolution: enumeration(["owner_verified", "unresolved"]) })
}, ["supplied_by"]);
const omissionSchema = shape({ reason: text(80), count: integer(1) });
const receiptSchema = shape({
  operation_id: id, corpus_id: id, generation: id, visibility_epoch: integer(), purpose: { const: "session_use" }, query_sha256: sha, filters_sha256: sha,
  returned_source_ids: array(text(340)), packet_sha256: sha, more_available: { type: "boolean" }, omitted_count: integer(), budget_used_tokens: integer(), budget_used_bytes: integer()
});
export const responseEvidenceJournalSchema = shape({
  availability: enumeration(["not_configured", "not_authorized", "unavailable", "available"]),
  retrieval_status: enumeration(["not_attempted", "returned", "no_match", "partial", "failed", "budget_exhausted"]), receipts: array(receiptSchema, 8),
  coverage: nullable(text(4000)), more_available: { type: "boolean" }, omissions: array(omissionSchema),
  budget: shape({ max_tokens: { const: 8000 }, max_bytes: { const: 64000 }, used_tokens: integer(0, 8000), used_bytes: integer(0, 64000) })
});
const bindingSchema = shape({
  transcript_digest: sha, amendments_digest: sha, communication_digest: sha, established_context_digest: sha, supervisor_inputs_digest: sha,
  compatibility_state_binding: nullable(text(1000)), journal_bindings: array(shape({ corpus_id: id, generation: nullable(id), visibility_epoch: integer() }), 20000)
});
export const responseEvidenceSnapshotSchema = shape({
  schema_version: { const: 1 }, id, policy_version: { const: RESPONSE_EVIDENCE_POLICY_VERSION }, case_id: id, created_at: text(80),
  owner: { anyOf: [shape({ kind: { const: "runtime_turn" }, runtime_turn_id: id }), shape({ kind: { const: "supervisor_draft" }, operation_key: { type: "string", pattern: "^[a-f0-9]{24}$" } })] },
  revision: integer(1, 3), parent_snapshot_id: nullable(id), revision_reason: enumeration(["initial", "dependency_refresh", "evidence_expansion"]),
  candidate_origin: enumeration(["backend_produced", "external_draft"]), original_writer_source_inclusion: enumeration(["verified", "not_attested"]),
  inbound: shape({ turn_id: id, exact_text_sha256: sha, audience: { const: "client" }, source_kind: { const: "exact_client_turn" } }),
  dependency_binding: bindingSchema, source_items: array(responseEvidenceSourceItemSchema),
  communication_projection: shape({
    confirmed_or_reported_client_outbound: array({ type: "object" }, 25), supervisor_only_artifacts: array({ type: "object" }, 25), unresolved_delivery: array({ type: "object" }, 25),
    omitted: shape({ confirmed_or_reported_client_outbound: integer(), supervisor_only_artifacts: integer(), unresolved_delivery: integer(), source_items: array(omissionSchema) })
  }),
  history_requirements: array(shape({ id, topic: text(1000), why_material: text(1000), source_ids: array(text(340)), disposition: enumeration(["answered_by_sources", "retrieval_requested", "unavailable", "open"]) }), 20),
  journal: responseEvidenceJournalSchema, snapshot_sha256: sha
});
const reviewItemProperties = {
  id: text(140), dimension: enumeration(RESPONSE_EVIDENCE_DIMENSIONS), kind: enumeration(["claim", "recommendation", "question_presupposition"]),
  candidate_quote: text(100000), quote_occurrence: integer(1, 100000), source_ids: array(text(340)), assessment: enumeration(RESPONSE_EVIDENCE_ASSESSMENTS), reason: text()
};
const missingProperties = { id: text(140), question: text(), why_material: text(), candidate_quote: text(100000), quote_occurrence: integer(1, 100000) };
const coverageSchema = array(shape({ dimension: enumeration(RESPONSE_EVIDENCE_DIMENSIONS), status: enumeration(["assessed", "no_applicable_items"]), reason: text() }), 5, 5);
export const evidenceReviewV1Schema = shape({ coverage: coverageSchema, items: array(shape(reviewItemProperties, ["quote_occurrence"])), missing_material_history: array(shape(missingProperties, ["quote_occurrence"])) });
export const EvidenceReviewV1 = evidenceReviewV1Schema;
export const normalizedEvidenceReviewSchema = shape({
  coverage: coverageSchema,
  items: array(shape({ ...reviewItemProperties, candidate_span: spanSchema, source_incompatible: { const: true } }, ["source_incompatible"])),
  missing_material_history: array(shape({ ...missingProperties, candidate_span: spanSchema }))
});
export const responseEvidenceAuditSchema = shape({
  schema_version: { const: 1 }, policy_version: { const: RESPONSE_EVIDENCE_POLICY_VERSION }, snapshot_id: id, snapshot_sha256: sha,
  auditor_inclusion_sha256: sha, review: normalizedEvidenceReviewSchema, derived_finding_ids: array(text(160))
});
export const responseEvidenceCandidateSchema = shape({
  schema_version: { const: 1 }, policy_version: { const: RESPONSE_EVIDENCE_POLICY_VERSION }, snapshot_id: id, snapshot_sha256: sha,
  candidate_origin: enumeration(["backend_produced", "external_draft"]), writer_inclusion: enumeration(["verified", "not_attested"]), writer_inclusion_sha256: nullable(sha),
  established_context_after_commit_sha256: nullable(sha), dependency_status: enumeration(["current_at_commit", "stale_at_commit"])
});

// Deliberately local and limited to the schema vocabulary above: the encrypted store must work without npm packages.
export function validateEvidenceShape(value, schema) {
  if (schema.anyOf) {
    if (!schema.anyOf.some((choice) => { try { validateEvidenceShape(value, choice); return true; } catch { return false; } })) invalid();
    return value;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
  if (schema.type === "null" && value !== null) invalid();
  if (schema.type === "boolean" && typeof value !== "boolean") invalid();
  if (schema.type === "integer" && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)) invalid();
  if (schema.type === "string" && (typeof value !== "string" || (schema.minLength > 0 && !value.trim()) || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) invalid();
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) invalid();
    for (const entry of value) validateEvidenceShape(entry, schema.items);
  }
  if (schema.type === "object") {
    if (!object(value)) invalid();
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) invalid();
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) invalid();
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateEvidenceShape(value[key], child);
  }
  return value;
}
const effectiveTurns = (record) => applyTranscriptAmendments(record.raw_transcript, record.transcript_amendments ?? [], { sourceArtifacts: record.source_artifacts ?? [] });
const lineageIds = (record, root) => new Set([root, ...(record.candidate_responses ?? []).filter((entry) => entry.root_candidate_id === root).map((entry) => entry.id)].filter(Boolean));
export function computeEvidenceDependencyBinding(record, { inboundTurnId, inboundSha256, lineageRootId = null } = {}) {
  // The inbound identity/hash live in snapshot.inbound. Check it separately when resolving the snapshot against a record.
  if (inboundSha256 != null) validateEvidenceShape(inboundSha256, sha);
  return {
    transcript_digest: sha256Json(effectiveTurns(record).filter((turn) => turn.id !== inboundTurnId).map((turn) => [turn.id, turn.role, turn.text, turn.exchange_id, turn.episode_id ?? null])),
    amendments_digest: sha256Json((record.transcript_amendments ?? []).map((entry) => [entry.id, entry.target_turn_id, entry.effective_text_sha256 ?? entry.completion_sha256 ?? null])),
    communication_digest: sha256Json(foreignCommunicationSignature(record, lineageIds(record, lineageRootId))),
    established_context_digest: sha256Json(record.case_state),
    supervisor_inputs_digest: sha256Json((record.supervisor_artifacts ?? []).filter((entry) => entry.kind === "input").map((entry) => entry.id)),
    compatibility_state_binding: compatibilityStateBinding(record.case_state?.protective_compatibility ?? null),
    journal_bindings: (record.journal_corpora ?? []).map((entry) => ({ corpus_id: entry.corpus_id, generation: entry.active_generation, visibility_epoch: entry.visibility_epoch })).sort((a, b) => a.corpus_id < b.corpus_id ? -1 : a.corpus_id > b.corpus_id ? 1 : 0)
  };
}
export function responseEvidenceSnapshotSha256(snapshot) {
  const { snapshot_sha256: _digest, ...payload } = snapshot;
  return sha256Json(payload);
}
function uniqueIds(entries) { if (new Set(entries.map((entry) => entry.id)).size !== entries.length) invalid("duplicate_id"); }
const sourceTime = (item) => item.time.status === "known" ? Date.parse(item.time.at) : -Infinity;
const sourceOrder = (left, right) => (sourceTime(left) - sourceTime(right)) || 0;
function recordOmission(omissions, reason, count = 1) {
  if (!count) return;
  const existing = omissions.find((item) => item.reason === reason);
  if (existing) existing.count += count;
  else omissions.push({ reason, count });
}
function excerptCost(item) { const bytes = Buffer.byteLength(JSON.stringify(item.exact_excerpt), "utf8"); return { bytes, tokens: Math.ceil(bytes / 3) }; }
function checkSourceItem(item) {
  validateEvidenceShape(item, responseEvidenceSourceItemSchema);
  const expected = {
    exact_client_turn: ["client", "client", "exact_client_words", "transcript_turn"],
    app_committed_client_outbound: ["assistant", "client", "app_committed_text", "transcript_turn"],
    unattributed_assistant_turn: ["assistant", "unknown", "unknown_delivery", "transcript_turn"],
    unsent_draft: ["assistant", "supervisor", "unsent_draft", "candidate"],
    relayed_client_message: ["supervisor", "supervisor", "owner_reported", "supervisor_input"],
    supervisor_instruction: ["supervisor", "supervisor", "owner_reported", "supervisor_input"],
    journal_quotation: ["client", "private_journal", "client_written_account", "journal"]
  }[item.kind];
  if (expected && !same([item.actor, item.audience, item.epistemic_status, item.locator.kind], expected)) invalid("source_provenance");
  if (["relayed_client_message", "supervisor_instruction"].includes(item.kind) && !item.supplied_by) invalid("source_provenance");
  if ((item.time.status === "known") !== (item.time.at !== null) || (item.time.at !== null && Number.isNaN(Date.parse(item.time.at)))) invalid();
  if (item.locator.kind === "transcript_turn") { if (item.exact_excerpt !== null) invalid(); }
  else if (typeof item.exact_excerpt !== "string" || item.excerpt_sha256 !== sha256Text(item.exact_excerpt) || item.excerpt_bytes !== Buffer.byteLength(item.exact_excerpt)) invalid("excerpt_mismatch");
  if ((item.kind === "journal_quotation") !== (item.locator.kind === "journal")) invalid();
  if (item.locator.kind === "journal" && item.locator.end_byte - item.locator.start_byte !== item.excerpt_bytes) invalid("excerpt_mismatch");
}
export function validateResponseEvidenceSnapshot(snapshot) {
  validateEvidenceShape(snapshot, responseEvidenceSnapshotSchema);
  if (Buffer.byteLength(JSON.stringify(snapshot)) > RESPONSE_EVIDENCE_BUDGETS.snapshot_bytes || Number.isNaN(Date.parse(snapshot.created_at))) invalid("snapshot_budget");
  if ((snapshot.revision === 1) !== (snapshot.parent_snapshot_id === null) || (snapshot.revision === 1) !== (snapshot.revision_reason === "initial")) invalid("revision_mismatch");
  if (snapshot.owner.kind === "runtime_turn" && snapshot.candidate_origin !== "backend_produced") invalid("origin_mismatch");
  if (snapshot.original_writer_source_inclusion !== (snapshot.candidate_origin === "backend_produced" ? "verified" : "not_attested")) invalid("origin_mismatch");
  uniqueIds(snapshot.source_items); uniqueIds(snapshot.history_requirements);
  snapshot.source_items.forEach(checkSourceItem);
  const inventory = (predicate) => snapshot.source_items.filter(predicate);
  const drafts = inventory((item) => item.kind === "unsent_draft"), inputs = inventory((item) => item.locator.kind === "supervisor_input");
  if (inventory((item) => item.id.startsWith("src:turn:")).length > 120 || drafts.length > 10 || inputs.length > 20
      || inventory((item) => item.id.startsWith("src:report:")).length > 20
      || drafts.reduce((sum, item) => sum + item.excerpt_bytes, 0) > 24000 || inputs.reduce((sum, item) => sum + item.excerpt_bytes, 0) > 16000) invalid("source_budget");
  const sources = new Set(snapshot.source_items.map((entry) => entry.id));
  if (snapshot.history_requirements.some((entry) => (entry.disposition === "answered_by_sources" && entry.source_ids.length === 0) || entry.source_ids.some((ref) => !sources.has(ref)))) invalid("unknown_source");
  const costs = snapshot.source_items.filter((entry) => entry.kind === "journal_quotation").map(excerptCost);
  if (snapshot.journal.budget.used_bytes !== costs.reduce((sum, entry) => sum + entry.bytes, 0) || snapshot.journal.budget.used_tokens !== costs.reduce((sum, entry) => sum + entry.tokens, 0)) invalid("journal_budget");
  if (snapshot.snapshot_sha256 !== responseEvidenceSnapshotSha256(snapshot)) invalid("snapshot_digest");
  return snapshot;
}
const makeItem = (id, kind, actor, audience, exactText, locator, at = null, suppliedBy = null) => ({
  id, kind, actor, audience, time: { at, status: at === null ? "unavailable" : "known" },
  epistemic_status: ({ exact_client_turn: "exact_client_words", app_committed_client_outbound: "app_committed_text", owner_reported_client_outbound: "owner_reported", agent_relayed_report: "agent_relayed_report", unsent_draft: "unsent_draft", unattributed_assistant_turn: "unknown_delivery", relayed_client_message: "owner_reported", supervisor_instruction: "owner_reported", journal_quotation: "client_written_account" })[kind],
  excerpt_sha256: sha256Text(exactText), excerpt_bytes: Buffer.byteLength(exactText), exact_excerpt: locator.kind === "transcript_turn" ? null : exactText, locator,
  ...(suppliedBy ? { supplied_by: structuredClone(suppliedBy) } : {})
});
export function buildResponseEvidenceSourceItems(record, { journalItems = [], inbound = null, lineageRootId = null } = {}) {
  const projection = projectCommunicationState(record);
  // The normal context projection lists 25 entries. Source classification must also resolve older referenced turns.
  const sourceProjection = projectCommunicationState(record, { listedItemsLimit: Math.max(25, record.raw_transcript.length
    + record.candidate_responses.length + (record.communication_events ?? []).length + (record.runtime_turns ?? []).length) });
  const turns = [...effectiveTurns(record)];
  // An inbound not committed yet is a transcript locator resolved from runtime_turns by the model-view builder.
  if (inbound && !turns.some((turn) => turn.id === inbound.turn_id)) {
    const runtime = (record.runtime_turns ?? []).find((entry) => entry.user_turn_id === inbound.turn_id);
    if (runtime) turns.push({ id: runtime.user_turn_id, role: "user", text: runtime.inbound.exact_text, at: runtime.inbound.received_at });
  }
  const refs = new Set([...(record.case_state?.items ?? []), ...(record.case_state?.intervention_history ?? [])].map((entry) => entry.source?.turn_id).filter(Boolean));
  const recent = new Set(turns.slice(-40).map((turn) => turn.id));
  const selected = turns.filter((turn) => refs.has(turn.id) || recent.has(turn.id));
  const committed = new Map(sourceProjection.confirmed_or_reported_client_outbound.filter((entry) => entry.state === "app_committed").map((entry) => [entry.assistant_turn_id, entry.subject.text_sha256]));
  const sourceOmissions = [];
  if (selected.length > 120) sourceOmissions.push({ reason: "transcript_item_limit", count: selected.length - 120 });
  const items = selected.slice(-120).map((turn) => {
    const client = turn.role === "user";
    // A completion amendment supplies effective words; an earlier delivery receipt attests only its original exact bytes.
    const appCommitted = committed.get(turn.id) === sha256Text(turn.text);
    const kind = client ? "exact_client_turn" : appCommitted ? "app_committed_client_outbound" : "unattributed_assistant_turn";
    return makeItem(`src:turn:${turn.id}`, kind, client ? "client" : "assistant", client || appCommitted ? "client" : "unknown",
      turn.text, { kind: "transcript_turn", turn_id: turn.id }, turn.at);
  });
  const retracted = new Set((record.communication_events ?? []).filter((event) => event.kind === "retraction").map((event) => event.retracts_event_id));
  // The v1 locator union has no unresolved communication-event locator. Keep those reports in the projection, with an explicit
  // source omission, rather than mislabel a report as a supervisor input or as exact candidate bytes.
  for (const event of record.communication_events ?? []) {
    if (event.kind !== "reported_sent" || retracted.has(event.id)) continue;
    const candidate = event.subject.kind === "candidate" ? record.candidate_responses.find((entry) => entry.id === event.subject.candidate_id) : null;
    const turn = event.subject.kind === "transcript_turn" ? turns.find((entry) => entry.id === event.subject.assistant_turn_id) : null;
    const exactText = candidate?.exact_text ?? turn?.text ?? event.provenance.quote;
    if (!exactText) { recordOmission(sourceOmissions, "unresolved_report_locator"); continue; }
    if (!candidate && !turn) { recordOmission(sourceOmissions, "unresolved_report_locator"); continue; }
    if (sha256Text(exactText) !== event.subject.text_sha256) {
      recordOmission(sourceOmissions, "report_text_changed");
      continue;
    }
    const kind = (candidate || turn) && event.provenance.origin === "owner_action" ? "owner_reported_client_outbound" : "agent_relayed_report";
    const locator = candidate ? { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version }
      : { kind: "transcript_turn", turn_id: turn.id };
    items.push(makeItem(`src:report:${event.id}`, kind, kind === "agent_relayed_report" ? "unknown" : "owner", "client", exactText, locator, event.sent_at));
  }
  const deliveredCandidates = new Set(sourceProjection.confirmed_or_reported_client_outbound.filter((entry) => entry.subject.kind === "candidate").map((entry) => entry.subject.candidate_id));
  const ownLineage = lineageIds(record, lineageRootId);
  for (const candidate of record.candidate_responses ?? []) {
    if (candidate.status === "sent" || deliveredCandidates.has(candidate.id)) continue;
    if (ownLineage.has(candidate.id)) { recordOmission(sourceOmissions, "reviewed_lineage_draft"); continue; }
    items.push(makeItem(`src:draft:${candidate.id}:v${candidate.version}`, "unsent_draft", "assistant", "supervisor", candidate.exact_text, { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version }, candidate.created_at));
  }
  for (const entry of record.supervisor_artifacts ?? []) {
    if (entry.kind !== "input") continue;
    items.push(makeItem(`src:input:${entry.id}`, entry.input_type === "client_message" ? "relayed_client_message" : "supervisor_instruction", "supervisor", "supervisor", entry.text, { kind: "supervisor_input", entry_id: entry.id }, entry.recorded_at, entry.supplied_by));
  }
  items.push(...structuredClone(journalItems));
  // Known event times order the shared inventory; an unavailable time cannot attest that an item is newer.
  items.sort(sourceOrder);
  // Keep the newest whole items within each inventory's count and excerpt budget.
  const bounded = (predicate, maximum, maximumBytes, reason) => {
    const group = items.filter(predicate), keep = new Set(); let bytes = 0;
    for (const item of group.slice(-maximum).reverse()) {
      if (bytes + item.excerpt_bytes > maximumBytes) continue;
      keep.add(item); bytes += item.excerpt_bytes;
    }
    const removed = group.filter((item) => !keep.has(item));
    if (removed.length) sourceOmissions.push({ reason, count: removed.length });
    for (const item of removed) items.splice(items.indexOf(item), 1);
  };
  bounded((item) => item.kind === "unsent_draft", 10, 24000, "draft_budget");
  bounded((item) => item.locator.kind === "supervisor_input", 20, 16000, "supervisor_input_budget");
  bounded((item) => item.id.startsWith("src:report:"), 20, Infinity, "report_limit");
  const omitted = Math.max(0, items.length - RESPONSE_EVIDENCE_BUDGETS.source_items);
  // Retain whole items, newest first when capacity is exhausted; record the omission rather than trimming a quotation.
  return { source_items: items.slice(-200), communication_projection: {
    confirmed_or_reported_client_outbound: projection.confirmed_or_reported_client_outbound,
    supervisor_only_artifacts: projection.supervisor_only_artifacts, unresolved_delivery: projection.unresolved_delivery,
    omitted: { ...projection.omitted, source_items: [...sourceOmissions, ...(omitted ? [{ reason: "source_item_limit", count: omitted }] : [])] }
  } };
}
export function normalizeResponseEvidenceJournal(input = null, priorItems = []) {
  if (input == null) input = {};
  if (!object(input)) invalid("journal_structure");
  const { source_items = [], ...part } = input;
  if (!Array.isArray(source_items) || source_items.length > 200) invalid("journal_structure");
  const journal = {
    availability: "not_configured", retrieval_status: "not_attempted", receipts: [], coverage: null, more_available: false, omissions: [],
    budget: { max_tokens: 8000, max_bytes: 64000, used_tokens: 0, used_bytes: 0 }, ...structuredClone(part)
  };
  validateEvidenceShape(journal, responseEvidenceJournalSchema);
  const kept = [], omitted = [];
  const prior = new Map(priorItems.map((item) => [sha256Json([item.locator, item.excerpt_sha256]), excerptCost(item)]));
  let turnBytes = [...prior.values()].reduce((sum, cost) => sum + cost.bytes, 0), turnTokens = [...prior.values()].reduce((sum, cost) => sum + cost.tokens, 0);
  let usedBytes = 0, usedTokens = 0;
  for (const item of source_items) {
    checkSourceItem(item);
    if (item.kind !== "journal_quotation" || journal.availability !== "available") invalid("journal_authority");
    const cost = excerptCost(item), key = sha256Json([item.locator, item.excerpt_sha256]);
    const newCost = prior.has(key) ? { bytes: 0, tokens: 0 } : cost;
    if (turnBytes + newCost.bytes > 64000 || turnTokens + newCost.tokens > 8000 || usedBytes + cost.bytes > 64000 || usedTokens + cost.tokens > 8000) { omitted.push(item); continue; }
    kept.push(structuredClone(item)); usedBytes += cost.bytes; usedTokens += cost.tokens;
    turnBytes += newCost.bytes; turnTokens += newCost.tokens; prior.set(key, cost);
  }
  if (omitted.length) { journal.omissions.push({ reason: "journal_budget", count: omitted.length }); journal.more_available = true; journal.retrieval_status = "budget_exhausted"; }
  journal.budget = { max_tokens: 8000, max_bytes: 64000, used_tokens: usedTokens, used_bytes: usedBytes };
  return { journal, source_items: kept.sort(sourceOrder) };
}
export function buildResponseEvidenceSnapshot(record, input, { createdAt, priorJournalItems = [] } = {}) {
  const { snapshotId, owner, revision = 1, parentSnapshotId = null, revisionReason = "initial", candidateOrigin = "backend_produced", inbound, journal, historyRequirements = [] } = input;
  const normalized = normalizeResponseEvidenceJournal(journal, priorJournalItems);
  for (const item of normalized.source_items) {
    const locator = item.locator;
    const corpus = (record.journal_corpora ?? []).find((entry) => entry.corpus_id === locator.corpus_id);
    const receipt = normalized.journal.receipts.find((entry) => entry.corpus_id === locator.corpus_id && entry.generation === locator.generation
      && entry.visibility_epoch === locator.visibility_epoch && entry.returned_source_ids.includes(item.id));
    if (!corpus || corpus.active_generation !== locator.generation || corpus.visibility_epoch !== locator.visibility_epoch || !receipt) invalid("journal_authority");
  }
  const sources = buildResponseEvidenceSourceItems(record, { journalItems: normalized.source_items, inbound, lineageRootId: input.lineageRootId });
  const includedJournal = sources.source_items.filter((entry) => entry.kind === "journal_quotation");
  if (includedJournal.length !== normalized.source_items.length) {
    normalized.journal.omissions.push({ reason: "source_item_limit", count: normalized.source_items.length - includedJournal.length });
    normalized.journal.more_available = true;
    if (normalized.journal.retrieval_status !== "budget_exhausted") normalized.journal.retrieval_status = "partial";
    const costs = includedJournal.map(excerptCost);
    normalized.journal.budget.used_tokens = costs.reduce((sum, cost) => sum + cost.tokens, 0);
    normalized.journal.budget.used_bytes = costs.reduce((sum, cost) => sum + cost.bytes, 0);
  }
  const snapshot = {
    schema_version: 1, id: snapshotId, policy_version: RESPONSE_EVIDENCE_POLICY_VERSION, case_id: record.case_id, created_at: createdAt,
    owner: structuredClone(owner), revision, parent_snapshot_id: parentSnapshotId, revision_reason: revisionReason,
    candidate_origin: candidateOrigin, original_writer_source_inclusion: candidateOrigin === "backend_produced" ? "verified" : "not_attested", inbound: structuredClone(inbound),
    dependency_binding: computeEvidenceDependencyBinding(record, { inboundTurnId: inbound?.turn_id, inboundSha256: inbound?.exact_text_sha256, lineageRootId: input.lineageRootId }),
    ...sources, history_requirements: structuredClone(historyRequirements.slice(-20).filter((entry) => entry.topic?.length <= 1000 && entry.why_material?.length <= 1000)), journal: normalized.journal
  };
  const omissions = snapshot.communication_projection.omitted.source_items;
  const omittedHistory = historyRequirements.length - snapshot.history_requirements.length;
  if (omittedHistory) omissions.push({ reason: "history_requirement_budget", count: omittedHistory });
  // Leave room for the digest while fitting. Omit whole sources, in the specified priority order.
  snapshot.snapshot_sha256 = "0".repeat(64);
  const overBudget = () => Buffer.byteLength(JSON.stringify(snapshot)) > RESPONSE_EVIDENCE_BUDGETS.snapshot_bytes;
  const synchronizeHistorySources = () => {
    const available = new Set(snapshot.source_items.map((item) => item.id));
    snapshot.history_requirements = snapshot.history_requirements.map((entry) => {
      const source_ids = entry.source_ids.filter((ref) => available.has(ref));
      return { ...entry, source_ids, disposition: entry.disposition === "answered_by_sources" && !source_ids.length ? "unavailable" : entry.disposition };
    });
  };
  synchronizeHistorySources();
  const omitSources = (predicate, reason, onOmitted = null) => {
    while (overBudget()) {
      const index = snapshot.source_items.findIndex(predicate);
      if (index < 0) break;
      const [removed] = snapshot.source_items.splice(index, 1);
      recordOmission(omissions, reason);
      onOmitted?.(removed);
      synchronizeHistorySources();
    }
  };
  omitSources((item) => item.locator.kind === "transcript_turn", "snapshot_byte_budget");
  omitSources((item) => item.kind === "unsent_draft", "snapshot_byte_budget");
  // Large report excerpts and heavily linked requirements can independently exceed the cap.
  // After the specified transcript/draft priority, retain only whole remaining entries that fit.
  while (overBudget() && snapshot.history_requirements.length) {
    snapshot.history_requirements.shift(); recordOmission(omissions, "history_requirement_snapshot_budget");
  }
  omitSources((item) => item.id.startsWith("src:report:"), "report_snapshot_budget");
  omitSources((item) => item.locator.kind === "supervisor_input", "supervisor_input_snapshot_budget");
  omitSources((item) => item.kind === "journal_quotation", "journal_snapshot_budget", (item) => {
    recordOmission(snapshot.journal.omissions, "snapshot_byte_budget");
    snapshot.journal.more_available = true;
    snapshot.journal.retrieval_status = "budget_exhausted";
    snapshot.journal.budget.used_bytes -= excerptCost(item).bytes;
    snapshot.journal.budget.used_tokens -= excerptCost(item).tokens;
  });
  snapshot.snapshot_sha256 = responseEvidenceSnapshotSha256(snapshot);
  return validateResponseEvidenceSnapshot(snapshot);
}
export function buildEvidenceModelView(record, snapshot) {
  validateResponseEvidenceSnapshot(snapshot);
  if (snapshot.case_id !== record.case_id) invalid("foreign_snapshot");
  const turns = effectiveTurns(record);
  const sourceItems = snapshot.source_items.map((item) => {
    const runtime = (record.runtime_turns ?? []).find((entry) => entry.user_turn_id === item.locator.turn_id);
    const exactText = item.locator.kind === "transcript_turn" ? turns.find((entry) => entry.id === item.locator.turn_id)?.text ?? runtime?.inbound.exact_text : item.exact_excerpt;
    if (typeof exactText !== "string" || sha256Text(exactText) !== item.excerpt_sha256 || Buffer.byteLength(exactText) !== item.excerpt_bytes) invalid("excerpt_mismatch");
    return { ...structuredClone(item), exact_excerpt: exactText };
  });
  const view = {
    snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, policy_version: snapshot.policy_version, candidate_origin: snapshot.candidate_origin,
    original_writer_source_inclusion: snapshot.original_writer_source_inclusion, inbound: structuredClone(snapshot.inbound), source_items: sourceItems,
    communication_projection: structuredClone(snapshot.communication_projection), history_requirements: structuredClone(snapshot.history_requirements), journal: structuredClone(snapshot.journal),
    instructions: [
      `Cover each dimension exactly once: ${RESPONSE_EVIDENCE_DIMENSIONS.join(", ")}.`,
      "Assess claims, recommendations and question presuppositions in the whole exact candidate.",
      "Quote exact candidate words and identify the 1-based occurrence; do not normalize Unicode or whitespace.",
      "Use only supplied source ids. A source's provenance limits what it can support.",
      "An unsent draft cannot support prior delivery, and a supervisor instruction cannot support client history.",
      "Retain reported uncertainty, journal coverage limits and conflicting sources.",
      "List every missing material historical dependency in missing_material_history.",
      "Proposed case state cannot corroborate the candidate."
    ]
  };
  return { view, view_sha256: sha256Json(view) };
}
function quoteSpan(candidateText, quote, occurrence) {
  const bytes = Buffer.from(candidateText, "utf8"), needle = Buffer.from(quote, "utf8");
  if (bytes.toString("utf8") !== candidateText || needle.toString("utf8") !== quote) invalid("quote_encoding");
  let at = -1;
  for (let i = 0; i < occurrence; i += 1) { at = bytes.indexOf(needle, at + 1); if (at < 0) invalid("quote_not_found"); }
  return { start_utf8_byte: at, end_utf8_byte: at + needle.length, span_sha256: sha256Text(needle) };
}
export function normalizeEvidenceReview(review, { candidateText, snapshot } = {}) {
  if (typeof candidateText !== "string") invalid("candidate_missing");
  // A factory can locate quotes before the store supplies the trusted snapshot. Source validation is mandatory at admission.
  const normalized = structuredClone(review);
  if (!object(normalized) || !Array.isArray(normalized.items) || !Array.isArray(normalized.missing_material_history)) invalid();
  validateEvidenceShape(normalized.coverage, coverageSchema);
  for (const item of [...normalized.items, ...normalized.missing_material_history]) {
    if (!object(item)) invalid();
    const previousSpan = item.candidate_span;
    delete item.candidate_span;
    const incompatible = item.source_incompatible;
    delete item.source_incompatible;
    validateEvidenceShape(item, normalized.items.includes(item) ? shape(reviewItemProperties, ["quote_occurrence"]) : shape(missingProperties, ["quote_occurrence"]));
    item.quote_occurrence ??= 1;
    item.candidate_span = quoteSpan(candidateText, item.candidate_quote, item.quote_occurrence);
    if (previousSpan != null && !same(previousSpan, item.candidate_span)) invalid("span_mismatch");
    if (incompatible != null && incompatible !== true) invalid();
    if (normalized.items.includes(item)) {
      if (["supported", "contradicted"].includes(item.assessment) && item.source_ids.length === 0) invalid("source_required");
      if (new Set(item.source_ids).size !== item.source_ids.length) invalid("duplicate_source");
      if (snapshot) {
        const sources = item.source_ids.map((ref) => snapshot.source_items.find((entry) => entry.id === ref));
        if (sources.some((entry) => !entry)) invalid("unknown_source");
        if (item.assessment === "supported" && !sources.some((entry) => RESPONSE_EVIDENCE_KINDS[entry.kind]?.supports.includes(item.dimension))) item.source_incompatible = true;
      } else if (incompatible === true) item.source_incompatible = true;
    }
  }
  validateEvidenceShape(normalized, normalizedEvidenceReviewSchema);
  uniqueIds([...normalized.items, ...normalized.missing_material_history]);
  const dimensions = normalized.coverage.map((entry) => entry.dimension);
  if (new Set(dimensions).size !== 5) invalid("coverage_missing");
  for (const coverage of normalized.coverage) if (coverage.status === "no_applicable_items" && normalized.items.some((item) => item.dimension === coverage.dimension)) invalid("coverage_inconsistent");
  return normalized;
}
const derivedFinding = (item, code) => ({
  id: `evidence:${item.id}`, code, severity: "substantive",
  summary: `${code} (${item.dimension ?? "missing_material_history"}): "${item.candidate_quote.slice(0, 300)}" - ${item.reason ?? item.why_material}`.slice(0, 2000),
  evidence_turn_ids: (item.source_ids ?? []).filter((ref) => ref.startsWith("src:turn:")).map((ref) => ref.slice("src:turn:".length)), unresolved: true
});
export function deriveEvidenceFindings(review) {
  return [
    ...review.items.flatMap((item) => item.source_incompatible ? [derivedFinding(item, "RESPONSE_EVIDENCE_SOURCE_INCOMPATIBLE")]
      : item.assessment === "unsupported" ? [derivedFinding(item, "RESPONSE_EVIDENCE_UNSUPPORTED")]
        : item.assessment === "contradicted" ? [derivedFinding(item, "RESPONSE_EVIDENCE_CONTRADICTED")] : []),
    ...review.missing_material_history.map((item) => derivedFinding(item, "RESPONSE_EVIDENCE_MISSING_HISTORY"))
  ];
}
export function validateResponseEvidenceAudit(audit, candidate, snapshot = null) {
  const evidence = validateEvidenceShape(audit.response_evidence, responseEvidenceAuditSchema);
  if (audit.audit_version !== "private-candidate-audit-v5") invalid("audit_version");
  const review = candidate ? normalizeEvidenceReview(evidence.review, { candidateText: candidate.exact_text, snapshot }) : evidence.review;
  if (!same(review, evidence.review)) invalid("review_mismatch");
  const findings = deriveEvidenceFindings(review);
  if (!same(evidence.derived_finding_ids, findings.map((item) => item.id))) invalid("derived_findings");
  const actual = audit.findings.filter((finding) => finding.id.startsWith("evidence:") && finding.code !== "RESPONSE_EVIDENCE_STALE");
  if (!same(actual, findings)) invalid("derived_findings");
  if (snapshot && (evidence.snapshot_id !== snapshot.id || evidence.snapshot_sha256 !== snapshot.snapshot_sha256)) invalid("audit_snapshot_mismatch");
  return evidence;
}
export function responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate = null } = {}) {
  const current = computeEvidenceDependencyBinding(record, { inboundTurnId: snapshot.inbound.turn_id, inboundSha256: snapshot.inbound.exact_text_sha256, lineageRootId: rootCandidate?.id });
  if (snapshot.revision === 1 && rootCandidate) {
    if (sha256Json(record.case_state) !== rootCandidate.metadata?.response_evidence?.established_context_after_commit_sha256) return false;
    current.established_context_digest = snapshot.dependency_binding.established_context_digest;
  }
  return same(current, snapshot.dependency_binding);
}
export function responseEvidenceDependenciesCurrent(record, candidate, snapshot) {
  const binding = candidate.metadata.response_evidence;
  if (binding.dependency_status !== "current_at_commit" || binding.established_context_after_commit_sha256 !== sha256Json(record.case_state)) return false;
  const rootCandidate = record.candidate_responses.find((entry) => entry.id === candidate.root_candidate_id);
  return responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate });
}
const result = (code = null, reason = null) => ({ admissible: code === null, code, reasons: reason === null ? [] : [reason] });
export function assessResponseEvidenceAdmission(record, candidate, { policy = "advisory", point = "approval" } = {}) {
  if (!["advisory", "enforced"].includes(policy)) return result(RESPONSE_EVIDENCE_CODES.invalid, "policy_invalid");
  const binding = candidate?.metadata?.response_evidence;
  if (!binding) return policy === "enforced" && !["recordCandidateAudit", "recordSupervisorAudit", "commitPrivateRuntimeAudit"].includes(point)
    ? result(RESPONSE_EVIDENCE_CODES.required, "snapshot_required") : result();
  const auditPoint = ["recordCandidateAudit", "recordSupervisorAudit", "commitPrivateRuntimeAudit"].includes(point);
  const audit = auditPoint ? candidate.audit_history.at(-1) : candidate.audit_history.find((entry) => entry.id === candidate.metadata.approval_audit_id) ?? [...candidate.audit_history].reverse().find((entry) => entry.sufficient_for_approval);
  if (auditPoint && audit?.verdict === "fail") return result();
  try {
    validateEvidenceShape(binding, responseEvidenceCandidateSchema);
    const snapshot = (record.response_evidence_snapshots ?? []).find((entry) => entry.id === binding.snapshot_id);
    if (!snapshot) return result(RESPONSE_EVIDENCE_CODES.invalid, "snapshot_missing");
    validateResponseEvidenceSnapshot(snapshot);
    if (snapshot.case_id !== record.case_id || binding.snapshot_sha256 !== snapshot.snapshot_sha256 || binding.candidate_origin !== snapshot.candidate_origin) return result(RESPONSE_EVIDENCE_CODES.invalid, "snapshot_binding");
    const runtime = (record.runtime_turns ?? []).find((entry) => entry.id === candidate.metadata.runtime_turn_id);
    if (snapshot.owner.kind === "runtime_turn" ? !runtime || runtime.id !== snapshot.owner.runtime_turn_id
      : candidate.metadata.supervisor_draft?.operation_key !== snapshot.owner.operation_key) return result(RESPONSE_EVIDENCE_CODES.invalid, "lineage_binding");
    const root = (record.candidate_responses ?? []).find((entry) => entry.id === candidate.root_candidate_id);
    const actualOrigin = runtime ? "backend_produced" : candidate.metadata.supervisor_draft?.source === "external_draft" ? "external_draft" : "backend_produced";
    if (!root || actualOrigin !== binding.candidate_origin || (runtime ? root.metadata.runtime_turn_id !== runtime.id
      : root.metadata.supervisor_draft?.operation_key !== snapshot.owner.operation_key)) return result(RESPONSE_EVIDENCE_CODES.invalid, "lineage_binding");
    const inboundText = runtime?.inbound.exact_text ?? effectiveTurns(record).find((entry) => entry.id === snapshot.inbound.turn_id)?.text;
    if (!auditPoint && (typeof inboundText !== "string" || sha256Text(inboundText) !== snapshot.inbound.exact_text_sha256)) return result(RESPONSE_EVIDENCE_CODES.stale, "inbound_changed");
    if (binding.writer_inclusion !== snapshot.original_writer_source_inclusion || (binding.candidate_origin === "external_draft" && binding.writer_inclusion_sha256 !== null)) return result(RESPONSE_EVIDENCE_CODES.invalid, "writer_inclusion");
    if (binding.candidate_origin === "backend_produced") {
      if (!binding.writer_inclusion_sha256) return result(RESPONSE_EVIDENCE_CODES.invalid, "writer_inclusion");
      const stage = candidate.parent_candidate_id === null ? "candidate" : "repair";
      const invocation = runtime?.events.find((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === stage && event.details?.actual_context_id === candidate.producer_context_id && event.details?.output?.exactText === candidate.exact_text);
      const inclusion = invocation?.details?.output?.responseEvidenceInclusion;
      if (!inclusion || inclusion.snapshot_id !== snapshot.id || inclusion.snapshot_sha256 !== snapshot.snapshot_sha256 || inclusion.view_sha256 !== binding.writer_inclusion_sha256) return result(RESPONSE_EVIDENCE_CODES.invalid, "writer_inclusion");
    }
    if (!audit || (!auditPoint && (audit.verdict !== "pass" || audit.sufficient_for_approval !== true)) || audit.candidate_id !== candidate.id || audit.candidate_version !== candidate.version || audit.candidate_sha256 !== sha256Text(candidate.exact_text)) return result(RESPONSE_EVIDENCE_CODES.invalid, "audit_binding");
    const evidence = validateResponseEvidenceAudit(audit, candidate, snapshot);
    if (runtime) {
      const invocation = runtime.events.find((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit" && event.details?.actual_context_id === audit.auditor_context_id);
      const inclusion = invocation?.details?.output?.responseEvidenceInclusion;
      if (!inclusion || inclusion.snapshot_id !== snapshot.id || inclusion.snapshot_sha256 !== snapshot.snapshot_sha256 || inclusion.view_sha256 !== evidence.auditor_inclusion_sha256) return result(RESPONSE_EVIDENCE_CODES.invalid, "auditor_inclusion");
      const sealedReview = normalizeEvidenceReview(invocation.details.output.value?.evidence_review, { candidateText: candidate.exact_text, snapshot });
      if (!same(sealedReview, evidence.review)) return result(RESPONSE_EVIDENCE_CODES.invalid, "audit_review_binding");
    } else {
      const receipt = (record.supervisor_artifacts ?? []).find((entry) => entry.kind === "review_receipt" && entry.audit_id === audit.id && entry.candidate_id === candidate.id && entry.candidate_version === candidate.version);
      if (receipt?.disclosure_manifest?.response_evidence_snapshot_sha256 !== snapshot.snapshot_sha256 || receipt?.disclosure_manifest?.response_evidence_view_sha256 !== evidence.auditor_inclusion_sha256) return result(RESPONSE_EVIDENCE_CODES.invalid, "auditor_inclusion");
    }
    if (deriveEvidenceFindings(evidence.review).length) return result(RESPONSE_EVIDENCE_CODES.unsupported, "blocking_support");
    if (!auditPoint && !responseEvidenceDependenciesCurrent(record, candidate, snapshot)) return result(RESPONSE_EVIDENCE_CODES.stale, "dependencies_changed");
    return result();
  } catch { return result(RESPONSE_EVIDENCE_CODES.invalid, "invalid_evidence"); }
}
