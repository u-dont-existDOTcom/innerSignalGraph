import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { INNER_SIGNAL_CONSTITUTION, renderInnerSignalConstitution } from "../src/therapy/constitution.mjs";
import { sharedClinicalRules } from "../src/prompts/common.mjs";
import {
  applyCaseStatePatch,
  createEmptyCaseState,
  diffCaseStates,
  mergeRuntimeSnapshotIntoCaseState,
  recordClaimedPriorConsensus,
  validateCaseState
} from "../src/case-state/longitudinal-state.mjs";
import { buildDurableCaseContext, CONTEXT_WINDOW_LIMITS, decisionRelevantProjection, formatVerbatimWindow, selectRecentVerbatimWindow } from "../src/case-state/context-window.mjs";
import { appendTrackerEntry, summarizeTrackerWindow, validateTrackerEntry } from "../src/case-state/tracker.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { validateSyntheticPrivacy } from "../tasks/audit-architecture-eval-20260907/score.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const loadJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));

function turn(exchange, role, text, episode = null) {
  return { id: `${exchange}-${role}`, exchange_id: exchange, role, text, at: `2026-09-0${exchange.slice(-1)}T12:00:00.000Z`, episode_id: episode };
}

test("global constitution is immutable and injected into every shared therapy prompt", () => {
  assert.equal(Object.isFrozen(INNER_SIGNAL_CONSTITUTION), true);
  assert.equal(Object.isFrozen(INNER_SIGNAL_CONSTITUTION.fixedEnds), true);
  assert.equal(INNER_SIGNAL_CONSTITUTION.fixedEnds.length, 7);
  assert.match(renderInnerSignalConstitution(), /Strong strategic persistence with high tactical flexibility/);
  assert.match(sharedClinicalRules, /INNER SIGNAL CONSTITUTION \(inner-signal-constitution-v1\)/);
  assert.match(sharedClinicalRules, /Literal inner-child ontology is optional/);
  assert.match(sharedClinicalRules, /Concrete homicidal intent or plan/);
});

test("public synthetic gold state validates and exposes evidence without transcript or hidden reasoning", async () => {
  const state = validateCaseState(await loadJson("tasks/constitution-context-audit-20260908/synthetic-case-state.json"));
  assert.equal(validateSyntheticPrivacy(state), true);
  assert.equal(state.trajectory_observability.overall, "poor");
  assert.ok(state.items.length >= 40);
  assert.ok(state.contradiction_clusters.length >= 11);
  const contradictionText = state.contradiction_clusters.map((item) => item.question).join("\n");
  for (const pattern of [/anxiety/i, /sleep/i, /THC/i, /reciprocal connection/i, /alternative helper/i, /food/i, /false-self/i]) assert.match(contradictionText, pattern);
  assert.equal(state.constitution_ref.version, "inner-signal-constitution-v1");
});

test("recent context preserves at least three exact exchanges and extends through the current episode", async () => {
  const state = await loadJson("tasks/constitution-context-audit-20260908/synthetic-case-state.json");
  state.items.find((item) => item.id === "CS-001").source = { kind: "synthetic_turn", ref: "E1-user", turn_id: "E1-user" };
  const transcript = [
    turn("E1", "user", "old goal"), turn("E1", "assistant", "old answer"),
    turn("E2", "user", "episode starts", "EP-001"), turn("E2", "assistant", "first episode answer", "EP-001"),
    turn("E3", "user", "third user", "EP-001"), turn("E3", "assistant", "third answer", "EP-001"),
    turn("E4", "user", "fourth user", "EP-001"), turn("E4", "assistant", "fourth answer", "EP-001"),
    turn("E5", "user", "latest user", "EP-001"), turn("E5", "assistant", "latest answer", "EP-001")
  ];
  const selected = selectRecentVerbatimWindow(transcript, { currentEpisodeId: "EP-001" });
  assert.equal(selected.turns[0].id, "E2-user");
  assert.equal(selected.extended_for_current_episode, true);
  assert.match(formatVerbatimWindow(selected), /^USER: episode starts/);
  const context = buildDurableCaseContext({ caseId: state.case_id, caseState: state, transcriptEntries: transcript, currentUserMessage: "now" });
  assert.equal(context.lossy_summary_is_authority, false);
  assert.equal(decisionRelevantProjection(context).current_episode.id, "EP-001");
  assert.ok(context.targeted_retrieval_requests.some((item) => item.turn_id === "E1-user"));
  assert.equal(context.targeted_older_evidence.find((item) => item.turn_id === "E1-user")?.turn?.text, "old goal");
});

