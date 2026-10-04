import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import {
  PRIVATE_CASE_SCOPES,
  PRIVATE_JOURNAL_PURPOSES,
  createPrivateCaseAccessService,
  loadDevelopmentPrivateCaseProviders
} from "../src/storage/private-case-access.mjs";
import { chunkExactSourceText } from "../src/storage/exact-source-artifact.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { createPrivateCaseOrchestrator } from "../src/supervisor/private-case-orchestration.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coldFixture = path.join(root, "tests/fixtures/journal-cold-session.mjs");
const CASE_ID = "synthetic-case";
const CORPUS_ID = "synthetic-corpus";
const GENERATION = "generation-1";
const TOKEN = "synthetic-journal-continuity-token";
const SEARCH_ONLY_TOKEN = "synthetic-journal-search-only-token";
const HANDOFF_ID = "handoff:00000000-0000-4000-8000-000000000007";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixture = async (name) => JSON.parse(await fs.readFile(path.join(root, "schemas/journal-import/fixtures", name), "utf8"));

function turn(id, role, text, episodeId = null) {
  return { id, exchange_id: id.split("-")[0], role, text, at: "2026-09-22T12:00:00.000Z", episode_id: episodeId };
}

function state() {
  return applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    items: [{
      id: "evidence:older",
      domain: "long_term_target",
      statement: "Synthetic older evidence remains retrievable.",
      status: "direct_report",
      confidence: "high",
      source: { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user", recorded_at: "2026-09-20T12:00:00.000Z" },
      still_current: true,
      supersedes: [],
      decision_relevance: "high"
    }],
    current_episode: {
      id: "episode:current",
      target: "Preserve the exact active episode while consulting bounded journal evidence.",
      route: "IC.PROTECTOR_ACTION",
      prediction: "The active episode remains authoritative.",
      next_question: "What changed?",
      started_turn_id: "E2-user",
      constitutional_aim_ids: ["CARE", "PROTECTION"],
      adverse_signs: ["less choice"],
      stay_conditions: ["more choice"],
      switch_conditions: ["no movement"],
      stop_conditions: ["decline"],
      source_item_ids: ["evidence:older"]
    }
  });
}

