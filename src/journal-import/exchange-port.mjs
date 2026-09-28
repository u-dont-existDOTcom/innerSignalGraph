import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { journalSchema, validateJournalSchema } from "./contracts.mjs";
import {
  JOURNAL_ROLE_DEFINITIONS,
  JournalInferencePortError,
  assertJournalInferenceGrant,
  buildJournalRolePacket,
  journalRoleInstruction
} from "./provider-port.mjs";
import { JOURNAL_WORK_TRANSPORT, journalWorkFileKey } from "./work-exchange.mjs";

// An inference port that hands each role call to ChatGPT through the private connector tools instead
// of driving a browser. invoke() publishes an encrypted work item and a content-free dispatch record;
// Mission Control gives the item to a fresh chat, which fetches the packet and stores its answer
// through the connector; the port reads the answer from the exchange. Completion is therefore known,
// not guessed: an answer is stored or it is not, and a restarted runtime reads it from the exchange.
//
// Re-sending is safe because the route is flat-rate and an item's first stored answer wins. An item
// that expires unanswered is closed (the connector then refuses it) and reported as never submitted,
// so the caller's retry publishes a successor under the same operation key.

export const JOURNAL_EXCHANGE_PROVIDER = "chatgpt_connector_exchange";
const DEFAULT_WAIT_MS = 45 * 60_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const MAX_SUCCESSORS = 8;
// Images reach ChatGPT only as attachments, which the connector cannot deliver yet.
const UNSUPPORTED_ROLES = new Set(["visual_reader"]);
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// Deterministic, content-free work ID for an operation key, and its successors after an item was
// closed unanswered. The same key always leads to the same chain, so no extra state is needed.
export function journalExchangeWorkId(operationKey, successor = 0) {
  invariant(typeof operationKey === "string" && operationKey.length > 0, "OPERATION_KEY_INVALID");
  invariant(Number.isSafeInteger(successor) && successor >= 0 && successor <= MAX_SUCCESSORS, "JOURNAL_EXCHANGE_SUCCESSOR_INVALID");
  const base = `journal-work:${sha256(`inner-signal:journal-exchange-operation:${operationKey}`).slice(0, 48)}`;
  return successor === 0 ? base : `${base}:r${successor}`;
}

