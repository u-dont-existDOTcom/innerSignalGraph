import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { acquirePrivateRootWriterLock } from "../storage/shared-case-coordinator.mjs";
import { validateJournalSchema } from "./contracts.mjs";
import { buildJournalRolePacket, JOURNAL_ROLE_DEFINITIONS, journalRoleInstruction } from "./provider-port.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const semanticStages = Object.freeze(["VISUAL_READ", "EXTRACT", "OMISSION_CHECK", "RECONCILE", "REFERENCE_AUDIT", "PATTERN_BUILD", "PATTERN_REVIEW", "COLD_TEST"]);
const terminalStates = new Set(["paused_quota", "needs_context", "blocked_authority", "cancelled", "revoked"]);
const emptyCompletion = () => ({
  archive_verified: "not_run",
  raw_search_available: "not_run",
  graph_built: "not_run",
  semantically_audited: "not_run",
  patterns_reviewed: "not_run",
  profile_committed: "not_run",
  cold_retrieval_verified: "not_run",
  capacity_tested: "not_run"
});

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function clone(value) {
  return structuredClone(value);
}

function stageRank(stage) {
  const rank = semanticStages.indexOf(stage);
  invariant(rank >= 0, "CONTROLLER_STAGE_INVALID");
  return rank;
}

export function computeJournalWorkId(identity, controllerSecret) {
  invariant(controllerSecret instanceof Uint8Array && controllerSecret.byteLength >= 32, "CONTROLLER_SECRET_INVALID");
  const required = ["case_id", "corpus_id", "source_representation", "core_range", "role", "prompt_version", "model_profile", "grant_purpose"];
  required.forEach((field) => invariant(Object.hasOwn(identity, field), "WORK_IDENTITY_INCOMPLETE"));
  invariant(Number.isSafeInteger(identity.core_range.start_byte) && Number.isSafeInteger(identity.core_range.end_byte)
    && identity.core_range.start_byte >= 0 && identity.core_range.end_byte >= identity.core_range.start_byte, "WORK_CORE_RANGE_INVALID");
  return `work:${createHmac("sha256", controllerSecret).update(JSON.stringify(identity)).digest("hex")}`;
}

export function createMemoryJournalJobLedger() {
  const entries = [];
  return Object.freeze({
    async load() { return entries.length ? clone(entries.at(-1)) : null; },
    async append(snapshot, expectedRevision) {
      const actual = entries.length - 1;
      invariant(actual === expectedRevision, "JOURNAL_LEDGER_REVISION_CONFLICT");
      const entry = { revision: actual + 1, checkpoint_ref: `memory-checkpoint:${actual + 1}`, snapshot: clone(snapshot) };
      entries.push(entry);
      return clone(entry);
    }
  });
}

export function createCorpusJournalJobLedger({ corpusStore, jobId, maximumRevisions = 100_000 }) {
  invariant(corpusStore && typeof corpusStore.writeJsonObject === "function" && typeof corpusStore.readJsonObject === "function", "CORPUS_STORE_INVALID");
  invariant(typeof jobId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(jobId), "JOB_ID_INVALID");
  const prefix = `controller:${sha256(Buffer.from(jobId, "utf8")).slice(0, 24)}:checkpoint`;
  let cached = undefined;
  const objectId = (revision) => `${prefix}:${String(revision).padStart(8, "0")}`;
  const load = async () => {
    if (cached !== undefined) return cached === null ? null : clone(cached);
    let latest = null;
    for (let revision = 0; revision < maximumRevisions; revision += 1) {
      try {
        const snapshot = await corpusStore.readJsonObject({ objectId: objectId(revision) });
        invariant(snapshot.job_id === jobId, "JOURNAL_LEDGER_JOB_MISMATCH");
        latest = { revision, checkpoint_ref: objectId(revision), snapshot };
      } catch (error) {
        if (error?.code === "ENOENT") break;
        throw error;
      }
    }
    cached = latest;
    return latest === null ? null : clone(latest);
  };
  return Object.freeze({
    load,
    async append(snapshot, expectedRevision) {
      const latest = await load();
      const actual = latest?.revision ?? -1;
      invariant(actual === expectedRevision, "JOURNAL_LEDGER_REVISION_CONFLICT");
      const revision = actual + 1;
      await corpusStore.writeJsonObject({ objectId: objectId(revision), value: snapshot });
      cached = { revision, checkpoint_ref: objectId(revision), snapshot: clone(snapshot) };
      return clone(cached);
    }
  });
}

