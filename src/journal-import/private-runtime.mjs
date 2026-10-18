import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { isOutside } from "../core/private-path.mjs";
import { journalCalibrationCriticalMissLimit, journalCalibrationFailureLimit, journalOperatorReviewDir, journalPointerCopyRunWords,
  journalPointerDeadlines, journalPointerRules, journalQuoteNumericDateOrder, journalSemanticConcurrency, JOURNAL_HARDEST_EFFORTS,
  normalizeJournalHardestLaneConfig, vaultRootMatchesConfig } from "./run-config.mjs";
import { createPrivateJournalCorpusStore } from "../storage/private-journal-corpus.mjs";
import { acquirePrivateRootWriterLock, withPrivateRootWriterLock } from "../storage/shared-case-coordinator.mjs";
import { loadHostedPrivateCaseOperatorProvidersFromEnvironment } from "../storage/hosted-private-case-providers.mjs";
import { PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES, createPrivateCaseAccessService } from "../storage/private-case-access.mjs";
import { loadJournalInferencePortFromEnvironment } from "./provider-runtime.mjs";
import { journalImportOrder, readingFirstAttestationKey, verifiedReadingFirstSynthesis } from "./reading-first-runtime-gate.mjs";
import { produceReadingFirstJournal } from "./reading-first-source-producer.mjs";
import { createReadingFirstPortAdapter } from "./reading-first-port-adapter.mjs";
import { buildReadingFirstFacetIndexes } from "./reading-first-facets.mjs";
import { JOURNAL_CODEX_EXCHANGE_PROVIDER, JOURNAL_EXCHANGE_PROVIDER } from "./exchange-port.mjs";
import { buildJournalJobSnapshot, createCorpusJournalJobLedger, createJournalImportController } from "./controller.mjs";
import { createJournalLookahead } from "./lookahead.mjs";
import { JOURNAL_ROLE_DEFINITIONS, buildJournalRolePacket, journalRoleInstruction } from "./provider-port.mjs";
import { hardestJournalRequestFits } from "./packet-bounds.mjs";
import { parseSourceFile, sourceFormatForPath } from "./parsers/index.mjs";
import { partitionRepresentation, verifyRepresentationCoverage } from "./partition.mjs";
import { selectCalibrationWindows, scoreReferenceReview, createDeterministicAuditSample, certifyIndependentAudit } from "./audit.mjs";
import { adaptExtractionToGraph, journalLocalNodeId, persistGraphGeneration } from "./graph.mjs";
import { QUOTE_INDEX_VERSION, QUOTE_POINTER_VERSION, buildQuoteGeneration, quoteIndexVersionOf } from "./quote-index.mjs";
import { buildQuoteTermsFromGraph } from "./quote-terms.mjs";
import { calibrationScoreCounts, firstFailurePastCriticalLimit, pooledCalibration, referenceScorePasses,
  reviewAfterWithholding, reviewFindingTargets, reviewStatusFromContent, scopeReviewAfterRepair,
  sourceOnlyCalibrationCounts, withholdFlaggedItems } from "./review-convergence.mjs";
import { JOURNAL_GRAPH_CONTRACT, validateJournalGraph, resolveExactQuote } from "./contracts.mjs";
import { createDurableJournalInferencePort } from "./durable-inference.mjs";
import { QUOTE_SEARCH_LIMITS, openPrivateJournalGraph } from "./retrieval.mjs";
import { buildPointerGeneration, pointerPassInput } from "./pointer-pass.mjs";
import { POINTER_RECALL_TOP, pointerRecallReach, pointerReferenceCounts, runPointerMeasure, runPointerPass, runPointerPilot,
  runPointerRebaseMeasure, runPointerReference, runPointerSearchCheck } from "./pointer-steps.mjs";
import { pointerChallengeUnits } from "./pointer-reference.mjs";
import { checkReviewDirectory, collectPointerExamples, renderPointerExamples, writeReviewFile } from "./pointer-examples.mjs";
import { lexicalTerms } from "./graph.mjs";
import { applyReconciliationResult, validateReconciliationResult } from "./reconcile.mjs";
import { createAuditScopeIndex, createReconciledAuditScope, summarizeFidelityCoverage } from "./audit-scope.mjs";
import { publishJournalGenerationFromStaging } from "./publication.mjs";
import { runJournalPatternPass } from "./pattern-stage.mjs";
import { createJournalSemanticBatches, journalSemanticUnitCost, splitBatchExtractionByUnit } from "./semantic-batches.mjs";
import { contextAnswerCounts, extractionCycleDiagnostics, fidelityCycleDiagnostics, unresolvedExtractionDiagnostics, diagnosticBlockerCode } from "./calibration-diagnostics.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
// Compare model outputs only in memory; diagnostics retain neither content nor a content hash.
const canonicalJson = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const extractionChanged = (previous, repaired) => previous && repaired
  ? canonicalJson(previous) !== canonicalJson(repaired) : null;
const invariant = (v, code) => { if (!v) throw new ValidationError(code, { code }); };
// One semantic packet's source material (core units, adjacent context and visual transcriptions) stays below
// this many bytes; an answered context request widens a unit's window to at most EXPANDED_CONTEXT_BYTES a side.
const SEMANTIC_PACKET_BYTES = 180_000;
const EXPANDED_CONTEXT_BYTES = 32_000;
// The quote index's records and index pieces are stored in small objects, so a search decrypts only
// what it touches (scripts/journal-quote-benchmark.mjs measures the difference).
const QUOTE_SHARD_BYTES = 128 * 1024;
// Calibration windows over native-text units. A scanned or image-only source has none at intake;
// its visual units get windows once the page reader has produced them, so none is a valid start.
const nativeCalibration = (units) => units.length ? selectCalibrationWindows(units) : [];
// A native page keeps the parser's disposition. Plain UTF-8 text needs no page record;
// an unmapped non-text representation has no evidence for a readable status.
const PARSE_STATUS_BY_DISPOSITION = Object.freeze({ readable: "readable", visual_pending: "visual_pending", review_required: "review_required", unreadable: "unreadable" });
const parseStatus = (page, mimeType) => page ? (PARSE_STATUS_BY_DISPOSITION[page.disposition] ?? "partial")
  : (mimeType?.startsWith("text/plain") ? "readable" : "partial");
const completions = () => Object.fromEntries(["archive_verified", "raw_search_available", "graph_built", "semantically_audited", "patterns_reviewed", "profile_committed", "cold_retrieval_verified", "capacity_tested"].map((k) => [k, "not_run"]));

// Keep this identity calculation shared by work() and lookahead. Its property order is part of
// existing persisted job IDs, including the visual reader's older single-unit identity.
export function journalWorkPlan({ id, role, stage, unit = null, units = null, packetInput,
  identityPacketInput = packetInput, dependencies = [], tier = "standard" }) {
  const scopeUnits = Array.isArray(units) ? units : (unit ? [unit] : []);
  invariant(scopeUnits.length > 0, "JOURNAL_WORK_SCOPE_INVALID");
  const assignedCoreIds = scopeUnits.map(item => item.unit_id);
  const sourceLocators = scopeUnits.map(item => ({ representation_id: item.representation_id,
    page: item.page_number ?? null, start_byte: item.start_byte, end_byte: item.end_byte }));
  const identity = scopeUnits.length === 1
    ? { source_representation: scopeUnits[0].representation_id,
        core_range: { start_byte: scopeUnits[0].start_byte, end_byte: scopeUnits[0].end_byte } }
    : { source_representation: `batch:${hash(assignedCoreIds.join("\0")).slice(0, 40)}`,
        core_range: { start_byte: 0, end_byte: scopeUnits.reduce((total, item) => total + Math.max(0, item.end_byte - item.start_byte), 0) } };
  const legacyVisual = role === "visual_reader" && stage === "VISUAL_READ" && scopeUnits.length === 1;
  invariant(tier === "standard" || tier === "hardest", "WORK_TIER_INVALID");
  const jobId = `job:${hash(JSON.stringify({ id, role, stage, packetInput: identityPacketInput,
    ...(legacyVisual ? {} : { assigned_core_ids: assignedCoreIds, source_locators: sourceLocators }),
    dependencies, instruction: journalRoleInstruction(role),
    dependency_instructions: dependencies.map(item => journalRoleInstruction(item.role)),
    ...(tier === "hardest" ? { tier } : {}) }))}`;
  return { jobId, scopeUnits, assignedCoreIds, sourceLocators, identity };
}

export const journalJobId = request => journalWorkPlan(request).jobId;

export function applyHardestDailyLimit(state, { now = () => new Date(), dailyLimit, newlySent = true }) {
  invariant(Number.isSafeInteger(dailyLimit) && dailyLimit >= 1, "HARDEST_LANE_CONFIG_INVALID");
  const day = now().toISOString().slice(0, 10);
  if (state.hardest_lane?.day !== day) state.hardest_lane = { day, sent: 0 };
  if (!newlySent) return true;
  if (state.hardest_lane.sent >= dailyLimit) {
    state.blocker = "HARDEST_DAILY_LIMIT";
    return false;
  }
  state.hardest_lane.sent += 1;
  if (state.blocker === "HARDEST_DAILY_LIMIT") state.blocker = null;
  return true;
}

async function privateJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, file);
  const directory = await fs.open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function existingJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

const MAXIMUM_RENDERED_PAGE_BYTES = 64 * 1024 * 1024;

// Renders one page of the verified source, fed to pdftoppm on stdin, and reads the image from its
// stdout. Neither the source nor the page image is read from or written to a file, so a page can't
// come from a replaced source and no plaintext page image is left behind.
export async function renderJournalPdfPage(sourceBytes, page) {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1800", "-png", "-"], { stdio: ["pipe", "pipe", "ignore"], shell: false });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new ValidationError("VISUAL_RENDER_TIMEOUT", { code: "VISUAL_RENDER_TIMEOUT" })); }, 60_000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAXIMUM_RENDERED_PAGE_BYTES) { chunks.push(chunk); return; }
      child.kill("SIGKILL");
      finish(new ValidationError("VISUAL_RENDER_TOO_LARGE", { code: "VISUAL_RENDER_TOO_LARGE" }));
    });
    child.once("error", () => finish(new ValidationError("VISUAL_RENDER_UNAVAILABLE", { code: "VISUAL_RENDER_UNAVAILABLE" })));
    child.once("close", (code) => code === 0 && bytes > 0
      ? finish(null, Buffer.concat(chunks))
      : finish(new ValidationError("VISUAL_RENDER_FAILED", { code: "VISUAL_RENDER_FAILED" })));
    // pdftoppm may exit before reading all of stdin; its exit status reports that failure.
    child.stdin.on("error", () => {});
    child.stdin.end(sourceBytes);
  });
}

// Earlier versions rendered page images to plaintext files under visual/. Persisted page images
// are already in the encrypted store, so leftovers go.
async function removeLegacyPageRenders(root) {
  const directory = path.join(root, "visual");
  let info;
  try { info = await fs.lstat(directory); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  invariant(info.isDirectory() && !info.isSymbolicLink(), "JOURNAL_EXECUTION_ROOT_INVALID");
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^page-\d+\.png$/.test(entry.name)) await fs.unlink(path.join(directory, entry.name));
  }
  await fs.rmdir(directory).catch((error) => { if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) throw error; });
}

