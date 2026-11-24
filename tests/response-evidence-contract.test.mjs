import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createTranscriptCompletionAmendment } from "../src/storage/transcript-amendments.mjs";
import { chunkExactSourceText, createExactSourceArtifact } from "../src/storage/exact-source-artifact.mjs";
import {
  JOURNAL_NOTE_CUE_KINDS, RESPONSE_EVIDENCE_DIMENSIONS, buildResponseEvidenceSnapshot, buildResponseEvidenceSourceItems, buildEvidenceModelView, caseHasReadJournal,
  computeEvidenceDependencyBinding, normalizeEvidenceReview, deriveEvidenceFindings,
  responseEvidenceSnapshotSha256, responseEvidenceSnapshotCurrent, responseEvidenceRefreshJournal, inspectGovernedModelCall, prepareGovernedModelCall, sha256Json, sha256Text,
  snapshotOfConversationAlone, validateResponseEvidenceSnapshot, writtenFromConversationAlone
} from "../src/supervisor/response-evidence-contract.mjs";
import { QUOTE_CUE_KINDS, quoteCues } from "../src/journal-import/quote-index.mjs";
import { EVIDENCE_NOW, WRITTEN_WORDS, asIfNoJournalWasRead, evidenceCase, evidenceInput } from "./helpers/evidence-case.mjs";

const NOW = "2026-11-23T12:00:00.000Z";
const turn = (id, role = "user", text = "Synthetic exact words.") => ({ id, role, text, at: NOW, exchange_id: id, episode_id: null });
const record = () => ({ case_id: "synthetic-evidence", raw_transcript: [turn("older")], transcript_amendments: [], source_artifacts: [], candidate_responses: [], supervisor_artifacts: [], communication_events: [], journal_corpora: [], case_state: createEmptyCaseState({ caseId: "synthetic-evidence" }), runtime_turns: [{ id: "runtime:one", user_turn_id: "inbound", inbound: { exact_text: "Current words.", received_at: NOW } }] });
const input = () => ({ snapshotId: "snapshot:one", owner: { kind: "runtime_turn", runtime_turn_id: "runtime:one" }, inbound: { turn_id: "inbound", exact_text_sha256: sha256Text("Current words."), audience: "client", source_kind: "exact_client_turn" } });
const freeze = (r = record()) => buildResponseEvidenceSnapshot(r, input(), { createdAt: NOW });
const coverage = () => RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." }));
const review = () => ({ coverage: coverage(), items: [{ id: "claim", dimension: "personal_history", kind: "claim", candidate_quote: "é🙂", source_ids: ["src:turn:older"], assessment: "supported", reason: "Synthetic source." }], missing_material_history: [] });
const malformed = (fn) => assert.throws(fn, { name: "ValidationError", code: "RESPONSE_EVIDENCE_INVALID" });

test("derived findings carry the quoted defect, reason and only transcript source turn ids", () => {
  const item = { id: "defect", dimension: "personal_history", candidate_quote: "q".repeat(400), reason: "No supplied account supports this.", assessment: "unsupported", source_ids: ["src:turn:older", "src:input:instruction"] };
  const findings = deriveEvidenceFindings({ items: [item], missing_material_history: [] });
  assert.equal(findings[0].summary, `RESPONSE_EVIDENCE_UNSUPPORTED (personal_history): "${"q".repeat(300)}" - ${item.reason}`);
  assert.deepEqual(findings[0].evidence_turn_ids, ["older"]);
});

test("long case freezes with whole-item limits and excludes the reviewed lineage's drafts", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 400 }, (_, n) => turn(`turn:${n}`, "user", "x".repeat(400)));
  r.case_state.items = r.raw_transcript.map((entry) => ({ source: { turn_id: entry.id } }));
  r.candidate_responses = Array.from({ length: 60 }, (_, n) => ({ id: `draft:${n}`, root_candidate_id: n < 30 ? "reviewed" : `draft:${n}`, version: n + 1, status: "pending_audit", exact_text: "d".repeat(4000), created_at: NOW, metadata: {}, audit_history: [] }));
  r.supervisor_artifacts = Array.from({ length: 40 }, (_, n) => ({ id: `input:${n}`, kind: "input", input_type: "supervisor_revision", text: "s".repeat(2000), recorded_at: NOW, supplied_by: { channel: "owner_ui", actor_resolution: "owner_verified" } }));
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), lineageRootId: "reviewed" }, { createdAt: NOW });
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 192000);
  assert.ok(snapshot.source_items.filter((s) => s.locator.kind === "transcript_turn").length <= 120);
  const drafts = snapshot.source_items.filter((s) => s.kind === "unsent_draft");
  assert.ok(drafts.length <= 10);
  assert.ok(drafts.reduce((sum, s) => sum + s.excerpt_bytes, 0) <= 24000);
  assert.ok(drafts.every((s) => Number(s.locator.candidate_id.split(":")[1]) >= 30));
  assert.ok(snapshot.communication_projection.omitted.source_items.length > 0);
});

test("snapshot canonical hashing, source resolution and validation reject altered fields and stale excerpts", () => {
  const r = record(), snapshot = freeze(r);
  assert.equal(validateResponseEvidenceSnapshot(snapshot), snapshot);
  assert.equal(snapshot.snapshot_sha256, responseEvidenceSnapshotSha256(snapshot));
  assert.equal(sha256Json({ a: 1, b: { a: 2, z: 3 } }), sha256Json({ b: { z: 3, a: 2 }, a: 1 }));
  const { view, view_sha256 } = buildEvidenceModelView(r, snapshot);
  assert.equal(view.source_items[0].exact_excerpt, r.raw_transcript[0].text);
  assert.equal(view_sha256, sha256Json(view));
  const changed = structuredClone(snapshot); changed.candidate_origin = "external_draft";
  malformed(() => validateResponseEvidenceSnapshot(changed));
  r.raw_transcript[0].text += " Correction.";
  malformed(() => buildEvidenceModelView(r, snapshot));
});

test("inbound transcript insertion and audit bookkeeping do not change the dependency binding", () => {
  const r = record(), options = { inboundTurnId: "inbound", inboundSha256: sha256Text("Current words."), lineageRootId: "root", frozenCommunicationEventCount: 0 };
  const original = computeEvidenceDependencyBinding(r, options);
  r.raw_transcript.push(turn("inbound", "user", "Current words."));
  r.runtime_turns[0].events = [{ arbitrary: "audit bookkeeping" }];
  r.updated_at = "2026-11-24"; r.revision = 9;
  r.candidate_responses.push({ id: "root", root_candidate_id: "root", audit_history: [{ id: "audit" }] });
  r.communication_events.push({ id: "own", kind: "exported", subject: { kind: "candidate", candidate_id: "root" } });
  assert.deepEqual(computeEvidenceDependencyBinding(r, options), original);
});

for (const committed of [false, true]) test(`refreezing an older inbound cannot make it current after a newer client message (committed: ${committed})`, async () => {
  const r = record();
  r.raw_transcript.push(turn("inbound", "user", "Current words."));
  r.runtime_turns.push({ id: "runtime:newer", user_turn_id: "newer", inbound: { exact_text: "I cancelled that visit.", received_at: NOW } });
  if (committed) r.raw_transcript.push(turn("newer", "user", "I cancelled that visit."));
  // These dependencies already include the newer message. Rebinding them cannot authorize the older inbound.
  const snapshot = freeze(r);
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot }), false);
  assert.equal(inspectGovernedModelCall({ record: r, snapshot }).exhausted, true);
  assert.equal(inspectGovernedModelCall({ record: r, snapshot, completed: { output: {} } }).exhausted, true);
  let freezes = 0;
  const prepared = await prepareGovernedModelCall({ record: r, snapshot,
    freeze: async () => { freezes++; throw new Error("An older inbound cannot be refreshed into currency."); }, load: async () => r });
  assert.equal(prepared.exhausted, true);
  assert.equal(freezes, 0);
});

