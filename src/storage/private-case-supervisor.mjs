import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { compatibilityStateBinding } from "../case-formulation/protective-compatibility.mjs";
import { candidateDeliveryGate, isActivePrivateCandidate } from "../supervisor/private-candidate-lifecycle.mjs";

// Controlled supervisor drafts. A supervisor draft is an ordinary immutable private candidate that the supervisor path created:
// either the exact client-language bytes a person or host wrote (`external_draft`) or bytes the existing runtime wrote
// (`backend_produced`, `backend_repair`). This module holds everything that is neither the candidate lifecycle nor slice 1's
// communication evidence: the supervisor's own inputs, the separately bound English companion, the review receipts, the basis a
// draft was written against, and the deterministic check that decides whether the exact approved bytes may leave the application.
//
// Only deterministic facts block here: exact bytes, audit, approval, authorization (checked by the access service), and whether
// the case moved on. Translation meaning is recorded as unreviewed because no existing auditor judges it.

export const SUPERVISOR_ARTIFACT_VERSION = 1;
export const SUPERVISOR_DRAFT_VERSION = 1;
export const SUPERVISOR_LIMITS = Object.freeze({
  entries: 2_000,
  input_characters: 40_000,
  companion_characters: 100_000,
  inputs_per_request: 10,
  receipt_flags: 24
});
export const SUPERVISOR_INPUT_TYPES = Object.freeze(["client_message", "supervisor_revision"]);
export const SUPERVISOR_CHANNELS = Object.freeze(["owner_ui", "authenticated_agent"]);
export const SUPERVISOR_DRAFT_SOURCES = Object.freeze(["external_draft", "backend_produced", "backend_repair"]);
export const SUPERVISOR_ENTRY_KINDS = Object.freeze(["input", "companion", "review_receipt"]);

