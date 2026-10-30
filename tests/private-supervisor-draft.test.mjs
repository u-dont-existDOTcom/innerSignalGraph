import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { projectCommunicationState } from "../src/storage/private-case-communication.mjs";
import { assessSupervisorArtifact } from "../src/storage/private-case-supervisor.mjs";
import { createEncryptedPrivateCaseStore, validatePrivateCaseRecord } from "../src/storage/private-case-store.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, createCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createPrivateSupervisorDraftService } from "../src/supervisor/private-supervisor-draft.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";

// Synthetic data only. These tests exercise the controlled supervisor draft and export operations at the seam the application
// uses: the real encrypted store (and, where noted, the real access service), a scripted model runtime in place of a provider.

const CASE_ID = "synthetic-supervisor-case";
const START = Date.parse("2026-10-01T12:00:00.000Z");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const OWNER = { channel: "owner_ui", authContext: {} };
const AGENT = { channel: "authenticated_agent", authContext: {} };

const turn = (exchange, role, text, day) => ({
  id: `${exchange}-${role}`,
  exchange_id: exchange,
  role,
  text,
  at: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  episode_id: "episode:synthetic"
});

function scriptedRuntime({ verdicts = ["pass"], produced = "Synthetic backend reply.\n\nWhich signal changed first?" } = {}) {
  const calls = [];
  let audits = 0;
  let repairs = 0;
  return {
    calls,
    async produceCandidate({ runtimeTurn, attemptContextId, inboundAlreadyRecorded }) {
      calls.push({ role: "produce", attemptContextId, inboundAlreadyRecorded, inbound: structuredClone(runtimeTurn.inbound), userTurnId: runtimeTurn.user_turn_id });
      return { exactText: produced, contextId: "context:producer:backend" };
    },
    async auditCandidate({ candidate, attemptContextId }) {
      calls.push({ role: "audit", candidateId: candidate.id, attemptContextId });
      const verdict = verdicts[audits] ?? verdicts.at(-1);
      audits += 1;
      return {
        contextId: `context:auditor:${candidate.id}`,
        value: {
          findings: verdict === "pass" ? [] : [{ id: `finding:${candidate.id}`, code: "SYNTHETIC_UNCERTAINTY", severity: "substantive", summary: "Synthetic repair is required." }],
          repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS]
        },
        disclosureManifest: { exact_candidate_included: true, producer_hidden_reasoning_included: false, tools_available: false }
      };
    },
    async repairCandidate({ candidate, attemptContextId }) {
      repairs += 1;
      calls.push({ role: "repair", parentId: candidate.id, attemptContextId });
      return { exactText: `Synthetic repaired reply ${repairs}.`, contextId: `context:repair:${repairs}` };
    }
  };
}

// A case with one answered exchange and one client message still waiting for a reply.
async function makeEnvironment(t, { verdicts, produced } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-supervisor-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(START + (tick += 1) * 1000).toISOString();
  const open = () => createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 41),
    recoverySecretBytes: Buffer.alloc(32, 42),
    developmentExternalCredentialAuthorized: true,
    now
  });
  const store = open();
  t.after(() => store.close());
  await store.appendTranscriptTurn(CASE_ID, turn("E1", "user", "Synthetic earlier client message.", 1));
  await store.appendTranscriptTurn(CASE_ID, turn("E1", "assistant", "Synthetic earlier reply.", 1));
  await store.appendTranscriptTurn(CASE_ID, turn("E2", "user", "Synthetic newest client message waiting for a reply.", 2));
  const runtime = scriptedRuntime({ verdicts, produced });
  const service = createPrivateSupervisorDraftService({ privateCaseSource: store, modelRuntime: runtime });
  return { store, service, runtime, rootDir, now, open };
}

const submitExternal = (service, text, extra = {}, who = OWNER) => service.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text, ...who, ...extra });
const exportArtifact = (service, artifactId, who = OWNER) => service.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, ...who });
const reportSent = (service, input = {}, who = OWNER) => service.recordReportedDelivery({ caseId: CASE_ID, ...input, ...who });
const refusal = (code) => (error) => error?.code === code;

test("an external draft with no host attestation is stored byte for byte as not_attested and admitted when the independent audit passes", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t);
  const prepared = await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER });
  assert.equal(prepared.latest_client_turn.text, "Synthetic newest client message waiting for a reply.");
  assert.equal(prepared.review_scope.owner_inputs_in_audit_packet, false);
  assert.equal(prepared.review_scope.translation_meaning, "unreviewed");

  const text = "  Hola — ¿qué señal cambió primero?\r\n\r\nSin prisa.  ";
  const result = await submitExternal(service, text, { basisSha256: prepared.basis.sha256, idempotencyKey: "submit-external-1" });
  assert.equal(result.status, "approved");
  assert.equal(result.exportable, true);
  assert.equal(result.replayed, false);
  assert.equal(JSON.stringify(result).includes("Sin prisa"), false, "the review result never carries the client text");

  const record = await store.load(CASE_ID);
  const candidate = record.candidate_responses.at(-1);
  assert.equal(candidate.exact_text, text, "stored byte for byte, with no rewrite for provenance");
  assert.equal(candidate.status, "approved_for_delivery");
  assert.equal(candidate.metadata.supervisor_draft.source, "external_draft");
  assert.deepEqual(candidate.metadata.supervisor_draft.exposure, { exact_bytes: "received_and_stored", original_writer: "not_attested", auditor_inputs: "case_record_only" });
  assert.equal(result.artifact.exposure.original_writer, "not_attested");
  const audit = candidate.audit_history.at(-1);
  assert.equal(audit.verdict, "pass");
  assert.equal(audit.independent, true);
  assert.notEqual(audit.auditor_context_id, candidate.producer_context_id, "the writer's context never audits its own text");
  assert.equal(audit.candidate_sha256, sha256(text));
  assert.deepEqual(runtime.calls.map((call) => call.role), ["audit"], "no model wrote or rewrote the external text");
  const receipt = record.supervisor_artifacts.find((entry) => entry.kind === "review_receipt");
  assert.equal(receipt.audit_id, audit.id);
  assert.equal(receipt.disclosure_manifest.producer_hidden_reasoning_included, false);
});

test("a backend-produced draft uses the existing runtime on the latest client message and records the runtime's own receipts without advancing the case", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t, { produced: "Backend wrote this exact reply.\n\nWhat did you notice?" });
  const before = await store.load(CASE_ID);
  const result = await service.submitCandidateForReview({ caseId: CASE_ID, source: "backend_produced", idempotencyKey: "submit-backend-1", ...OWNER });
  assert.equal(result.status, "approved");
  const produce = runtime.calls.find((call) => call.role === "produce");
  assert.equal(produce.inboundAlreadyRecorded, true);
  assert.deepEqual(produce.inbound, { exact_text: "Synthetic newest client message waiting for a reply.", received_at: "2026-09-02T12:00:00.000Z" });
  assert.equal(produce.userTurnId, "E2-user");

  const record = await store.load(CASE_ID);
  const candidate = record.candidate_responses.at(-1);
  assert.equal(candidate.exact_text, "Backend wrote this exact reply.\n\nWhat did you notice?");
  assert.equal(candidate.metadata.supervisor_draft.source, "backend_produced");
  assert.equal(candidate.metadata.supervisor_draft.exposure.original_writer, "backend_inclusion_receipts");
  assert.equal(candidate.metadata.producer_attempt_context_id, produce.attemptContextId);
  assert.equal(candidate.metadata.journal_evidence_sha256, null);
  assert.notEqual(candidate.audit_history.at(-1).auditor_context_id, candidate.producer_context_id);
  assert.deepEqual(record.raw_transcript, before.raw_transcript, "producing a draft appends no turn");
  assert.deepEqual(record.case_state, before.case_state, "an export-only draft does not advance the case state");
  assert.equal(record.runtime_turns.length, before.runtime_turns.length);
});

test("a draft that fails its audit is repaired within the existing two cycles and the repaired bytes are what is approved", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t, { verdicts: ["fail", "pass"] });
  const result = await submitExternal(service, "Synthetic first draft that needs work.", { idempotencyKey: "repair-1" });
  assert.equal(result.status, "approved");
  assert.deepEqual(runtime.calls.map((call) => call.role), ["audit", "repair", "audit"]);
  const record = await store.load(CASE_ID);
  const [original, repaired] = record.candidate_responses;
  assert.deepEqual([original.status, repaired.status], ["superseded", "approved_for_delivery"]);
  assert.equal(repaired.exact_text, "Synthetic repaired reply 1.");
  assert.equal(repaired.parent_candidate_id, original.id);
  assert.equal(repaired.metadata.supervisor_draft.source, "backend_repair");
  assert.equal(repaired.metadata.supervisor_draft.root_source, "external_draft");
  assert.equal(repaired.metadata.supervisor_draft.basis_sha256, original.metadata.supervisor_draft.basis_sha256, "a repair inherits the basis of the draft it repairs");
  assert.notEqual(repaired.producer_context_id, original.producer_context_id);

  const exported = await exportArtifact(service, result.artifact.artifact_id);
  assert.equal(exported.client_text, "Synthetic repaired reply 1.", "the original external bytes were never approved");
  assert.equal(exported.candidate_id, repaired.id);
});