export function createExchangeJournalInferencePort({
  exchange,
  caseId,
  receiptKey,
  routeRef,
  allowanceEvidence,
  model,
  effort,
  waitMs = DEFAULT_WAIT_MS,
  pollMs = DEFAULT_POLL_MS,
  ttlMs = DEFAULT_TTL_MS,
  hardestLane = {},
  prepareExchange = null,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  invariant(exchange || typeof prepareExchange === "function", "JOURNAL_EXCHANGE_REQUIRED");
  invariant(typeof caseId === "string" && CASE_ID_PATTERN.test(caseId), "JOURNAL_EXCHANGE_CASE_INVALID");
  invariant(receiptKey instanceof Uint8Array && receiptKey.byteLength >= 32, "INFERENCE_RECEIPT_KEY_INVALID");
  invariant(typeof routeRef === "string" && routeRef.length > 0, "INFERENCE_ROUTE_REF_INVALID");
  invariant(allowanceEvidence && typeof allowanceEvidence === "object" && !Array.isArray(allowanceEvidence)
    && typeof allowanceEvidence.authorization_ref === "string" && allowanceEvidence.authorization_ref.length > 0
    && allowanceEvidence.maximum_incremental_cost_usd === 0, "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND");
  invariant(typeof model === "string" && model.length > 0 && typeof effort === "string" && effort.length > 0, "INFERENCE_MODEL_PROFILE_INVALID");
  for (const value of [waitMs, pollMs, ttlMs]) invariant(Number.isSafeInteger(value) && value >= 0, "JOURNAL_EXCHANGE_TIMING_INVALID");
  invariant(pollMs > 0 && ttlMs > 0, "JOURNAL_EXCHANGE_TIMING_INVALID");
  const key = Buffer.from(receiptKey);
  const hardestModel = hardestLane.model ?? "claude-opus-5-5";
  const hardestEffort = hardestLane.effort ?? "max";
  const hardestTtlMs = (hardestLane.ttl_hours ?? 24) * 60 * 60_000;
  invariant(typeof hardestModel === "string" && hardestModel.length > 0 && typeof hardestEffort === "string" && hardestEffort.length > 0, "INFERENCE_MODEL_PROFILE_INVALID");
  invariant(Number.isFinite(hardestTtlMs) && hardestTtlMs >= 60_000, "JOURNAL_EXCHANGE_TIMING_INVALID");
  let exchangePromise = exchange ? Promise.resolve(exchange) : null;
  const ready = () => {
    exchangePromise ??= Promise.resolve().then(() => prepareExchange());
    return exchangePromise;
  };

  const capabilities = () => Object.freeze({
    mode: "authorized_provider",
    enabled: true,
    live_inference: true,
    route_ref: routeRef,
    transport: JOURNAL_WORK_TRANSPORT,
    packet_only: true,
    fresh_context_per_generate: true,
    // The exchange knows whether an item was answered, is still open, or was closed unanswered.
    authoritative_completion: true,
    external_spend_authorized_usd: 0,
    allowance_ref: allowanceEvidence.authorization_ref,
    configured_model_profile: model,
    configured_effort: effort,
    roles: Object.fromEntries(Object.entries(JOURNAL_ROLE_DEFINITIONS).map(([role, definition]) => [role, {
      output_schema_id: definition.outputSchema,
      instruction_installed: true,
      available: !UNSUPPORTED_ROLES.has(role)
    }]))
  });

  const inputDigest = (role, packet, outputSchema, grant) => sha256(Buffer.from(JSON.stringify({
    role,
    packet,
    outputSchema,
    principal_id: grant.principal_id,
    grant_id: grant.grant_id,
    route_ref: routeRef
  }), "utf8"));

  // The newest item in an operation key's chain: the first one that was not closed unanswered.
  async function current(operationKey) {
    const store = await ready();
    for (let successor = 0; successor <= MAX_SUCCESSORS; successor += 1) {
      const workId = journalExchangeWorkId(operationKey, successor);
      const stored = await store.readResult(workId);
      if (stored?.retired && stored.unanswered) continue;
      return { store, workId, successor, entry: await store.readWork(workId), stored };
    }
    throw new JournalInferencePortError("JOURNAL_EXCHANGE_RETRY_LIMIT", { submissionStatus: "not_submitted" });
  }

  function receiptFor(operationKey, entry, stored) {
    const receiptBody = {
      receipt_id: `receipt:${createHmac("sha256", key).update(`${operationKey}\0${entry.input_sha256}`).digest("hex").slice(0, 40)}`,
      transport: JOURNAL_WORK_TRANSPORT,
      request_id: stored.receipt.receipt_id,
      // Each item is handed to its own fresh chat; the connector receipt names that submission.
      request_context_id: `chatgpt-connector:${stored.receipt.receipt_id}`,
      input_manifest_sha256: entry.input_sha256,
      role_instruction_sha256: sha256(Buffer.from(entry.instruction, "utf8")),
      configured_model_profile: model,
      configured_effort: effort,
      effective_model_profile: null,
      effective_effort: null,
      completion_status: "completed",
      target_generation: entry.expected_generation,
      token_evidence: null,
      allowance_evidence: structuredClone(allowanceEvidence),
      provider_route_receipt: {
        work_id: entry.work_id,
        work_file_key: stored.receipt.work_file_key,
        connector_receipt_id: stored.receipt.receipt_id,
        received_at: stored.receipt.received_at,
        output_sha256: stored.receipt.output_sha256,
        subject_sha256: stored.receipt.subject_sha256,
        subject: stored.receipt.subject,
        tier: entry.tier ?? "standard"
      },
      cost_usd: 0,
      grant_id: entry.grant_id,
      grant_purpose: entry.grant_purpose,
      replay: false
    };
    return { ...receiptBody, authentication_tag: createHmac("sha256", key).update(JSON.stringify(receiptBody)).digest("base64url") };
  }

  // Only the runtime removes dispatch records (when it retires or closes an item), so one successful
  // publication per item and process is enough; the exchange keeps the first record anyway.
  const dispatched = new Set();
  async function ensureDispatch(store, entry) {
    if (dispatched.has(entry.work_id)) return;
    await store.publishDispatch({
      schema_version: 1,
      work_id: entry.work_id,
      role: entry.role,
      output_schema_name: entry.output_schema_name,
      tier: entry.tier ?? "standard",
      model: entry.tier === "hardest" ? hardestModel : model,
      effort: entry.tier === "hardest" ? hardestEffort : effort,
      route_ref: routeRef,
      issued_at: entry.issued_at,
      expires_at: entry.expires_at
    });
    dispatched.add(entry.work_id);
  }

  // What the exchange says about the newest item for this key, without waiting.
  async function observe(operationKey) {
    const { store, workId, entry, stored } = await current(operationKey);
    if (stored?.output) {
      invariant(entry, "JOURNAL_EXCHANGE_ENTRY_MISSING");
      let output;
      try {
        output = validateJournalSchema(entry.output_schema_name, stored.output);
      } catch (cause) {
        return { status: "invalid_output", cause };
      }
      return { status: "completed", output, receipt: receiptFor(operationKey, entry, stored) };
    }
    // Retired after its answer was stored durably; the caller holds the answer, not the exchange.
    if (stored?.retired) return { status: "unknown" };
    if (!entry) return { status: "not_submitted" };
    if (Date.parse(entry.expires_at) <= now().getTime()) {
      const { closed } = await store.closeUnanswered(workId);
      // An answer won the race; read it on the next observation.
      return closed ? { status: "not_submitted", code: "JOURNAL_WORK_EXPIRED" } : observe(operationKey);
    }
    await ensureDispatch(store, entry);
    return { status: "pending", workId };
  }

  const invoke = async ({ role, packet, outputSchema, operationKey, grant, tier = "standard" }) => {
    const definition = JOURNAL_ROLE_DEFINITIONS[role];
    invariant(definition && definition.outputSchema === outputSchema, "JOURNAL_ROLE_OUTPUT_SCHEMA_MISMATCH");
    if (UNSUPPORTED_ROLES.has(role)) {
      throw new JournalInferencePortError("JOURNAL_EXCHANGE_ROLE_UNSUPPORTED", { submissionStatus: "not_submitted" });
    }
    const checkedPacket = buildJournalRolePacket(role, packet);
    assertJournalInferenceGrant(grant, role, checkedPacket);
    invariant(typeof operationKey === "string" && operationKey.length > 0, "OPERATION_KEY_INVALID");
    invariant(tier === "standard" || tier === "hardest", "WORK_TIER_INVALID");
    const digest = inputDigest(role, checkedPacket, outputSchema, grant);

    const { store, workId, entry: existing, stored } = await current(operationKey);
    if (existing) invariant(existing.input_sha256 === digest, "OPERATION_KEY_CONFLICT");
    if (!existing && !stored) {
      const issuedAt = now();
      const entry = {
        schema_version: 1,
        work_id: workId,
        case_id: caseId,
        role,
        tier,
        instruction: journalRoleInstruction(role),
        packet: checkedPacket,
        output_schema_name: outputSchema,
        output_schema: journalSchema(outputSchema),
        expected_generation: checkedPacket.expected_generation ?? null,
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(issuedAt.getTime() + (tier === "hardest" ? hardestTtlMs : ttlMs)).toISOString(),
        input_sha256: digest,
        grant_id: grant.grant_id,
        grant_purpose: grant.purpose,
        route_ref: routeRef
      };
      try {
        const { created } = await store.publishWork(entry);
        // Another process published this item first; it must be the same input.
        if (!created) {
          const winner = await store.readWork(workId);
          if (winner) invariant(winner.input_sha256 === digest, "OPERATION_KEY_CONFLICT");
        }
      } catch (cause) {
        if (cause instanceof ValidationError) throw cause;
        throw new JournalInferencePortError("JOURNAL_EXCHANGE_UNAVAILABLE", { submissionStatus: "not_submitted", cause });
      }
    }

    const deadline = Date.now() + waitMs;
    for (;;) {
      const observed = await observe(operationKey);
      if (observed.status === "completed") return { output: observed.output, receipt: observed.receipt };
      if (observed.status === "invalid_output") {
        throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid", cause: observed.cause });
      }
      if (observed.status === "not_submitted") {
        throw new JournalInferencePortError(observed.code ?? "INFERENCE_NOT_SUBMITTED", { submissionStatus: "not_submitted" });
      }
      // Still open. Ending the wait says nothing about the item: it stays published, and a later
      // run reads its answer through getCompletion.
      if (observed.status !== "pending" || Date.now() >= deadline) {
        throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
      }
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  };

  return Object.freeze({
    capabilities,
    invoke,
    // "completed" with the output and receipt; "not_submitted" when no item exists or the newest one
    // expired unanswered (the caller may send it again); "invalid_output" when the stored answer
    // fails the importer's own schema; "unknown" while an item is still open.
    async getCompletion(operationKey) {
      const observed = await observe(operationKey);
      if (observed.status === "completed") return { status: "completed", output: observed.output, receipt: observed.receipt };
      if (observed.status === "not_submitted") return { status: "not_submitted", code: observed.code ?? "INFERENCE_NOT_SUBMITTED" };
      if (observed.status === "invalid_output") return { status: "invalid_output" };
      return { status: "unknown" };
    },
    // Called once the caller has stored the answer durably: the item is retired and its dispatch
    // record removed, so the connector stops serving it and Mission Control stops offering it.
    async release(operationKey) {
      const { store, workId, stored } = await current(operationKey);
      if (stored?.output) await store.retireWork(workId);
    },
    // Called at runtime start: resolves and checks the exchange root, and removes temporary files a
    // stopped process left behind.
    async prepare() {
      const store = await ready();
      await store.removeStaleTemporaries();
    },
    // Content-free list of open items for status reports.
    async openItems() {
      const store = await ready();
      return (await store.listDispatch()).map(({ work_id: workId, role, tier = "standard", issued_at: issuedAt, expires_at: expiresAt, answered }) => ({
        work_id: workId, work_file_key: journalWorkFileKey(workId), role, tier, issued_at: issuedAt, expires_at: expiresAt, answered
      }));
    },
    close() { key.fill(0); }
  });
}