// What the channel proves about who supplied a value: the owner's own app is a verified path, an authenticated agent is not.
const CHANNEL_RESOLUTION = Object.freeze({ owner_ui: "owner_verified", authenticated_agent: "unresolved" });
const AUTHOR_CLAIM = Object.freeze({ client_message: "client", supervisor_revision: "supervisor" });
const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const OPERATION_KEY = /^[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const FLAG_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export const sha256Json = (value) => sha256Text(JSON.stringify(canonicalize(value)));

function exactKeys(value, expected, name) {
  if (!isObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new ValidationError(`${name} has unexpected or missing fields.`);
  }
}

function safeId(value, name) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function timestamp(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || Number.isNaN(Date.parse(value))) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function boundedText(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ValidationError(`${name} must be non-empty text of at most ${maximum} characters.`);
  return value;
}

export function validateOperationKey(value) {
  if (typeof value !== "string" || !OPERATION_KEY.test(value)) throw new ValidationError("operationKey is invalid.");
  return value;
}

export const supervisorCandidateId = (operationKey, version) => `candidate:supervisor:${validateOperationKey(operationKey)}:v${version}`;
export const supervisorAuditId = (operationKey, version) => `audit:supervisor:${validateOperationKey(operationKey)}:v${version}`;

// An opaque handle for one exact candidate version in one case. It carries no authority: every use is resolved inside a case the
// caller is authorized for, and a handle from another case or for other bytes resolves to nothing.
export function supervisorArtifactId(caseId, candidate) {
  const digest = sha256Text(["inner-signal/supervisor-artifact/v1", caseId, candidate.id, String(candidate.version), sha256Text(candidate.exact_text)].join("\u0000"));
  return `art_${digest.slice(0, 40)}`;
}

export const isSupervisorDraftCandidate = (candidate) => isObject(candidate?.metadata?.supervisor_draft);

export function findSupervisorArtifact(record, artifactId) {
  if (typeof artifactId !== "string" || !/^art_[a-f0-9]{40}$/.test(artifactId)) return null;
  return record.candidate_responses.find((candidate) => isSupervisorDraftCandidate(candidate) && supervisorArtifactId(record.case_id, candidate) === artifactId) ?? null;
}

export const supervisorEntries = (record, kind) => (record.supervisor_artifacts ?? []).filter((entry) => entry.kind === kind);

// --- The basis a draft is written against ---------------------------------------------------------------------------------

const retractedIds = (events) => new Set(events.filter((event) => event.kind === "retraction").map((event) => event.retracts_event_id));

function subjectCandidateIds(subject) {
  if (!isObject(subject)) return [];
  if (subject.kind === "candidate") return [subject.candidate_id];
  if (subject.kind === "companion") return [subject.companion_of.candidate_id];
  if (subject.kind === "unresolved") return subject.candidate_refs.map((reference) => reference.candidate_id);
  return [];
}

// Communication evidence that is about the draft's own lineage (its exports and reports, and retractions of those) is the draft's
// own bookkeeping and cannot make it stale. Anything else, such as a report about another message or a correction of one, can.
function foreignCommunicationSignature(record, lineageIds) {
  const events = record.communication_events ?? [];
  const own = new Set();
  for (const event of events) {
    if (event.kind === "retraction" ? own.has(event.retracts_event_id) : subjectCandidateIds(event.subject).some((id) => lineageIds.has(id))) own.add(event.id);
  }
  return events.filter((event) => !own.has(event.id)).map((event) => [event.id, event.kind, event.retracts_event_id ?? null]);
}

// Everything that would make a draft written earlier unsafe to hand over now, under the invalidation rules the case already has:
// a newer client turn or any other transcript change, a correction of the transcript, a change to the protective compatibility
// state, a delivery correction, and a new owner input. A draft's own export and report records are not among them.
export function computeResponseBasis(record, rootCandidateId = null) {
  const lineageIds = new Set(record.candidate_responses.filter((candidate) => candidate.root_candidate_id === rootCandidateId).map((candidate) => candidate.id));
  if (rootCandidateId) lineageIds.add(rootCandidateId);
  const latestUserTurn = [...record.raw_transcript].reverse().find((turn) => turn.role === "user") ?? null;
  return {
    schema_version: SUPERVISOR_DRAFT_VERSION,
    latest_user_turn_id: latestUserTurn?.id ?? null,
    transcript_turn_count: record.raw_transcript.length,
    amendments_sha256: sha256Json(record.transcript_amendments.map((amendment) => [amendment.id, amendment.target_turn_id, amendment.effective_text_sha256 ?? amendment.completion_sha256 ?? null])),
    compatibility_state_binding: compatibilityStateBinding(record.case_state?.protective_compatibility ?? null),
    communication_history_sha256: sha256Json(foreignCommunicationSignature(record, lineageIds)),
    supervisor_inputs_sha256: sha256Json(supervisorEntries(record, "input").map((entry) => entry.id))
  };
}

export const responseBasisDigest = (basis) => sha256Json(basis);

function staleReasonsFromBasis(stored, current) {
  const reasons = [];
  if (stored.latest_user_turn_id !== current.latest_user_turn_id) reasons.push("newer_client_message");
  else if (stored.transcript_turn_count !== current.transcript_turn_count) reasons.push("transcript_changed");
  if (stored.amendments_sha256 !== current.amendments_sha256) reasons.push("transcript_corrected");
  if (stored.compatibility_state_binding !== current.compatibility_state_binding) reasons.push("protective_compatibility_changed");
  if (stored.communication_history_sha256 !== current.communication_history_sha256) reasons.push("delivery_state_changed");
  if (stored.supervisor_inputs_sha256 !== current.supervisor_inputs_sha256) reasons.push("owner_input_added");
  return reasons;
}

// --- The deterministic admission check ------------------------------------------------------------------------------------

export const SUPERVISOR_REFUSALS = Object.freeze({
  stale: "SUPERVISOR_ARTIFACT_STALE",
  not_approved: "SUPERVISOR_ARTIFACT_NOT_APPROVED"
});

// The one place that decides whether the exact bytes of a supervisor draft may be handed over. Slice 3's shared source-support
// validator is called from here at the same point once it exists. Authorization is not decided here: the access service checks
// it on the same call, before the store is opened.
export function assessSupervisorArtifact(record, candidate) {
  const draft = candidate.metadata?.supervisor_draft;
  const textSha256 = sha256Text(candidate.exact_text);
  const sufficientAudit = [...candidate.audit_history].reverse().find((audit) => audit.sufficient_for_approval) ?? null;
  const gate = candidateDeliveryGate(candidate);
  const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate) ?? null;
  const checks = {
    bytes_match_audited_candidate: Boolean(sufficientAudit)
      && sufficientAudit.candidate_sha256 === textSha256
      && sufficientAudit.candidate_id === candidate.id
      && sufficientAudit.candidate_version === candidate.version
      && draft?.text_sha256 === textSha256,
    audit_passed: Boolean(sufficientAudit) && sufficientAudit.verdict === "pass" && sufficientAudit.independent === true,
    approved_for_delivery: candidate.status === "approved_for_delivery" && gate.delivery_allowed === true
      && gate.audit_id === sufficientAudit?.id && candidate.metadata?.approval_audit_id === sufficientAudit?.id,
    current_candidate: current?.id === candidate.id,
    case_unchanged_since_draft: false
  };
  const staleReasons = [];
  if (candidate.status === "superseded") staleReasons.push("superseded_by_newer_draft");
  else if (candidate.status === "sent") staleReasons.push("already_committed_to_transcript");
  else if (!checks.current_candidate) staleReasons.push("not_the_current_candidate");
  if (isObject(draft?.basis)) staleReasons.push(...staleReasonsFromBasis(draft.basis, computeResponseBasis(record, candidate.root_candidate_id)));
  else staleReasons.push("draft_basis_missing");
  checks.case_unchanged_since_draft = staleReasons.length === 0;
  const notApprovedReasons = [];
  if (!checks.audit_passed) notApprovedReasons.push(candidate.status === "audit_failed" ? "audit_failed" : "audit_not_passed");
  if (!checks.bytes_match_audited_candidate) notApprovedReasons.push("audit_does_not_bind_these_bytes");
  if (!checks.approved_for_delivery) notApprovedReasons.push(candidate.status === "audited" ? "approval_pending" : "not_approved_for_delivery");
  const refusal = staleReasons.some((reason) => ["superseded_by_newer_draft", "already_committed_to_transcript", "not_the_current_candidate"].includes(reason))
    ? { code: SUPERVISOR_REFUSALS.stale, reasons: staleReasons }
    : (notApprovedReasons.length ? { code: SUPERVISOR_REFUSALS.not_approved, reasons: notApprovedReasons }
      : (staleReasons.length ? { code: SUPERVISOR_REFUSALS.stale, reasons: staleReasons } : null));
  return Object.freeze({
    checks: Object.freeze(checks),
    approved: checks.bytes_match_audited_candidate && checks.audit_passed && checks.approved_for_delivery,
    fresh: staleReasons.length === 0,
    exportable: refusal === null,
    stale_reasons: Object.freeze(staleReasons),
    not_approved_reasons: Object.freeze(notApprovedReasons),
    refusal: refusal ? Object.freeze(refusal) : null,
    approval_audit_id: sufficientAudit?.id ?? null
  });
}