test("the repair limit ends the review blocked and nothing is exportable", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t, { verdicts: ["fail"] });
  const result = await submitExternal(service, "Synthetic draft that never passes.", { idempotencyKey: "blocked-1" });
  assert.equal(result.status, "blocked");
  assert.equal(result.exportable, false);
  assert.deepEqual(runtime.calls.map((call) => call.role), ["audit", "repair", "audit", "repair", "audit"], "two repair cycles, as for any candidate");
  const record = await store.load(CASE_ID);
  const head = record.candidate_responses.at(-1);
  assert.equal(head.status, "audit_failed");
  assert.equal(head.repair_cycle, 2);
  await assert.rejects(() => exportArtifact(service, result.artifact.artifact_id), refusal("SUPERVISOR_ARTIFACT_NOT_APPROVED"));
  assert.equal((await store.load(CASE_ID)).communication_events.length, 0, "a refused export records nothing");

  const again = await submitExternal(service, "Synthetic draft that never passes.", { idempotencyKey: "blocked-1" });
  assert.equal(again.status, "blocked");
  assert.equal(again.replayed, true);
  assert.equal(runtime.calls.length, 5, "a replay of a blocked review makes no further model calls");
});

test("export returns exactly the approved bytes, is recorded as exported and is never counted as sent", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const text = "Exact approved client text.\n\n  Keep   these   spaces.\n";
  const submitted = await submitExternal(service, text, { idempotencyKey: "export-1" });
  const exported = await exportArtifact(service, submitted.artifact.artifact_id);
  assert.equal(exported.client_text, text);
  assert.equal(exported.client_text_sha256, sha256(text));
  assert.equal(exported.sent_status, "not_sent");
  assert.deepEqual(exported.checks, {
    bytes_match_audited_candidate: true,
    audit_passed: true,
    approved_for_delivery: true,
    current_candidate: true,
    case_unchanged_since_draft: true
  });
  assert.equal(exported.artifact.delivery.exported.origin, "application");
  assert.equal(exported.artifact.delivery.reported_sent, null);
  assert.equal(exported.artifact.delivery.transport_or_recipient_acknowledged, false);

  const record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => [event.kind, event.audience, event.subject.kind]), [["exported", "client", "candidate"]]);
  assert.equal(record.candidate_responses.at(-1).status, "approved_for_delivery", "exporting does not mark the candidate sent");
  const snapshot = await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER });
  assert.deepEqual(snapshot.communication.confirmed_or_reported_client_outbound, [], "an export is not a send");
  assert.equal(snapshot.communication.supervisor_only_artifacts.some((entry) => entry.state === "exported"), true);
});

test("an English companion is bound to the exact client bytes, supervisor-only and unreviewed, and can never be marked client-sent", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const client = "Hola, ¿qué cambió primero?";
  const english = "Hello, what changed first?";
  const submitted = await submitExternal(service, client, { companion: { language: "en", text: english }, idempotencyKey: "companion-1" });
  assert.equal(submitted.status, "approved");
  assert.deepEqual(
    { ...submitted.artifact.companion, companion_id: "x", supplied_by: null },
    {
      companion_id: "x",
      language: "en",
      text_sha256: sha256(english),
      audience: "supervisor",
      client_send_allowed: false,
      meaning_review: { status: "unreviewed", reason: "no existing auditor reviews translation meaning" },
      supplied_by: null
    }
  );
  assert.equal(JSON.stringify(submitted).includes(english), false, "listings never carry companion text");

  const exported = await exportArtifact(service, submitted.artifact.artifact_id);
  assert.equal(exported.client_text, client);
  assert.equal(exported.companion.text, english);
  assert.equal(exported.companion.audience, "supervisor");
  assert.equal(exported.companion.client_send_allowed, false);
  assert.equal(exported.companion.meaning_review.status, "unreviewed");

  let record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => [event.kind, event.audience, event.subject.kind]), [["exported", "client", "candidate"], ["exported", "supervisor", "companion"]]);
  let snapshot = await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER });
  assert.deepEqual(snapshot.communication.confirmed_or_reported_client_outbound, []);
  assert.deepEqual(snapshot.communication.supervisor_only_artifacts.filter((entry) => entry.subject.kind === "companion").map((entry) => [entry.audience, entry.state, entry.delivery_evidence]), [["supervisor", "exported", "none"]]);

  // The controlled report names the client bytes only, and the record refuses a client send of the companion.
  await reportSent(service, { artifactId: submitted.artifact.artifact_id, idempotencyKey: "companion-report-1" });
  record = await store.load(CASE_ID);
  const reported = record.communication_events.filter((event) => event.kind === "reported_sent");
  assert.deepEqual(reported.map((event) => [event.audience, event.subject.kind]), [["client", "candidate"]]);
  const companionSubject = { kind: "companion", companionOf: { candidateId: record.candidate_responses.at(-1).id, candidateVersion: record.candidate_responses.at(-1).version }, artifactSha256: sha256(english) };
  await assert.rejects(
    () => store.recordCommunicationEvent(CASE_ID, { eventId: "evt:bad:companion", kind: "reported_sent", audience: "client", subject: companionSubject, provenance: { origin: "owner_action", sourceRef: null, quote: null } }),
    /not valid for a reported_sent event/
  );
  await assert.rejects(() => reportSent(service, { artifactId: `art_${"0".repeat(40)}`, idempotencyKey: "companion-report-2" }), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  snapshot = await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER });
  assert.deepEqual(snapshot.communication.confirmed_or_reported_client_outbound.map((entry) => entry.subject.kind), ["candidate"]);
});

test("a changed client-language text is new bytes that need their own audit, take no companion and inherit no approval", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t, { verdicts: ["pass", "fail"] });
  const first = await submitExternal(service, "Approved client text.", { companion: { language: "en", text: "Approved English." }, idempotencyKey: "edit-1" });
  assert.equal(first.status, "approved");
  const edited = await submitExternal(service, "Approved client text. ", { idempotencyKey: "edit-2" });
  assert.equal(edited.status, "blocked", "the edited bytes were audited on their own and failed");
  assert.notEqual(edited.artifact.artifact_id, first.artifact.artifact_id);
  assert.equal(edited.artifact.companion, null, "the earlier companion is bound to the earlier bytes only");
  assert.equal(runtime.calls.filter((call) => call.role === "audit").length, 4, "one audit for the first text and three for the edit's lineage");

  await assert.rejects(() => exportArtifact(service, first.artifact.artifact_id), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && error.details.reasons.includes("superseded_by_newer_draft"));
  await assert.rejects(() => exportArtifact(service, edited.artifact.artifact_id), refusal("SUPERVISOR_ARTIFACT_NOT_APPROVED"));
  assert.deepEqual((await store.load(CASE_ID)).communication_events, [], "neither refusal recorded an export");
});

