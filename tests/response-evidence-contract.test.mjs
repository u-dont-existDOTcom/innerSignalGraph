import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createTranscriptCompletionAmendment } from "../src/storage/transcript-amendments.mjs";
import { chunkExactSourceText, createExactSourceArtifact } from "../src/storage/exact-source-artifact.mjs";
import {
  RESPONSE_EVIDENCE_DIMENSIONS, buildResponseEvidenceSnapshot, buildEvidenceModelView,
  computeEvidenceDependencyBinding, normalizeEvidenceReview, deriveEvidenceFindings,
  responseEvidenceSnapshotSha256, sha256Json, sha256Text, validateResponseEvidenceSnapshot
} from "../src/supervisor/response-evidence-contract.mjs";

const NOW = "2026-11-23T12:00:00.000Z";
const turn = (id, role = "user", text = "Synthetic exact words.") => ({ id, role, text, at: NOW, exchange_id: id, episode_id: null });
const record = () => ({ case_id: "synthetic-evidence", raw_transcript: [turn("older")], transcript_amendments: [], source_artifacts: [], candidate_responses: [], supervisor_artifacts: [], communication_events: [], journal_corpora: [], case_state: createEmptyCaseState({ caseId: "synthetic-evidence" }), runtime_turns: [{ id: "runtime:one", user_turn_id: "inbound", inbound: { exact_text: "Current words.", received_at: NOW } }] });
const input = () => ({ snapshotId: "snapshot:one", owner: { kind: "runtime_turn", runtime_turn_id: "runtime:one" }, inbound: { turn_id: "inbound", exact_text_sha256: sha256Text("Current words."), audience: "client", source_kind: "exact_client_turn" } });
const freeze = (r = record()) => buildResponseEvidenceSnapshot(r, input(), { createdAt: NOW });
const coverage = () => RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." }));
const review = () => ({ coverage: coverage(), items: [{ id: "claim", dimension: "personal_history", kind: "claim", candidate_quote: "é🙂", source_ids: ["src:turn:older"], assessment: "supported", reason: "Synthetic source." }], missing_material_history: [] });
const malformed = (fn) => assert.throws(fn, { name: "ValidationError", code: "RESPONSE_EVIDENCE_INVALID" });

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
  const r = record(), options = { inboundTurnId: "inbound", inboundSha256: sha256Text("Current words."), lineageRootId: "root" };
  const original = computeEvidenceDependencyBinding(r, options);
  r.raw_transcript.push(turn("inbound", "user", "Current words."));
  r.runtime_turns[0].events = [{ arbitrary: "audit bookkeeping" }];
  r.updated_at = "2026-11-24"; r.revision = 9;
  r.candidate_responses.push({ id: "root", root_candidate_id: "root", audit_history: [{ id: "audit" }] });
  r.communication_events.push({ id: "own", kind: "exported", subject: { kind: "candidate", candidate_id: "root" } });
  assert.deepEqual(computeEvidenceDependencyBinding(r, options), original);
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
  ].map(([id, code]) => ({ id: `evidence:${id}`, code: `RESPONSE_EVIDENCE_${code}`, severity: "substantive", summary: "Response evidence requires repair.", unresolved: true })));
});

test("source selection includes old referenced turns and records whole-item omissions", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 240 }, (_, n) => turn(`turn:${n}`));
  r.case_state.items = r.raw_transcript.map((entry) => ({ id: entry.id, source: { turn_id: entry.id } }));
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.length, 200);
  assert.ok(snapshot.communication_projection.omitted.source_items.length);
  assert.ok(snapshot.source_items.some((entry) => entry.locator.turn_id === "turn:42"));
  assert.ok(snapshot.source_items.every((entry) => entry.exact_excerpt === null));
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


test("the shared source-item cap omits the oldest item across source kinds", () => {
  const r = record(); r.raw_transcript = Array.from({ length: 200 }, (_, n) => turn(`turn:${n}`));
  r.case_state.items = r.raw_transcript.map((entry) => ({ id: entry.id, statement: "A model proposal is not a source.", source: { turn_id: entry.id } }));
  r.candidate_responses.push({ id: "old-draft", version: 1, root_candidate_id: "old-draft", status: "pending_audit", exact_text: "Older unsent draft.", created_at: "2020-01-01T00:00:00.000Z", metadata: {}, audit_history: [] });
  const snapshot = freeze(r);
  assert.equal(snapshot.source_items.length, 200);
  assert.equal(snapshot.source_items.some((item) => item.id === "src:draft:old-draft:v1"), false);
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