// --- Entries ---------------------------------------------------------------------------------------------------------------

function suppliedBy(channel) {
  if (!SUPERVISOR_CHANNELS.includes(channel)) throw new ValidationError("The supplying channel is invalid.");
  return { channel, actor_resolution: CHANNEL_RESOLUTION[channel] };
}

export function createSupervisorInputEntry({ id, inputType, text, channel, recordedAt }) {
  safeId(id, "Supervisor input id");
  if (!SUPERVISOR_INPUT_TYPES.includes(inputType)) throw new ValidationError("Supervisor input type is invalid.");
  boundedText(text, "Supervisor input text", SUPERVISOR_LIMITS.input_characters);
  return {
    schema_version: SUPERVISOR_ARTIFACT_VERSION,
    id,
    kind: "input",
    input_type: inputType,
    author_claim: AUTHOR_CLAIM[inputType],
    text,
    text_sha256: sha256Text(text),
    supplied_by: suppliedBy(channel),
    recorded_at: recordedAt
  };
}

// The supervisor's own rendering of one exact candidate version, for the supervisor only. It is bound to the candidate's bytes,
// can never be addressed to the client, and carries no judgment of its meaning because no existing auditor makes one.
export function createSupervisorCompanionEntry({ id, candidate, language, text, channel, recordedAt }) {
  safeId(id, "Companion id");
  if (typeof language !== "string" || !LANGUAGE.test(language)) throw new ValidationError("Companion language is invalid.");
  boundedText(text, "Companion text", SUPERVISOR_LIMITS.companion_characters);
  return {
    schema_version: SUPERVISOR_ARTIFACT_VERSION,
    id,
    kind: "companion",
    companion_of: { candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: sha256Text(candidate.exact_text) },
    language,
    text,
    text_sha256: sha256Text(text),
    supplied_by: suppliedBy(channel),
    audience: "supervisor",
    client_send_allowed: false,
    meaning_review: { status: "unreviewed", reason: "no existing auditor reviews translation meaning" },
    recorded_at: recordedAt
  };
}