async function environment(t) {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-continuity-"));
  await fs.chmod(privateRoot, 0o700);
  const vaultRoot = path.join(privateRoot, "vaults");
  const credentialsPath = path.join(privateRoot, "credentials.json");
  const credentials = {
    schema_version: 1,
    root_dir: vaultRoot,
    grants: [
      {
        token_sha256: sha256(TOKEN),
        principal_id: "synthetic-journal-consumer",
        case_ids: [CASE_ID],
        scopes: Object.values(PRIVATE_CASE_SCOPES),
        purposes: Object.values(PRIVATE_JOURNAL_PURPOSES)
      },
      {
        token_sha256: sha256(SEARCH_ONLY_TOKEN),
        principal_id: "synthetic-journal-search-only-consumer",
        case_ids: [CASE_ID],
        scopes: [PRIVATE_CASE_SCOPES.READ],
        purposes: [PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH]
      }
    ],
    case_keys: {
      [CASE_ID]: {
        routine_kek_base64: Buffer.alloc(32, 61).toString("base64"),
        recovery_secret_base64: Buffer.alloc(32, 62).toString("base64")
      }
    }
  };
  await fs.writeFile(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  await fs.chmod(credentialsPath, 0o600);
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  const service = createPrivateCaseAccessService({
    rootDir: providers.rootDir,
    authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider,
    allowDevelopmentFileProvider: true,
    now: (() => { let tick = 0; return () => new Date(1_800_000_000_000 + tick++).toISOString(); })()
  });
  t.after(() => providers.close());
  t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  return { privateRoot, providers, service };
}

async function seedProfile(service, authContext) {
  await service.saveCaseState(CASE_ID, state(), authContext);
  await service.saveCaseDiff(CASE_ID, { schema_version: 1, additions: ["evidence:older"], current_episode_changed: true }, { turnId: "E2-user", diffId: "diff:E2" }, authContext);
  await service.appendTranscriptTurn(CASE_ID, turn("E1-user", "user", "Synthetic exact older evidence."), authContext);
  await service.appendTranscriptTurn(CASE_ID, turn("E1-assistant", "assistant", "Synthetic older reply."), authContext);
  await service.appendTranscriptTurn(CASE_ID, turn("E2-user", "user", "Synthetic current episode starts.", "episode:current"), authContext);
  await service.appendTranscriptTurn(CASE_ID, turn("E2-assistant", "assistant", "Synthetic current episode reply.", "episode:current"), authContext);
  await service.saveCandidateResponse(CASE_ID, "candidate:journal:current", "Exact pending candidate must remain unchanged.", {
    status: "pending_audit",
    based_on_turn_id: "E2-user",
    producer_context_id: "producer:journal:synthetic"
  }, authContext);
  await service.saveSourceArtifact(CASE_ID, "source:legacy:journal-test", chunkExactSourceText("Synthetic exact older evidence."), { scope: "synthetic" }, authContext);
}

test("purpose-scoped profile commitment supports a truly cold paginated source readback without replacing current case state", async (t) => {
  const { privateRoot, providers, service } = await environment(t);
  assert.equal(providers.journalEnabled, true);
  const authContext = { bearerToken: TOKEN };
  await seedProfile(service, authContext);
  await service.createJournalCorpus(CASE_ID, { corpusId: CORPUS_ID, manifestObjectId: "manifest:staging" }, authContext);
  const graph = await fixture("synthetic-graph.json");
  const sources = await fixture("synthetic-sources.json");
  const visualPassage = graph.nodes.find(({ id }) => id === "p7");
  visualPassage.data.locator = {
    kind: "visual_transcript",
    page: 7,
    bbox: [10, 20, 300, 80],
    original_object_id: "original",
    interpretation_status: "verified"
  };
  let persisted;
  await service.withJournalCorpus(CASE_ID, CORPUS_ID, {
    requiredScope: PRIVATE_CASE_SCOPES.WRITE,
    requiredPurpose: PRIVATE_JOURNAL_PURPOSES.ARCHIVE
  }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({
      corpusStore,
      graph,
      sourceRepresentations: sources,
      permittedUses: ["archive", "organize_search", "session_use"],
      shardTargetBytes: 4096
    });
  }, authContext);
  const beforeCommit = await service.loadPrivateRuntimeCase(CASE_ID, authContext);
  const api = createJournalPrivateApi({ caseAccessService: service });
  const commit = await createPrivateCaseOrchestrator({ caseAccessService: service }).execute({
    schema_version: 1,
    operation: "commit_journal_generation",
    case_id: CASE_ID,
    corpus_id: CORPUS_ID,
    generation: GENERATION,
    manifest_object_id: persisted.manifest_object_id,
    expected_generation: null,
    expected_case_revision: beforeCommit.revision,
    permitted_uses: ["archive", "organize_search", "session_use"]
  }, authContext);
  assert.equal(commit.active_generation, GENERATION);
  const afterCommit = await service.loadPrivateRuntimeCase(CASE_ID, authContext);
  assert.deepEqual(afterCommit.case_state, beforeCommit.case_state);
  assert.deepEqual(afterCommit.raw_transcript, beforeCommit.raw_transcript);
  assert.deepEqual(afterCommit.candidate_responses, beforeCommit.candidate_responses);
  await assert.rejects(
    () => api.search({ caseId: CASE_ID, corpusId: CORPUS_ID, query: "help", purpose: "session_use" }, { bearerToken: SEARCH_ONLY_TOKEN }),
    (error) => error.code === "PRIVATE_CASE_ACCESS_DENIED"
  );
  const firstPage = await api.search({ caseId: CASE_ID, corpusId: CORPUS_ID, query: "help", purpose: "organize_search", pageSize: 1 }, authContext);
  assert.equal(firstPage.more_available, true);
  await assert.rejects(
    () => api.search({ caseId: CASE_ID, corpusId: CORPUS_ID, query: "help", purpose: "session_use", pageSize: 1, cursor: firstPage.next_cursor }, authContext),
    /CURSOR_PURPOSE_MISMATCH/
  );

  await assert.rejects(
    () => service.loadCaseContext(CASE_ID, authContext, { requireContinuationSafe: true, episodePolicy: { requireCompleteEpisode: true } }),
    (error) => error.code === "CASE_NOT_CONTINUATION_SAFE" && error.details.failures.includes("journal continuity capability is unsupported by this consumer")
  );
  const snapshot = await api.handoffSnapshot(CASE_ID, authContext);
  assert.equal(snapshot.continuation_safety.continuation_safe, true);
  assert.equal(snapshot.journal_continuity.mode, "external_reference_only");
  assert.equal(snapshot.journal_continuity.portable_objects_included, false);
  assert.equal(snapshot.current_episode.id, "episode:current");
  assert.equal(snapshot.candidate_response.exact_text, "Exact pending candidate must remain unchanged.");

  const handoffReceipt = await service.createHandoff(CASE_ID, { handoffId: HANDOFF_ID, runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" }, authContext);
  assert.equal(handoffReceipt.handoff_status, "READY_FOR_FRESH_SESSION_TEST");
  await assert.rejects(() => service.loadHandoff(HANDOFF_ID, authContext), /journal continuity capability is unsupported/);
  const handoff = await service.loadHandoff(HANDOFF_ID, authContext, { journalContinuitySupported: true });
  assert.equal(handoff.schema_version, 4);
  assert.deepEqual(handoff.journal_continuity.corpora.map(({ corpus_id }) => corpus_id), [CORPUS_ID]);
  assert.equal(handoff.journal_continuity.requires_live_source_service, true);

  const listener = await listenPrivateCaseMcp({ caseAccessService: service, journalApi: api });
  t.after(() => listener.close());
  const listed = await fetch(listener.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  }).then((response) => response.json());
  const journalTools = listed.result.tools.filter((tool) => tool.name.includes("journal"));
  assert.deepEqual(journalTools.map(({ name }) => name), [
    "get_journal_entries",
    "search_journal_graph",
    "get_journal_subgraph",
    "resolve_journal_evidence",
    "get_journal_timeline"
  ]);
  assert.ok(journalTools.every((tool) => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false));
  assert.equal(listed.result.tools.some((tool) => /commit|correct|delete|visibility|import/i.test(tool.name)), false);

  const coldOutput = path.join(privateRoot, "cold-result.json");
  await execFileAsync(process.execPath, [coldFixture, listener.url, coldOutput], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      INNER_SIGNAL_JOURNAL_COLD_TOKEN: TOKEN,
      INNER_SIGNAL_JOURNAL_COLD_CASE_ID: CASE_ID,
      INNER_SIGNAL_JOURNAL_COLD_CORPUS_ID: CORPUS_ID
    },
    maxBuffer: 4_000_000
  });
  const cold = JSON.parse(await fs.readFile(coldOutput, "utf8"));
  assert.deepEqual(cold.isolation, {
    original_upload_available: false,
    producer_history_available: false,
    corpus_key_available: false,
    answer_key_available: false
  });
  const byId = new Map(cold.results.map((result) => [result.question_id, result]));
  assert.equal(byId.get("early").evidence.exact_spans.some(({ evidence_id }) => evidence_id === "p1"), true);
  assert.equal(byId.get("middle").evidence.exact_spans.some(({ quote }) => quote.includes("discomfort in my arm continued")), true);
  assert.equal(byId.get("late-visual").evidence.source_locators.some(({ kind, interpretation_status: status }) => kind === "visual_transcript" && status === "verified"), true);
  assert.equal(byId.get("correction").evidence.exact_spans.some(({ evidence_id }) => evidence_id === "p5"), true);
  assert.equal(byId.get("absent").status, "not_found_in_authorized_material");
  assert.ok([...byId.values()].filter(({ status }) => status === "evidence_retrieved").every(({ snapshot_generation: generation }) => generation === GENERATION));

  const encryptedCorpusBodies = await Promise.all((await fs.readdir(path.join(vaultRootFor(providers.rootDir), corpusStorageName(CASE_ID, CORPUS_ID))))
    .map((name) => fs.readFile(path.join(vaultRootFor(providers.rootDir), corpusStorageName(CASE_ID, CORPUS_ID), name), "utf8")));
  assert.equal(encryptedCorpusBodies.some((body) => body.includes("I often hesitate to ask for help")), false);
});