const candidateSubject = (candidate_id) => ({ kind: "candidate", candidate_id, candidate_version: 1, text_sha256: sha256Text("Earlier draft.") });
const ambiguousSubject = (...ids) => ({ kind: "unresolved", reason: "ambiguous", candidate_refs: ids.map(candidate_id => ({ candidate_id, candidate_version: 1 })) });
function communicationRecord() {
  const r = record();
  r.candidate_responses = ["root", "repair", "foreign"].map((id, n) => ({ id, version: n + 1,
    root_candidate_id: id === "foreign" ? id : "root", exact_text: "Earlier draft.", status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW }));
  return r;
}
const communicationEvent = (kind, subject) => ({ id: "event:one", kind, subject, audience: "client", recorded_at: NOW,
  provenance: { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null }, sent_at: null, sent_at_status: "unavailable" });

for (const [name, kind, subject, staysFresh] of [
  ["own report", "reported_sent", candidateSubject("root"), false],
  ["foreign report", "reported_sent", candidateSubject("foreign"), false],
  ["mixed ambiguous report", "reported_sent", ambiguousSubject("root", "foreign"), false],
  ["own ambiguous report", "reported_sent", ambiguousSubject("root", "repair"), false],
  ["unresolved report without candidates", "reported_sent", ambiguousSubject(), false],
  ["transcript pair report", "reported_sent", { kind: "transcript_turn", assistant_turn_id: "older", in_reply_to_turn_id: "prior", text_sha256: sha256Text("Synthetic exact words.") }, false],
  ["foreign export", "exported", candidateSubject("foreign"), false],
  ["own export", "exported", candidateSubject("root"), true],
  ["own repair exposure", "exposed", candidateSubject("repair"), true],
  ["own companion export", "exported", { kind: "companion", companion_of: { candidate_id: "repair", candidate_version: 2 }, artifact_sha256: sha256Text("Companion.") }, true]
]) test(`post-freeze ${name} and its retraction ${staysFresh ? "stay fresh" : "invalidate"}`, () => {
  const r = communicationRecord();
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), lineageRootId: "root" }, { createdAt: NOW });
  const current = () => responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } });
  assert.equal(current(), true);
  // The timestamp deliberately equals the freeze time: ledger order determines what was frozen.
  r.communication_events.push(communicationEvent(kind, subject));
  assert.equal(current(), staysFresh);
  r.communication_events.push({ id: "event:retraction", kind: "retraction", retracts_event_id: "event:one", recorded_at: NOW });
  assert.equal(current(), staysFresh);
});

for (const kind of ["reported_sent", "exported", "exposed"]) test(`freeze binds an existing own ${kind} and its later retraction`, () => {
  const r = communicationRecord();
  r.communication_events.push(communicationEvent(kind, candidateSubject("root")));
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), lineageRootId: "root" }, { createdAt: NOW });
  const without = communicationRecord();
  assert.notEqual(snapshot.dependency_binding.communication_digest, freeze(without).dependency_binding.communication_digest);
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), true);
  r.communication_events.push({ id: "event:retraction", kind: "retraction", retracts_event_id: "event:one", recorded_at: NOW });
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), false);
});

test("a legacy snapshot without a communication freeze boundary stays readable and requires refresh", () => {
  const r = record(), snapshot = freeze(r);
  delete snapshot.dependency_binding.communication_event_count;
  snapshot.snapshot_sha256 = responseEvidenceSnapshotSha256(snapshot);
  assert.equal(validateResponseEvidenceSnapshot(snapshot), snapshot);
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot }), false);
  assert.doesNotThrow(() => buildEvidenceModelView(r, snapshot));
});

for (const change of ["generation", "visibility_epoch", "manifest", "removed"]) for (const searched of [false, true]) {
  test(`freeze and refresh rebuild valid no-match snapshots after ${change} (changed corpus searched: ${searched})`, () => {
    const r = record();
    r.journal_corpora = ["a", "b"].map(id => ({ corpus_id: `corpus:${id}`, active_generation: "generation:one", visibility_epoch: 0, manifest_object_id: `manifest:${id}` }));
    const receipts = r.journal_corpora.filter(corpus => searched || corpus.corpus_id !== "corpus:a").map(corpus => ({ operation_id: `retrieval:${corpus.corpus_id}`,
      corpus_id: corpus.corpus_id, generation: corpus.active_generation, visibility_epoch: 0, manifest_object_id: corpus.manifest_object_id,
      purpose: "session_use", query_sha256: sha256Text("query"),
      filters_sha256: sha256Json({}), returned_source_ids: [], packet_sha256: sha256Json([]), more_available: false, omitted_count: 0, budget_used_tokens: 0, budget_used_bytes: 0 }));
    const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), journal: { availability: "available", retrieval_status: "no_match", receipts } }, { createdAt: NOW });
    if (change === "generation") r.journal_corpora[0].active_generation = "generation:two";
    else if (change === "visibility_epoch") r.journal_corpora[0].visibility_epoch++;
    else if (change === "manifest") r.journal_corpora[0].manifest_object_id = "manifest:replacement";
    else r.journal_corpora.shift();
    const refrozen = buildResponseEvidenceSnapshot(r, { ...input(), journal: snapshot.journal }, { createdAt: NOW });
    assert.deepEqual(refrozen.journal.receipts.map(receipt => receipt.corpus_id), ["corpus:b"]);
    assert.equal(refrozen.journal.retrieval_status, searched ? "partial" : "no_match");
    assert.deepEqual(refrozen.journal.omissions, searched ? [{ reason: "journal_binding_changed", count: 1 }] : []);
    assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot: refrozen }), true);
    const journal = responseEvidenceRefreshJournal(r, snapshot);
    assert.equal(journal.availability, "available");
    assert.equal(journal.retrieval_status, "partial");
    assert.equal(journal.more_available, true);
    assert.deepEqual(journal.omissions, [{ reason: "journal_binding_changed", count: 1 }]);
    assert.deepEqual(journal.receipts.map(receipt => receipt.corpus_id), ["corpus:b"]);
    const refreshed = buildResponseEvidenceSnapshot(r, { ...input(), snapshotId: "snapshot:two", revision: 2, parentSnapshotId: snapshot.id,
      revisionReason: "dependency_refresh", journal }, { createdAt: NOW });
    assert.equal(validateResponseEvidenceSnapshot(refreshed), refreshed);
    assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot: refreshed }), true);
    assert.doesNotThrow(() => buildEvidenceModelView(r, refreshed));
  });
}