// What the independent audit of one exact version was shown, as the audit run itself reported it.
export function createSupervisorReviewReceipt({ id, candidate, auditId, disclosureManifest, providerReceipt, recordedAt }) {
  return {
    schema_version: SUPERVISOR_ARTIFACT_VERSION,
    id,
    kind: "review_receipt",
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    audit_id: auditId,
    disclosure_manifest: isObject(disclosureManifest)
      ? Object.fromEntries(Object.entries(disclosureManifest).filter(([key, flag]) => FLAG_NAME.test(key) && typeof flag === "boolean"))
      : {},
    provider_receipt: isObject(providerReceipt)
      ? Object.fromEntries(["provider", "model", "response_id"].map((key) => [key, typeof providerReceipt[key] === "string" ? providerReceipt[key].slice(0, 200) : null]))
      : null,
    recorded_at: recordedAt
  };
}

function validateSuppliedBy(value, name) {
  exactKeys(value, ["channel", "actor_resolution"], name);
  if (!SUPERVISOR_CHANNELS.includes(value.channel) || value.actor_resolution !== CHANNEL_RESOLUTION[value.channel]) {
    throw new ValidationError(`${name} channel and actor resolution are inconsistent.`);
  }
}

function requireCandidateVersion(record, candidateId, candidateVersion, name) {
  const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
  if (!candidate || candidate.version !== candidateVersion) throw new ValidationError(`${name} does not identify an exact candidate version.`);
  return candidate;
}

function validateEntry(entry, index, record) {
  const name = `supervisor_artifacts[${index}]`;
  if (!isObject(entry) || entry.schema_version !== SUPERVISOR_ARTIFACT_VERSION) throw new ValidationError(`${name} version is invalid.`);
  safeId(entry.id, `${name}.id`);
  timestamp(entry.recorded_at, `${name}.recorded_at`);
  switch (entry.kind) {
    case "input": {
      exactKeys(entry, ["schema_version", "id", "kind", "input_type", "author_claim", "text", "text_sha256", "supplied_by", "recorded_at"], name);
      if (!SUPERVISOR_INPUT_TYPES.includes(entry.input_type) || entry.author_claim !== AUTHOR_CLAIM[entry.input_type]) throw new ValidationError(`${name} type and author claim are inconsistent.`);
      boundedText(entry.text, `${name}.text`, SUPERVISOR_LIMITS.input_characters);
      if (entry.text_sha256 !== sha256Text(entry.text)) throw new ValidationError(`${name} does not bind its exact text.`);
      validateSuppliedBy(entry.supplied_by, `${name}.supplied_by`);
      break;
    }
    case "companion": {
      exactKeys(entry, ["schema_version", "id", "kind", "companion_of", "language", "text", "text_sha256", "supplied_by", "audience", "client_send_allowed", "meaning_review", "recorded_at"], name);
      exactKeys(entry.companion_of, ["candidate_id", "candidate_version", "candidate_sha256"], `${name}.companion_of`);
      const candidate = requireCandidateVersion(record, entry.companion_of.candidate_id, entry.companion_of.candidate_version, `${name}.companion_of`);
      if (entry.companion_of.candidate_sha256 !== sha256Text(candidate.exact_text)) throw new ValidationError(`${name} does not bind the exact candidate bytes.`);
      if (typeof entry.language !== "string" || !LANGUAGE.test(entry.language)) throw new ValidationError(`${name}.language is invalid.`);
      boundedText(entry.text, `${name}.text`, SUPERVISOR_LIMITS.companion_characters);
      if (entry.text_sha256 !== sha256Text(entry.text)) throw new ValidationError(`${name} does not bind its exact text.`);
      validateSuppliedBy(entry.supplied_by, `${name}.supplied_by`);
      if (entry.audience !== "supervisor" || entry.client_send_allowed !== false) throw new ValidationError(`${name} must remain supervisor-only.`);
      exactKeys(entry.meaning_review, ["status", "reason"], `${name}.meaning_review`);
      if (entry.meaning_review.status !== "unreviewed" || typeof entry.meaning_review.reason !== "string") throw new ValidationError(`${name}.meaning_review is invalid.`);
      break;
    }
    case "review_receipt": {
      exactKeys(entry, ["schema_version", "id", "kind", "candidate_id", "candidate_version", "audit_id", "disclosure_manifest", "provider_receipt", "recorded_at"], name);
      const candidate = requireCandidateVersion(record, entry.candidate_id, entry.candidate_version, name);
      if (!candidate.audit_history.some((audit) => audit.id === entry.audit_id)) throw new ValidationError(`${name} does not identify a stored audit of that candidate version.`);
      if (!isObject(entry.disclosure_manifest) || Object.keys(entry.disclosure_manifest).length > SUPERVISOR_LIMITS.receipt_flags
          || Object.entries(entry.disclosure_manifest).some(([key, flag]) => !FLAG_NAME.test(key) || typeof flag !== "boolean")) {
        throw new ValidationError(`${name}.disclosure_manifest is invalid.`);
      }
      if (entry.provider_receipt !== null) {
        exactKeys(entry.provider_receipt, ["provider", "model", "response_id"], `${name}.provider_receipt`);
        for (const value of Object.values(entry.provider_receipt)) if (value !== null && (typeof value !== "string" || value.length > 200)) throw new ValidationError(`${name}.provider_receipt is invalid.`);
      }
      break;
    }
    default:
      throw new ValidationError(`${name}.kind is invalid.`);
  }
}