function vaultRootFor(rootDir) {
  return path.join(rootDir, ".journal-corpora");
}

function corpusStorageName(caseId, corpusId) {
  return sha256(Buffer.from(`${caseId}\0${corpusId}`, "utf8")).slice(0, 48);
}

test("therapy producer and independent auditor receive the same frozen bounded journal packet without replacing the active episode", async (t) => {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-runtime-"));
  t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  const store = createEncryptedPrivateCaseStore({
    rootDir: privateRoot,
    routineKek: Buffer.alloc(32, 81),
    recoverySecretBytes: Buffer.alloc(32, 82),
    osBackedReauthenticated: true,
    now: () => "2026-09-22T18:00:00.000Z"
  });
  t.after(() => store.close());
  const seen = [];
  let freezes = 0;
  const journalEvidenceProvider = {
    async freezeForTurn({ maximumTokens, reserveCompleteActiveEpisode, reserveMandatoryAuditContext }) {
      freezes += 1;
      assert.equal(maximumTokens, 8_000);
      assert.equal(reserveCompleteActiveEpisode, true);
      assert.equal(reserveMandatoryAuditContext, true);
      return { packet: { schema_version: 1, generation: GENERATION, evidence_groups: [{ ids: ["a3", "p3", "p5"], closure_status: "complete" }], more_available: true } };
    }
  };
  const modelRuntime = {
    async produceCandidate({ caseId, runtimeTurn, journalEvidence, attemptContextId }) {
      seen.push({ role: "producer", journalEvidence: structuredClone(journalEvidence) });
      return {
        exactText: "Synthetic journal-informed candidate.",
        contextId: "context:journal:producer",
        caseState: applyCaseStatePatch(createEmptyCaseState({ caseId }), {
          current_episode: {
            id: "episode:journal:runtime",
            target: "Keep the current target authoritative.",
            route: "SYNTHETIC.JOURNAL",
            prediction: "Journal evidence remains supplemental.",
            next_question: "What is current now?",
            started_turn_id: runtimeTurn.user_turn_id,
            constitutional_aim_ids: ["CARE"],
            adverse_signs: ["archive replaces present state"],
            stay_conditions: ["current episode remains explicit"],
            switch_conditions: ["evidence is insufficient"],
            stop_conditions: ["decline"],
            source_item_ids: []
          }
        }),
        stateDiff: { schema_version: 1, additions: [], current_episode_changed: true },
        result: { producerAttemptContextId: attemptContextId }
      };
    },
    async auditCandidate({ candidate, journalEvidence }) {
      seen.push({ role: "auditor", journalEvidence: structuredClone(journalEvidence) });
      return {
        contextId: "context:journal:auditor",
        value: { findings: [], repair_induced_checks: candidate.parent_candidate_id == null ? [] : ["PRESERVE_UNAFFECTED_CONTENT", "NO_NEW_UNSUPPORTED_INFERENCE", "NO_MISSING_SAFEGUARD"] }
      };
    },
    async repairCandidate() { throw new Error("repair must not run"); },
    async produceDiscriminator() { throw new Error("discriminator must not run"); }
  };
  const result = await createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, journalEvidenceProvider }).run({
    caseId: CASE_ID,
    runtimeTurnId: "runtime:journal:frozen",
    exchangeId: "exchange:journal:frozen",
    userTurnId: "turn:journal:frozen:user",
    assistantTurnId: "turn:journal:frozen:assistant",
    userMessage: "Use relevant history without replacing the current episode.",
    userInput: {}
  });
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(freezes, 1);
  assert.deepEqual(seen.map(({ role }) => role), ["producer", "auditor"]);
  assert.deepEqual(seen[0].journalEvidence, seen[1].journalEvidence);
  const record = await store.load(CASE_ID);
  assert.equal(record.case_state.current_episode.id, "episode:journal:runtime");
  assert.equal(record.candidate_responses[0].metadata.journal_evidence_sha256, seen[0].journalEvidence.sha256);
});