test("own-lineage unresolved reports in the review projection bind retractions without a source locator", () => {
  const r = record();
  r.candidate_responses.push({ id: "root", version: 1, root_candidate_id: "root", exact_text: "Earlier draft.", status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW });
  r.communication_events.push({ id: "ambiguous:own", kind: "reported_sent", audience: "client",
    subject: { kind: "unresolved", reason: "ambiguous", candidate_refs: [{ candidate_id: "root", candidate_version: 1 }] },
    provenance: { origin: "agent_relayed", actor_resolution: "unresolved", source_ref: null, quote: "An unresolved delivery account." },
    sent_at: null, sent_at_status: "unavailable", recorded_at: NOW });
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), lineageRootId: "root" }, { createdAt: NOW });
  assert.equal(snapshot.source_items.some(s => s.id === "src:report:ambiguous:own"), false);
  assert.equal(snapshot.communication_projection.unresolved_delivery.some(entry => entry.source.event_id === "ambiguous:own"), true);
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), true);
  r.communication_events.push({ id: "retraction:ambiguous", kind: "retraction", retracts_event_id: "ambiguous:own" });
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), false);
});

test("source-dependent communication events bind even outside the bounded review projection", () => {
  const r = record();
  r.candidate_responses = Array.from({ length: 30 }, (_, n) => ({ id: `own:${n}`, version: n + 1, root_candidate_id: "root",
    exact_text: `Earlier draft ${n}.`, status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW }));
  r.communication_events = r.candidate_responses.map((candidate, n) => ({ id: `report:${n}`, kind: "reported_sent", audience: "client",
    subject: { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, text_sha256: sha256Text(candidate.exact_text) },
    provenance: { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null },
    sent_at: n === 0 ? "2026-11-24T12:00:00.000Z" : NOW, sent_at_status: "known", recorded_at: NOW }));
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), lineageRootId: "root" }, { createdAt: NOW });
  assert.equal(snapshot.source_items.some(s => s.id === "src:report:report:0"), true);
  assert.equal(snapshot.communication_projection.confirmed_or_reported_client_outbound.some(entry => entry.source.event_id === "report:0"), false);
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), true);
  r.communication_events.push({ id: "retraction:report:0", kind: "retraction", retracts_event_id: "report:0" });
  assert.equal(responseEvidenceSnapshotCurrent(r, { snapshot, rootCandidate: { id: "root" } }), false);
});

test("pending runtime inbounds bind their id and exact bytes, excluding only this snapshot's own inbound", () => {
  const r = record(), options = { inboundTurnId: "inbound", inboundSha256: sha256Text("Current words.") };
  const original = computeEvidenceDependencyBinding(r, options);
  r.runtime_turns.push({ id: "runtime:newer", user_turn_id: "newer", inbound: { exact_text: "New café words.\r\n" } });
  const pending = computeEvidenceDependencyBinding(r, options);
  assert.notDeepEqual(pending, original);
  r.runtime_turns[1].inbound.exact_text = "New café words.\n";
  assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), pending);
  r.runtime_turns[1].inbound.exact_text = "New café words.\r\n";
  r.runtime_turns[1].user_turn_id = "different-id";
  assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), pending);
  r.raw_transcript.push(turn("different-id", "user", r.runtime_turns[1].inbound.exact_text));
  assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), original);
  r.runtime_turns.pop(); r.raw_transcript.pop();
  r.runtime_turns[0].inbound.exact_text += " changed";
  assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), original);
});

test("each independent material change invalidates its dependency component", () => {
  const options = { inboundTurnId: "inbound", lineageRootId: "root" };
  const changes = [
    (r) => r.raw_transcript.push(turn("newer")),
    (r) => { r.raw_transcript[0].text += " changed"; },
    (r) => r.communication_events.push({ id: "foreign", kind: "reported_sent", subject: { kind: "candidate", candidate_id: "foreign" } }),
    (r) => r.communication_events.push({ id: "correction", kind: "retraction", retracts_event_id: "foreign" }),
    (r) => r.supervisor_artifacts.push({ id: "owner-input", kind: "input" }),
    (r) => { r.case_state.protective_compatibility = { current: { gate: "HOLD" } }; },
    (r) => { r.case_state.updated_at = "2026-11-24"; },
    (r) => { r.journal_corpora[0].active_generation = "next"; },
    (r) => { r.journal_corpora[0].visibility_epoch += 1; },
    (r) => { r.journal_corpora[0].manifest_object_id = "manifest:replacement"; },
    (r) => { r.journal_corpora[0].active_generation = null; r.journal_corpora[0].visibility_epoch += 1; r.journal_corpora[0].manifest_object_id = "tombstone"; }
  ];
  for (const change of changes) {
    const r = record(); r.journal_corpora = [{ corpus_id: "journal", active_generation: "initial", visibility_epoch: 0 }];
    const original = computeEvidenceDependencyBinding(r, options); change(r);
    assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), original);
  }
  const r = record(), original = computeEvidenceDependencyBinding(r, options);
  const artifact = createExactSourceArtifact({ id: "source:completion", chunks: chunkExactSourceText("Synthetic completed source."), createdAt: NOW });
  r.source_artifacts.push(artifact);
  r.transcript_amendments.push(createTranscriptCompletionAmendment({ id: "amendment:one", targetTurn: r.raw_transcript[0], completionText: artifact.exact_text, sourceArtifact: artifact, producerContextId: "producer", createdAt: NOW }));
  assert.notDeepEqual(computeEvidenceDependencyBinding(r, options), original);
});

test("review locates exact repeated multibyte quotes in UTF-8 bytes", () => {
  const r = review(); r.items[0].quote_occurrence = 2;
  const candidateText = "A é🙂 puis é🙂.";
  const normalized = normalizeEvidenceReview(r, { candidateText, snapshot: freeze() });
  assert.deepEqual(normalized.items[0].candidate_span, { start_utf8_byte: Buffer.byteLength("A é🙂 puis "), end_utf8_byte: Buffer.byteLength("A é🙂 puis é🙂"), span_sha256: sha256Text("é🙂") });
  const defaulted = normalizeEvidenceReview(review(), { candidateText, snapshot: freeze() });
  assert.equal(defaulted.items[0].quote_occurrence, 1);
});

test("bad quotes, coverage, duplicate ids, unknown sources and unsupported fields are malformed", () => {
  for (const mutate of [
    (r) => { r.items[0].candidate_quote = "not present"; },
    (r) => r.coverage.pop(),
    (r) => { r.coverage[1] = r.coverage[0]; },
    (r) => r.items.push(r.items[0]),
    (r) => { r.items[0].source_ids = ["foreign-source"]; },
    (r) => { r.items[0].source_ids = []; },
    (r) => { r.items[0].assessment = "minor"; },
    (r) => { r.items[0].unexpected = true; },
    (r) => { r.items[0].candidate_span = { start_utf8_byte: 0, end_utf8_byte: 2, span_sha256: sha256Text("é🙂") }; }
  ]) { const r = review(); mutate(r); malformed(() => normalizeEvidenceReview(r, { candidateText: "é🙂", snapshot: freeze() })); }
});

test("incompatible source kinds are downgraded and every blocking review yields exactly the fixed derived finding", () => {
  const r = review(); r.items[0].dimension = "prior_delivery";
  const snapshot = freeze(); snapshot.source_items[0].kind = "unsent_draft";
  r.items.push({ ...r.items[0], id: "unsupported", assessment: "unsupported", source_ids: [] }, { ...r.items[0], id: "contradiction", assessment: "contradicted" }, { ...r.items[0], id: "qualified", assessment: "uncertain_but_worded_accurately", source_ids: [] });
  r.missing_material_history.push({ id: "history", question: "Was it tried?", why_material: "Changes the suggestion.", candidate_quote: "é🙂" });
  const normalized = normalizeEvidenceReview(r, { candidateText: "é🙂", snapshot });
  assert.equal(normalized.items[0].source_incompatible, true);
  assert.deepEqual(deriveEvidenceFindings(normalized), [
    ["claim", "SOURCE_INCOMPATIBLE"], ["unsupported", "UNSUPPORTED"], ["contradiction", "CONTRADICTED"], ["history", "MISSING_HISTORY"]
  ].map(([id, code]) => ({ id: `evidence:${id}`, code: `RESPONSE_EVIDENCE_${code}`, severity: "substantive",
    summary: `RESPONSE_EVIDENCE_${code} (${id === "history" ? "missing_material_history" : "prior_delivery"}): "é🙂" - ${id === "history" ? "Changes the suggestion." : "Synthetic source."}`,
    evidence_turn_ids: ["claim", "contradiction"].includes(id) ? ["older"] : [], unresolved: true })));
});