function materialize(value, workByKey) {
  if (Array.isArray(value)) return value.map((item) => materialize(item, workByKey));
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$work_output") {
    const dependency = workByKey.get(value.$work_output);
    invariant(dependency?.status === "completed", "WORK_DEPENDENCY_INCOMPLETE");
    return clone(dependency.output);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, workByKey)]));
}

function outputComplete(role, output) {
  if (role === "extractor") return output.status === "complete";
  if (role === "omission_checker") return output.status === "sufficient_for_stated_scope";
  if (role === "reconciler") return output.status === "proposals_complete";
  return true;
}

function incompleteReason(role, output) {
  if (role === "omission_checker" && output.status === "repair_required") return "REPAIR_REQUIRED";
  if (role === "reconciler" && output.status === "needs_context") return "INSUFFICIENT_CONTEXT";
  return "OUTPUT_INCOMPLETE";
}

function checkpointFor(snapshot, override = {}) {
  const pending = snapshot.work_items.filter(({ status }) => status !== "completed");
  const current = pending[0] ?? null;
  const state = override.state ?? (current ? "ready" : "ready");
  const stage = override.stage ?? current?.stage ?? "GRAPH_VALIDATE";
  const nextAction = override.next_action ?? (current ? `run ${current.role} work ${current.work_id}` : "validate and assemble the candidate graph");
  const responsibleActor = override.responsible_actor ?? (state === "paused_quota" || state === "revoked" ? "owner" : (state === "running" ? "reasoning_role" : "controller"));
  const checkpoint = {
    schema_version: "1.0",
    job_id: snapshot.job_id,
    stage,
    state,
    generation: snapshot.generation,
    next_action: nextAction,
    responsible_actor: responsibleActor,
    blocked_reason: override.blocked_reason ?? null,
    completed_work_ids: snapshot.work_items.filter(({ status }) => status === "completed").map(({ work_id: workId }) => workId),
    pending_work_ids: pending.map(({ work_id: workId }) => workId),
    completion: clone(snapshot.completion),
    private_receipt_refs: snapshot.work_items.flatMap(({ receipt }) => receipt?.receipt_id ? [receipt.receipt_id] : [])
  };
  return validateJournalSchema("checkpoint", checkpoint);
}

