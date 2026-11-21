import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { isActivePrivateCandidate, PRIVATE_CANDIDATE_STATUSES } from "../supervisor/private-candidate-lifecycle.mjs";

// Communication evidence for a private case. A candidate that reads `sent` says little by itself: the application may have
// committed the exact bytes to the transcript, an operator may only have marked a status, or the owner may have reported
// sending the text. This module keeps those apart and never lets a draft, an export or a translation count as client history.
//
// Observations are appended to the encrypted record and never rewritten; a correction retracts the earlier event and records
// a new one. Every projection is derived here from the record, never accepted from a caller.

export const COMMUNICATION_EVENT_VERSION = 1;
export const COMMUNICATION_PROJECTION_VERSION = 1;
export const HISTORICAL_DELIVERY_KIND = "owner_reported_historical_delivery";
export const COMMUNICATION_LIMITS = Object.freeze({
  events: 1_000,
  listed_items: 25,
  ambiguous_candidate_refs: 10,
  quote_characters: 2_000,
  reason_characters: 500
});
export const COMMUNICATION_STATES = Object.freeze(["draft", "exposed", "exported", "reported_sent", "app_committed", "unknown"]);
export const COMMUNICATION_AUDIENCES = Object.freeze(["client", "supervisor", "unknown"]);
// `transport_acknowledged` and `recipient_acknowledged` are reserved for an integration that can attest them; nothing here records them.
export const DELIVERY_EVIDENCE_LEVELS = Object.freeze(["none", "owner_reported_sent", "application_persisted", "unknown"]);
export const COMMUNICATION_EVENT_KINDS = Object.freeze(["exposed", "exported", "reported_sent", "retraction"]);
export const COMMUNICATION_ORIGINS = Object.freeze(["owner_action", "agent_relayed", "application"]);

const ACTOR_RESOLUTION = Object.freeze({ owner_action: "owner_verified", agent_relayed: "unresolved", application: "application" });
const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const NO_TIME = Object.freeze({ at: null, status: "unavailable" });

const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value, expected, name) {
  if (!isObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new ValidationError(`${name} has unexpected or missing fields.`);
  }
}

function safeId(value, name) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