test("the export takes an artifact id and nothing else, so no caller can attach other bytes to an approval", async (t) => {
  const { service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "The approved bytes.", { idempotencyKey: "bytes-1" });
  const exported = await service.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId: submitted.artifact.artifact_id, text: "Substituted bytes.", exactText: "Substituted bytes.", ...OWNER });
  assert.equal(exported.client_text, "The approved bytes.");
  await assert.rejects(() => exportArtifact(service, "candidate:supervisor:abc:v1"), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  await assert.rejects(() => exportArtifact(service, undefined), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  await assert.rejects(() => exportArtifact(service, submitted.artifact.artifact_id.toUpperCase()), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
});

// What makes an approved draft unsafe to hand over, under the invalidation rules the case already has. Each case changes the
// case after approval and expects the export to refuse as stale with the named reason, and to record nothing.
const STALENESS = [
  ["a newer client message", "newer_client_message", (store) => store.appendTranscriptTurn(CASE_ID, turn("E3", "user", "Synthetic newer client message.", 3))],
  ["another transcript turn", "transcript_changed", (store) => store.appendTranscriptTurn(CASE_ID, turn("E2", "assistant", "Synthetic reply appended elsewhere.", 2))],
  ["a transcript correction", "transcript_corrected", (store) => store.appendTranscriptCompletionAmendment(CASE_ID, {
    amendmentId: "amend:synthetic:1",
    targetTurnId: "E2-user",
    completionText: " More synthetic words.",
    sourceArtifactId: "source:synthetic:completion",
    sourceMetadata: {},
    producerContextId: "context:synthetic"
  })],
  ["a changed protective compatibility state", "protective_compatibility_changed", (store) => store.saveCaseState(CASE_ID, applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    protective_compatibility: {
      version: 1,
      current: {
        gate: "HOLD",
        route: "clarify_intent",
        issue: "Synthetic unresolved issue.",
        reason: "Synthetic hold.",
        evidence_observation_ids: [],
        reentry_status: "review_required",
        human_review_required: false,
        assessed_turn_id: "E2-user",
        assessed_at: "2026-09-02T12:00:00.000Z"
      },
      history: []
    }
  }))],
  ["a delivery correction about another message", "delivery_state_changed", (store) => store.recordCommunicationEvent(CASE_ID, {
    eventId: "comm:owner:e1",
    kind: "reported_sent",
    audience: "client",
    subject: { kind: "transcript_turn", assistantTurnId: "E1-assistant", inReplyToTurnId: "E1-user" },
    provenance: { origin: "owner_action", sourceRef: "message:synthetic:owner", quote: null }
  })],
  ["a new owner input", "owner_input_added", (store, service) => service.prepareResponseContext({
    caseId: CASE_ID,
    inputs: [{ type: "client_message", text: "Synthetic message the owner relayed after drafting.", idempotencyKey: "late-input" }],
    ...OWNER
  })]
];

for (const [name, reason, change] of STALENESS) {
  test(`a draft approved before ${name} can no longer be exported`, async (t) => {
    const { store, service } = await makeEnvironment(t);
    const submitted = await submitExternal(service, `Draft written before ${name}.`, { idempotencyKey: `stale-${reason}` });
    assert.equal(submitted.exportable, true);
    await change(store, service);
    const view = (await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER })).artifacts.find((artifact) => artifact.artifact_id === submitted.artifact.artifact_id);
    assert.equal(view.exportable, false);
    assert.equal(view.fresh, false);
    assert.deepEqual(view.stale_reasons, [reason]);
    await assert.rejects(
      () => exportArtifact(service, submitted.artifact.artifact_id),
      (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && JSON.stringify(error.details.reasons) === JSON.stringify([reason])
    );
    assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "exported").length, 0, "a refused export records nothing");
  });
}

test("a draft already committed to the transcript, or replaced by a newer draft, is stale and cannot be exported", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const first = await submitExternal(service, "First draft.", { idempotencyKey: "superseded-1" });
  const second = await submitExternal(service, "Second draft.", { idempotencyKey: "superseded-2" });
  await assert.rejects(() => exportArtifact(service, first.artifact.artifact_id), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && error.details.reasons.includes("superseded_by_newer_draft"));
  const record = await store.load(CASE_ID);
  await store.markCandidateSent(CASE_ID, record.candidate_responses.at(-1).id);
  await assert.rejects(() => exportArtifact(service, second.artifact.artifact_id), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && error.details.reasons.includes("already_committed_to_transcript"));
});

test("a draft's own export and report records never make it stale, so a replay still returns the same bytes", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "Draft that is exported, reported and exported again.", { idempotencyKey: "own-records-1" });
  const first = await exportArtifact(service, submitted.artifact.artifact_id);
  await reportSent(service, { artifactId: submitted.artifact.artifact_id, idempotencyKey: "own-records-report" });
  const second = await exportArtifact(service, submitted.artifact.artifact_id);
  assert.equal(second.client_text, first.client_text);
  assert.equal(second.replayed, true);
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "exported").length, 1, "one active export event per artifact");
});

test("an artifact id is an opaque handle that resolves only inside the authorized case and never from another case or forged bytes", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "A draft in the first case.", { idempotencyKey: "bearer-1" });
  const artifactId = submitted.artifact.artifact_id;
  assert.match(artifactId, /^art_[a-f0-9]{40}$/);
  await store.appendTranscriptTurn("synthetic-other-case", turn("O1", "user", "Synthetic message in another case.", 1));
  await assert.rejects(() => service.getApprovedResponseArtifact({ caseId: "synthetic-other-case", artifactId, ...OWNER }), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  await assert.rejects(() => service.getApprovedResponseArtifact({ caseId: "synthetic-missing-case", artifactId, ...OWNER }), refusal("PRIVATE_CASE_NOT_FOUND"));
  const other = await service.submitCandidateForReview({ caseId: "synthetic-other-case", source: "external_draft", text: "A draft in the first case.", idempotencyKey: "bearer-1", ...OWNER });
  assert.notEqual(other.artifact.artifact_id, artifactId, "the same text and key in another case is a different handle");
  assert.equal((await store.load("synthetic-missing-case")), null, "a refused call on a missing case does not create it");
});

test("an owner-reported send is a separate event from the export, verified only on the owner's channel, and the send time stays unknown unless supplied", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "A draft the owner then reports sending.", { idempotencyKey: "report-1" });
  const artifactId = submitted.artifact.artifact_id;
  await exportArtifact(service, artifactId);
  let record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => event.kind), ["exported"]);
  assert.deepEqual((await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER })).communication.confirmed_or_reported_client_outbound, [], "exported text is not sent text");

  // With one exported draft not yet reported, the report needs no artifact id and no second confirmation.
  const reported = await reportSent(service, { idempotencyKey: "report-owner-1", quote: "Synthetic: I sent it just now." });
  assert.equal(reported.event.kind, "reported_sent");
  assert.equal(reported.event.audience, "client");
  assert.deepEqual([reported.event.provenance.origin, reported.event.provenance.actor_resolution], ["owner_action", "owner_verified"]);
  assert.deepEqual([reported.event.sent_at, reported.event.sent_at_status], [null, "unavailable"]);
  assert.equal(reported.artifact.artifact_id, artifactId);
  assert.equal(reported.artifact.delivery.reported_sent.event_id, reported.event.id);
  assert.equal(reported.artifact.delivery.transport_or_recipient_acknowledged, false);
  assert.deepEqual(
    reported.communication_projection.confirmed_or_reported_client_outbound.map((entry) => [entry.subject.kind, entry.state, entry.delivery_evidence, entry.source.actor_resolution]),
    [["candidate", "reported_sent", "owner_reported_sent", "owner_verified"]]
  );
  record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => event.kind), ["exported", "reported_sent"], "the export record is untouched and the report is its own record");
  assert.equal(record.candidate_responses.at(-1).status, "approved_for_delivery", "a report does not commit the candidate to the transcript");

  const second = await submitExternal(service, "A second draft reported with a send time.", { idempotencyKey: "report-2" });
  await exportArtifact(service, second.artifact.artifact_id);
  const timed = await reportSent(service, { artifactId: second.artifact.artifact_id, sentAt: "2026-10-01T11:30:00.000Z", idempotencyKey: "report-owner-2" });
  assert.deepEqual([timed.event.sent_at, timed.event.sent_at_status], ["2026-10-01T11:30:00.000Z", "known"]);
  await assert.rejects(() => reportSent(service, { artifactId: second.artifact.artifact_id, sentAt: "not a time", idempotencyKey: "report-owner-3" }), /sentAt must be a timestamp/);
});

test("an authenticated agent that only asserts the owner sent a draft keeps the weaker relayed origin, however the claim is phrased", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "A draft an agent claims the owner sent.", { idempotencyKey: "fabricate-1" }, AGENT);
  await exportArtifact(service, submitted.artifact.artifact_id, AGENT);
  const claimed = await service.recordReportedDelivery({
    caseId: CASE_ID,
    artifactId: submitted.artifact.artifact_id,
    quote: "The owner told me they sent it.",
    sourceRef: "message:synthetic:owner",
    origin: "owner_action",
    actor_resolution: "owner_verified",
    provenance: { origin: "owner_action", actor_resolution: "owner_verified" },
    idempotencyKey: "fabricate-report-1",
    channel: "owner_action",
    authContext: {}
  });
  assert.deepEqual([claimed.event.provenance.origin, claimed.event.provenance.actor_resolution], ["agent_relayed", "unresolved"]);
  assert.deepEqual(
    claimed.communication_projection.confirmed_or_reported_client_outbound.map((entry) => [entry.delivery_evidence, entry.source.actor_resolution]),
    [["owner_reported_sent", "unresolved"]],
    "the report is kept, as a relayed claim rather than a verified owner event"
  );
  const owner = await reportSent(service, { artifactId: submitted.artifact.artifact_id, idempotencyKey: "fabricate-report-2" }, OWNER);
  assert.deepEqual([owner.event.provenance.origin, owner.event.provenance.actor_resolution], ["owner_action", "owner_verified"]);
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "reported_sent").length, 2);
});