/** A private operator process owns this runtime. No mutation is added to the MCP. */
export async function openJournalExecutionRuntime({ config, configPath, environment = process.env, service: suppliedService = null, inferencePort: suppliedPort = null, authContextProvider = null, sourceParser = parseSourceFile, renderVisualPage = renderJournalPdfPage, now = () => new Date() }) {
  const semanticConcurrency = journalSemanticConcurrency(config);
  const calibrationFailureLimit = journalCalibrationFailureLimit(config);
  const calibrationCriticalMissLimit = journalCalibrationCriticalMissLimit(config);
  const quoteNumericDateOrder = journalQuoteNumericDateOrder(config);
  const importOrder = journalImportOrder(config);
  const pointerDeadlines = journalPointerDeadlines(config);
  const pointerCopyRunWords = journalPointerCopyRunWords(config);
  const pointerRules = journalPointerRules(config);
  invariant(config.max_external_spend_usd === 0, "JOURNAL_ZERO_SPEND_REQUIRED");
  // An empty source has nothing to import, so no run of it could finish; doctor reports the same.
  invariant(Number.isSafeInteger(config.source?.bytes) && config.source.bytes > 0, "JOURNAL_SOURCE_EMPTY");
  invariant(path.isAbsolute(config.execution_root ?? ""), "JOURNAL_EXECUTION_ROOT_REQUIRED");
  const root = path.resolve(config.execution_root);
  const repositoryRoot = path.resolve(new URL("../../", import.meta.url).pathname);
  invariant(isOutside(repositoryRoot, root), "JOURNAL_EXECUTION_ROOT_PRIVATE_REQUIRED");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await fs.lstat(root);
  invariant(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), "JOURNAL_EXECUTION_ROOT_INVALID");
  await fs.chmod(root, 0o700);
  const lock = await acquirePrivateRootWriterLock({ rootDir: root });
  let providers, port, store;
  const secretBuffers = [];
  try {
    providers = suppliedService ? null : loadHostedPrivateCaseOperatorProvidersFromEnvironment({ ...environment });
    // The vault the operator environment points at must be one this run's config names, checked
    // here as well as in doctor, so a run started directly can't stage into or publish to another.
    invariant(!providers || vaultRootMatchesConfig(config, providers.rootDir), "JOURNAL_PRIVATE_ROOT_MISMATCH");
    await removeLegacyPageRenders(root);
    const service = suppliedService ?? createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider });
    const caseId = config.target_profile.case_id;
    const auth = { bearerToken: environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN };
    const verifyAccess = async () => {
      for (const purpose of ["archive", "organize_search", "session_use"]) await service.verifyCaseAccess(caseId, { requiredScope: "case:write", requiredPurpose: purpose }, auth);
    };
    // A renewing token can still be refused: on a host short of memory it can run out between the provider's look at
    // it and the case check (12 Oct 2026). One fresh token and one more check tell that apart from access that was
    // withdrawn, which is refused again and stops the command as before.
    const authorize = async () => {
      if (authContextProvider) Object.assign(auth, await authContextProvider());
      try { await verifyAccess(); }
      catch (error) {
        if (!authContextProvider || error?.code !== "PRIVATE_CASE_ACCESS_DENIED") throw error;
        Object.assign(auth, await authContextProvider({ renew: true }));
        await verifyAccess();
      }
    };
    await authorize();
    const route = environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON ? JSON.parse(environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON) : null;
    // The two ChatGPT routes retain their exact subscription model and effort pin. The Codex exec
    // exchange has its own validated request pin; every supported route remains zero spend.
    if (!suppliedPort && route) invariant(
      (route.provider === "codex_exec_exchange" && route.max_external_spend_usd === 0)
      || (["chatgpt_subscription_browser", "chatgpt_connector_exchange"].includes(route.provider)
        && route.model === "GPT-5.6 Sol" && route.effort === "Pro" && route.max_external_spend_usd === 0),
      "JOURNAL_SUBSCRIPTION_ROUTE_REQUIRED");
    const keyFile = path.join(root, "staging.key");
    try { await fs.writeFile(keyFile, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    // One no-follow handle for the check and the read, so the key can't be swapped in between.
    const key = await withOpenedRegularFile(keyFile, async (handle, keyInfo) => {
      invariant((keyInfo.mode & 0o077) === 0, "JOURNAL_STAGING_KEY_INVALID");
      return handle.readFile();
    }).catch((error) => {
      if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") invariant(false, "JOURNAL_STAGING_KEY_INVALID");
      throw error;
    });
    secretBuffers.push(key);
    const stateFile = path.join(root, "state.json");
    let state = await existingJson(stateFile);
    if (!state) {
      state = { schema_version: 1, case_id: caseId, corpus_id: `corpus:${randomUUID()}`, generation: `generation:${randomUUID()}`, source_sha256: config.source.sha256, import_order: importOrder, stage: "INTAKE", completion: completions(), completed_units: [], completed_visual_pages: [], calibration: "not_run", calibration_epoch: 0, calibration_history: [], blocker: null };
      await privateJson(stateFile, state);
    }
    invariant(state.case_id === caseId && state.source_sha256 === config.source.sha256, "JOURNAL_RESUME_BINDING_MISMATCH");
    // Older runs had no import_order field and always used quote-first. Never
    // silently switch an in-progress generation into a different pipeline.
    invariant((state.import_order ?? "legacy_quote_first") === importOrder,
      "JOURNAL_IMPORT_ORDER_CHANGED");
    store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId: state.corpus_id, corpusKey: key, resumeMatchingObjects: true });
    const hardestLane = normalizeJournalHardestLaneConfig(config);
    invariant(Number.isSafeInteger(hardestLane.daily_limit) && hardestLane.daily_limit >= 1, "HARDEST_LANE_CONFIG_INVALID");
    invariant(Number.isFinite(hardestLane.ttl_hours) && hardestLane.ttl_hours > 0, "HARDEST_LANE_CONFIG_INVALID");
    port = suppliedPort ?? loadJournalInferencePortFromEnvironment({ ...environment }, {
      caseId,
      hardestLane,
      transportCheckpoint: value => store.writeJsonObject({
        objectId: `transport:${hash(value.context.request_id)}:${value.phase}`, value
      })
    });
    const semanticPort = port;
    // The connector exchange checks its root and clears stale temporary files before any work.
    await semanticPort.prepare?.();
    if (hardestLane.enabled && !suppliedPort) {
      const capabilities = semanticPort.capabilities();
      invariant(capabilities.hardest_fresh_context_per_generate === true,
        "INFERENCE_ISOLATION_UNAVAILABLE");
      invariant(capabilities.hardest_authenticated_execution_profile_per_generate === true,
        "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
    }
    let lookahead = null;
    const lookaheadSupported = semanticConcurrency > 1
      && typeof semanticPort.prefetch === "function" && typeof semanticPort.peek === "function";
    const lookaheadSent = lookaheadSupported ? new Set() : null;
    const lookaheadUsed = lookaheadSupported ? new Set() : null;
    let lookaheadErrors = 0;
    port = createDurableJournalInferencePort({ port: {
      capabilities: () => semanticPort.capabilities(),
      // Check immediately before the send, including after the durable intent was written.
      // A denial there is recorded as not submitted so resume cannot mistake it for a sent call.
      async invoke(input, options) {
        try { await authorize(); }
        catch (error) { error.submissionStatus = "not_submitted"; throw error; }
        if (lookaheadSupported) {
          lookahead?.markUsed(input.operationKey);
          lookaheadUsed.add(input.operationKey);
        }
        const result = await semanticPort.invoke(input, options);
        // A grant may change during a long application call. Recheck before the
        // durable port admits its result or a dependent role receives it.
        await authorize();
        return result;
      },
      async getCompletion(operationKey, options) {
        await authorize();
        const result = await semanticPort.getCompletion(operationKey, options);
        await authorize();
        return result;
      },
      isAuthoritativeCompletion: (operationKey, input) => typeof semanticPort.isAuthoritativeCompletion === "function"
        ? semanticPort.isAuthoritativeCompletion(operationKey, input)
        : semanticPort.capabilities?.()?.authoritative_completion === true,
      // Lets the port drop its own copy once the durable store holds the answer; moves no content.
      release: (operationKey) => semanticPort.release?.(operationKey),
      close: () => semanticPort.close?.()
    }, corpusStore: store });
    const sourcePath = path.resolve(path.dirname(configPath), "..", config.source.relative_path);
    // The same real-location check doctor makes, here too, since every command opens the source.
    invariant(isOutside(repositoryRoot, sourcePath), "JOURNAL_SOURCE_LOCATION_INVALID");
    // One no-follow read of the private source, checked against the configured length and digest.
    const readVerifiedSource = async () => {
      const bytes = await withOpenedRegularFile(sourcePath, async (handle, sourceInfo) => {
        invariant((sourceInfo.mode & 0o077) === 0, "JOURNAL_SOURCE_PRIVATE_REQUIRED");
        return handle.readFile();
      }).catch((error) => {
        if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") invariant(false, "JOURNAL_SOURCE_PRIVATE_REQUIRED");
        throw error;
      });
      if (bytes.length === config.source.bytes && hash(bytes) === config.source.sha256) return bytes;
      bytes.fill(0);
      throw new ValidationError("SOURCE_BINDING_MISMATCH", { code: "SOURCE_BINDING_MISMATCH" });
    };
    // Until intake archives the original, the configured source must be present and match. After
    // that the encrypted archive is the source every step reads, so deleting or rotating the upload
    // doesn't stop status or a resume.
    const archived = await store.readJsonObject({ objectId: "intake:original" })
      .catch((error) => { if (error?.code === "ENOENT") return null; throw error; });
    if (!archived) (await readVerifiedSource()).fill(0);
    const grant = { grant_id: config.existing_grant_ref, principal_id: "authorized-private-operator", purpose: "organize_search", allowed_roles: Object.keys(JOURNAL_ROLE_DEFINITIONS), revoked: false, expires_at: null };
    invariant(typeof grant.grant_id === "string" && grant.grant_id.length > 0, "JOURNAL_GRANT_REFERENCE_REQUIRED");
    const save = async () => { state.updated_at = now().toISOString(); await privateJson(stateFile, state); };
    const writeLarge = async (id, value) => store.writeChunkedOriginal({ objectId: id, bytes: Buffer.from(JSON.stringify(value)) });
    const readLarge = async (ref) => { const b = await store.reassembleOriginal(ref); try { return JSON.parse(b.toString("utf8")); } finally { b.fill(0); } };
    const readIfPresent = async (id) => { try { return await store.readJsonObject({ objectId: id }); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
    const writeOnce = async (id, value) => {
      const prior = await readIfPresent(id);
      const canonical = (v) => JSON.stringify(v, (k, x) => k === "replay" ? undefined : x);
      if (prior) {
        let legacyDiagnosticsOnly = false;
        if (id.startsWith("unit:graph:") && !Object.hasOwn(prior, "diagnostics")
          && Object.hasOwn(value, "diagnostics")) {
          const withoutDiagnostics = { ...value };
          delete withoutDiagnostics.diagnostics;
          legacyDiagnosticsOnly = canonical(prior) === canonical(withoutDiagnostics);
        }
        invariant(canonical(prior) === canonical(value) || legacyDiagnosticsOnly, "JOURNAL_IMMUTABLE_RESULT_CONFLICT");
        return prior;
      }
      await store.writeJsonObject({ objectId: id, value }); return value;
    };
    const calibrationEpoch = () => state.calibration_epoch ?? 0;
    const epochId = (id, calibration) => calibration && calibrationEpoch() > 0
      ? `${id}:epoch:${calibrationEpoch()}` : id;
    // Attempt and hardest identities must also end in the epoch suffix.
    const derivedId = (id, derivation) => {
      const suffix = `:epoch:${calibrationEpoch()}`;
      return calibrationEpoch() > 0 && id.endsWith(suffix)
        ? `${id.slice(0, -suffix.length)}:${derivation}${suffix}` : `${id}:${derivation}`;
    };
    let unitRecordPlanRef = null;
    let calibrationRecordIds = null;
    const unitRecordId = async (unitId) => {
      if (calibrationEpoch() === 0) return `unit:graph:${unitId}`;
      const ref = state.visual_plan_ref ?? state.parsed_ref;
      invariant(ref, "JOURNAL_SOURCE_NOT_STAGED");
      if (ref !== unitRecordPlanRef) {
        const plan = await readLarge(ref);
        calibrationRecordIds = new Set(plan.calibration.map((item) => item.unit_id));
        unitRecordPlanRef = ref;
      }
      return epochId(`unit:graph:${unitId}`, calibrationRecordIds.has(unitId));
    };
    const readUnitRecord = async (unitId) => readIfPresent(await unitRecordId(unitId));
    const writeUnitRecord = async (unitId, value) => writeOnce(await unitRecordId(unitId), value);
    const hardestStatus = () => {
      applyHardestDailyLimit(state, { now, dailyLimit: hardestLane.daily_limit, newlySent: false });
      return state.hardest_lane;
    };
    const beforeHardestSend = async () => {
      if (!applyHardestDailyLimit(state, { now, dailyLimit: hardestLane.daily_limit })) {
        await save();
        throw new ValidationError("HARDEST_DAILY_LIMIT", { code: "HARDEST_DAILY_LIMIT" });
      }
      await save();
    };
    // The pointer pass's second judge is the hardest tier, which the plan makes Claude. A step that sends hardest-tier
    // calls (the reference step, the challenge set and the measurement) needs the route that serves them to attest a
    // fresh context and the model it ran for each call, as the hardest lane's own check does when the lane is on, so no
    // supposed second judge counts without that evidence. Only the work exchange's hardest tier attests both.
    // The judge itself is the plan's: Claude Opus, the hardest lane's own default and the only model the Codex exchange
    // accepts for that lane when it is on, at one of the lane's efforts (high, which the plan's judge uses since its
    // coverage checks took more than 30 minutes at max, or max). The exchange sends hardest calls with the configured
    // model and effort even when the lane is off, and attests whichever it ran, so the setting is checked here too.
    const pointerHardestJudge = normalizeJournalHardestLaneConfig({});
    const pointerHardestAttested = () => {
      const capabilities = semanticPort.capabilities();
      invariant(capabilities.hardest_fresh_context_per_generate === true
        && capabilities.hardest_authenticated_execution_profile_per_generate === true, "POINTER_HARDEST_ROUTE_UNATTESTED");
      invariant(hardestLane.model === pointerHardestJudge.model && JOURNAL_HARDEST_EFFORTS.includes(hardestLane.effort),
        "POINTER_HARDEST_JUDGE_UNEXPECTED");
    };
    // Which tiers' pointer calls take turns: a direct browser route has one page and takes one call at a time, while the
    // work exchange queues any number for its workers' slots. Hardest-tier calls always reach the exchange.
    const directRoute = route !== null && ![JOURNAL_CODEX_EXCHANGE_PROVIDER, JOURNAL_EXCHANGE_PROVIDER].includes(route.provider);
    const pointerTurns = directRoute ? ["standard"] : [];
    // Those hardest-tier calls, Claude's, count against the hardest lane's daily limit, the lane on or off, but a step
    // that reaches it stops on its own (it resumes with its saved deadline): the import's blocker, which says why the
    // import stopped, stays as it was.
    const pointerBeforeHardestSend = async () => {
      const importBlocker = state.blocker;
      const allowed = applyHardestDailyLimit(state, { now, dailyLimit: hardestLane.daily_limit });
      state.blocker = importBlocker;
      await save();
      if (!allowed) throw new ValidationError("HARDEST_DAILY_LIMIT", { code: "HARDEST_DAILY_LIMIT" });
    };
    const lookaheadSummary = () => {
      const sent = new Set([...lookaheadSent, ...(lookahead?.sentOperationKeys() ?? [])]);
      let used = 0;
      for (const key of sent) if (lookaheadUsed.has(key)) used += 1;
      return { concurrency: semanticConcurrency, sent: sent.size, used,
        unused: sent.size - used, errors: lookaheadErrors + (lookahead?.summary().errors ?? 0) };
    };
    const summary = () => ({ schema_version: 1, stage: state.stage, calibration: state.calibration,
      import_order: state.import_order ?? "legacy_quote_first",
      ...(state.reading_first_counts ? {reading_first:{
        ...structuredClone(state.reading_first_counts),
        status:state.reading_first_counts.pending>0 ? "REVIEW_PENDING" : "SOURCE_SYNTHESIZED"
      }} : {}),
      calibration_epoch: calibrationEpoch(), calibration_history_length: state.calibration_history?.length ?? 0,
      ...(state.calibration_resumes?.length ? { calibration_resume_count: state.calibration_resumes.length } : {}),
      ...(state.calibration_history?.length ? { previous_failure:
        structuredClone(state.calibration_history.at(-1).previous_failure) } : {}),
      ...(state.calibration_failure ? { calibration_failure: structuredClone(state.calibration_failure) } : {}),
      ...(state.calibration_gate ? { calibration_gate: structuredClone(state.calibration_gate) } : {}),
      semantic_disposition: state.semantic_disposition ?? null,
      completed_units: state.completed_units.length, completed_visual_pages: state.completed_visual_pages.length,
      total_units: state.total_units ?? 0, required_visual_pages: state.required_visual_pages ?? 0,
      excluded_visual_pages: (state.excluded_visual_pages ?? []).map(page_number =>
        state.excluded_visual_page_details?.find(item => item.page_number === page_number)
          ?? { page_number, reason: "VISUAL_EXCLUSION_REASON_NOT_RECORDED" }),
      ...(state.semantic_disposition === "archive_only" ? { next_action: state.next_action } : {}),
      completion: structuredClone(state.completion), blocker: state.blocker,
      residuals: structuredClone(state.residuals ?? {}),
      ...(state.quote_index ? { quote_index: { ...structuredClone(state.quote_index.stats), corpus_id: state.quote_index.corpus_id,
        generation: state.quote_index.generation, built_at: state.quote_index.built_at, published_at: state.quote_index.published?.at ?? null,
        ...(state.quote_index.reading_facets ? {reading_facets:structuredClone(state.quote_index.reading_facets)} : {}),
        supersedes: state.quote_index.supersedes ?? null } } : {}),
      ...(state.pointer ? { pointer: pointerSummary() } : {}),
      ...(state.pointer_history?.length ? { pointer_runs_before: state.pointer_history.length } : {}),
      hardest_lane: { ...hardestStatus(), daily_limit: hardestLane.daily_limit }, external_spend_usd: 0,
      lookahead: semanticConcurrency === 1
        ? { concurrency: 1, sent: 0, used: 0, unused: 0 }
        : (lookaheadSupported ? lookaheadSummary() : "unsupported_port") });
    // A pointer step as status shows it: what it did, in counts and page numbers, with its seed as a digest and
    // without the private references its results are stored under.
    const pointerStepSummary = (step) => {
      if (!step) return null;
      const { seed, result_ref: _resultRef, ...rest } = step;
      return { ...structuredClone(rest), ...(seed ? { seed_sha256: hash(seed) } : {}) };
    };
    const pointerSummary = () => {
      const { reference, challenge, pilot, pass, coverage_pass: coveragePass, measure, persisted, rebased, published, ...run } = state.pointer;
      return { ...structuredClone(run), reference: pointerStepSummary(reference), challenge: pointerStepSummary(challenge),
        pilot: pointerStepSummary(pilot), pass: pointerStepSummary(pass),
        coverage_pass: pointerStepSummary(coveragePass), measure: pointerStepSummary(measure),
        persisted: persisted ? { step_id: persisted.step_id, generation: persisted.generation, graph_sha256: persisted.graph_sha256,
          built_at: persisted.built_at } : null,
        // The run's tags built again on the current quote index version (pointer-rebase), without its private references.
        ...(rebased ? { rebased: { step_id: rebased.step_id, generation: rebased.generation, graph_sha256: rebased.graph_sha256,
          built_at: rebased.built_at, dates: structuredClone(rebased.dates ?? null), measure: structuredClone(rebased.measure ?? null) } } : {}),
        published: published ? structuredClone(published) : null };
    };
    const calibrationStopStatus = (reason) => {
      if (["CALIBRATION_REFERENCE_UNRESOLVED", "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED",
        "CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_REPAIR_ATTEMPTS_EXHAUSTED",
        "CALIBRATION_EXTRACTION_ATTEMPTS_EXHAUSTED", "CALIBRATION_SIZE_BOUND_EXCEEDED",
        "CALIBRATION_REFERENCE_MISSED", "CALIBRATION_RECALL_BELOW_TARGET"].includes(reason)) return reason;
      if (["SEMANTIC_PACKET_OVERSIZE", "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND"].includes(reason))
        return "CALIBRATION_SIZE_BOUND_EXCEEDED";
      return "CALIBRATION_REPAIR_REQUIRED";
    };

    async function synchronizeHazards(plan) {
      const pages = new Set([...(config.visual_hazard_pages ?? []), ...(config.parser_hazard_pages ?? [])]);
      if (!pages.size) return plan;
      const previous = JSON.stringify(plan);
      const admitted = new Set(plan.parsed.pages.map(p => p.page_number));
      invariant([...pages].every(p => Number.isSafeInteger(p) && admitted.has(p)), "JOURNAL_HAZARD_PAGE_INVALID");
      plan.visual_pages = [...new Set([...plan.visual_pages, ...pages])].sort((a,b) => a-b);
      for (const unit of plan.units) if (pages.has(unit.page_number)) {
        unit.hazard_types = [...new Set([...unit.hazard_types, "declared_source_hazard"])];
      }
      plan.calibration = nativeCalibration(plan.units);
      if (JSON.stringify(plan) !== previous) {
        invariant(!state.visual_plan_ref && !state.graph_ref, "JOURNAL_HAZARD_PLAN_ALREADY_CONSUMED");
        state.plan_revisions ??= [];
        state.plan_revisions.push(state.parsed_ref);
        state.parsed_ref = await writeLarge(`intake:plan:${randomUUID()}`, plan);
        state.required_visual_pages = plan.visual_pages.length;
        await save();
      }
      return plan;
    }

    async function stage() {
      if (state.parsed_ref) {
        const saved = await readLarge(state.parsed_ref);
        invariant(saved.parsed.source.sha256 === config.source.sha256
          && saved.parsed.source.byte_length === config.source.bytes, "JOURNAL_CHECKPOINT_SOURCE_MISMATCH");
        for (const representation of saved.parsed.representations) verifyRepresentationCoverage(
          representation.text, saved.units.filter((unit) => unit.representation_id === representation.representation_id));
        await synchronizeHazards(saved);
        await ensureRawSearch(); return summary();
      }
      await authorize();
      const original = await readIfPresent("intake:original");
      if (!original) {
        // Archived from bytes checked before anything is written, not by reopening the path, so a
        // source replaced since startup is never stored as the original; restoring it lets a later
        // run continue.
        const verified = await readVerifiedSource();
        try {
          const reference = await store.writeChunkedOriginal({ objectId: "original:source", bytes: verified });
          await store.writeJsonObject({ objectId: "intake:original", value: reference });
        } finally { verified.fill(0); }
      }
      state.original = await store.readJsonObject({ objectId: "intake:original" });
      // The parser reads the authenticated archive, checked against the configured digest, never
      // the source path.
      const archivedBytes = await store.reassembleOriginal(state.original);
      let parsed;
      try {
        invariant(archivedBytes.length === config.source.bytes && hash(archivedBytes) === config.source.sha256, "ORIGINAL_REASSEMBLY_MISMATCH");
        parsed = await sourceParser({ inputBytes: archivedBytes, format: sourceFormatForPath(sourcePath), timeoutMs: 240_000, memoryLimitMb: 1024 });
      } finally { archivedBytes.fill(0); }
      invariant(parsed.source.sha256 === config.source.sha256, "PARSED_SOURCE_BINDING_MISMATCH");
      const units = [];
      for (const representation of parsed.representations) {
        const page = parsed.pages.find((p) => p.representation_id === representation.representation_id);
        const partition = partitionRepresentation({ representationId: representation.representation_id, text: representation.text });
        verifyRepresentationCoverage(representation.text, partition);
        for (const unit of partition) units.push({ ...unit, source_order: units.length, page_number: page?.page_number ?? null, hazard_types: page?.warnings ?? [] });
      }
      const explicitHazards = new Set(config.visual_hazard_pages ?? []);
      const visualPages = parsed.pages.filter((p) => p.disposition !== "readable" || p.image_inventory?.length || explicitHazards.has(p.page_number)).map((p) => p.page_number);
      const plan = { parsed, units, visual_pages: visualPages, calibration: nativeCalibration(units), parser_version: parsed.parser.version };
      state.parsed_ref = await writeLarge(`intake:plan:${randomUUID()}`, plan);
      state.total_units = units.length; state.required_visual_pages = visualPages.length;
      state.completion.archive_verified = "pass";
      state.stage = "PARTITION"; state.blocker = null; await save(); await synchronizeHazards(plan); await ensureRawSearch(); return summary();
    }

    async function ensureRawSearch() {
      if (state.raw_persisted) return;
      const plan = await readLarge(state.parsed_ref);
      const nodes = [], edges = [];
      const generation = `${state.generation}:raw`;
      for (const representation of plan.parsed.representations) {
        const units = plan.units.filter(u => u.representation_id === representation.representation_id);
        const page = plan.parsed.pages.find(p => p.representation_id === representation.representation_id);
        const empty = { schema_version: "1.0", status: "incomplete", assertions: [], entities: [], episodes: [], coverage: units.map(u => ({ unit_id: u.unit_id, disposition: "pending", assertion_local_ids: [], reason: "Semantic processing has not completed." })), requested_context: [] };
        const graph = adaptExtractionToGraph({ caseId, corpusId: state.corpus_id, generation, source: { id: `source:${hash(representation.representation_id).slice(0, 32)}`, representation_id: representation.representation_id, original_object_id: state.original.object_id, media_type: plan.parsed.source.mime_type, byte_length: representation.utf8_byte_length, parse_status: parseStatus(page, plan.parsed.source.mime_type), page: page?.page_number ?? null }, units, extraction: empty, producerRef: "mechanical-source-index" });
        nodes.push(...graph.nodes); edges.push(...graph.edges);
      }
      const graph = { schema_version: "1.0", case_id: caseId, corpus_id: state.corpus_id, generation, nodes, edges };
      state.raw_persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: Object.fromEntries(plan.parsed.representations.map(r => [r.representation_id, r.text])), archiveReferences: [state.original] });
      state.completion.raw_search_available = "pass"; await save();
    }

    // Set when work() returns null because its job can never answer (the output stayed invalid
    // through every retry the job allows), as opposed to a pause the next run may resolve.
    let workExhausted = false;
    const resolveWorkPacketInput = async (input) => {
      const image = input?.page_image_ref;
      if (image?.kind !== "chunked_image") return input;
      const bytes = await store.reassembleOriginal(image.object_ref);
      try {
        invariant(hash(bytes) === image.sha256 && bytes.length === image.byte_length, "VISUAL_IMAGE_DIGEST_MISMATCH");
        return { ...input, page_image_ref: { kind: "inline_image", media_type: image.media_type,
          data_base64: bytes.toString("base64"), sha256: image.sha256 } };
      } finally { bytes.fill(0); }
    };
    const workDefinitionsFor = (request, prepared) => [{
      key: request.role, stage: request.stage, role: request.role, tier: request.tier ?? "standard",
      identity: prepared.identity, assigned_core_ids: prepared.assignedCoreIds,
      source_locators: prepared.sourceLocators, packet_input: request.packetInput
    }, ...(request.dependencies ?? []).map(item => ({ ...item, tier: request.tier ?? "standard" }))];
    const referencePacketFor = (request, prepared) => buildJournalRolePacket(request.role, {
      protocol_version: "1.0", output_schema_id: JOURNAL_ROLE_DEFINITIONS[request.role].outputSchema,
      assigned_core_ids: prepared.assignedCoreIds, source_locators: prepared.sourceLocators,
      expected_generation: state.generation, controller_provenance_tag: prepared.jobId,
      grant_purpose: grant.purpose, ...request.packetInput
    });
    const createRunLookahead = () => lookaheadSupported
      ? createJournalLookahead({ limit: semanticConcurrency, port: semanticPort, authorize,
        grant, pollMs: semanticPort.pollMs ?? 5_000,
        prepare: async (descriptor) => {
          const planned = descriptor.build ? await descriptor.build() : descriptor;
          if (!planned) return null;
          const request = planned.request;
          if (request.tier === "hardest") return null;
          const prepared = journalWorkPlan(request);
          if (request.stage === "REFERENCE_AUDIT") {
            if (await readIfPresent(`reference:result:${prepared.jobId}`)
              || await readIfPresent(`reference:failure:${prepared.jobId}:1`)
              || await readIfPresent(`reference:failure:${prepared.jobId}:2`)
              || await readIfPresent(`reference:completion-unknown:${prepared.jobId}`)) return null;
            return { direct: { role: request.role, packet: referencePacketFor(request, prepared),
              outputSchema: JOURNAL_ROLE_DEFINITIONS[request.role].outputSchema,
              operationKey: prepared.jobId }, next: planned.next };
          }
          const ledger = createCorpusJournalJobLedger({ corpusStore: store, jobId: prepared.jobId });
          const existing = await ledger.load();
          const snapshot = existing?.snapshot ?? buildJournalJobSnapshot({
            jobId: prepared.jobId, caseId, corpusId: state.corpus_id, generation: state.generation,
            workDefinitions: workDefinitionsFor(request, prepared), controllerSecret: key, grant,
            promptVersion: `1.0:${hash(prepared.jobId).slice(0, 24)}`,
            modelProfile: route?.model ?? "synthetic"
          });
          return { snapshot, resolvePacketInput: resolveWorkPacketInput };
        } }) : null;
    // Set with workExhausted when the job's primary item had already completed, so a refusal that came
    // from a dependent item (for example, its packet grew too large) still counts the primary call.
    let workPrimaryCompleted = false;
    let incompleteWorkResults = null;
    async function work({ id, role, stage: workStage, unit = null, units = null, packetInput, tier = "standard",
      identityPacketInput = packetInput, dependencies = [], acceptReviewFindings = false }) {
      workExhausted = false;
      workPrimaryCompleted = false;
      incompleteWorkResults = null;
      await authorize();
      const { jobId, scopeUnits, assignedCoreIds, sourceLocators, identity } = journalWorkPlan({
        id, role, stage: workStage, unit, units, packetInput, identityPacketInput, dependencies, tier
      });
      if (tier === "hardest" && !hardestJournalRequestFits({ role, units: scopeUnits, packetInput }, state.generation, grant.purpose)) {
        state.stage = workStage; state.blocker = "JOURNAL_WORK_PACKET_TOO_LARGE";
        workExhausted = true; await save(); return null;
      }
      id = jobId;
      if (workStage === "REFERENCE_AUDIT") {
        const resultId = `reference:result:${id}`;
        const cached = await readIfPresent(resultId);
        if (cached) return [cached];
        const firstFailure = await readIfPresent(`reference:failure:${id}:1`);
        const secondFailure = await readIfPresent(`reference:failure:${id}:2`);
        if (secondFailure) {
          state.stage = workStage; state.blocker = "INVALID_STRUCTURED_OUTPUT"; workExhausted = true; await save(); return null;
        }
        const baseKey = firstFailure ? `${id}:reserialize` : id;
        let operationKey = baseKey;
        // An earlier run left this call open. Ask the port before blocking: a connector answer may
        // have arrived since, and a call that is definitely unanswered is sent again under a new key.
        for (let resend = 1; await readIfPresent(`reference:completion-unknown:${operationKey}`); resend += 1) {
          const completion = await port.getCompletion(operationKey, { tier });
          if (completion.status === "completed") {
            const recovered = { output: completion.output, receipt: completion.receipt };
            await writeOnce(resultId, recovered);
            state.blocker = null; await save();
            return [recovered];
          }
          if (completion.status === "exhausted") {
            state.stage = workStage; state.blocker = completion.code;
            workExhausted = true; await save(); return null;
          }
          if (completion.status === "invalid_output") {
            const attempt = firstFailure ? 2 : 1;
            await writeOnce(`reference:failure:${id}:${attempt}`, { status: "invalid_output", operation_key: operationKey, attempt });
            state.stage = workStage; state.blocker = "INVALID_STRUCTURED_OUTPUT"; await save(); return null;
          }
          // An authoritative port can safely wait on this exact operation key: invoke() resumes the
          // existing submission instead of sending a duplicate. The completion check above is only
          // a snapshot, so an answer may arrive immediately after it reports unknown.
          if (completion.status === "unknown" && await port.isAuthoritativeCompletion(operationKey)) break;
          if (completion.status === "not_submitted" && resend > 2) {
            state.stage = workStage; state.blocker = "REFERENCE_RESEND_EXHAUSTED";
            workExhausted = true; await save(); return null;
          }
          if (completion.status !== "not_submitted") {
            state.stage = workStage; state.blocker = "COMPLETION_UNKNOWN"; await save(); return null;
          }
          operationKey = `${baseKey}:resend:${resend}`;
        }
        let result;
        try {
          if (tier === "hardest") {
            // A crash may leave the durable intent without this direct path's result marker. Recover
            // or resume that intent before charging a slot; only a confirmed-new send consumes one.
            const completion = await port.getCompletion(operationKey, { tier });
            if (completion.status === "completed") {
              const recovered = { output: completion.output, receipt: completion.receipt };
              await writeOnce(resultId, recovered);
              state.blocker = null; await save();
              return [recovered];
            }
            if (completion.status === "exhausted") {
              state.stage = workStage; state.blocker = completion.code;
              workExhausted = true; await save(); return null;
            }
            try { if (completion.status === "not_submitted") await beforeHardestSend(); }
            catch (error) { if (error?.code === "HARDEST_DAILY_LIMIT") return null; throw error; }
          }
          result = await port.invoke({ role, packet: referencePacketFor({ role, packetInput }, { jobId: id, assignedCoreIds, sourceLocators }),
            outputSchema: JOURNAL_ROLE_DEFINITIONS[role].outputSchema, operationKey, grant,
          ...(tier === "hardest" ? { tier } : {}) });
        } catch (error) {
          if (error.submissionStatus === "exhausted") {
            state.stage = workStage; state.blocker = error.code;
            workExhausted = true; await save(); return null;
          }
          if (error.code === "INVALID_STRUCTURED_OUTPUT" && error.submissionStatus === "completed_invalid") {
            const attempt = firstFailure ? 2 : 1;
            await writeOnce(`reference:failure:${id}:${attempt}`, { status: "invalid_output", operation_key: operationKey, attempt });
            state.stage = workStage; state.blocker = "INVALID_STRUCTURED_OUTPUT"; workExhausted = attempt === 2; await save(); return null;
          }
          if (error.code === "COMPLETION_UNKNOWN") {
            await writeOnce(`reference:completion-unknown:${operationKey}`, { status: "completion_unknown", operation_key: operationKey });
            state.stage = workStage; state.blocker = "COMPLETION_UNKNOWN"; await save(); return null;
          }
          // Definitely never answered (an exchange item that expired): record it as open, so the next
          // run confirms that through the port and sends the call again under a fresh key.
          if (error.submissionStatus === "not_submitted" && await port.isAuthoritativeCompletion(operationKey)) {
            await writeOnce(`reference:completion-unknown:${operationKey}`, { status: "not_submitted", operation_key: operationKey });
            state.stage = workStage; state.blocker = error.code ?? "INFERENCE_NOT_SUBMITTED"; await save(); return null;
          }
          throw error;
        }
        await writeOnce(resultId, result);
        state.blocker = null; await save();
        return [result];
      }
      const ledger = createCorpusJournalJobLedger({ corpusStore: store, jobId: id });
      const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: key, grant,
        promptVersion: `1.0:${hash(id).slice(0, 24)}`, modelProfile: route?.model ?? "synthetic",
        beforeInvoke: async ({ work: pendingWork, resumed = false }) => {
          await authorize();
          // A resumed call was charged its hardest slot before its intent was recorded.
          if (pendingWork.tier === "hardest" && !resumed) await beforeHardestSend();
        },
        resolvePacketInput: resolveWorkPacketInput });
      try {
        if (!(await ledger.load())) await controller.initialize({ jobId: id, caseId, corpusId: state.corpus_id, generation: state.generation,
          workDefinitions: workDefinitionsFor({ role, stage: workStage, tier, packetInput, dependencies },
            { identity, assignedCoreIds, sourceLocators }) });
        let entry;
        try { entry = await controller.runUntilBlocked({ maximumSteps: 8 }); }
        catch (error) { if (error?.code === "HARDEST_DAILY_LIMIT") return null; throw error; }
        const unfinished = entry.snapshot.work_items.find((item) => item.status !== "completed");
        // A primary output that asks for smaller windows or more context parks its job, and its
        // reviewers never run. The caller repairs or splits such a batch, so it is handed back
        // rather than stopping the run for good.
        const [primary] = entry.snapshot.work_items;
        const parked = acceptReviewFindings && primary?.status === "needs_context" && primary.output && primary.receipt;
        if (unfinished && !parked && !(acceptReviewFindings && entry.snapshot.work_items.every(item => item.output && item.receipt))) {
          incompleteWorkResults = entry.snapshot.work_items.map((item) => ({ output: item.output ?? null, receipt: item.receipt ?? null }));
          state.stage = unfinished.stage; state.blocker = entry.snapshot.checkpoint.blocked_reason ?? "OUTPUT_INCOMPLETE";
          workExhausted = unfinished.status === "blocked_authority"
            && ["INVALID_STRUCTURED_OUTPUT", "JOURNAL_WORK_PACKET_TOO_LARGE", "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED"].includes(state.blocker);
          workPrimaryCompleted = primary?.status === "completed";
          await save();
          return null;
        }
        return entry.snapshot.work_items.map((item) => ({ output: item.output ?? null, receipt: item.receipt ?? null }));
      } finally { controller.close(); }
    }

    const CHECKED_ATTEMPTS = 3;
    const checkFailure = (check, value) => {
      try { check(value); return null; }
      catch (error) {
        if (error instanceof ValidationError) return error.code ?? "WORK_OUTPUT_INVALID";
        throw error;
      }
    };
    async function recordHardestOutcome(id, outcome) {
      state.hardest_outcomes ??= {};
      if (state.hardest_outcomes[id]) return;
      state.hardest_outcomes[id] = outcome;
      state.residuals = { ...(state.residuals ?? {}),
        hardest_attempted: (state.residuals?.hardest_attempted ?? 0) + 1,
        hardest_resolved: (state.residuals?.hardest_resolved ?? 0) + (outcome === "resolved" ? 1 : 0) };
      await save();
    }
    // A work result is used only once it passes its check. Each attempt has its own ID, so a rerun
    // replays the stored attempts in order, neither using a failed one nor sending it again. After
    // the last attempt the caller decides what the unresolved step means for its stage, instead of
    // the same stored answer failing the same check on every run.
    async function checkedWork(request, check = () => {}) {
      let failure = null;
      for (let attempt = 1; attempt <= CHECKED_ATTEMPTS; attempt += 1) {
        const result = await work({ ...request, id: attempt === 1 ? request.id : derivedId(request.id, `attempt:${attempt}`) });
        if (!result) {
          // A job that can never answer is a failed attempt. Any other stop (quota, an unknown
          // completion, revocation, a first invalid answer the job will retry) pauses the run.
          if (!workExhausted) return { blocked: true };
          failure = state.blocker;
          state.blocker = null;
          if (failure === "REFERENCE_RESEND_EXHAUSTED") return { failure };
          continue;
        }
        failure = checkFailure(check, result);
        if (!failure) return { result };
      }
      if (!hardestLane.enabled) return { failure };
      if (port.capabilities?.().hardest_roles?.[request.role]?.available === false) {
        return { failure, hardest: "not_attempted" };
      }
      if (!hardestJournalRequestFits(request, state.generation, grant.purpose)) {
        return { failure: "JOURNAL_WORK_PACKET_TOO_LARGE", hardest: "not_attempted" };
      }
      const result = await work({ ...request, id: derivedId(request.id, "hardest"), tier: "hardest" });
      if (!result) {
        if (!workExhausted) return { blocked: true };
        const terminal = state.blocker ?? failure;
        await recordHardestOutcome(request.id, "failed");
        state.blocker = null;
        await save();
        return { failure: terminal, hardest: "failed" };
      }
      const hardestFailure = checkFailure(check, result);
      await recordHardestOutcome(request.id, hardestFailure ? "failed" : "resolved");
      return hardestFailure ? { failure: hardestFailure, hardest: "failed" } : { result, hardest: "resolved" };
    }

    async function runBatched(plan) {
      const batching = config.semantic_batching ?? {};
      const maximumBytes = batching.maximum_bytes ?? 32_000;
      const maximumUnits = batching.maximum_units ?? 4;
      const calibrationBytes = batching.calibration_maximum_bytes ?? maximumBytes;
      const calibrationUnits = batching.calibration_maximum_units ?? 1;
      invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 4096
        && Number.isSafeInteger(calibrationBytes) && calibrationBytes >= 4096,
        "SEMANTIC_BATCH_BYTES_INVALID");
      invariant(Number.isSafeInteger(maximumUnits) && maximumUnits >= 1
        && Number.isSafeInteger(calibrationUnits) && calibrationUnits >= 1,
        "SEMANTIC_BATCH_COUNT_INVALID");
      const nativeUnits = plan.units.filter((unit) => !unit.visual);
      const calibrationIds = new Set(plan.calibration.map((item) => item.unit_id));
      const unitById = new Map(plan.units.map((unit) => [unit.unit_id, unit]));
      const oversizedUnits = plan.units.filter(unit => journalSemanticUnitCost(unit) >
        (calibrationIds.has(unit.unit_id) ? calibrationBytes : maximumBytes));
      const oversizedIds = new Set(oversizedUnits.map(unit => unit.unit_id));
      let frozenPlan;
      if (state.semantic_batch_plan_ref) {
        frozenPlan = await readLarge(state.semantic_batch_plan_ref);
      } else {
        invariant(state.completed_units.length === 0, "JOURNAL_LEGACY_SEMANTIC_MIGRATION_REQUIRED");
        const calibrationUnitsInOrder = plan.units.filter((unit) => calibrationIds.has(unit.unit_id) && !oversizedIds.has(unit.unit_id));
        const regularUnitsInOrder = plan.units.filter((unit) => !calibrationIds.has(unit.unit_id) && !oversizedIds.has(unit.unit_id));
        frozenPlan = {
          schema_version: 1,
          source_unit_ids: plan.units.map((unit) => unit.unit_id),
          source_only_unit_ids: [...oversizedIds],
          calibration_batches: calibrationUnitsInOrder.length
            ? createJournalSemanticBatches({ units: calibrationUnitsInOrder, maximumBytes: calibrationBytes, maximumUnits: calibrationUnits })
              .map((batch) => batch.unit_ids) : [],
          regular_batches: regularUnitsInOrder.length
            ? createJournalSemanticBatches({ units: regularUnitsInOrder, maximumBytes, maximumUnits })
              .map((batch) => batch.unit_ids) : [],
          bounds: { maximumBytes, maximumUnits, calibrationBytes, calibrationUnits }
        };
        state.semantic_batch_plan_ref = await writeLarge(`semantic:batch-plan:${randomUUID()}`, frozenPlan);
        await save();
      }
      invariant(frozenPlan.schema_version === 1
        && JSON.stringify(frozenPlan.source_unit_ids) === JSON.stringify(plan.units.map((unit) => unit.unit_id))
        && JSON.stringify(frozenPlan.source_only_unit_ids ?? []) === JSON.stringify([...oversizedIds])
        && [...frozenPlan.calibration_batches, ...frozenPlan.regular_batches]
          .flat().join("\0") === plan.units
          .filter((unit) => calibrationIds.has(unit.unit_id) && !oversizedIds.has(unit.unit_id)).concat(
            plan.units.filter((unit) => !calibrationIds.has(unit.unit_id) && !oversizedIds.has(unit.unit_id)))
          .map((unit) => unit.unit_id).join("\0"),
        "JOURNAL_SEMANTIC_BATCH_PLAN_MISMATCH");
      if (state.visual_handoff_ready?.status === "ready") {
        invariant(JSON.stringify(state.visual_handoff_ready.visual_plan_ref) === JSON.stringify(state.visual_plan_ref),
          "JOURNAL_VISUAL_HANDOFF_PLAN_MISMATCH");
        state.visual_handoff_ready.status = "consumed";
        state.visual_handoff_ready.semantic_batch_plan_ref = state.semantic_batch_plan_ref;
        state.next_action = "Continue the frozen source-first semantic batch plan.";
        await save();
      }
      const frozenUnits = (ids) => ids.map((id) => {
        const unit = unitById.get(id);
        invariant(unit, "JOURNAL_SEMANTIC_BATCH_PLAN_MISMATCH");
        return unit;
      });
      const bounded = (text, side, limit = 8000) => {
        const characters = [...text];
        let size = 0;
        const result = [];
        for (const character of side === "before" ? characters.reverse() : characters) {
          const bytes = Buffer.byteLength(character);
          if (size + bytes > limit) break;
          size += bytes;
          result.push(character);
        }
        return (side === "before" ? result.reverse() : result).join("");
      };
      const nativeIndexFor = (unit) => unit.visual
        ? nativeUnits.findIndex((item) => item.page_number >= unit.page_number)
        : nativeUnits.indexOf(unit);
      const neighborsFor = (unit) => {
        const index = nativeIndexFor(unit);
        const before = bounded(nativeUnits[(index < 0 ? nativeUnits.length : index) - 1]?.text ?? "", "before");
        const after = bounded(nativeUnits[unit.visual ? index : index + 1]?.text ?? "", "after");
        return { unit_id: unit.unit_id, before: unit.context.before || before, after: unit.context.after || after };
      };
      // The source text beside a unit in reading order, up to a bound: first the rest of its own representation (a
      // visual unit's other transcription chunks), then native units across unit and page boundaries. Units of one
      // representation join exactly and a change of representation is a blank line. It is context only: anchors
      // still come from core units.
      const expandedWindow = (unit, side, limit) => {
        const own = unit.visual ? plan.units.filter((item) => item.representation_id === unit.representation_id) : [];
        const position = own.indexOf(unit);
        const index = nativeIndexFor(unit);
        const start = index < 0 ? nativeUnits.length : index;
        const sequence = side === "before"
          ? [...own.slice(0, Math.max(position, 0)).reverse(), ...nativeUnits.slice(0, start).reverse()]
          : [...own.slice(position + 1), ...nativeUnits.slice(unit.visual ? start : index + 1)];
        const parts = [];
        let size = 0, previous = null;
        for (const item of sequence) {
          if (size >= limit) break;
          const gap = previous && previous.representation_id !== item.representation_id ? "\n\n" : "";
          parts.push(side === "before" ? `${item.text}${gap}` : `${gap}${item.text}`);
          size += Buffer.byteLength(item.text) + gap.length;
          previous = item;
        }
        if (side === "before") parts.reverse();
        return bounded(parts.join(""), side, limit);
      };
      const visualEntriesFor = async (pageNumbers) => {
        const entries = [];
        for (const pageNumber of new Set(pageNumbers.filter((page) => Number.isSafeInteger(page) && page >= 1))) {
          const visual = await readIfPresent(`visual:result:${pageNumber}`);
          if (visual?.output) entries.push({ page_number: pageNumber, output: visual.output });
        }
        return entries;
      };
      const batchKey = (units) => hash(units.map((unit) => unit.unit_id).join("\0")).slice(0, 40);
      // This composite identity names a packet; locators bind its original ranges.
      const identityFor = (units) => units.length === 1
        ? { source_representation: units[0].representation_id,
            core_range: { start_byte: units[0].start_byte, end_byte: units[0].end_byte } }
        : { source_representation: `batch:${batchKey(units)}`,
            core_range: { start_byte: 0,
              end_byte: units.reduce((total, unit) => total + Math.max(0, unit.end_byte - unit.start_byte), 0) } };
      const locatorsFor = (units) => units.map((unit) => ({
        representation_id: unit.representation_id,
        page: unit.page_number ?? null,
        start_byte: unit.start_byte,
        end_byte: unit.end_byte
      }));
      // One extraction request (the extractor with its omission check), shared by processBatch and the
      // lookahead so both compute the same request and job ID.
      const extractionRequestFor = ({ id, units, core, adjacentContext, visualContext, repairRequest = null,
        tier = "standard" }) => ({
        id, ...(tier === "hardest" ? { tier } : {}),
        role: "extractor", stage: "EXTRACT", units,
        packetInput: {
          core_units: core,
          adjacent_context: adjacentContext,
          visual_transcriptions: visualContext,
          ...(repairRequest ? { repair_request: repairRequest } : {})
        },
        dependencies: [{
          key: "omission",
          stage: "OMISSION_CHECK",
          role: "omission_checker",
          identity: identityFor(units),
          assigned_core_ids: units.map((unit) => unit.unit_id),
          source_locators: locatorsFor(units),
          packet_input: {
            core_units: core,
            adjacent_context: adjacentContext,
            // The review sees the visual transcriptions the extractor saw, including supplied neighbours.
            ...(visualContext.length ? { visual_transcriptions: visualContext } : {}),
            candidate_extraction: { $work_output: "extractor" },
            target_generation: state.generation
          }
        }],
        acceptReviewFindings: true
      });
      // A calibration batch's frozen reference reading, shared by processBatch and the lookahead.
      const calibrationReferenceRequestFor = ({ units, core, adjacentContext, visualContext }) => ({
        id: epochId(`reference:calibration:batch:${batchKey(units)}`, true),
        role: "reference_reader",
        stage: "REFERENCE_AUDIT",
        units,
        packetInput: { source_windows: core, adjacent_context: adjacentContext, visual_context: visualContext, neutral_reading_instructions: [] }
      });
      // A batch's first packet material, as processBatch computes it before any context is answered; null when
      // the batch is over the source bound and will be split or kept source-only instead.
      const initialBatchContext = async (ids) => {
        const units = frozenUnits(ids);
        const core = units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text }));
        const adjacentContext = { by_unit: units.map(neighborsFor) };
        const visualContext = (await visualEntriesFor(units.map((unit) => unit.page_number))).map((entry) => entry.output);
        if (Buffer.byteLength(JSON.stringify({ core_units: core, adjacent_context: adjacentContext,
          visual_transcriptions: visualContext })) > SEMANTIC_PACKET_BYTES) return null;
        return { units, core, adjacentContext, visualContext };
      };
      const firstExtractionDescriptor = async (ids, calibration) => {
        const context = await initialBatchContext(ids);
        if (!context) return null;
        const request = extractionRequestFor({ ...context,
          id: epochId(`extract:batch:${batchKey(context.units)}:cycle:0`, calibration) });
        return { jobId: journalJobId(request), request };
      };
      const initialExtractionDescriptor = (ids) => firstExtractionDescriptor(ids, false);
      // Calibration units are independent of one another, and a round now runs every one of them, so each
      // upcoming unit's reference reading and first extraction can be sent early. Repairs, audits and
      // hardest-tier calls stay sequential.
      const calibrationDescriptors = (ids) => {
        const key = hash(ids.join("\0"));
        return [
          { jobId: `lookahead:calibration-reference:${key}`, build: async () => {
            const context = await initialBatchContext(ids);
            if (!context) return null;
            const request = calibrationReferenceRequestFor(context);
            return { jobId: journalJobId(request), request };
          } },
          { jobId: `lookahead:calibration-extract:${key}`, build: () => firstExtractionDescriptor(ids, true) }
        ];
      };
      const mergeGraphs = (graphs) => {
        const nodes = new Map(), edges = new Map();
        for (const graph of graphs) {
          for (const node of graph.nodes) {
            if (nodes.has(node.id)) invariant(JSON.stringify(nodes.get(node.id)) === JSON.stringify(node), "GRAPH_ASSEMBLY_ID_COLLISION");
            nodes.set(node.id, node);
          }
          for (const edge of graph.edges) {
            invariant(!edges.has(edge.id), "GRAPH_ASSEMBLY_ID_COLLISION");
            edges.set(edge.id, edge);
          }
        }
        return { schema_version: "1.0", case_id: caseId, corpus_id: state.corpus_id, generation: state.generation,
          nodes: [...nodes.values()], edges: [...edges.values()] };
      };
      const bindUnitExtraction = (unit, extraction, receipt) => {
        const representation = plan.parsed.representations.find((item) => item.representation_id === unit.representation_id);
        invariant(representation, "JOURNAL_REPRESENTATION_MISSING");
        const graph = adaptExtractionToGraph({
          caseId,
          corpusId: state.corpus_id,
          generation: state.generation,
          source: {
            id: `source:${hash(unit.representation_id).slice(0, 32)}`,
            representation_id: unit.representation_id,
            original_object_id: representation.visual_image?.object_id ?? state.original.object_id,
            media_type: unit.visual ? "image/png" : plan.parsed.source.mime_type,
            byte_length: representation.utf8_byte_length,
            parse_status: unit.visual ? "readable" : parseStatus(plan.parsed.pages.find(page =>
              page.representation_id === unit.representation_id), plan.parsed.source.mime_type),
            page: unit.page_number,
            ...(unit.visual ? { locator_kind: "visual_transcript", interpretation_status: "provisional" } : {})
          },
          units: [unit],
          extraction,
          producerRef: receipt.receipt_id,
          localIdNamespace: unit.unit_id
        });
        validateJournalGraph(graph, { [unit.representation_id]: representation.text });
        return graph;
      };
      const recordSourceOnly = async (unit, reason, detail = null, diagnostics = unresolvedExtractionDiagnostics([]), extra = {}) => {
        const sourceOnlyExtraction = { schema_version: "1.0", status: "incomplete", assertions: [], entities: [], episodes: [],
          coverage: [{ unit_id: unit.unit_id, disposition: "needs_review", assertion_local_ids: [],
            reason: `Semantic processing ended for this unit (${reason}); the archived source remains available.` }],
          requested_context: [] };
        const graph = bindUnitExtraction(unit, sourceOnlyExtraction, { receipt_id: `mechanical:source-only:${unit.unit_id}` });
        await writeUnitRecord(unit.unit_id, { graph, extraction: null, omission: null,
          source_only_unresolved: true, source_only_reason: reason,
          diagnostics,
          ...(detail === null ? {} : { source_only_detail: detail }), ...extra });
        if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
        state.stage = "EXTRACT"; state.blocker = null; await save();
        return true;
      };
      const setCalibrationStop = async (unitId, status, reason, diagnostics, details = {}) => {
        state.calibration = "failed";
        state.calibration_failure = { unit_id: unitId, status, reason,
          ...(diagnostics ? { diagnostics } : {}), ...details };
        delete state.calibration_round_failures;
        state.stage = "REFERENCE_AUDIT";
        state.blocker = status;
        await save();
        return false;
      };
      // A failed calibration unit is kept as source-only with its reason and counts, and calibration goes on to
      // the next unit. The round is judged on pooled totals when it ends: recall across every scored batch must
      // meet the target, critical reference items missed must stay within the limit (none unless the run config
      // allows some), and every unit must have been scored against a frozen reference. A critical miss past the
      // limit or an unscored unit ends the round at once, since it can't pass, and an optional failure limit can
      // end it sooner.
      const failureLimit = calibrationFailureLimit;
      let calibrationFailures = 0, calibrationCriticalMisses = 0, calibrationUnscored = 0;
      const calibrationRoundOver = () => calibrationCriticalMisses > calibrationCriticalMissLimit
        || calibrationUnscored > 0 || (failureLimit !== null && calibrationFailures >= failureLimit);
      // `calibrationCounts` is the batch's reference result when it has a frozen reference: a source-only batch
      // keeps none of its reference items. Without one (an oversized unit, or a reference that never quoted its
      // source) the unit is unscored.
      const failCalibrationUnit = async (unit, status, reason, diagnostics = unresolvedExtractionDiagnostics([]), calibrationCounts = null) => {
        // Visible in the checkpoint while the round continues. The gate's record is rebuilt from the unit
        // records when the round ends.
        state.calibration_round_failures = [...(state.calibration_round_failures ?? [])
          .filter((item) => item.unit_id !== unit.unit_id), { unit_id: unit.unit_id, status, reason, diagnostics }];
        await recordSourceOnly(unit, status, reason, diagnostics,
          calibrationCounts ? { calibration: { ...calibrationCounts, outcome: "fail" } } : {});
        calibrationFailures += 1;
        if (calibrationCounts) calibrationCriticalMisses += calibrationCounts.critical_miss_count;
        else calibrationUnscored += 1;
        return true;
      };
      const processBatch = async (incoming, calibration = false) => {
        // Reuse the frozen scope even when a crash occurred between writing two
        // unit records. The completed job and its receipt keep the same identity.
        const units = incoming;
        if (units.every((unit) => state.completed_units.includes(unit.unit_id))) return true;
        // Once the round can't pass or reaches an optional failure limit it ends: this batch, or the rest of a
        // split one, waits for the next round.
        if (calibration && calibrationRoundOver()) return true;
        const cycles = [];
        let hardestDiagnostics = null;
        let reauditDiagnostics = null, hardestFidelityDiagnostics = null, criticalConfirmation = null;
        const fidelityCycles = [];
        const diagnostics = () => unresolvedExtractionDiagnostics(cycles, hardestDiagnostics, fidelityCycles,
          reauditDiagnostics, hardestFidelityDiagnostics, criticalConfirmation);
        const halves = async () => {
          const middle = Math.ceil(units.length / 2);
          return await processBatch(units.slice(0, middle), calibration)
            && await processBatch(units.slice(middle), calibration);
        };
        const keyId = batchKey(units);
        const unitIds = units.map((unit) => unit.unit_id);
        let reference = null;
        // A calibration batch that ends source-only keeps none of its frozen reference items.
        const sourceOnlyCounts = () => reference ? { batch: keyId, ...sourceOnlyCalibrationCounts(reference.output) } : null;
        const finishExhausted = async (reason) => {
          if (!workExhausted) return false;
          if (units.length > 1) return halves();
          return calibration
            ? failCalibrationUnit(units[0], reason.startsWith("CALIBRATION_")
              ? reason : "CALIBRATION_EXTRACTION_ATTEMPTS_EXHAUSTED", reason, diagnostics(), sourceOnlyCounts())
            : recordSourceOnly(units[0], reason, null, diagnostics());
        };
        // The graph ID the fidelity auditor sees for an extraction item, as bindUnitExtraction binds it.
        const nodeTarget = (kind, localId, ids) => journalLocalNodeId({ caseId, corpusId: state.corpus_id,
          generation: state.generation, localIdNamespace: ids[0] ?? "", kind, localId });
        // The omission review that counts for a repaired extraction: scoped to what the repair could affect.
        // `prior` is the extraction the repair started from and the review that counted for it.
        const scopedOmission = (outcome, prior) => prior
          ? scopeReviewAfterRepair({ review: outcome?.[1]?.output ?? null, previousReview: prior.review,
            previousExtraction: prior.extraction, extraction: outcome?.[0]?.output ?? null, unitIds })
          : { review: outcome?.[1]?.output ?? null, scope: null };
        const core = units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text }));
        let adjacentContext = { by_unit: units.map(neighborsFor) };
        const visualEntries = await visualEntriesFor(units.map((unit) => unit.page_number));
        let visualContext = visualEntries.map((entry) => entry.output);
        let visualPages = new Set(visualEntries.map((entry) => entry.page_number));
        const packetBytes = () => Buffer.byteLength(JSON.stringify({
          core_units: core, adjacent_context: adjacentContext, visual_transcriptions: visualContext
        }));
        if (packetBytes() > SEMANTIC_PACKET_BYTES) {
          if (units.length > 1) return halves();
          return calibration
            ? failCalibrationUnit(units[0], "CALIBRATION_SIZE_BOUND_EXCEEDED", "SEMANTIC_PACKET_OVERSIZE")
            : recordSourceOnly(units[0], "SEMANTIC_PACKET_OVERSIZE");
        }
        if (calibration) {
          const frozen = await checkedWork(calibrationReferenceRequestFor({ units, core, adjacentContext, visualContext }), ([saved]) => {
            for (const item of saved.output.reference_items) {
              for (const anchor of item.anchors) {
                const unit = units.find((candidate) => candidate.unit_id === anchor.unit_id);
                invariant(unit, "REFERENCE_ANCHOR_OUTSIDE_SOURCE_PACKET");
                resolveExactQuote(unit.text, anchor.quote, anchor.occurrence);
              }
            }
          });
          if (frozen.blocked) return false;
          // A reference that never quotes its source exactly: smaller batches are read again, and a
          // single unit fails calibration with its own reason, since calibration is the gate that
          // decides whether the run goes on at all.
          if (frozen.failure && units.length > 1) return halves();
          if (frozen.failure) {
            return failCalibrationUnit(units[0], "CALIBRATION_REFERENCE_UNRESOLVED", frozen.failure);
          }
          reference = frozen.result[0];
        }
        // The current widened context is read at each call.
        const extract = (id, repairRequest, tier = "standard") => work(extractionRequestFor({
          id, units, core, adjacentContext, visualContext, repairRequest, tier }));
        // A review leaves work open with any finding, unassessed ID or proposed repair, whatever status it gives, and
        // when it says it didn't finish. Its status is read from what it names: a "repair_required" that names
        // nothing has nothing to repair (reviewStatusFromContent).
        const reviewHasFindings = (review) => reviewStatusFromContent(review)?.status !== "sufficient_for_stated_scope"
          || review.assessments.some((assessment) => assessment.outcome !== "preserved"
            || assessment.finding_type !== "none")
          || review.unassessed_ids.length > 0
          || review.proposed_repairs.length > 0;
        // An outcome the extractor didn't finish, or that didn't bind to the source.
        const mechanicallyUnresolved = (outcome, failure) => Boolean(failure) || outcome?.[0]?.output?.status !== "complete";
        // `review` is the omission review that counts for the outcome: the whole review of a first extraction,
        // the scoped review after a repair.
        const unresolvedOutcome = (outcome, failure, review) => mechanicallyUnresolved(outcome, failure)
          || reviewHasFindings(review);
        const bind = (outcome) => {
          try {
            const parts = splitBatchExtractionByUnit({ extraction: outcome[0].output, unitIds: units.map((unit) => unit.unit_id) });
            return { split: parts, failure: null, graphs: new Map(units.map((unit) => [unit.unit_id,
              bindUnitExtraction(unit, parts.get(unit.unit_id), outcome[0].receipt)])) };
          } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            return { split: null, graphs: null, failure: { code: error.code, details: error.details ?? null } };
          }
        };
        // The extractor's context requests are answered once per unit and direction: a wider window of the source
        // text (before, after, or both for a whole entry) or the neighbouring pages' visual transcriptions. The
        // answer says what was supplied and what can't be, so the next pass completes rather than asking again.
        // The status each unit and direction last got, so a repeated request reads `already_answered` only after
        // something was supplied, and `unavailable` while nothing ever could be.
        const answeredContext = new Map();
        const answerContext = async (output) => {
          const response = [];
          let supplied = false, overBound = false;
          for (const request of output?.requested_context ?? []) {
            const key = `${request.unit_id}\0${request.direction}`;
            if (response.some((item) => `${item.unit_id}\0${item.direction}` === key)) continue;
            const index = units.findIndex((unit) => unit.unit_id === request.unit_id);
            const prior = { adjacentContext, visualContext, visualPages: new Set(visualPages) };
            let added = false;
            if (index >= 0) {
              const unit = units[index];
              for (const side of ["before", "after"]) {
                if (request.direction !== side && request.direction !== "whole_entry") continue;
                const wider = expandedWindow(unit, side, EXPANDED_CONTEXT_BYTES);
                if (Buffer.byteLength(wider) <= Buffer.byteLength(adjacentContext.by_unit[index][side])) continue;
                adjacentContext = { by_unit: adjacentContext.by_unit.map((item, at) =>
                  at === index ? { ...item, [side]: wider } : item) };
                added = true;
              }
              if (request.direction === "visual" && Number.isSafeInteger(unit.page_number)) {
                for (const entry of await visualEntriesFor([unit.page_number - 1, unit.page_number, unit.page_number + 1])) {
                  if (visualPages.has(entry.page_number)) continue;
                  visualContext = [...visualContext, entry.output];
                  visualPages.add(entry.page_number);
                  added = true;
                }
              }
            }
            if (added && packetBytes() > SEMANTIC_PACKET_BYTES) {
              ({ adjacentContext, visualContext, visualPages } = prior);
              added = false;
              overBound = true;
            }
            const earlier = answeredContext.get(key);
            const status = added ? "supplied"
              : earlier === "supplied" || earlier === "already_answered" ? "already_answered" : "unavailable";
            response.push({ unit_id: request.unit_id, direction: request.direction, status });
            answeredContext.set(key, status);
            supplied ||= added;
          }
          return { response, supplied, overBound };
        };
        // One repair of a hardest answer at the same tier, with the omission review that counted for it, any
        // binding failure and an answer to any context it asked for. A pause comes back as paused; a refused or
        // exhausted repair leaves the first answer in place. The repair's own review is scoped to what it changed.
        const repairHardest = async (id, outcome, review, failure, extraRequest, cycle) => {
          const answer = await answerContext(outcome[0].output);
          const counts = answer.response.length ? contextAnswerCounts(answer.response) : null;
          const repaired = await extract(derivedId(id, "repair"), {
            previous_extraction: outcome[0].output,
            omission_review: review ?? null,
            ...extraRequest,
            mechanical_failure: failure,
            cycle,
            ...(answer.response.length ? { context_response: answer.response } : {})
          }, "hardest");
          if (!repaired) {
            const snapshot = { ...extractionCycleDiagnostics(incompleteWorkResults),
              blocker_code: diagnosticBlockerCode(state.blocker) };
            if (!workExhausted) return { paused: true };
            state.blocker = null;
            return { snapshot, counts, outcome: null };
          }
          const bound = bind(repaired);
          // Newly supplied context can change what the review sees, so then the repair's review counts whole.
          const scoped = scopedOmission(repaired, answer.supplied ? null : { extraction: outcome[0].output, review });
          return { snapshot: { ...extractionCycleDiagnostics(repaired, bound.failure?.code ?? null, scoped.review),
            extraction_changed: extractionChanged(outcome[0].output, repaired[0].output), blocker_code: null,
            ...(scoped.scope ? { review_scope: scoped.scope } : {}) },
          counts, outcome: repaired, bound, review: scoped.review };
        };
        let results, repairRequest, split, graphsByUnit, bindingFailure, hardestRefusal = null, hardestDependentRefusal = null;
        // The omission review that counts for `results`, and the extraction and counted review that the next
        // repair starts from. A first extraction's review counts whole; a repair's review counts for what the
        // repair could have affected, so a verdict on an unchanged item that passed carries forward.
        let omissionReview = null, repairPrior = null;
        // A pass that received context it asked for earns one more pass, so supplying context never uses up a
        // repair attempt.
        let lastCycle = 2, contextSupplied = false;
        for (let cycle = 0; cycle <= lastCycle; cycle += 1) {
          results = await extract(epochId(`extract:batch:${keyId}:cycle:${cycle}`, calibration), repairRequest);
          if (!results) {
            cycles.push({ cycle, ...extractionCycleDiagnostics(incompleteWorkResults),
              blocker_code: diagnosticBlockerCode(state.blocker) });
            return finishExhausted("EXTRACTION_ATTEMPTS_EXHAUSTED");
          }
          const extraction = results[0].output;
          // Several units that ask for smaller windows, or for context without naming it, are split rather than
          // sent the same window again.
          if (units.length > 1 && (extraction?.status === "incomplete"
            || (extraction?.status === "needs_context" && !extraction.requested_context.length))) return halves();
          ({ split, graphs: graphsByUnit, failure: bindingFailure } = bind(results));
          const scoped = scopedOmission(results, repairPrior);
          omissionReview = scoped.review;
          const snapshot = { cycle, ...extractionCycleDiagnostics(results, bindingFailure?.code ?? null, omissionReview),
            blocker_code: null, ...(scoped.scope ? { review_scope: scoped.scope } : {}) };
          cycles.push(snapshot);
          if (!unresolvedOutcome(results, bindingFailure, omissionReview)) break;
          const answer = await answerContext(extraction);
          if (answer.response.length) snapshot.context_answer = contextAnswerCounts(answer.response);
          if (units.length > 1 && extraction?.status === "needs_context" && !answer.supplied) return halves();
          if (answer.supplied && !contextSupplied) { contextSupplied = true; lastCycle += 1; }
          repairRequest = {
            previous_extraction: extraction,
            omission_review: omissionReview,
            mechanical_failure: bindingFailure,
            cycle: cycle + 1,
            ...(answer.response.length ? { context_response: answer.response } : {})
          };
          // Newly supplied context can change what the review sees, so the next review counts whole.
          repairPrior = answer.supplied ? null : { extraction, review: omissionReview };
        }
        let unresolved = unresolvedOutcome(results, bindingFailure, omissionReview);
        // The last pass, kept in case the hardest tier can't finish or bind where that pass did.
        const lastPass = { results, split, graphsByUnit, bindingFailure, omissionReview };
        // A single extraction unit gets the same final repair request once through the hardest lane and, when
        // that answer's own review or binding leaves it unresolved, one repair of it at the same tier, before it
        // is admitted as source-only needs_review.
        if (unresolved && units.length === 1 && hardestLane.enabled) {
          const hardestId = epochId(`extract:batch:${keyId}:hardest`, calibration);
          const hardest = await extract(hardestId, repairRequest, "hardest");
          const outcomeId = epochId(`extract:batch:${keyId}`, calibration);
          if (!hardest) {
            hardestDiagnostics = { ...extractionCycleDiagnostics(incompleteWorkResults),
              blocker_code: diagnosticBlockerCode(state.blocker) };
            if (!workExhausted) return false;
            // A size refusal before the hardest extractor ran leaves the attempt unspent; one from the
            // dependent omission packet after the extractor completed consumed it and counts as failed.
            const sizeRefusal = state.blocker === "JOURNAL_WORK_PACKET_TOO_LARGE";
            hardestRefusal = sizeRefusal && !workPrimaryCompleted ? state.blocker : null;
            hardestDependentRefusal = sizeRefusal && workPrimaryCompleted ? state.blocker : null;
            state.blocker = null;
            if (!hardestRefusal) await recordHardestOutcome(outcomeId, "failed");
          } else {
            // The hardest answer repairs the last pass, so its review is scoped against that pass.
            results = hardest;
            ({ split, graphs: graphsByUnit, failure: bindingFailure } = bind(hardest));
            const scoped = scopedOmission(hardest, repairPrior);
            omissionReview = scoped.review;
            hardestDiagnostics = { ...extractionCycleDiagnostics(hardest, bindingFailure?.code ?? null, omissionReview),
              blocker_code: null, ...(scoped.scope ? { review_scope: scoped.scope } : {}) };
            unresolved = unresolvedOutcome(hardest, bindingFailure, omissionReview);
            if (unresolved) {
              const repair = await repairHardest(hardestId, hardest, omissionReview, bindingFailure, {}, "hardest-repair");
              if (repair.paused) return false;
              if (repair.counts) hardestDiagnostics.context_answer = repair.counts;
              hardestDiagnostics.repair = repair.snapshot;
              if (repair.outcome) {
                results = repair.outcome;
                ({ split, graphs: graphsByUnit, failure: bindingFailure } = repair.bound);
                omissionReview = repair.review;
                unresolved = unresolvedOutcome(results, bindingFailure, omissionReview);
              }
            }
            await recordHardestOutcome(outcomeId, unresolved ? "failed" : "resolved");
          }
          // A hardest answer that didn't finish or didn't bind never replaces a last pass that did; that pass's
          // remaining findings are withheld below.
          if (unresolved && mechanicallyUnresolved(results, bindingFailure)
            && !mechanicallyUnresolved(lastPass.results, lastPass.bindingFailure)) {
            ({ results, split, graphsByUnit, bindingFailure, omissionReview } = lastPass);
          }
        }
        if (unresolved && units.length > 1) return halves();
        // When repairs run out on one unit, what review still flags is withheld and the rest of the unit is
        // kept. A calibration unit instead goes on to its reference audit with its whole extraction, and what
        // review still flags is withheld when that audit's repairs end, so the audit judges what it keeps.
        let residualsByUnit = null;
        if (unresolved && !calibration && !mechanicallyUnresolved(results, bindingFailure)) {
          const kept = withholdFlaggedItems({ extraction: results[0].output, reviews: [{ review: omissionReview }], unitIds });
          const rebound = kept ? bind([{ ...results[0], output: kept.extraction }]) : null;
          if (rebound && !rebound.failure) {
            ({ split, graphs: graphsByUnit } = rebound);
            residualsByUnit = kept.residualsByUnit;
            unresolved = false;
          }
        }
        if (unresolved && calibration && mechanicallyUnresolved(results, bindingFailure)) {
          return failCalibrationUnit(units[0], "CALIBRATION_REPAIR_REQUIRED",
            hardestRefusal ?? "CALIBRATION_EXTRACTION_UNRESOLVED", diagnostics(), sourceOnlyCounts());
        }
        if (unresolved && !calibration) {
          const unit = units[0];
          const admitted = {
            schema_version: "1.0",
            status: "incomplete",
            assertions: [],
            entities: [],
            episodes: [],
            coverage: [{ unit_id: unit.unit_id, disposition: "needs_review", assertion_local_ids: [],
              reason: "Bounded application repair did not resolve this unit; source remains available." }],
            requested_context: []
          };
          const graph = bindUnitExtraction(unit, admitted, results[0].receipt);
          await writeUnitRecord(unit.unit_id, { graph, extraction: results[0], omission: results[1], source_only_unresolved: true,
            diagnostics: diagnostics(),
            ...(hardestLane.enabled ? { hardest: hardestRefusal ? "not_attempted" : "failed" } : {}),
            ...((hardestRefusal ?? hardestDependentRefusal) ? { unresolved_reason: hardestRefusal ?? hardestDependentRefusal } : {}) });
          if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
          state.stage = "EXTRACT";
          state.blocker = null;
          await save();
          return true;
        }
        let calibrationRecord = null;
        if (calibration) {
          const assertionIds = (graph) => graph.nodes.filter((node) => node.kind === "assertion").map((node) => node.id);
          const auditPacket = (graph) => ({
            frozen_reference: reference.output,
            supporting_passages: core,
            imported_generation: {
              generation: state.generation,
              assertions: graph.nodes.filter((node) => node.kind === "assertion"),
              entities: graph.nodes.filter((node) => node.kind === "entity")
            }
          });
          // Checked when the audit is saved: its output must score against the frozen reference.
          const checkScores = (graph) => ([saved]) => { scoreReferenceReview({ referenceResult: reference.output,
            reviewResult: saved.output, candidateIds: assertionIds(graph) }); };
          // Every audited attempt is kept, so the unit can keep whichever fares best on its reference items once
          // what review still flags is withheld. The fidelity review that counts is the whole first audit, then
          // after a repair only what changed since the audited extraction, the earlier findings and every
          // reference item.
          const attempts = [];
          let auditedExtraction = null, fidelityReview = null, score;
          // A fidelity review that assessed every frozen reference item and names nothing open counts as sufficient
          // whatever status it claims, so a version can't be held back by a status its own verdicts contradict.
          const referenceIds = reference.output.reference_items.map((item) => item.id);
          const countFidelity = (claimedReview, graph, extraction) => {
            const rawReview = reviewStatusFromContent(claimedReview, { referenceIds });
            const scoped = auditedExtraction && fidelityReview
              ? scopeReviewAfterRepair({ review: rawReview, previousReview: fidelityReview,
                previousExtraction: auditedExtraction, extraction, unitIds, targetOf: nodeTarget })
              : { review: rawReview, scope: null };
            fidelityReview = scoped.review;
            auditedExtraction = extraction;
            score = scoreReferenceReview({ referenceResult: reference.output, reviewResult: fidelityReview,
              candidateIds: assertionIds(graph) });
            attempts.push({ results, graphsByUnit, omissionReview, fidelityReview });
            return scoped.scope;
          };
          const combined = mergeGraphs([...graphsByUnit.values()]);
          const initialFidelity = await checkedWork({
            id: epochId(`fidelity:calibration:batch:${keyId}`, true),
            role: "fidelity_auditor",
            stage: "REFERENCE_AUDIT",
            units,
            packetInput: auditPacket(combined)
          }, checkScores(combined));
          if (initialFidelity.blocked) return false;
          if (initialFidelity.failure) {
            fidelityCycles.push({ cycle: 0, ...extractionCycleDiagnostics(results, null, omissionReview), blocker_code: null, fidelity: null });
            if (units.length > 1) return halves();
            return failCalibrationUnit(units[0], "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED", initialFidelity.failure, diagnostics(), sourceOnlyCounts());
          }
          countFidelity(initialFidelity.result[0].output, combined, results[0].output);
          await writeOnce(epochId(`calibration:review:batch:${keyId}`, true), { reference, fidelity: initialFidelity.result[0], score, unit_ids: unitIds });
          const auditPasses = (output, value) => output.status === "sufficient_for_stated_scope" && referenceScorePasses(value);
          // Left references unassessed without a single finding: repairing the extraction can't help.
          const unassessedOnly = (output, value) => (output.status === "incomplete" || value.reference_counts.unassessed > 0)
            && value.reference_counts.omitted === 0 && value.reference_counts.distorted === 0
            && value.critical_miss_count === 0 && value.qualifier_error_count === 0
            && !output.assessments.some((item) => item.outcome === "omitted"
              || item.outcome === "distorted" || item.finding_type !== "none");
          // An attempt passes when its reference score passes and neither counted review leaves anything open, whatever
          // status a review gives: a finding, unassessed ID or proposed repair on either keeps the repairs going.
          const attemptPasses = () => auditPasses(fidelityReview, score) && !reviewHasFindings(fidelityReview)
            && !reviewHasFindings(omissionReview);
          let calibrationPass = attemptPasses();
          fidelityCycles.push({ cycle: 0, ...extractionCycleDiagnostics(results, null, omissionReview), blocker_code: null,
            fidelity: fidelityCycleDiagnostics(fidelityReview, score, calibrationPass) });
          // The first audit of this batch, initial or after a repair, that leaves references unassessed without any
          // finding gets one fresh audit of the same extraction. Its distinct identity never consumes an extraction-
          // repair cycle, and the batch gets at most one.
          let reauditUsed = false;
          const reauditOnce = async (graph, cycle) => {
            reauditUsed = true;
            reauditDiagnostics = { ...(cycle ? { cycle } : {}), ...extractionCycleDiagnostics(results, null, omissionReview),
              blocker_code: null, fidelity: null };
            const suffix = cycle ? `:cycle:${cycle}` : "";
            const attempt = await checkedWork({
              id: epochId(`fidelity:calibration-reaudit:batch:${keyId}${suffix}`, true),
              role: "fidelity_auditor", stage: "REFERENCE_AUDIT", units,
              packetInput: auditPacket(graph)
            }, checkScores(graph));
            if (attempt.failure) reauditDiagnostics.blocker_code = diagnosticBlockerCode(attempt.failure);
            if (attempt.blocked || attempt.failure) return attempt;
            const scope = countFidelity(attempt.result[0].output, graph, results[0].output);
            await writeOnce(epochId(`calibration:reaudit-review:batch:${keyId}${suffix}`, true), {
              reference, fidelity: attempt.result[0], score, unit_ids: unitIds
            });
            calibrationPass = attemptPasses();
            reauditDiagnostics.fidelity = fidelityCycleDiagnostics(fidelityReview, score, calibrationPass);
            if (scope) reauditDiagnostics.fidelity_scope = scope;
            return attempt;
          };
          // What an audited attempt keeps once what its counted reviews still flag is withheld, and how its
          // reference items then score. Null when nothing can be withheld that way.
          const keptOutcome = (attempt) => {
            const kept = withholdFlaggedItems({ extraction: attempt.results[0].output, unitIds, reviews: [
              { review: attempt.omissionReview }, { review: attempt.fidelityReview, targetOf: nodeTarget }] });
            if (!kept) return null;
            const rebound = bind([{ ...attempt.results[0], output: kept.extraction }]);
            if (rebound.failure) return null;
            const withheldTargets = new Set(kept.withheldItems.map((item) => nodeTarget(item.kind, item.localId, item.unitIds)));
            // Entities count as carriers too, so an item the auditor tied only to a withheld entity is lost with it.
            const candidateTargets = new Set(mergeGraphs([...attempt.graphsByUnit.values()]).nodes
              .filter((node) => node.kind === "assertion" || node.kind === "entity").map((node) => node.id));
            const keptReview = reviewAfterWithholding({ review: attempt.fidelityReview, withheldTargets, candidateTargets });
            const keptScore = scoreReferenceReview({ referenceResult: reference.output, reviewResult: keptReview,
              candidateIds: assertionIds(mergeGraphs([...rebound.graphs.values()])) });
            return { kept, rebound, keptReview, keptScore };
          };
          // A single unit whose re-audit or repairs run out keeps its best audited attempt; only one with no audit
          // at all fails source-only.
          let repairsEnded = false;
          if (!calibrationPass && unassessedOnly(fidelityReview, score)) {
            const reaudit = await reauditOnce(combined, 0);
            if (reaudit.blocked) return false;
            if (reaudit.failure) {
              // Like a failed initial audit: a batch of several units is split and each half retried.
              if (units.length > 1) return halves();
              repairsEnded = true;
            }
          }
          if (!calibrationPass && units.length > 1) return halves();
          // Context a repair asks for is answered in the next repair request, and a first supplied answer earns
          // one more standard repair, as in the extraction passes; the repair after newly supplied context has
          // its omission review counted whole.
          let contextResponse = null, bindingFeedback = null, standardRepairs = 2, repairContextSupplied = false;
          let omissionPriorWhole = false;
          for (let auditCycle = 1; !calibrationPass && !repairsEnded
            && auditCycle <= standardRepairs + (hardestLane.enabled ? 1 : 0); auditCycle += 1) {
            const hardestRepair = auditCycle > standardRepairs;
            // When an attempt already passes once what review still flags is withheld, only those findings
            // remain; the scarce hardest tier is kept for reference items that fail.
            if (hardestRepair && attempts.some((attempt) => {
              const outcome = keptOutcome(attempt);
              return outcome && referenceScorePasses(outcome.keptScore);
            })) break;
            const repairId = epochId(hardestRepair ? `extract:calibration-repair:batch:${keyId}:hardest`
              : `extract:calibration-repair:batch:${keyId}:cycle:${auditCycle}`, true);
            const previousExtraction = results[0].output;
            const previousOmission = omissionReview;
            const omissionPrior = omissionPriorWhole ? null : { extraction: previousExtraction, review: previousOmission };
            omissionPriorWhole = false;
            let repaired = await extract(repairId, {
              previous_extraction: previousExtraction,
              omission_review: previousOmission,
              fidelity_review: fidelityReview,
              cycle: hardestRepair ? "fidelity-hardest" : `fidelity-${auditCycle}`,
              ...(bindingFeedback ? { mechanical_failure: bindingFeedback } : {}),
              ...(contextResponse ? { context_response: contextResponse } : {})
            }, hardestRepair ? "hardest" : "standard");
            contextResponse = null;
            bindingFeedback = null;
            if (!repaired) {
              const snapshot = { ...extractionCycleDiagnostics(incompleteWorkResults),
                extraction_changed: extractionChanged(previousExtraction, incompleteWorkResults?.[0]?.output),
                blocker_code: diagnosticBlockerCode(state.blocker), fidelity: null };
              if (!workExhausted) {
                if (hardestRepair) hardestFidelityDiagnostics = snapshot;
                else fidelityCycles.push({ cycle: auditCycle, ...snapshot });
                return false;
              }
              if (hardestRepair) {
                hardestFidelityDiagnostics = snapshot;
                const sizeRefusal = state.blocker === "JOURNAL_WORK_PACKET_TOO_LARGE";
                hardestRefusal = sizeRefusal && !workPrimaryCompleted ? state.blocker : null;
                hardestDependentRefusal = sizeRefusal && workPrimaryCompleted ? state.blocker : null;
                state.blocker = null;
                if (!hardestRefusal) await recordHardestOutcome(repairId, "failed");
                break;
              }
              fidelityCycles.push({ cycle: auditCycle, ...snapshot });
              state.blocker = null;
              break;
            }
            let bound = bind(repaired);
            let scoped = scopedOmission(repaired, omissionPrior);
            const repairSnapshot = { ...(hardestRepair ? {} : { cycle: auditCycle }),
              ...extractionCycleDiagnostics(repaired, bound.failure?.code ?? null, scoped.review),
              extraction_changed: extractionChanged(previousExtraction, repaired[0].output),
              blocker_code: null, fidelity: null, ...(scoped.scope ? { review_scope: scoped.scope } : {}) };
            if (hardestRepair) hardestFidelityDiagnostics = repairSnapshot;
            else fidelityCycles.push(repairSnapshot);
            // The hardest tier repairs its own answer once only when that answer didn't finish or didn't bind;
            // review findings on it are withheld when the repairs end.
            if (hardestRepair && mechanicallyUnresolved(repaired, bound.failure)) {
              const repair = await repairHardest(repairId, repaired, scoped.review, bound.failure,
                { fidelity_review: fidelityReview }, "fidelity-hardest-repair");
              if (repair.paused) return false;
              if (repair.counts) repairSnapshot.context_answer = repair.counts;
              repairSnapshot.repair = repair.snapshot;
              if (repair.outcome) {
                repaired = repair.outcome;
                bound = repair.bound;
                scoped = { review: repair.review, scope: null };
              }
            }
            results = repaired;
            omissionReview = scoped.review;
            // A repair that didn't finish or didn't bind passes its binding failure and an answer to its context
            // request to the next repair.
            if (mechanicallyUnresolved(repaired, bound.failure)) {
              if (hardestRepair) await recordHardestOutcome(repairId, "failed");
              else {
                bindingFeedback = bound.failure;
                const answer = await answerContext(repaired[0].output);
                if (answer.response.length) {
                  repairSnapshot.context_answer = contextAnswerCounts(answer.response);
                  contextResponse = answer.response;
                }
                if (answer.supplied) omissionPriorWhole = true;
                if (answer.supplied && !repairContextSupplied) { repairContextSupplied = true; standardRepairs += 1; }
              }
              continue;
            }
            split = bound.split;
            graphsByUnit = bound.graphs;
            const repairedCombined = mergeGraphs([...graphsByUnit.values()]);
            const repairedFidelityAttempt = await checkedWork({
              id: epochId(hardestRepair ? `fidelity:calibration-repair:batch:${keyId}:hardest`
                : `fidelity:calibration-repair:batch:${keyId}:cycle:${auditCycle}`, true),
              role: "fidelity_auditor",
              stage: "REFERENCE_AUDIT",
              units,
              packetInput: auditPacket(repairedCombined)
            }, checkScores(repairedCombined));
            if (repairedFidelityAttempt.blocked) return false;
            if (repairedFidelityAttempt.failure) {
              repairSnapshot.blocker_code = diagnosticBlockerCode(repairedFidelityAttempt.failure);
              if (hardestRepair) await recordHardestOutcome(repairId, "failed");
              break;
            }
            const fidelityScope = countFidelity(repairedFidelityAttempt.result[0].output, repairedCombined, repaired[0].output);
            await writeOnce(epochId(hardestRepair ? `calibration:repair-review:batch:${keyId}:hardest`
              : `calibration:repair-review:batch:${keyId}:cycle:${auditCycle}`, true), {
              reference, fidelity: repairedFidelityAttempt.result[0], score, unit_ids: unitIds
            });
            calibrationPass = attemptPasses();
            repairSnapshot.fidelity = fidelityCycleDiagnostics(fidelityReview, score, calibrationPass);
            if (fidelityScope) repairSnapshot.fidelity_scope = fidelityScope;
            if (!calibrationPass && !reauditUsed && unassessedOnly(fidelityReview, score)) {
              const reaudit = await reauditOnce(repairedCombined, auditCycle);
              if (reaudit.blocked) return false;
              if (reaudit.failure) {
                if (hardestRepair) await recordHardestOutcome(repairId, "failed");
                break;
              }
            }
            if (hardestRepair) await recordHardestOutcome(repairId, calibrationPass ? "resolved" : "failed");
          }
          // The unit keeps the audited attempt that fares best on its reference items once what its reviews still
          // flag is withheld: fewest critical misses, then most items kept, fewest lost qualifiers, fewest left
          // unassessed, fewest items withheld of any kind, then the latest.
          const rankBefore = (left, right) => {
            for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return left[index] < right[index];
            return false;
          };
          let chosen = null;
          for (const [index, attempt] of attempts.entries()) {
            const outcome = keptOutcome(attempt);
            if (!outcome) continue;
            const { kept, keptScore } = outcome;
            const rank = [keptScore.critical_miss_count, -keptScore.reference_counts.preserved,
              keptScore.qualifier_error_count, keptScore.reference_counts.unassessed,
              kept.residuals.withheld_assertions + kept.residuals.withheld_entities + kept.residuals.withheld_episodes, -index];
            if (!chosen || rankBefore(rank, chosen.rank)) chosen = { attempt, ...outcome, rank };
          }
          if (!chosen) {
            return failCalibrationUnit(units[0], "CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_REPAIR_CYCLES_EXHAUSTED",
              diagnostics(), sourceOnlyCounts());
          }
          // A critical miss on the kept attempt counts only when a second, independent judge agrees. The kept
          // extraction gets one more fidelity audit: from the hardest tier (Claude Opus) when that lane is on, else a
          // fresh standard audit under its own identity. A critical reference item the first judge missed counts as
          // confirmed unless the second finds it preserved without a finding and leaves nothing open on it (no
          // unassessed ID, no proposed repair). When no second audit can be had, the first judge's misses stand, so
          // the confirmation can never hide one. A hardest-tier confirmation is recorded with the other hardest
          // attempts: resolved when it answered, failed when it couldn't.
          let keptScore = chosen.keptScore;
          if (keptScore.critical_miss_count > 0) {
            const keptGraph = mergeGraphs([...chosen.rebound.graphs.values()]);
            const request = { id: epochId(`fidelity:calibration-confirm:batch:${keyId}`, true), role: "fidelity_auditor",
              stage: "REFERENCE_AUDIT", units, packetInput: auditPacket(keptGraph) };
            const hardestJudge = hardestLane.enabled
              && port.capabilities?.().hardest_roles?.fidelity_auditor?.available !== false
              && hardestJournalRequestFits(request, state.generation, grant.purpose);
            let second = null, failure = null;
            if (hardestJudge) {
              const answer = await work({ ...request, id: derivedId(request.id, "hardest"), tier: "hardest" });
              if (!answer && !workExhausted) return false;
              if (answer) failure = checkFailure(checkScores(keptGraph), answer);
              else { failure = state.blocker ?? "COMPLETION_UNKNOWN"; state.blocker = null; await save(); }
              await recordHardestOutcome(request.id, failure ? "failed" : "resolved");
              if (!failure) second = answer[0].output;
            } else {
              const attempt = await checkedWork(request, checkScores(keptGraph));
              if (attempt.blocked) return false;
              if (attempt.failure) failure = attempt.failure;
              else second = attempt.result[0].output;
            }
            const preservedIn = (review, id) => review?.assessments.some((item) => item.target_id === id
              && item.outcome === "preserved" && item.finding_type === "none");
            const missed = reference.output.reference_items.filter((item) => item.critical && !preservedIn(chosen.keptReview, item.id));
            const secondOpen = reviewFindingTargets(second);
            const unconfirmed = second
              ? missed.filter((item) => preservedIn(second, item.id) && !secondOpen.has(item.id)).length : 0;
            keptScore = { ...keptScore, critical_miss_count: keptScore.critical_miss_count - unconfirmed };
            criticalConfirmation = { tier: hardestJudge ? "hardest" : "standard", critical_miss_count: missed.length,
              confirmed: keptScore.critical_miss_count, unconfirmed, blocker_code: failure ? diagnosticBlockerCode(failure) : null };
          }
          results = chosen.attempt.results;
          omissionReview = chosen.attempt.omissionReview;
          ({ split, graphs: graphsByUnit } = chosen.rebound);
          residualsByUnit = chosen.kept.residualsByUnit;
          const unitPasses = referenceScorePasses(keptScore);
          calibrationRecord = { batch: keyId, ...calibrationScoreCounts(keptScore), outcome: unitPasses ? "pass" : "fail",
            ...(criticalConfirmation?.unconfirmed ? { unconfirmed_critical_miss_count: criticalConfirmation.unconfirmed } : {}) };
          if (!unitPasses) calibrationFailures += units.length;
          calibrationCriticalMisses += keptScore.critical_miss_count;
        }
        const contextAnswered = [...cycles, ...fidelityCycles].some((cycle) => cycle.context_answer);
        const unitResiduals = (unitId) => {
          const counts = residualsByUnit?.get(unitId);
          return counts && Object.values(counts).some(Boolean) ? counts : null;
        };
        for (const unit of units) {
          const residual = unitResiduals(unit.unit_id);
          await writeUnitRecord(unit.unit_id, {
            graph: graphsByUnit.get(unit.unit_id),
            extraction: results[0],
            unit_extraction: split.get(unit.unit_id),
            omission: results[1],
            source_only_unresolved: false,
            ...(residual ? { review_residuals: residual } : {}),
            ...(calibrationRecord ? { calibration: calibrationRecord } : {}),
            ...((reauditDiagnostics || hardestFidelityDiagnostics || hardestDiagnostics || criticalConfirmation
              || contextAnswered || residual) ? { diagnostics: diagnostics() } : {})
          });
          if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
        }
        state.stage = "EXTRACT";
        state.blocker = null;
        await save();
        return true;
      };

      // Calibration runs every calibration unit and is judged on pooled totals when the round ends: recall across
      // the scored batches must meet the reference target, and no critical reference item may be missed after
      // repairs. A critical miss ends the round at once, since it can't pass, and an optional failure limit can end
      // it sooner. Failed units, lost qualifiers and withheld assertions are counted and reported. Regular batches
      // start only once calibration passes.
      const calibrationOrder = [...calibrationIds];
      const completedCalibration = () => calibrationOrder.filter((id) => state.completed_units.includes(id));
      // Rebuilt from the unit records, so a resumed round is judged the same way: each failed unit with its
      // reason, and each scored batch's reference result counted once.
      const calibrationRecords = async () => {
        // `failureBatches[i]` is the batch of `failures[i]` (null when unscored), kept apart so the failure records
        // keep their shape. A batch's counts sit on every unit record it wrote, so sums over failures take each
        // batch once.
        const failures = [], failureBatches = [], batches = new Map();
        let unscored = 0, legacyPassed = 0, withheld = 0, gaps = 0;
        for (const unitId of completedCalibration()) {
          const record = await readUnitRecord(unitId);
          if (!record) continue;
          const { batch, outcome, ...reference } = record.calibration ?? {};
          if (record.calibration) batches.set(batch, reference);
          // A unit admitted before calibration recorded its counts passed the stricter per-unit audit (no
          // critical miss, recall at the target), so a resumed round goes on without counting it.
          else if (!record.source_only_unresolved) legacyPassed += 1;
          else unscored += 1;
          withheld += record.review_residuals?.withheld_assertions ?? 0;
          gaps += record.review_residuals?.omission_gaps ?? 0;
          const details = { ...(record.calibration ? { reference } : {}),
            ...(record.diagnostics ? { diagnostics: record.diagnostics } : {}) };
          if (record.source_only_unresolved) {
            failures.push({ unit_id: unitId, status: calibrationStopStatus(record.source_only_reason),
              reason: record.source_only_detail ?? record.source_only_reason ?? "CALIBRATION_UNIT_UNRESOLVED", ...details });
            failureBatches.push(record.calibration ? batch : null);
          } else if (outcome === "fail") {
            failures.push({ unit_id: unitId, status: "CALIBRATION_REFERENCE_MISSED", reason: "CALIBRATION_REFERENCE_MISSED", ...details });
            failureBatches.push(batch);
          }
        }
        const pooled = pooledCalibration([...batches.values()], JOURNAL_GRAPH_CONTRACT.audit_defaults.reference_set_recall_target,
          calibrationCriticalMissLimit);
        // Critical misses the second judge didn't confirm: reported, never counted against the round.
        const unconfirmedCritical = [...batches.values()].reduce((sum, item) => sum + (item.unconfirmed_critical_miss_count ?? 0), 0);
        return { failures, failureBatches, gate: { ...pooled, calibration_pass: pooled.calibration_pass && unscored === 0,
          ...(unconfirmedCritical ? { unconfirmed_critical_miss_count: unconfirmedCritical } : {}),
          failed_units: failures.length, unscored_units: unscored,
          ...(legacyPassed ? { legacy_passed_units: legacyPassed } : {}), withheld_assertions: withheld, omission_gaps: gaps,
          completed_calibration_units: completedCalibration().length, calibration_units: calibrationOrder.length } };
      };
      if (state.calibration !== "pass") {
        const resumed = await calibrationRecords();
        calibrationFailures = resumed.failures.length;
        calibrationCriticalMisses = resumed.gate.critical_miss_count;
        calibrationUnscored = resumed.gate.unscored_units;
        // Oversized calibration units fail where they fall in the source, between the batches, so a limit that
        // ends the round never skips units that come before them.
        const unitPosition = new Map(plan.units.map((unit, index) => [unit.unit_id, index]));
        const calibrationSteps = [
          ...oversizedUnits.filter((item) => calibrationIds.has(item.unit_id))
            .map((unit) => ({ position: unitPosition.get(unit.unit_id), oversized: unit })),
          ...frozenPlan.calibration_batches.map((ids) => ({
            position: Math.min(...ids.map((id) => unitPosition.get(id))), ids }))
        ].sort((left, right) => left.position - right.position);
        for (let index = 0; index < calibrationSteps.length; index += 1) {
          if (calibrationRoundOver()) break;
          const step = calibrationSteps[index];
          if (step.oversized) {
            if (!state.completed_units.includes(step.oversized.unit_id)) {
              await failCalibrationUnit(step.oversized, "CALIBRATION_SIZE_BOUND_EXCEEDED", "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND");
            }
            continue;
          }
          if (lookahead) {
            lookahead.ahead(calibrationSteps.slice(index + 1).filter((item) => item.ids).slice(0, semanticConcurrency)
              .flatMap((item) => calibrationDescriptors(item.ids)));
          }
          if (!(await processBatch(frozenUnits(step.ids), true))) return summary();
        }
        const { failures, failureBatches, gate } = await calibrationRecords();
        state.calibration_gate = gate;
        const complete = calibrationOrder.every((id) => state.completed_units.includes(id));
        if (!complete || !gate.calibration_pass) {
          // The stop names the unit that decided it: the one whose critical miss took the round past its limit
          // (with no limit, the first critical miss), else the first unscored, else the first failure when a limit
          // ended the round. Recall below the target with none of these is the round's.
          const first = firstFailurePastCriticalLimit(failures, failureBatches, calibrationCriticalMissLimit)
            ?? failures.find((item) => !item.reference)
            ?? (complete ? null : failures[0] ?? null);
          const status = first?.status ?? "CALIBRATION_RECALL_BELOW_TARGET";
          await setCalibrationStop(first?.unit_id ?? null, status, first?.reason ?? status, first?.diagnostics, {
            failed_units: failures.length, completed_calibration_units: gate.completed_calibration_units,
            calibration_units: gate.calibration_units, failures, gate });
          return summary();
        }
        const records = await Promise.all(calibrationOrder.map(readUnitRecord));
        invariant(records.every(Boolean), "CALIBRATION_UNIT_UNRESOLVED");
        state.calibration = "pass";
        delete state.calibration_round_failures;
        state.blocker = null;
        await save();
      }
      for (const unit of oversizedUnits.filter(item => !calibrationIds.has(item.unit_id)))
        await recordSourceOnly(unit, "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND");
      for (let index = 0; index < frozenPlan.regular_batches.length; index += 1) {
        if (lookahead) {
          const upcoming = frozenPlan.regular_batches.slice(index + 1, index + 1 + semanticConcurrency * 2)
            .map(ids => ({ jobId: `lookahead:batch:${hash(ids.join("\0"))}`,
              build: () => initialExtractionDescriptor(ids) }));
          lookahead.ahead(upcoming);
        }
        if (!(await processBatch(frozenUnits(frozenPlan.regular_batches[index]), false))) return summary();
      }

      const nodes = new Map(), edges = new Map();
      for (const unit of plan.units) {
        const result = await readUnitRecord(unit.unit_id);
        invariant(result, "JOURNAL_EXTRACTION_INCOMPLETE");
        for (const node of result.graph.nodes) {
          if (nodes.has(node.id)) invariant(JSON.stringify(nodes.get(node.id)) === JSON.stringify(node), "GRAPH_ASSEMBLY_ID_COLLISION");
          nodes.set(node.id, node);
        }
        for (const edge of result.graph.edges) {
          if (edges.has(edge.id)) invariant(JSON.stringify(edges.get(edge.id)) === JSON.stringify(edge), "GRAPH_ASSEMBLY_ID_COLLISION");
          edges.set(edge.id, edge);
        }
      }
      const graph = {
        schema_version: "1.0",
        case_id: caseId,
        corpus_id: state.corpus_id,
        generation: state.generation,
        nodes: [...nodes.values()],
        edges: [...edges.values()]
      };
      const representations = Object.fromEntries(plan.parsed.representations.map((item) => [item.representation_id, item.text]));
      validateJournalGraph(graph, representations);
      state.graph_ref = await writeLarge(`assembled:${randomUUID()}`, graph);
      state.persisted = await persistGraphGeneration({
        corpusStore: store,
        graph: { ...graph, generation: `${state.generation}:extracted` },
        sourceRepresentations: representations,
        archiveReferences: [state.original, ...plan.parsed.representations.flatMap((item) => item.visual_image ? [item.visual_image] : [])]
      });
      state.completion.raw_search_available = "pass";
      state.completion.graph_built = "partial";
      state.stage = "RECONCILE";
      state.blocker = null;
      await save();
      return reconcile();
    }

    async function finishArchiveOnly() {
      if (state.stage === "ARCHIVE_ONLY" && state.semantic_disposition === "archive_only") return summary();
      state.semantic_disposition = "archive_only";
      state.completion.graph_built = "archive_only";
      if (state.visual_handoff_ready?.status === "ready") state.visual_handoff_ready.status = "archive_only";
      state.next_action = state.excluded_visual_pages?.length
        ? "Review the listed excluded pages and explicitly retry them in a new import if needed."
        : "Review the archived source and submit a new import if semantic processing is needed.";
      state.stage = "ARCHIVE_ONLY";
      state.blocker = null;
      await save();
      return summary();
    }

    async function recalibrate() {
      invariant(state.calibration === "failed", "JOURNAL_RECALIBRATE_NOT_FAILED");
      // An older checkpoint could close a partial calibration after its graph already existed. A
      // retry there would reopen a gate that later stages assume passed, so it is refused.
      invariant(!state.graph_ref && !state.reconciled_ref && !state.persisted, "JOURNAL_RECALIBRATE_AFTER_GRAPH");
      invariant(Number.isSafeInteger(calibrationEpoch()) && calibrationEpoch() >= 0
        && calibrationEpoch() < Number.MAX_SAFE_INTEGER, "JOURNAL_CALIBRATION_EPOCH_INVALID");
      const failure = state.calibration_failure;
      invariant(failure?.status && failure?.reason, "JOURNAL_CALIBRATION_FAILURE_MISSING");
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      const calibrationIds = new Set(plan.calibration.map((item) => item.unit_id));
      state.calibration_epoch = calibrationEpoch() + 1;
      state.calibration_history ??= [];
      state.calibration_history.push({ epoch: state.calibration_epoch, at: now().toISOString(),
        previous_failure: { status: failure.status, reason: failure.reason,
          ...(failure.diagnostics ? { diagnostics: failure.diagnostics } : {}),
          ...(failure.failures ? { failed_units: failure.failed_units,
            completed_calibration_units: failure.completed_calibration_units,
            calibration_units: failure.calibration_units, failures: failure.failures } : {}),
          ...(failure.gate ? { gate: failure.gate } : {}) } });
      state.calibration = "not_run";
      delete state.calibration_failure;
      delete state.calibration_round_failures;
      delete state.calibration_gate;
      state.blocker = null;
      state.completed_units = state.completed_units.filter((id) => !calibrationIds.has(id));
      await save();
      return summary();
    }

    // Reopens a stopped round under the current run config instead of starting it over: the units it already
    // checked keep their results, and the rest are checked next in the same epoch. Only a round the pooled gate
    // stopped can be reopened, and only when the current config wouldn't have stopped it (for example a critical
    // miss now within a raised limit), so a round that still can't pass stays stopped.
    async function resumeCalibration() {
      invariant(state.calibration === "failed", "JOURNAL_RESUME_CALIBRATION_NOT_FAILED");
      invariant(!state.graph_ref && !state.reconciled_ref && !state.persisted, "JOURNAL_RESUME_CALIBRATION_AFTER_GRAPH");
      const failure = state.calibration_failure;
      const gate = failure?.gate;
      const complete = gate?.completed_calibration_units === gate?.calibration_units;
      invariant(gate && Array.isArray(failure.failures)
        && gate.unscored_units === 0
        && gate.critical_miss_count <= calibrationCriticalMissLimit
        && (calibrationFailureLimit === null || gate.failed_units < calibrationFailureLimit)
        && (!complete || gate.recall_target_met), "JOURNAL_RESUME_CALIBRATION_NOT_ALLOWED");
      state.calibration_resumes ??= [];
      state.calibration_resumes.push({ epoch: calibrationEpoch(), at: now().toISOString(),
        critical_miss_limit: calibrationCriticalMissLimit,
        previous_failure: { status: failure.status, reason: failure.reason, failed_units: failure.failed_units,
          completed_calibration_units: failure.completed_calibration_units, calibration_units: failure.calibration_units,
          gate: structuredClone(gate) } });
      state.calibration = "not_run";
      delete state.calibration_failure;
      delete state.calibration_round_failures;
      delete state.calibration_gate;
      state.blocker = null;
      await save();
      return summary();
    }

    async function run({ visualOnly = false } = {}) {
      if (state.calibration === "failed") return summary();
      // Older checkpoints could finish calibration as partial and then continue. Preserve their
      // saved unit outcome, but close the gate before a resumed run reaches later stages.
      if (state.calibration === "partial") {
        const savedPlan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
        let failedUnit = null, reason = "CALIBRATION_UNIT_UNRESOLVED";
        for (const item of savedPlan.calibration) {
          const record = await readUnitRecord(item.unit_id);
          if (record?.source_only_unresolved) {
            failedUnit = item.unit_id;
            reason = record.source_only_reason ?? reason;
            state.calibration_failure = { unit_id: failedUnit, status: calibrationStopStatus(reason),
              reason: record.source_only_detail ?? reason,
              ...(record.diagnostics ? { diagnostics: record.diagnostics } : {}) };
            break;
          }
        }
        const status = state.calibration_failure?.status ?? calibrationStopStatus(reason);
        state.calibration = "failed";
        state.calibration_failure ??= { unit_id: failedUnit, status, reason };
        state.stage = "REFERENCE_AUDIT";
        state.blocker = status;
        await save();
        return summary();
      }
      if (visualOnly) invariant(!state.graph_ref && !state.semantic_batch_plan_ref
        && state.completed_units.length === 0 && state.calibration === "not_run"
        && ["INTAKE", "PARSE", "PARTITION", "VISUAL_READ", "REFERENCE_AUDIT"].includes(state.stage),
        "JOURNAL_VISUAL_HANDOFF_ALREADY_PASSED");
      await stage();
      if (state.graph_ref) return reconcile();
      const plan = await readLarge(state.parsed_ref);
      // Pages render from the archived original, checked against the configured digest, not from
      // the source path, which could have been replaced since intake.
      let verifiedSource = null;
      const archivedSource = async () => {
        if (verifiedSource) return verifiedSource;
        verifiedSource = await store.reassembleOriginal(state.original);
        invariant(verifiedSource.length === config.source.bytes && hash(verifiedSource) === config.source.sha256, "ORIGINAL_REASSEMBLY_MISMATCH");
        return verifiedSource;
      };
      const excludeVisualPage = async (pageNumber, reason) => {
        state.excluded_visual_pages ??= [];
        if (!state.excluded_visual_pages.includes(pageNumber)) state.excluded_visual_pages.push(pageNumber);
        state.excluded_visual_page_details ??= [];
        if (!state.excluded_visual_page_details.some(item => item.page_number === pageNumber))
          state.excluded_visual_page_details.push({ page_number: pageNumber, reason });
        state.residuals = { ...(state.residuals ?? {}), excluded_visual_pages: state.excluded_visual_pages.length,
          partial_visual_pages: state.partial_visual_pages?.length ?? 0 };
        if (!state.completed_visual_pages.includes(pageNumber)) state.completed_visual_pages.push(pageNumber);
        state.stage = "VISUAL_READ"; state.blocker = null; await save();
      };
      try {
        for (const pageNumber of plan.visual_pages) {
          if (state.completed_visual_pages.includes(pageNumber)) continue;
          const page = plan.parsed.pages.find((p) => p.page_number === pageNumber);
          let imageRef = await readIfPresent(`visual:image-ref:${pageNumber}`);
          let image;
          if (imageRef) image = await store.reassembleOriginal(imageRef);
          else {
            try { image = await renderVisualPage(await archivedSource(), pageNumber); }
            catch (error) {
              if (error?.code !== "VISUAL_RENDER_TOO_LARGE") throw error;
              await excludeVisualPage(pageNumber, error.code);
              continue;
            }
            imageRef = await store.writeChunkedOriginal({ objectId: `visual:image:${pageNumber}`, bytes: image });
            await writeOnce(`visual:image-ref:${pageNumber}`, imageRef);
          }
          const native = plan.parsed.representations.find((r) => r.representation_id === page.representation_id);
          const imageDigest = hash(image);
          const legacyPacketInput = { page_image_ref: { kind: "inline_image", media_type: "image/png",
            data_base64: image.toString("base64"), sha256: imageDigest }, page_geometry: page.geometry,
            native_text_rendering: native.text, neighbor_pages: [] };
          const packetInput = { ...legacyPacketInput, page_image_ref: { kind: "chunked_image", media_type: "image/png",
            object_ref: imageRef, byte_length: image.length, sha256: imageDigest } };
          const read = await checkedWork({ id: `visual:${pageNumber}`, role: "visual_reader", stage: "VISUAL_READ", unit: { unit_id: `page:${pageNumber}`, representation_id: page.representation_id, start_byte: 0, end_byte: image.length, page_number: pageNumber }, packetInput, identityPacketInput: legacyPacketInput },
            ([saved]) => {
              invariant(saved.output.source_page_id === `page:${pageNumber}`, "VISUAL_PAGE_BINDING_MISMATCH");
              // Unreadable regions are valid dispositions; an incomplete inventory is not.
              invariant(saved.output.page_complete === true, "VISUAL_PAGE_INVENTORY_INCOMPLETE");
            });
          if (read.blocked) return summary();
          if (read.failure) {
            // No reading of this page could be bound to it. Its native text, if any, stays in the
            // plan; the page is recorded as excluded from visual reading, not left to stop the run.
            await excludeVisualPage(pageNumber, read.failure);
            continue;
          } else {
            // A complete inventory may still label individual regions uncertain or unreadable.
            await writeOnce(`visual:result:${pageNumber}`, read.result[0]);
            if (read.result[0].output.missing_or_uncertain_regions.length > 0) {
              state.partial_visual_pages ??= [];
              if (!state.partial_visual_pages.includes(pageNumber)) state.partial_visual_pages.push(pageNumber);
            }
          }
          state.residuals = { ...(state.residuals ?? {}), excluded_visual_pages: state.excluded_visual_pages?.length ?? 0,
            partial_visual_pages: state.partial_visual_pages?.length ?? 0 };
          state.completed_visual_pages.push(pageNumber); state.stage = "VISUAL_READ"; state.blocker = null; await save();
        }
      } finally { verifiedSource?.fill(0); }
      if (!state.visual_plan_ref) {
        for (const pageNumber of plan.visual_pages) {
          if (state.excluded_visual_pages?.includes(pageNumber)) continue;
          const visual = await readIfPresent(`visual:result:${pageNumber}`);
          const image = await readIfPresent(`visual:image-ref:${pageNumber}`);
          const text = JSON.stringify(visual.output);
          const representation_id = `visual:${hash(`${config.source.sha256}:${pageNumber}`).slice(0, 40)}`;
          plan.parsed.representations.push({ representation_id, text, utf8_byte_length: Buffer.byteLength(text), visual_page: pageNumber, visual_image: image, interpretation_status: "provisional" });
          for (const unit of partitionRepresentation({ representationId: representation_id, text })) plan.units.push({ ...unit, source_order: plan.units.length, page_number: pageNumber, hazard_types: ["visual_representation"], visual: true });
        }
        // The twelve position windows belong to the original source sequence;
        // appended visual interpretations are additional hazards, not strata.
        plan.calibration = [...nativeCalibration(plan.units.filter(u => !u.visual)),
          ...plan.units.filter(u => u.visual).map(u => ({ unit_id: u.unit_id, source_order: u.source_order, reason: "visual_hazard" }))];
        state.visual_plan_ref = await writeLarge(`visual:plan:${randomUUID()}`, plan);
        state.total_units = plan.units.length; await save();
      } else Object.assign(plan, await readLarge(state.visual_plan_ref));
      // Older checkpoints completed a page before recording this derived count. Rebuild it from
      // durable page results so skipped pages retain their uncertainty on every resume.
      const partialPages = [];
      for (const pageNumber of state.completed_visual_pages) {
        if (state.excluded_visual_pages?.includes(pageNumber)) continue;
        const saved = await readIfPresent(`visual:result:${pageNumber}`);
        if (saved?.output?.missing_or_uncertain_regions?.length > 0) partialPages.push(pageNumber);
      }
      if (JSON.stringify(state.partial_visual_pages ?? []) !== JSON.stringify(partialPages)
        || state.residuals?.partial_visual_pages !== partialPages.length) {
        state.partial_visual_pages = partialPages;
        state.residuals = { ...(state.residuals ?? {}), partial_visual_pages: partialPages.length };
        await save();
      }
      if (plan.units.length === 0) return finishArchiveOnly();
      if (visualOnly) {
        invariant(plan.visual_pages.every((page) => state.completed_visual_pages.includes(page)),
          "JOURNAL_VISUAL_HANDOFF_INCOMPLETE");
        state.visual_handoff_ready = { schema_version: 1, status: "ready", visual_plan_ref: state.visual_plan_ref,
          admitted: state.completed_visual_pages.filter(page => !state.excluded_visual_pages?.includes(page)).length,
          excluded: state.excluded_visual_pages?.length ?? 0 };
        state.stage = "REFERENCE_AUDIT";
        state.next_action = "Resume source-position calibration from this saved visual plan with the integrated semantic runtime.";
        state.blocker = null;
        await save();
        return summary();
      }
      return runBatched(plan);
    }

    async function reconcile() {
      invariant(state.graph_ref, 'JOURNAL_GRAPH_NOT_READY');
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      if (plan.units.length === 0) return finishArchiveOnly();
      invariant(state.calibration === "pass", 'JOURNAL_GRAPH_NOT_READY');
      if (state.reconciled_ref) return summary();
      let graph = await readLarge(state.graph_ref);
      const unitGraphs = new Map(), aliases = new Map();
      const unitIndex = new Map(plan.units.map((unit, index) => [unit.unit_id, index]));
      for (const unit of plan.units) {
        const record = await readUnitRecord(unit.unit_id);
        invariant(record, 'JOURNAL_EXTRACTION_INCOMPLETE');
        unitGraphs.set(unit.unit_id, record);
        for (const node of record.graph.nodes) if (node.kind === 'entity') {
          const label = node.data.label.normalize('NFKC').toLocaleLowerCase('und');
          if (!aliases.has(label)) aliases.set(label, []);
          const members = aliases.get(label);
          if (members.at(-1) !== unit.unit_id) members.push(unit.unit_id);
        }
      }
      if (!state.reconciliation_mode) {
        let legacy = false;
        for (const unit of plan.units) {
          if (await readIfPresent('reconcile:result:' + unit.unit_id)) {
            legacy = true;
            break;
          }
        }
        state.reconciliation_mode = legacy ? 'per_unit_v1' : 'batched_v1';
        await save();
      }
      invariant(['per_unit_v1', 'batched_v1'].includes(state.reconciliation_mode),
        'JOURNAL_RECONCILIATION_MODE_INVALID');
      let batchIds;
      if (state.reconciliation_mode === 'per_unit_v1') {
        batchIds = plan.units.map(unit => [unit.unit_id]);
      } else if (state.reconciliation_batch_plan_ref) {
        const frozen = await readLarge(state.reconciliation_batch_plan_ref);
        invariant(frozen.schema_version === 1
          && frozen.source_unit_ids.join("\0") === plan.units.map(unit => unit.unit_id).join("\0")
          && frozen.batches.flat().join("\0") === frozen.source_unit_ids.join("\0"),
          'JOURNAL_RECONCILIATION_PLAN_MISMATCH');
        batchIds = frozen.batches;
      } else {
        const batchConfig = config.semantic_batching ?? {};
        const maximumBytes = batchConfig.reconciliation_maximum_bytes ?? 32_000;
        const maximumUnits = batchConfig.reconciliation_maximum_units ?? 8;
        invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 4096,
          'SEMANTIC_BATCH_BYTES_INVALID');
        invariant(Number.isSafeInteger(maximumUnits) && maximumUnits >= 1,
          'SEMANTIC_BATCH_COUNT_INVALID');
        batchIds = [];
        let pending = [];
        const flush = () => {
          if (!pending.length) return;
          batchIds.push(...createJournalSemanticBatches({ units: pending, maximumBytes, maximumUnits })
            .map(batch => batch.unit_ids));
          pending = [];
        };
        for (const unit of plan.units) {
          if (unitGraphs.get(unit.unit_id).source_only_unresolved || journalSemanticUnitCost(unit) > maximumBytes) {
            flush();
            batchIds.push([unit.unit_id]);
          } else pending.push(unit);
        }
        flush();
        state.reconciliation_batch_plan_ref = await writeLarge(
          'reconciliation:batch-plan:' + randomUUID(),
          { schema_version: 1, source_unit_ids: plan.units.map(unit => unit.unit_id), batches: batchIds });
        await save();
      }
      const queue = batchIds.map(ids => ({ units: ids.map(id => {
        const unit = plan.units[unitIndex.get(id)];
        invariant(unit?.unit_id === id, 'JOURNAL_RECONCILIATION_PLAN_MISMATCH');
        return unit;
      }) }));
      const reports = [];
      while (queue.length) {
        const batch = queue.shift();
        const unitIds = batch.units.map(unit => unit.unit_id);
        const keyId = hash(JSON.stringify(unitIds)).slice(0, 40);
        const batchRef = 'reconcile:batch:result:' + keyId;
        let saved = await readIfPresent(batchRef);
        let savedRef = batchRef;
        if (!saved && state.reconciliation_mode === 'per_unit_v1') {
          savedRef = 'reconcile:result:' + unitIds[0];
          saved = await readIfPresent(savedRef);
        }
        if (!saved && state.reconciliation_mode === 'per_unit_v1') {
          // A legacy unit may already have an unknown submitted result.
          state.stage = 'RECONCILE';
          state.blocker = 'JOURNAL_LEGACY_RECONCILIATION_MIGRATION_REQUIRED';
          await save();
          return summary();
        }
        if (!saved && batch.units.some(unit => unitGraphs.get(unit.unit_id).source_only_unresolved)) {
          if (batch.units.length > 1) {
            for (const unit of [...batch.units].reverse()) queue.unshift({ units: [unit] });
            continue;
          }
          saved = await writeOnce(batchRef, { source_only: true,
            reason: unitGraphs.get(unitIds[0]).source_only_reason ?? 'SOURCE_ONLY_UNRESOLVED',
            selected_unit_ids: unitIds, neighborhood_complete: false, batch_unit_ids: unitIds });
        }
        if (!saved) {
          const selected = new Set(unitIds), omittedNeighbors = new Set();
          for (const unit of batch.units) {
            const index = unitIndex.get(unit.unit_id);
            for (const neighbor of [plan.units[index - 1], plan.units[index + 1]])
              if (neighbor) selected.add(neighbor.unit_id);
            for (const node of unitGraphs.get(unit.unit_id).graph.nodes) if (node.kind === 'entity') {
              const members = aliases.get(node.data.label.normalize('NFKC').toLocaleLowerCase('und')) ?? [];
              for (const candidate of [members[0], members.at(-1)])
                if (candidate) selected.add(candidate);
              for (const candidate of members)
                if (!selected.has(candidate)) omittedNeighbors.add(candidate);
            }
          }
          for (const id of selected) omittedNeighbors.delete(id);
          const collect = ids => {
            const nodes = new Map(), edges = new Map();
            for (const id of ids) {
              const part = unitGraphs.get(id).graph;
              for (const node of part.nodes) nodes.set(node.id, node);
              for (const edge of part.edges) edges.set(edge.id, edge);
            }
            return { ...graph, nodes: [...nodes.values()], edges: [...edges.values()] };
          };
          const candidates = collect(unitIds);
          const neighborhood = collect(selected);
          const input = {
            candidates,
            neighborhood_evidence: {
              graph: neighborhood,
              relation_contract: JOURNAL_GRAPH_CONTRACT.relations,
              scope: state.reconciliation_mode === 'per_unit_v1'
                ? 'Adjacent source units and first/last exact-label candidate occurrences; no identity is inferred by selection.'
                : 'Batch source units, adjacent units and first/last exact-label occurrences; no identity is inferred by selection.',
              more_available: omittedNeighbors.size > 0,
              unexamined_unit_count: omittedNeighbors.size
            },
            target_generation: state.generation
          };
          const scope = {
            selected_unit_ids: [...selected],
            neighborhood_complete: omittedNeighbors.size === 0,
            batch_unit_ids: unitIds
          };
          if (Buffer.byteLength(JSON.stringify(input)) > 180_000 && batch.units.length > 1) {
            const middle = Math.ceil(batch.units.length / 2);
            queue.unshift({ units: batch.units.slice(middle) });
            queue.unshift({ units: batch.units.slice(0, middle) });
            continue;
          }
          if (Buffer.byteLength(JSON.stringify(input)) > 180_000) {
            saved = await writeOnce(batchRef, { unresolved: 'JOURNAL_RECONCILIATION_PACKET_OVERSIZE', ...scope });
            savedRef = batchRef;
          }
          if (!saved) {
            const reconciled = await checkedWork({
              id: state.reconciliation_mode === 'per_unit_v1'
                ? 'reconcile:' + unitIds[0] : 'reconcile:batch:' + keyId,
              role: 'reconciler',
              stage: 'RECONCILE',
              ...(state.reconciliation_mode === 'per_unit_v1'
                ? { unit: batch.units[0] } : { units: batch.units }),
              packetInput: input,
              acceptReviewFindings: true
            }, ([primary]) => {
              validateReconciliationResult(primary.output, neighborhood);
              // Application checks the receipt again on resume. Reject a bad durable receipt
              // within this attempt so it cannot throw at the later graph-application step.
              applyReconciliationResult({ graph, result: primary.output, receipt: primary.receipt });
            });
            if (reconciled.blocked) return summary();
            // No attempt gave a usable proposal set: the batch's identities and relations stay as
            // extracted, unreconciled, which leaves the graph valid; the report counts it.
            saved = await writeOnce(batchRef, reconciled.failure
              ? { unresolved: reconciled.failure, ...scope }
              : { ...reconciled.result[0], ...scope });
            savedRef = batchRef;
          }
        }
        for (const unit of batch.units) {
          if (!(await readIfPresent('reconcile:result:' + unit.unit_id)))
            await writeOnce('reconcile:result:' + unit.unit_id, saved);
        }
        const applied = saved.source_only
          ? { graph, status: 'source_only', unresolved_ids: [], deferred_proposals: [] }
          : saved.unresolved
          ? { graph, status: 'unresolved', unresolved_ids: [], deferred_proposals: [] }
          : applyReconciliationResult({ graph, result: saved.output, receipt: saved.receipt });
        graph = applied.graph;
        state.reconciliation_completed ??= [];
        for (const unit of batch.units) {
          reports.push({
            unit_id: unit.unit_id,
            batch_ref: savedRef,
            status: applied.status,
            unresolved_ids: applied.unresolved_ids,
            deferred_proposals: applied.deferred_proposals,
            neighborhood_complete: saved.neighborhood_complete,
            receipt_ref: saved.receipt?.receipt_id ?? null,
            ...(saved.unresolved ? { reason: saved.unresolved } : {})
          });
          if (!state.reconciliation_completed.includes(unit.unit_id))
            state.reconciliation_completed.push(unit.unit_id);
        }
        state.stage = 'RECONCILE';
        await save();
      }
      const representations = Object.fromEntries(
        plan.parsed.representations.map(item => [item.representation_id, item.text]));
      validateJournalGraph(graph, representations);
      state.reconciled_ref = await writeLarge('reconciled:' + randomUUID(), graph);
      state.reconciliation_report_ref = await writeLarge(
        'reconciliation:report:' + randomUUID(), reports);
      state.graph_ref = state.reconciled_ref;
      // The graph is built once every unit has been through reconciliation. What reconciliation could
      // not settle from its bounded view (needs_context), or could not propose at all, stays
      // unresolved and is counted, as the reconciler's contract intends. A unit whose extraction stayed
      // unresolved, or that kept its extraction with flagged items withheld, leaves the graph partial.
      const unitRecords = [...unitGraphs.values()];
      const sourceOnlyUnits = unitRecords.filter(record => record.source_only_unresolved).length;
      const residualUnits = unitRecords.filter(record => !record.source_only_unresolved && record.review_residuals);
      state.completion.graph_built = sourceOnlyUnits > 0 || residualUnits.length > 0 ? 'partial' : 'pass';
      const reconciliationBatches = new Map();
      for (const report of reports) reconciliationBatches.set(report.batch_ref, report);
      const residualTotal = (field) => residualUnits.reduce((sum, record) => sum + (record.review_residuals[field] ?? 0), 0);
      state.residuals = { ...(state.residuals ?? {}),
        source_only_units: sourceOnlyUnits,
        review_residual_units: residualUnits.length,
        review_withheld_assertions: residualTotal('withheld_assertions'),
        review_omission_gaps: residualTotal('omission_gaps'),
        reconciliation_needs_context_units: reports.filter(report => report.status === 'needs_context').length,
        reconciliation_unresolved_units: reports.filter(report => report.status === 'unresolved').length,
        reconciliation_unresolved_ids: new Set([...reconciliationBatches.values()]
          .flatMap(report => report.unresolved_ids)).size,
        reconciliation_deferred_proposals: [...reconciliationBatches.values()]
          .reduce((count, report) => count + report.deferred_proposals.length, 0) };
      state.stage = 'REFERENCE_AUDIT';
      state.blocker = null;
      await save();
      return summary();
    }

    async function audit() {
      invariant(state.calibration === "pass" && state.reconciled_ref, "JOURNAL_RECONCILIATION_NOT_READY");
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      const frozenGraph = await readLarge(state.graph_ref);
      const scopeIndex = createAuditScopeIndex(frozenGraph);
      const graphRevision = hash(JSON.stringify(frozenGraph));
      if (!state.audit_sample_ref) {
        const units = plan.units.map(u => ({ ...u, duplicate_group_id: `duplicate:${hash(u.text)}` }));
        const sample = createDeterministicAuditSample({ units, seed: randomBytes(32).toString("hex") });
        state.audit_sample_ref = await writeLarge(`audit:sample:${randomUUID()}`, sample);
        state.audit_completed = []; await save();
      }
      const sample = await readLarge(state.audit_sample_ref);
      const selected = new Set([...sample.selected_units.map(u => u.unit_id), ...sample.targeted_challenge.map(u => u.unit_id)]);
      const referenceRequestFor = (unit, visual) => ({
        id: `reference:final:${unit.unit_id}`, role: "reference_reader", stage: "REFERENCE_AUDIT", unit,
        packetInput: { source_windows: [{ unit_id: unit.unit_id, text: unit.text }],
          adjacent_context: unit.context, visual_context: visual ? [visual.output] : [],
          neutral_reading_instructions: [] }
      });
      const checkReferenceAnchors = (unit, output) => {
        for (const item of output.reference_items) for (const anchor of item.anchors) {
          invariant(anchor.unit_id === unit.unit_id, "REFERENCE_ANCHOR_OUTSIDE_SOURCE_PACKET");
          resolveExactQuote(unit.text, anchor.quote, anchor.occurrence);
        }
      };
      const fidelityRequestFor = (unit, reference, scope) => ({
        id: `fidelity:final:${unit.unit_id}`, role: "fidelity_auditor", stage: "REFERENCE_AUDIT", unit,
        packetInput: { frozen_reference: reference,
          supporting_passages: [{ unit_id: unit.unit_id, text: unit.text }, ...scope.supporting_passages],
          imported_generation: { generation: state.generation, graph: scope.graph,
            assessment_target_ids: scope.assessment_target_ids } }
      });
      const auditDescriptor = async (unit) => {
        if (await readIfPresent(`audit:result:${graphRevision}:${unit.unit_id}`)) return null;
        // The same epoch-aware record the sequential audit reads (a recalibrated unit's record is epoch-scoped).
        const imported = await readUnitRecord(unit.unit_id);
        if (!imported || imported.source_only_unresolved) return null;
        const visual = await readIfPresent(`visual:result:${unit.page_number}`);
        const request = referenceRequestFor(unit, visual);
        return { jobId: journalJobId(request), request,
          next: async (reference) => {
            checkReferenceAnchors(unit, reference);
            const reconciliation = await readIfPresent(`reconcile:result:${unit.unit_id}`);
            const scope = createReconciledAuditScope({ graph: frozenGraph, unitGraph: imported.graph,
              derivationRef: reconciliation?.receipt?.receipt_id, index: scopeIndex });
            const nextRequest = fidelityRequestFor(unit, reference, scope);
            return { jobId: journalJobId(nextRequest), request: nextRequest };
          } };
      };
      const reports = [];
      const auditUnits = plan.units.filter(u => selected.has(u.unit_id));
      for (let index = 0; index < auditUnits.length; index += 1) {
        const unit = auditUnits[index];
        if (lookahead) {
          const upcoming = auditUnits.slice(index + 1, index + 1 + semanticConcurrency * 2)
            .map(nextUnit => ({ jobId: `lookahead:audit:${nextUnit.unit_id}`,
              build: () => auditDescriptor(nextUnit) }));
          lookahead.ahead(upcoming);
        }
        let report = await readIfPresent(`audit:result:${graphRevision}:${unit.unit_id}`);
        if (!report) {
          const imported = await readUnitRecord(unit.unit_id);
          if (imported.source_only_unresolved) {
            const reconciliation = await readIfPresent(`reconcile:result:${unit.unit_id}`);
            const scope = createReconciledAuditScope({ graph: frozenGraph, unitGraph: imported.graph,
              derivationRef: reconciliation?.receipt?.receipt_id, index: scopeIndex });
            report = await writeOnce(`audit:result:${graphRevision}:${unit.unit_id}`, {
              graph_revision: graphRevision, source_only_unresolved: true,
              calibration_overlap: plan.calibration.some(u => u.unit_id === unit.unit_id),
              unassessed: imported.source_only_reason ?? "SOURCE_ONLY_UNRESOLVED",
              untrusted_candidate_ids: scope.exclusion_ids });
          } else {
            const visual = await readIfPresent(`visual:result:${unit.page_number}`);
            const frozen = await checkedWork(referenceRequestFor(unit, visual),
              ([saved]) => checkReferenceAnchors(unit, saved.output));
            if (frozen.blocked) return summary();
            const reconciliation = await readIfPresent(`reconcile:result:${unit.unit_id}`);
            const scope = createReconciledAuditScope({ graph: frozenGraph, unitGraph: imported.graph,
              derivationRef: reconciliation?.receipt?.receipt_id, index: scopeIndex });
            const common = { graph_revision: graphRevision, source_only_unresolved: imported.source_only_unresolved, calibration_overlap: plan.calibration.some(u => u.unit_id === unit.unit_id) };
            // Even without a valid reference freeze, the deterministic graph scope is known and must
            // not cross into the session-use generation without an audit.
            let outcome = frozen.failure ? { untrusted_candidate_ids: scope.exclusion_ids } : null;
            let unassessed = frozen.failure ?? null;
            if (!unassessed) {
              const reference = frozen.result[0];
              const freeze = { generation: state.generation, reference: reference.output, receipt: reference.receipt, freeze_ref: `freeze:${hash(JSON.stringify(reference.output)).slice(0, 40)}` };
              const assess = ([saved]) => ({
                certification: certifyIndependentAudit({ generation: state.generation, referenceFreeze: freeze, fidelityOutput: saved.output, fidelityReceipt: saved.receipt, producerReceipt: imported.extraction.receipt, grantId: grant.grant_id }),
                score: scoreReferenceReview({ referenceResult: freeze.reference, reviewResult: saved.output, candidateIds: scope.assessment_target_ids }),
                coverage: summarizeFidelityCoverage({ reference: freeze.reference, review: saved.output, candidateIds: scope.assessment_target_ids })
              });
              let assessedOutcome;
              const fidelity = await checkedWork(fidelityRequestFor(unit, reference.output, scope),
                saved => { assessedOutcome = assess(saved); });
              if (fidelity.blocked) return summary();
              if (fidelity.failure) {
                unassessed = fidelity.failure;
                // The source-first freeze is still evidence even when no fidelity attempt succeeds.
                // Keep its reference weight in the sample denominator, and withhold the unit's
                // semantic records and reconciled relations.
                outcome = {
                  freeze,
                  score: {
                    reference_total: freeze.reference.reference_items.length,
                    reference_counts: { preserved: 0, omitted: 0, distorted: 0, unassessed: freeze.reference.reference_items.length },
                    critical_miss_count: freeze.reference.reference_items.filter(item => item.critical).length,
                    qualifier_error_count: 0
                  },
                  untrusted_candidate_ids: scope.exclusion_ids
                };
              }
              else {
                // A sampled unit reaches session use only through a complete, passing audit.
                outcome = { freeze, fidelity: fidelity.result[0], ...assessedOutcome,
                  ...(assessedOutcome.certification.semantically_audited === "pass" && assessedOutcome.coverage.complete === true
                    && assessedOutcome.coverage.repair_required !== true
                    ? {} : { untrusted_candidate_ids: scope.exclusion_ids }) };
              }
            }
            // A unit no attempt could audit is recorded as unassessed, with the reason, and counted.
            report = await writeOnce(`audit:result:${graphRevision}:${unit.unit_id}`, outcome ? { ...common, ...outcome, ...(unassessed ? { unassessed } : {}) } : { ...common, unassessed });
          }
        }
        reports.push({ unit_id: unit.unit_id, ...report });
        if (!state.audit_completed.includes(unit.unit_id)) { state.audit_completed.push(unit.unit_id); state.stage = "REFERENCE_AUDIT"; await save(); }
      }
      const probability = new Map(sample.inclusion_ledger.map(x => [x.unit_id, x.inclusion_probability]));
      const totals = (items, weighted) => items.reduce((out, r) => {
        const weight = weighted ? 1 / probability.get(r.unit_id) : 1;
        for (const key of ["preserved", "omitted", "distorted", "unassessed"]) out[key] += r.score.reference_counts[key] * weight;
        out.critical_misses += r.score.critical_miss_count * weight; out.qualifier_errors += r.score.qualifier_error_count * weight; return out;
      }, { preserved: 0, omitted: 0, distorted: 0, unassessed: 0, critical_misses: 0, qualifier_errors: 0 });
      const assessed = reports.filter(r => !r.unassessed
        && !r.freeze?.reference?.unassessed_unit_ids?.includes(r.unit_id));
      // A successful reference freeze followed by failed fidelity has a real reference denominator,
      // represented entirely as unassessed. A failed freeze has no trustworthy item count to add.
      const sampled = reports.filter(r => probability.has(r.unit_id) && r.score);
      const targeted = new Set(sample.targeted_challenge.map(x => x.unit_id));
      const auditReport = { generation: state.generation, graph_sha256: graphRevision, probability_unweighted: totals(sampled, false), probability_weighted: totals(sampled, true), targeted_unweighted: totals(reports.filter(r => targeted.has(r.unit_id) && r.score), false), unassessed_unit_count: reports.length - assessed.length, population_recall_claim: false, reference_completeness: "unknown", reports };
      state.audit_report_ref = await writeLarge(`audit:report:${randomUUID()}`, auditReport);
      state.completion.semantically_audited = reports.every(r => !r.unassessed
        && r.certification.semantically_audited === "pass" && r.coverage.complete
        && !r.coverage.repair_required) ? "pass" : "partial";
      // Findings are recorded and counted rather than stopping the run: the audit measures a sample
      // of the extraction, and the report carries what it found.
      state.audit_repair_required = assessed.some(r => r.coverage.repair_required || !r.coverage.complete);
      const unassessedReferenceItems = new Set();
      for (const report of reports) {
        const items = report.freeze?.reference?.reference_items ?? [];
        const assessedIds = new Set(report.fidelity?.output?.assessments
          ?.filter(item => item.outcome !== "unassessed").map(item => item.target_id) ?? []);
        for (const item of items) if (!assessedIds.has(item.id))
          unassessedReferenceItems.add(`${report.unit_id}\0${item.id}`);
      }
      state.residuals = { ...(state.residuals ?? {}),
        audit_unassessed_units: reports.length - assessed.length,
        audit_untrusted_units: reports.filter(r => r.unassessed
          || r.certification?.semantically_audited !== "pass"
          || r.coverage?.complete !== true || r.coverage?.repair_required === true).length,
        audit_unassessed_reference_items: unassessedReferenceItems.size,
        audit_repair_units: assessed.filter(r => r.coverage.repair_required || !r.coverage.complete).length };
      state.stage = "PATTERN_BUILD";
      state.blocker = null;
      await save(); return summary();
    }

    async function patterns() {
      // Patterns are built once the graph is reconciled and audited, whether or not either finished
      // with residuals; those are counted in the report, not a reason to withhold the register.
      invariant(state.calibration === "pass" && state.reconciled_ref && state.audit_report_ref
        && ["pass", "partial"].includes(state.completion.graph_built)
        && ["pass", "partial"].includes(state.completion.semantically_audited),
        "JOURNAL_PATTERN_SOURCE_NOT_READY");
      if (state.reviewed_graph_ref) return summary();
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      const auditReport = await readLarge(state.audit_report_ref);
      const reconciledGraph = await readLarge(state.reconciled_ref);
      const scopeIndex = createAuditScopeIndex(reconciledGraph);
      const untrusted = new Set();
      // Unchecked native reading order and tables remain in the archive and raw index.
      // Their semantic claims need a complete visual inventory before session admission.
      for (const unit of plan.units) {
        if (unit.visual) continue;
        const page = plan.parsed.pages.find(item => item.representation_id === unit.representation_id);
        const requiresVisual = page ? plan.visual_pages.includes(page.page_number)
          : !plan.parsed.source.mime_type?.startsWith("text/plain");
        if (!requiresVisual) continue;
        const visual = page && !state.excluded_visual_pages?.includes(page.page_number)
          ? await readIfPresent(`visual:result:${page.page_number}`) : null;
        if (visual?.output?.page_complete === true) continue;
        const imported = await readUnitRecord(unit.unit_id);
        invariant(imported, "JOURNAL_PATTERN_UNIT_UNRESOLVED");
        for (const node of imported.graph.nodes) if (["entity", "episode", "assertion"].includes(node.kind))
          untrusted.add(node.id);
      }
      for (const report of auditReport.reports) {
        for (const id of [...(report.coverage?.untrusted_candidate_ids ?? []),
          ...(report.untrusted_candidate_ids ?? [])]) untrusted.add(id);
        // A sampled unit reaches session use only through a complete, passing audit,
        // judged from its report when the patterns stage runs.
        if (Object.hasOwn(report, "unassessed") || report.certification?.semantically_audited !== "pass"
          || report.coverage?.complete !== true || report.coverage?.repair_required === true) {
          const imported = await readUnitRecord(report.unit_id);
          invariant(imported, "JOURNAL_PATTERN_UNIT_UNRESOLVED");
          const reconciliation = await readIfPresent(`reconcile:result:${report.unit_id}`);
          const scope = createReconciledAuditScope({ graph: reconciledGraph, unitGraph: imported.graph,
            derivationRef: reconciliation?.receipt?.receipt_id, index: scopeIndex });
          for (const id of scope.exclusion_ids) untrusted.add(id);
        }
      }
      const excludeUntrusted = (candidateGraph) => ({
        ...candidateGraph,
        nodes: candidateGraph.nodes.filter(node => !untrusted.has(node.id)),
        edges: candidateGraph.edges.filter(edge => !untrusted.has(edge.id)
          && !untrusted.has(edge.from) && !untrusted.has(edge.to))
      });
      // Audit failures never cross into the session-use generation. This is an exclusion rather
      // than a staging-only warning, so every consumer sees the same safe graph.
      const graph = excludeUntrusted(reconciledGraph);
      // A unit whose extraction stayed unresolved has no assertions to build patterns from.
      const units = [];
      const unitGraphs = [];
      for (const unit of plan.units) {
        const record = await readUnitRecord(unit.unit_id);
        invariant(record, "JOURNAL_PATTERN_UNIT_UNRESOLVED");
        if (record.source_only_unresolved) continue;
        units.push(unit);
        unitGraphs.push({ unit_id: unit.unit_id, graph: excludeUntrusted(record.graph) });
      }
      const reader = await openPrivateJournalGraph({ corpusStore: store,
        manifestObjectId: state.persisted.manifest_object_id, caseId,
        corpusId: state.corpus_id, generation: state.persisted.manifest.generation,
        visibilityEpoch: state.persisted.manifest.visibility_epoch, cursorSecret: key });
      let result;
      try {
        result = await runJournalPatternPass({
          graph, units, unitGraphs, sourceReader: reader, work,
          stepFailure: () => (workExhausted ? state.blocker : null),
          hardestLaneEnabled: hardestLane.enabled,
          readIfPresent, writeOnce, counterReceiptSecret: key,
          generation: state.generation,
          representations: Object.fromEntries(plan.parsed.representations.map(item =>
            [item.representation_id, item.text]))
        });
      } finally { reader.close(); }
      if (result.status === "blocked") return summary();
      state.reviewed_graph_ref = await writeLarge(`pattern:reviewed:${randomUUID()}`, result.graph);
      state.pattern_report_ref = await writeLarge(`pattern:report:${randomUUID()}`,
        { batches: result.batches, reports: result.reports, status: result.status, counts: result.counts });
      // Pass: every candidate's review was settled, as reviewed or disputed. Partial: some batch or
      // review stayed unresolved; the counts say how many, and the register holds only what was
      // reviewed.
      state.completion.patterns_reviewed = result.status;
      state.residuals = { ...(state.residuals ?? {}), audit_excluded_records: untrusted.size, ...result.counts,
        hardest_attempted: (state.residuals?.hardest_attempted ?? 0) + (result.counts.hardest_attempted ?? 0),
        hardest_resolved: (state.residuals?.hardest_resolved ?? 0) + (result.counts.hardest_resolved ?? 0) };
      state.stage = "COMMIT";
      state.blocker = null;
      await save();
      return summary();
    }

    async function commit() {
      // Calibration must pass. Later stages may commit resolved work with counted partial
      // outcomes (source-only units, audit findings, or unresolved pattern batches).
      const finished = (status) => ["pass", "partial"].includes(status);
      invariant(state.calibration === "pass" && state.completion.archive_verified === "pass"
        && state.completion.raw_search_available === "pass" && finished(state.completion.graph_built)
        && finished(state.completion.semantically_audited) && finished(state.completion.patterns_reviewed)
        && state.reviewed_graph_ref,
        "JOURNAL_REVIEWED_GENERATION_NOT_READY");
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      invariant(plan.units.every(u => state.completed_units.includes(u.unit_id))
        && plan.visual_pages.every(p => state.completed_visual_pages.includes(p)), "JOURNAL_WORK_INCOMPLETE");
      const auditReport = await readLarge(state.audit_report_ref);
      invariant(auditReport.graph_sha256 === hash(JSON.stringify(await readLarge(state.reconciled_ref))), "JOURNAL_AUDIT_GENERATION_STALE");
      const graph = await readLarge(state.reviewed_graph_ref);
      invariant(graph.generation === state.generation, "JOURNAL_GENERATION_MISMATCH");
      const representations = Object.fromEntries(plan.parsed.representations.map(r => [r.representation_id,r.text]));
      validateJournalGraph(graph, representations);
      if (!state.reviewed_persisted) {
        state.reviewed_persisted = await persistGraphGeneration({ corpusStore: store, graph,
          sourceRepresentations: representations, permittedUses: ["archive","organize_search","session_use"],
          archiveReferences: [state.original, ...plan.parsed.representations.flatMap(r => r.visual_image ? [r.visual_image] : [])] });
        await save();
      }
      invariant(state.reviewed_persisted.manifest.graph_sha256 === hash(JSON.stringify(graph)), "JOURNAL_PUBLICATION_GENERATION_STALE");
      await authorize();
      // Publication writes the case vault. Hold the vault root's writer lock, the one the one-shot
      // operator takes, so the two can't change the same vault at once. (When the vault root is the
      // execution root, this runtime already holds that lock.)
      const publish = () => publishJournalGenerationFromStaging({ service, sourceStore: store,
        persisted: state.reviewed_persisted, auth, authorize });
      const receipt = typeof service.rootDir === "string"
        ? await withPrivateRootWriterLock({ rootDir: service.rootDir, heldRootDir: root }, publish)
        : await publish();
      state.profile_commit_ref = await writeLarge(`profile:commit:${randomUUID()}`, receipt);
      state.completion.profile_committed = receipt.profile_committed ? "pass" : "not_run";
      state.stage = "COLD_TEST";
      state.blocker = receipt.legacy_state_unchanged ? null : "JOURNAL_LEGACY_PRESERVATION_RECHECK_REQUIRED";
      await save(); return summary();
    }

    // The quote index (plan 2026-10-09-journal-quote-first.md): the staged source split into exact
    // paragraph quotes with the date lines they were written under, kept as its own corpus so
    // InnerSignal can answer from the person's own words while the semantic import goes on. It is
    // mechanical: no model reads or writes it, and the import's corpus, generation and calibration
    // are untouched. `build-quotes` stages it in the execution root; `publish-quotes` also publishes
    // it to the case. Publish only once the connector serves the journal read tools: a case with a
    // journal corpus is not continuation-safe for a consumer that can't read one.
    //
    // The generation is named for the quote index version and how it read numeric dates, so a new
    // version or a changed `quote_numeric_date_order` builds a new generation. The run state keeps the
    // generation this runtime last published (`quote_published`), apart from the latest build: a build
    // of any other generation records that one as `supersedes`, and publishing replaces exactly that
    // one. Rebuilding the published generation itself (a setting changed and changed back) replaces
    // nothing, however many builds came in between.
    // The pages a quote generation is built from, read once per command.
    let quoteSourceCache = null;
    const quoteSource = async () => {
      const ref = JSON.stringify(state.parsed_ref);
      if (quoteSourceCache?.ref !== ref) {
        const plan = await readLarge(state.parsed_ref);
        quoteSourceCache = { ref, mediaType: plan.parsed.source.mime_type, representations: plan.parsed.representations.map((representation) => {
          const page = plan.parsed.pages.find((p) => p.representation_id === representation.representation_id);
          return { representation_id: representation.representation_id, text: representation.text,
            page_number: page?.page_number ?? null, parse_status: parseStatus(page, plan.parsed.source.mime_type) };
        }) };
      }
      return quoteSourceCache;
    };
    // buildQuoteGeneration's input for a generation of the quote corpus: the quote index's own, or a pointer pass's. The index
    // version it is built as follows from the generation's name, so a generation named for version 2 (the one published before
    // version 3, and every pointer run) is rebuilt exactly as it was.
    const quoteGenerationInput = async (generation) => {
      const { mediaType, representations } = await quoteSource();
      return { caseId, corpusId: `${state.corpus_id}:quotes`, generation, originalObjectId: state.original.object_id, mediaType, representations,
        dateOptions: { numericOrder: quoteNumericDateOrder }, version: quoteIndexVersionOf(generation) };
    };

    // The quote index's generation: its version and how it reads all-numeric dates.
    const quoteIndexGeneration = () => `${state.generation}:quotes:${QUOTE_INDEX_VERSION}-${quoteNumericDateOrder.replace("_", "-")}`;
    // A pointer run's own generation is named for version 2 (owner decision 38: B), not for the index version, so its steps rebuild
    // the quotes the way the run started.
    const pointerBaseGeneration = () => `${state.generation}:quotes:${QUOTE_POINTER_VERSION}-${quoteNumericDateOrder.replace("_", "-")}`;

    // The private reading stage is explicitly opt-in on NEW generations.
    // It does not re-run historical refusals or change live legacy imports.
    async function readSource() {
      invariant(importOrder === "reading_first", "JOURNAL_READING_FIRST_ORDER_REQUIRED");
      await stage();
      invariant(state.parsed_ref && state.original, "JOURNAL_SOURCE_NOT_STAGED");
      if (state.reading_first_receipts_ref) return summary();

      const sourcePlan = await readLarge(state.parsed_ref);
      const byRepresentation = new Map(
        sourcePlan.parsed.representations.map(p => [p.representation_id,p.text]));
      const pages = [...sourcePlan.parsed.pages]
        .sort((a,b) => a.page_number-b.page_number)
        .map((p,i) => {
          invariant(p.page_number === i+1, "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
          const text=byRepresentation.get(p.representation_id) ?? "";
          const needsVisual = p.disposition !== "readable"
            || (Array.isArray(p.image_inventory) && p.image_inventory.length > 0);
          const required_modalities = needsVisual
            ? (text.trim().length > 0 ? "text+image" : "image") : "text";
          // For readable text this digest binds the exact source representation
          // extracted from the authenticated immutable source archive. Images
          // are pending, and their placeholder digest never claims review.
          const source_page_sha256 = required_modalities === "text"
            ? hash(text)
            : hash(JSON.stringify({ original_source_sha256:state.source_sha256,
              source_page_number:p.page_number, representation_id:p.representation_id }));
          return { page:p.page_number, text,source_page_sha256,required_modalities };
        });
      invariant(pages.length>0, "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");

      const attestationKey=readingFirstAttestationKey(key);
      try {
        const adapter=createReadingFirstPortAdapter({
          port,grant,generation:state.generation,
          sourceSha256:state.source_sha256,
          // These are protected encrypted store references, never public URLs.
          readEvidence:ref=>readIfPresent(ref),
          knownState:{ source_scope:"journal_only",
            case_history_comparison:"pending_separate_authorized_step" }
        });
        const reader=async request=>{
          const denialId="reading-first:denial:"+request.page;
          const previous=await readIfPresent(denialId);
          if(previous?.status==="source_tool_refused")
            throw new ValidationError("JOURNAL_SOURCE_TOOL_REFUSED",{code:"JOURNAL_SOURCE_TOOL_REFUSED"});
          try{return await adapter.reader(request);}
          catch(error){
            if(error?.code==="JOURNAL_SOURCE_TOOL_REFUSED")
              await writeOnce(denialId,{status:"source_tool_refused",page:request.page});
            throw error;
          }
        };
        const persistEvidence=async value=>{
          const objectId=value.phase==="LONGITUDINAL_SYNTHESIZED"
            ? "reading-first:longitudinal-synthesis"
            : "reading-first:page:"+value.page;
          await writeOnce(objectId,value);
          const stored=await readIfPresent(objectId);
          invariant(stored && hash(JSON.stringify(stored))===hash(JSON.stringify(value)),
            "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
          return {private_reference:objectId};
        };
        const result=await produceReadingFirstJournal({
          sourceSha256:state.source_sha256,
          generation:state.generation,
          archiveReceiptRef:state.original.object_id,
          pages,attestationKey,
          reader,verifyCompletion:adapter.verifyCompletion,
          persistEvidence,synthesize:adapter.synthesize,
          verifySynthesis:adapter.verifySynthesis
        });
        // The final journal is source-bound and held only in the encrypted
        // private corpus store. A new index is still blocked on any gaps.
        const ref=await writeLarge("reading-first:attested-receipts",result.receipt_journal);
        state.reading_first_receipts_ref=ref;
        state.reading_first_counts=result.counts;
        await save();
        return summary();
      } finally {attestationKey.fill(0);}
    }

    const requireReadingFirstSynthesis = async () => {
      if (importOrder !== "reading_first") return;
      invariant(state.parsed_ref && state.completion.archive_verified === "pass", "JOURNAL_SOURCE_NOT_STAGED");
      invariant(state.reading_first_receipts_ref, "JOURNAL_READING_FIRST_STAGE_INCOMPLETE");
      const sourcePlan = await readLarge(state.parsed_ref);
      const pageCount = sourcePlan.parsed.pages?.length ?? 0;
      invariant(pageCount > 0, "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
      const receiptJournal = await readLarge(state.reading_first_receipts_ref);
      const attestationKey = readingFirstAttestationKey(key);
      try {
        return verifiedReadingFirstSynthesis({
          sourceSha256: state.source_sha256,
          generation: state.generation,
          pageCount,
          receiptJournal,
          attestationKey
        });
      } finally {
        attestationKey.fill(0);
      }
    };

    async function buildQuotes() {
      invariant(state.parsed_ref && state.completion.archive_verified === "pass", "JOURNAL_SOURCE_NOT_STAGED");
      // A new reading-first generation cannot materialize its source index from
      // staged text alone. It needs an authenticated original-source reading
      // and longitudinal-synthesis checkpoint from the private worker.
      await requireReadingFirstSynthesis();
      const corpusId = `${state.corpus_id}:quotes`;
      const generation = quoteIndexGeneration();
      const quoteStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: key, resumeMatchingObjects: true });
      try {
        if (state.quote_index?.generation !== generation) {
          // A run state from before `quote_published` names the published generation only in the build
          // record this build replaces: as that build's own generation once it was published, or as the
          // one it was going to replace before then. It is kept first.
          if (!state.quote_published && state.quote_index?.published) {
            state.quote_published = { generation: state.quote_index.generation, manifest_object_id: state.quote_index.manifest_object_id,
              at: state.quote_index.published.at };
          } else if (!state.quote_published && state.quote_index?.supersedes) {
            state.quote_published = { generation: state.quote_index.supersedes, manifest_object_id: null, at: null };
          }
          const published = state.quote_published?.generation ?? null;
          const supersedes = published === generation ? null : published;
          const { representations } = await quoteSource();
          const input = await quoteGenerationInput(generation);
          const built = buildQuoteGeneration(input);
          let readingFacets=null;
          if(importOrder==="reading_first"){
            const sourcePlan=await readLarge(state.parsed_ref);
            const texts=new Map(sourcePlan.parsed.representations
              .map(p=>[p.representation_id,p.text]));
            const sourcePages=sourcePlan.parsed.pages.map(p=>({
              page:p.page_number,text:texts.get(p.representation_id)??""
            }));
            const observations=[];
            for(const page of sourcePages){
              const id="reading-first:page:"+page.page;
              const stored=await readIfPresent(id);
              invariant(stored?.observation && stored?.page===page.page,
                "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
              observations.push({...stored,private_reference:id});
            }
            readingFacets=buildReadingFirstFacetIndexes({
              built,observations,sourcePages
            });
          }
          // The quote corpus carries the archived original its locators name, so it is complete on its own.
          const original = await quoteStore.writeChunkedOriginalStream({ objectId: state.original.object_id,
            objectVersion: state.original.object_version, chunks: store.iterateOriginal(state.original) });
          invariant(original.byte_length === state.original.byte_length && original.sha256 === state.original.sha256, "QUOTE_ARCHIVE_COPY_MISMATCH");
          const persisted = await persistGraphGeneration({ corpusStore: quoteStore, graph: built.graph,
            sourceRepresentations: Object.fromEntries(representations.map((item) => [item.representation_id, item.text])),
            permittedUses: ["archive", "organize_search", "session_use"], archiveReferences: [original], shardTargetBytes: QUOTE_SHARD_BYTES,
            // Version 3 adds the word list the search ranks by.
            extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths,
              ...(input.version >= 3 ? { quote_terms: buildQuoteTermsFromGraph(built.graph) } : {}),
              ...(readingFacets ? {
                reading_terms:readingFacets.readingTerms,
                reading_meta:readingFacets.readingMeta
              } : {}) }, indexRepresentations: true });
          // The manifest stays in the store, not in the run state, which is rewritten on every save.
          state.quote_index = { corpus_id: corpusId, generation, manifest_object_id: persisted.manifest_object_id,
            ...(readingFacets ? {reading_facets:readingFacets.stats} : {}),
            manifest_reference: persisted.manifest_reference, stats: structuredClone(built.stats), built_at: now().toISOString(), published: null,
            supersedes };
          await save();
        }
        return quoteStore;
      } catch (error) { quoteStore.close(); throw error; }
    }

    async function publishQuotes() {
      // Once a pointer run's generation is published, it holds the quotes and their tags: publishing the quote index alone
      // over it would drop the tags. A new quote index version goes out through pointer-rebase and pointer-publish instead.
      invariant(!(state.quote_published?.generation ?? "").includes(":pointer-"), "QUOTE_PUBLISH_WOULD_DROP_TAGS");
      const quoteStore = await buildQuotes();
      try {
        // The transfer checks every object it copies, the manifest included, against these references.
        const { manifest_object_id: manifestObjectId, manifest_reference: manifestReference } = state.quote_index;
        const persisted = { manifest: await quoteStore.readJsonObject({ objectId: manifestObjectId }), manifest_reference: manifestReference,
          manifest_object_id: manifestObjectId };
        await authorize();
        const publish = () => publishJournalGenerationFromStaging({ service, sourceStore: quoteStore, persisted, auth, authorize,
          supersedes: state.quote_index.supersedes ?? null });
        const receipt = typeof service.rootDir === "string"
          ? await withPrivateRootWriterLock({ rootDir: service.rootDir, heldRootDir: root }, publish)
          : await publish();
        const at = now().toISOString();
        state.quote_index.published = { at, legacy_state_unchanged: receipt.legacy_state_unchanged,
          objects_verified: receipt.transfer.objects_verified };
        state.quote_published = { generation: state.quote_index.generation, manifest_object_id: manifestObjectId, at };
        await save();
        return summary();
      } finally { quoteStore.close(); }
    }


    // The pointer pass (plan 2026-10-09-journal-quote-first.md, Part 3): a run of steps over the quote corpus's quotes,
    // each with its deadline saved when it starts, so a resumed step keeps it and sends nothing after it. The run state
    // holds only counts, page numbers and digests; results that hold journal text go to the private store, named in the
    // state by reference. A run that fails a floor or has a nonresponse keeps its blocker, and no later step runs.
    // A run's generation is a new generation of the quote corpus, and it reads dates the way the run setting said when
    // the run started: a changed setting needs a new run (`pointer-new-run`), so no step mixes two readings. The copy
    // check's run length is kept the same way; a run from before owner decision 30 has none, and its steps keep the rules
    // it started with (pointer-reference.mjs).
    // Whether a run's settings still are the run config's: its date setting, and the copy check's run length for a run
    // that has one. A changed setting calls for a new run, at every step and at publication.
    const pointerSettingsHold = (run) => run.numeric_date_order === quoteNumericDateOrder
      && (!Object.hasOwn(run, "copy_run_words") || run.copy_run_words === pointerCopyRunWords)
      && (!Object.hasOwn(run, "pointer_rules") || run.pointer_rules === pointerRules);
    const pointerRun = async () => {
      invariant(state.parsed_ref && state.completion.archive_verified === "pass" && state.original, "JOURNAL_SOURCE_NOT_STAGED");
      if (importOrder === "reading_first") {
        await requireReadingFirstSynthesis();
        invariant(state.quote_index?.generation === quoteIndexGeneration(),
          "JOURNAL_READING_FIRST_INDEX_PRECONDITION_FAILED");
      }
      if (!state.pointer) {
        const runId = randomBytes(4).toString("hex");
        state.pointer = { run_id: runId, generation: `${pointerBaseGeneration()}:pointer-${runId}`, numeric_date_order: quoteNumericDateOrder,
          copy_run_words: pointerCopyRunWords, pointer_rules: pointerRules, started_at: now().toISOString(), blocker: null };
        await save();
      }
      invariant(pointerSettingsHold(state.pointer), "POINTER_RUN_SETTING_CHANGED");
      if (state.pointer.blocker) throw new ValidationError(state.pointer.blocker, { code: state.pointer.blocker });
      return state.pointer;
    };
    // The copy check's run length a run's steps use: what it started with, or null for a run from before owner decision
    // 30, whose steps then keep that run's rules.
    const runCopyRunWords = (run) => run.copy_run_words ?? null;
    // The rules a run's steps use (pointer-reference.mjs, POINTER_RULES): what it started with, or owner decision 30's for a
    // run from before owner decision 32. Under 3 Codex is the only judge, so no step of such a run needs Claude's route.
    const runRules = (run) => run.pointer_rules ?? 2;
    const pointerJudgeRoute = (run) => { if (runRules(run) !== 3) pointerHardestAttested(); };
    // Starts over: the current run, whatever its state, goes into the run state's history as status shows it (counts
    // only), and the next pointer command starts a new run with new steps, seeds and deadlines. Its stored results
    // stay in the private store.
    async function pointerNewRun() {
      if (state.pointer) {
        state.pointer_history = [...(state.pointer_history ?? []), { ...pointerSummary(), ended_at: now().toISOString() }];
        delete state.pointer;
        await save();
      }
      return summary();
    }
    // Counts the current run's finished reference step again from its stored answers, and changes nothing: its deadline
    // has passed, so every call is only read back from what the durable store already holds (never from the port, which
    // would store and release an answer it received late), never sent (a send here refuses), no Claude slot is counted,
    // and nothing is saved. For a step stored before a count existed (the judges' reasons, 12 Oct 2026; the copy check's
    // run lengths, owner decision 30), and as a check that the stored counts still follow from the stored answers. The
    // recount follows the rules the run ran under: in a run from before owner decision 30, a judge's copying flag still
    // holds a quote back and a unit still unconfirmed after its retry is still a nonresponse. Only the counts the stored
    // ones hold are compared. Content-free.
    async function pointerRecount() {
      const run = state.pointer;
      const step = run?.reference;
      invariant(step?.status === "done", "POINTER_REFERENCE_NOT_DONE");
      invariant(Date.parse(step.deadline) <= now().getTime(), "POINTER_RECOUNT_BEFORE_DEADLINE");
      await authorize();
      const refuse = (code) => async () => { throw new ValidationError(code, { code }); };
      const readOnly = Object.freeze({ invoke: refuse("POINTER_RECOUNT_SENDS_NOTHING"),
        getCompletion: (operationKey) => port.storedCompletion(operationKey),
        wasSent: (operationKey) => port.wasSent(operationKey) });
      const input = pointerPassInput({ built: buildQuoteGeneration(await quoteGenerationInput(run.generation)) });
      const reference = await runPointerReference({ units: input.units, seed: step.seed, stepId: step.step_id, deadline: step.deadline,
        port: readOnly, grant, generation: run.generation, now, beforeHardestSend: refuse("POINTER_RECOUNT_SENDS_NOTHING"),
        oneAtATime: pointerTurns, copyRunWords: runCopyRunWords(run), rules: runRules(run) });
      const counts = pointerReferenceCounts(reference);
      // The stored counts must come out the same, leaving aside what was counted only later. So what they hold is compared,
      // at every level, and nothing else: the judges' reasons and rounds came on 12 Oct 2026, and the copy check, the
      // unconfirmed units and the judges' copying flags with owner decision 30. A count stored as null wasn't counted then.
      const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
      const held = (fresh, kept) => {
        if (Array.isArray(kept) && Array.isArray(fresh) && fresh.length === kept.length) return fresh.map((item, index) => held(item, kept[index]));
        if (!plain(kept) || !plain(fresh)) return fresh;
        return Object.fromEntries(Object.keys(kept).filter((name) => Object.hasOwn(fresh, name)).map((name) => [name, held(fresh[name], kept[name])]));
      };
      const stored = step.counts;
      const again = held(counts, stored);
      for (const name of ["judges", "copy_check"]) if (stored[name] === null) again[name] = null;
      return { ...summary(), recount: { run_id: run.run_id, step: "reference",
        matches_stored_counts: JSON.stringify(again) === JSON.stringify(stored),
        // Calls closed unanswered whose stored record can't say whether the step saw that in time: each is read as a
        // deadline. Zero means the recount followed every call as the step did.
        closes_inferred: reference.closes_inferred ?? 0, counts } };
    }
    // Writes the finished reference step's pieces that weren't confirmed, each with its quotes, the questions of each try
    // and the judges' verdicts and reasons (under owner decision 32's rules, Codex's on the marked pieces), to a new private file in the directory the run config names for operator
    // review (owner, 14 Oct 2026: "show me examples and why they fail"). The one command that writes journal text: only
    // there, only to a file it creates (owner-only, never one that exists), and never to its output, which says only the
    // file's name and counts. Like pointer-recount it reads the step back from the durable store after its deadline,
    // sending nothing and saving nothing.
    async function pointerExamples() {
      const dir = journalOperatorReviewDir(config);
      invariant(dir, "POINTER_EXAMPLES_NOT_GRANTED");
      const run = state.pointer;
      const step = run?.reference;
      invariant(step?.status === "done", "POINTER_REFERENCE_NOT_DONE");
      invariant(Date.parse(step.deadline) <= now().getTime(), "POINTER_RECOUNT_BEFORE_DEADLINE");
      // Never inside the public repository, where a routine commit could publish it (as execution_root).
      invariant(isOutside(repositoryRoot, dir), "JOURNAL_OPERATOR_REVIEW_DIR_PRIVATE_REQUIRED");
      const verified = await checkReviewDirectory(dir);
      await authorize();
      const refuse = (code) => async () => { throw new ValidationError(code, { code }); };
      const readOnly = Object.freeze({ invoke: refuse("POINTER_RECOUNT_SENDS_NOTHING"),
        getCompletion: (operationKey) => port.storedCompletion(operationKey),
        wasSent: (operationKey) => port.wasSent(operationKey) });
      const input = pointerPassInput({ built: buildQuoteGeneration(await quoteGenerationInput(run.generation)) });
      const events = [];
      const copyRunWords = runCopyRunWords(run);
      // The rules the step ran under: under owner decision 32's, Codex's verdicts alone and the marked pieces.
      const rules = runRules(run);
      const reference = await runPointerReference({ units: input.units, seed: step.seed, stepId: step.step_id, deadline: step.deadline,
        port: readOnly, grant, generation: run.generation, now, beforeHardestSend: refuse("POINTER_RECOUNT_SENDS_NOTHING"),
        oneAtATime: pointerTurns, copyRunWords, rules, observe: (event) => { events.push(event); } });
      const examples = collectPointerExamples({ reference, units: input.units, events, copyRunWords, rules });
      const written = now();
      const html = renderPointerExamples(examples, { runId: run.run_id, generatedAt: written.toISOString() });
      const name = `pointer-examples-${run.run_id}-${written.toISOString().replace(/[^0-9TZ]/gu, "")}-${randomBytes(3).toString("hex")}.html`;
      await writeReviewFile({ dir, name, verified, content: html });
      return { ...summary(), examples: { run_id: run.run_id, step: "reference", file: name, pieces: examples.pieces.length,
        sampled: examples.sampled, quotes: examples.pieces.reduce((sum, piece) => sum + piece.quotes.length, 0),
        bytes: Buffer.byteLength(html) } };
    }
    // A step's record, made and saved when it first starts: its ID, its deadline and, for a step that draws a sample,
    // its seed.
    const pointerStep = async (run, name, minutes, { seed = false } = {}) => {
      if (!run[name]) {
        const started = now();
        run[name] = { step_id: `pointer:${run.run_id}:${name}`, status: "running", started_at: started.toISOString(),
          deadline: new Date(started.getTime() + minutes * 60_000).toISOString(), ...(seed ? { seed: randomBytes(32).toString("hex") } : {}) };
        await save();
      }
      return run[name];
    };
    const finishPointerStep = async (step, fields) => {
      Object.assign(step, structuredClone(fields), { status: "done", finished_at: now().toISOString() });
      await save();
    };
    // What a pass keeps in the private store: everything a coverage pass and the measurement read.
    const storedPointerPass = (result) => ({ generation: result.generation, step_id: result.step_id, pages: result.pages, checked: result.checked,
      event_pairs: result.event_pairs, dropped_event_pairs: result.dropped_event_pairs, event_check: result.event_check, coverage: result.coverage,
      report: result.report, calls: result.calls, tagger_answered_at: result.tagger_answered_at });

    // Step 2: the reference sample's questions, the coverage judges and the searches. Under owner decision 30's rules a
    // nonresponse stops the run, and a unit still unconfirmed after its retry counts in recall with every question missed
    // and stops the run only when the unconfirmed units alone already put the recall floor out of reach
    // (pointerRecallReach). Under owner decision 32's, Codex judges alone and nothing here stops the run: a unit still not
    // covered after its retry is marked and measured, and a nonresponse is listed and left out of the measurement.
    async function pointerReference() {
      const run = await pointerRun();
      pointerJudgeRoute(run);
      const step = await pointerStep(run, "reference", pointerDeadlines.reference, { seed: true });
      if (step.status === "done") return summary();
      const input = pointerPassInput({ built: buildQuoteGeneration(await quoteGenerationInput(run.generation)) });
      const reference = await runPointerReference({ units: input.units, seed: step.seed, stepId: step.step_id, deadline: step.deadline, port, grant,
        generation: run.generation, now, beforeHardestSend: pointerBeforeHardestSend, oneAtATime: pointerTurns,
        copyRunWords: runCopyRunWords(run), rules: runRules(run) });
      const nonresponse = reference.units.filter((unit) => unit.status === "nonresponse")
        .map((unit) => ({ unit_id: unit.unit_id, reason: unit.reason, deadline_cause: unit.deadline_cause ?? null }));
      const unconfirmed = reference.units.filter((unit) => unit.status === "unconfirmed").map((unit) => unit.unit_id);
      // Under owner decision 32's rules nothing here stops the run: a marked unit is measured, and a nonresponse is listed.
      const marksOnly = runRules(run) === 3;
      const reach = marksOnly ? null : pointerRecallReach(reference);
      const counts = pointerReferenceCounts(reference);
      const resultRef = await writeLarge(`pointer:${run.run_id}:reference`, reference);
      // The blocker is saved with the finished step, in the same write, so a stop between two writes can't leave a run
      // that can't pass free to go on to the pilot.
      if (!marksOnly && nonresponse.length > 0) run.blocker = "POINTER_REFERENCE_NONRESPONSE";
      else if (!marksOnly && !reach.reachable) run.blocker = "POINTER_RECALL_OUT_OF_REACH";
      await finishPointerStep(step, { result_ref: resultRef, counts, nonresponse_units: nonresponse, unconfirmed_units: unconfirmed,
        recall_reach: reach });
      return summary();
    }

    // Calibration's units as a challenge set, for the measurement to report apart: the reference step on their pages,
    // under the same rules and with the reference step's time limit. A nonresponse here is counted and stops nothing.
    // The pass reads the parsed source's text, as the quote index does (quoteSource): a page's visual transcription
    // isn't the journal's exact words and stays out of quote search until visual reading is planned (plan Part 3), so a
    // calibration unit read from one is counted among the units without quotes.
    async function pointerChallenge() {
      const run = await pointerRun();
      pointerJudgeRoute(run);
      invariant(run.reference?.status === "done", "POINTER_REFERENCE_NOT_DONE");
      const step = await pointerStep(run, "challenge", pointerDeadlines.reference);
      if (step.status === "done") return summary();
      const plan = await readLarge(state.visual_plan_ref ?? state.parsed_ref);
      const planUnits = new Map(plan.units.map((unit) => [unit.unit_id, unit]));
      const calibration = (plan.calibration ?? []).map((item) => {
        const unit = planUnits.get(item.unit_id);
        invariant(unit, "POINTER_CHALLENGE_UNIT_MISSING");
        return { unit_id: unit.unit_id, representation_id: unit.representation_id, page_number: unit.page_number ?? null,
          start_byte: unit.start_byte, end_byte: unit.end_byte, hazard_types: [...(unit.hazard_types ?? [])] };
      });
      const input = pointerPassInput({ built: buildQuoteGeneration(await quoteGenerationInput(run.generation)) });
      const sample = pointerChallengeUnits({ units: input.units, calibration });
      const reference = sample.units.length > 0
        ? await runPointerReference({ units: input.units, sample, stepId: step.step_id, deadline: step.deadline, port, grant,
          generation: run.generation, now, beforeHardestSend: pointerBeforeHardestSend, oneAtATime: pointerTurns,
          copyRunWords: runCopyRunWords(run), rules: runRules(run) })
        : { step_id: step.step_id, deadline: step.deadline, sample: { kind: "calibration", candidate_units: 0 }, units: [] };
      await finishPointerStep(step, { result_ref: await writeLarge(`pointer:${run.run_id}:challenge`, reference),
        counts: pointerReferenceCounts(reference), calibration_units: sample.calibration_units, units_without_quotes: sample.units_without_quotes });
      return summary();
    }

    // Step 3: the pilot, on pages outside the reference sample. It builds nothing.
    async function pointerPilot() {
      const run = await pointerRun();
      invariant(run.reference?.status === "done", "POINTER_REFERENCE_NOT_DONE");
      const step = await pointerStep(run, "pilot", pointerDeadlines.pass, { seed: true });
      if (step.status === "done") return summary();
      const reference = await readLarge(run.reference.result_ref);
      const pilot = await runPointerPilot({ quoteGeneration: await quoteGenerationInput(run.generation),
        excludeUnitIds: reference.units.flatMap((unit) => unit.quote_ids), seed: step.seed, stepId: step.step_id, deadline: step.deadline, port, grant, now,
        oneAtATime: pointerTurns });
      await finishPointerStep(step, { pages: pilot.pages, candidate_pages: pilot.candidate_pages, event_check: pilot.event_check, report: pilot.report,
        calls: pilot.calls, answered_at: pilot.tagger_answered_at });
      return summary();
    }

    // Step 4: the full pass, built and not published. When its coverage falls short, one new pass on the untagged
    // pages follows at once, since the measurement would be run again on that pass's generation anyway.
    async function pointerPass() {
      const run = await pointerRun();
      invariant(run.pilot?.status === "done", "POINTER_PILOT_NOT_DONE");
      const quoteGeneration = await quoteGenerationInput(run.generation);
      const first = await pointerStep(run, "pass", pointerDeadlines.pass);
      if (first.status !== "done") {
        const result = await runPointerPass({ quoteGeneration, stepId: first.step_id, deadline: first.deadline, port, grant, now, oneAtATime: pointerTurns });
        await finishPointerStep(first, { result_ref: await writeLarge(`pointer:${run.run_id}:pass`, storedPointerPass(result)), report: result.report,
          calls: result.calls, coverage_holds: result.coverage.holds, answered_at: result.tagger_answered_at });
      }
      if (!first.coverage_holds) {
        const stored = await readLarge(first.result_ref);
        const pages = stored.coverage.untagged.map((item) => item.page);
        invariant(pages.length > 0, "POINTER_COVERAGE_PAGES_MISSING");
        const step = await pointerStep(run, "coverage_pass", pointerDeadlines.pass);
        if (step.status !== "done") {
          const result = await runPointerPass({ quoteGeneration, stepId: step.step_id, deadline: step.deadline, port, grant, now, pages,
            first: { checked: stored.checked, event_pairs: stored.event_pairs, dropped_event_pairs: stored.dropped_event_pairs }, oneAtATime: pointerTurns });
          await finishPointerStep(step, { pages, result_ref: await writeLarge(`pointer:${run.run_id}:coverage_pass`, storedPointerPass(result)),
            report: result.report, calls: result.calls, coverage_holds: result.coverage.holds, answered_at: result.tagger_answered_at });
        }
      }
      return summary();
    }

    // Step 5: the measurement of the generation the pass built, stored as it would be published (not published), so
    // the searches run on it. Under owner decision 30's rules a floor that fails stops the run; under owner decision
    // 32's the floors are reported and don't block publication (`floors_block` false).
    async function pointerMeasure() {
      const run = await pointerRun();
      pointerJudgeRoute(run);
      invariant(run.pass?.status === "done" && (run.pass.coverage_holds || run.coverage_pass?.status === "done"), "POINTER_PASS_NOT_DONE");
      // Calibration's set is reported with every measurement, so its questions must be ready first.
      invariant(run.challenge?.status === "done", "POINTER_CHALLENGE_NOT_DONE");
      const measured = run.coverage_pass?.status === "done" ? run.coverage_pass : run.pass;
      const quoteGeneration = await quoteGenerationInput(run.generation);
      const stored = await readLarge(measured.result_ref);
      const quoteStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId: quoteGeneration.corpusId, corpusKey: key, resumeMatchingObjects: true });
      try {
        if (run.persisted?.step_id !== measured.step_id) {
          const input = pointerPassInput({ built: buildQuoteGeneration(quoteGeneration) });
          const { built, indexes } = buildPointerGeneration({ quoteGeneration, input, checked: stored.checked });
          const original = await quoteStore.writeChunkedOriginalStream({ objectId: state.original.object_id,
            objectVersion: state.original.object_version, chunks: store.iterateOriginal(state.original) });
          invariant(original.byte_length === state.original.byte_length && original.sha256 === state.original.sha256, "QUOTE_ARCHIVE_COPY_MISMATCH");
          const persisted = await persistGraphGeneration({ corpusStore: quoteStore, graph: built.graph,
            sourceRepresentations: Object.fromEntries(quoteGeneration.representations.map((item) => [item.representation_id, item.text])),
            permittedUses: ["archive", "organize_search", "session_use"], archiveReferences: [original], shardTargetBytes: QUOTE_SHARD_BYTES,
            extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_tags: indexes.quote_tags, tag_terms: indexes.tag_terms },
            indexRepresentations: true });
          run.persisted = { step_id: measured.step_id, generation: run.generation, corpus_id: quoteGeneration.corpusId,
            manifest_object_id: persisted.manifest_object_id, manifest_reference: persisted.manifest_reference,
            graph_sha256: persisted.manifest.graph_sha256, built_at: now().toISOString() };
          await save();
        }
        const step = await pointerStep(run, "measure", pointerDeadlines.measure, { seed: true });
        if (step.status === "done") return summary();
        if (!step.measured_step_id) {
          step.measured_step_id = measured.step_id;
          await save();
        }
        invariant(step.measured_step_id === measured.step_id, "POINTER_MEASURED_GENERATION_CHANGED");
        const reference = await readLarge(run.reference.result_ref);
        const challenge = await readLarge(run.challenge.result_ref);
        const reader = await openPrivateJournalGraph({ corpusStore: quoteStore, manifestObjectId: run.persisted.manifest_object_id, caseId,
          corpusId: quoteGeneration.corpusId, generation: run.generation, visibilityEpoch: 0, cursorSecret: key });
        try {
          // find_journal_quotes on the measured generation: its first results, as passage IDs. A search with no
          // word in it finds nothing.
          const search = async ({ query, matchTags }) => {
            try {
              const found = await reader.findQuotes({ query, limit: POINTER_RECALL_TOP, byteBudget: QUOTE_SEARCH_LIMITS.byteBudgetMax, matchTags });
              return found.quotes.map((quote) => quote.quote_id);
            } catch (error) {
              if (["SEARCH_QUERY_HAS_NO_TERMS", "QUOTE_QUERY_INVALID"].includes(error?.code)) return [];
              throw error;
            }
          };
          const result = await runPointerMeasure({ quoteGeneration, pass: stored, reference, challenge, search, seed: step.seed, stepId: step.step_id,
            deadline: step.deadline, port, grant, now, beforeHardestSend: pointerBeforeHardestSend, oneAtATime: pointerTurns, rules: runRules(run) });
          await finishPointerStep(step, { result_ref: await writeLarge(`pointer:${run.run_id}:measure`, result), publish: result.publish,
            floors_block: result.floors_block,
            failed_floors: Object.entries(result.floors).filter(([, floor]) => !floor.holds).map(([name]) => name),
            floors: result.floors, report: result.report });
          if (!result.publish) {
            run.blocker = "POINTER_FLOORS_FAILED";
            await save();
          }
        } finally { reader.close(); }
      } finally { quoteStore.close(); }
      return summary();
    }

    // A content-free check of the measured generation's word search (owner page, 15 Oct 2026, "Searches that find more"):
    // for the reference sample's questions, how many the measurement's search found, where the others' quotes rank, and how
    // many each way of matching words would find (pointer-steps.mjs, runPointerSearchCheck). Like pointer-recount it reads the
    // stored run back: it sends nothing, saves nothing and says only counts.
    async function pointerSearchCheck() {
      const run = state.pointer;
      invariant(run?.measure?.status === "done" && run.persisted?.step_id === run.measure.measured_step_id, "POINTER_NOT_MEASURED");
      await authorize();
      const check = await searchCheckOn({ run, corpusId: run.persisted.corpus_id, generation: run.generation,
        manifestObjectId: run.persisted.manifest_object_id, checkManifest: (manifest) => invariant(manifest.generation === run.generation
          && manifest.graph_sha256 === run.persisted.graph_sha256, "POINTER_MEASURED_GENERATION_MISMATCH") });
      return { ...summary(), search_check: { run_id: run.run_id, ...check } };
    }

    // The same check on the quote index's own generation, built and not yet published (plan, version 3, "Checking it before it
    // goes live"): the measured run's reference questions, which go by unit id, searched there as find_journal_quotes will
    // search once it is published. On version 3 the live search must find exactly what its replica, the check's
    // forms_bm25_coordination, finds. It sends nothing, saves nothing and says only counts.
    async function quoteSearchCheck() {
      const run = state.pointer;
      invariant(run?.measure?.status === "done" && run.persisted?.step_id === run.measure.measured_step_id, "POINTER_NOT_MEASURED");
      const index = state.quote_index;
      invariant(index?.generation === quoteIndexGeneration() && typeof index.manifest_object_id === "string", "QUOTE_INDEX_NOT_BUILT");
      await authorize();
      const version = quoteIndexVersionOf(index.generation);
      const check = await searchCheckOn({ run, corpusId: index.corpus_id, generation: index.generation, manifestObjectId: index.manifest_object_id,
        checkManifest: (manifest) => {
          invariant(manifest.generation === index.generation, "QUOTE_INDEX_GENERATION_MISMATCH");
          // A version 3 generation ranks by its word list, and only it has one.
          invariant(Array.isArray(manifest.indexes?.quote_terms) === (version >= 3), "QUOTE_INDEX_VERSION_MISMATCH");
        } });
      return { ...summary(), quote_search_check: { run_id: run.run_id, generation_version: version, ...check } };
    }

    // find_journal_quotes on a stored generation's reader, exactly as the measurement runs it: its first results, as passage
    // IDs. A search with no word in it finds nothing.
    const measuredSearch = (reader) => async ({ query, matchTags }) => {
      try {
        const found = await reader.findQuotes({ query, limit: POINTER_RECALL_TOP, byteBudget: QUOTE_SEARCH_LIMITS.byteBudgetMax, matchTags });
        return found.quotes.map((quote) => quote.quote_id);
      } catch (error) {
        if (["SEARCH_QUERY_HAS_NO_TERMS", "QUOTE_QUERY_INVALID"].includes(error?.code)) return [];
        throw error;
      }
    };

    // runPointerSearchCheck (pointer-steps.mjs) on one stored generation of the quote corpus, with the measured run's reference
    // questions; `checkManifest` checks the generation's manifest before anything is searched.
    async function searchCheckOn({ run, corpusId, generation, manifestObjectId, checkManifest }) {
      const quoteGeneration = await quoteGenerationInput(generation);
      const reference = await readLarge(run.reference.result_ref);
      const quoteStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: key, resumeMatchingObjects: true });
      try {
        const manifest = await quoteStore.readJsonObject({ objectId: manifestObjectId });
        checkManifest(manifest);
        const reader = await openPrivateJournalGraph({ corpusStore: quoteStore, manifestObjectId, caseId, corpusId, generation,
          visibilityEpoch: 0, cursorSecret: key });
        try {
          return await runPointerSearchCheck({ quoteGeneration, reference, search: measuredSearch(reader), population: manifest.node_count,
            rules: runRules(run) });
        } finally { reader.close(); }
      } finally { quoteStore.close(); }
    }

    // The measured run's tags on the quote index version this code builds (issue #168). A run whose own generation is named
    // for an older version (the 15 Oct 2026 run was measured on version 2, before version 3 was published) has its kept
    // tags built again, by unit id, onto a generation named for the current version, with that version's word list and
    // dates. Nothing is sent: the tags are the run's, already checked, and their precision stays what its measurement
    // found. Retrieval is then measured again on the new generation, with tags and with words only, on the run's
    // reference questions. pointer-publish publishes this generation for such a run, so the published quotes never go
    // back a version. The run state keeps counts, the generation's name and digest, and private-store references only.
    async function pointerRebase() {
      const run = state.pointer;
      invariant(run?.measure?.status === "done" && run.persisted?.step_id === run.measure.measured_step_id, "POINTER_NOT_MEASURED");
      invariant(pointerSettingsHold(run), "POINTER_RUN_SETTING_CHANGED");
      const generation = `${quoteIndexGeneration()}:pointer-${run.run_id}`;
      invariant(generation !== run.generation, "POINTER_REBASE_NOT_NEEDED");
      const measured = run.coverage_pass?.status === "done" ? run.coverage_pass : run.pass;
      invariant(measured?.step_id === run.measure.measured_step_id, "POINTER_MEASURED_GENERATION_CHANGED");
      await authorize();
      const quoteGeneration = await quoteGenerationInput(generation);
      const stored = await readLarge(measured.result_ref);
      const quoteStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId: quoteGeneration.corpusId, corpusKey: key,
        resumeMatchingObjects: true });
      try {
        if (run.rebased?.generation !== generation || run.rebased.step_id !== measured.step_id) {
          // The same build the measurement's generation came from, on the current version's quotes: the tags are kept by
          // unit id, which every version keeps, and indexed under this generation's passages.
          const input = pointerPassInput({ built: buildQuoteGeneration(quoteGeneration) });
          const { built, indexes } = buildPointerGeneration({ quoteGeneration, input, checked: stored.checked });
          const original = await quoteStore.writeChunkedOriginalStream({ objectId: state.original.object_id,
            objectVersion: state.original.object_version, chunks: store.iterateOriginal(state.original) });
          invariant(original.byte_length === state.original.byte_length && original.sha256 === state.original.sha256, "QUOTE_ARCHIVE_COPY_MISMATCH");
          const persisted = await persistGraphGeneration({ corpusStore: quoteStore, graph: built.graph,
            sourceRepresentations: Object.fromEntries(quoteGeneration.representations.map((item) => [item.representation_id, item.text])),
            permittedUses: ["archive", "organize_search", "session_use"], archiveReferences: [original], shardTargetBytes: QUOTE_SHARD_BYTES,
            extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_tags: indexes.quote_tags, tag_terms: indexes.tag_terms,
              ...(quoteGeneration.version >= 3 ? { quote_terms: buildQuoteTermsFromGraph(built.graph) } : {}) },
            indexRepresentations: true });
          // The dates the carried generation gives its quotes, in counts (version 4's `time_order` among them).
          const { dated_quotes: datedQuotes, date_lines: dateLines, ranged_quotes: rangedQuotes = null, range_widths: rangeWidths = null,
            date_order: dateOrder = null, time_order: timeOrder = null } = built.stats;
          run.rebased = { step_id: measured.step_id, generation, corpus_id: quoteGeneration.corpusId,
            manifest_object_id: persisted.manifest_object_id, manifest_reference: persisted.manifest_reference,
            graph_sha256: persisted.manifest.graph_sha256, built_at: now().toISOString(),
            dates: structuredClone({ quotes: built.stats.quotes, dated_quotes: datedQuotes, date_lines: dateLines, ranged_quotes: rangedQuotes,
              range_widths: rangeWidths, date_order: dateOrder, time_order: timeOrder }),
            measure: null };
          await save();
        }
        if (!run.rebased.measure) {
          const reference = await readLarge(run.reference.result_ref);
          const reader = await openPrivateJournalGraph({ corpusStore: quoteStore, manifestObjectId: run.rebased.manifest_object_id, caseId,
            corpusId: quoteGeneration.corpusId, generation, visibilityEpoch: 0, cursorSecret: key });
          try {
            const result = await runPointerRebaseMeasure({ quoteGeneration, pass: stored, reference, search: measuredSearch(reader), rules: runRules(run) });
            run.rebased.measure = { ...structuredClone(result), measured_at: now().toISOString() };
            await save();
          } finally { reader.close(); }
        }
      } finally { quoteStore.close(); }
      return summary();
    }

    // A content-free readback of the published quote corpus through the reader the connector opens, under the operator's
    // grant (issue #168): which generation is live, its timeline's events by lane, and, for the first READBACK_EVENTS events
    // in the timeline's own order, whether a graph search for the event's label finds it, whether each tag node on the
    // event's quote is found by its own label, whether the event's subgraph reaches its quote, and whether that quote
    // resolves to its exact words; and that a caller without a grant is refused. Every answer is counted, never shown.
    // Sends nothing, saves nothing.
    const READBACK_EVENTS = 20;
    async function publishedReadback() {
      await authorize();
      const corpusId = `${state.corpus_id}:quotes`;
      const access = { requiredScope: PRIVATE_CASE_SCOPES.WRITE, requiredPurpose: PRIVATE_JOURNAL_PURPOSES.SESSION_USE };
      const readback = await service.withJournalCorpus(caseId, corpusId, access, async ({ corpusStore, cursorSecret, reference }) => {
        invariant(reference?.active_generation, "SOURCE_UNAVAILABLE");
        const reader = await openPrivateJournalGraph({ corpusStore, manifestObjectId: reference.manifest_object_id, caseId, corpusId,
          generation: reference.active_generation, visibilityEpoch: reference.visibility_epoch, purpose: PRIVATE_JOURNAL_PURPOSES.SESSION_USE,
          cursorSecret });
        try {
          // Whether a graph search for a label finds this node, paging through the matches of its kind.
          const finds = async (record) => {
            if (!lexicalTerms(record.data?.label ?? "").length) return false;
            let cursor = null;
            do {
              const page = await reader.search({ query: record.data.label, filters: { kinds: [record.kind] }, pageSize: 250, cursor });
              if (page.records.some((item) => item.id === record.id)) return true;
              cursor = page.next_cursor;
            } while (cursor);
            return false;
          };
          const timeline = await reader.timeline({});
          const events = timeline.records.filter((record) => record.kind === "episode");
          const counts = { events_checked: 0, events_found: 0, tags_checked: 0, tags_found: 0, subgraphs_reaching_quote: 0, quotes_resolved: 0 };
          for (const event of events.slice(0, READBACK_EVENTS)) {
            counts.events_checked += 1;
            if (await finds(event)) counts.events_found += 1;
            const [quoteId] = event.data.evidence_ids;
            const group = await reader.evidenceGroup([event.id], { maximumNodes: 100, maximumEdges: 200 });
            if (group.nodes.some((node) => node.id === quoteId)) counts.subgraphs_reaching_quote += 1;
            if ((await reader.resolveEvidence([quoteId])).exact_spans.length === 1) counts.quotes_resolved += 1;
            for (const tag of (await reader.reverseDependencies(quoteId)).filter((record) => record.kind === "entity")) {
              counts.tags_checked += 1;
              if (await finds(tag)) counts.tags_found += 1;
            }
          }
          return { generation: reference.active_generation, pointer_generation: reference.active_generation.includes(":pointer-"),
            node_count: reader.manifest.node_count, word_list: Array.isArray(reader.manifest.indexes?.quote_terms),
            events: { known_lane: events.filter((record) => record.timeline_entry.lane === "known").length,
              unknown_lane: events.filter((record) => record.timeline_entry.lane === "unknown").length },
            ...counts };
        } finally { reader.close(); }
      }, auth);
      // Without a grant, the same read is refused.
      const refused = await service.withJournalCorpus(caseId, corpusId, access, async () => false, {}).then(() => false, () => true);
      return { ...summary(), published_readback: { ...readback, refused_without_grant: refused } };
    }

    // Step 6, on the owner's `deploy`: exactly the measured generation, identified by its manifest's reference and its
    // graph's digest, and, under owner decision 30's rules, only when every floor held; for a run measured on an older
    // quote index version, its tags carried onto the current one (pointer-rebase). It replaces the published quote
    // generation.
    async function pointerPublish() {
      const run = state.pointer;
      invariant(run?.measure?.status === "done" && run.measure.publish === true && !run.blocker, "POINTER_NOT_READY_TO_PUBLISH");
      invariant(run.persisted?.step_id === run.measure.measured_step_id, "POINTER_MEASURED_GENERATION_MISMATCH");
      // The measured generation reads dates as the run setting said when the run started, and was measured under the copy
      // check's run length the run started with; a setting changed since calls for a new run, as every other step does.
      invariant(pointerSettingsHold(run), "POINTER_RUN_SETTING_CHANGED");
      // A run measured on an older quote index version publishes its tags built again on the current one (pointer-rebase),
      // never its own generation, which would take the published quotes back a version.
      const current = `${quoteIndexGeneration()}:pointer-${run.run_id}`;
      const behind = quoteIndexVersionOf(run.generation) < quoteIndexVersionOf(current);
      invariant(!behind || (run.rebased?.generation === current && run.rebased.step_id === run.measure.measured_step_id && run.rebased.measure),
        "POINTER_REBASE_NEEDED");
      const target = behind ? run.rebased : run.persisted;
      // Publishing the same generation again changes nothing.
      if (run.published && (run.published.generation ?? run.generation) === target.generation) return summary();
      const quoteStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId: target.corpus_id, corpusKey: key, resumeMatchingObjects: true });
      try {
        const manifest = await quoteStore.readJsonObject({ objectId: target.manifest_object_id });
        invariant(manifest.generation === target.generation && manifest.graph_sha256 === target.graph_sha256, "POINTER_MEASURED_GENERATION_MISMATCH");
        const persisted = { manifest, manifest_reference: target.manifest_reference, manifest_object_id: target.manifest_object_id };
        const supersedes = state.quote_published?.generation ?? null;
        await authorize();
        const publish = () => publishJournalGenerationFromStaging({ service, sourceStore: quoteStore, persisted, auth, authorize, supersedes });
        const receipt = typeof service.rootDir === "string"
          ? await withPrivateRootWriterLock({ rootDir: service.rootDir, heldRootDir: root }, publish)
          : await publish();
        const at = now().toISOString();
        run.published = { at, generation: target.generation, supersedes, legacy_state_unchanged: receipt.legacy_state_unchanged,
          objects_verified: receipt.transfer.objects_verified };
        state.quote_published = { generation: target.generation, manifest_object_id: target.manifest_object_id, at };
        await save();
      } finally { quoteStore.close(); }
      return summary();
    }

    const executeSemantic = async (action) => {
      lookahead = createRunLookahead();
      try { await action(); }
      finally {
        if (lookahead) {
          await lookahead.close();
          for (const key of lookahead.sentOperationKeys()) lookaheadSent.add(key);
          lookaheadErrors += lookahead.summary().errors;
          lookahead = null;
        }
      }
      return summary();
    };
    return Object.freeze({
      async execute(command) {
        if (["inventory", "stage"].includes(command)) return stage();
        if (command === "read-source") return readSource();
        if (command === "recalibrate") return recalibrate();
        if (command === "resume-calibration") return resumeCalibration();
        if (command === "build-quotes") { (await buildQuotes()).close(); return summary(); }
        if (command === "publish-quotes") return publishQuotes();
        if (command === "pointer-reference") return pointerReference();
        if (command === "pointer-challenge") return pointerChallenge();
        if (command === "pointer-pilot") return pointerPilot();
        if (command === "pointer-pass") return pointerPass();
        if (command === "pointer-measure") return pointerMeasure();
        if (command === "pointer-publish") return pointerPublish();
        if (command === "pointer-new-run") return pointerNewRun();
        if (command === "pointer-recount") return pointerRecount();
        if (command === "pointer-examples") return pointerExamples();
        if (command === "pointer-search-check") return pointerSearchCheck();
        if (command === "quote-search-check") return quoteSearchCheck();
        if (command === "pointer-rebase") return pointerRebase();
        if (command === "published-readback") return publishedReadback();
        if (command === "run") return lookaheadSupported ? executeSemantic(() => run()) : run();
        if (command === "visual-only") return run({ visualOnly: true });
        if (command === "audit") return lookaheadSupported ? executeSemantic(() => audit()) : audit();
        if (command === "patterns") return patterns();
        if (command === "commit") return commit();
        if (["status", "report", "delete-plan"].includes(command)) {
          if (command === "report") await privateJson(path.join(root, "completion-report.json"), { ...summary(), source_chat: config.source_chat, generation: state.generation });
          return summary();
        }
        if (command === "verify") {
          invariant(state.parsed_ref, "JOURNAL_SOURCE_NOT_STAGED");
          await stage();
          const plan = await readLarge(state.parsed_ref);
          for (const r of plan.parsed.representations) verifyRepresentationCoverage(r.text, plan.units.filter((u) => u.representation_id === r.representation_id));
          invariant(state.raw_persisted, "JOURNAL_RAW_INDEX_NOT_READY");
          await authorize();
          const manifest = state.raw_persisted.manifest;
          const passages = [];
          for (const shard of manifest.record_shards) passages.push(...(await store.readJsonObject({ objectId: shard.object_id })).records.filter(n => n.kind === "passage"));
          const indexedUnits = new Set(passages.map(p => p.data.unit_id));
          invariant(plan.units.every(u => indexedUnits.has(u.unit_id)), "JOURNAL_RAW_INDEX_COVERAGE_INCOMPLETE");
          const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: state.raw_persisted.manifest_object_id, caseId, corpusId: state.corpus_id, generation: manifest.generation, visibilityEpoch: 0, cursorSecret: key });
          const started = performance.now();
          try {
            for (let i = 0; i < passages.length; i += 200) await reader.resolveEvidence(passages.slice(i, i + 200).map(p => p.id));
            let traversed = 0;
            // Search probes at the start, middle and end of the native units. A fully scanned source
            // has none, so there is nothing native to probe; its pages are read visually later.
            const probes = plan.units.length ? new Set([0, Math.floor(plan.units.length / 2), plan.units.length - 1]) : [];
            for (const index of probes) {
              const unit = plan.units[index], query = lexicalTerms(unit.text)[0];
              if (!query) continue;
              let cursor = null, found = false;
              do {
                const page = await reader.search({ query, graphEnabled: false, pageSize: 200, cursor });
                traversed += page.records.length; found ||= page.records.some(r => r.data.unit_id === unit.unit_id); cursor = page.next_cursor;
              } while (cursor && !found);
              invariant(found, "JOURNAL_RAW_SEARCH_READBACK_FAILED");
            }
            state.raw_verification = { exact_passages_resolved: passages.length, search_records_traversed: traversed, elapsed_ms: performance.now() - started, source_or_producer_history_used_by_reader: false };
            await save();
          } finally { reader.close(); }
          return summary();
        }
        throw new ValidationError("JOURNAL_STAGE_NOT_READY", { code: "JOURNAL_STAGE_NOT_READY" });
      },
      async close() { await lookahead?.close(); store.close(); port.close?.(); providers?.close(); secretBuffers.forEach((b) => b.fill(0)); await lock.release(); }
    });
  } catch (e) { store?.close(); port?.close?.(); providers?.close(); secretBuffers.forEach((b) => b.fill(0)); await lock.release(); throw e; }
}