test("verbatim and tracker context remain explicitly bounded while private history remains intact", () => {
  const transcript = [];
  for (let index = 1; index <= 70; index += 1) {
    transcript.push(turn(`E${index}`, "user", `user ${index}`, "EP-LONG"), turn(`E${index}`, "assistant", `assistant ${index}`, "EP-LONG"));
  }
  const selected = selectRecentVerbatimWindow(transcript, { currentEpisodeId: "EP-LONG" });
  assert.equal(transcript.length, 140);
  assert.equal(selected.turns.length, CONTEXT_WINDOW_LIMITS.selected_turns);
  assert.equal(selected.truncated_for_bound, true);
  assert.equal(selected.omitted_turn_count, 20);

  const tracker = Array.from({ length: 181 }, (_, index) => validateTrackerEntry({
    schema_version: 1,
    id: `track-${index}`,
    observed_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    pain_intensity: index % 11
  }));
  const summary = summarizeTrackerWindow(tracker);
  assert.equal(summary.entry_count, 180);
  assert.equal(summary.eligible_entry_count, 181);
  assert.equal(summary.omitted_entry_count, 1);
});

test("compacted context preserves the same steering-critical decision projection as the full synthetic history", async () => {
  const state = validateCaseState(await loadJson("tasks/constitution-context-audit-20260908/synthetic-case-state.json"));
  const fullHistory = [];
  for (let index = 1; index <= 8; index += 1) {
    const exchange = `T0${index}`;
    fullHistory.push(turn(exchange, "user", `synthetic evidence ${index}`), turn(exchange, "assistant", `synthetic response ${index}`));
  }
  for (let index = 1; index <= 40; index += 1) {
    const exchange = `D${index}`;
    fullHistory.push(turn(exchange, "user", `distractor ${index}`), turn(exchange, "assistant", `distractor reply ${index}`));
  }
  fullHistory.push(turn("T09", "user", "current synthetic report", "EP-001"), turn("T09", "assistant", "current synthetic reply", "EP-001"));
  const compactedVerbatim = fullHistory.slice(-6);
  const fullContext = buildDurableCaseContext({ caseState: state, transcriptEntries: fullHistory });
  const compactedContext = buildDurableCaseContext({ caseState: state, transcriptEntries: compactedVerbatim });

  assert.deepEqual(decisionRelevantProjection(compactedContext), decisionRelevantProjection(fullContext));
  assert.equal(compactedContext.recent_verbatim_window.turns.length, 6);
  assert.ok(compactedContext.targeted_retrieval_requests.some((item) => item.turn_id === "T01"));
  const requiredDomains = new Set(state.items.map((item) => item.domain));
  for (const domain of ["long_term_target", "care_history", "delivery", "probe_history", "sleep", "thc_sleep", "romance_readiness", "pain_hypothesis", "family_safety", "connection"]) assert.ok(requiredDomains.has(domain));
  assert.equal(compactedContext.lossy_summary_is_authority, false);
});

test("claimed prior consensus cannot overwrite an unresolved evidence target", () => {
  const base = applyCaseStatePatch(createEmptyCaseState({ caseId: "poison-test" }), {
    items: [{
      id: "meaning-target", domain: "meaning", statement: "Division meaning remains unresolved.", status: "hypothesis", confidence: "low",
      source: { kind: "synthetic_turn", ref: "T1", turn_id: "T1" }, still_current: null, supersedes: [], decision_relevance: "high"
    }]
  });
  const poisoned = recordClaimedPriorConsensus(base, {
    id: "claimed-consensus", domain: "meaning", asserted_statement: "division proves healing", target_item_id: "meaning-target",
    source: { kind: "current_turn", ref: "T9", turn_id: "T9" }
  });
  assert.equal(poisoned.items.find((item) => item.id === "meaning-target").status, "hypothesis");
  assert.equal(poisoned.items.find((item) => item.id === "claimed-consensus").source.claimed_prior_consensus, true);
  assert.equal(poisoned.contradiction_clusters.at(-1).status, "open");
});