test("a report that names no draft resolves a single exported draft and is recorded as unresolved when several could be meant", async (t) => {
  const { store, service } = await makeEnvironment(t);
  await assert.rejects(() => reportSent(service, { idempotencyKey: "nothing-1" }), refusal("SUPERVISOR_NO_REPORTABLE_DRAFT"));
  const first = await submitExternal(service, "First exported draft.", { idempotencyKey: "ambiguous-1" });
  await exportArtifact(service, first.artifact.artifact_id);
  const second = await submitExternal(service, "Second exported draft.", { idempotencyKey: "ambiguous-2" });
  await exportArtifact(service, second.artifact.artifact_id);

  const ambiguous = await reportSent(service, { idempotencyKey: "ambiguous-report" });
  assert.equal(ambiguous.event.subject.kind, "unresolved");
  assert.equal(ambiguous.event.subject.candidate_refs.length, 2);
  assert.equal(ambiguous.artifact, null);
  assert.deepEqual(ambiguous.communication_projection.confirmed_or_reported_client_outbound, [], "nothing is counted as sent when the report cannot be tied to one draft");
  assert.equal(ambiguous.communication_projection.unresolved_delivery.some((entry) => entry.subject.kind === "unresolved"), true);
  const record = await store.load(CASE_ID);
  const views = (await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER })).artifacts;
  assert.deepEqual(views.map((view) => view.delivery.reported_sent), [null, null], "neither draft is marked reported by an ambiguous statement");
  assert.equal(record.communication_events.filter((event) => event.kind === "reported_sent").length, 1);
});

test("replaying submit, export and report changes nothing, and a reused key for other content is refused", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t);
  const first = await submitExternal(service, "Idempotent draft.", { idempotencyKey: "idem-1" });
  const revisionAfterSubmit = (await store.load(CASE_ID)).revision;
  const auditsAfterSubmit = runtime.calls.filter((call) => call.role === "audit").length;
  const again = await submitExternal(service, "Idempotent draft.", { idempotencyKey: "idem-1" });
  assert.equal(again.replayed, true);
  assert.equal(again.artifact.artifact_id, first.artifact.artifact_id);
  assert.equal((await store.load(CASE_ID)).revision, revisionAfterSubmit, "a replayed submission writes nothing");
  assert.equal(runtime.calls.filter((call) => call.role === "audit").length, auditsAfterSubmit, "and audits nothing again");
  await assert.rejects(() => submitExternal(service, "Different bytes under the same key.", { idempotencyKey: "idem-1" }), refusal("SUPERVISOR_IDEMPOTENCY_CONFLICT"));

  const exportOne = await exportArtifact(service, first.artifact.artifact_id);
  const revisionAfterExport = (await store.load(CASE_ID)).revision;
  const exportTwo = await exportArtifact(service, first.artifact.artifact_id);
  assert.deepEqual([exportOne.replayed, exportTwo.replayed], [false, true]);
  assert.equal(exportTwo.client_text, exportOne.client_text);
  assert.equal(exportTwo.event.event_id, exportOne.event.event_id);
  assert.equal((await store.load(CASE_ID)).revision, revisionAfterExport);

  const reportOne = await reportSent(service, { artifactId: first.artifact.artifact_id, idempotencyKey: "idem-report", quote: "Synthetic: sent." });
  const revisionAfterReport = (await store.load(CASE_ID)).revision;
  const reportTwo = await reportSent(service, { artifactId: first.artifact.artifact_id, idempotencyKey: "idem-report", quote: "Synthetic: sent." });
  assert.equal(reportTwo.event.id, reportOne.event.id);
  assert.equal((await store.load(CASE_ID)).revision, revisionAfterReport);
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "reported_sent").length, 1);
  await assert.rejects(() => reportSent(service, { artifactId: first.artifact.artifact_id, idempotencyKey: "idem-report", quote: "Synthetic: sent differently." }), refusal("SUPERVISOR_IDEMPOTENCY_CONFLICT"));
});

test("a submission with no key is replayed by its content and the case it was written against", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const first = await submitExternal(service, "Keyless draft.");
  const second = await submitExternal(service, "Keyless draft.");
  assert.equal(second.replayed, true);
  assert.equal(second.artifact.artifact_id, first.artifact.artifact_id);
  assert.equal((await store.load(CASE_ID)).candidate_responses.length, 1);
});

test("owner-supplied inputs are recorded with the channel that supplied them, kept distinct by type, and never become transcript turns", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const before = await store.load(CASE_ID);
  const owner = await service.prepareResponseContext({
    caseId: CASE_ID,
    inputs: [
      { type: "client_message", text: "Synthetic message the owner relayed from the client.", idempotencyKey: "input-client-1" },
      { type: "supervisor_revision", text: "Synthetic instruction to make the reply shorter.", idempotencyKey: "input-revision-1" }
    ],
    ...OWNER
  });
  assert.deepEqual(owner.owner_supplied_inputs.map((input) => [input.input_type, input.author_claim, input.supplied_by.channel, input.supplied_by.actor_resolution]), [
    ["client_message", "client", "owner_ui", "owner_verified"],
    ["supervisor_revision", "supervisor", "owner_ui", "owner_verified"]
  ]);
  assert.equal(owner.recorded_inputs.length, 2);

  // A caller cannot name its own sender, source or audience: the channel decides.
  const agent = await service.prepareResponseContext({
    caseId: CASE_ID,
    inputs: [{ type: "client_message", text: "Synthetic message an agent relayed.", idempotencyKey: "input-client-2", channel: "owner_ui", actor: "owner", sender: "client", source: "owner_ui", actor_resolution: "owner_verified" }],
    ...AGENT
  });
  const relayed = agent.owner_supplied_inputs.at(-1);
  assert.deepEqual([relayed.supplied_by.channel, relayed.supplied_by.actor_resolution, relayed.author_claim], ["authenticated_agent", "unresolved", "client"]);

  const record = await store.load(CASE_ID);
  assert.deepEqual(record.raw_transcript, before.raw_transcript, "a relayed message is an input, not a transcript turn");
  assert.equal(agent.latest_client_turn.turn_id, "E2-user");

  const replay = await service.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_message", text: "Synthetic message the owner relayed from the client.", idempotencyKey: "input-client-1" }], ...OWNER });
  assert.equal(replay.owner_supplied_inputs.length, 3, "a replayed input is not recorded again");
  await assert.rejects(
    () => service.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_message", text: "Other words under the same key.", idempotencyKey: "input-client-1" }], ...OWNER }),
    refusal("SUPERVISOR_IDEMPOTENCY_CONFLICT")
  );
  await assert.rejects(() => service.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_reply", text: "Wrong type." }], ...OWNER }), /client_message or supervisor_revision/);
  await assert.rejects(() => service.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_message", text: "   " }], ...OWNER }), /non-empty text/);
});

test("a draft prepared against an older case is refused when the case changed before submission, and nothing is written", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const prepared = await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER });
  await store.appendTranscriptTurn(CASE_ID, turn("E3", "user", "Synthetic newer client message.", 3));
  await assert.rejects(() => submitExternal(service, "Written against the older case.", { basisSha256: prepared.basis.sha256, idempotencyKey: "basis-1" }), refusal("SUPERVISOR_BASIS_CHANGED"));
  assert.equal((await store.load(CASE_ID)).candidate_responses.length, 0);
  await assert.rejects(() => submitExternal(service, "Bad digest.", { basisSha256: "not-a-digest", idempotencyKey: "basis-2" }), /basisSha256 is invalid/);
});

test("a backend-produced draft needs an unanswered client message and takes no text or companion from the caller", async (t) => {
  const { store, service } = await makeEnvironment(t);
  await assert.rejects(() => service.submitCandidateForReview({ caseId: CASE_ID, source: "backend_produced", text: "Caller text.", ...OWNER }), /takes no text or companion/);
  await assert.rejects(() => service.submitCandidateForReview({ caseId: CASE_ID, source: "backend_produced", companion: { language: "en", text: "Companion." }, ...OWNER }), /takes no text or companion/);
  await assert.rejects(() => service.submitCandidateForReview({ caseId: CASE_ID, source: "unknown_source", text: "Text.", ...OWNER }), /external_draft or backend_produced/);
  await store.appendTranscriptTurn(CASE_ID, turn("E2", "assistant", "Synthetic reply already given.", 2));
  await assert.rejects(() => service.submitCandidateForReview({ caseId: CASE_ID, source: "backend_produced", idempotencyKey: "pending-1", ...OWNER }), refusal("SUPERVISOR_NO_PENDING_CLIENT_MESSAGE"));
  assert.equal((await store.load(CASE_ID)).candidate_responses.length, 0);
});