// Ids of turns and candidates that already exist in the record are only bounded here: the record's own validators never
// restricted their characters, and a stricter rule here would reject older cases.
function refId(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function timestamp(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || Number.isNaN(Date.parse(value))) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

const events = (record) => record.communication_events ?? [];
const retractedIds = (all) => new Set(all.filter((event) => event.kind === "retraction").map((event) => event.retracts_event_id));

function requireCandidate(record, candidateId, candidateVersion, name) {
  const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
  if (!candidate || candidate.version !== candidateVersion) throw new ValidationError(`${name} does not identify an exact candidate version.`);
  return candidate;
}

function requireTranscriptPair(record, assistantTurnId, userTurnId, name, turnIndex = null) {
  const turns = record.raw_transcript;
  const locate = (id) => (turnIndex ? turnIndex.get(id) ?? -1 : turns.findIndex((turn) => turn.id === id));
  const assistantIndex = locate(assistantTurnId);
  const userIndex = locate(userTurnId);
  const assistantTurn = turns[assistantIndex];
  const userTurn = turns[userIndex];
  if (!assistantTurn || assistantTurn.role !== "assistant" || !userTurn || userTurn.role !== "user"
      || userTurn.exchange_id !== assistantTurn.exchange_id || userIndex !== assistantIndex - 1) {
    throw new ValidationError(`${name} must identify an adjacent stored user turn and the assistant turn that answers it.`);
  }
  return { assistantTurn, userTurn };
}

function validateProvenance(value, kind, name) {
  exactKeys(value, ["origin", "actor_resolution", "source_ref", "quote"], name);
  if (!COMMUNICATION_ORIGINS.includes(value.origin) || value.actor_resolution !== ACTOR_RESOLUTION[value.origin]) {
    throw new ValidationError(`${name} origin and actor resolution are inconsistent.`);
  }
  if (kind === "reported_sent" && value.origin === "application") throw new ValidationError(`${name}: the application cannot report that the owner sent a message.`);
  if (value.source_ref !== null) safeId(value.source_ref, `${name}.source_ref`);
  if (value.quote !== null && (typeof value.quote !== "string" || !value.quote.trim() || value.quote.length > COMMUNICATION_LIMITS.quote_characters)) {
    throw new ValidationError(`${name}.quote is invalid.`);
  }
}

function validateSubject(subject, kind, audience, record, name, turnIndex = null) {
  if (!isObject(subject)) throw new ValidationError(`${name} must be an object.`);
  switch (subject.kind) {
    case "candidate": {
      exactKeys(subject, ["kind", "candidate_id", "candidate_version", "text_sha256"], name);
      const candidate = requireCandidate(record, subject.candidate_id, subject.candidate_version, name);
      if (subject.text_sha256 !== sha256Text(candidate.exact_text)) throw new ValidationError(`${name} does not bind the exact candidate bytes.`);
      break;
    }
    case "companion": {
      exactKeys(subject, ["kind", "companion_of", "artifact_sha256"], name);
      exactKeys(subject.companion_of, ["candidate_id", "candidate_version"], `${name}.companion_of`);
      requireCandidate(record, subject.companion_of.candidate_id, subject.companion_of.candidate_version, `${name}.companion_of`);
      digest(subject.artifact_sha256, `${name}.artifact_sha256`);
      break;
    }
    case "transcript_turn": {
      exactKeys(subject, ["kind", "assistant_turn_id", "in_reply_to_turn_id", "text_sha256"], name);
      const { assistantTurn } = requireTranscriptPair(record, subject.assistant_turn_id, subject.in_reply_to_turn_id, name, turnIndex);
      if (subject.text_sha256 !== sha256Text(assistantTurn.text)) throw new ValidationError(`${name} does not bind the exact assistant turn bytes.`);
      break;
    }
    case "unresolved": {
      exactKeys(subject, ["kind", "reason", "candidate_refs"], name);
      if (subject.reason !== "ambiguous") throw new ValidationError(`${name}.reason is invalid.`);
      if (!Array.isArray(subject.candidate_refs) || subject.candidate_refs.length > COMMUNICATION_LIMITS.ambiguous_candidate_refs) {
        throw new ValidationError(`${name}.candidate_refs is invalid.`);
      }
      const seen = new Set();
      for (const reference of subject.candidate_refs) {
        exactKeys(reference, ["candidate_id", "candidate_version"], `${name}.candidate_refs`);
        requireCandidate(record, reference.candidate_id, reference.candidate_version, `${name}.candidate_refs`);
        if (seen.has(reference.candidate_id)) throw new ValidationError(`${name}.candidate_refs repeats a candidate.`);
        seen.add(reference.candidate_id);
      }
      break;
    }
    default:
      throw new ValidationError(`${name}.kind is invalid.`);
  }
  const permitted = kind === "reported_sent"
    ? audience === "client" && ["candidate", "transcript_turn", "unresolved"].includes(subject.kind)
    : (audience === "client" ? subject.kind === "candidate" : subject.kind === "companion");
  if (!permitted) throw new ValidationError(`${name} is not valid for a ${kind} event addressed to the ${audience}.`);
}

function validateEvent(event, index, record, turnIndex = null) {
  const name = `communication_events[${index}]`;
  if (!isObject(event) || event.schema_version !== COMMUNICATION_EVENT_VERSION) throw new ValidationError(`${name} version is invalid.`);
  safeId(event.id, `${name}.id`);
  if (!COMMUNICATION_EVENT_KINDS.includes(event.kind)) throw new ValidationError(`${name}.kind is invalid.`);
  timestamp(event.recorded_at, `${name}.recorded_at`);
  if (event.kind === "retraction") {
    exactKeys(event, ["schema_version", "id", "kind", "recorded_at", "retracts_event_id", "reason", "provenance"], name);
    safeId(event.retracts_event_id, `${name}.retracts_event_id`);
    if (event.reason !== null && (typeof event.reason !== "string" || !event.reason.trim() || event.reason.length > COMMUNICATION_LIMITS.reason_characters)) {
      throw new ValidationError(`${name}.reason is invalid.`);
    }
    validateProvenance(event.provenance, event.kind, `${name}.provenance`);
    return;
  }
  const reported = event.kind === "reported_sent";
  exactKeys(event, ["schema_version", "id", "kind", "recorded_at", "audience", "subject", "provenance", ...(reported ? ["sent_at", "sent_at_status"] : [])], name);
  if (!["client", "supervisor"].includes(event.audience)) throw new ValidationError(`${name}.audience is invalid.`);
  validateSubject(event.subject, event.kind, event.audience, record, `${name}.subject`, turnIndex);
  if (reported) {
    if (event.sent_at_status === "known") timestamp(event.sent_at, `${name}.sent_at`);
    else if (event.sent_at_status !== "unavailable" || event.sent_at !== null) throw new ValidationError(`${name} send time must be known or explicitly unavailable.`);
  }
  validateProvenance(event.provenance, event.kind, `${name}.provenance`);
}

export function validateCommunicationEvents(values, record) {
  if (!Array.isArray(values) || values.length > COMMUNICATION_LIMITS.events) throw new ValidationError("communication_events exceeds the private-record limit or is invalid.");
  const kinds = new Map();
  const retracted = new Set();
  // One lookup table for the whole list, so a long transcript is not rescanned for every stored pair.
  const turnIndex = values.some((event) => event?.subject?.kind === "transcript_turn") ? transcriptIndex(record) : null;
  values.forEach((event, index) => {
    validateEvent(event, index, record, turnIndex);
    if (kinds.has(event.id)) throw new ValidationError(`Duplicate communication event ${event.id}.`);
    if (event.kind === "retraction") {
      const targetKind = kinds.get(event.retracts_event_id);
      if (targetKind === undefined) throw new ValidationError(`communication_events[${index}] retracts an event that does not precede it.`);
      if (targetKind === "retraction") throw new ValidationError(`communication_events[${index}] cannot retract a retraction.`);
      if (retracted.has(event.retracts_event_id)) throw new ValidationError(`communication_events[${index}] retracts an event that is already retracted.`);
      retracted.add(event.retracts_event_id);
    }
    kinds.set(event.id, event.kind);
  });
  return values;
}

function storedSubject(subject, record) {
  if (!isObject(subject)) throw new ValidationError("Communication subject is required.");
  switch (subject.kind) {
    case "candidate": {
      const candidate = requireCandidate(record, subject.candidateId, subject.candidateVersion, "Communication subject");
      return { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, text_sha256: sha256Text(candidate.exact_text) };
    }
    case "companion":
      return {
        kind: "companion",
        companion_of: { candidate_id: subject.companionOf?.candidateId, candidate_version: subject.companionOf?.candidateVersion },
        artifact_sha256: subject.artifactSha256
      };
    case "transcript_turn": {
      const { assistantTurn } = requireTranscriptPair(record, subject.assistantTurnId, subject.inReplyToTurnId, "Communication subject");
      return { kind: "transcript_turn", assistant_turn_id: assistantTurn.id, in_reply_to_turn_id: subject.inReplyToTurnId, text_sha256: sha256Text(assistantTurn.text) };
    }
    case "unresolved": {
      if (subject.candidateRefs != null && !Array.isArray(subject.candidateRefs)) throw new ValidationError("Communication subject candidateRefs must be an array.");
      return {
        kind: "unresolved",
        reason: "ambiguous",
        candidate_refs: (subject.candidateRefs ?? []).map((reference) => ({ candidate_id: reference?.candidateId, candidate_version: reference?.candidateVersion }))
      };
    }
    default:
      throw new ValidationError("Communication subject kind is invalid.");
  }
}

// Builds the stored form of one event from an operation's input. The record decides every hash; the caller never supplies one.
export function createCommunicationEvent(record, input, { recordedAt } = {}) {
  if (!isObject(input)) throw new ValidationError("Communication event input must be an object.");
  const supplied = isObject(input.provenance) ? input.provenance : {};
  const provenance = {
    origin: supplied.origin,
    actor_resolution: Object.hasOwn(ACTOR_RESOLUTION, supplied.origin) ? ACTOR_RESOLUTION[supplied.origin] : null,
    source_ref: supplied.sourceRef ?? null,
    quote: supplied.quote ?? null
  };
  const base = { schema_version: COMMUNICATION_EVENT_VERSION, id: input.eventId, kind: input.kind, recorded_at: recordedAt };
  if (input.kind === "retraction") return { ...base, retracts_event_id: input.retractsEventId, reason: input.reason ?? null, provenance };
  return {
    ...base,
    audience: input.audience,
    subject: storedSubject(input.subject, record),
    ...(input.kind === "reported_sent" ? { sent_at: input.sentAt ?? null, sent_at_status: input.sentAt == null ? "unavailable" : "known" } : {}),
    provenance
  };
}

// An exact replay of an event already recorded changes nothing; the recording time is the one field a replay cannot repeat.
export function sameCommunicationEvent(left, right) {
  const withoutTime = ({ recorded_at: _recordedAt, ...rest }) => JSON.stringify(canonicalize(rest));
  return withoutTime(left) === withoutTime(right);
}

// The application committed these exact bytes as the assistant turn that answers the user turn, under the approving audit.
// One resolver serves the ordinary delivery exit, the automatic runtime exit and the handoff, so they cannot disagree.
// A candidate that was only marked `sent` has no transcript proof and resolves to null.
export function resolveCandidateAppDelivery(record, candidate, turnIndex = null) {
  if (candidate?.status !== "sent") return null;
  const metadata = candidate.metadata ?? {};
  if (metadata.sent_status_only === true) return null;
  const auditId = metadata.sent_with_audit_id;
  if (typeof auditId !== "string" || !auditId) return null;
  let assistantTurnId = metadata.sent_turn_id;
  let userTurnId = metadata.sent_in_reply_to_turn_id;
  let route = "transcript_bound";
  if (assistantTurnId == null && userTurnId == null) {
    // Runtime deliveries made before they carried the transcript identifiers are bound by the runtime turn's own receipt.
    const runtimeTurn = (record.runtime_turns ?? []).find((entry) => entry.delivery?.kind === "candidate" && entry.delivery.candidate_id === candidate.id);
    if (!runtimeTurn || runtimeTurn.delivery.candidate_version !== candidate.version || runtimeTurn.delivery.audit_id !== auditId) return null;
    assistantTurnId = runtimeTurn.delivery.assistant_turn_id;
    userTurnId = runtimeTurn.user_turn_id;
    route = "runtime_receipt";
  }
  if (typeof assistantTurnId !== "string" || !assistantTurnId || typeof userTurnId !== "string" || !userTurnId) return null;
  const turns = record.raw_transcript;
  const indexOf = (id) => (turnIndex ? turnIndex.get(id) ?? -1 : turns.findIndex((turn) => turn.id === id));
  const assistantIndex = indexOf(assistantTurnId);
  const userIndex = indexOf(userTurnId);
  const assistantTurn = turns[assistantIndex];
  const userTurn = turns[userIndex];
  if (!assistantTurn || assistantTurn.role !== "assistant" || assistantTurn.text !== candidate.exact_text) return null;
  if (!userTurn || userTurn.role !== "user" || userIndex >= assistantIndex || userTurn.exchange_id !== assistantTurn.exchange_id) return null;
  if (!episodesAgree(userTurn, assistantTurn)) return null;
  return Object.freeze({
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    candidate_sha256: sha256Text(candidate.exact_text),
    audit_id: auditId,
    assistant_turn_id: assistantTurn.id,
    in_reply_to_turn_id: userTurn.id,
    delivered_at: assistantTurn.at,
    route
  });
}

// Both delivery exits give the reply the user turn's episode, or the current episode when the user turn has none.
export function episodesAgree(userTurn, assistantTurn) {
  return (userTurn.episode_id ?? null) === null || userTurn.episode_id === (assistantTurn.episode_id ?? null);
}

function transcriptIndex(record) {
  const positions = new Map();
  record.raw_transcript.forEach((turn, position) => { if (!positions.has(turn.id)) positions.set(turn.id, position); });
  return positions;
}

// An owner-reported delivery of the stored pair that ends the transcript, for a case with no candidate governing the
// continuation decision. It is continuity provenance only: it records no audit and approves nothing. Only a report the owner
// made through a verified path counts; an agent's relay of one is recorded but does not open this gate.
// An unsent candidate in any active status (awaiting audit, audit failed, audited or approved) still governs the next decision,
// whether or not the continuation context selects it, and its blocking audit must not be hidden behind an earlier delivery.
export function resolveHistoricalDeliveryCheckpoint(record) {
  if (record.candidate_responses.some(isActivePrivateCandidate)) return null;
  const all = events(record);
  const retracted = retractedIds(all);
  const lastIndex = record.raw_transcript.length - 1;
  for (let position = all.length - 1; position >= 0; position -= 1) {
    const event = all[position];
    if (event.kind !== "reported_sent" || retracted.has(event.id) || event.subject.kind !== "transcript_turn") continue;
    if (event.provenance.actor_resolution !== "owner_verified") continue;
    const assistantIndex = record.raw_transcript.findIndex((turn) => turn.id === event.subject.assistant_turn_id);
    const userIndex = record.raw_transcript.findIndex((turn) => turn.id === event.subject.in_reply_to_turn_id);
    if (assistantIndex !== lastIndex || userIndex !== assistantIndex - 1) continue;
    return Object.freeze({
      schema_version: 1,
      kind: HISTORICAL_DELIVERY_KIND,
      event_id: event.id,
      assistant_turn_id: event.subject.assistant_turn_id,
      in_reply_to_turn_id: event.subject.in_reply_to_turn_id,
      text_sha256: event.subject.text_sha256,
      reported_sent_at_status: event.sent_at_status,
      reported_sent_at: event.sent_at,
      recorded_at: event.recorded_at,
      provenance: { origin: event.provenance.origin, actor_resolution: event.provenance.actor_resolution }
    });
  }
  return null;
}

export function validateHistoricalDeliveryCheckpoint(value, { rawTranscript = null } = {}) {
  const name = "historical_delivery_completion";
  exactKeys(value, ["schema_version", "kind", "event_id", "assistant_turn_id", "in_reply_to_turn_id", "text_sha256", "reported_sent_at_status", "reported_sent_at", "recorded_at", "provenance"], name);
  if (value.schema_version !== 1 || value.kind !== HISTORICAL_DELIVERY_KIND) throw new ValidationError(`${name} is invalid.`);
  safeId(value.event_id, `${name}.event_id`);
  refId(value.assistant_turn_id, `${name}.assistant_turn_id`);
  refId(value.in_reply_to_turn_id, `${name}.in_reply_to_turn_id`);
  digest(value.text_sha256, `${name}.text_sha256`);
  timestamp(value.recorded_at, `${name}.recorded_at`);
  if (value.reported_sent_at_status === "known") timestamp(value.reported_sent_at, `${name}.reported_sent_at`);
  else if (value.reported_sent_at_status !== "unavailable" || value.reported_sent_at !== null) throw new ValidationError(`${name} send time must be known or explicitly unavailable.`);
  exactKeys(value.provenance, ["origin", "actor_resolution"], `${name}.provenance`);
  if (value.provenance.origin !== "owner_action" || value.provenance.actor_resolution !== "owner_verified") {
    throw new ValidationError(`${name} requires a report the owner made through a verified path.`);
  }
  if (rawTranscript) {
    const lastIndex = rawTranscript.length - 1;
    const assistantTurn = rawTranscript[lastIndex];
    const userTurn = rawTranscript[lastIndex - 1];
    if (!assistantTurn || assistantTurn.id !== value.assistant_turn_id || assistantTurn.role !== "assistant" || sha256Text(assistantTurn.text) !== value.text_sha256
        || !userTurn || userTurn.id !== value.in_reply_to_turn_id || userTurn.role !== "user" || userTurn.exchange_id !== assistantTurn.exchange_id) {
      throw new ValidationError(`${name} is not bound to the stored pair that ends the transcript.`);
    }
  }
  return value;
}

function sourceOf(kind, fields = {}) {
  return { kind, route: null, audit_id: null, event_id: null, origin: null, actor_resolution: null, source_ref: null, ...fields };
}

function eventSource(kind, event) {
  return sourceOf(kind, { event_id: event.id, origin: event.provenance.origin, actor_resolution: event.provenance.actor_resolution, source_ref: event.provenance.source_ref });
}

function item({ subject, audience, state, evidence, source, candidateStatus = null, inReplyTo = null, assistantTurnId = null, time = NO_TIME, corroborating = [] }) {
  return {
    subject,
    audience,
    state,
    delivery_evidence: evidence,
    source,
    candidate_status: candidateStatus,
    in_reply_to_turn_id: inReplyTo,
    assistant_turn_id: assistantTurnId,
    event_time: { ...time },
    corroborating_event_ids: corroborating
  };
}

const candidateSubject = (candidate) => ({ kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, text_sha256: sha256Text(candidate.exact_text) });

function lastWithKind(group, kind) {
  return [...group].reverse().find((event) => event.kind === kind) ?? null;
}

function reportedItem(event, subject, extra = {}) {
  const resolved = event.subject.kind !== "unresolved";
  return item({
    subject,
    audience: "client",
    state: "reported_sent",
    evidence: "owner_reported_sent",
    source: eventSource("owner_report", event),
    time: { at: event.sent_at, status: event.sent_at_status },
    inReplyTo: resolved && event.subject.kind === "transcript_turn" ? event.subject.in_reply_to_turn_id : null,
    assistantTurnId: resolved && event.subject.kind === "transcript_turn" ? event.subject.assistant_turn_id : null,
    ...extra
  });
}

// What the case can truthfully say about each piece of text. `confirmed_or_reported_client_outbound` holds only what the
// application committed or the owner reported sending; `supervisor_only_artifacts` holds drafts, exposures and exports that
// no evidence says reached the client; `unresolved_delivery` holds what the record cannot place. A raw `sent` status, an
// ambiguous report, and assistant turns nothing vouches for are `unknown`, never promoted.
export function projectCommunicationState(record) {
  const all = events(record);
  const retracted = retractedIds(all);
  const active = all.filter((event) => event.kind !== "retraction" && !retracted.has(event.id));
  const index = transcriptIndex(record);
  const candidateItems = [];
  const pairItems = [];
  const companionItems = [];
  const unresolvedItems = [];
  const attributedAssistantTurns = new Set();
  const committedByApp = new Set();
  const pairReports = new Map();
  for (const event of active) {
    if (event.kind === "reported_sent" && event.subject.kind === "transcript_turn") {
      pairReports.set(event.subject.assistant_turn_id, [...(pairReports.get(event.subject.assistant_turn_id) ?? []), event]);
    }
  }
  const pairReportIds = (assistantTurnId) => (pairReports.get(assistantTurnId) ?? []).map((event) => event.id);

  for (const candidate of record.candidate_responses) {
    const subject = candidateSubject(candidate);
    const delivery = resolveCandidateAppDelivery(record, candidate, index);
    const own = active.filter((event) => event.subject.kind === "candidate" && event.subject.candidate_id === candidate.id && event.subject.candidate_version === candidate.version);
    const reports = own.filter((event) => event.kind === "reported_sent");
    const common = { subject, candidateStatus: candidate.status };
    if (delivery) {
      attributedAssistantTurns.add(delivery.assistant_turn_id);
      committedByApp.add(delivery.assistant_turn_id);
      candidateItems.push({ list: "confirmed", value: item({
        ...common,
        audience: "client",
        state: "app_committed",
        evidence: "application_persisted",
        source: sourceOf("application_transcript", { route: delivery.route, audit_id: delivery.audit_id }),
        inReplyTo: delivery.in_reply_to_turn_id,
        assistantTurnId: delivery.assistant_turn_id,
        time: { at: delivery.delivered_at, status: "known" },
        corroborating: [...reports.map((event) => event.id), ...pairReportIds(delivery.assistant_turn_id)]
      }) });
    } else if (reports.length) {
      candidateItems.push({ list: "confirmed", value: reportedItem(reports.at(-1), subject, { candidateStatus: candidate.status, corroborating: reports.slice(0, -1).map((event) => event.id) }) });
    } else if (candidate.status === "sent") {
      candidateItems.push({ list: "unresolved", value: item({
        ...common,
        audience: "unknown",
        state: "unknown",
        evidence: "unknown",
        source: sourceOf("legacy_status_only", {
          route: candidate.metadata?.sent_status_only === true ? "mark_candidate_sent" : null,
          audit_id: candidate.metadata?.sent_with_audit_id ?? null
        })
      }) });
    } else {
      const exported = lastWithKind(own, "exported");
      const exposed = lastWithKind(own, "exposed");
      const event = exported ?? exposed;
      candidateItems.push({ list: "supervisor", value: item({
        ...common,
        audience: "client",
        state: exported ? "exported" : (exposed ? "exposed" : "draft"),
        evidence: "none",
        source: event ? eventSource("communication_event", event) : sourceOf("candidate_status")
      }) });
    }
  }

  for (const runtimeTurn of record.runtime_turns ?? []) {
    const delivery = runtimeTurn.delivery;
    if (!["discriminator", "owner_fallback"].includes(delivery?.kind)) continue;
    attributedAssistantTurns.add(delivery.assistant_turn_id);
    committedByApp.add(delivery.assistant_turn_id);
    pairItems.push({ list: "confirmed", value: item({
      subject: { kind: "transcript_turn", assistant_turn_id: delivery.assistant_turn_id, in_reply_to_turn_id: runtimeTurn.user_turn_id, text_sha256: delivery.sha256 },
      audience: "client",
      state: "app_committed",
      evidence: "application_persisted",
      source: sourceOf("application_transcript", { route: delivery.kind === "owner_fallback" ? "runtime_owner_fallback" : "runtime_discriminator" }),
      inReplyTo: runtimeTurn.user_turn_id,
      assistantTurnId: delivery.assistant_turn_id,
      time: { at: delivery.delivered_at, status: "known" },
      corroborating: pairReportIds(delivery.assistant_turn_id)
    }) });
  }

  for (const [assistantTurnId, reports] of pairReports) {
    attributedAssistantTurns.add(assistantTurnId);
    if (committedByApp.has(assistantTurnId)) continue;
    pairItems.push({ list: "confirmed", value: reportedItem(reports.at(-1), reports.at(-1).subject, { corroborating: reports.slice(0, -1).map((event) => event.id) }) });
  }

  const companions = new Map();
  for (const event of active) {
    if (event.subject.kind !== "companion") continue;
    const key = `${event.subject.companion_of.candidate_id}:${event.subject.companion_of.candidate_version}:${event.subject.artifact_sha256}`;
    companions.set(key, [...(companions.get(key) ?? []), event]);
  }
  for (const group of companions.values()) {
    const exported = lastWithKind(group, "exported");
    const event = exported ?? group.at(-1);
    companionItems.push({ list: "supervisor", value: item({
      subject: event.subject,
      audience: "supervisor",
      state: exported ? "exported" : "exposed",
      evidence: "none",
      source: eventSource("communication_event", event)
    }) });
  }

  for (const event of active) {
    if (event.kind !== "reported_sent" || event.subject.kind !== "unresolved") continue;
    unresolvedItems.push({ list: "unresolved", value: reportedItem(event, event.subject) });
  }

  const unattributed = record.raw_transcript.filter((turn) => turn.role === "assistant" && !attributedAssistantTurns.has(turn.id));
  if (unattributed.length > 0) {
    unresolvedItems.push({ list: "unresolved", value: item({
      subject: { kind: "unattributed_assistant_turns", count: unattributed.length, turn_ids: unattributed.slice(-COMMUNICATION_LIMITS.listed_items).map((turn) => turn.id) },
      audience: "unknown",
      state: "unknown",
      evidence: "unknown",
      source: sourceOf("transcript_role_only")
    }) });
  }

  const ordered = [...candidateItems, ...pairItems, ...companionItems, ...unresolvedItems];
  const take = (list) => ordered.filter((entry) => entry.list === list).map((entry) => entry.value);
  const bounded = (values) => ({ listed: values.slice(-COMMUNICATION_LIMITS.listed_items), omitted: Math.max(0, values.length - COMMUNICATION_LIMITS.listed_items) });
  const confirmed = bounded(take("confirmed"));
  const supervisorOnly = bounded(take("supervisor"));
  const unresolved = bounded(take("unresolved"));
  return {
    schema_version: COMMUNICATION_PROJECTION_VERSION,
    confirmed_or_reported_client_outbound: confirmed.listed,
    supervisor_only_artifacts: supervisorOnly.listed,
    unresolved_delivery: unresolved.listed,
    omitted: {
      confirmed_or_reported_client_outbound: confirmed.omitted,
      supervisor_only_artifacts: supervisorOnly.omitted,
      unresolved_delivery: unresolved.omitted
    },
    retracted_event_count: retracted.size
  };
}

const ITEM_KEYS = ["subject", "audience", "state", "delivery_evidence", "source", "candidate_status", "in_reply_to_turn_id", "assistant_turn_id", "event_time", "corroborating_event_ids"];
const SOURCE_KINDS = ["application_transcript", "owner_report", "communication_event", "candidate_status", "legacy_status_only", "transcript_role_only"];

function validateProjectionSubject(subject, name) {
  if (!isObject(subject)) throw new ValidationError(`${name} must be an object.`);
  switch (subject.kind) {
    case "candidate":
      exactKeys(subject, ["kind", "candidate_id", "candidate_version", "text_sha256"], name);
      refId(subject.candidate_id, `${name}.candidate_id`);
      if (!Number.isSafeInteger(subject.candidate_version) || subject.candidate_version < 1) throw new ValidationError(`${name}.candidate_version is invalid.`);
      digest(subject.text_sha256, `${name}.text_sha256`);
      break;
    case "transcript_turn":
      exactKeys(subject, ["kind", "assistant_turn_id", "in_reply_to_turn_id", "text_sha256"], name);
      refId(subject.assistant_turn_id, `${name}.assistant_turn_id`);
      refId(subject.in_reply_to_turn_id, `${name}.in_reply_to_turn_id`);
      digest(subject.text_sha256, `${name}.text_sha256`);
      break;
    case "companion":
      exactKeys(subject, ["kind", "companion_of", "artifact_sha256"], name);
      exactKeys(subject.companion_of, ["candidate_id", "candidate_version"], `${name}.companion_of`);
      refId(subject.companion_of.candidate_id, `${name}.companion_of.candidate_id`);
      if (!Number.isSafeInteger(subject.companion_of.candidate_version) || subject.companion_of.candidate_version < 1) throw new ValidationError(`${name}.companion_of.candidate_version is invalid.`);
      digest(subject.artifact_sha256, `${name}.artifact_sha256`);
      break;
    case "unresolved":
      exactKeys(subject, ["kind", "reason", "candidate_refs"], name);
      if (subject.reason !== "ambiguous" || !Array.isArray(subject.candidate_refs) || subject.candidate_refs.length > COMMUNICATION_LIMITS.ambiguous_candidate_refs) throw new ValidationError(`${name} is invalid.`);
      subject.candidate_refs.forEach((reference) => {
        exactKeys(reference, ["candidate_id", "candidate_version"], `${name}.candidate_refs`);
        refId(reference.candidate_id, `${name}.candidate_refs.candidate_id`);
        if (!Number.isSafeInteger(reference.candidate_version) || reference.candidate_version < 1) throw new ValidationError(`${name}.candidate_refs.candidate_version is invalid.`);
      });
      break;
    case "unattributed_assistant_turns":
      exactKeys(subject, ["kind", "count", "turn_ids"], name);
      if (!Number.isSafeInteger(subject.count) || subject.count < 1 || !Array.isArray(subject.turn_ids) || subject.turn_ids.length > COMMUNICATION_LIMITS.listed_items) throw new ValidationError(`${name} is invalid.`);
      subject.turn_ids.forEach((id) => refId(id, `${name}.turn_ids`));
      break;
    default:
      throw new ValidationError(`${name}.kind is invalid.`);
  }
}

// The shape a consumer can rely on, and the one rule it exists for: only application-committed or owner-reported client
// delivery is ever listed as outbound, and a draft, export, translation, raw status or ambiguous report never is.
function validateProjectionItem(value, list, name, rawTranscript) {
  exactKeys(value, ITEM_KEYS, name);
  validateProjectionSubject(value.subject, `${name}.subject`);
  if (!COMMUNICATION_STATES.includes(value.state) || !COMMUNICATION_AUDIENCES.includes(value.audience) || !DELIVERY_EVIDENCE_LEVELS.includes(value.delivery_evidence)) {
    throw new ValidationError(`${name} state, audience or delivery evidence is invalid.`);
  }
  exactKeys(value.source, ["kind", "route", "audit_id", "event_id", "origin", "actor_resolution", "source_ref"], `${name}.source`);
  if (!SOURCE_KINDS.includes(value.source.kind)) throw new ValidationError(`${name}.source.kind is invalid.`);
  if (value.candidate_status !== null && !PRIVATE_CANDIDATE_STATUSES.includes(value.candidate_status)) throw new ValidationError(`${name}.candidate_status is invalid.`);
  exactKeys(value.event_time, ["at", "status"], `${name}.event_time`);
  if (value.event_time.status === "known") timestamp(value.event_time.at, `${name}.event_time.at`);
  else if (value.event_time.status !== "unavailable" || value.event_time.at !== null) throw new ValidationError(`${name}.event_time must be known or explicitly unavailable.`);
  if (!Array.isArray(value.corroborating_event_ids) || value.corroborating_event_ids.length > COMMUNICATION_LIMITS.events) throw new ValidationError(`${name}.corroborating_event_ids is invalid.`);
  value.corroborating_event_ids.forEach((id) => safeId(id, `${name}.corroborating_event_ids`));
  for (const field of ["in_reply_to_turn_id", "assistant_turn_id"]) if (value[field] !== null) refId(value[field], `${name}.${field}`);

  const pair = `${value.state}:${value.delivery_evidence}`;
  const kind = value.subject.kind;
  if (list === "confirmed_or_reported_client_outbound") {
    const ok = value.audience === "client" && ["candidate", "transcript_turn"].includes(kind)
      && (pair === "app_committed:application_persisted" || pair === "reported_sent:owner_reported_sent")
      // What the application committed for a candidate is a candidate that reads `sent`; a discriminating question has no candidate.
      && (pair !== "app_committed:application_persisted" || value.candidate_status === (kind === "candidate" ? "sent" : null));
    if (!ok) throw new ValidationError(`${name} is not client delivery that the application committed or the owner reported.`);
  } else if (list === "supervisor_only_artifacts") {
    // A candidate that reads `sent` is never listed as an artifact the client has not received.
    const ok = ["draft", "exposed", "exported"].includes(value.state) && value.delivery_evidence === "none"
      && ((kind === "candidate" && value.audience === "client" && value.candidate_status !== null && value.candidate_status !== "sent")
        || (kind === "companion" && value.audience === "supervisor" && value.candidate_status === null && value.state !== "draft"));
    if (!ok) throw new ValidationError(`${name} is not an artifact that only the supervisor has seen.`);
  } else {
    const unknown = value.audience === "unknown" && pair === "unknown:unknown"
      && ((kind === "candidate" && value.candidate_status === "sent") || (kind === "unattributed_assistant_turns" && value.candidate_status === null));
    const ambiguous = value.audience === "client" && pair === "reported_sent:owner_reported_sent" && kind === "unresolved";
    if (!unknown && !ambiguous) throw new ValidationError(`${name} is not an unresolved delivery.`);
  }
  if (rawTranscript && value.assistant_turn_id !== null) {
    const turn = rawTranscript.find((entry) => entry.id === value.assistant_turn_id);
    if (!turn || turn.role !== "assistant" || (value.subject.text_sha256 && sha256Text(turn.text) !== value.subject.text_sha256)) {
      throw new ValidationError(`${name} is not bound to an exact stored assistant turn.`);
    }
  }
}

export function validateCommunicationProjection(value, { rawTranscript = null } = {}) {
  const name = "communication_projection";
  exactKeys(value, ["schema_version", "confirmed_or_reported_client_outbound", "supervisor_only_artifacts", "unresolved_delivery", "omitted", "retracted_event_count"], name);
  if (value.schema_version !== COMMUNICATION_PROJECTION_VERSION) throw new ValidationError(`${name} version is invalid.`);
  exactKeys(value.omitted, ["confirmed_or_reported_client_outbound", "supervisor_only_artifacts", "unresolved_delivery"], `${name}.omitted`);
  for (const list of ["confirmed_or_reported_client_outbound", "supervisor_only_artifacts", "unresolved_delivery"]) {
    if (!Array.isArray(value[list]) || value[list].length > COMMUNICATION_LIMITS.listed_items) throw new ValidationError(`${name}.${list} is invalid.`);
    if (!Number.isSafeInteger(value.omitted[list]) || value.omitted[list] < 0) throw new ValidationError(`${name}.omitted.${list} is invalid.`);
    value[list].forEach((entry, position) => validateProjectionItem(entry, list, `${name}.${list}[${position}]`, rawTranscript));
  }
  if (!Number.isSafeInteger(value.retracted_event_count) || value.retracted_event_count < 0) throw new ValidationError(`${name}.retracted_event_count is invalid.`);
  return value;
}