test("source selection includes old referenced turns and records whole-item omissions", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 240 }, (_, n) => turn(`turn:${n}`));
  r.case_state.items = r.raw_transcript.map((entry) => ({ id: entry.id, source: { turn_id: entry.id } }));
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.length, 121);
  assert.ok(snapshot.communication_projection.omitted.source_items.length);
  assert.ok(snapshot.source_items.some((entry) => entry.locator.turn_id === "turn:121"));
  assert.ok(snapshot.source_items.filter(entry => entry.locator.kind === "transcript_turn").every((entry) => entry.exact_excerpt === null));
});

test("source classification retains app commitment beyond the ordinary 25-item projection window", () => {
  const r = record(); r.raw_transcript = [];
  for (let n = 0; n < 30; n += 1) {
    const user = { ...turn(`user:${n}`), exchange_id: `exchange:${n}` };
    const assistant = { ...turn(`assistant:${n}`, "assistant", `Exact delivered reply ${n}.`), exchange_id: user.exchange_id };
    r.raw_transcript.push(user, assistant);
    r.candidate_responses.push({ id: `candidate:${n}`, version: n + 1, root_candidate_id: `candidate:${n}`, status: "sent", exact_text: assistant.text,
      metadata: { sent_with_audit_id: `audit:${n}`, sent_turn_id: assistant.id, sent_in_reply_to_turn_id: user.id }, audit_history: [] });
  }
  r.case_state.items = [{ id: "older-reference", source: { turn_id: "assistant:0" } }];
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.find((item) => item.id === "src:turn:assistant:0").kind, "app_committed_client_outbound");
  assert.equal(snapshot.communication_projection.confirmed_or_reported_client_outbound.length, 25);
  assert.equal(snapshot.communication_projection.omitted.confirmed_or_reported_client_outbound, 5);
});

test("reports, unsent drafts, unattributed turns and supplied owner inputs retain distinct provenance", () => {
  const r = record(); r.raw_transcript.push(turn("unattributed", "assistant", "An assistant entry with unknown audience."));
  r.candidate_responses.push({ id: "draft", version: 1, root_candidate_id: "draft", exact_text: "An unsent draft.", status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW });
  r.communication_events.push({ id: "report", kind: "reported_sent", audience: "client", subject: { kind: "candidate", candidate_id: "draft", candidate_version: 1, text_sha256: sha256Text("An unsent draft.") }, provenance: { origin: "agent_relayed", actor_resolution: "unresolved", source_ref: null, quote: null }, sent_at: null, sent_at_status: "unavailable", recorded_at: NOW });
  r.candidate_responses.push({ id: "unsent", version: 2, root_candidate_id: "unsent", exact_text: "Not delivered.", status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW });
  for (const [id, input_type] of [["client-input", "client_message"], ["instruction", "supervisor_revision"]]) r.supervisor_artifacts.push({ id, kind: "input", input_type, text: "Relayed words.", supplied_by: { channel: "authenticated_agent", actor_resolution: "unresolved" }, recorded_at: NOW });
  const snapshot = freeze(r), kinds = snapshot.source_items.map((item) => item.kind);
  for (const kind of ["agent_relayed_report", "unsent_draft", "unattributed_assistant_turn", "relayed_client_message", "supervisor_instruction"]) assert.ok(kinds.includes(kind));
  assert.equal(snapshot.source_items.find((item) => item.kind === "supervisor_instruction").supplied_by.actor_resolution, "unresolved");
  r.communication_events[0].provenance = { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null };
  assert.ok(freeze(r).source_items.some((item) => item.kind === "owner_reported_client_outbound"));
});


test("the transcript cap preserves the bounded inventory of other source kinds", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 200 }, (_, n) => turn(`turn:${n}`));
  r.case_state.items = r.raw_transcript.map((entry) => ({ id: entry.id, statement: "A model proposal is not a source.", source: { turn_id: entry.id } }));
  r.candidate_responses.push({ id: "old-draft", version: 1, root_candidate_id: "old-draft", status: "pending_audit", exact_text: "Older unsent draft.", created_at: "2020-01-01T00:00:00.000Z", metadata: {}, audit_history: [] });
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.length, 122);
  assert.equal(snapshot.source_items.some((item) => item.id === "src:draft:old-draft:v1"), true);
  assert.equal(snapshot.source_items.some((item) => item.id === "src:turn:inbound"), true);
  assert.equal(JSON.stringify(snapshot.source_items).includes("A model proposal is not a source."), false);
});


test("an amended assistant turn cannot inherit delivery evidence for different original bytes", () => {
  const r = record();
  const user = { ...turn("sent-user"), exchange_id: "sent-exchange" };
  const assistant = { ...turn("sent-assistant", "assistant", "Original committed words."), exchange_id: user.exchange_id };
  r.raw_transcript.push(user, assistant);
  r.candidate_responses.push({ id: "delivered", version: 1, root_candidate_id: "delivered", exact_text: assistant.text, status: "sent", audit_history: [],
    metadata: { sent_with_audit_id: "audit:sent", sent_turn_id: assistant.id, sent_in_reply_to_turn_id: user.id } });
  r.communication_events.push({ id: "report:sent", kind: "reported_sent", audience: "client", subject: { kind: "transcript_turn", assistant_turn_id: assistant.id, in_reply_to_turn_id: user.id, text_sha256: sha256Text(assistant.text) },
    provenance: { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null }, sent_at: null, sent_at_status: "unavailable", recorded_at: NOW });
  assert.equal(freeze(r).source_items.find((item) => item.id === "src:turn:sent-assistant").kind, "app_committed_client_outbound");
  const artifact = createExactSourceArtifact({ id: "source:completion", chunks: chunkExactSourceText(" Added words."), createdAt: NOW });
  r.source_artifacts.push(artifact);
  r.transcript_amendments.push(createTranscriptCompletionAmendment({ id: "amendment:sent", targetTurn: assistant, completionText: artifact.exact_text, sourceArtifact: artifact, producerContextId: "operator", createdAt: NOW }));
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.find((item) => item.id === "src:turn:sent-assistant").kind, "unattributed_assistant_turn");
  assert.equal(snapshot.source_items.some((item) => item.id === "src:report:report:sent"), false);
  assert.ok(snapshot.communication_projection.omitted.source_items.some((entry) => entry.reason === "report_text_changed"));
});