test("when the independent review cannot run, the draft stays unapproved and unexportable and the same request resumes it later", async (t) => {
  const { store, runtime } = await makeEnvironment(t);
  const unavailable = createPrivateSupervisorDraftService({
    privateCaseSource: store,
    modelRuntime: { async auditCandidate() { throw new Error("Synthetic transient provider failure."); }, async repairCandidate() { throw new Error("unused"); } },
    maximumInvocationAttempts: 2
  });
  await assert.rejects(() => submitExternal(unavailable, "A draft whose review is unavailable.", { idempotencyKey: "resume-1" }), (error) => {
    assert.equal(error.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
    assert.doesNotMatch(error.message, /Synthetic transient provider failure|A draft whose review/u);
    return true;
  });
  let record = await store.load(CASE_ID);
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.status), ["pending_audit"]);
  const artifactId = (await unavailable.prepareResponseContext({ caseId: CASE_ID, ...OWNER })).artifacts[0].artifact_id;
  await assert.rejects(() => exportArtifact(unavailable, artifactId), refusal("SUPERVISOR_ARTIFACT_NOT_APPROVED"));

  const none = createPrivateSupervisorDraftService({ privateCaseSource: store });
  await assert.rejects(() => submitExternal(none, "A draft whose review is unavailable.", { idempotencyKey: "resume-1" }), refusal("SUPERVISOR_REVIEW_UNAVAILABLE"));

  const healthy = createPrivateSupervisorDraftService({ privateCaseSource: store, modelRuntime: runtime });
  const resumed = await submitExternal(healthy, "A draft whose review is unavailable.", { idempotencyKey: "resume-1" });
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.replayed, true);
  record = await store.load(CASE_ID);
  assert.equal(record.candidate_responses.length, 1, "resuming did not write a second candidate");
  assert.equal(resumed.artifact.artifact_id, artifactId);
});

test("two submissions racing for the same case are reviewed one at a time and the later draft governs", async (t) => {
  const { store, service, runtime } = await makeEnvironment(t);
  const [one, two] = await Promise.all([
    submitExternal(service, "Racing draft one.", { idempotencyKey: "race-1" }),
    submitExternal(service, "Racing draft two.", { idempotencyKey: "race-2" })
  ]);
  assert.deepEqual([one.status, two.status], ["approved", "approved"], "each was reviewed to its own result in turn");
  assert.deepEqual(runtime.calls.map((call) => call.role), ["audit", "audit"]);
  const record = await store.load(CASE_ID);
  assert.deepEqual(record.candidate_responses.map((candidate) => [candidate.exact_text, candidate.status]), [["Racing draft one.", "superseded"], ["Racing draft two.", "approved_for_delivery"]]);
  await assert.rejects(() => exportArtifact(service, one.artifact.artifact_id), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && error.details.reasons.includes("superseded_by_newer_draft"));
  assert.equal((await exportArtifact(service, two.artifact.artifact_id)).client_text, "Racing draft two.");
});

// The same service over the real access service, with an authorization provider the test can switch, so authorization is
// checked on every call the way a deployment checks it.
async function makeGoverned(t, options) {
  const environment = await makeEnvironment(t, options);
  const revoked = new Set();
  const scopesFor = new Map();
  const authorizationProvider = {
    async authorize({ authContext }) {
      const token = authContext?.bearerToken;
      if (!token || revoked.has(token)) return { allowed: false };
      return { allowed: true, principalId: `principal:${token}`, scopes: scopesFor.get(token) ?? ["case:read", "case:write", "case:audit"], purposes: [] };
    }
  };
  const keyProvider = {
    async getCaseKeyMaterial() {
      return { routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), accessAssurance: "development_external_file", provider: "development-file-provider" };
    }
  };
  const access = createPrivateCaseAccessService({ rootDir: environment.rootDir, authorizationProvider, keyProvider, allowDevelopmentFileProvider: true, now: environment.now });
  const governed = createPrivateSupervisorDraftService({ privateCaseSource: access, modelRuntime: environment.runtime });
  return { ...environment, revoked, scopesFor, access, governed };
}
const ownerAs = (token) => ({ channel: "owner_ui", authContext: { bearerToken: token } });

test("revoked access stops a new export and every other supervisor call, and a refused call records nothing", async (t) => {
  const { store, governed, revoked } = await makeGoverned(t);
  const submitted = await governed.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "Draft whose access is later revoked.", idempotencyKey: "revoke-1", ...ownerAs("token-a") });
  assert.equal(submitted.status, "approved");
  const artifactId = submitted.artifact.artifact_id;

  revoked.add("token-a");
  const denied = refusal("PRIVATE_CASE_ACCESS_DENIED");
  await assert.rejects(() => governed.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, ...ownerAs("token-a") }), denied);
  assert.equal((await store.load(CASE_ID)).communication_events.length, 0, "no export was recorded for the revoked caller");
  await assert.rejects(() => governed.prepareResponseContext({ caseId: CASE_ID, ...ownerAs("token-a") }), denied);
  await assert.rejects(() => governed.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "New draft.", idempotencyKey: "revoke-2", ...ownerAs("token-a") }), denied);
  await assert.rejects(() => governed.recordReportedDelivery({ caseId: CASE_ID, artifactId, idempotencyKey: "revoke-3", ...ownerAs("token-a") }), denied);
  await assert.rejects(() => governed.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, channel: "authenticated_agent", authContext: {} }), denied, "a caller with no credential at all is refused too");

  // Another principal's authorization is unaffected, and the first export is still decided on the live state.
  const exported = await governed.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, ...ownerAs("token-b") });
  assert.equal(exported.client_text, "Draft whose access is later revoked.");
  assert.equal(exported.checks.authorization_current, true);
  await assert.rejects(() => governed.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, ...ownerAs("token-a") }), denied, "a replay is refused too once the caller is revoked");
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "exported").length, 1);
});

test("each supervisor step needs the scope of what it does", async (t) => {
  const { governed, scopesFor, store } = await makeGoverned(t);
  const denied = refusal("PRIVATE_CASE_ACCESS_DENIED");
  scopesFor.set("reader", ["case:read"]);
  scopesFor.set("writer", ["case:read", "case:write"]);
  await governed.prepareResponseContext({ caseId: CASE_ID, ...ownerAs("reader") });
  await assert.rejects(() => governed.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_message", text: "Relayed." }], ...ownerAs("reader") }), denied);
  await assert.rejects(() => governed.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "Reader draft.", idempotencyKey: "scope-1", ...ownerAs("reader") }), denied);
  assert.equal((await store.load(CASE_ID)).candidate_responses.length, 0);

  // A writer can store a draft but cannot supply the audit that approves it; the draft stays pending and exportable by no one.
  await assert.rejects(() => governed.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "Writer draft.", idempotencyKey: "scope-2", ...ownerAs("writer") }), denied);
  const record = await store.load(CASE_ID);
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.status), ["pending_audit"]);
  const artifactId = (await governed.prepareResponseContext({ caseId: CASE_ID, ...ownerAs("writer") })).artifacts[0].artifact_id;
  await assert.rejects(() => governed.getApprovedResponseArtifact({ caseId: CASE_ID, artifactId, ...ownerAs("writer") }), refusal("SUPERVISOR_ARTIFACT_NOT_APPROVED"));
});