function validateDraftMetadata(candidate, name) {
  const draft = candidate.metadata.supervisor_draft;
  exactKeys(draft, ["schema_version", "source", "root_source", "operation_key", "text_sha256", "basis", "basis_sha256", "exposure"], `${name}.metadata.supervisor_draft`);
  if (draft.schema_version !== SUPERVISOR_DRAFT_VERSION || !SUPERVISOR_DRAFT_SOURCES.includes(draft.source) || !["external_draft", "backend_produced"].includes(draft.root_source)) {
    throw new ValidationError(`${name} supervisor draft source is invalid.`);
  }
  validateOperationKey(draft.operation_key);
  if (draft.text_sha256 !== sha256Text(candidate.exact_text)) throw new ValidationError(`${name} supervisor draft does not bind the exact candidate bytes.`);
  exactKeys(draft.basis, ["schema_version", "latest_user_turn_id", "transcript_turn_count", "amendments_sha256", "compatibility_state_binding", "communication_history_sha256", "supervisor_inputs_sha256"], `${name}.metadata.supervisor_draft.basis`);
  if (draft.basis_sha256 !== responseBasisDigest(draft.basis)) throw new ValidationError(`${name} supervisor draft basis is inconsistent.`);
  exactKeys(draft.exposure, ["exact_bytes", "original_writer", "auditor_inputs"], `${name}.metadata.supervisor_draft.exposure`);
  const expected = draft.source === "external_draft"
    ? ["received_and_stored", "not_attested"]
    : [draft.source === "backend_repair" ? "produced_by_backend_repair" : "produced_by_backend", "backend_inclusion_receipts"];
  if (draft.exposure.exact_bytes !== expected[0] || draft.exposure.original_writer !== expected[1] || draft.exposure.auditor_inputs !== "case_record_only") {
    throw new ValidationError(`${name} supervisor draft exposure is inconsistent with its source.`);
  }
  if (!SHA256.test(draft.basis_sha256)) throw new ValidationError(`${name} supervisor draft basis digest is invalid.`);
}

export function validateSupervisorArtifacts(values, record) {
  if (!Array.isArray(values) || values.length > SUPERVISOR_LIMITS.entries) throw new ValidationError("supervisor_artifacts exceeds the private-record limit or is invalid.");
  const ids = new Set();
  values.forEach((entry, index) => {
    validateEntry(entry, index, record);
    if (ids.has(entry.id)) throw new ValidationError(`Duplicate supervisor artifact entry ${entry.id}.`);
    ids.add(entry.id);
  });
  record.candidate_responses.forEach((candidate, index) => {
    if (isSupervisorDraftCandidate(candidate)) validateDraftMetadata(candidate, `candidate_responses[${index}]`);
  });
  return values;
}

