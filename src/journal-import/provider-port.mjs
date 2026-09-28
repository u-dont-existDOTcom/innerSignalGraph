import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProviderError, ValidationError } from "../core/errors.mjs";
import { journalSchema, validateJournalSchema } from "./contracts.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requiredCommon = Object.freeze([
  "protocol_version",
  "output_schema_id",
  "assigned_core_ids",
  "source_locators",
  "expected_generation",
  "controller_provenance_tag",
  "grant_purpose"
]);

export const JOURNAL_ROLE_DEFINITIONS = Object.freeze({
  visual_reader: Object.freeze({ outputSchema: "visual-result", fields: ["page_image_ref", "page_geometry", "native_text_rendering", "neighbor_pages"] }),
  extractor: Object.freeze({ outputSchema: "extraction-result", fields: ["core_units", "adjacent_context", "visual_transcriptions", "repair_request"] }),
  omission_checker: Object.freeze({ outputSchema: "review-result", fields: ["core_units", "adjacent_context", "candidate_extraction", "target_generation"] }),
  reference_reader: Object.freeze({ outputSchema: "reference-result", fields: ["source_windows", "adjacent_context", "visual_context", "neutral_reading_instructions"] }),
  fidelity_auditor: Object.freeze({ outputSchema: "review-result", fields: ["frozen_reference", "supporting_passages", "imported_generation"] }),
  reconciler: Object.freeze({ outputSchema: "reconciliation-result", fields: ["candidates", "neighborhood_evidence", "target_generation"] }),
  pattern_builder: Object.freeze({ outputSchema: "pattern-result", fields: ["validated_graph", "episode_theme_matrix", "source_retrieval", "coverage_ledger", "target_generation", "producer_ref"] }),
  pattern_reviewer: Object.freeze({ outputSchema: "review-result", fields: ["phase", "candidate_patterns", "frozen_observations", "source_retrieval", "target_generation"] }),
  cold_consumer: Object.freeze({ outputSchema: "answer-result", fields: ["frozen_question", "current_locator", "retrieved_evidence"] })
});

const installedInstructions = Object.freeze(Object.fromEntries([
  "visual_reader",
  "extractor",
  "omission_checker",
  "reconciler",
  "reference_reader",
  "fidelity_auditor",
  "pattern_builder",
  "pattern_reviewer",
  "cold_consumer"
].map((role) => [
  role,
  readFileSync(new URL(`./provider-port-roles/${role}.md`, import.meta.url), "utf8")
])));

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

export function journalRoleInstruction(role) {
  invariant(Object.hasOwn(JOURNAL_ROLE_DEFINITIONS, role), "JOURNAL_ROLE_UNKNOWN");
  invariant(Object.hasOwn(installedInstructions, role), "ROLE_INSTRUCTION_NOT_INSTALLED");
  return installedInstructions[role];
}