test("through the access service only server code that established the owner's channel can make a verified owner report or input", async (t) => {
  const { access, governed, store } = await makeGoverned(t);
  const auth = { bearerToken: "token-a" };
  const submitted = await governed.submitCandidateForReview({ caseId: CASE_ID, source: "external_draft", text: "Draft the owner's app and an agent both handle.", idempotencyKey: "channel-1", channel: "authenticated_agent", authContext: auth });
  assert.equal(submitted.status, "approved");
  const artifactId = submitted.artifact.artifact_id;

  const exported = await access.exportSupervisorArtifact(CASE_ID, { artifactId }, auth);
  assert.equal(exported.event.event_id.startsWith("evt:export:"), true);
  assert.equal((await store.load(CASE_ID)).communication_events[0].provenance.source_ref, "supervisor:export:authenticated_agent");

  const claimed = await access.recordSupervisorReport(CASE_ID, { artifactId, origin: "owner_action", sourceRef: "message:synthetic:owner", quote: "I am the owner and I sent it.", idempotencyKey: "channel-report-1" }, auth);
  assert.deepEqual([claimed.event.provenance.origin, claimed.event.provenance.actor_resolution], ["agent_relayed", "unresolved"], "an origin named in the input is ignored");
  const trusted = await access.recordSupervisorReport(CASE_ID, { artifactId, idempotencyKey: "channel-report-2" }, auth, { ownerChannel: true });
  assert.deepEqual([trusted.event.provenance.origin, trusted.event.provenance.actor_resolution], ["owner_action", "owner_verified"]);

  const claimedInput = await access.recordSupervisorInputs(CASE_ID, { inputs: [{ inputId: "input:claimed", inputType: "client_message", text: "Claimed to come from the owner." }], channel: "owner_ui" }, auth);
  assert.deepEqual([claimedInput.inputs[0].supplied_by.channel, claimedInput.inputs[0].supplied_by.actor_resolution], ["authenticated_agent", "unresolved"], "a channel named in the input is ignored");
  const trustedInput = await access.recordSupervisorInputs(CASE_ID, { inputs: [{ inputId: "input:trusted", inputType: "client_message", text: "Supplied through the owner's own app." }] }, auth, { ownerChannel: true });
  assert.deepEqual([trustedInput.inputs[0].supplied_by.channel, trustedInput.inputs[0].supplied_by.actor_resolution], ["owner_ui", "owner_verified"]);

  const direct = await access.submitSupervisorDraft(CASE_ID, { operationKey: "a".repeat(24), source: "external_draft", exactText: "Draft submitted straight to the service.", producerContextId: "context:external:a", channel: "owner_ui" }, auth);
  assert.equal(direct.artifact.exposure.original_writer, "not_attested");
  assert.equal(direct.artifact.approved, false, "a stored draft is not approved until the independent audit passes it");
  await assert.rejects(() => access.exportSupervisorArtifact(CASE_ID, { artifactId: direct.artifact.artifact_id }, auth), refusal("SUPERVISOR_ARTIFACT_NOT_APPROVED"));
});

test("only the supervisor path can write supervisor draft metadata, so an ordinary candidate cannot borrow a supervisor basis or approval", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const forged = { schema_version: 1, source: "external_draft", root_source: "external_draft", operation_key: "b".repeat(24), text_sha256: sha256("Forged."), basis: {}, basis_sha256: "0".repeat(64), exposure: {} };
  const reserved = /reserved for the controlled supervisor path/;
  await assert.rejects(() => store.saveCandidateResponse(CASE_ID, "candidate:forged:1", "Forged.", { producer_context_id: "context:x", supervisor_draft: forged }), reserved);
  await store.saveCandidateResponse(CASE_ID, "candidate:ordinary:1", "Ordinary candidate.", { producer_context_id: "context:ordinary-producer" });
  await assert.rejects(() => store.updateCandidateStatus(CASE_ID, "candidate:ordinary:1", "superseded", { supervisor_draft: forged }), reserved);

  const ordinary = await store.getCandidateResponse(CASE_ID, "candidate:ordinary:1");
  const failing = createCandidateAuditEvidence({
    auditId: "audit:ordinary:1",
    candidate: ordinary,
    auditVersion: "synthetic-audit",
    auditorContext: { kind: "independent", context_id: "context:ordinary-auditor" },
    findings: [{ id: "finding:ordinary", code: "SYNTHETIC_UNCERTAINTY", severity: "substantive", summary: "Synthetic repair is required." }]
  });
  await assert.rejects(() => store.recordSupervisorAudit(CASE_ID, "candidate:ordinary:1", failing), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  await store.recordCandidateAudit(CASE_ID, "candidate:ordinary:1", failing);
  await assert.rejects(() => store.reconstructSupervisorDraft(CASE_ID, "candidate:ordinary:1", { exactText: "Repaired.", producerContextId: "context:ordinary-repair" }), refusal("SUPERVISOR_ARTIFACT_NOT_FOUND"));
  await assert.rejects(() => store.reconstructCandidateResponse(CASE_ID, "candidate:ordinary:1", "candidate:ordinary:2", "Repaired ordinary.", { producer_context_id: "context:ordinary-repair", supervisor_draft: forged }), reserved);

  // An ordinary candidate has no artifact id, so there is nothing to export or report for it.
  const views = (await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER })).artifacts;
  assert.deepEqual(views, []);
  await store.beginPrivateRuntimeTurn(CASE_ID, { runtimeTurnId: "runtime:forged:1", exchangeId: "exchange:forged:1", userTurnId: "turn:forged:1", exactText: "Synthetic inbound." });
  await assert.rejects(() => store.commitPrivateRuntimeCandidate(CASE_ID, { runtimeTurnId: "runtime:forged:1", candidateId: "candidate:runtime:forged", exactText: "Runtime text.", producerContextId: "context:runtime", metadata: { supervisor_draft: forged }, eventId: "event:forged:1" }), reserved);
});

test("the record validator refuses forged, mismatched or inconsistent supervisor evidence and loads records from before it existed", async (t) => {
  const { store, service } = await makeEnvironment(t);
  await service.prepareResponseContext({ caseId: CASE_ID, inputs: [{ type: "client_message", text: "Synthetic relayed message.", idempotencyKey: "validator-input" }], ...OWNER });
  const submitted = await submitExternal(service, "Draft with every kind of supervisor record.", { companion: { language: "en", text: "English companion." }, idempotencyKey: "validator-1" });
  assert.equal(submitted.status, "approved");
  const base = await store.load(CASE_ID);
  const kinds = base.supervisor_artifacts.map((entry) => entry.kind).sort();
  assert.deepEqual(kinds, ["companion", "input", "review_receipt"]);
  const forge = (change) => () => {
    const record = structuredClone(base);
    change(record);
    return validatePrivateCaseRecord(record);
  };
  const entry = (record, kind) => record.supervisor_artifacts.find((value) => value.kind === kind);
  assert.doesNotThrow(() => validatePrivateCaseRecord(structuredClone(base)));

  assert.throws(forge((record) => { record.candidate_responses[0].metadata.supervisor_draft.text_sha256 = sha256("other bytes"); }), /does not bind the exact candidate bytes/);
  assert.throws(forge((record) => { record.candidate_responses[0].metadata.supervisor_draft.basis.latest_user_turn_id = "E9-user"; }), /basis is inconsistent/);
  assert.throws(forge((record) => { record.candidate_responses[0].metadata.supervisor_draft.exposure.original_writer = "backend_inclusion_receipts"; }), /exposure is inconsistent with its source/);
  assert.throws(forge((record) => { record.candidate_responses[0].metadata.supervisor_draft.source = "something_else"; }), /source is invalid/);
  assert.throws(forge((record) => { record.candidate_responses[0].metadata.supervisor_draft.extra = true; }), /unexpected or missing fields/);
  assert.throws(forge((record) => { entry(record, "companion").client_send_allowed = true; }), /must remain supervisor-only/);
  assert.throws(forge((record) => { entry(record, "companion").audience = "client"; }), /must remain supervisor-only/);
  assert.throws(forge((record) => { entry(record, "companion").meaning_review.status = "reviewed"; }), /meaning_review is invalid/);
  assert.throws(forge((record) => { entry(record, "companion").companion_of.candidate_sha256 = sha256("other bytes"); }), /does not bind the exact candidate bytes/);
  assert.throws(forge((record) => { entry(record, "companion").text = "Edited companion text."; }), /does not bind its exact text/);
  assert.throws(forge((record) => { entry(record, "review_receipt").audit_id = "audit:supervisor:unknown"; }), /does not identify a stored audit/);
  assert.throws(forge((record) => { entry(record, "review_receipt").disclosure_manifest.tools_available = "no"; }), /disclosure_manifest is invalid/);
  assert.throws(forge((record) => { entry(record, "input").supplied_by = { channel: "authenticated_agent", actor_resolution: "owner_verified" }; }), /channel and actor resolution are inconsistent/);
  assert.throws(forge((record) => { entry(record, "input").input_type = "supervisor_revision"; }), /type and author claim are inconsistent/);
  assert.throws(forge((record) => { entry(record, "input").text = "Edited input."; }), /does not bind its exact text/);
  assert.throws(forge((record) => { entry(record, "input").extra = 1; }), /unexpected or missing fields/);
  assert.throws(forge((record) => { record.supervisor_artifacts.push(structuredClone(record.supervisor_artifacts[0])); }), /Duplicate supervisor artifact entry/);
  assert.throws(forge((record) => { record.supervisor_artifacts = "not a list"; }), /supervisor_artifacts/);

  const legacy = structuredClone(base);
  delete legacy.supervisor_artifacts;
  for (const candidate of legacy.candidate_responses) delete candidate.metadata.supervisor_draft;
  const migrated = validatePrivateCaseRecord(legacy);
  assert.deepEqual(migrated.supervisor_artifacts, [], "a record from before supervisor drafts loads with none");
  assert.equal(migrated.candidate_responses[0].exact_text, base.candidate_responses[0].exact_text);
});

