import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES } from "./private-candidate-lifecycle.mjs";

export const PRIVATE_RUNTIME_TURN_STATES = Object.freeze([
  "RECEIVED",
  "CANDIDATE_PENDING_AUDIT",
  "AUDITING",
  "APPROVED",
  "DELIVERED",
  "REPAIR_REQUIRED",
  "RECONSTRUCTING",
  "DISCRIMINATING_QUESTION_REQUIRED"
]);

export const PRIVATE_RUNTIME_INVOCATION_EVENT_TYPES = Object.freeze([
  "INVOCATION_STARTED",
  "INVOCATION_COMPLETED",
  "INVOCATION_FAILED",
  "INVOCATION_ABANDONED"
]);

const STATE_SET = new Set(PRIVATE_RUNTIME_TURN_STATES);
const INVOCATION_EVENT_SET = new Set(PRIVATE_RUNTIME_INVOCATION_EVENT_TYPES);
const ID = /^[A-Za-z0-9:_-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TRANSITIONS = Object.freeze({
  RECEIVED: new Set(["CANDIDATE_PENDING_AUDIT"]),
  CANDIDATE_PENDING_AUDIT: new Set(["AUDITING"]),
  AUDITING: new Set(["APPROVED", "REPAIR_REQUIRED", "DISCRIMINATING_QUESTION_REQUIRED"]),
  APPROVED: new Set(["DELIVERED"]),
  DELIVERED: new Set(),
  REPAIR_REQUIRED: new Set(["RECONSTRUCTING"]),
  RECONSTRUCTING: new Set(["CANDIDATE_PENDING_AUDIT"]),
  DISCRIMINATING_QUESTION_REQUIRED: new Set(["DELIVERED"])
});

export const sha256ExactText = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function requiredId(value, name, maximum = 200) {
  if (typeof value !== "string" || value.length > maximum || !ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function requiredTimestamp(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || Number.isNaN(Date.parse(value))) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function boundedJson(value, name, maximum = 4_000_000) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${name} must be an object.`);
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new ValidationError(`${name} must be JSON serializable.`); }
  if (Buffer.byteLength(encoded, "utf8") > maximum) throw new ValidationError(`${name} exceeds the private runtime limit.`);
  return value;
}

function validateQuestion(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 1_000 || /[\r\n]/u.test(value)) {
    throw new ValidationError("Discriminating question must be one bounded exact line.");
  }
  if (!value.endsWith("?") || (value.match(/\?/gu) ?? []).length !== 1) {
    throw new ValidationError("Discriminating question must contain exactly one terminal question mark.");
  }
  return value;
}

function validateEvent(event, index) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new ValidationError(`runtime events[${index}] must be an object.`);
  requiredId(event.id, `runtime events[${index}].id`);
  if (event.sequence !== index + 1) throw new ValidationError("Runtime event sequences must be contiguous.");
  requiredTimestamp(event.at, `runtime events[${index}].at`);
  boundedJson(event.details ?? {}, `runtime events[${index}].details`);
  if (event.event_type === "STATE_TRANSITION") {
    if (event.from_state !== null && !STATE_SET.has(event.from_state)) throw new ValidationError(`runtime events[${index}].from_state is invalid.`);
    if (!STATE_SET.has(event.to_state)) throw new ValidationError(`runtime events[${index}].to_state is invalid.`);
  } else {
    if (!INVOCATION_EVENT_SET.has(event.event_type)) throw new ValidationError(`runtime events[${index}].event_type is invalid.`);
    if (!STATE_SET.has(event.state)) throw new ValidationError(`runtime events[${index}].state is invalid.`);
    if (typeof event.stage !== "string" || !event.stage.trim() || event.stage.length > 80) throw new ValidationError(`runtime events[${index}].stage is invalid.`);
    requiredId(event.context_id, `runtime events[${index}].context_id`, 160);
    if (!Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.attempt > 10) throw new ValidationError(`runtime events[${index}].attempt is invalid.`);
    if (typeof event.input_sha256 !== "string" || !SHA256.test(event.input_sha256)) throw new ValidationError(`runtime events[${index}].input_sha256 is invalid.`);
  }
  return event;
}

export function validatePrivateRuntimeTurn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private runtime turn must be an object.");
  if (value.schema_version !== 1) throw new ValidationError("Private runtime turn version is invalid.");
  for (const field of ["id", "exchange_id", "user_turn_id"]) requiredId(value[field], `runtime turn ${field}`);
  if (value.assistant_turn_id != null) requiredId(value.assistant_turn_id, "runtime turn assistant_turn_id");
  requiredTimestamp(value.created_at, "runtime turn created_at");
  requiredTimestamp(value.updated_at, "runtime turn updated_at");
  if (!STATE_SET.has(value.state)) throw new ValidationError("Private runtime turn state is invalid.");
  if (!value.inbound || typeof value.inbound !== "object" || Array.isArray(value.inbound)
      || typeof value.inbound.exact_text !== "string" || !value.inbound.exact_text
      || value.inbound.sha256 !== sha256ExactText(value.inbound.exact_text)) {
    throw new ValidationError("Private runtime inbound exact-text binding is invalid.");
  }
  requiredTimestamp(value.inbound.received_at, "runtime turn inbound.received_at");
  if (!Number.isSafeInteger(value.repair_cycle) || value.repair_cycle < 0 || value.repair_cycle > MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) {
    throw new ValidationError("Private runtime turn repair_cycle is invalid.");
  }
  if (value.current_candidate_id != null) requiredId(value.current_candidate_id, "runtime turn current_candidate_id", 160);
  if (!Array.isArray(value.events) || value.events.length === 0 || value.events.length > 2_000) throw new ValidationError("Private runtime turn events are invalid.");
  const eventIds = new Set();
  let derivedState = null;
  for (const [index, event] of value.events.entries()) {
    validateEvent(event, index);
    if (eventIds.has(event.id)) throw new ValidationError(`Duplicate private runtime event ${event.id}.`);
    eventIds.add(event.id);
    if (event.event_type !== "STATE_TRANSITION") {
      if (event.state !== derivedState) throw new ValidationError("Runtime invocation event is not bound to the current state.");
      continue;
    }
    if (index === 0) {
      if (event.from_state !== null || event.to_state !== "RECEIVED") throw new ValidationError("Private runtime turn must begin at RECEIVED.");
    } else if (event.from_state !== derivedState || !TRANSITIONS[derivedState]?.has(event.to_state)) {
      throw new ValidationError(`Illegal private runtime transition ${event.from_state} -> ${event.to_state}.`);
    }
    derivedState = event.to_state;
  }
  if (derivedState !== value.state) throw new ValidationError("Private runtime turn state does not match its transition ledger.");
  if (value.state !== "RECEIVED" && value.current_candidate_id == null) throw new ValidationError("Private runtime turn current candidate is required after RECEIVED.");

  if (value.discriminator != null) {
    if (!value.discriminator || typeof value.discriminator !== "object" || Array.isArray(value.discriminator)) throw new ValidationError("Private runtime discriminator is invalid.");
    validateQuestion(value.discriminator.exact_text);
    requiredId(value.discriminator.producer_context_id, "runtime discriminator producer_context_id", 160);
    requiredTimestamp(value.discriminator.created_at, "runtime discriminator created_at");
    if (value.discriminator.sha256 !== sha256ExactText(value.discriminator.exact_text)) throw new ValidationError("Runtime discriminator digest does not match its exact bytes.");
  }

  if (value.delivery == null) {
    if (value.state === "DELIVERED" || value.assistant_turn_id != null) throw new ValidationError("Delivered runtime state requires an exact delivery record.");
  } else {
    const delivery = value.delivery;
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) throw new ValidationError("Private runtime delivery is invalid.");
    if (value.state !== "DELIVERED" || value.assistant_turn_id == null) throw new ValidationError("Private runtime delivery may exist only in DELIVERED state.");
    if (!['candidate', 'discriminator'].includes(delivery.kind)) throw new ValidationError("Private runtime delivery kind is invalid.");
    requiredId(delivery.assistant_turn_id, "runtime delivery assistant_turn_id");
    if (delivery.assistant_turn_id !== value.assistant_turn_id) throw new ValidationError("Runtime delivery assistant turn binding is inconsistent.");
    if (typeof delivery.exact_text !== "string" || !delivery.exact_text) throw new ValidationError("Runtime delivery exact_text is required.");
    if (delivery.sha256 !== sha256ExactText(delivery.exact_text)) throw new ValidationError("Runtime delivery digest does not match exact bytes.");
    requiredTimestamp(delivery.delivered_at, "runtime delivery delivered_at");
    if (delivery.kind === "candidate") {
      requiredId(delivery.candidate_id, "runtime delivery candidate_id", 160);
      requiredId(delivery.audit_id, "runtime delivery audit_id", 160);
      if (!Number.isSafeInteger(delivery.candidate_version) || delivery.candidate_version < 1) throw new ValidationError("Runtime delivery candidate_version is invalid.");
      if (delivery.candidate_id !== value.current_candidate_id) throw new ValidationError("Runtime delivery is not bound to the current candidate.");
    } else if (value.discriminator?.exact_text !== delivery.exact_text) {
      throw new ValidationError("Runtime discriminator delivery bytes are inconsistent.");
    }
  }
  return value;
}

export function createPrivateRuntimeTurn({ id, exchangeId, userTurnId, exactText, createdAt }) {
  if (typeof exactText !== "string" || exactText.length === 0) throw new ValidationError("Private runtime inbound exact text is required.");
  const value = {
    schema_version: 1,
    id,
    exchange_id: exchangeId,
    user_turn_id: userTurnId,
    assistant_turn_id: null,
    inbound: {
      exact_text: exactText,
      sha256: sha256ExactText(exactText),
      received_at: createdAt
    },
    state: "RECEIVED",
    repair_cycle: 0,
    current_candidate_id: null,
    discriminator: null,
    delivery: null,
    created_at: createdAt,
    updated_at: createdAt,
    events: [{
      id: `${id}:received`,
      sequence: 1,
      event_type: "STATE_TRANSITION",
      from_state: null,
      to_state: "RECEIVED",
      at: createdAt,
      details: {}
    }]
  };
  return validatePrivateRuntimeTurn(value);
}

export function appendPrivateRuntimeTransition(runtimeTurn, { eventId, toState, at, candidateId = runtimeTurn.current_candidate_id, repairCycle = runtimeTurn.repair_cycle, details = {}, projectionPatch = {} }) {
  validatePrivateRuntimeTurn(runtimeTurn);
  requiredId(eventId, "runtime transition eventId");
  if (!STATE_SET.has(toState)) throw new ValidationError("runtime transition toState is invalid.");
  if (!TRANSITIONS[runtimeTurn.state].has(toState)) throw new ValidationError(`Illegal private runtime transition ${runtimeTurn.state} -> ${toState}.`);
  const next = structuredClone(runtimeTurn);
  next.events.push({
    id: eventId,
    sequence: next.events.length + 1,
    event_type: "STATE_TRANSITION",
    from_state: runtimeTurn.state,
    to_state: toState,
    at,
    details: structuredClone(details)
  });
  next.state = toState;
  next.current_candidate_id = candidateId;
  next.repair_cycle = repairCycle;
  next.updated_at = at;
  Object.assign(next, structuredClone(projectionPatch));
  return validatePrivateRuntimeTurn(next);
}

export function appendPrivateRuntimeInvocationEvent(runtimeTurn, { eventId, eventType, stage, contextId, attempt, inputSha256, at, details = {} }) {
  validatePrivateRuntimeTurn(runtimeTurn);
  requiredId(eventId, "runtime invocation eventId");
  if (!INVOCATION_EVENT_SET.has(eventType)) throw new ValidationError("runtime invocation eventType is invalid.");
  const next = structuredClone(runtimeTurn);
  next.events.push({
    id: eventId,
    sequence: next.events.length + 1,
    event_type: eventType,
    state: next.state,
    stage,
    context_id: contextId,
    attempt,
    input_sha256: inputSha256,
    at,
    details: structuredClone(details)
  });
  next.updated_at = at;
  return validatePrivateRuntimeTurn(next);
}

export function createPrivateRuntimeDiscriminator({ exactText, producerContextId, createdAt }) {
  validateQuestion(exactText);
  requiredId(producerContextId, "runtime discriminator producerContextId", 160);
  requiredTimestamp(createdAt, "runtime discriminator createdAt");
  return Object.freeze({
    exact_text: exactText,
    sha256: sha256ExactText(exactText),
    producer_context_id: producerContextId,
    created_at: createdAt
  });
}

export function privateRuntimeNextAction(runtimeTurn) {
  validatePrivateRuntimeTurn(runtimeTurn);
  return Object.freeze({
    RECEIVED: "PRODUCE_CANDIDATE",
    CANDIDATE_PENDING_AUDIT: "START_AUDIT",
    AUDITING: "RECONCILE_OR_RUN_AUDIT",
    APPROVED: "DELIVER_APPROVED_CANDIDATE",
    DELIVERED: "RETURN_PERSISTED_DELIVERY",
    REPAIR_REQUIRED: "START_RECONSTRUCTION",
    RECONSTRUCTING: "RECONCILE_OR_RUN_REPAIR",
    DISCRIMINATING_QUESTION_REQUIRED: "PRODUCE_OR_DELIVER_DISCRIMINATOR"
  }[runtimeTurn.state]);
}
