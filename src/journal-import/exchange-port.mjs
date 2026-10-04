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
import { hardestJournalPacketFits } from "./packet-bounds.mjs";
import { readJournalAttemptMarker, journalAttemptConsumed, HARDEST_ATTEMPT_EXHAUSTED } from "./attempt-markers.mjs";

// An inference port that publishes role calls through the private exchange. The ChatGPT connector
// and the Codex exec worker use distinct admission evidence over the same encrypted work format.
// invoke() publishes an encrypted work item and a content-free dispatch record; the port reads its
// answer from the exchange. Completion is therefore known,
// not guessed: an answer is stored or it is not, and a restarted runtime reads it from the exchange.
//
// Re-sending is safe because the route is flat-rate and an item's first stored answer wins. An item
// that expires unanswered is closed (the connector then refuses it) and reported as never submitted,
// so the caller's retry publishes a successor under the same operation key.

export const JOURNAL_EXCHANGE_PROVIDER = "chatgpt_connector_exchange";
export const JOURNAL_CODEX_EXCHANGE_PROVIDER = "codex_exec_exchange";
const DEFAULT_WAIT_MS = 45 * 60_000;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const MAX_SUCCESSORS = 8;
// Images reach ChatGPT only as attachments, which the connector cannot deliver yet.
const UNSUPPORTED_ROLES = new Set(["visual_reader"]);
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const REQUEST_CONTEXT_ID_PATTERN = /^[\x21-\x7e]{1,256}$/u;
const CODEX_CONTEXT_ID_PATTERN = /^codex-thread:[0-9A-Za-z-]{8,64}$/u;
const CLAUDE_CONTEXT_ID_PATTERN = /^claude-session:[0-9A-Za-z-]{8,64}$/u;

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