function runtimeStateFor(userTurnId) {
  return applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    current_episode: {
      id: "episode:supervisor:synthetic",
      target: "Distinguish two synthetic possibilities.",
      route: "SYNTHETIC.RUNTIME",
      prediction: "The next exact observation will discriminate.",
      next_question: "Which synthetic signal changed first?",
      started_turn_id: userTurnId,
      constitutional_aim_ids: ["CARE"],
      adverse_signs: ["less choice"],
      stay_conditions: ["new information"],
      switch_conditions: ["no information"],
      stop_conditions: ["decline"],
      source_item_ids: []
    }
  });
}

test("the existing runtime still answers the next client message after a supervisor draft was exported and reported, and the old artifact is then stale", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "Supervisor draft, exported and reported.", { idempotencyKey: "runtime-compat-1" });
  await exportArtifact(service, submitted.artifact.artifact_id);
  await reportSent(service, { artifactId: submitted.artifact.artifact_id, idempotencyKey: "runtime-compat-report" });

  const runtime = {
    async produceCandidate({ runtimeTurn }) {
      return { exactText: "Runtime reply.\n\nWhich synthetic signal changed first?", contextId: "context:runtime:producer", caseState: runtimeStateFor(runtimeTurn.user_turn_id), stateDiff: { schema_version: 1, additions: [], current_episode_changed: true } };
    },
    async auditCandidate({ candidate }) {
      return { contextId: `context:runtime:auditor:${candidate.id}`, value: { findings: [], repair_induced_checks: [] }, disclosureManifest: {} };
    },
    async repairCandidate() { throw new Error("unused"); },
    async produceDiscriminator() { return { exactText: "Which synthetic signal changed first?", contextId: "context:runtime:discriminator" }; }
  };
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime });
  const result = await controller.run({
    caseId: CASE_ID,
    runtimeTurnId: "runtime:after-supervisor:1",
    exchangeId: "exchange:after-supervisor:1",
    userTurnId: "turn:after-supervisor:1:user",
    assistantTurnId: "turn:after-supervisor:1:assistant",
    userMessage: "Synthetic inbound after the supervisor draft.",
    userInput: { processingMode: "fast" }
  });
  assert.equal(result.deliveryKind, "candidate");
  const record = await store.load(CASE_ID);
  const [supervisorDraft, runtimeCandidate] = record.candidate_responses;
  assert.deepEqual([supervisorDraft.status, runtimeCandidate.status], ["superseded", "sent"]);
  assert.equal(supervisorDraft.metadata.superseded_by_candidate_id, runtimeCandidate.id);
  assert.equal(record.communication_events.filter((event) => event.kind === "reported_sent").length, 1, "the owner's earlier report stays on the record");
  await assert.rejects(() => exportArtifact(service, submitted.artifact.artifact_id), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE" && error.details.reasons.includes("superseded_by_newer_draft"));
  assert.doesNotThrow(() => projectCommunicationState(record));
});