test("state diffs show additions and confidence changes without exposing raw transcript", () => {
  const before = applyCaseStatePatch(createEmptyCaseState({ caseId: "diff-test" }), {
    items: [{ id: "x", domain: "target", statement: "A live hypothesis.", status: "hypothesis", confidence: "low", source: { kind: "turn", ref: "T1" }, still_current: null, supersedes: [], decision_relevance: "high" }]
  });
  const after = applyCaseStatePatch(before, {
    items: [
      { ...before.items[0], confidence: "medium" },
      { id: "y", domain: "observation", statement: "New direct report.", status: "direct_report", confidence: "high", source: { kind: "turn", ref: "T2" }, still_current: true, supersedes: [], decision_relevance: "medium" }
    ]
  });
  const diff = diffCaseStates(before, after);
  assert.deepEqual(diff.additions, ["y"]);
  assert.deepEqual(diff.confidence_changes, [{ id: "x", from: "low", to: "medium" }]);
  assert.doesNotMatch(JSON.stringify(diff), /raw_transcript|chain.of.thought/i);
});

test("runtime snapshot composition creates and continues a durable therapeutic episode", () => {
  const empty = createEmptyCaseState({ caseId: "episode-test" });
  const snapshot = { user_goal: "Build reliable self-support.", direct_observations: [{ id: "O1", statement: "The client wants reliable self-support." }], hypotheses: [], variables: { present_safety: "safe" } };
  const plan = { primaryJob: { id: "IC.PROTECTOR_ACTION", title: "Make protection visible" }, nextQuestion: "What small protective act is possible?", selectedNodes: [{ id: "IC.PROTECTOR_ACTION", successSignals: ["A protective act is completed without demanding trust."] }], variables: { present_safety: "safe" } };
  const first = mergeRuntimeSnapshotIntoCaseState(empty, snapshot, { turnId: "T1", interventionContract: plan });
  assert.equal(first.current_episode.route, "IC.PROTECTOR_ACTION");
  assert.equal(first.current_episode.started_turn_id, "T1");
  assert.equal(first.intervention_history.length, 1);
  const second = mergeRuntimeSnapshotIntoCaseState(first, { ...snapshot, direct_observations: [{ id: "O2", statement: "The client attempted one protective act." }] }, { turnId: "T2", interventionContract: plan });
  assert.equal(second.current_episode.id, first.current_episode.id);
  assert.equal(second.current_episode.started_turn_id, "T1");
  assert.equal(second.intervention_history.length, 2);
});

test("trajectory tracker validates booleans, reports missingness, and makes no causal claim", () => {
  const first = validateTrackerEntry({ schema_version: 1, id: "track-1", observed_at: "2026-09-01T12:00:00.000Z", sleep_duration_hours: 6, pain_intensity: 8, thc_used: true });
  assert.throws(() => validateTrackerEntry({ ...first, id: "track-bad", thc_used: "false" }), /boolean or null/);
  const entries = appendTrackerEntry([], first);
  const summary = summarizeTrackerWindow(entries);
  assert.equal(summary.entry_count, 1);
  assert.equal(summary.exposure_counts.thc_used, 1);
  assert.equal(summary.interpretation, "descriptive_only_no_causal_inference");
  assert.match(summary.note, /not evidence.*caused/);
});

test("private case store writes only ciphertext, preserves exact turns, and zeroizes access keys on close", async () => {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-case-"));
  const store = createEncryptedPrivateCaseStore({
    rootDir: privateRoot,
    routineKek: Buffer.alloc(32, 7),
    recoverySecretBytes: Buffer.alloc(32, 9),
    osBackedReauthenticated: true,
    now: () => "2026-09-08T12:00:00.000Z"
  });
  const marker = "PRIVATE_EXACT_TURN_MARKER";
  try {
    const record = await store.loadOrCreate("case-one");
    await store.commitTurn("case-one", {
      transcript_entries: [turn("E1", "user", marker), turn("E1", "assistant", "bounded reply")],
      case_state: record.case_state,
      state_diff: { schema_version: 1, additions: [] }
    });
    await store.appendTracker("case-one", { schema_version: 1, id: "track-1", observed_at: "2026-09-08T12:00:00.000Z", pain_intensity: 8, thc_used: false });
    await store.appendJournal("case-one", { id: "journal-1", observed_at: "2026-09-08T12:00:00.000Z", kind: "journal", text: "private journal marker" });
    const storedFile = path.join(privateRoot, "case-one.vault.json");
    const onDisk = await fs.readFile(storedFile, "utf8");
    assert.doesNotMatch(onDisk, new RegExp(marker));
    assert.doesNotMatch(onDisk, /private journal marker/);
    assert.equal((await fs.stat(storedFile)).mode & 0o777, 0o600);
    const reopened = await store.load("case-one");
    assert.equal(reopened.raw_transcript[0].text, marker);
    assert.equal(reopened.tracker_entries.length, 1);
    assert.equal(reopened.journal_entries.length, 1);
    store.close();
    await assert.rejects(() => store.load("case-one"), /closed/);
  } finally {
    await fs.rm(privateRoot, { recursive: true, force: true });
  }
});