export function journalExchangeAttemptIdentity(operationKey) {
  const baseKey = operationKey.replace(/(?::resend:[1-9][0-9]*|:unsent-retry:[0-9]+:[0-9]+|:reserialize(?::[0-9]+)?)+$/u, "");
  return sha256(`inner-signal:journal-exchange-operation:${baseKey}`).slice(0, 48);
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
  executionAttestation = null,
  roleEffort = {},
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
    transport: executionAttestation === "codex_exec" ? JOURNAL_CODEX_EXCHANGE_PROVIDER : JOURNAL_WORK_TRANSPORT,
    packet_only: true,
    // The connector receipt does not attest that the dispatcher opened a fresh chat. The Codex
    // route uses an ephemeral Codex thread for standard work and a new Claude session for hardest work.
    fresh_context_per_generate: executionAttestation === "codex_exec",
    // Desired dispatch labels alone are not execution evidence. The connector remains blocked;
    // the Codex route admits the worker's tier-specific receipt only after profile checks.
    authenticated_execution_profile_per_generate: executionAttestation === "codex_exec",
    ...(executionAttestation === "codex_exec" ? { execution_profile_evidence: "codex_exec_request_pinned" } : {}),
    hardest_roles: Object.fromEntries(Object.entries(JOURNAL_ROLE_DEFINITIONS).map(([role, definition]) => [role, {
      output_schema_id: definition.outputSchema, instruction_installed: true, available: !UNSUPPORTED_ROLES.has(role)
    }])),
    hardest_fresh_context_per_generate: executionAttestation === "codex_exec",
    hardest_authenticated_execution_profile_per_generate: executionAttestation === "codex_exec",
    ...(executionAttestation === "codex_exec" ? { hardest_execution_profile_evidence: "claude_code_model_usage_reported" } : {}),
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
      // Skip an item closed unanswered (unless its hardest attempt is exhausted, which ends the chain) or a
      // speculative answer superseded on the same key.
      if (stored?.retired && ((stored.unanswered && !stored.exhausted) || stored.superseded)) continue;
      return { store, workId, successor, entry: await store.readWork(workId), stored };
    }
    throw new JournalInferencePortError("JOURNAL_EXCHANGE_RETRY_LIMIT", { submissionStatus: "not_submitted" });
  }

  async function hasOperation(operationKey) {
    const store = await ready();
    for (let successor = 0; successor <= MAX_SUCCESSORS; successor += 1) {
      const workId = journalExchangeWorkId(operationKey, successor);
      if ((await store.readWork(workId)) || (await store.readResult(workId))) return true;
    }
    return false;
  }

  function receiptFor(operationKey, entry, stored, dispatch) {
    // The exchange receipt authenticates only what the connector observed. Desired dispatch labels
    // are not evidence of the profile that actually ran, so an answer is inadmissible until a
    // dispatcher/provider receipt carries the effective model and effort and they match the route.
    invariant((dispatch.tier ?? "standard") === (entry.tier ?? "standard")
      && (executionAttestation !== "codex_exec" || (dispatch.tier === "hardest"
        ? dispatch.model === hardestModel && dispatch.effort === hardestEffort
        : dispatch.model === model && dispatch.effort === (roleEffort[entry.role] ?? effort)))
      && stored.receipt.effective_model_profile === dispatch.model
      && stored.receipt.effective_effort === dispatch.effort, "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
    if (stored.receipt.profile_evidence === "claude_code_model_usage_reported") {
      invariant(executionAttestation === "codex_exec" && dispatch.tier === "hardest",
        "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
    }
    if (executionAttestation === "codex_exec") {
      const valid = dispatch.tier === "hardest"
        ? stored.receipt.profile_evidence === "claude_code_model_usage_reported"
          && CLAUDE_CONTEXT_ID_PATTERN.test(stored.receipt.request_context_id ?? "")
        : stored.receipt.profile_evidence === "codex_exec_request_pinned"
          && CODEX_CONTEXT_ID_PATTERN.test(stored.receipt.request_context_id ?? "");
      invariant(valid, "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
    }
    const receiptBody = {
      receipt_id: `receipt:${createHmac("sha256", key).update(`${operationKey}\0${entry.input_sha256}`).digest("hex").slice(0, 40)}`,
      transport: executionAttestation === "codex_exec" ? JOURNAL_CODEX_EXCHANGE_PROVIDER : JOURNAL_WORK_TRANSPORT,
      request_id: stored.receipt.receipt_id,
      // A unique answer receipt does not prove a unique chat. Leave this unverified unless a
      // dispatcher/provider receipt mechanically supplies the actual request context.
      request_context_id: typeof stored.receipt.request_context_id === "string"
        && REQUEST_CONTEXT_ID_PATTERN.test(stored.receipt.request_context_id)
        ? stored.receipt.request_context_id
        : null,
      input_manifest_sha256: entry.input_sha256,
      role_instruction_sha256: sha256(Buffer.from(entry.instruction, "utf8")),
      configured_model_profile: dispatch.model,
      configured_effort: dispatch.effort,
      effective_model_profile: stored.receipt.effective_model_profile,
      effective_effort: stored.receipt.effective_effort,
      ...(executionAttestation === "codex_exec" ? { execution_profile_evidence: stored.receipt.profile_evidence } : {}),
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
        tier: dispatch.tier ?? "standard"
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
  const adopted = new Set();
  async function ensureDispatch(store, entry, operationKey) {
    if (dispatched.has(entry.work_id)) return;
    await store.publishDispatch({
      schema_version: 1,
      work_id: entry.work_id,
      attempt_identity: journalExchangeAttemptIdentity(operationKey),
      role: entry.role,
      output_schema_name: entry.output_schema_name,
      tier: entry.tier ?? "standard",
      model: entry.tier === "hardest" ? hardestModel : model,
      effort: entry.tier === "hardest" ? hardestEffort : (roleEffort[entry.role] ?? effort),
      route_ref: routeRef,
      issued_at: entry.issued_at,
      expires_at: entry.expires_at
    });
    dispatched.add(entry.work_id);
  }

  // What the exchange says about the newest item for this key, without waiting.
  async function observe(operationKey, { tier = "standard" } = {}) {
    const { store, workId, entry, stored } = await current(operationKey);
    if (stored?.output) {
      invariant(entry, "JOURNAL_EXCHANGE_ENTRY_MISSING");
      let output;
      try {
        output = validateJournalSchema(entry.output_schema_name, stored.output);
      } catch (cause) {
        return { status: "invalid_output", cause };
      }
      const dispatch = (await store.listDispatch()).find((record) => record.work_id === workId);
      invariant(dispatch, "JOURNAL_EXCHANGE_DISPATCH_MISSING");
      try {
        return { status: "completed", output, receipt: receiptFor(operationKey, entry, stored, dispatch) };
      } catch (cause) {
        if (cause.code === "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED") return { status: "invalid_output", cause };
        throw cause;
      }
    }
    // Retired after its answer was stored durably; the caller holds the answer, not the exchange.
    if (stored?.exhausted) return { status: "exhausted", code: HARDEST_ATTEMPT_EXHAUSTED };
    if (stored?.retired) return { status: "unknown" };
    if (!entry && tier === "hardest" && executionAttestation === "codex_exec" && store.root) {
      const { status } = await readJournalAttemptMarker(store.root, journalExchangeAttemptIdentity(operationKey));
      if (journalAttemptConsumed(status)) return { status: "exhausted", code: HARDEST_ATTEMPT_EXHAUSTED };
    }
    if (!entry) return { status: "not_submitted" };
    if (Date.parse(entry.expires_at) <= now().getTime()) {
      const { closed } = await store.closeUnanswered(workId);
      // An answer won the race; read it on the next observation.
      return closed ? { status: "not_submitted", code: "JOURNAL_WORK_EXPIRED" } : observe(operationKey);
    }
    await ensureDispatch(store, entry, operationKey);
    return { status: "pending", workId };
  }

  const checkedInput = ({ role, packet, outputSchema, operationKey, grant, tier = "standard" }, prefetch = false) => {
    const definition = JOURNAL_ROLE_DEFINITIONS[role];
    invariant(definition && definition.outputSchema === outputSchema, "JOURNAL_ROLE_OUTPUT_SCHEMA_MISMATCH");
    if (UNSUPPORTED_ROLES.has(role))
      throw new JournalInferencePortError("JOURNAL_EXCHANGE_ROLE_UNSUPPORTED", { submissionStatus: "not_submitted" });
    if (prefetch && tier === "hardest")
      throw new JournalInferencePortError("JOURNAL_PREFETCH_TIER_UNSUPPORTED", { submissionStatus: "not_submitted" });
    const checkedPacket = buildJournalRolePacket(role, packet);
    assertJournalInferenceGrant(grant, role, checkedPacket);
    invariant(typeof operationKey === "string" && operationKey.length > 0, "OPERATION_KEY_INVALID");
    invariant(tier === "standard" || tier === "hardest", "WORK_TIER_INVALID");
    if (tier === "hardest" && !hardestJournalPacketFits(role, checkedPacket)) {
      throw new JournalInferencePortError("JOURNAL_WORK_PACKET_TOO_LARGE", { submissionStatus: "not_submitted" });
    }
    return { role, packet: checkedPacket, outputSchema, operationKey, grant, tier,
      digest: inputDigest(role, checkedPacket, outputSchema, grant) };
  };

  async function publish(input, { dispatchNew = false } = {}) {
    const { role, packet, outputSchema, operationKey, grant, tier, digest } = input;
    let selected = await current(operationKey);
    // A speculative item carries no durable caller intent. Replace it on the same operation key
    // before the sequential caller creates an intent or spends a controller attempt.
    for (let replacements = 0; !dispatchNew && selected.entry?.origin === "lookahead"
      && (selected.entry.input_sha256 !== digest
        || (!selected.stored && Date.parse(selected.entry.expires_at) <= now().getTime())); replacements += 1) {
      // A consumed answer can leave its work file behind if retirement stopped after writing the
      // tombstone. It is no longer speculative, even though the old work file says it was.
      if (selected.stored?.retired && !selected.stored.unanswered && !selected.stored.superseded)
        invariant(false, "OPERATION_KEY_CONFLICT");
      if (adopted.has(selected.workId) || await selected.store.isAdopted?.(selected.workId)) break;
      if (replacements >= MAX_SUCCESSORS)
        throw new JournalInferencePortError("JOURNAL_EXCHANGE_RETRY_LIMIT", { submissionStatus: "not_submitted" });
      if (selected.stored?.output) {
        // The answer belongs to the old grant/input and has no durable caller intent.
        await selected.store.retireWork(selected.workId, { superseded: true });
      } else {
        // If an answer wins the close race, the next iteration retires that stale answer.
        await selected.store.closeUnanswered(selected.workId);
      }
      selected = await current(operationKey);
    }
    const { store, workId, successor, entry: existing, stored } = selected;
    if (dispatchNew && successor > 0)
      throw new JournalInferencePortError("JOURNAL_PREFETCH_RETRY_UNSUPPORTED", { submissionStatus: "not_submitted" });
    if (existing) invariant(existing.input_sha256 === digest, "OPERATION_KEY_CONFLICT");
    // A consumed and retired answer without a work file behaves as on main: no new item is
    // published, and observe() reports the completion as unknown to the caller.
    // The first sequential invoke with the same input adopts a speculative item. Persist that
    // fact in the exchange so a resumed invoke cannot replace it on a changed grant or expiry.
    if (!dispatchNew && existing?.origin === "lookahead") {
      await store.markAdopted?.(workId);
      adopted.add(workId);
    }
    if (!existing && !stored) {
      // Host-side preflight is authoritative even for new reference resends.
      // No publication, Claude run, or daily slot is due for a consumed identity.
      const completion = await observe(operationKey, { tier });
      if (completion.status === "exhausted") {
        throw new JournalInferencePortError(completion.code, { submissionStatus: "exhausted" });
      }
      const issuedAt = now();
      const entry = {
        schema_version: 1, work_id: workId, case_id: caseId, role, tier,
        instruction: journalRoleInstruction(role), packet,
        output_schema_name: outputSchema, output_schema: journalSchema(outputSchema),
        expected_generation: packet.expected_generation ?? null,
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(issuedAt.getTime() + (tier === "hardest" ? hardestTtlMs : ttlMs)).toISOString(),
        input_sha256: digest, grant_id: grant.grant_id, grant_purpose: grant.purpose, route_ref: routeRef,
        ...(dispatchNew ? { origin: "lookahead" } : {})
      };
      try {
        const { created } = await store.publishWork(entry);
        if (!created) {
          const winner = await store.readWork(workId);
          if (winner) invariant(winner.input_sha256 === digest, "OPERATION_KEY_CONFLICT");
          // A sequential call that lost the publish race to a speculative item adopts it, as it would have
          // had it seen the item first, so a later expiry or restart can't replace it with a second call.
          if (!dispatchNew && winner?.origin === "lookahead") {
            await store.markAdopted?.(workId);
            adopted.add(workId);
          }
        }
        if (dispatchNew) {
          const publishedEntry = created ? entry : await store.readWork(workId);
          try { await ensureDispatch(store, publishedEntry, operationKey); }
          catch (cause) {
            // The work item is already published. Keep its lookahead slot occupied until its
            // answer, retirement, expiry or runtime close resolves it.
            const error = new JournalInferencePortError("JOURNAL_EXCHANGE_UNAVAILABLE",
              { submissionStatus: "unknown", cause });
            error.workPublished = publishedEntry?.origin === "lookahead";
            throw error;
          }
        }
        return { published: created, workId };
      } catch (cause) {
        if (cause instanceof ValidationError || cause.workPublished) throw cause;
        throw new JournalInferencePortError("JOURNAL_EXCHANGE_UNAVAILABLE", { submissionStatus: "not_submitted", cause });
      }
    }
    // An open speculative item whose dispatch record failed to publish gets it on the next prefetch, so a
    // worker can see it. Publishing a dispatch record is idempotent.
    if (dispatchNew && existing?.origin === "lookahead" && !stored
      && Date.parse(existing.expires_at) > now().getTime()) {
      try { await ensureDispatch(store, existing, operationKey); }
      catch (cause) {
        const error = new JournalInferencePortError("JOURNAL_EXCHANGE_UNAVAILABLE", { submissionStatus: "unknown", cause });
        error.workPublished = true;
        throw error;
      }
    }
    return { published: false, workId };
  }

  async function peek(operationKey) {
    const { store, workId, entry, stored } = await current(operationKey);
    if (stored?.retired && !stored.unanswered) return { status: "retired" };
    if (stored?.output) {
      invariant(entry, "JOURNAL_EXCHANGE_ENTRY_MISSING");
      let output;
      try { output = validateJournalSchema(entry.output_schema_name, stored.output); }
      catch { return { status: "invalid_output" }; }
      const dispatch = (await store.listDispatch()).find(record => record.work_id === workId);
      invariant(dispatch, "JOURNAL_EXCHANGE_DISPATCH_MISSING");
      try {
        receiptFor(operationKey, entry, stored, dispatch);
      } catch (cause) {
        if (cause.code === "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED")
          return { status: "invalid_output" };
        throw cause;
      }
      return { status: "completed", output };
    }
    if (stored?.retired) return { status: "retired" };
    if (entry && Date.parse(entry.expires_at) <= now().getTime()) return { status: "expired" };
    return { status: entry ? "pending" : "not_submitted" };
  }

  const invoke = async (request) => {
    const { operationKey, tier = "standard" } = request;
    await publish(checkedInput(request));

    const deadline = Date.now() + waitMs;
    for (;;) {
      const observed = await observe(operationKey, { tier });
      if (observed.status === "completed") return { output: observed.output, receipt: observed.receipt };
      if (observed.status === "invalid_output") {
        throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid", cause: observed.cause });
      }
      if (observed.status === "exhausted") {
        throw new JournalInferencePortError(observed.code, { submissionStatus: "exhausted" });
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
    pollMs,
    invoke,
    async prefetch(request) { return publish(checkedInput(request, true), { dispatchNew: true }); },
    peek,
    // "completed" with the output and receipt; "not_submitted" when no item exists or the newest one
    // expired unanswered (the caller may send it again); "invalid_output" when the stored answer
    // fails the importer's schema or lacks verified execution profile; "unknown" while open.
    async getCompletion(operationKey, options) {
      const observed = await observe(operationKey, options);
      if (observed.status === "completed") return { status: "completed", output: observed.output, receipt: observed.receipt };
      if (observed.status === "not_submitted") return { status: "not_submitted", code: observed.code ?? "INFERENCE_NOT_SUBMITTED" };
      if (observed.status === "invalid_output") return { status: "invalid_output" };
      if (observed.status === "exhausted") return { status: "exhausted", code: observed.code };
      return { status: "unknown" };
    },
    hasOperation,
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