test("handoffs from before a supervisor draft still load, and a handoff written while a draft is unfinished or blocked carries the exact draft", async (t) => {
  const { store, service } = await makeEnvironment(t, { verdicts: ["fail"] });
  const earlier = await store.createHandoff(CASE_ID, { handoffId: "handoff:00000000-0000-4000-8000-000000000101", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" });
  const before = await store.loadHandoff(CASE_ID, earlier.handoff_id);

  const blocked = await submitExternal(service, "Draft that never passes review.", { idempotencyKey: "handoff-1" });
  assert.equal(blocked.status, "blocked");
  const after = await store.loadHandoff(CASE_ID, earlier.handoff_id);
  assert.deepEqual(after, before, "an existing handoff is unchanged by later supervisor activity");

  const later = await store.createHandoff(CASE_ID, { handoffId: "handoff:00000000-0000-4000-8000-000000000102", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" });
  assert.equal(later.handoff_status, "BLOCKED_CONTINUATION_UNSAFE");
  const packet = await store.loadHandoff(CASE_ID, later.handoff_id);
  assert.deepEqual(packet.pending_artifacts.map((candidate) => [candidate.exact_text, candidate.status]), [["Synthetic repaired reply 2.", "audit_failed"]], "the handoff carries the exact failed head, not an approval");
});

test("a supervisor draft approved and not yet committed is refused by the handoff exactly as an ordinary approved candidate is", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "Approved draft awaiting the owner.", { idempotencyKey: "handoff-2" });
  assert.equal(submitted.status, "approved");
  const refusalOfHandoff = await store.createHandoff(CASE_ID, { handoffId: "handoff:00000000-0000-4000-8000-000000000103", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" }).then(() => null, (error) => error);
  assert.match(refusalOfHandoff?.message ?? "", /delivery gate is inconsistent/, "the refusal for an approved, undelivered candidate predates supervisor drafts");
});

const SCHEMA_BASE = "https://inner-signal.local/schemas/private-case";

async function supervisorSchemas() {
  const schemaDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "schemas", "private-case");
  const ajv = new Ajv2020({ strict: true, validateFormats: false });
  for (const name of ["candidate-audit-v1", "candidate-version-v1", "communication-event-v1", "communication-projection-v1", "supervisor-artifact-v1"]) {
    ajv.addSchema(JSON.parse(await fs.readFile(path.join(schemaDirectory, `${name}.schema.json`), "utf8")));
  }
  return {
    entry: ajv.getSchema(`${SCHEMA_BASE}/supervisor-artifact-v1.schema.json`),
    draftMetadata: ajv.getSchema(`${SCHEMA_BASE}/supervisor-artifact-v1.schema.json#/$defs/draftMetadata`),
    candidate: ajv.getSchema(`${SCHEMA_BASE}/candidate-version-v1.schema.json`),
    event: ajv.getSchema(`${SCHEMA_BASE}/communication-event-v1.schema.json`),
    projection: ajv.getSchema(`${SCHEMA_BASE}/communication-projection-v1.schema.json`)
  };
}

test("everything the supervisor path stores or records conforms to the published schemas, and the forbidden shapes do not", async (t) => {
  const { store, service } = await makeEnvironment(t, { verdicts: ["fail", "pass"] });
  const schemas = await supervisorSchemas();
  await service.prepareResponseContext({ caseId: CASE_ID, ...OWNER, inputs: [{ type: "client_message", text: "Synthetic relayed message.", idempotencyKey: "schema-input-1" }] });
  await service.prepareResponseContext({ caseId: CASE_ID, ...AGENT, inputs: [{ type: "supervisor_revision", text: "Synthetic agent-relayed revision.", idempotencyKey: "schema-input-2" }] });
  const repaired = await submitExternal(service, "A draft that is repaired once before it passes.", { companion: { language: "en", text: "Synthetic English companion." }, idempotencyKey: "schema-1" });
  assert.equal(repaired.status, "approved");
  assert.equal(repaired.artifact.source, "backend_repair");
  const backend = await service.submitCandidateForReview({ caseId: CASE_ID, source: "backend_produced", idempotencyKey: "schema-2", ...OWNER });
  assert.equal(backend.status, "approved");
  await exportArtifact(service, backend.artifact.artifact_id);
  await reportSent(service, { artifactId: backend.artifact.artifact_id, idempotencyKey: "schema-report" });
  await reportSent(service, { artifactId: backend.artifact.artifact_id, idempotencyKey: "schema-report-agent" }, AGENT);

  const record = await store.load(CASE_ID);
  assert.deepEqual([...new Set(record.supervisor_artifacts.map((entry) => entry.kind))].sort(), ["companion", "input", "review_receipt"]);
  for (const entry of record.supervisor_artifacts) assert.equal(schemas.entry(entry), true, `${entry.id}: ${JSON.stringify(schemas.entry.errors)}`);
  const drafts = record.candidate_responses.filter((candidate) => candidate.metadata.supervisor_draft);
  assert.deepEqual(drafts.map((candidate) => candidate.metadata.supervisor_draft.source), ["external_draft", "backend_repair", "backend_produced"]);
  for (const candidate of drafts) {
    assert.equal(schemas.candidate(candidate), true, `${candidate.id}: ${JSON.stringify(schemas.candidate.errors)}`);
    assert.equal(schemas.draftMetadata(candidate.metadata.supervisor_draft), true, `${candidate.id}: ${JSON.stringify(schemas.draftMetadata.errors)}`);
  }
  assert.deepEqual(record.communication_events.map((event) => event.kind), ["exported", "reported_sent", "reported_sent"]);
  for (const event of record.communication_events) assert.equal(schemas.event(event), true, `${event.id}: ${JSON.stringify(schemas.event.errors)}`);
  const projection = (await store.loadCaseContext(CASE_ID)).communication_projection;
  assert.equal(schemas.projection(projection), true, JSON.stringify(schemas.projection.errors));

  // A forged entry or draft binding fails the schema as well as the runtime validator.
  const reject = (validate, value, why) => assert.equal(validate(value), false, why);
  const companion = structuredClone(record.supervisor_artifacts.find((entry) => entry.kind === "companion"));
  const input = structuredClone(record.supervisor_artifacts.find((entry) => entry.kind === "input" && entry.supplied_by.channel === "owner_ui"));
  const receipt = structuredClone(record.supervisor_artifacts.find((entry) => entry.kind === "review_receipt"));
  for (const [why, change] of [
    ["a companion addressed to the client", (value) => { value.audience = "client"; }],
    ["a companion that may be sent", (value) => { value.client_send_allowed = true; }],
    ["a companion with its meaning marked reviewed", (value) => { value.meaning_review.status = "reviewed"; }],
    ["a companion bound to no candidate bytes", (value) => { delete value.companion_of.candidate_sha256; }]
  ]) {
    const forged = structuredClone(companion);
    change(forged);
    reject(schemas.entry, forged, why);
  }
  for (const [why, change] of [
    ["an agent input marked owner verified", (value) => { value.supplied_by = { channel: "authenticated_agent", actor_resolution: "owner_verified" }; }],
    ["a client message claimed by the supervisor", (value) => { value.author_claim = "supervisor"; }],
    ["an unknown channel", (value) => { value.supplied_by.channel = "page_script"; }],
    ["an unexpected field", (value) => { value.sent = true; }],
    ["empty text", (value) => { value.text = "  "; }]
  ]) {
    const forged = structuredClone(input);
    change(forged);
    reject(schemas.entry, forged, why);
  }
  for (const [why, change] of [
    ["a free-text flag in the disclosure manifest", (value) => { value.disclosure_manifest.note = "Synthetic free text."; }],
    ["a flag name that is not a plain identifier", (value) => { value.disclosure_manifest["Bad Name"] = true; }],
    ["an unexpected field", (value) => { value.verdict = "pass"; }]
  ]) {
    const forged = structuredClone(receipt);
    change(forged);
    reject(schemas.entry, forged, why);
  }
  const metadata = structuredClone(drafts[0].metadata.supervisor_draft);
  for (const [why, change] of [
    ["an external draft claiming its writer was attested", (value) => { value.exposure.original_writer = "backend_inclusion_receipts"; }],
    ["a backend draft that claims no attestation", (value) => { value.source = "backend_produced"; }],
    ["an unknown source", (value) => { value.source = "page_script"; }],
    ["an unexpected field", (value) => { value.approved = true; }],
    ["a basis missing a binding", (value) => { delete value.basis.supervisor_inputs_sha256; }]
  ]) {
    const forged = structuredClone(metadata);
    change(forged);
    reject(schemas.draftMetadata, forged, why);
  }
});

// The store and its validators refuse to write most of these shapes, so the deterministic check is tried directly on hand-built
// copies of a stored record: it must hold even where a record could not have been written.
test("the single deterministic check refuses every tampered or moved-on shape and explains it in fixed words", async (t) => {
  const { store, service } = await makeEnvironment(t);
  const submitted = await submitExternal(service, "Approved words for the deterministic check.", { idempotencyKey: "assess-1" });
  const record = await store.load(CASE_ID);
  const candidate = record.candidate_responses.at(-1);
  const clean = assessSupervisorArtifact(record, candidate);
  assert.deepEqual([clean.exportable, clean.approved, clean.fresh, clean.refusal], [true, true, true, null]);
  assert.deepEqual(Object.values(clean.checks), [true, true, true, true, true]);
  assert.equal(submitted.artifact.review.approval_audit_id, clean.approval_audit_id, "the view and the check name the same approving audit");

  const variants = [
    ["the stored bytes differ from the audited bytes", (r, c) => { c.exact_text += " (edited)"; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["audit_does_not_bind_these_bytes"]],
    ["the draft's own digest differs from the stored bytes", (r, c) => { c.metadata.supervisor_draft.text_sha256 = "0".repeat(64); }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["audit_does_not_bind_these_bytes"]],
    ["the audit verdict is a failure", (r, c) => { c.audit_history.at(-1).verdict = "fail"; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["audit_not_passed"]],
    ["the audit was not independent", (r, c) => { c.audit_history.at(-1).independent = false; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["audit_not_passed"]],
    ["the candidate was never approved", (r, c) => { c.status = "audited"; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["approval_pending"]],
    ["the approval names another audit", (r, c) => { c.metadata.approval_audit_id = "audit:somewhere:else"; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["not_approved_for_delivery"]],
    ["the audit names another candidate version", (r, c) => { c.audit_history.at(-1).candidate_version = 9; }, "SUPERVISOR_ARTIFACT_NOT_APPROVED", ["audit_does_not_bind_these_bytes"]],
    ["the draft has no recorded basis", (r, c) => { delete c.metadata.supervisor_draft.basis; }, "SUPERVISOR_ARTIFACT_STALE", ["draft_basis_missing"]],
    ["a newer client message arrived", (r) => { r.raw_transcript.push({ id: "E9-user", exchange_id: "E9", role: "user", text: "Newer.", at: "2026-09-09T12:00:00.000Z" }); }, "SUPERVISOR_ARTIFACT_STALE", ["newer_client_message"]],
    ["another turn was added", (r) => { r.raw_transcript.push({ id: "E9-assistant", exchange_id: "E9", role: "assistant", text: "Other.", at: "2026-09-09T12:00:00.000Z" }); }, "SUPERVISOR_ARTIFACT_STALE", ["transcript_changed"]],
    ["the transcript was corrected", (r) => { r.transcript_amendments.push({ id: "amend:1", target_turn_id: "E2-user", effective_text_sha256: "1".repeat(64) }); }, "SUPERVISOR_ARTIFACT_STALE", ["transcript_corrected"]],
    ["the protective compatibility state changed", (r) => { r.case_state = { ...(r.case_state ?? {}), protective_compatibility: { synthetic_change: true } }; }, "SUPERVISOR_ARTIFACT_STALE", ["protective_compatibility_changed"]],
    ["a delivery about other text was recorded", (r) => { r.communication_events = [...(r.communication_events ?? []), { id: "evt:other", kind: "reported_sent", audience: "client", subject: { kind: "candidate", candidate_id: "candidate:other", candidate_version: 1 }, provenance: { origin: "owner_action" } }]; }, "SUPERVISOR_ARTIFACT_STALE", ["delivery_state_changed"]],
    ["an owner input was added", (r) => { r.supervisor_artifacts = [...r.supervisor_artifacts, { id: "input:late", kind: "input" }]; }, "SUPERVISOR_ARTIFACT_STALE", ["owner_input_added"]],
    ["a newer candidate became the current one", (r, c) => { r.candidate_responses.push({ ...structuredClone(c), id: "candidate:newer", version: 1, status: "pending_audit", metadata: {} }); }, "SUPERVISOR_ARTIFACT_STALE", ["not_the_current_candidate"]],
    ["the draft was superseded", (r, c) => { c.status = "superseded"; }, "SUPERVISOR_ARTIFACT_STALE", ["superseded_by_newer_draft"]],
    ["the draft was committed to the transcript", (r, c) => { c.status = "sent"; }, "SUPERVISOR_ARTIFACT_STALE", ["already_committed_to_transcript"]]
  ];
  for (const [why, change, code, reasons] of variants) {
    const copy = structuredClone(record);
    const copied = copy.candidate_responses.find((entry) => entry.id === candidate.id);
    change(copy, copied);
    const assessment = assessSupervisorArtifact(copy, copied);
    assert.equal(assessment.exportable, false, why);
    assert.equal(assessment.refusal.code, code, why);
    for (const reason of reasons) assert.ok(assessment.refusal.reasons.includes(reason), `${why}: ${assessment.refusal.reasons}`);
    assert.ok(assessment.refusal.reasons.every((reason) => /^[a-z_]{1,60}$/u.test(reason)), `${why}: reasons are fixed words`);
  }
});