test("serialized byte pressure omits the oldest transcript items whole and records every removal", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 120 }, (_, n) => turn(`turn:${String(n).padStart(3, "0")}:${"t".repeat(100)}`));
  r.case_state.items = r.raw_transcript.map((entry) => ({ source: { turn_id: entry.id } }));
  for (let n = 0; n < 20; n++) {
    const candidate = { id: `reported:${n}`, version: n + 1, root_candidate_id: `reported:${n}`, exact_text: "r".repeat(6000), status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW };
    r.candidate_responses.push(candidate);
    r.communication_events.push({ id: `report:${n}`, kind: "reported_sent", audience: "client", subject: { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, text_sha256: sha256Text(candidate.exact_text) }, provenance: { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null }, sent_at: NOW, sent_at_status: "known", recorded_at: NOW });
  }
  const snapshot = buildResponseEvidenceSnapshot(r, { ...input(), historyRequirements: Array.from({ length: 20 }, (_, n) => ({ id: `history:${n}`, topic: "q".repeat(1000), why_material: "w".repeat(1000), source_ids: [], disposition: "open" })) }, { createdAt: NOW });
  const selected = snapshot.source_items.filter((item) => item.id.startsWith("src:turn:"));
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 192000);
  assert.ok(selected.length < 120);
  const omissions = snapshot.communication_projection.omitted.source_items;
  assert.equal(omissions.find((item) => item.reason === "snapshot_byte_budget").count, 120 - selected.length);
  assert.ok(selected.every((item) => item.exact_excerpt === null));
});

test("large reports also fit by whole-item omission after transcript and draft inventories are exhausted", () => {
  const r = record();
  for (let n = 0; n < 20; n++) {
    const candidate = { id: `reported:${n}`, version: n + 1, root_candidate_id: `reported:${n}`, exact_text: "r".repeat(100000), status: "pending_audit", metadata: {}, audit_history: [], created_at: NOW };
    r.candidate_responses.push(candidate);
    r.communication_events.push({ id: `report:${n}`, kind: "reported_sent", audience: "client", subject: { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, text_sha256: sha256Text(candidate.exact_text) }, provenance: { origin: "owner_action", actor_resolution: "owner_verified", source_ref: null, quote: null }, sent_at: NOW, sent_at_status: "known", recorded_at: NOW });
  }
  const snapshot = freeze(r);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 192000);
  const reports = snapshot.source_items.filter((item) => item.id.startsWith("src:report:"));
  assert.ok(reports.length < 20);
  assert.ok(reports.every((item) => item.exact_excerpt === "r".repeat(100000)));
  assert.equal(snapshot.communication_projection.omitted.source_items.find((item) => item.reason === "report_snapshot_budget").count, 20 - reports.length);
});

test("amended source capabilities and store-built journal retrieval records are citable", async () => {
  const { RESPONSE_EVIDENCE_KINDS } = await import("../src/supervisor/response-evidence-contract.mjs");
  for (const kind of ["exact_client_turn", "app_committed_client_outbound", "owner_reported_client_outbound", "relayed_client_message"]) assert.ok(RESPONSE_EVIDENCE_KINDS[kind].supports.includes("source_consultation_claims"));
  for (const journal of [undefined, { availability: "available", retrieval_status: "no_match", coverage: "Bounded search.", more_available: true, omissions: [{ reason: "partial", count: 2 }] }]) {
    const r = record(), snapshot = buildResponseEvidenceSnapshot(r, { ...input(), journal }, { createdAt: NOW });
    const item = snapshot.source_items.find(s => s.id === "src:journal:record");
    assert.equal(item.kind, "journal_retrieval_record"); assert.deepEqual(item.locator, { kind: "journal_record" });
    for (const field of ["availability", "retrieval_status", "coverage", "more_available", "omissions"]) assert.ok(item.exact_excerpt.includes(field));
    const result = normalizeEvidenceReview({ coverage: coverage(), items: [{ ...review().items[0], candidate_quote: "Search result.", dimension: "source_consultation_claims", source_ids: [item.id] }], missing_material_history: [] }, { candidateText: "Search result.", snapshot });
    assert.deepEqual(deriveEvidenceFindings(result), []);
    assert.deepEqual(RESPONSE_EVIDENCE_KINDS[item.kind].supports, ["source_consultation_claims", "coverage_scope_and_conflicts"]);
    malformed(() => buildResponseEvidenceSnapshot(r, { ...input(), journal: { source_items: [item] } }, { createdAt: NOW }));
  }
});

test("audit prompt uses the owner's exact amended advice paragraph", async () => {
  const { privateRuntimeAuditPrompt } = await import("../src/prompts/private-runtime-audit.mjs");
  const paragraph = "Personalized advice depends on history when whether the method was tried before, what happened, or a barrier to it would change the advice. When the sources settle that, check the advice against them: advice that repeats what the sources say failed, or ignores a barrier they state, is contradicted, even with no historical claim in its wording and even if it is called general information. When the sources do not settle it, a suggestion that says or implies nothing about the person's past with the method is current-message support: assess it uncertain_but_worded_accurately, not missing history. List missing_material_history only when the response itself asserts, presupposes or depends on an answer the sources do not give.";
  assert.ok(privateRuntimeAuditPrompt({ response_evidence: {} }).system.includes(paragraph));
});

// A journal quotation's note (24 Nov 2026): when the entry says it was written, its wording cues and its lifecycle.
const JOURNAL_WORDS = "I dreamt I had missed the train. Maybe I will write it down.";
const journalNote = () => ({ written: { from: "2019-03-03", to: "2019-04-10", precision: "interval", between: true, ambiguous: false, year_inferred: true },
  cues: quoteCues(JOURNAL_WORDS).map((cue) => ({ ...cue })), lifecycle: "superseded" });
function journalRecord(note) {
  const r = record();
  r.journal_corpora = [{ corpus_id: "corpus:one", active_generation: "generation:one", visibility_epoch: 0, manifest_object_id: "manifest:one" }];
  const item = { id: "src:journal:1", kind: "journal_quotation", actor: "client", audience: "private_journal", time: { at: null, status: "unavailable" },
    epistemic_status: "client_written_account", excerpt_sha256: sha256Text(JOURNAL_WORDS), excerpt_bytes: Buffer.byteLength(JOURNAL_WORDS), exact_excerpt: JOURNAL_WORDS,
    locator: { kind: "journal", corpus_id: "corpus:one", generation: "generation:one", visibility_epoch: 0, record_id: "record:one", start_byte: 0, end_byte: Buffer.byteLength(JOURNAL_WORDS) },
    ...(note === undefined ? {} : { journal_note: note }) };
  const receipt = { operation_id: "retrieval:one", corpus_id: "corpus:one", generation: "generation:one", visibility_epoch: 0, manifest_object_id: "manifest:one", purpose: "session_use",
    query_sha256: sha256Text("query"), filters_sha256: sha256Json({}), returned_source_ids: [item.id], packet_sha256: sha256Json([item]), more_available: false, omitted_count: 0,
    budget_used_tokens: 0, budget_used_bytes: 0 };
  return { r, journal: { availability: "available", retrieval_status: "returned", source_items: [item], receipts: [receipt] } };
}
const freezeJournal = (note) => {
  const { r, journal } = journalRecord(note);
  return { r, snapshot: buildResponseEvidenceSnapshot(r, { ...input(), journal }, { createdAt: NOW }) };
};