// --- Views -----------------------------------------------------------------------------------------------------------------

function activeCommunication(record) {
  const events = record.communication_events ?? [];
  const retracted = retractedIds(events);
  return events.filter((event) => event.kind !== "retraction" && !retracted.has(event.id));
}

function lastEvent(events, predicate) {
  return [...events].reverse().find(predicate) ?? null;
}

function eventReceipt(event) {
  if (!event) return null;
  return {
    event_id: event.id,
    recorded_at: event.recorded_at,
    origin: event.provenance.origin,
    actor_resolution: event.provenance.actor_resolution,
    ...(event.kind === "reported_sent" ? { sent_at: event.sent_at, sent_at_status: event.sent_at_status } : {})
  };
}

export function companionForCandidate(record, candidate) {
  const sha = sha256Text(candidate.exact_text);
  return supervisorEntries(record, "companion").find((entry) => entry.companion_of.candidate_id === candidate.id
    && entry.companion_of.candidate_version === candidate.version && entry.companion_of.candidate_sha256 === sha) ?? null;
}

export function companionView(entry, { includeText = false } = {}) {
  if (!entry) return null;
  return {
    companion_id: entry.id,
    language: entry.language,
    text_sha256: entry.text_sha256,
    audience: "supervisor",
    client_send_allowed: false,
    meaning_review: { ...entry.meaning_review },
    supplied_by: { ...entry.supplied_by },
    ...(includeText ? { text: entry.text } : {})
  };
}

// A supervisor artifact as the owner's surfaces list it. It never carries the client text; only the controlled export does.
export function supervisorArtifactView(record, candidate) {
  const draft = candidate.metadata.supervisor_draft;
  const assessment = assessSupervisorArtifact(record, candidate);
  const events = activeCommunication(record);
  const own = events.filter((event) => event.audience === "client" && event.subject.kind === "candidate"
    && event.subject.candidate_id === candidate.id && event.subject.candidate_version === candidate.version);
  const reported = lastEvent(own, (event) => event.kind === "reported_sent");
  const exported = lastEvent(own, (event) => event.kind === "exported");
  const lineage = record.candidate_responses
    .filter((entry) => entry.root_candidate_id === candidate.root_candidate_id)
    .map((entry) => ({ candidate_id: entry.id, candidate_version: entry.version, status: entry.status, repair_cycle: entry.repair_cycle, source: entry.metadata?.supervisor_draft?.source ?? null }));
  const latestAudit = candidate.audit_history.at(-1) ?? null;
  return {
    artifact_id: supervisorArtifactId(record.case_id, candidate),
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    status: candidate.status,
    source: draft.source,
    root_source: draft.root_source,
    text_sha256: draft.text_sha256,
    basis_sha256: draft.basis_sha256,
    exposure: { ...draft.exposure },
    review: {
      repair_cycle: candidate.repair_cycle,
      latest_audit_id: latestAudit?.id ?? null,
      latest_verdict: latestAudit?.verdict ?? null,
      approval_audit_id: assessment.approval_audit_id,
      lineage
    },
    approved: assessment.approved,
    fresh: assessment.fresh,
    exportable: assessment.exportable,
    stale_reasons: [...assessment.stale_reasons],
    not_approved_reasons: [...assessment.not_approved_reasons],
    companion: companionView(companionForCandidate(record, candidate)),
    delivery: {
      exported: eventReceipt(exported),
      reported_sent: eventReceipt(reported),
      transport_or_recipient_acknowledged: false
    }
  };
}

export function supervisorArtifactViews(record) {
  return record.candidate_responses.filter(isSupervisorDraftCandidate).map((candidate) => supervisorArtifactView(record, candidate));
}

export function supervisorInputViews(record) {
  return supervisorEntries(record, "input").map((entry) => ({
    input_id: entry.id,
    input_type: entry.input_type,
    author_claim: entry.author_claim,
    text: entry.text,
    text_sha256: entry.text_sha256,
    supplied_by: { ...entry.supplied_by },
    recorded_at: entry.recorded_at
  }));
}
