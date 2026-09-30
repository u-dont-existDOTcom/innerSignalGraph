import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { isOutside } from "../core/private-path.mjs";
import { vaultRootMatchesConfig } from "./run-config.mjs";
import { createPrivateJournalCorpusStore } from "../storage/private-journal-corpus.mjs";
import { acquirePrivateRootWriterLock, withPrivateRootWriterLock } from "../storage/shared-case-coordinator.mjs";
import { loadHostedPrivateCaseOperatorProvidersFromEnvironment } from "../storage/hosted-private-case-providers.mjs";
import { createPrivateCaseAccessService } from "../storage/private-case-access.mjs";
import { loadJournalInferencePortFromEnvironment } from "./provider-runtime.mjs";
import { createCorpusJournalJobLedger, createJournalImportController } from "./controller.mjs";
import { JOURNAL_ROLE_DEFINITIONS, buildJournalRolePacket, journalRoleInstruction } from "./provider-port.mjs";
import { parseSourceFile, sourceFormatForPath } from "./parsers/index.mjs";
import { partitionRepresentation, verifyRepresentationCoverage } from "./partition.mjs";
import { selectCalibrationWindows, scoreReferenceReview, createDeterministicAuditSample, certifyIndependentAudit } from "./audit.mjs";
import { adaptExtractionToGraph, persistGraphGeneration } from "./graph.mjs";
import { JOURNAL_GRAPH_CONTRACT, validateJournalGraph, resolveExactQuote } from "./contracts.mjs";
import { createDurableJournalInferencePort } from "./durable-inference.mjs";
import { openPrivateJournalGraph } from "./retrieval.mjs";
import { lexicalTerms } from "./graph.mjs";
import { applyReconciliationResult, validateReconciliationResult } from "./reconcile.mjs";
import { createAuditScopeIndex, createReconciledAuditScope, summarizeFidelityCoverage } from "./audit-scope.mjs";
import { publishJournalGenerationFromStaging } from "./publication.mjs";
import { runJournalPatternPass } from "./pattern-stage.mjs";
import { createJournalSemanticBatches, journalSemanticUnitCost, splitBatchExtractionByUnit } from "./semantic-batches.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
const invariant = (v, code) => { if (!v) throw new ValidationError(code, { code }); };
// Calibration windows over native-text units. A scanned or image-only source has none at intake;
// its visual units get windows once the page reader has produced them, so none is a valid start.
const nativeCalibration = (units) => units.length ? selectCalibrationWindows(units) : [];
// A native page keeps the parser's disposition. Plain UTF-8 text needs no page record;
// an unmapped non-text representation has no evidence for a readable status.
const PARSE_STATUS_BY_DISPOSITION = Object.freeze({ readable: "readable", visual_pending: "visual_pending", review_required: "review_required", unreadable: "unreadable" });
const parseStatus = (page, mimeType) => page ? (PARSE_STATUS_BY_DISPOSITION[page.disposition] ?? "partial")
  : (mimeType?.startsWith("text/plain") ? "readable" : "partial");
const completions = () => Object.fromEntries(["archive_verified", "raw_search_available", "graph_built", "semantically_audited", "patterns_reviewed", "profile_committed", "cold_retrieval_verified", "capacity_tested"].map((k) => [k, "not_run"]));

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