test("a journal quotation's note is stored with it and passed on in the models' view; a quotation without one stays valid", () => {
  const { r, snapshot } = freezeJournal(journalNote());
  assert.equal(validateResponseEvidenceSnapshot(snapshot), snapshot);
  assert.deepEqual(snapshot.source_items.find((item) => item.kind === "journal_quotation").journal_note, journalNote());
  const shown = buildEvidenceModelView(r, snapshot).view.source_items.find((item) => item.kind === "journal_quotation");
  assert.deepEqual([shown.exact_excerpt, shown.journal_note], [JOURNAL_WORDS, journalNote()]);
  assert.deepEqual(shown.time, { at: null, status: "unavailable" }, "a writing date is never the time of anything");
  for (const note of [{ ...journalNote(), written: null }, { ...journalNote(), cues: [] }, ...["active", "candidate"].map((lifecycle) => ({ ...journalNote(), lifecycle })),
    ...[["2019", "2019", "year"], ["2019-03", "2019-03", "month"], ["2019-03-03", "2019-03-03", "day"], [null, "2019-04", "interval"], ["2019-03-03", null, "interval"]]
      .map(([from, to, precision]) => ({ ...journalNote(), written: { from, to, precision, between: precision === "interval", ambiguous: true, year_inferred: false } }))]) {
    assert.doesNotThrow(() => freezeJournal(note), JSON.stringify(note));
  }
  const { r: plain, snapshot: without } = freezeJournal(undefined);
  assert.equal(validateResponseEvidenceSnapshot(without), without);
  assert.equal(Object.hasOwn(buildEvidenceModelView(plain, without).view.source_items.find((item) => item.kind === "journal_quotation"), "journal_note"), false);
});

test("a journal note is strict, and no other kind of source may hold one", () => {
  const note = journalNote();
  for (const bad of [
    null, "note", {}, { ...note, extra: true }, { written: note.written, cues: note.cues }, { ...note, lifecycle: "revoked" }, { ...note, lifecycle: "deleted" }, { ...note, cues: null },
    { ...note, cues: [{ kind: "feeling", words: "sad" }] }, { ...note, cues: [{ kind: "dream" }] }, { ...note, cues: [{ kind: "dream", words: "dream", at: 1 }] }, { ...note, cues: [{ kind: "dream", words: "x".repeat(81) }] },
    { ...note, written: {} }, { ...note, written: { ...note.written, date_line: "March 3, 2019" } }, { ...note, written: { ...note.written, precision: "about" } },
    { ...note, written: { ...note.written, from: "March 2019" } }, { ...note, written: { ...note.written, to: "2019-03-03T12:00:00.000Z" } }, { ...note, written: { ...note.written, between: null } }
  ]) malformed(() => freezeJournal(bad));
  const { snapshot } = freezeJournal(note);
  for (const kind of ["exact_client_turn", "journal_retrieval_record"]) {
    const changed = structuredClone(snapshot);
    changed.source_items.find((item) => item.kind === kind).journal_note = structuredClone(note);
    changed.snapshot_sha256 = responseEvidenceSnapshotSha256(changed);
    malformed(() => validateResponseEvidenceSnapshot(changed));
  }
  // The contract names the cue kinds itself, since the encrypted store must start without an installed package: the same ones.
  assert.deepEqual([...JOURNAL_NOTE_CUE_KINDS], [...QUOTE_CUE_KINDS]);
});

// ---- A case that has read its client's journal (24 Nov 2026) ------------------------------------------------------------------------

const NO_MATCH = { availability: "available", retrieval_status: "no_match" }, FAILED = { availability: "unavailable", retrieval_status: "failed" };
const WITHHELD = { availability: "unavailable", retrieval_status: "not_attempted", omissions: [{ reason: "journal_withheld", count: 1 }] };
const freezeCase = (r, extra = {}) => buildResponseEvidenceSnapshot(r, evidenceInput(extra), { createdAt: EVIDENCE_NOW });
// The full invented case once it has read its journal: a snapshot of it, its first, holds a quotation.
function readCase() {
  const { r: { journal_corpora }, journal } = journalRecord(journalNote());
  const r = { ...evidenceCase(), journal_corpora };
  const quoting = freezeCase(r, { snapshotId: "snapshot:quoting", journal });
  return { r: { ...r, response_evidence_snapshots: [quoting] }, journal, quoting };
}
const sourceIds = (snapshot) => snapshot.source_items.map((item) => item.id).sort();
const CONVERSATION = ["first", "sent", "second", "reported", "third", "loose"].map((id) => `src:turn:turn:${id}`).concat("src:turn:inbound", "src:journal:record").sort();
const held = (r, snapshot) => WRITTEN_WORDS.filter((words) => JSON.stringify(buildEvidenceModelView(r, snapshot).view).includes(words));
const digest = (value) => sha256Text(JSON.stringify(value));

test("a case has read its journal once one of its snapshots holds a quotation; a missing or malformed snapshot, or list of them, holds none and never throws", () => {
  const { quoting } = readCase();
  const none = [undefined, null, {}, "snapshots", 7, [], [null], [undefined], ["snapshot"], [{}], [{ source_items: null }], [{ source_items: "journal_quotation" }], [{ source_items: {} }], [{ source_items: [null, undefined, {}, { kind: "unsent_draft" }] }]];
  for (const response_evidence_snapshots of none) assert.equal(caseHasReadJournal({ response_evidence_snapshots }), false, JSON.stringify(response_evidence_snapshots));
  for (const r of [undefined, null, {}]) assert.equal(caseHasReadJournal(r), false);
  for (const others of none.filter(Array.isArray)) assert.equal(caseHasReadJournal({ response_evidence_snapshots: [...others, quoting] }), true, JSON.stringify(others));
});

test("in a case that has read its journal a snapshot's sources are the conversation's own turns and the quotations it is given, and nothing else, whatever its turn gets of the journal", () => {
  const { r, journal, quoting } = readCase();
  const listed = { confirmed_or_reported_client_outbound: 4, supervisor_only_artifacts: 8, unresolved_delivery: 3 };
  const projection = (...omissions) => ({ confirmed_or_reported_client_outbound: [], supervisor_only_artifacts: [], unresolved_delivery: [], omitted: { ...listed, source_items: [{ reason: "unresolved_report_locator", count: 1 }, ...omissions] } });
  // Twelve sources that aren't turns of the conversation: seven unsent drafts, three reports (one of a turn), two supervisor inputs.
  const all = [{ reason: "journal_case_conversation_alone", count: 12 }], withLineage = [{ reason: "reviewed_lineage_draft", count: 2 }, { reason: "journal_case_conversation_alone", count: 10 }];
  for (const owner of [evidenceInput().owner, { kind: "supervisor_draft", operation_key: "a".repeat(24) }]) {
    for (const part of [null, NO_MATCH, WITHHELD, FAILED, { availability: "not_authorized" }]) {
      const snapshot = freezeCase(r, { owner, journal: part });
      assert.deepEqual([sourceIds(snapshot), snapshot.communication_projection], [CONVERSATION, projection(...all)], JSON.stringify(part));
      assert.deepEqual([snapshotOfConversationAlone(snapshot), held(r, snapshot)], [true, []]);
    }
    const again = freezeCase(r, { owner, journal });
    assert.deepEqual([sourceIds(again), again.communication_projection, held(r, again)], [["src:journal:1", ...CONVERSATION].sort(), projection(...all), []], "with a quotation of its own");
    assert.equal(snapshotOfConversationAlone(again), false);
  }
  assert.deepEqual(freezeCase(r, { lineageRootId: "reviewed" }).communication_projection, projection(...withLineage));
  // The first snapshot that is given one is no different: nothing of it was read before.
  assert.deepEqual([sourceIds(quoting), quoting.communication_projection, held(r, quoting)], [["src:journal:1", ...CONVERSATION].sort(), projection(...all), []]);
  // What was sent stays a source as what it is, and the same case without its journal holds all of it.
  assert.equal(quoting.source_items.find((item) => item.id === "src:turn:turn:sent").kind, "app_committed_client_outbound");
  const before = freezeCase(asIfNoJournalWasRead(r));
  assert.deepEqual([sourceIds(before).length, held(r, before)], [CONVERSATION.length + 12, [...WRITTEN_WORDS]]);
  // A quotation whose publication changed before the freeze isn't one that it was given.
  const changed = { ...asIfNoJournalWasRead(r), journal_corpora: [{ ...r.journal_corpora[0], manifest_object_id: "manifest:other" }] };
  assert.equal(sourceIds(freezeCase(changed, { journal })).length, CONVERSATION.length + 12);
});