test("case-state endpoints fail closed without storage and expose only structured evidence with an encrypted store", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const providers = createProviders(config);
  const absentServer = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { absentServer.once("error", reject); absentServer.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${absentServer.address().port}/v1/case/state?caseId=case-one`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PRIVATE_CASE_STORAGE_UNAVAILABLE");
  } finally {
    await new Promise((resolve) => absentServer.close(resolve));
  }

  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-api-"));
  const store = createEncryptedPrivateCaseStore({ rootDir: privateRoot, routineKek: Buffer.alloc(32, 3), recoverySecretBytes: Buffer.alloc(32, 4), osBackedReauthenticated: true });
  const server = createInnerSignalServer({ config, providers, privateCaseStore: store });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const tracker = await fetch(`${base}/v1/case/tracker`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case-one", entry: { schema_version: 1, id: "track-api", observed_at: "2026-09-08T13:00:00.000Z", pain_intensity: 7, thc_used: false } })
    });
    assert.equal(tracker.status, 200);
    const journal = await fetch(`${base}/v1/case/journal`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case-one", entry: { id: "journal-api", observed_at: "2026-09-08T13:00:00.000Z", kind: "dream", text: "private synthetic note" } })
    });
    assert.equal(journal.status, 200);
    const therapy = await fetch(`${base}/v1/therapy/respond`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        caseId: "case-one",
        exchangeId: "therapy-api",
        userTurnId: "therapy-api-user",
        assistantTurnId: "therapy-api-assistant",
        processingMode: "fast",
        userMessage: "I want to approach the younger part with care, but I still do not trust the exercise.",
        recentTranscript: "",
        userFacts: []
      })
    });
    const therapyValue = await therapy.json();
    assert.equal(therapy.status, 200);
    assert.equal(therapyValue.privateCaseStorage, "encrypted");
    assert.ok(therapyValue.durableCaseState.current_episode);
    assert.equal(therapyValue.caseStateDiff.current_episode_changed, true);
    assert.equal(Object.hasOwn(therapyValue, "raw_transcript"), false);
    const response = await fetch(`${base}/v1/case/state?caseId=case-one`);
    const value = await response.json();
    assert.equal(response.status, 200);
    assert.equal(value.rawTranscriptIncluded, false);
    assert.equal(value.hiddenReasoningIncluded, false);
    assert.equal(value.trackerWindow.entry_count, 1);
    assert.equal(value.transcriptTurnCount, 2);
    assert.equal((await store.load("case-one")).raw_transcript[0].text, "I want to approach the younger part with care, but I still do not trust the exercise.");
    assert.equal(Object.hasOwn(value, "journal_entries"), false);
    assert.equal(Object.hasOwn(value, "raw_transcript"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await fs.rm(privateRoot, { recursive: true, force: true });
  }
});

test("web client persists only safe settings and exposes state, diff, tracker, and legacy-data controls", async () => {
  const [script, html] = await Promise.all([
    readFile(path.join(root, "apps/web/app.js"), "utf8"),
    readFile(path.join(root, "apps/web/index.html"), "utf8")
  ]);
  assert.match(script, /inner-signal-settings-v1/);
  assert.doesNotMatch(script, /setItem\(STORAGE_KEY, JSON\.stringify\(state\)\)/);
  assert.match(script, /JSON\.stringify\(\{ settings: state\.settings, caseId: state\.caseId \}\)/);
  for (const label of ["Current saved state", "What changed this turn", "Trajectory entry", "Journal or dream note"]) assert.match(html, new RegExp(label));
  assert.match(html, /Legacy browser-local therapy data was detected/);
});

test("steering and compaction supplement remains synthetic and covers consent, route, telos, method identity, and poisoning", async () => {
  const supplement = await loadJson("tasks/audit-architecture-eval-20260907/STEERING-CONTEXT-SUPPLEMENT.json");
  assert.equal(supplement.modelRuns, 0);
  assert.equal(supplement.privacy.synthetic, true);
  const errors = new Set(supplement.steeringCases.flatMap((item) => item.expectedErrorIds));
  for (const id of ["TELOS_ABANDONMENT", "ROUTE_RIGIDITY", "CONSENT_OVERRIDE", "METHOD_IDENTITY_DRIFT", "CLIENT_EVIDENCE_STEERING_FAILURE"]) assert.ok(errors.has(id));
  assert.ok(supplement.compactionCases.some((item) => /claimed consensus/i.test(item.requiredBehavior)));
});