test("a restart after the candidate call completed reuses its journal packet instead of freezing a new one", async (t) => {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-restart-"));
  t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  const store = createEncryptedPrivateCaseStore({
    rootDir: privateRoot,
    routineKek: Buffer.alloc(32, 83),
    recoverySecretBytes: Buffer.alloc(32, 84),
    osBackedReauthenticated: true,
    now: () => "2026-09-22T18:00:00.000Z"
  });
  t.after(() => store.close());
  let freezes = 0;
  let produced = 0;
  const audited = [];
  const packetFor = (index) => ({ schema_version: 1, generation: `generation-${index}`, evidence_groups: [], more_available: false });
  const journalEvidenceProvider = {
    // Any later freeze sees a newer snapshot.
    async freezeForTurn() { freezes += 1; return { packet: packetFor(freezes) }; }
  };
  const modelRuntime = {
    async produceCandidate({ caseId, runtimeTurn, attemptContextId }) {
      produced += 1;
      return {
        exactText: "Synthetic journal-informed candidate.",
        contextId: `context:journal:restart:producer:${produced}`,
        caseState: applyCaseStatePatch(createEmptyCaseState({ caseId }), {
          current_episode: {
            id: "episode:journal:restart",
            target: "Keep the current target authoritative.",
            route: "SYNTHETIC.JOURNAL",
            prediction: "Journal evidence remains supplemental.",
            next_question: "What is current now?",
            started_turn_id: runtimeTurn.user_turn_id,
            constitutional_aim_ids: ["CARE"],
            adverse_signs: ["archive replaces present state"],
            stay_conditions: ["current episode remains explicit"],
            switch_conditions: ["evidence is insufficient"],
            stop_conditions: ["decline"],
            source_item_ids: []
          }
        }),
        stateDiff: { schema_version: 1, additions: [], current_episode_changed: true },
        result: { producerAttemptContextId: attemptContextId }
      };
    },
    async auditCandidate({ journalEvidence }) {
      audited.push(journalEvidence?.packet?.generation ?? null);
      return { contextId: "context:journal:restart:auditor", value: { findings: [], repair_induced_checks: [] } };
    },
    async repairCandidate() { throw new Error("repair must not run"); },
    async produceDiscriminator() { throw new Error("discriminator must not run"); }
  };
  // The first run stops after the candidate call completed but before the candidate was saved.
  let stopBeforeSave = true;
  const source = Object.fromEntries(Object.keys(store).map((key) => [key, typeof store[key] === "function" ? store[key].bind(store) : store[key]]));
  const save = source.commitPrivateRuntimeCandidate;
  source.commitPrivateRuntimeCandidate = async (...args) => {
    if (stopBeforeSave) { stopBeforeSave = false; throw new Error("synthetic stop before the candidate was saved"); }
    return save(...args);
  };
  const controller = createPrivateTherapyTurnController({ privateCaseSource: source, modelRuntime, journalEvidenceProvider });
  const turn = {
    caseId: CASE_ID,
    runtimeTurnId: "runtime:journal:restart",
    exchangeId: "exchange:journal:restart",
    userTurnId: "turn:journal:restart:user",
    assistantTurnId: "turn:journal:restart:assistant",
    userMessage: "Use relevant history without replacing the current episode.",
    userInput: {}
  };
  await assert.rejects(controller.run(turn));
  const result = await controller.run(turn);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(freezes, 1);
  assert.equal(produced, 1);
  assert.deepEqual(audited, ["generation-1"]);
  const record = await store.load(CASE_ID);
  assert.equal(record.candidate_responses[0].metadata.journal_evidence_sha256,
    createHash("sha256").update(JSON.stringify(packetFor(1))).digest("hex"));
});