test("a case that has read no journal gets what main 86c6d3971 builds, byte for byte: every source, list and omission, whatever its turn gets of a journal and whoever asks", () => {
  // Taken from main 86c6d3971's own code (`git archive 86c6d3971`, with tests/helpers/evidence-case.mjs): what it builds of the same case.
  const r = evidenceCase();
  const built = buildResponseEvidenceSourceItems(r, { inbound: evidenceInput().inbound, lineageRootId: "reviewed" });
  assert.deepEqual(built.source_items.map((item) => [item.id, item.kind]), [
    ["src:report:event:owner", "owner_reported_client_outbound"], ["src:report:event:agent", "agent_relayed_report"], ["src:report:event:pair", "owner_reported_client_outbound"],
    ["src:turn:turn:first", "exact_client_turn"], ["src:turn:turn:sent", "app_committed_client_outbound"], ["src:turn:turn:second", "exact_client_turn"], ["src:turn:turn:reported", "unattributed_assistant_turn"],
    ["src:turn:turn:third", "exact_client_turn"], ["src:turn:turn:loose", "unattributed_assistant_turn"],
    ["src:draft:stopped:v2", "unsent_draft"], ["src:draft:repaired:v3", "unsent_draft"], ["src:draft:exported:v4", "unsent_draft"], ["src:draft:ambiguous:v7", "unsent_draft"], ["src:draft:withdrawn:v8", "unsent_draft"],
    ["src:input:input:message", "relayed_client_message"], ["src:input:input:revision", "supervisor_instruction"], ["src:turn:inbound", "exact_client_turn"]
  ]);
  const { omitted, ...lists } = built.communication_projection;
  assert.deepEqual(Object.entries(lists).map(([name, entries]) => [name, entries.map((entry) => [entry.state, entry.subject.candidate_id ?? entry.subject.kind, entry.source.source_ref])]), [
    ["confirmed_or_reported_client_outbound", [["app_committed", "sent", null], ["reported_sent", "owner-reported", "silver-lantern-owner"], ["reported_sent", "agent-reported", "silver-lantern-agent"], ["reported_sent", "transcript_turn", "silver-lantern-pair"]]],
    ["supervisor_only_artifacts", [["draft", "stopped", null], ["draft", "repaired", null], ["exported", "exported", "silver-lantern-export"], ["draft", "ambiguous", null], ["draft", "withdrawn", null], ["draft", "reviewed", null], ["draft", "reviewed-again", null], ["exported", "companion", "silver-lantern-companion"]]],
    ["unresolved_delivery", [["unknown", "marked-sent", null], ["reported_sent", "unresolved", "silver-lantern-ambiguous"], ["unknown", "unattributed_assistant_turns", null]]]
  ]);
  assert.deepEqual(omitted, { confirmed_or_reported_client_outbound: 0, supervisor_only_artifacts: 0, unresolved_delivery: 0, source_items: [{ reason: "unresolved_report_locator", count: 1 }, { reason: "reviewed_lineage_draft", count: 2 }] });
  assert.equal(digest(built), "9949d2b91562943a416d9fc1a94a70495bdfdfef9abf052396bc3199b6842051");
  const supervisor = { owner: { kind: "supervisor_draft", operation_key: "a".repeat(24) }, candidateOrigin: "external_draft", lineageRootId: "reviewed", journal: { availability: "not_configured" },
    historyRequirements: [{ id: "history:one", topic: "Asking for help.", why_material: "The answer changes the advice.", source_ids: ["src:turn:turn:first"], disposition: "answered_by_sources" }] };
  // The snapshot's bytes, and its model view's digest.
  for (const [name, extra, bytes, view] of [
    ["a turn", {}, "a54178089e398c55851245868109bf0def973b7288e662d3d5aa99501dacd22b", "d80dae2732bd846b9ac1885f99de6ec8c9a0e84aaff6106931fbfe2d54581739"],
    ["a repair", { lineageRootId: "reviewed" }, "42e0c29461f97959ef4752b952e6835fb55f2854dfaaf1e1fee2e330f57bdc0c", "f21462f7d93e5dfd88cd46c39be47d6359085386a3f666b7ba48118bbfa78fd9"],
    ["a turn that gets no journal", { journal: WITHHELD }, "8cdd9c09ed37200edfb2b2f1cc1f9e2363d24e5e3b3cdf5e84512aec979b66d6", "efd3b67c8a8bd215863a72ecbcbdb34caa9e031363b6b2f06f797b2015236409"],
    ["a search that found nothing", { journal: NO_MATCH }, "d3d1dab1121a692630173950caad469d9d38552ff714be15da40086754c1213b", "d2eb05481144177d609b2a58e54736023063ada8403f08f5948b694f82a79b1b"],
    ["a supervisor's draft", supervisor, "6ff24352c2d33eec06300a1436b8e6a7a05c600bbb5d4e466f500192edaf2137", "bcb43276b5a2d55bbd0b00806e590a47bc39cd2efca1be60401af8d16b8a25fa"]
  ]) {
    const snapshot = freezeCase(r, extra);
    assert.deepEqual([digest(snapshot), buildEvidenceModelView(r, snapshot).view_sha256], [bytes, view], name);
    assert.equal(snapshotOfConversationAlone(snapshot), false, name);
  }
  // Nor does a stored snapshot that holds no quotation change anything.
  assert.equal(digest(freezeCase({ ...r, response_evidence_snapshots: [freezeCase(r), freezeCase(r, { journal: FAILED })] })), "a54178089e398c55851245868109bf0def973b7288e662d3d5aa99501dacd22b");
});