// Earlier versions rendered page images to plaintext files under visual/. A completed page's image
// is already in the encrypted store and an unfinished page is rendered again, so leftovers go.
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
export async function openJournalExecutionRuntime({ config, configPath, environment = process.env, service: suppliedService = null, inferencePort: suppliedPort = null, authContextProvider = null, sourceParser = parseSourceFile, renderVisualPage = renderJournalPdfPage }) {
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
    const authorize = async () => {
      if (authContextProvider) Object.assign(auth, await authContextProvider());
      for (const purpose of ["archive", "organize_search", "session_use"]) await service.verifyCaseAccess(caseId, { requiredScope: "case:write", requiredPurpose: purpose }, auth);
    };
    await authorize();
    const route = environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON ? JSON.parse(environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON) : null;
    // Either subscription route: the desktop app driven over CDP, or the connector exchange that
    // Mission Control hands to fresh chats. Model, effort and zero spend are the same for both.
    if (!suppliedPort && route) invariant(["chatgpt_subscription_browser", "chatgpt_connector_exchange"].includes(route.provider)
      && route.model === "GPT-5.6 Sol" && route.effort === "Pro" && route.max_external_spend_usd === 0, "JOURNAL_SUBSCRIPTION_ROUTE_REQUIRED");
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
      state = { schema_version: 1, case_id: caseId, corpus_id: `corpus:${randomUUID()}`, generation: `generation:${randomUUID()}`, source_sha256: config.source.sha256, stage: "INTAKE", completion: completions(), completed_units: [], completed_visual_pages: [], calibration: "not_run", blocker: null };
      await privateJson(stateFile, state);
    }
    invariant(state.case_id === caseId && state.source_sha256 === config.source.sha256, "JOURNAL_RESUME_BINDING_MISMATCH");
    store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId: state.corpus_id, corpusKey: key, resumeMatchingObjects: true });
    port = suppliedPort ?? loadJournalInferencePortFromEnvironment({ ...environment }, {
      caseId,
      transportCheckpoint: value => store.writeJsonObject({
        objectId: `transport:${hash(value.context.request_id)}:${value.phase}`, value
      })
    });
    const semanticPort = port;
    // The connector exchange checks its root and clears stale temporary files before any work.
    await semanticPort.prepare?.();
    port = createDurableJournalInferencePort({ port: {
      capabilities: () => semanticPort.capabilities(),
      // Check immediately before the send, including after the durable intent was written.
      // A denial there is recorded as not submitted so resume cannot mistake it for a sent call.
      async invoke(input) {
        try { await authorize(); }
        catch (error) { error.submissionStatus = "not_submitted"; throw error; }
        const result = await semanticPort.invoke(input);
        // A grant may change during a long application call. Recheck before the
        // durable port admits its result or a dependent role receives it.
        await authorize();
        return result;
      },
      async getCompletion(operationKey) {
        await authorize();
        const result = await semanticPort.getCompletion(operationKey);
        await authorize();
        return result;
      },
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
    const save = async () => { state.updated_at = new Date().toISOString(); await privateJson(stateFile, state); };
    const writeLarge = async (id, value) => store.writeChunkedOriginal({ objectId: id, bytes: Buffer.from(JSON.stringify(value)) });
    const readLarge = async (ref) => { const b = await store.reassembleOriginal(ref); try { return JSON.parse(b.toString("utf8")); } finally { b.fill(0); } };
    const readIfPresent = async (id) => { try { return await store.readJsonObject({ objectId: id }); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
    const writeOnce = async (id, value) => {
      const prior = await readIfPresent(id);
      const canonical = (v) => JSON.stringify(v, (k, x) => k === "replay" ? undefined : x);
      if (prior) { invariant(canonical(prior) === canonical(value), "JOURNAL_IMMUTABLE_RESULT_CONFLICT"); return prior; }
      await store.writeJsonObject({ objectId: id, value }); return value;
    };
    const summary = () => ({ schema_version: 1, stage: state.stage, calibration: state.calibration,
      semantic_disposition: state.semantic_disposition ?? null,
      completed_units: state.completed_units.length, completed_visual_pages: state.completed_visual_pages.length,
      total_units: state.total_units ?? 0, required_visual_pages: state.required_visual_pages ?? 0,
      excluded_visual_pages: (state.excluded_visual_pages ?? []).map(page_number =>
        state.excluded_visual_page_details?.find(item => item.page_number === page_number)
          ?? { page_number, reason: "VISUAL_EXCLUSION_REASON_NOT_RECORDED" }),
      ...(state.semantic_disposition === "archive_only" ? { next_action: state.next_action } : {}),
      completion: structuredClone(state.completion), blocker: state.blocker,
      residuals: structuredClone(state.residuals ?? {}), external_spend_usd: 0 });

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
    async function work({ id, role, stage: workStage, unit = null, units = null, packetInput,
      identityPacketInput = packetInput, dependencies = [], acceptReviewFindings = false }) {
      workExhausted = false;
      await authorize();
      const scopeUnits = Array.isArray(units) ? units : (unit ? [unit] : []);
      invariant(scopeUnits.length > 0, "JOURNAL_WORK_SCOPE_INVALID");
      const assignedCoreIds = scopeUnits.map((item) => item.unit_id);
      const sourceLocators = scopeUnits.map((item) => ({
        representation_id: item.representation_id,
        page: item.page_number ?? null,
        start_byte: item.start_byte,
        end_byte: item.end_byte
      }));
      const identity = scopeUnits.length === 1
        ? { source_representation: scopeUnits[0].representation_id, core_range: { start_byte: scopeUnits[0].start_byte, end_byte: scopeUnits[0].end_byte } }
        : { source_representation: `batch:${hash(assignedCoreIds.join("\0")).slice(0, 40)}`,
            core_range: { start_byte: 0, end_byte: scopeUnits.reduce((total, item) => total + Math.max(0, item.end_byte - item.start_byte), 0) } };
      // Visual jobs must retain the pre-batch identity, including an unknown
      // submission from the prior runner. Batch-only scope fields belong to
      // the new semantic jobs; inserting them into a visual key resubmits it.
      const legacyVisual = role === "visual_reader" && workStage === "VISUAL_READ" && scopeUnits.length === 1;
      id = `job:${hash(JSON.stringify({ id, role, stage: workStage, packetInput: identityPacketInput,
        ...(legacyVisual ? {} : { assigned_core_ids: assignedCoreIds, source_locators: sourceLocators }),
        dependencies, instruction: journalRoleInstruction(role),
        dependency_instructions: dependencies.map(item => journalRoleInstruction(item.role)) }))}`;
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
          const completion = await port.getCompletion(operationKey);
          if (completion.status === "completed") {
            const recovered = { output: completion.output, receipt: completion.receipt };
            await writeOnce(resultId, recovered);
            state.blocker = null; await save();
            return [recovered];
          }
          if (completion.status === "invalid_output") {
            const attempt = firstFailure ? 2 : 1;
            await writeOnce(`reference:failure:${id}:${attempt}`, { status: "invalid_output", operation_key: operationKey, attempt });
            state.stage = workStage; state.blocker = "INVALID_STRUCTURED_OUTPUT"; await save(); return null;
          }
          // An authoritative port can safely wait on this exact operation key: invoke() resumes the
          // existing submission instead of sending a duplicate. The completion check above is only
          // a snapshot, so an answer may arrive immediately after it reports unknown.
          if (completion.status === "unknown" && port.capabilities?.()?.authoritative_completion === true) break;
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
          await authorize();
          result = await port.invoke({ role, packet: buildJournalRolePacket(role, {
            protocol_version: "1.0", output_schema_id: JOURNAL_ROLE_DEFINITIONS[role].outputSchema,
            assigned_core_ids: assignedCoreIds, source_locators: sourceLocators,
            expected_generation: state.generation, controller_provenance_tag: id,
            grant_purpose: grant.purpose, ...packetInput
          }), outputSchema: JOURNAL_ROLE_DEFINITIONS[role].outputSchema, operationKey, grant });
        } catch (error) {
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
          if (error.submissionStatus === "not_submitted" && port.capabilities?.()?.authoritative_completion === true) {
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
        promptVersion: `1.0:${hash(id).slice(0, 24)}`, modelProfile: route?.model ?? "synthetic", beforeInvoke: authorize,
        resolvePacketInput: async (input) => {
          const image = input?.page_image_ref;
          if (image?.kind !== "chunked_image") return input;
          const bytes = await store.reassembleOriginal(image.object_ref);
          try {
            invariant(hash(bytes) === image.sha256 && bytes.length === image.byte_length, "VISUAL_IMAGE_DIGEST_MISMATCH");
            return { ...input, page_image_ref: { kind: "inline_image", media_type: image.media_type,
              data_base64: bytes.toString("base64"), sha256: image.sha256 } };
          } finally { bytes.fill(0); }
        } });
      try {
        if (!(await ledger.load())) await controller.initialize({ jobId: id, caseId, corpusId: state.corpus_id, generation: state.generation, workDefinitions: [{ key: role, stage: workStage, role, identity, assigned_core_ids: assignedCoreIds, source_locators: sourceLocators, packet_input: packetInput }, ...dependencies] });
        const entry = await controller.runUntilBlocked({ maximumSteps: 8 });
        const unfinished = entry.snapshot.work_items.find((item) => item.status !== "completed");
        // A primary output that asks for smaller windows or more context parks its job, and its
        // reviewers never run. The caller repairs or splits such a batch, so it is handed back
        // rather than stopping the run for good.
        const [primary] = entry.snapshot.work_items;
        const parked = acceptReviewFindings && primary?.status === "needs_context" && primary.output && primary.receipt;
        if (unfinished && !parked && !(acceptReviewFindings && entry.snapshot.work_items.every(item => item.output && item.receipt))) {
          state.stage = unfinished.stage; state.blocker = entry.snapshot.checkpoint.blocked_reason ?? "OUTPUT_INCOMPLETE";
          workExhausted = unfinished.status === "blocked_authority" && state.blocker === "INVALID_STRUCTURED_OUTPUT";
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
    // A work result is used only once it passes its check. Each attempt has its own ID, so a rerun
    // replays the stored attempts in order, neither using a failed one nor sending it again. After
    // the last attempt the caller decides what the unresolved step means for its stage, instead of
    // the same stored answer failing the same check on every run.
    async function checkedWork(request, check = () => {}) {
      let failure = null;
      for (let attempt = 1; attempt <= CHECKED_ATTEMPTS; attempt += 1) {
        const result = await work({ ...request, id: attempt === 1 ? request.id : `${request.id}:attempt:${attempt}` });
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
      return { failure };
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
      const bounded = (text, side) => {
        const characters = [...text];
        let size = 0;
        const result = [];
        for (const character of side === "before" ? characters.reverse() : characters) {
          const bytes = Buffer.byteLength(character);
          if (size + bytes > 8000) break;
          size += bytes;
          result.push(character);
        }
        return (side === "before" ? result.reverse() : result).join("");
      };
      const neighborsFor = (unit) => {
        const index = unit.visual
          ? nativeUnits.findIndex((item) => item.page_number >= unit.page_number)
          : nativeUnits.indexOf(unit);
        const before = bounded(nativeUnits[(index < 0 ? nativeUnits.length : index) - 1]?.text ?? "", "before");
        const after = bounded(nativeUnits[unit.visual ? index : index + 1]?.text ?? "", "after");
        return { unit_id: unit.unit_id, before: unit.context.before || before, after: unit.context.after || after };
      };
      const visualContextFor = async (units) => {
        const pages = [...new Set(units.map((unit) => unit.page_number).filter(Number.isSafeInteger))];
        const output = [];
        for (const pageNumber of pages) {
          const visual = await readIfPresent(`visual:result:${pageNumber}`);
          if (visual?.output) output.push(visual.output);
        }
        return output;
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
      const recordSourceOnly = async (unit, reason) => {
        const sourceOnlyExtraction = { schema_version: "1.0", status: "incomplete", assertions: [], entities: [], episodes: [],
          coverage: [{ unit_id: unit.unit_id, disposition: "needs_review", assertion_local_ids: [],
            reason: `Semantic processing ended for this unit (${reason}); the archived source remains available.` }],
          requested_context: [] };
        const graph = bindUnitExtraction(unit, sourceOnlyExtraction, { receipt_id: `mechanical:source-only:${unit.unit_id}` });
        await writeOnce(`unit:graph:${unit.unit_id}`, { graph, extraction: null, omission: null,
          source_only_unresolved: true, source_only_reason: reason });
        if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
        state.stage = "EXTRACT"; state.blocker = null; await save();
        return true;
      };
      const processBatch = async (incoming, calibration = false) => {
        // Reuse the frozen scope even when a crash occurred between writing two
        // unit records. The completed job and its receipt keep the same identity.
        const units = incoming;
        if (units.every((unit) => state.completed_units.includes(unit.unit_id))) return true;
        const finishExhausted = async (reason) => {
          if (!workExhausted) return false;
          if (units.length > 1) {
            const middle = Math.ceil(units.length / 2);
            return await processBatch(units.slice(0, middle), calibration)
              && await processBatch(units.slice(middle), calibration);
          }
          return recordSourceOnly(units[0], reason);
        };
        const keyId = batchKey(units);
        const core = units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text }));
        const adjacentContext = { by_unit: units.map(neighborsFor) };
        const visualContext = await visualContextFor(units);
        const sourcePacketBytes = Buffer.byteLength(JSON.stringify({
          core_units: core, adjacent_context: adjacentContext, visual_transcriptions: visualContext
        }));
        if (sourcePacketBytes > 180_000) {
          if (units.length > 1) {
            const middle = Math.ceil(units.length / 2);
            return await processBatch(units.slice(0, middle), calibration)
              && await processBatch(units.slice(middle), calibration);
          }
          return recordSourceOnly(units[0], "SEMANTIC_PACKET_OVERSIZE");
        }
        let reference = null;
        if (calibration) {
          const frozen = await checkedWork({
            id: `reference:calibration:batch:${keyId}`,
            role: "reference_reader",
            stage: "REFERENCE_AUDIT",
            units,
            packetInput: { source_windows: core, adjacent_context: adjacentContext, visual_context: visualContext, neutral_reading_instructions: [] }
          }, ([saved]) => {
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
          // single unit stops calibration with its own blocker, since calibration is the gate that
          // decides whether the run goes on at all.
          if (frozen.failure && units.length > 1) {
            const middle = Math.ceil(units.length / 2);
            return await processBatch(units.slice(0, middle), calibration)
              && await processBatch(units.slice(middle), calibration);
          }
          if (frozen.failure) {
            return recordSourceOnly(units[0], "CALIBRATION_REFERENCE_UNRESOLVED");
          }
          reference = frozen.result[0];
        }
        let results, repairRequest, split, graphsByUnit, bindingFailure;
        for (let cycle = 0; cycle <= 2; cycle += 1) {
          const identity = identityFor(units);
          results = await work({
            id: `extract:batch:${keyId}:cycle:${cycle}`,
            role: "extractor",
            stage: "EXTRACT",
            units,
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
              identity,
              assigned_core_ids: units.map((unit) => unit.unit_id),
              source_locators: locatorsFor(units),
              packet_input: {
                core_units: core,
                adjacent_context: adjacentContext,
                candidate_extraction: { $work_output: "extractor" },
                target_generation: state.generation
              }
            }],
            acceptReviewFindings: true
          });
          if (!results) return finishExhausted("EXTRACTION_ATTEMPTS_EXHAUSTED");
          // The extractor asked for smaller windows or more context: split a batch of several units
          // at once instead of asking again for the same window.
          if (["incomplete", "needs_context"].includes(results[0].output?.status) && units.length > 1) {
            const middle = Math.ceil(units.length / 2);
            return await processBatch(units.slice(0, middle), calibration)
              && await processBatch(units.slice(middle), calibration);
          }
          bindingFailure = null;
          try {
            split = splitBatchExtractionByUnit({ extraction: results[0].output, unitIds: units.map((unit) => unit.unit_id) });
            graphsByUnit = new Map(units.map((unit) => [
              unit.unit_id,
              bindUnitExtraction(unit, split.get(unit.unit_id), results[0].receipt)
            ]));
          } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            split = null;
            graphsByUnit = null;
            bindingFailure = { code: error.code, details: error.details ?? null };
          }
          const review = results[1]?.output;
          if (!bindingFailure && results[0].output.status === "complete"
            && review?.status === "sufficient_for_stated_scope"
            && !review.assessments.some((assessment) => assessment.outcome !== "preserved"
              || assessment.finding_type !== "none")
            && review.unassessed_ids.length === 0) break;
          repairRequest = {
            previous_extraction: results[0].output,
            omission_review: review,
            mechanical_failure: bindingFailure,
            cycle: cycle + 1
          };
        }
        const review = results?.[1]?.output;
        const unresolved = Boolean(bindingFailure)
          || results?.[0]?.output?.status !== "complete"
          || review?.status !== "sufficient_for_stated_scope"
          || review.assessments.some((assessment) => assessment.outcome !== "preserved"
            || assessment.finding_type !== "none")
          || review.unassessed_ids.length > 0;
        if (unresolved && units.length > 1) {
          const middle = Math.ceil(units.length / 2);
          return await processBatch(units.slice(0, middle), calibration)
            && await processBatch(units.slice(middle), calibration);
        }
        if (unresolved && calibration) {
          return recordSourceOnly(units[0], "CALIBRATION_REPAIR_REQUIRED");
        }
        if (unresolved) {
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
          await writeOnce(`unit:graph:${unit.unit_id}`, { graph, extraction: results[0], omission: results[1], source_only_unresolved: true });
          if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
          state.stage = "EXTRACT";
          state.blocker = null;
          await save();
          return true;
        }
        if (calibration) {
          const combined = mergeGraphs([...graphsByUnit.values()]);
          let score;
          const initialFidelity = await checkedWork({
            id: `fidelity:calibration:batch:${keyId}`,
            role: "fidelity_auditor",
            stage: "REFERENCE_AUDIT",
            units,
            packetInput: {
              frozen_reference: reference.output,
              supporting_passages: core,
              imported_generation: {
                generation: state.generation,
                assertions: combined.nodes.filter((node) => node.kind === "assertion"),
                entities: combined.nodes.filter((node) => node.kind === "entity")
              }
            }
          }, ([saved]) => { score = scoreReferenceReview({ referenceResult: reference.output,
            reviewResult: saved.output,
            candidateIds: combined.nodes.filter((node) => node.kind === "assertion").map((node) => node.id) }); });
          if (initialFidelity.blocked) return false;
          if (initialFidelity.failure) {
            if (units.length > 1) {
              const middle = Math.ceil(units.length / 2);
              return await processBatch(units.slice(0, middle), true)
                && await processBatch(units.slice(middle), true);
            }
            return recordSourceOnly(units[0], "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED");
          }
          let fidelity = initialFidelity.result;
          await writeOnce(`calibration:review:batch:${keyId}`, { reference, fidelity: fidelity[0], score, unit_ids: units.map((unit) => unit.unit_id) });
          let calibrationPass = fidelity[0].output.status === "sufficient_for_stated_scope"
            && score.critical_miss_count === 0
            && score.qualifier_error_count === 0
            && score.reference_counts.unassessed === 0
            && (score.reference_total === 0 || score.provisional_target_met);
          if (!calibrationPass && units.length > 1) {
            const middle = Math.ceil(units.length / 2);
            return await processBatch(units.slice(0, middle), true)
              && await processBatch(units.slice(middle), true);
          }
          for (let auditCycle = 1; !calibrationPass && auditCycle <= 2; auditCycle += 1) {
            const identity = identityFor(units);
            const repaired = await work({
              id: `extract:calibration-repair:batch:${keyId}:cycle:${auditCycle}`,
              role: "extractor",
              stage: "EXTRACT",
              units,
              packetInput: {
                core_units: core,
                adjacent_context: adjacentContext,
                visual_transcriptions: visualContext,
                repair_request: {
                  previous_extraction: results[0].output,
                  omission_review: results[1].output,
                  fidelity_review: fidelity[0].output,
                  cycle: `fidelity-${auditCycle}`
                }
              },
              dependencies: [{
                key: "omission",
                stage: "OMISSION_CHECK",
                role: "omission_checker",
                identity,
                assigned_core_ids: units.map((unit) => unit.unit_id),
                source_locators: locatorsFor(units),
                packet_input: {
                  core_units: core,
                  adjacent_context: adjacentContext,
                  candidate_extraction: { $work_output: "extractor" },
                  target_generation: state.generation
                }
              }],
              acceptReviewFindings: true
            });
            if (!repaired) return finishExhausted("CALIBRATION_REPAIR_ATTEMPTS_EXHAUSTED");
            results = repaired;
            const repairedReview = repaired[1]?.output;
            let repairedSplit, repairedGraphs;
            try {
              repairedSplit = splitBatchExtractionByUnit({
                extraction: repaired[0].output,
                unitIds: units.map((unit) => unit.unit_id)
              });
              repairedGraphs = new Map(units.map((unit) => [
                unit.unit_id,
                bindUnitExtraction(unit, repairedSplit.get(unit.unit_id), repaired[0].receipt)
              ]));
            } catch (error) {
              if (!(error instanceof ValidationError)) throw error;
              continue;
            }
            if (repaired[0].output.status !== "complete"
              || repairedReview?.status !== "sufficient_for_stated_scope"
              || repairedReview.assessments.some((assessment) => assessment.outcome !== "preserved"
                || assessment.finding_type !== "none")
              || repairedReview.unassessed_ids.length > 0) continue;
            split = repairedSplit;
            graphsByUnit = repairedGraphs;
            const repairedCombined = mergeGraphs([...graphsByUnit.values()]);
            let repairedScore;
            const repairedFidelityAttempt = await checkedWork({
              id: `fidelity:calibration-repair:batch:${keyId}:cycle:${auditCycle}`,
              role: "fidelity_auditor",
              stage: "REFERENCE_AUDIT",
              units,
              packetInput: {
                frozen_reference: reference.output,
                supporting_passages: core,
                imported_generation: {
                  generation: state.generation,
                  assertions: repairedCombined.nodes.filter((node) => node.kind === "assertion"),
                  entities: repairedCombined.nodes.filter((node) => node.kind === "entity")
                }
              }
            }, ([saved]) => { repairedScore = scoreReferenceReview({ referenceResult: reference.output,
              reviewResult: saved.output,
              candidateIds: repairedCombined.nodes.filter((node) => node.kind === "assertion").map((node) => node.id) }); });
            if (repairedFidelityAttempt.blocked) return false;
            if (repairedFidelityAttempt.failure)
              return recordSourceOnly(units[0], "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED");
            const repairedFidelity = repairedFidelityAttempt.result;
            await writeOnce(`calibration:repair-review:batch:${keyId}:cycle:${auditCycle}`, {
              reference, fidelity: repairedFidelity[0], score: repairedScore,
              unit_ids: units.map((unit) => unit.unit_id)
            });
            fidelity = repairedFidelity;
            score = repairedScore;
            calibrationPass = fidelity[0].output.status === "sufficient_for_stated_scope"
              && score.critical_miss_count === 0
              && score.qualifier_error_count === 0
              && score.reference_counts.unassessed === 0
              && (score.reference_total === 0 || score.provisional_target_met);
          }
          if (!calibrationPass) {
            return recordSourceOnly(units[0], "CALIBRATION_REPAIR_REQUIRED");
          }
        }
        for (const unit of units) {
          await writeOnce(`unit:graph:${unit.unit_id}`, {
            graph: graphsByUnit.get(unit.unit_id),
            extraction: results[0],
            unit_extraction: split.get(unit.unit_id),
            omission: results[1],
            source_only_unresolved: false
          });
          if (!state.completed_units.includes(unit.unit_id)) state.completed_units.push(unit.unit_id);
        }
        state.stage = "EXTRACT";
        state.blocker = null;
        await save();
        return true;
      };

      for (const unit of oversizedUnits) await recordSourceOnly(unit, "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND");
      for (const ids of frozenPlan.calibration_batches) {
        if (!(await processBatch(frozenUnits(ids), true))) return summary();
      }
      if ([...calibrationIds].every((id) => state.completed_units.includes(id))) {
        const calibrationRecords = await Promise.all([...calibrationIds].map(id => readIfPresent(`unit:graph:${id}`)));
        state.calibration = calibrationRecords.some(record => record?.source_only_unresolved) ? "partial" : "pass";
        state.blocker = null;
        await save();
      }
      for (const ids of frozenPlan.regular_batches) {
        if (!(await processBatch(frozenUnits(ids), false))) return summary();
      }

      const nodes = new Map(), edges = new Map();
      for (const unit of plan.units) {
        const result = await store.readJsonObject({ objectId: `unit:graph:${unit.unit_id}` });
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

    async function run({ visualOnly = false } = {}) {
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
          let image;
          try { image = await renderVisualPage(await archivedSource(), pageNumber); }
          catch (error) {
            if (error?.code !== "VISUAL_RENDER_TOO_LARGE") throw error;
            await excludeVisualPage(pageNumber, error.code);
            continue;
          }
          const native = plan.parsed.representations.find((r) => r.representation_id === page.representation_id);
          const imageDigest = hash(image);
          const imageRef = await store.writeChunkedOriginal({ objectId: `visual:image:${pageNumber}`, bytes: image });
          await writeOnce(`visual:image-ref:${pageNumber}`, imageRef);
          const legacyPacketInput = { page_image_ref: { kind: "inline_image", media_type: "image/png",
            data_base64: image.toString("base64"), sha256: imageDigest }, page_geometry: page.geometry,
            native_text_rendering: native.text, neighbor_pages: [] };
          const packetInput = { ...legacyPacketInput, page_image_ref: { kind: "chunked_image", media_type: "image/png",
            object_ref: imageRef, byte_length: image.length, sha256: imageDigest } };
          const read = await checkedWork({ id: `visual:${pageNumber}`, role: "visual_reader", stage: "VISUAL_READ", unit: { unit_id: `page:${pageNumber}`, representation_id: page.representation_id, start_byte: 0, end_byte: image.length, page_number: pageNumber }, packetInput, identityPacketInput: legacyPacketInput },
            ([saved]) => {
              invariant(saved.output.source_page_id === `page:${pageNumber}`, "VISUAL_PAGE_BINDING_MISMATCH");
              // Unreadable regions are valid dispositions. page_complete=false instead means that
              // at least one visible region has no disposition and the page must be tried again.
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
      if (state.reconciled_ref) return summary();
      let graph = await readLarge(state.graph_ref);
      const unitGraphs = new Map(), aliases = new Map();
      const unitIndex = new Map(plan.units.map((unit, index) => [unit.unit_id, index]));
      for (const unit of plan.units) {
        const record = await readIfPresent('unit:graph:' + unit.unit_id);
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
      // unresolved and is counted, as the reconciler's contract intends. Only a unit whose extraction
      // stayed unresolved leaves the graph itself partial.
      const sourceOnlyUnits = [...unitGraphs.values()].filter(record => record.source_only_unresolved).length;
      state.completion.graph_built = sourceOnlyUnits > 0 ? 'partial' : 'pass';
      const reconciliationBatches = new Map();
      for (const report of reports) reconciliationBatches.set(report.batch_ref, report);
      state.residuals = { ...(state.residuals ?? {}),
        source_only_units: sourceOnlyUnits,
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
      invariant(state.reconciled_ref, "JOURNAL_RECONCILIATION_NOT_READY");
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
      const reports = [];
      for (const unit of plan.units.filter(u => selected.has(u.unit_id))) {
        let report = await readIfPresent(`audit:result:${graphRevision}:${unit.unit_id}`);
        if (!report) {
          const imported = await readIfPresent(`unit:graph:${unit.unit_id}`);
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
            const original = [{ unit_id: unit.unit_id, text: unit.text }];
            const frozen = await checkedWork({ id: `reference:final:${unit.unit_id}`, role: "reference_reader", stage: "REFERENCE_AUDIT", unit, packetInput: { source_windows: original, adjacent_context: unit.context, visual_context: visual ? [visual.output] : [], neutral_reading_instructions: [] } },
              ([saved]) => {
                for (const item of saved.output.reference_items) for (const anchor of item.anchors) {
                  invariant(anchor.unit_id === unit.unit_id, "REFERENCE_ANCHOR_OUTSIDE_SOURCE_PACKET"); resolveExactQuote(unit.text, anchor.quote, anchor.occurrence);
                }
              });
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
              const fidelity = await checkedWork({ id: `fidelity:final:${unit.unit_id}`, role: "fidelity_auditor", stage: "REFERENCE_AUDIT", unit, packetInput: { frozen_reference: reference.output, supporting_passages: [...original, ...scope.supporting_passages], imported_generation: { generation: state.generation, graph: scope.graph, assessment_target_ids: scope.assessment_target_ids } } }, saved => { assessedOutcome = assess(saved); });
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
      const assessed = reports.filter(r => !r.unassessed);
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
      invariant(state.reconciled_ref && state.audit_report_ref
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
        const imported = await readIfPresent(`unit:graph:${unit.unit_id}`);
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
          const imported = await readIfPresent(`unit:graph:${report.unit_id}`);
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
        const record = await readIfPresent(`unit:graph:${unit.unit_id}`);
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
      state.residuals = { ...(state.residuals ?? {}), audit_excluded_records: untrusted.size, ...result.counts };
      state.stage = "COMMIT";
      state.blocker = null;
      await save();
      return summary();
    }

    async function commit() {
      // Every stage ran to its end. A stage that ended with residuals (a unit left source-only, audit
      // findings, an unresolved pattern batch) is committed as partial, with its counts in the
      // summary, rather than holding back everything that did resolve.
      const finished = (status) => ["pass", "partial"].includes(status);
      invariant(finished(state.calibration) && state.completion.archive_verified === "pass"
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

    return Object.freeze({
      async execute(command) {
        if (["inventory", "stage"].includes(command)) return stage();
        if (command === "run") return run();
        if (command === "visual-only") return run({ visualOnly: true });
        if (command === "audit") return audit();
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
      async close() { store.close(); port.close?.(); providers?.close(); secretBuffers.forEach((b) => b.fill(0)); await lock.release(); }
    });
  } catch (e) { store?.close(); port?.close?.(); providers?.close(); secretBuffers.forEach((b) => b.fill(0)); await lock.release(); throw e; }
}