export function createJournalImportController({
  ledger,
  inferencePort,
  controllerSecret,
  grant,
  promptVersion = "1.0",
  modelProfile = "mock-deterministic",
  resolvePacketInput = async (packetInput) => packetInput,
  afterInvokeBeforeCheckpoint = null,
  // Runs before an intent is recorded. A failure here, such as an expired authorization, stops the
  // step with nothing persisted: no attempt is spent and no call is left in an unknown state.
  beforeInvoke = null
}) {
  invariant(ledger && typeof ledger.load === "function" && typeof ledger.append === "function", "JOURNAL_LEDGER_INVALID");
  invariant(inferencePort && typeof inferencePort.invoke === "function" && typeof inferencePort.getCompletion === "function", "INFERENCE_PORT_INVALID");
  invariant(controllerSecret instanceof Uint8Array && controllerSecret.byteLength >= 32, "CONTROLLER_SECRET_INVALID");
  invariant(typeof resolvePacketInput === "function", "PACKET_INPUT_RESOLVER_INVALID");
  const secret = Buffer.from(controllerSecret);
  let resumedConfirmedUnsent = false;

  const persist = async (snapshot, expectedRevision, checkpointOverride = {}) => {
    const next = clone(snapshot);
    next.checkpoint = checkpointFor(next, checkpointOverride);
    return ledger.append(next, expectedRevision);
  };

  const initialize = async ({ jobId, caseId, corpusId, generation, workDefinitions, completion = {} }) => {
    invariant((await ledger.load()) === null, "JOURNAL_JOB_ALREADY_EXISTS");
    invariant(typeof jobId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(jobId), "JOB_ID_INVALID");
    invariant(Array.isArray(workDefinitions) && workDefinitions.length > 0, "WORK_PLAN_EMPTY");
    let previousRank = -1;
    const keys = new Set();
    const workItems = workDefinitions.map((definition) => {
      invariant(typeof definition.key === "string" && !keys.has(definition.key), "WORK_KEY_INVALID_OR_DUPLICATE");
      keys.add(definition.key);
      const rank = stageRank(definition.stage);
      invariant(rank >= previousRank, "WORK_STAGE_ORDER_INVALID");
      previousRank = rank;
      const roleDefinition = JOURNAL_ROLE_DEFINITIONS[definition.role];
      invariant(roleDefinition, "JOURNAL_ROLE_UNKNOWN");
      journalRoleInstruction(definition.role);
      invariant(definition.identity && typeof definition.identity === "object", "WORK_IDENTITY_INCOMPLETE");
      const identity = {
        case_id: caseId,
        corpus_id: corpusId,
        source_representation: definition.identity.source_representation,
        core_range: clone(definition.identity.core_range),
        role: definition.role,
        prompt_version: promptVersion,
        model_profile: modelProfile,
        grant_purpose: grant.purpose
      };
      return {
        key: definition.key,
        work_id: computeJournalWorkId(identity, secret),
        stage: definition.stage,
        role: definition.role,
        output_schema_id: roleDefinition.outputSchema,
        identity,
        assigned_core_ids: clone(definition.assigned_core_ids ?? []),
        source_locators: clone(definition.source_locators ?? []),
        packet_input: clone(definition.packet_input ?? {}),
        status: "planned",
        attempts: 0,
        retry_epoch: 0,
        operation_key: null,
        output: null,
        receipt: null,
        prior_outputs: []
      };
    });
    const snapshot = {
      schema_version: "1.0",
      job_id: jobId,
      case_id: caseId,
      corpus_id: corpusId,
      generation,
      prompt_version: promptVersion,
      model_profile: modelProfile,
      plan_sha256: sha256(Buffer.from(JSON.stringify(workItems.map(({ packet_input: packetInput, ...item }) => ({
        ...item,
        packet_input_sha256: sha256(Buffer.from(JSON.stringify(packetInput), "utf8"))
      }))), "utf8")),
      completion: { ...emptyCompletion(), ...completion },
      work_items: workItems,
      checkpoint: null
    };
    return persist(snapshot, -1);
  };

  const completeWork = async (entry, work, result) => {
    validateJournalSchema(work.output_schema_id, result.output);
    const next = clone(entry.snapshot);
    const target = next.work_items.find(({ work_id: workId }) => workId === work.work_id);
    target.output = clone(result.output);
    target.receipt = clone(result.receipt);
    if (!outputComplete(target.role, target.output)) {
      target.status = "needs_context";
      const reason = incompleteReason(target.role, target.output);
      return persist(next, entry.revision, {
        state: "needs_context",
        stage: target.stage,
        next_action: reason === "REPAIR_REQUIRED" ? `enqueue approved extractor repair for ${target.work_id}` : `provide bounded context for ${target.work_id}`,
        blocked_reason: reason,
        responsible_actor: "controller"
      });
    }
    target.status = "completed";
    return persist(next, entry.revision);
  };

  const recordFailure = async (entry, work, error) => {
    const next = clone(entry.snapshot);
    const target = next.work_items.find(({ work_id: workId }) => workId === work.work_id);
    const code = typeof error?.code === "string" ? error.code : "INFERENCE_FAILED";
    const submissionStatus = error?.submissionStatus ?? error?.details?.submission_status ?? "unknown";
    target.last_failure = { code, submission_status: submissionStatus };
    if (code === "QUOTA_PAUSED") {
      target.status = "paused_quota";
      return persist(next, entry.revision, { state: "paused_quota", stage: target.stage, next_action: "resume after authorized allowance is available", blocked_reason: code, responsible_actor: "owner" });
    }
    if (code === "GRANT_REVOKED" || code === "GRANT_EXPIRED") {
      target.status = "revoked";
      return persist(next, entry.revision, { state: "revoked", stage: target.stage, next_action: "obtain a new explicit grant or leave semantic work revoked", blocked_reason: code, responsible_actor: "owner" });
    }
    if (code === "INFERENCE_ISOLATION_UNAVAILABLE") {
      target.status = "blocked_authority";
      return persist(next, entry.revision, { state: "blocked_authority", stage: target.stage, next_action: "bind an authorized fresh-context inference route", blocked_reason: code, responsible_actor: "owner" });
    }
    if (code === "INVALID_STRUCTURED_OUTPUT" && target.attempts < 2) {
      target.status = "invalid_output";
      return persist(next, entry.revision, { state: "retryable_error", stage: target.stage, next_action: `request one schema-bound reserialization for ${target.work_id}`, blocked_reason: code, responsible_actor: "controller" });
    }
    if (code === "COMPLETION_UNKNOWN" || submissionStatus === "unknown" || submissionStatus === "submitted") {
      target.status = "completion_unknown";
      return persist(next, entry.revision, { state: "retryable_error", stage: target.stage, next_action: `query transport completion for ${target.operation_key}`, blocked_reason: "COMPLETION_UNKNOWN", responsible_actor: "controller" });
    }
    if ((code === "RETRYABLE_TRANSPORT" || submissionStatus === "not_submitted") && target.attempts < 2) {
      target.status = "retryable_error";
      return persist(next, entry.revision, { state: "retryable_error", stage: target.stage, next_action: `retry confirmed-unsent work ${target.work_id}`, blocked_reason: code, responsible_actor: "controller" });
    }
    target.status = "blocked_authority";
    return persist(next, entry.revision, { state: "blocked_authority", stage: target.stage, next_action: `inspect blocked semantic work ${target.work_id}`, blocked_reason: code, responsible_actor: "owner" });
  };

  const step = async () => {
    let entry = await ledger.load();
    invariant(entry, "JOURNAL_JOB_NOT_INITIALIZED");
    let work = entry.snapshot.work_items.find(({ status }) => status !== "completed");
    if (!work) return entry;
    if (["needs_context", "paused_quota", "revoked", "blocked_authority"].includes(work.status)) return entry;
    if (["intent_persisted", "completion_unknown"].includes(work.status)) {
      const completion = await inferencePort.getCompletion(work.operation_key);
      if (completion.status === "completed") return completeWork(entry, work, completion);
      if (completion.status === "not_submitted") {
        if (work.attempts === 2) return recordFailure(entry, work,
          { code: "INFERENCE_RETRY_LIMIT", submissionStatus: "not_submitted" });
        const next = clone(entry.snapshot);
        next.work_items.find(({ work_id: workId }) => workId === work.work_id).status = "retryable_error";
        return persist(next, entry.revision, { state: "retryable_error", stage: work.stage, next_action: `retry confirmed-unsent work ${work.work_id}`, blocked_reason: "CONFIRMED_NOT_SUBMITTED", responsible_actor: "controller" });
      }
      // Only a port that knows its outcomes (the connector exchange) reports a stored answer that fails
      // the schema here; it gets the same one schema-bound retry as an invalid answer from invoke().
      if (completion.status === "invalid_output") {
        return recordFailure(entry, work, { code: "INVALID_STRUCTURED_OUTPUT", submissionStatus: "completed_invalid" });
      }
      if (work.status === "completion_unknown") return entry;
      const next = clone(entry.snapshot);
      next.work_items.find(({ work_id: workId }) => workId === work.work_id).status = "completion_unknown";
      return persist(next, entry.revision, { state: "retryable_error", stage: work.stage, next_action: `query transport completion for ${work.operation_key}`, blocked_reason: "COMPLETION_UNKNOWN", responsible_actor: "controller" });
    }
    invariant(["planned", "retryable_error", "invalid_output"].includes(work.status), "WORK_STATE_INVALID");
    invariant(work.attempts < 2, "WORK_RETRY_LIMIT_EXCEEDED");
    const workByKey = new Map(entry.snapshot.work_items.map((item) => [item.key, item]));
    const roleInput = await resolvePacketInput(materialize(work.packet_input, workByKey), { work: clone(work) });
    for (const field of ["protocol_version", "output_schema_id", "assigned_core_ids", "source_locators", "expected_generation", "controller_provenance_tag", "grant_purpose"]) {
      invariant(!Object.hasOwn(roleInput, field), "CONTROLLER_PACKET_FIELD_OVERRIDE");
    }
    const packet = buildJournalRolePacket(work.role, {
      protocol_version: "1.0",
      output_schema_id: work.output_schema_id,
      assigned_core_ids: work.assigned_core_ids,
      source_locators: work.source_locators,
      expected_generation: entry.snapshot.generation,
      controller_provenance_tag: work.work_id,
      grant_purpose: grant.purpose,
      ...roleInput
    });
    if (beforeInvoke) await beforeInvoke({ work: clone(work) });
    const packetDigest = sha256(Buffer.from(JSON.stringify(packet), "utf8"));
    const baseOperationKey = `journal:${work.work_id.slice(5, 45)}:${packetDigest.slice(0, 32)}`;
    const retryEpoch = Number.isSafeInteger(work.retry_epoch) && work.retry_epoch >= 0 ? work.retry_epoch : 0;
    const reserializationKey = `${baseOperationKey}:reserialize${retryEpoch === 0 ? "" : `:${retryEpoch}`}`;
    const operationKey = work.status === "invalid_output" ? reserializationKey
      : work.status === "retryable_error" ? `${baseOperationKey}:unsent-retry:${retryEpoch}:${work.attempts}`
        : (work.operation_key ?? baseOperationKey);
    const intentSnapshot = clone(entry.snapshot);
    const intentWork = intentSnapshot.work_items.find(({ work_id: workId }) => workId === work.work_id);
    intentWork.status = "intent_persisted";
    intentWork.attempts += 1;
    intentWork.operation_key = operationKey;
    entry = await persist(intentSnapshot, entry.revision, { state: "running", stage: work.stage, next_action: `await transport result for ${operationKey}`, blocked_reason: null, responsible_actor: "reasoning_role" });
    work = entry.snapshot.work_items.find(({ work_id: workId }) => workId === work.work_id);
    let result;
    try {
      result = await inferencePort.invoke({ role: work.role, packet, outputSchema: work.output_schema_id, operationKey, grant });
    } catch (error) {
      return recordFailure(entry, work, error);
    }
    if (afterInvokeBeforeCheckpoint) await afterInvokeBeforeCheckpoint({ work: clone(work), result: clone(result) });
    return completeWork(entry, work, result);
  };

  const provideContext = async (workId, packetPatch) => {
    const entry = await ledger.load();
    invariant(entry, "JOURNAL_JOB_NOT_INITIALIZED");
    const next = clone(entry.snapshot);
    const work = next.work_items.find(({ work_id: candidate }) => candidate === workId);
    invariant(work?.status === "needs_context", "WORK_NOT_WAITING_FOR_CONTEXT");
    work.prior_outputs.push({ output: work.output, receipt: work.receipt });
    work.output = null;
    work.receipt = null;
    work.packet_input = { ...work.packet_input, ...clone(packetPatch) };
    work.status = "planned";
    work.attempts = 0;
    work.operation_key = null;
    return persist(next, entry.revision);
  };

  const runUntilBlocked = async ({ maximumSteps = 100 } = {}) => {
    // A controller instance is one run. A prior run that exhausted only definitely-unsent
    // attempts may try again with a fresh transport; an ambiguous submission remains parked.
    if (!resumedConfirmedUnsent) {
      resumedConfirmedUnsent = true;
      const blocked = await ledger.load();
      const work = blocked?.snapshot.work_items.find(({ status }) => status !== "completed");
      let lastFailure = work?.last_failure;
      const legacyFailureCode = blocked?.snapshot.checkpoint.blocked_reason;
      if (work?.status === "blocked_authority" && !lastFailure && typeof work.operation_key === "string"
        && typeof legacyFailureCode === "string" && legacyFailureCode !== "INFERENCE_ISOLATION_UNAVAILABLE"
        && inferencePort.capabilities?.()?.authoritative_completion === true
        && (await inferencePort.getCompletion(work.operation_key)).status === "not_submitted") {
        lastFailure = { code: legacyFailureCode, submission_status: "not_submitted" };
      }
      if (work?.status === "blocked_authority" && lastFailure?.submission_status === "not_submitted"
        && lastFailure.code !== "INFERENCE_ISOLATION_UNAVAILABLE") {
        const next = clone(blocked.snapshot);
        const target = next.work_items.find(({ work_id: workId }) => workId === work.work_id);
        target.status = "retryable_error";
        target.attempts = 0;
        target.retry_epoch = (Number.isSafeInteger(target.retry_epoch) && target.retry_epoch >= 0 ? target.retry_epoch : 0) + 1;
        target.operation_key = null;
        await persist(next, blocked.revision, { state: "retryable_error", stage: target.stage,
          next_action: `retry confirmed-unsent work ${target.work_id}`, blocked_reason: lastFailure.code,
          responsible_actor: "controller" });
      }
    }
    for (let count = 0; count < maximumSteps; count += 1) {
      const before = await ledger.load();
      invariant(before, "JOURNAL_JOB_NOT_INITIALIZED");
      if (terminalStates.has(before.snapshot.checkpoint.state)) return before;
      const current = before.snapshot.work_items.find(({ status }) => status !== "completed");
      if (!current) return before;
      const after = await step();
      if (after.revision === before.revision) return after;
    }
    throw new ValidationError("CONTROLLER_STEP_LIMIT_EXCEEDED", { code: "CONTROLLER_STEP_LIMIT_EXCEEDED" });
  };

  return Object.freeze({
    initialize,
    step,
    runUntilBlocked,
    provideContext,
    async status() { const entry = await ledger.load(); return entry ? clone(entry.snapshot.checkpoint) : null; },
    async privateState() { return ledger.load(); },
    capabilities() { return clone(inferencePort.capabilities?.() ?? { enabled: false }); },
    close() { secret.fill(0); }
  });
}

export async function openLockedJournalImportController({ privateRootDir, ...controllerOptions }) {
  const writerLock = await acquirePrivateRootWriterLock({ rootDir: privateRootDir });
  try {
    const controller = createJournalImportController(controllerOptions);
    return Object.freeze({
      controller,
      async close() {
        controller.close();
        await writerLock.release();
      }
    });
  } catch (error) {
    await writerLock.release();
    throw error;
  }
}
