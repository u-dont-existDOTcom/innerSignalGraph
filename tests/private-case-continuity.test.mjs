import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { assessContinuationSafety, CaseNotContinuationSafeError, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createPrivateCaseHandoff, openPrivateHandoffArtifact, validatePrivateCaseHandoff } from "../src/storage/private-case-handoff.mjs";
import { deserializeVaultEnvelope } from "../src/storage/private-case-store.mjs";
import { decryptVaultEnvelopeWithRecoverySecret } from "../src/storage/vault-crypto.mjs";
import { chunkExactSourceText, reconstructExactSourceChunks } from "../src/storage/exact-source-artifact.mjs";
import { validateTrackerEntry } from "../src/case-state/tracker.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests/fixtures/private-case-session.mjs");
const mcpCli = path.join(root, "src/cli/private-case-mcp.mjs");
const CASE_ID = "synthetic-case-continuity";
const CANDIDATE_ID = "candidate:pending:001";
const SOURCE_ARTIFACT_ID = "source:human-approved:001";
const HANDOFF_ID = "handoff:00000000-0000-4000-8000-000000000001";
const TOKEN = "synthetic-authorized-session-token";
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
let sessionSequence = 0;

function turn(exchange, role, text, episode = null, day = 1) {
  return { id: `${exchange}-${role}`, exchange_id: exchange, role, text, at: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`, episode_id: episode };
}

function syntheticState() {
  return applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    trajectory_observability: {
      overall: "mixed",
      note: "Synthetic global appraisal conflicts with functional observations.",
      domains: {
        mood: { observability: "mixed", intensity: "variable", function: "partly reduced", duration: "unclear", timing: "short-term", delayed_effects: "not yet observed", external_observation: "synthetic observer reports mixed function", note: "Do not infer a clean trend." }
      }
    },
    items: [
      {
        id: "evidence:older:critical",
        domain: "long_term_target",
        statement: "Synthetic older evidence remains decision relevant.",
        status: "direct_report",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user", recorded_at: "2026-09-01T12:00:00.000Z" },
        still_current: true,
        supersedes: [],
        decision_relevance: "high"
      },
      {
        id: "evidence:older:conflict",
        domain: "long_term_target",
        statement: "Synthetic later evidence conflicts with the older target.",
        status: "direct_report",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E2-user", turn_id: "E2-user", recorded_at: "2026-09-02T12:00:00.000Z" },
        still_current: true,
        supersedes: [],
        decision_relevance: "high"
      },
      {
        id: "hypothesis:synthetic-mechanism",
        domain: "mechanism",
        statement: "A synthetic mechanism remains only a hypothesis.",
        status: "hypothesis",
        confidence: "low",
        source: { kind: "synthetic_turn", ref: "E2-user", turn_id: "E2-user", recorded_at: "2026-09-02T12:00:00.000Z" },
        still_current: null,
        supersedes: [],
        decision_relevance: "medium"
      },
      {
        id: "state:global-better-superseded",
        domain: "trajectory",
        statement: "A vivid global better claim was later corrected by mixed functional evidence.",
        status: "direct_report",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user", recorded_at: "2026-09-01T12:00:00.000Z" },
        still_current: false,
        supersedes: [],
        decision_relevance: "high"
      },
      {
        id: "state:function-mixed-current",
        domain: "trajectory",
        statement: "Function remains mixed despite the latest vivid appraisal.",
        status: "unresolved_conflict",
        confidence: "medium",
        source: { kind: "synthetic_turn", ref: "E2-user", turn_id: "E2-user", recorded_at: "2026-09-02T12:00:00.000Z" },
        still_current: true,
        supersedes: ["state:global-better-superseded"],
        decision_relevance: "high"
      },
      {
        id: "state:consent-contract",
        domain: "consent",
        statement: "The synthetic client consented to the current bounded method and may decline it.",
        status: "direct_report",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E2-user", turn_id: "E2-user", recorded_at: "2026-09-02T12:00:00.000Z" },
        still_current: true,
        supersedes: [],
        decision_relevance: "high"
      },
      {
        id: "state:vivid-latest-distraction",
        domain: "latest_turn",
        statement: "A vivid synthetic latest-turn distraction must not replace the active target.",
        status: "direct_report",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E5-user", turn_id: "E5-user", recorded_at: "2026-09-05T12:00:00.000Z" },
        still_current: true,
        supersedes: [],
        decision_relevance: "medium"
      }
    ],
    contradiction_clusters: [
      {
        id: "conflict:target",
        item_ids: ["evidence:older:critical", "evidence:older:conflict"],
        question: "Which synthetic target remains current?",
        status: "open",
        decision_relevance: "high"
      },
      {
        id: "conflict:global-versus-function",
        item_ids: ["state:global-better-superseded", "state:function-mixed-current"],
        question: "Does the global appraisal match durable functional change?",
        status: "open",
        decision_relevance: "high"
      }
    ],
    answered_questions: [{ id: "answered:preferred-method", question: "Was the bounded developmental method acceptable?", answer: "Yes, with continuing consent and a right to decline.", source_item_ids: ["state:consent-contract"], still_current: true }],
    intervention_history: [
      {
        id: "path:failed-probe",
        domain: "intervention_adverse",
        statement: "A synthetic probe failed and must not be retried blindly.",
        status: "observed_pattern",
        confidence: "high",
        source: { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user", recorded_at: "2026-09-01T12:00:00.000Z" },
        still_current: false,
        supersedes: [],
        decision_relevance: "high"
      }
    ],
    current_episode: {
      id: "episode:active",
      target: "Continue the synthetic developmental episode.",
      route: "IC.PROTECTOR_ACTION",
      prediction: "A bounded protective action increases choice.",
      next_question: "What changed?",
      started_turn_id: "E2-user",
      constitutional_aim_ids: ["CARE", "PROTECTION"],
      adverse_signs: ["less choice"],
      stay_conditions: ["more choice"],
      switch_conditions: ["no useful movement"],
      stop_conditions: ["decline"],
      source_item_ids: ["evidence:older:conflict"]
    }
  });
}

async function makeEnvironment(t, { marker = `PRIVATE-${randomBytes(12).toString("hex")}`, wrongKey = false, largeHistory = false } = {}) {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-continuity-"));
  const credentialsPath = path.join(privateRoot, "bridge-credentials.json");
  const payloadPath = path.join(privateRoot, "seed-payload.json");
  const routine = wrongKey ? Buffer.alloc(32, 77) : Buffer.alloc(32, 17);
  const recovery = wrongKey ? Buffer.alloc(32, 78) : Buffer.alloc(32, 23);
  const vaultRoot = path.join(privateRoot, "vaults");
  const credentials = {
    schema_version: 1,
    root_dir: vaultRoot,
    grants: [{
      token_sha256: sha256Hex(TOKEN),
      principal_id: "synthetic-supervisor",
      case_ids: [CASE_ID],
      scopes: ["case:read", "case:write", "case:audit"]
    }],
    case_keys: {
      [CASE_ID]: {
        routine_kek_base64: routine.toString("base64"),
        recovery_secret_base64: recovery.toString("base64")
      }
    }
  };
  const archivedHistory = largeHistory
    ? Array.from({ length: 28 }, (_, index) => [
        turn(`ARCHIVE-${index}`, "user", `${marker} archived Unicode evidence ${index} — ${"longitudinal synthetic history ".repeat(150)}`, null, 1),
        turn(`ARCHIVE-${index}`, "assistant", `Synthetic archived response ${index}.`, null, 1)
      ]).flat()
    : [];
  const transcript = [
    ...archivedHistory,
    turn("E1", "user", `${marker} older critical raw evidence`, null, 1),
    turn("E1", "assistant", "Synthetic older response.", null, 1),
    turn("E2", "user", "Synthetic episode starts exactly here.", "episode:active", 2),
    turn("E2", "assistant", "Synthetic episode response two.", "episode:active", 2),
    turn("E3", "user", "Synthetic episode user three.", "episode:active", 3),
    turn("E3", "assistant", "Synthetic episode response three.", "episode:active", 3),
    turn("E4", "user", "Synthetic episode user four.", "episode:active", 4),
    turn("E4", "assistant", "Synthetic episode response four.", "episode:active", 4),
    turn("E5", "user", "Synthetic episode latest user.", "episode:active", 5),
    turn("E5", "assistant", "Synthetic episode latest response.", "episode:active", 5)
  ];
  if (largeHistory) assert.ok(transcript.reduce((total, entry) => total + entry.text.length, 0) > 100_000);
  const exactSourceText = [
    `${marker}\r\nsynthetic private source opening — exact Unicode “text”`,
    ...Array.from({ length: 950 }, (_, index) => `source-line-${String(index).padStart(4, "0")}: ${"bounded synthetic evidence ".repeat(2)}${index % 2 ? "\r\n" : "\n"}`),
    "synthetic private source closing\r\n"
  ].join("");
  assert.ok(Buffer.byteLength(exactSourceText, "utf8") > 20_000);
  const payload = {
    case_state: syntheticState(),
    state_diff: { schema_version: 1, additions: ["evidence:older:conflict"], current_episode_changed: true },
    state_diff_turn_id: "E5-user",
    state_diff_id: "diff:E5",
    transcript_turns: transcript,
    candidate_id: CANDIDATE_ID,
    candidate_text: `${marker}\r\nexact pending candidate bytes — preserved “verbatim”`,
    candidate_metadata: { status: "pending_audit", based_on_turn_id: "E5-user" },
    candidate_responses: [
      { id: "candidate:superseded:000", exact_text: `${marker} exact superseded candidate`, metadata: { status: "pending_audit", based_on_turn_id: "E4-user" } },
      { id: CANDIDATE_ID, exact_text: `${marker}\r\nexact pending candidate bytes — preserved “verbatim”`, metadata: { status: "pending_audit", based_on_turn_id: "E5-user" } }
    ],
    tracker_entries: [{
      schema_version: 1,
      id: "tracker:synthetic:001",
      observed_at: "2026-09-04T08:00:00.000Z",
      sleep_duration_hours: 6.5,
      sleep_quality: 5,
      pain_intensity: 4,
      anxiety: 6,
      stability: 5,
      unreality: 3,
      social_contact_quality: 4,
      rejection_impact: 7,
      interventions: ["synthetic bounded practice"],
      activities: ["synthetic meaningful activity"],
      functioning: 5
    }],
    journal_entries: [{ id: "journal:synthetic:001", observed_at: "2026-09-03T09:00:00.000Z", kind: "journal", text: `${marker} exact older journal evidence` }],
    source_artifacts: [{
      id: SOURCE_ARTIFACT_ID,
      chunks: chunkExactSourceText(exactSourceText, { maximumChunkBytes: 997 }),
      metadata: { authority: "synthetic-human-approved", scope: "test-only" }
    }],
    exact_source_text: exactSourceText
  };
  await fs.writeFile(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  await fs.chmod(credentialsPath, 0o600);
  await fs.writeFile(payloadPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  await fs.chmod(payloadPath, 0o600);
  t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  return { privateRoot, credentialsPath, payloadPath, vaultRoot, marker, payload, credentials };
}

async function runSession(action, environment, { token = TOKEN, candidateId = CANDIDATE_ID, handoffId = null, primaryId = CASE_ID, fourthArg = environment.payloadPath } = {}) {
  sessionSequence += 1;
  const outputPath = path.join(environment.privateRoot, `session-output-${sessionSequence}.json`);
  const result = await execFileAsync(process.execPath, [fixture, action, environment.credentialsPath, primaryId, fourthArg, outputPath], {
    cwd: root,
    env: {
      ...process.env,
      INNER_SIGNAL_PRIVATE_CASE_TEST_TOKEN: token,
      INNER_SIGNAL_PRIVATE_CASE_CANDIDATE_ID: candidateId,
      ...(handoffId ? { INNER_SIGNAL_PRIVATE_HANDOFF_ID: handoffId } : {}),
      INNER_SIGNAL_PRIVATE_CASE_EXPECTED_PATH: environment.payloadPath
    },
    maxBuffer: 4_000_000
  });
  return { ...result, stdout: await fs.readFile(outputPath, "utf8") };
}

async function runFreshHandoffSession(environment, handoffId, { token = TOKEN } = {}) {
  sessionSequence += 1;
  const outputPath = path.join(environment.privateRoot, `fresh-handoff-output-${sessionSequence}.json`);
  const childEnv = { ...process.env, INNER_SIGNAL_PRIVATE_CASE_TEST_TOKEN: token };
  delete childEnv.INNER_SIGNAL_PRIVATE_CASE_CANDIDATE_ID;
  delete childEnv.INNER_SIGNAL_PRIVATE_CASE_EXPECTED_PATH;
  delete childEnv.INNER_SIGNAL_PRIVATE_HANDOFF_ID;
  const result = await execFileAsync(process.execPath, [fixture, "handoff-load", environment.credentialsPath, handoffId, "", outputPath], {
    cwd: root,
    env: childEnv,
    maxBuffer: 16_000_000
  });
  return { ...result, stdout: await fs.readFile(outputPath, "utf8") };
}

test("fresh authorized session reconstructs every continuation artifact exactly after process exit", async (t) => {
  const environment = await makeEnvironment(t);
  const seeded = await runSession("seed", environment);
  assert.ok(seeded.stdout, `fresh seed emitted no result; stderr=${seeded.stderr}`);
  const loaded = await runSession("load", environment);
  assert.ok(loaded.stdout, `fresh load emitted no result; stderr=${loaded.stderr}`);
  const context = JSON.parse(loaded.stdout);
  assert.equal(context.continuation_safety.continuation_safe, true);
  assert.equal(context.case_state.case_id, CASE_ID);
  assert.equal(context.last_state_diff.id, "diff:E5");
  assert.equal(context.current_episode.id, "episode:active");
  assert.equal(context.constitution_ref.version, context.case_state.constitution_ref.version);
  assert.equal(context.candidate_response.id, CANDIDATE_ID);
  assert.equal(context.candidate_response.exact_text, environment.payload.candidate_text);
  assert.deepEqual(context.source_artifact_refs.map((entry) => entry.id), [SOURCE_ARTIFACT_ID]);
  assert.deepEqual(context.recent_verbatim.turns, environment.payload.transcript_turns.slice(2));
  assert.equal(context.targeted_older_evidence.find((entry) => entry.turn_id === "E1-user")?.turn?.text, environment.payload.transcript_turns[0].text);
  const source = JSON.parse((await runSession("source", environment, { fourthArg: SOURCE_ARTIFACT_ID })).stdout);
  assert.equal(source.exact_text, environment.payload.exact_source_text);
  assert.equal(source.utf8_bytes, Buffer.byteLength(environment.payload.exact_source_text, "utf8"));
  assert.equal(source.chunks[0].start_byte, 0);
  assert.equal(source.chunks.at(-1).end_byte, source.utf8_bytes);
  const providers = await loadDevelopmentPrivateCaseProviders(environment.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const byStableSource = await service.retrieveCaseEvidence(CASE_ID, { provenanceIds: [SOURCE_ARTIFACT_ID] }, { bearerToken: TOKEN });
  assert.equal(byStableSource.source_artifacts[0].exact_text, environment.payload.exact_source_text);
});

test("lossless chunk reconstruction detects omissions, duplication, and tampering", () => {
  const exact = `header\r\n${"∆ exact boundary text\n".repeat(2_000)}tail`;
  const chunks = chunkExactSourceText(exact, { maximumChunkBytes: 211 });
  assert.deepEqual(chunks, chunkExactSourceText(exact, { maximumChunkBytes: 211 }));
  const reconstructed = reconstructExactSourceChunks(chunks);
  assert.equal(reconstructed.exact_text, exact);
  assert.equal(reconstructed.utf8_bytes, Buffer.byteLength(exact, "utf8"));
  assert.throws(() => reconstructExactSourceChunks(chunks.filter((_, index) => index !== 3)), /index is not contiguous|gap, overlap/);
  assert.throws(() => reconstructExactSourceChunks([...chunks.slice(0, 3), chunks[2], ...chunks.slice(3)]), /index is not contiguous|gap, overlap/);
  const tampered = structuredClone(chunks);
  tampered[2].exact_text += "changed";
  assert.throws(() => reconstructExactSourceChunks(tampered), /gap, overlap|integrity check/);
});

test("Universal Handoff Binding recovers a >100k case in Session B using only handoff_id", async (t) => {
  const environment = await makeEnvironment(t, { largeHistory: true });
  await runSession("seed", environment);
  const created = JSON.parse((await runSession("handoff-create", environment, { handoffId: HANDOFF_ID })).stdout);
  assert.equal(created.handoff_id, HANDOFF_ID);
  assert.equal(created.case_id, CASE_ID);
  assert.deepEqual(created.candidate_ids, [CANDIDATE_ID]);
  assert.equal(created.handoff_status, "READY_FOR_FRESH_SESSION_TEST");
  assert.equal(created.local_round_trip_verified, true);
  assert.equal(created.fresh_session_status, "PENDING_FRESH_SESSION");

  const fresh = JSON.parse((await runFreshHandoffSession(environment, HANDOFF_ID)).stdout);
  assert.equal(fresh.fresh_session_status, "FRESH_SESSION_GREEN");
  assert.deepEqual(fresh.decision_projection, created.session_a_decision_projection);
  assert.equal(fresh.packet.handoff_id, HANDOFF_ID);
  assert.equal(fresh.packet.case_id, CASE_ID);
  assert.equal(fresh.packet.encrypted_round_trip_verified, true);
  assert.equal(fresh.packet.versions.constitution, environment.payload.case_state.constitution_ref.version);
  assert.equal(fresh.packet.versions.runtime, "synthetic-runtime-v1");
  assert.equal(fresh.packet.versions.audit, "synthetic-audit-v1");
  assert.ok(fresh.packet.transcript_archive.reduce((total, entry) => total + entry.text.length, 0) > 100_000);
  assert.ok(fresh.packet.artifact_manifest.chunks.length > 5);
  assert.ok(fresh.packet.artifact_manifest.chunks.every((chunk) => chunk.utf8_bytes <= 20_000));
  assert.equal(fresh.packet.artifact_manifest.chunks.at(-1).end_byte, fresh.packet.artifact_manifest.utf8_bytes);
  const transcriptComponent = fresh.packet.manifest.components.find((entry) => entry.name === "transcript_archive");
  assert.ok(transcriptComponent.chunks.length > 5);
  assert.ok(transcriptComponent.chunks.every((chunk) => Buffer.byteLength(chunk.exact_text, "utf8") <= 20_000));
  assert.deepEqual(JSON.parse(reconstructExactSourceChunks(transcriptComponent.chunks).exact_text), fresh.packet.transcript_archive);
  assert.equal(fresh.packet.pending_artifacts[0].exact_text, environment.payload.candidate_text);
  assert.equal(Buffer.from(fresh.packet.pending_artifacts[0].exact_text, "utf8").equals(Buffer.from(environment.payload.candidate_text, "utf8")), true);
  const recentStart = environment.payload.transcript_turns.findIndex((entry) => entry.id === "E2-user");
  assert.deepEqual(fresh.packet.recent_verbatim.turns, environment.payload.transcript_turns.slice(recentStart));
  assert.equal(fresh.packet.transcript_archive.find((entry) => entry.id === "E1-user").text, environment.payload.transcript_turns.find((entry) => entry.id === "E1-user").text);
  assert.deepEqual(fresh.packet.tracker_entries, environment.payload.tracker_entries.map(validateTrackerEntry));
  assert.deepEqual(fresh.packet.journal_entries, environment.payload.journal_entries);
  assert.deepEqual(fresh.packet.canonical_state.contradiction_clusters, environment.payload.case_state.contradiction_clusters);
  assert.deepEqual(fresh.packet.canonical_state.trajectory_observability, environment.payload.case_state.trajectory_observability);
  assert.deepEqual(fresh.packet.canonical_state.answered_questions, environment.payload.case_state.answered_questions);
  assert.equal(fresh.packet.canonical_state.items.find((entry) => entry.id === "hypothesis:synthetic-mechanism").status, "hypothesis");
  assert.equal(fresh.packet.canonical_state.items.find((entry) => entry.id === "state:global-better-superseded").still_current, false);
  assert.equal(fresh.decision_projection.current_target, environment.payload.case_state.current_episode.target);
  assert.equal(fresh.decision_projection.current_path, "IC.PROTECTOR_ACTION");
  assert.deepEqual(fresh.decision_projection.failed_or_superseded_path_ids, ["path:failed-probe"]);
  assert.deepEqual(fresh.decision_projection.settled_answer_ids, ["answered:preferred-method"]);
  assert.ok(fresh.decision_projection.open_contradiction_ids.includes("conflict:global-versus-function"));

  const candidateById = JSON.parse((await runSession("candidate-by-id", environment, { primaryId: CANDIDATE_ID })).stdout);
  assert.equal(candidateById.exact_text, environment.payload.candidate_text);

  const providers = await loadDevelopmentPrivateCaseProviders(environment.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const auth = { bearerToken: TOKEN };
  const tracker = await service.getTrackerWindowByReference({ handoffId: HANDOFF_ID, variables: ["sleep_quality", "functioning"] }, auth);
  assert.deepEqual(tracker.entries, [{ id: "tracker:synthetic:001", observed_at: "2026-09-04T08:00:00.000Z", sleep_quality: 5, functioning: 5 }]);
  assert.equal(tracker.interpretation, "descriptive_only_no_causal_inference");
  const journal = await service.getJournalEntriesByReference({ handoffId: HANDOFF_ID, query: "older journal" }, auth);
  assert.equal(journal.entries[0].text, environment.payload.journal_entries[0].text);
  assert.equal(journal.promoted_to_case_fact, false);
  const encryptedExport = await service.exportHandoff(HANDOFF_ID, auth);
  assert.equal(encryptedExport.includes(Buffer.from(environment.marker)), false);
  const recovered = await decryptVaultEnvelopeWithRecoverySecret({
    envelope: deserializeVaultEnvelope(JSON.parse(encryptedExport.toString("utf8"))),
    recoverySecretBytes: Buffer.from(environment.credentials.case_keys[CASE_ID].recovery_secret_base64, "base64")
  });
  try {
    const artifact = JSON.parse(recovered.toString("utf8"));
    assert.equal(openPrivateHandoffArtifact(artifact).pending_artifacts[0].exact_text, environment.payload.candidate_text);
  } finally { recovered.fill(0); }

  await assert.rejects(() => runFreshHandoffSession(environment, HANDOFF_ID, { token: "wrong-token" }), (error) => {
    assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
    assert.match(error.stderr, /Private case access was denied/);
    return true;
  });
  const wrongCredentials = structuredClone(environment.credentials);
  wrongCredentials.case_keys[CASE_ID].routine_kek_base64 = Buffer.alloc(32, 99).toString("base64");
  await fs.writeFile(environment.credentialsPath, `${JSON.stringify(wrongCredentials)}\n`, { mode: 0o600 });
  await assert.rejects(() => runFreshHandoffSession(environment, HANDOFF_ID), (error) => {
    assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
    assert.match(error.stderr, /Vault envelope is unreadable|Private case tool failed|unavailable/i);
    return true;
  });
});

test("unauthorized or wrong-scope fresh session reveals no private content and does not create a case", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const developmentProviders = await loadDevelopmentPrivateCaseProviders(environment.credentialsPath);
  const serviceWithoutDevelopmentOptIn = createPrivateCaseAccessService({
    rootDir: developmentProviders.rootDir,
    authorizationProvider: developmentProviders.authorizationProvider,
    keyProvider: developmentProviders.keyProvider
  });
  await assert.rejects(
    () => serviceWithoutDevelopmentOptIn.getCaseState(CASE_ID, { bearerToken: TOKEN }),
    /accepted access assurance/
  );
  developmentProviders.close();
  await assert.rejects(
    () => runSession("load", environment, { token: "wrong-token" }),
    (error) => {
      assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
      assert.match(error.stderr, /Private case access was denied/);
      return true;
    }
  );
  const wrongScope = structuredClone(environment.credentials);
  wrongScope.grants[0].scopes = ["case:read", "case:write"];
  await fs.writeFile(environment.credentialsPath, `${JSON.stringify(wrongScope)}\n`, { mode: 0o600 });
  await assert.rejects(
    () => runSession("load", environment),
    (error) => {
      assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
      assert.match(error.stderr, /Private case access was denied/);
      return true;
    }
  );
  const files = await fs.readdir(environment.vaultRoot);
  assert.deepEqual(files.sort(), [".artifact-locators", `${CASE_ID}.vault.json`]);
});

test("ciphertext round trip survives restart and wrong or missing key fails without fallback", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const vaultPath = path.join(environment.vaultRoot, `${CASE_ID}.vault.json`);
  const encryptedBytes = await fs.readFile(vaultPath, "utf8");
  assert.doesNotMatch(encryptedBytes, new RegExp(environment.marker));
  assert.equal((await fs.stat(vaultPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(environment.vaultRoot)).mode & 0o777, 0o700);

  const wrongCredentials = structuredClone(environment.credentials);
  wrongCredentials.case_keys[CASE_ID].routine_kek_base64 = Buffer.alloc(32, 99).toString("base64");
  await fs.writeFile(environment.credentialsPath, `${JSON.stringify(wrongCredentials)}\n`, { mode: 0o600 });
  await assert.rejects(() => runSession("load", environment), (error) => {
    assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
    assert.match(error.stderr, /Vault envelope is unreadable|Private case tool failed|unavailable/i);
    return true;
  });
  const missingCredentials = structuredClone(environment.credentials);
  missingCredentials.case_keys = {};
  await fs.writeFile(environment.credentialsPath, `${JSON.stringify(missingCredentials)}\n`, { mode: 0o600 });
  await assert.rejects(() => runSession("load", environment), (error) => {
    assert.doesNotMatch(`${error.stdout}\n${error.stderr}`, new RegExp(environment.marker));
    assert.match(error.stderr, /Private case key material is unavailable/);
    return true;
  });
});

test("fresh candidate audit resolves exact candidate bytes by stable identifier", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const audited = await runSession("audit", environment);
  assert.ok(audited.stdout, `fresh audit emitted no result; stderr=${audited.stderr}`);
  const audit = JSON.parse(audited.stdout);
  assert.equal(audit.candidate_id, CANDIDATE_ID);
  assert.equal(audit.exact_candidate_resolved, true);
  assert.equal(audit.audit_result.audited_exact_text, environment.payload.candidate_text);
  assert.deepEqual(audit.audit_result.recent_turn_ids, environment.payload.transcript_turns.slice(2).map((entry) => entry.id));
});

test("recent verbatim extends past the minimum to the complete active episode and older evidence is queryable", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const providers = await loadDevelopmentPrivateCaseProviders(environment.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const auth = { bearerToken: TOKEN };
  const recent = await service.getRecentVerbatim(CASE_ID, { requireCompleteEpisode: true }, auth);
  assert.deepEqual(recent.turns, environment.payload.transcript_turns.slice(2));
  assert.equal(recent.complete_episode_required, true);
  assert.equal(recent.truncated_for_bound, false);
  const byProvenance = await service.retrieveCaseEvidence(CASE_ID, { provenanceIds: ["evidence:older:critical"] }, auth);
  assert.equal(byProvenance.turns[0].text, environment.payload.transcript_turns[0].text);
  const byQuery = await service.retrieveCaseEvidence(CASE_ID, { query: "older evidence remains decision relevant" }, auth);
  assert.equal(byQuery.turns[0].id, "E1-user");
  const byTime = await service.retrieveCaseEvidence(CASE_ID, { timeRange: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T23:59:59.999Z" } }, auth);
  assert.deepEqual(byTime.turns.map((entry) => entry.id), ["E1-user", "E1-assistant"]);
});

test("candidate artifacts are immutable and a newer pending candidate atomically supersedes the prior pending version", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const providers = await loadDevelopmentPrivateCaseProviders(environment.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const auth = { bearerToken: TOKEN };
  const vaultPath = path.join(environment.vaultRoot, `${CASE_ID}.vault.json`);
  const envelopeBefore = JSON.parse(await fs.readFile(vaultPath, "utf8"));
  await assert.rejects(() => service.saveCandidateResponse(CASE_ID, CANDIDATE_ID, "replacement", {}, auth), /exact bytes are immutable/);
  await service.saveCandidateResponse(CASE_ID, "candidate:pending:002", "second exact response", { status: "pending_audit" }, auth);
  const envelopeAfter = JSON.parse(await fs.readFile(vaultPath, "utf8"));
  assert.deepEqual(envelopeAfter.keyWraps, envelopeBefore.keyWraps);
  assert.notDeepEqual(envelopeAfter.payload, envelopeBefore.payload);
  const recoveryPlaintext = await decryptVaultEnvelopeWithRecoverySecret({
    envelope: deserializeVaultEnvelope(envelopeAfter),
    recoverySecretBytes: Buffer.from(environment.credentials.case_keys[CASE_ID].recovery_secret_base64, "base64")
  });
  try {
    const recovered = JSON.parse(recoveryPlaintext.toString("utf8"));
    assert.equal(recovered.candidate_responses.at(-1).exact_text, "second exact response");
  } finally {
    recoveryPlaintext.fill(0);
  }
  assert.equal((await service.getCandidateResponse(CASE_ID, "current_pending", auth)).id, "candidate:pending:002");
  assert.equal((await service.getCandidateResponse(CASE_ID, CANDIDATE_ID, auth)).status, "superseded");
});

test("continuation acceptance fails with the required high-level message when an artifact is missing", () => {
  const result = assessContinuationSafety({
    case_state: createEmptyCaseState({ caseId: CASE_ID }),
    last_state_diff: null,
    current_episode: null,
    constitution_ref: { version: "inner-signal-constitution-v1" },
    candidate_response: null,
    recent_verbatim: { turns: [] }
  });
  assert.equal(result.continuation_safe, false);
  assert.ok(result.failures.includes("last state diff is missing"));
  assert.ok(result.failures.includes("exact candidate response is missing"));
  assert.ok(result.failures.includes("targeted older raw evidence has no retrievable private provenance source"));
  const error = new CaseNotContinuationSafeError(result.failures);
  assert.match(error.message, /^Case is not continuation-safe for a fresh session:/);
  assert.equal(error.code, "CASE_NOT_CONTINUATION_SAFE");
});

test("private handoff requires stable identifiers and executable retrieval evidence without embedding payload", () => {
  const handoff = createPrivateCaseHandoff({
    caseId: CASE_ID,
    candidateId: CANDIDATE_ID,
    continuationEvidence: "private-case:acceptance synthetic fresh-process receipt",
    createdAt: "2026-09-09T12:00:00.000Z"
  });
  assert.equal(validatePrivateCaseHandoff(handoff), handoff);
  assert.deepEqual(handoff.retrieval.arguments, { case_id: CASE_ID, candidate_id: CANDIDATE_ID });
  assert.equal(Object.hasOwn(handoff, "exact_text"), false);
  assert.throws(
    () => createPrivateCaseHandoff({ caseId: CASE_ID, candidateId: CANDIDATE_ID }),
    /continuation_evidence is invalid/
  );
});

test("separate read-only MCP process executes load_case_context from a fresh client process", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  await runSession("handoff-create", environment, { handoffId: HANDOFF_ID });
  const readyPath = path.join(environment.privateRoot, "mcp-ready.json");
  const child = spawn(process.execPath, [mcpCli, "--credentials", environment.credentialsPath, "--port", "0", "--ready-file", readyPath], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"]
  });
  t.after(() => child.kill("SIGTERM"));
  let serverStderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { serverStderr += chunk; });
  let readyText = null;
  for (let attempt = 0; attempt < 1_200 && readyText == null; attempt += 1) {
    readyText = await fs.readFile(readyPath, "utf8").catch(() => null);
    if (readyText == null) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(readyText, `private-case MCP did not publish its readiness receipt; stderr=${serverStderr}`);
  const ready = JSON.parse(readyText);
  assert.equal(ready.productionReady, false);
  const listed = await fetch(ready.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  }).then((response) => response.json());
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ["load_handoff", "load_case_context", "get_state_diff", "get_recent_verbatim", "retrieve_case_evidence", "get_pending_candidate", "get_tracker_window", "get_journal_entries", "get_candidate_response", "get_source_artifact"]
  );
  const { stdout } = await runSession("mcp-load", environment, { fourthArg: ready.mcpUrl });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 200);
  assert.equal(result.exactCandidateVerified, true);
  assert.equal(result.exactRecentVerbatimVerified, true);
  assert.equal(result.continuationSafe, true);

  const handoffResult = await fetch(ready.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "load_handoff", arguments: { handoff_id: HANDOFF_ID } } })
  }).then((response) => response.json());
  assert.equal(handoffResult.result.structuredContent.handoff_id, HANDOFF_ID);
  assert.equal(handoffResult.result.structuredContent.pending_artifacts[0].exact_text, environment.payload.candidate_text);

  const candidateResult = await fetch(ready.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_pending_candidate", arguments: { candidate_id: CANDIDATE_ID } } })
  }).then((response) => response.json());
  assert.equal(candidateResult.result.structuredContent.exact_text, environment.payload.candidate_text);

  const sourceResult = await fetch(ready.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_source_artifact", arguments: { case_id: CASE_ID, source_artifact_id: SOURCE_ARTIFACT_ID } } })
  }).then((response) => response.json());
  assert.equal(sourceResult.result.structuredContent.exact_text, environment.payload.exact_source_text);

  const denied = await fetch(ready.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "load_case_context", arguments: { case_id: CASE_ID } } })
  });
  const deniedText = await denied.text();
  assert.equal(denied.status, 401);
  assert.doesNotMatch(deniedText, new RegExp(environment.marker));
});

test("synthetic private payload is not emitted into repository or public fixture paths", async (t) => {
  const environment = await makeEnvironment(t);
  await runSession("seed", environment);
  const trackedFiles = (await execFileAsync("git", ["ls-files"], { cwd: root })).stdout.trim().split("\n").filter(Boolean);
  assert.ok(trackedFiles.length > 100, "public/private leak scan must enumerate the repository rather than pass vacuously");
  for (const relative of trackedFiles) {
    const content = await fs.readFile(path.join(root, relative)).catch(() => null);
    if (content) assert.equal(content.includes(Buffer.from(environment.marker)), false, `private marker leaked to ${relative}`);
  }
  const vaultBytes = await fs.readFile(path.join(environment.vaultRoot, `${CASE_ID}.vault.json`));
  assert.equal(vaultBytes.includes(Buffer.from(environment.marker)), false);
  await assert.rejects(
    () => loadDevelopmentPrivateCaseProviders(path.join(root, "synthetic-private-credentials.json")),
    /credentials must be outside the public repository/
  );
  const credentialLink = path.join(environment.privateRoot, "credential-link.json");
  await fs.symlink(environment.credentialsPath, credentialLink);
  await assert.rejects(() => loadDevelopmentPrivateCaseProviders(credentialLink));
  await fs.chmod(environment.credentialsPath, 0o644);
  await assert.rejects(
    () => loadDevelopmentPrivateCaseProviders(environment.credentialsPath),
    /mode 0600 or stricter/
  );
});