test("a snapshot is of the conversation alone when its sources are its turns and the retrieval record and it lists and requires nothing; any other source or entry, or a part that is missing, makes it not", () => {
  const { r, quoting } = readCase(), alone = freezeCase(r, { journal: WITHHELD }), full = freezeCase(asIfNoJournalWasRead(r));
  assert.equal(snapshotOfConversationAlone(alone), true);
  const kinds = new Set(["owner_reported_client_outbound", "agent_relayed_report", "unsent_draft", "relayed_client_message", "supervisor_instruction", "journal_quotation"]);
  const others = [...full.source_items, ...quoting.source_items].filter((item) => !sourceIds(alone).includes(item.id));
  assert.deepEqual(new Set(others.map((item) => item.kind)), kinds);
  for (const item of others) assert.equal(snapshotOfConversationAlone({ ...alone, source_items: [...alone.source_items, item] }), false, item.id);
  const { communication_projection: projection } = alone, lists = Object.keys(projection).filter((name) => name !== "omitted");
  for (const name of lists) for (const list of [full.communication_projection[name].slice(0, 1), null, {}, undefined]) {
    assert.equal(snapshotOfConversationAlone({ ...alone, communication_projection: { ...projection, [name]: list } }), false, `${name} ${JSON.stringify(list)}`);
  }
  for (const history_requirements of [[{ id: "history:one", topic: "Asking for help.", why_material: "It matters.", source_ids: [], disposition: "open" }], null, {}, undefined]) assert.equal(snapshotOfConversationAlone({ ...alone, history_requirements }), false);
  const [said] = alone.source_items.filter((item) => item.kind === "exact_client_turn");
  for (const item of [null, undefined, {}, "src:turn:turn:first", { ...said, kind: undefined }, { ...said, locator: undefined }, { ...said, locator: { kind: "candidate", candidate_id: "stopped", candidate_version: 2 } }, { ...said, kind: "agent_relayed_report" }]) {
    assert.equal(snapshotOfConversationAlone({ ...alone, source_items: [item] }), false, JSON.stringify(item));
  }
  for (const missing of [undefined, null, {}, [], "snapshot", { ...alone, source_items: undefined }, { ...alone, source_items: {} }, { ...alone, communication_projection: undefined }, { ...alone, communication_projection: null }]) assert.equal(snapshotOfConversationAlone(missing), false);
});

test("a draft is written from the conversation alone when its snapshot is and the draft it was written from was, or was hidden from it; evidence that isn't there says it wasn't", () => {
  const { r, quoting } = readCase(), alone = freezeCase(r, { snapshotId: "snapshot:alone" });
  const runtimeTurn = { id: "runtime:one", events: [] };
  const draft = (id, parent, evidence, hidden = false) => {
    r.candidate_responses.push({ id, version: r.candidate_responses.length + 1, root_candidate_id: parent ? "quoting" : id, parent_candidate_id: parent, producer_context_id: `context:${id}`, status: "superseded", exact_text: `The draft ${id}: a silver lantern.`,
      created_at: EVIDENCE_NOW, audit_history: [], metadata: evidence ? { response_evidence: { snapshot_id: evidence } } : {} });
    runtimeTurn.events.push({ event_type: "INVOCATION_COMPLETED", details: { actual_context_id: `context:${id}`, output: { result: hidden ? { draftHidden: true } : {} } } });
    return r.candidate_responses.at(-1);
  };
  draft("quoting", null, quoting.id);
  // As an earlier build froze it, when nothing was left out: with the draft that quotes the journal among its sources.
  const older = freezeCase(asIfNoJournalWasRead(r), { snapshotId: "snapshot:older" });
  assert.ok(older.source_items.some((item) => item.locator.candidate_id === "quoting"));
  r.response_evidence_snapshots.push(alone, older);
  for (const [id, parent, evidence, hidden, expected] of [
    ["plain", null, alone.id, false, true], ["from-plain", "plain", alone.id, false, true], ["from-it", "quoting", alone.id, false, false], ["from-from-it", "from-it", alone.id, false, false],
    ["anew", "quoting", alone.id, true, true], ["from-anew", "anew", alone.id, false, true], ["anew-with-one", "quoting", quoting.id, true, false],
    // Its own evidence holds no quotation, but a draft that does.
    ["from-an-older-snapshot", null, older.id, false, false], ["from-that", "from-an-older-snapshot", alone.id, false, false], ["anew-from-that", "from-an-older-snapshot", alone.id, true, true],
    ["unbound", null, null, false, false], ["from-unbound", "unbound", alone.id, false, false], ["bound-to-nothing", null, "snapshot:gone", false, false], ["of-a-lost-parent", "candidate:gone", alone.id, false, false]
  ]) assert.equal(writtenFromConversationAlone(r, runtimeTurn, draft(id, parent, evidence, hidden)), expected, id);
  assert.equal(writtenFromConversationAlone(r, runtimeTurn, null), false);
  // And none of them, nor anything that was reported or listed of them, is in a later snapshot.
  for (const journal of [WITHHELD, NO_MATCH]) assert.deepEqual([sourceIds(freezeCase(r, { journal })), held(r, freezeCase(r, { journal }))], [CONVERSATION, []]);
});

test("a record from before any of this neither throws nor is misjudged: snapshots without sources, candidates without roots, metadata or producers, turns without events", () => {
  const legacy = [null, {}, { id: "snapshot:legacy" }, { id: "snapshot:legacy", source_items: null }, { id: "snapshot:legacy", source_items: [null, {}] }];
  const r = evidenceCase();
  for (const candidate of r.candidate_responses.filter((entry) => entry.status !== "sent")) for (const field of ["root_candidate_id", "metadata", "producer_context_id"]) delete candidate[field];
  // Without a journal, what main 86c6d3971 builds of it (taken from its code, as above); it ignores the snapshots, whatever they are.
  for (const response_evidence_snapshots of [undefined, legacy]) assert.equal(digest(freezeCase({ ...r, response_evidence_snapshots }, { lineageRootId: "reviewed" })), "f8741d137e83ff6404f7581097fe7fb5ec4b59e953c2a252e28e10ef0b90cb42");
  // With one among them that holds a quotation, it is a case that has read its journal, and nothing in it is known to be of the conversation alone.
  const { r: { journal_corpora }, quoting } = readCase(), read = { ...r, journal_corpora, response_evidence_snapshots: [...legacy, quoting] };
  const snapshot = freezeCase(read, { lineageRootId: "reviewed" });
  assert.deepEqual([sourceIds(snapshot), held(read, snapshot), snapshotOfConversationAlone(snapshot)], [CONVERSATION, [], true]);
  const turns = [undefined, {}, { events: null }, { events: [] }, { events: [{ event_type: "INVOCATION_COMPLETED" }, { event_type: "INVOCATION_COMPLETED", details: {} }] }];
  for (const candidate of read.candidate_responses) for (const runtimeTurn of turns) assert.equal(writtenFromConversationAlone(read, runtimeTurn, candidate), false, candidate.id);
  // Nor a draft bound to a snapshot of the conversation alone, when what it was written from isn't known to be, or isn't there.
  const repaired = { ...read.candidate_responses.find((entry) => entry.id === "repaired"), metadata: { response_evidence: { snapshot_id: snapshot.id } } };
  for (const runtimeTurn of turns) for (const candidate_responses of [read.candidate_responses, [], undefined, null, {}]) {
    assert.equal(writtenFromConversationAlone({ candidate_responses, response_evidence_snapshots: [...legacy, snapshot] }, runtimeTurn, repaired), false);
  }
  for (const response_evidence_snapshots of [undefined, null, {}, legacy]) assert.equal(writtenFromConversationAlone({ ...read, response_evidence_snapshots }, undefined, { ...repaired, parent_candidate_id: null }), false);
});

test("the public schema takes a snapshot with a journal note, and refuses one the contract refuses", async () => {
  const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(JSON.parse(await fs.readFile(new URL("../schemas/private-case/response-evidence-snapshot-v1.schema.json", import.meta.url), "utf8")));
  const { snapshot } = freezeJournal(journalNote());
  assert.equal(validate(snapshot), true, JSON.stringify(validate.errors));
  assert.equal(validate(freezeJournal(undefined).snapshot), true);
  for (const change of [(note) => { note.lifecycle = "revoked"; }, (note) => { note.extra = true; }, (note) => { note.written.from = "March 2019"; }, (note) => { delete note.cues; }]) {
    const changed = structuredClone(snapshot);
    change(changed.source_items.find((item) => item.kind === "journal_quotation").journal_note);
    assert.equal(validate(changed), false);
  }
});