export function buildJournalRolePacket(role, input) {
  const definition = JOURNAL_ROLE_DEFINITIONS[role];
  invariant(definition && input && typeof input === "object" && !Array.isArray(input), "JOURNAL_ROLE_PACKET_INVALID");
  const allowed = new Set([...requiredCommon, ...definition.fields]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  invariant(unknown.length === 0, "JOURNAL_ROLE_PACKET_FIELD_NOT_ALLOWED");
  for (const field of requiredCommon) invariant(Object.hasOwn(input, field), "JOURNAL_ROLE_PACKET_REQUIRED_FIELD_MISSING");
  invariant(input.protocol_version === "1.0" && input.output_schema_id === definition.outputSchema, "JOURNAL_ROLE_PACKET_CONTRACT_MISMATCH");
  invariant(Array.isArray(input.assigned_core_ids) && Array.isArray(input.source_locators), "JOURNAL_ROLE_PACKET_ASSIGNMENT_INVALID");
  if (role === "pattern_reviewer") invariant(input.phase === "B", "PATTERN_SOURCE_FIRST_PHASE_MUST_USE_REFERENCE_READER");
  const packet = {};
  for (const field of [...requiredCommon, ...definition.fields]) if (Object.hasOwn(input, field)) packet[field] = structuredClone(input[field]);
  return Object.freeze(packet);
}

export function assertJournalInferenceGrant(grant, role, packet) {
  invariant(grant && typeof grant === "object" && grant.revoked !== true, "GRANT_REVOKED");
  invariant(typeof grant.grant_id === "string" && typeof grant.principal_id === "string", "GRANT_INVALID");
  invariant(grant.purpose === packet.grant_purpose, "GRANT_PURPOSE_MISMATCH");
  invariant(Array.isArray(grant.allowed_roles) && grant.allowed_roles.includes(role), "GRANT_ROLE_DENIED");
  if (grant.expires_at !== null && grant.expires_at !== undefined) invariant(Date.now() <= Date.parse(grant.expires_at), "GRANT_EXPIRED");
}

export class JournalInferencePortError extends ProviderError {
  constructor(code, { submissionStatus = "not_submitted", cause } = {}) {
    super(code, { code, cause, details: { submission_status: submissionStatus } });
    this.submissionStatus = submissionStatus;
  }
}

export function createMockJournalInferencePort({
  handlers = {},
  receiptKey = Buffer.alloc(32, 31),
  contextFactory = () => `mock-context:${randomUUID()}`,
  modelProfile = "mock-deterministic",
  effort = "deterministic"
} = {}) {
  invariant(receiptKey instanceof Uint8Array && receiptKey.byteLength >= 32, "MOCK_RECEIPT_KEY_INVALID");
  const key = Buffer.from(receiptKey);
  const operations = new Map();
  const invocationCounts = new Map();
  const capabilities = () => Object.freeze({
    mode: "mock",
    enabled: true,
    live_inference: false,
    authenticated_execution_profile_per_generate: true,
    external_spend_authorized_usd: 0,
    transport_receipts: "mock_hmac",
    roles: Object.fromEntries(Object.entries(JOURNAL_ROLE_DEFINITIONS).map(([role, definition]) => [role, {
      output_schema_id: definition.outputSchema,
      instruction_installed: Object.hasOwn(installedInstructions, role),
      available: Object.hasOwn(installedInstructions, role) && typeof handlers[role] === "function"
    }]))
  });
  const invoke = async ({ role, packet, outputSchema, operationKey, grant }) => {
    const definition = JOURNAL_ROLE_DEFINITIONS[role];
    invariant(definition && definition.outputSchema === outputSchema, "JOURNAL_ROLE_OUTPUT_SCHEMA_MISMATCH");
    const checkedPacket = buildJournalRolePacket(role, packet);
    assertJournalInferenceGrant(grant, role, checkedPacket);
    const instruction = journalRoleInstruction(role);
    invariant(typeof operationKey === "string" && operationKey.length > 0, "OPERATION_KEY_INVALID");
    const inputDigest = sha256(Buffer.from(JSON.stringify({ role, packet: checkedPacket, outputSchema, principal_id: grant.principal_id, grant_id: grant.grant_id }), "utf8"));
    if (operations.has(operationKey)) {
      const prior = operations.get(operationKey);
      invariant(prior.input_digest === inputDigest, "OPERATION_KEY_CONFLICT");
      if (prior.status === "completed") return { output: structuredClone(prior.output), receipt: { ...structuredClone(prior.receipt), replay: true } };
      if (prior.status === "not_submitted") operations.delete(operationKey);
      else throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
    }
    invariant(typeof handlers[role] === "function", "MOCK_ROLE_HANDLER_UNAVAILABLE");
    operations.set(operationKey, { status: "submitted", input_digest: inputDigest });
    invocationCounts.set(operationKey, (invocationCounts.get(operationKey) ?? 0) + 1);
    const requestContextId = contextFactory(role, operationKey);
    try {
      const rawOutput = await handlers[role](structuredClone(checkedPacket), { operationKey, requestContextId });
      let output;
      try { output = validateJournalSchema(outputSchema, rawOutput); }
      catch (cause) { throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid", cause }); }
      const receiptBody = {
        receipt_id: `receipt:${createHmac("sha256", key).update(`${operationKey}\0${inputDigest}`).digest("hex").slice(0, 40)}`,
        transport: "mock",
        request_id: `request:${sha256(Buffer.from(operationKey, "utf8")).slice(0, 32)}`,
        request_context_id: requestContextId,
        input_manifest_sha256: inputDigest,
        role_instruction_sha256: sha256(Buffer.from(instruction, "utf8")),
        configured_model_profile: modelProfile,
        configured_effort: effort,
        effective_model_profile: modelProfile,
        effective_effort: effort,
        completion_status: "completed",
        target_generation: checkedPacket.expected_generation,
        token_evidence: null,
        allowance_evidence: null,
        cost_usd: 0,
        grant_id: grant.grant_id,
        grant_purpose: grant.purpose,
        replay: false
      };
      const receipt = { ...receiptBody, authentication_tag: createHmac("sha256", key).update(JSON.stringify(receiptBody)).digest("base64url") };
      operations.set(operationKey, { status: "completed", input_digest: inputDigest, output: structuredClone(output), receipt: structuredClone(receipt) });
      return { output, receipt };
    } catch (error) {
      if (error instanceof JournalInferencePortError) {
        const status = error.submissionStatus === "not_submitted"
          ? "not_submitted"
          : (error.submissionStatus === "completed_invalid" ? "invalid_output" : "completion_unknown");
        operations.set(operationKey, { status, input_digest: inputDigest });
        throw error;
      }
      operations.delete(operationKey);
      throw error;
    }
  };
  return Object.freeze({
    capabilities,
    invoke,
    async getCompletion(operationKey) {
      const operation = operations.get(operationKey);
      if (!operation) return { status: "not_submitted" };
      if (operation.status === "completed") return { status: "completed", output: structuredClone(operation.output), receipt: structuredClone(operation.receipt) };
      if (operation.status === "not_submitted") return { status: "not_submitted" };
      return { status: "unknown" };
    },
    invocationCount(operationKey) { return invocationCounts.get(operationKey) ?? 0; },
    close() { key.fill(0); operations.clear(); }
  });
}


const allowedImageMediaTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function providerPayload(role, packet) {
  if (role !== "visual_reader") return { userPacket: packet, attachments: [] };
  const image = packet.page_image_ref;
  invariant(image && typeof image === "object" && !Array.isArray(image), "VISUAL_IMAGE_PAYLOAD_INVALID");
  invariant(image.kind === "inline_image", "VISUAL_IMAGE_PAYLOAD_INVALID");
  invariant(typeof image.media_type === "string" && allowedImageMediaTypes.has(image.media_type), "VISUAL_IMAGE_MEDIA_TYPE_UNSUPPORTED");
  invariant(typeof image.data_base64 === "string" && image.data_base64.length > 0, "VISUAL_IMAGE_PAYLOAD_INVALID");
  let bytes;
  try { bytes = Buffer.from(image.data_base64, "base64"); }
  catch { throw new ValidationError("VISUAL_IMAGE_PAYLOAD_INVALID", { code: "VISUAL_IMAGE_PAYLOAD_INVALID" }); }
  invariant(bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024, "VISUAL_IMAGE_SIZE_INVALID");
  const digest = sha256(bytes);
  if (image.sha256 !== undefined && image.sha256 !== null) invariant(image.sha256 === digest, "VISUAL_IMAGE_DIGEST_MISMATCH");
  const userPacket = structuredClone(packet);
  userPacket.page_image_ref = {
    kind: "attached_image",
    media_type: image.media_type,
    sha256: digest,
    byte_length: bytes.byteLength,
    label: typeof image.label === "string" ? image.label : null
  };
  return {
    userPacket: Object.freeze(userPacket),
    attachments: [Object.freeze({
      kind: "image",
      media_type: image.media_type,
      bytes,
      sha256: digest,
      label: typeof image.label === "string" ? image.label : null
    })]
  };
}

function assertPrivateInferenceIsolation(provider) {
  const isolation = provider?.privateInferenceIsolation;
  invariant(isolation?.packetOnly === true, "INFERENCE_PACKET_ISOLATION_REQUIRED");
  invariant(isolation?.freshContextPerGenerate === true, "INFERENCE_FRESH_CONTEXT_REQUIRED");
  invariant(isolation?.tools === false || isolation?.tools === "not_selected_prompt_prohibited_postflight_checked", "INFERENCE_TOOLS_MUST_BE_DISABLED");
  invariant(isolation?.filesystem === false, "INFERENCE_FILESYSTEM_MUST_BE_DISABLED");
  invariant(isolation?.sessionPersistence === false, "INFERENCE_SESSION_PERSISTENCE_MUST_BE_DISABLED");
  invariant(typeof isolation.transport === "string" && isolation.transport.length > 0, "INFERENCE_TRANSPORT_INVALID");
  return isolation;
}

function assertAllowance(maxExternalSpendUsd, allowanceEvidence) {
  invariant(Number.isFinite(maxExternalSpendUsd) && maxExternalSpendUsd >= 0, "INFERENCE_SPEND_LIMIT_INVALID");
  invariant(allowanceEvidence && typeof allowanceEvidence === "object" && !Array.isArray(allowanceEvidence), "INFERENCE_ALLOWANCE_UNVERIFIED");
  invariant(typeof allowanceEvidence.authorization_ref === "string" && allowanceEvidence.authorization_ref.length > 0, "INFERENCE_ALLOWANCE_UNVERIFIED");
  invariant(Number.isFinite(allowanceEvidence.maximum_incremental_cost_usd)
    && allowanceEvidence.maximum_incremental_cost_usd >= 0
    && allowanceEvidence.maximum_incremental_cost_usd <= maxExternalSpendUsd, "INFERENCE_ALLOWANCE_EXCEEDS_LIMIT");
}

export function createProviderJournalInferencePort({
  provider,
  receiptKey,
  routeRef,
  allowanceEvidence,
  maxExternalSpendUsd = 0,
  configuredModelProfile = null,
  configuredEffort = null
} = {}) {
  invariant(provider && typeof provider.generate === "function", "INFERENCE_PROVIDER_INVALID");
  const isolation = assertPrivateInferenceIsolation(provider);
  invariant(receiptKey instanceof Uint8Array && receiptKey.byteLength >= 32, "INFERENCE_RECEIPT_KEY_INVALID");
  invariant(typeof routeRef === "string" && routeRef.length > 0, "INFERENCE_ROUTE_REF_INVALID");
  assertAllowance(maxExternalSpendUsd, allowanceEvidence);
  const key = Buffer.from(receiptKey);
  const operations = new Map();
  const modelProfile = configuredModelProfile ?? provider.model;
  invariant(typeof modelProfile === "string" && modelProfile.length > 0, "INFERENCE_MODEL_PROFILE_INVALID");

  const capabilities = () => Object.freeze({
    mode: "authorized_provider",
    enabled: true,
    live_inference: true,
    route_ref: routeRef,
    transport: isolation.transport,
    packet_only: true,
    fresh_context_per_generate: true,
    authenticated_execution_profile_per_generate: true,
    external_spend_authorized_usd: maxExternalSpendUsd,
    allowance_ref: allowanceEvidence.authorization_ref,
    configured_model_profile: modelProfile,
    configured_effort: configuredEffort,
    roles: Object.fromEntries(Object.entries(JOURNAL_ROLE_DEFINITIONS).map(([role, definition]) => [role, {
      output_schema_id: definition.outputSchema,
      instruction_installed: Object.hasOwn(installedInstructions, role),
      available: Object.hasOwn(installedInstructions, role)
    }]))
  });

  const invoke = async ({ role, packet, outputSchema, operationKey, grant }) => {
    const definition = JOURNAL_ROLE_DEFINITIONS[role];
    invariant(definition && definition.outputSchema === outputSchema, "JOURNAL_ROLE_OUTPUT_SCHEMA_MISMATCH");
    const checkedPacket = buildJournalRolePacket(role, packet);
    assertJournalInferenceGrant(grant, role, checkedPacket);
    invariant(typeof operationKey === "string" && operationKey.length > 0, "OPERATION_KEY_INVALID");
    const instruction = journalRoleInstruction(role);
    const inputDigest = sha256(Buffer.from(JSON.stringify({
      role,
      packet: checkedPacket,
      outputSchema,
      principal_id: grant.principal_id,
      grant_id: grant.grant_id,
      route_ref: routeRef
    }), "utf8"));
    const prior = operations.get(operationKey);
    if (prior) {
      invariant(prior.input_digest === inputDigest, "OPERATION_KEY_CONFLICT");
      if (prior.status === "completed") return { output: structuredClone(prior.output), receipt: { ...structuredClone(prior.receipt), replay: true } };
      if (prior.status !== "not_submitted") throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
    }
    operations.set(operationKey, { status: "submitted", input_digest: inputDigest });
    const payload = providerPayload(role, checkedPacket);
    let response;
    try {
      response = await provider.generate({
        system: instruction,
        user: JSON.stringify(payload.userPacket),
        attachments: payload.attachments,
        outputSchema: journalSchema(outputSchema),
        metadata: { stage: `journal:${role}`, operationKey, routeRef },
        sealed: true
      });
    } catch (cause) {
      const notSubmitted = cause?.submissionStatus === "not_submitted";
      operations.set(operationKey, { status: notSubmitted ? "not_submitted" : "completion_unknown", input_digest: inputDigest });
      throw new JournalInferencePortError(notSubmitted ? (cause.code ?? "INFERENCE_NOT_SUBMITTED") : "COMPLETION_UNKNOWN", {
        submissionStatus: notSubmitted ? "not_submitted" : "unknown", cause
      });
    }
    let rawOutput;
    try {
      rawOutput = typeof response?.text === "string" ? JSON.parse(response.text) : response?.output;
      rawOutput = validateJournalSchema(outputSchema, rawOutput);
    } catch (cause) {
      operations.set(operationKey, { status: "invalid_output", input_digest: inputDigest });
      throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid", cause });
    }
    const requestContextId = response?.responseId ?? response?.requestId;
    if (typeof requestContextId !== "string" || requestContextId.length === 0) {
      operations.set(operationKey, { status: "completion_unknown", input_digest: inputDigest });
      throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
    }
    const costUsd = response?.costUsd ?? allowanceEvidence.maximum_incremental_cost_usd;
    if (!Number.isFinite(costUsd) || costUsd < 0 || costUsd > maxExternalSpendUsd) {
      operations.set(operationKey, { status: "completed_over_allowance", input_digest: inputDigest });
      throw new JournalInferencePortError("QUOTA_PAUSED", { submissionStatus: "completed_invalid" });
    }
    const receiptBody = {
      receipt_id: `receipt:${createHmac("sha256", key).update(`${operationKey}\0${inputDigest}`).digest("hex").slice(0, 40)}`,
      transport: isolation.transport,
      request_id: response.requestId ?? requestContextId,
      request_context_id: requestContextId,
      input_manifest_sha256: inputDigest,
      role_instruction_sha256: sha256(Buffer.from(instruction, "utf8")),
      configured_model_profile: modelProfile,
      configured_effort: configuredEffort,
      effective_model_profile: response.model ?? null,
      effective_effort: response.effort ?? null,
      completion_status: "completed",
      target_generation: checkedPacket.expected_generation,
      token_evidence: response.usage ?? null,
      allowance_evidence: structuredClone(allowanceEvidence),
      provider_route_receipt: response?.subscriptionRouteReceipt ? structuredClone(response.subscriptionRouteReceipt) : null,
      cost_usd: costUsd,
      grant_id: grant.grant_id,
      grant_purpose: grant.purpose,
      replay: false
    };
    const receipt = { ...receiptBody, authentication_tag: createHmac("sha256", key).update(JSON.stringify(receiptBody)).digest("base64url") };
    const completed = { status: "completed", input_digest: inputDigest, output: rawOutput, receipt };
    operations.set(operationKey, completed);
    return { output: structuredClone(rawOutput), receipt: structuredClone(receipt) };
  };

  return Object.freeze({
    capabilities,
    invoke,
    async getCompletion(operationKey) {
      const operation = operations.get(operationKey);
      if (!operation) return { status: "not_submitted" };
      if (operation.status === "completed") return { status: "completed", output: structuredClone(operation.output), receipt: structuredClone(operation.receipt) };
      if (operation.status === "not_submitted") return { status: "not_submitted" };
      return { status: "unknown" };
    },
    close() { key.fill(0); operations.clear(); }
  });
}

export function createDisabledJournalInferencePort() {
  const unavailable = async () => { throw new JournalInferencePortError("INFERENCE_ISOLATION_UNAVAILABLE", { submissionStatus: "not_submitted" }); };
  return Object.freeze({
    capabilities() {
      return { mode: "disabled", enabled: false, live_inference: false, external_spend_authorized_usd: 0, reason: "no authorized route bound" };
    },
    invoke: unavailable,
    async getCompletion() { return { status: "not_submitted" }; }
  });
}

export function resolveJournalInferencePort({ authorizedPort = null } = {}) {
  if (!authorizedPort) return createDisabledJournalInferencePort();
  invariant(typeof authorizedPort.invoke === "function" && typeof authorizedPort.getCompletion === "function" && typeof authorizedPort.capabilities === "function", "INFERENCE_PORT_INVALID");
  return authorizedPort;
}
