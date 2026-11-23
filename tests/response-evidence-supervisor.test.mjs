import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ValidationError } from "../src/core/errors.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateSupervisorDraftService } from "../src/supervisor/private-supervisor-draft.mjs";
import { createPrivateTherapyModelRuntime, responseEvidenceFailures } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, createCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, assessResponseEvidenceAdmission, buildEvidenceModelView, sha256Text } from "../src/supervisor/response-evidence-contract.mjs";
import { createSupervisorReplyTools } from "../src/server/supervisor-reply-tools.mjs";
import { createSupervisorReviewRunner } from "../src/supervisor/private-supervisor-review-runner.mjs";
import { seedReplyCase } from "./fixtures/supervisor-reply-environment.mjs";
import { originMainPrivateCaseValidator } from "./helpers/origin-main-private-case-validator.mjs";

const CASE = "synthetic-evidence-supervisor", AUTH = {}, CHANNEL = "authenticated_agent";
const review = (items = []) => ({ coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic review of the whole reply." })), items, missing_material_history: [] });
const item = (text, dimension, sourceId) => ({ id: "premise", dimension, kind: "question_presupposition", candidate_quote: text, source_ids: [sourceId], assessment: "supported", reason: "Scripted support judgment; code checks the source's authority." });
const inclusion = (e) => ({ snapshot_id: e.snapshot.id, snapshot_sha256: e.snapshot.snapshot_sha256, view_sha256: e.viewSha256 });
const code = (expected) => (error) => error.code === expected;

async function environment(t, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-evidence-supervisor-"));
  const keys = { routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42) };
  const policy = options.policy ?? "enforced";
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true, responseEvidencePolicy: policy });
  await seedReplyCase(store, CASE);
  const accessOptions = { rootDir, responseEvidencePolicy: policy,
    authorizationProvider: { async authorize({ caseId, requiredScope, requiredPurpose }) {
      return { allowed: caseId === CASE, principalId: "synthetic-reviewer", scopes: [requiredScope], purposes: requiredPurpose ? [requiredPurpose] : [] };
    } }, keyProvider: { async getCaseKeyMaterial() { return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true }; } } };
  const access = createPrivateCaseAccessService(accessOptions);
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const calls = [], counts = { audit: 0, repair: 0, producer: 0 };
  const runtime = {
    async produceCandidate({ responseEvidence }) {
      calls.push({ stage: "producer", responseEvidence }); counts.producer++;
      if (options.onProduce) await options.onProduce({ store, responseEvidence });
      return { exactText: "A present-message reply.", contextId: "writer:backend", ...(responseEvidence ? { providerReceipt: { provider: "synthetic", model: "synthetic-writer", response_id: "response:writer" }, responseEvidenceInclusion: options.forgeWriter ? { ...inclusion(responseEvidence), view_sha256: "0".repeat(64) } : inclusion(responseEvidence) } : {}) };
    },
    async auditCandidate({ candidate, responseEvidence }) {
      const n = counts.audit++;
      calls.push({ stage: "audit", responseEvidence, candidate });
      if (options.onAudit) await options.onAudit({ store, candidate, responseEvidence, n });
      return { contextId: `auditor:${n}`, value: { findings: [], repair_induced_checks: candidate.parent_candidate_id ? REPAIR_INDUCED_ERROR_CHECKS : [],
        ...(responseEvidence ? { evidence_review: options.review?.(candidate, responseEvidence, n) ?? review() } : {}) },
        ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence), disclosureManifest: {
          response_evidence_view_included: true
        }, providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: `response:${n}` } } : {}) };
    },
    async repairCandidate({ candidate, responseEvidence }) {
      const n = ++counts.repair;
      calls.push({ stage: "repair", responseEvidence, failures: responseEvidenceFailures(candidate.audit_history.at(-1)) });
      return { exactText: `A new suggestion, without assuming earlier delivery (${n}).`, contextId: `repair:${n}`, ...(responseEvidence ? { providerReceipt: { provider: "synthetic", model: "synthetic-repair", response_id: `response:repair:${n}` }, responseEvidenceInclusion: options.forgeRepair ? { ...inclusion(responseEvidence), view_sha256: "0".repeat(64) } : inclusion(responseEvidence) } : {}) };
    }
  };
  const service = createPrivateSupervisorDraftService({ privateCaseSource: access, modelRuntime: runtime });
  const submit = (text = "A present-message reply.", extra = {}) => service.submitCandidateForReview({ caseId: CASE, source: "external_draft", text, idempotencyKey: "one", authContext: AUTH, channel: CHANNEL, ...extra });
  const exportDraft = (artifactId) => service.getApprovedResponseArtifact({ caseId: CASE, artifactId, authContext: AUTH, channel: CHANNEL });
  return { store, access, accessOptions, service, runtime, calls, counts, submit, exportDraft };
}

test("an external supervisor draft freezes before submission, carries review and supplier provenance, approves and exports exact bytes", async (t) => {
  const env = await environment(t);
  await env.service.prepareResponseContext({ caseId: CASE, authContext: AUTH, channel: CHANNEL, inputs: [
    { type: "client_message", text: "The owner relayed this client message.", idempotencyKey: "client" },
    { type: "supervisor_revision", text: "The supervisor requests a shorter reply.", idempotencyKey: "instruction" }
  ] });
  const result = await env.submit("  Exact café reply.\r\n  ");
  assert.equal(result.status, "approved"); assert.equal(result.exportable, true);
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1), snapshot = record.response_evidence_snapshots[0];
  assert.equal(record.schema_version, 7);
  assert.equal(snapshot.id, `snapshot:supervisor:${candidate.metadata.supervisor_draft.operation_key}:r1`);
  assert.deepEqual(snapshot.owner, { kind: "supervisor_draft", operation_key: candidate.metadata.supervisor_draft.operation_key });
  assert.equal(snapshot.inbound.exact_text_sha256, sha256Text(record.raw_transcript.at(-1).text));
  assert.equal(snapshot.journal.availability, "not_configured"); assert.deepEqual(snapshot.history_requirements, []);
  for (const kind of ["relayed_client_message", "supervisor_instruction"]) assert.deepEqual(snapshot.source_items.find((s) => s.kind === kind).supplied_by, { channel: CHANNEL, actor_resolution: "unresolved" });
  assert.equal(candidate.metadata.response_evidence.writer_inclusion, "not_attested");
  assert.equal(candidate.metadata.response_evidence.writer_inclusion_sha256, null);
  assert.equal(candidate.audit_history[0].audit_version, "private-candidate-audit-v5");
  assert.equal(candidate.audit_history[0].response_evidence.review.coverage.length, 5);
  assert.equal((await env.exportDraft(result.artifact.artifact_id)).client_text, "  Exact café reply.\r\n  ");
  assert.equal((await env.exportDraft(result.artifact.artifact_id)).replayed, true);
  assert.equal((await env.submit("  Exact café reply.\r\n  ")).replayed, true);
  assert.equal(env.counts.audit, 1); assert.equal((await env.store.load(CASE)).response_evidence_snapshots.length, 1);
  const scope = (await env.service.prepareResponseContext({ caseId: CASE, authContext: AUTH })).review_scope;
  assert.equal(scope.source_support_coverage, "enforced"); assert.equal(scope.owner_inputs_in_audit_packet, true);
  assert.equal(assessResponseEvidenceAdmission(await env.store.load(CASE), candidate).admissible, true);
});

test("presupposing an unsent earlier draft derives a blocking finding; a fully audited external-lineage repair is admitted", async (t) => {
  const env = await environment(t, { review(candidate, evidence, n) {
    if (n) return review();
    return review([item(candidate.exact_text, "prior_delivery", evidence.view.source_items.find((s) => s.kind === "unsent_draft").id)]);
  } });
  await env.store.saveCandidateResponse(CASE, "draft:earlier", "Earlier suggestion never sent.", { producer_context_id: "writer:earlier" });
  const result = await env.submit("How did the earlier suggestion I gave you go?");
  assert.equal(result.status, "approved"); assert.equal(env.counts.repair, 1);
  const record = await env.store.load(CASE), [root, repaired] = record.candidate_responses.slice(-2);
  assert.equal(root.audit_history[0].findings[0].code, "RESPONSE_EVIDENCE_SOURCE_INCOMPATIBLE");
  assert.equal(repaired.metadata.response_evidence.candidate_origin, "external_draft");
  assert.equal(repaired.metadata.response_evidence.writer_inclusion, "verified");
  assert.equal(repaired.metadata.response_evidence.writer_inclusion_sha256, buildEvidenceModelView(record, record.response_evidence_snapshots[0]).view_sha256);
  assert.equal(env.calls.find((c) => c.stage === "repair").responseEvidence.snapshot.id, root.metadata.response_evidence.snapshot_id);
  assert.equal(env.calls.find((c) => c.stage === "repair").failures[0].candidate_quote, root.exact_text);
  assert.equal((await env.exportDraft(result.artifact.artifact_id)).client_text, repaired.exact_text);
});

for (const kind of ["own report", "foreign report", "mixed report", "own export"]) test(`post-freeze ${kind} and retraction enforce the same admission and export rule`, async (t) => {
  const env = await environment(t), validateOld = await originMainPrivateCaseValidator(t);
  await env.store.saveCandidateResponse(CASE, "draft:foreign", "An earlier foreign draft.", { producer_context_id: "writer:foreign" });
  const result = await env.submit();
  let record = await env.store.load(CASE);
  const candidate = record.candidate_responses.at(-1), foreign = record.candidate_responses.find(entry => entry.id === "draft:foreign");
  assert.ok(record.response_evidence_snapshots[0].source_items.some(item => item.locator.candidate_id === foreign.id));
  const subject = kind === "mixed report" ? { kind: "unresolved", reason: "ambiguous", candidateRefs: [candidate, foreign].map(entry => ({ candidateId: entry.id, candidateVersion: entry.version })) }
    : { kind: "candidate", candidateId: kind === "foreign report" ? foreign.id : candidate.id, candidateVersion: kind === "foreign report" ? foreign.version : candidate.version };
  await env.store.recordCommunicationEvent(CASE, { eventId: "event:after-freeze", kind: kind === "own export" ? "exported" : "reported_sent", audience: "client", subject,
    provenance: { origin: "owner_action", sourceRef: null, quote: null } });
  const check = async () => {
    record = await env.store.load(CASE);
    assert.doesNotThrow(() => validateOld(structuredClone(record)));
    assert.equal(assessResponseEvidenceAdmission(record, candidate).admissible, kind === "own export");
    if (kind === "own export") assert.equal((await env.exportDraft(result.artifact.artifact_id)).client_text, candidate.exact_text);
    else await assert.rejects(env.exportDraft(result.artifact.artifact_id), code("SUPERVISOR_ARTIFACT_STALE"));
  };
  await check();
  await env.store.recordCommunicationEvent(CASE, { eventId: "event:retract-after-freeze", kind: "retraction", retractsEventId: "event:after-freeze",
    provenance: { origin: "owner_action", sourceRef: null, quote: null } });
  await check();
});

for (const correction of [false, true]) test(`retracting a repair's own-lineage source report blocks admission and export (replacement: ${correction})`, async (t) => {
  const validateOld = await originMainPrivateCaseValidator(t);
  let root;
  const env = await environment(t, {
    async onAudit({ store, candidate, n }) {
      if (n) return;
      root = candidate;
      await store.recordCommunicationEvent(CASE, { eventId: "report:own-draft", kind: "reported_sent", audience: "client",
        subject: { kind: "candidate", candidateId: root.id, candidateVersion: root.version },
        provenance: { origin: "owner_action", sourceRef: null, quote: null } });
      const state = await store.getCaseState(CASE); state.updated_at = "2026-11-23T20:00:00.000Z";
      await store.saveCaseState(CASE, state);
    },
    review(candidate, evidence, n) {
      return n ? review([item(candidate.exact_text, "prior_delivery", "src:report:report:own-draft")])
        : review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]);
    }
  });
  const result = await env.submit();
  assert.equal(result.exportable, true); assert.equal(env.counts.repair, 1);
  let record = await env.store.load(CASE), head = record.candidate_responses.at(-1);
  const snapshot = record.response_evidence_snapshots.at(-1);
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.source_items.find(s => s.id === "src:report:report:own-draft").locator.candidate_id, root.id);
  assert.equal(assessResponseEvidenceAdmission(record, head).admissible, true);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
  // Own exports/exposures appended after the freeze remain harmless, including their retractions.
  await env.exportDraft(result.artifact.artifact_id);
  await env.store.recordCommunicationEvent(CASE, { eventId: "exposure:own-repair", kind: "exposed", audience: "client",
    subject: { kind: "candidate", candidateId: head.id, candidateVersion: head.version },
    provenance: { origin: "application", sourceRef: null, quote: null } });
  await env.store.recordCommunicationEvent(CASE, { eventId: "retraction:own-exposure", kind: "retraction", retractsEventId: "exposure:own-repair",
    provenance: { origin: "owner_action", sourceRef: null, quote: null } });
  record = await env.store.load(CASE);
  assert.equal(assessResponseEvidenceAdmission(record, head).admissible, true);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
  await env.store.recordCommunicationEvent(CASE, { eventId: "retraction:own-report", kind: "retraction", retractsEventId: "report:own-draft",
    provenance: { origin: "owner_action", sourceRef: null, quote: null } });
  if (correction) await env.store.recordCommunicationEvent(CASE, { eventId: "report:corrected-own-draft", kind: "reported_sent", audience: "client",
    subject: { kind: "candidate", candidateId: root.id, candidateVersion: root.version }, sentAt: "2026-11-22T12:00:00.000Z",
    provenance: { origin: "agent_relayed", sourceRef: null, quote: null } });
  record = await env.store.load(CASE); head = record.candidate_responses.at(-1);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
  assert.equal(assessResponseEvidenceAdmission(record, head).code, "RESPONSE_EVIDENCE_STALE");
  const status = await env.submit();
  assert.equal(status.status, "approved"); assert.equal(status.exportable, false);
  await assert.rejects(env.exportDraft(result.artifact.artifact_id), code("SUPERVISOR_ARTIFACT_STALE"));
});

for (const defect of ["missing coverage", "unlocatable quote"]) for (const succeeds of [false, true]) {
  test(`malformed supervisor model review retries within two attempts (${defect}, recovery: ${succeeds})`, async (t) => {
    const validateOld = await originMainPrivateCaseValidator(t);
    const env = await environment(t), packets = [];
    const provider = { id: "synthetic-malformed-review", model: "synthetic",
      privateInferenceIsolation: { packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false },
      async generate(input) {
        const packet = JSON.parse(input.user.slice("AUTHORIZED AUDIT PACKET\n".length)); packets.push(packet);
        const evidenceReview = review();
        if (packets.length === 1 || !succeeds) {
          if (defect === "missing coverage") evidenceReview.coverage.pop();
          else evidenceReview.items.push(item("Words absent from the candidate.", "personal_history", "src:turn:E2-user"));
        }
        return { text: JSON.stringify({ findings: [], repair_induced_checks: [], evidence_review: evidenceReview }), responseId: `malformed:${packets.length}` };
      }
    };
    const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: env.access, providers: { anthropic: provider }, config: {} });
    const service = createPrivateSupervisorDraftService({ privateCaseSource: env.access, modelRuntime: runtime, maximumInvocationAttempts: 2 });
    const submit = () => service.submitCandidateForReview({ caseId: CASE, source: "external_draft", text: "Exact reply.", idempotencyKey: "malformed", authContext: AUTH });
    if (succeeds) assert.equal((await submit()).exportable, true);
    else await assert.rejects(submit(), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
    assert.equal(packets.length, 2);
    const record = await env.store.load(CASE);
    assert.equal(record.supervisor_invocations.filter(e => e.event_type === "STARTED").length, 2);
    assert.equal(record.supervisor_invocations.filter(e => e.event_type === "COMPLETED").length, succeeds ? 1 : 0);
    assert.equal(record.candidate_responses.at(-1).audit_history.length, succeeds ? 1 : 0);
    assert.doesNotThrow(() => validateOld(structuredClone(record)));
    if (!succeeds) {
      const runner = createSupervisorReviewRunner({ budgetMs: 1000, cooldownMs: 30_000, now: () => 0 });
      let jobs = 0;
      const work = () => { jobs++; return submit(); };
      await assert.rejects(runner.run({ caseId: CASE, lineage: "malformed", identity: "malformed:one", work }), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
      await assert.rejects(runner.run({ caseId: CASE, lineage: "malformed", identity: "malformed:two", work }), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
      assert.equal(jobs, 1); assert.equal(packets.length, 4);
    }
  });
}

test("alternate supervisor runtime results are validated and retried before store completion", async (t) => {
  const env = await environment(t, { review(_candidate, _evidence, n) {
    const result = review(); if (n === 0) result.coverage.pop(); return result;
  } });
  assert.equal((await env.submit()).exportable, true);
  assert.equal(env.counts.audit, 2);
  const record = await env.store.load(CASE);
  assert.deepEqual(record.supervisor_invocations.map(e => e.event_type), ["STARTED", "STARTED", "COMPLETED"]);
});

for (const boundary of ["startSupervisorInvocation", "completeSupervisorInvocation"]) {
  test(`supervisor store provenance refusal at ${boundary} never retries even with a validation marker`, async (t) => {
    const env = await environment(t); let calls = 0;
    const refusal = new ValidationError("Synthetic store provenance refusal.", { code: "RESPONSE_EVIDENCE_INVALID", details: { failure_origin: "model_output_validation" } });
    const service = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async [boundary]() { calls++; throw refusal; } }, modelRuntime: env.runtime });
    await assert.rejects(service.submitCandidateForReview({ caseId: CASE, source: "external_draft", text: "Exact reply.", idempotencyKey: "store-refusal", authContext: AUTH }), error => error === refusal);
    assert.equal(calls, 1); assert.equal(env.counts.audit, boundary === "startSupervisorInvocation" ? 0 : 1);
    const record = await env.store.load(CASE);
    assert.equal(record.supervisor_invocations.filter(e => e.event_type === "COMPLETED").length, 0);
    assert.equal(record.candidate_responses.at(-1).audit_history.length, 0);
  });
}

test("a supervisor instruction cited as client history is downgraded and blocks every version", async (t) => {
  const env = await environment(t, { review(candidate, evidence) {
    return review([item(candidate.exact_text, "personal_history", evidence.view.source_items.find((s) => s.kind === "supervisor_instruction").id)]);
  } });
  await env.service.prepareResponseContext({ caseId: CASE, authContext: AUTH, inputs: [{ type: "supervisor_revision", text: "Ask about work.", idempotencyKey: "instruction" }] });
  const result = await env.submit("You said work was difficult.");
  assert.equal(result.status, "blocked"); assert.equal(result.exportable, false); assert.equal(env.counts.repair, 2);
  const candidate = (await env.store.load(CASE)).candidate_responses.at(-1);
  assert.equal(candidate.audit_history[0].response_evidence.review.items[0].source_incompatible, true);
  assert.equal(candidate.audit_history[0].findings[0].code, "RESPONSE_EVIDENCE_SOURCE_INCOMPATIBLE");
  await assert.rejects(env.exportDraft(result.artifact.artifact_id));
});

for (const timing of ["during review", "after approval"]) test(`a new owner input ${timing} leaves a reviewed draft approved but refuses export with the existing outcome`, async (t) => {
  const addInput = (store) => store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:later", inputType: "supervisor_revision", text: "New context." }], channel: "owner_ui" });
  const env = await environment(t, timing === "during review" ? { onAudit: ({ store }) => addInput(store) } : {});
  let result = await env.submit();
  if (timing === "after approval") { await addInput(env.store); result = await env.submit(); }
  assert.equal(result.status, "approved"); assert.equal(result.exportable, false);
  assert.match(result.notice, /the case has changed since/);
  await assert.rejects(env.exportDraft(result.artifact.artifact_id), code("SUPERVISOR_ARTIFACT_STALE"));
  assert.equal((await env.store.load(CASE)).candidate_responses.at(-1).status, "approved_for_delivery");
});

test("a backend-produced root binds its writer receipt; forged inclusion is refused and repairs require their own full audit", async (t) => {
  const env = await environment(t);
  const result = await env.submit(null, { source: "backend_produced" });
  assert.equal(result.exportable, true);
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1);
  assert.equal(candidate.metadata.response_evidence.writer_inclusion, "verified");
  assert.equal(candidate.metadata.response_evidence_view_sha256, candidate.metadata.response_evidence.writer_inclusion_sha256);
  assert.equal(candidate.metadata.response_evidence_view_sha256, buildEvidenceModelView(record, record.response_evidence_snapshots[0]).view_sha256);
  record.supervisor_invocations.find(e => e.event_type === "COMPLETED" && e.input.stage === "candidate").output.exactText += " altered";
  assert.equal(assessResponseEvidenceAdmission(record, candidate).code, "RESPONSE_EVIDENCE_INVALID");
  const forged = await environment(t, { forgeWriter: true });
  await assert.rejects(forged.submit(null, { source: "backend_produced" }), code("RESPONSE_EVIDENCE_INVALID"));
  assert.equal(forged.counts.producer, 1);
  assert.equal((await forged.store.load(CASE)).candidate_responses.length, 0);
  const repaired = await environment(t, { review(candidate, evidence, n) { return n ? review() : review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]); } });
  const repairedResult = await repaired.submit(null, { source: "backend_produced" });
  assert.equal(repairedResult.exportable, true);
  const head = (await repaired.store.load(CASE)).candidate_responses.at(-1);
  assert.equal(head.metadata.response_evidence.candidate_origin, "backend_produced");
  assert.equal(head.metadata.response_evidence.writer_inclusion, "verified");
});

test("direct supervisor submission refuses a foreign operation, an older snapshot, a stale snapshot, and missing evidence", async (t) => {
  const env = await environment(t), record = await env.store.load(CASE);
  const operationKey = "a".repeat(24), inbound = { turn_id: "E2-user", exact_text_sha256: sha256Text(record.raw_transcript.at(-1).text), audience: "client", source_kind: "exact_client_turn" };
  const input = { snapshotId: "snapshot:direct:r1", owner: { kind: "supervisor_draft", operation_key: operationKey }, candidateOrigin: "external_draft", inbound };
  const snapshot = await env.store.freezeResponseEvidence(CASE, input);
  const submission = { operationKey, source: "external_draft", exactText: "Direct words.", producerContextId: "direct:writer", channel: "owner_ui", responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: null } };
  await assert.rejects(env.store.submitSupervisorDraft(CASE, { ...submission, responseEvidence: null }), code("RESPONSE_EVIDENCE_REQUIRED"));
  await assert.rejects(env.store.submitSupervisorDraft(CASE, { ...submission, operationKey: "b".repeat(24) }), code("RESPONSE_EVIDENCE_INVALID"));
  const newest = await env.store.freezeResponseEvidence(CASE, { ...input, snapshotId: "snapshot:direct:r2", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" });
  await assert.rejects(env.store.submitSupervisorDraft(CASE, submission), code("RESPONSE_EVIDENCE_INVALID"));
  await env.store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:move", inputType: "client_message", text: "Moved on." }], channel: "owner_ui" });
  await assert.rejects(env.store.submitSupervisorDraft(CASE, { ...submission, responseEvidence: { snapshotId: newest.id, writerInclusionSha256: null } }), code("RESPONSE_EVIDENCE_STALE"));
});

test("the connector tools use the governed real model runtime and review ticket without granting another scope", async (t) => {
  const env = await environment(t), source = env.access.supervisorDraftAccess.source, packets = [];
  const provider = { id: "synthetic-evidence-reviewer", model: "synthetic", privateInferenceIsolation: { packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false },
    async generate(input) {
      const packet = JSON.parse(input.user.slice("AUTHORIZED AUDIT PACKET\n".length)); packets.push(packet);
      return { text: JSON.stringify({ findings: [], repair_induced_checks: packet.repair_induced_error_checks, evidence_review: review() }), responseId: `response:${packets.length}` };
    } };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: { anthropic: provider, renderer: provider }, config: {} });
  const drafts = createPrivateSupervisorDraftService({ privateCaseSource: source, modelRuntime: runtime });
  const tools = createSupervisorReplyTools({ draftAccess: env.access.supervisorDraftAccess, drafts, runner: createSupervisorReviewRunner(), reviewAvailable: true });
  const result = await tools.call("submit_reply_draft", { case_id: CASE, source: "external_draft", text: "Exact connector words.", idempotency_key: "connector" }, AUTH);
  assert.equal(result.value.status, "approved"); assert.equal(packets.length, 1);
  assert.ok(packets[0].response_evidence); assert.equal(packets[0].response_evidence.journal.availability, "not_configured");
  const exported = await tools.call("export_approved_reply", { case_id: CASE, artifact_id: result.value.artifact.artifact_id }, AUTH);
  assert.equal(exported.value.client_text, "Exact connector words.");
  assert.deepEqual(tools.scopes("submit_reply_draft"), ["case:supervisor_draft"]);
  await assert.rejects(source.freezeResponseEvidence(CASE, {}, AUTH), code("PRIVATE_CASE_ACCESS_DENIED"));
  await assert.rejects(source.startSupervisorInvocation(CASE, {}, AUTH), code("PRIVATE_CASE_ACCESS_DENIED"));
  await assert.rejects(source.completeSupervisorInvocation(CASE, {}, AUTH), code("PRIVATE_CASE_ACCESS_DENIED"));
  await assert.rejects(source.recordSupervisorEvidenceStale(CASE, "missing", AUTH), code("PRIVATE_CASE_ACCESS_DENIED"));
});

test("connector status polling resumes a refreshable stale audit through the shared recovery rule", async (t) => {
  let paused = true;
  const env = await environment(t, { onAudit() { if (paused) throw new Error("unfinished audit"); } });
  await assert.rejects(env.submit());
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:status", targetTurnId: "E2-user", completionText: " More exact words.", sourceArtifactId: "source:status", producerContextId: "operator:completion" });
  paused = false;
  const drafts = createPrivateSupervisorDraftService({ privateCaseSource: env.access.supervisorDraftAccess.source, modelRuntime: env.runtime });
  const tools = createSupervisorReplyTools({ draftAccess: env.access.supervisorDraftAccess, drafts, runner: createSupervisorReviewRunner(), reviewAvailable: true });
  const result = await tools.call("get_reply_draft_status", { case_id: CASE, idempotency_key: "one" }, AUTH);
  assert.equal(result.value.status, "approved");
  assert.equal(env.counts.repair, 1);
  const record = await env.store.load(CASE);
  assert.deepEqual(record.response_evidence_snapshots.map(entry => entry.revision_reason), ["initial", "dependency_refresh"]);
  assert.equal(record.candidate_responses[0].audit_history[0].findings[0].code, "RESPONSE_EVIDENCE_STALE");
});

test("the advisory service creates no snapshot and sends no evidence to its models", async (t) => {
  const env = await environment(t, { policy: "advisory" });
  const result = await env.submit(); assert.equal(result.exportable, true);
  assert.deepEqual((await env.store.load(CASE)).response_evidence_snapshots, []);
  assert.equal(env.calls.every((call) => call.responseEvidence === undefined), true);
  assert.equal((await env.store.load(CASE)).candidate_responses.at(-1).audit_history[0].audit_version, "private-candidate-audit-v4");
});

test("a restart after freezing reuses that snapshot before the first successful backend writer", async (t) => {
  let outage = true;
  const env = await environment(t, { async onProduce({ store, responseEvidence }) {
    const record = await store.load(CASE);
    assert.equal(record.response_evidence_snapshots[0].id, responseEvidence.snapshot.id);
    assert.equal(record.candidate_responses.length, 0);
    if (outage) throw new Error("Synthetic producer outage.");
  } });
  await assert.rejects(env.submit(null, { source: "backend_produced" }), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
  const before = (await env.store.load(CASE)).response_evidence_snapshots;
  outage = false;
  const restarted = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async freezeResponseEvidence() { assert.fail("must reuse persisted freeze"); } }, modelRuntime: env.runtime });
  const result = await restarted.submitCandidateForReview({ caseId: CASE, source: "backend_produced", idempotencyKey: "one", authContext: AUTH });
  assert.equal(result.exportable, true); assert.deepEqual((await env.store.load(CASE)).response_evidence_snapshots, before);
});

test("a supervisor repair uses its lineage's newest snapshot and remains governed when the service setting later turns off", async (t) => {
  const env = await environment(t, { async onAudit({ store, responseEvidence, n }) {
    if (n) return;
    const snapshot = responseEvidence.snapshot;
    await store.freezeResponseEvidence(CASE, { snapshotId: "snapshot:repair:r2", owner: snapshot.owner, candidateOrigin: snapshot.candidate_origin,
      inbound: snapshot.inbound, revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" });
  }, review(candidate, evidence, n) { return n ? review() : review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]); } });
  const result = await env.submit(); assert.equal(result.exportable, true);
  let record = await env.store.load(CASE), head = record.candidate_responses.at(-1);
  assert.equal(head.metadata.response_evidence.snapshot_id, "snapshot:repair:r2");
  assert.equal(env.calls.find((call) => call.stage === "repair").responseEvidence.snapshot.id, "snapshot:repair:r2");
  const serviceOff = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, responseEvidencePolicy: "advisory" }, modelRuntime: env.runtime });
  const replayed = await serviceOff.submitCandidateForReview({ caseId: CASE, source: "external_draft", text: "A present-message reply.", idempotencyKey: "one", authContext: AUTH });
  assert.equal(replayed.replayed, true); assert.equal(replayed.exportable, true);
  await env.store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:after-off", inputType: "supervisor_revision", text: "New context." }], channel: "owner_ui" });
  record = await env.store.load(CASE); head = record.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(record, head, { policy: "advisory" }).code, "RESPONSE_EVIDENCE_STALE");
});

test("forged supervisor repair inclusion is refused atomically", async (t) => {
  const env = await environment(t, { forgeRepair: true, review(candidate, evidence, n) { return n ? review() : review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]); } });
  await assert.rejects(env.submit(), code("RESPONSE_EVIDENCE_INVALID"));
  assert.equal(env.counts.repair, 1);
  assert.equal((await env.store.load(CASE)).candidate_responses.length, 1);
});

test("supervisor review disclosure manifest retains only rollback-safe boolean values", async (t) => {
  const env = await environment(t); await env.submit();
  const receipt = (await env.store.load(CASE)).supervisor_artifacts.find(e => e.kind === "review_receipt");
  assert.ok(Object.values(receipt.disclosure_manifest).every(value => typeof value === "boolean"));
});

test("supervisor model output is sealed before audit persistence and cannot be asserted with a display receipt", async (t) => {
  const env = await environment(t);
  await env.submit();
  const record = await env.store.load(CASE);
  assert.equal(record.supervisor_invocations.length, 2);
  assert.deepEqual(record.supervisor_invocations.map(e => e.event_type), ["STARTED", "COMPLETED"]);
  const completed = record.supervisor_invocations[1], candidate = record.candidate_responses.at(-1);
  assert.equal(completed.input.candidate_id, candidate.id);
  assert.equal(completed.input.candidate_version, candidate.version);
  assert.equal(completed.input.candidate_sha256, sha256Text(candidate.exact_text));
  assert.equal(completed.actual_context_id, candidate.audit_history[0].auditor_context_id);
  const unsealed = structuredClone(record); unsealed.supervisor_invocations = [];
  assert.equal(assessResponseEvidenceAdmission(unsealed, candidate).code, "RESPONSE_EVIDENCE_INVALID");
});

test("a complete caller-supplied supervisor receipt cannot substitute for a completed invocation", async (t) => {
  const env = await environment(t, { onAudit() { throw new Error("pause before call completion"); } });
  await assert.rejects(env.submit());
  const before = await env.store.load(CASE), candidate = before.candidate_responses.at(-1), snapshot = before.response_evidence_snapshots[0];
  const audit = createCandidateAuditEvidence({ auditId: "audit:unsealed", candidate, auditorContext: { kind: "independent", context_id: "asserted:auditor" }, findings: [],
    responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256, auditorInclusionSha256: buildEvidenceModelView(before, snapshot).view_sha256, review: review(), snapshot } });
  await assert.rejects(env.store.recordSupervisorAudit(CASE, candidate.id, audit, {
    disclosureManifest: { response_evidence_view_included: true }, providerReceipt: { provider: "synthetic", model: "synthetic", response_id: "asserted" }
  }), code("RESPONSE_EVIDENCE_INVALID"));
  assert.deepEqual(await env.store.load(CASE), before);
});

test("a supervisor repair cannot be admitted by asserting the reconstructible inclusion digest", async (t) => {
  const env = await environment(t, { review(candidate) { return review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]); } });
  env.runtime.repairCandidate = async () => { throw new Error("pause repair"); };
  await assert.rejects(env.submit());
  const before = await env.store.load(CASE), head = before.candidate_responses.at(-1), snapshot = before.response_evidence_snapshots.at(-1);
  await assert.rejects(env.store.reconstructSupervisorDraft(CASE, head.id, { exactText: "Caller asserted repair.", producerContextId: "asserted:repair",
    writerInclusionSha256: buildEvidenceModelView(before, snapshot).view_sha256 }), code("RESPONSE_EVIDENCE_INVALID"));
  assert.deepEqual(await env.store.load(CASE), before);
});

test("an original supervisor audit completion and display receipt cannot certify a repaired candidate", async (t) => {
  const env = await environment(t, { onAudit({ n }) { if (n) throw new Error("pause repaired audit"); },
    review(candidate) { return review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]); } });
  await assert.rejects(env.submit());
  const before = await env.store.load(CASE), candidate = before.candidate_responses.at(-1), original = before.candidate_responses[0].audit_history[0];
  assert.ok(candidate.parent_candidate_id);
  const snapshot = before.response_evidence_snapshots.find(entry => entry.id === candidate.metadata.response_evidence.snapshot_id);
  const forged = createCandidateAuditEvidence({ auditId: "audit:repackaged", candidate, auditorContext: { kind: "independent", context_id: original.auditor_context_id },
    findings: [], repairInducedChecks: REPAIR_INDUCED_ERROR_CHECKS, responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256,
      auditorInclusionSha256: original.response_evidence.auditor_inclusion_sha256, review: review(), snapshot } });
  const receipt = before.supervisor_artifacts.find(entry => entry.kind === "review_receipt");
  for (const method of ["recordSupervisorAudit", "recordCandidateAudit"]) {
    await assert.rejects(env.store[method](CASE, candidate.id, forged, { disclosureManifest: receipt.disclosure_manifest, providerReceipt: receipt.provider_receipt }), code("RESPONSE_EVIDENCE_INVALID"));
    assert.deepEqual(await env.store.load(CASE), before);
  }
});

test("an unfinished supervisor writer refreshes amended sources even if the service setting turns off", async (t) => {
  let paused = true;
  const env = await environment(t, { onProduce({ responseEvidence }) {
    if (paused) throw new Error("unfinished writer");
    assert.equal(responseEvidence.snapshot.revision, 2);
  } });
  await assert.rejects(env.submit(null, { source: "backend_produced" }));
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:unfinished", targetTurnId: "E2-user", completionText: " More exact words.", sourceArtifactId: "source:unfinished", producerContextId: "operator:completion" });
  paused = false;
  const restarted = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, responseEvidencePolicy: "advisory" }, modelRuntime: env.runtime });
  const result = await restarted.submitCandidateForReview({ caseId: CASE, source: "backend_produced", idempotencyKey: "one", authContext: AUTH });
  assert.equal(result.status, "approved"); assert.equal(result.exportable, true);
  const record = await env.store.load(CASE);
  assert.deepEqual(record.response_evidence_snapshots.map(entry => entry.revision_reason), ["initial", "dependency_refresh"]);
  assert.equal(record.supervisor_invocations.find(entry => entry.event_type === "COMPLETED").input.snapshot_id, record.response_evidence_snapshots[1].id);
});

test("a completed supervisor writer survives an interleaved candidate and restart without a second call", async (t) => {
  const env = await environment(t);
  const interrupted = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async submitSupervisorDraft() {
    await env.store.saveCandidateResponse(CASE, "candidate:interleaved", "Another unsent draft.", { producer_context_id: "writer:other" });
    throw new Error("interrupted after completed writer");
  } }, modelRuntime: env.runtime });
  const input = { caseId: CASE, source: "backend_produced", idempotencyKey: "interleaved", authContext: AUTH, channel: CHANNEL };
  await assert.rejects(interrupted.submitCandidateForReview(input), /interrupted after completed writer/);
  const before = await env.store.load(CASE);
  assert.equal(env.counts.producer, 1);
  assert.equal(before.supervisor_invocations.filter(e => e.event_type === "COMPLETED" && e.input.stage === "candidate").length, 1);
  const restartedAccess = createPrivateCaseAccessService(env.accessOptions);
  const restarted = createPrivateSupervisorDraftService({ privateCaseSource: restartedAccess, modelRuntime: env.runtime });
  const result = await restarted.submitCandidateForReview(input);
  assert.equal(result.status, "approved"); assert.equal(result.exportable, true);
  assert.equal(env.counts.producer, 1);
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1);
  assert.equal(candidate.version, 2);
  assert.equal(candidate.producer_context_id, "writer:backend");
  assert.equal(record.supervisor_invocations.filter(e => e.event_type === "COMPLETED" && e.input.stage === "candidate").length, 1);
  assert.deepEqual(record.supervisor_invocations.slice(0, 2), before.supervisor_invocations, "submission preserves the sealed writer unchanged");
  assert.equal(record.supervisor_invocations.find(e => e.input.stage === "audit").input.candidate_version, candidate.version);
  assert.equal((await restarted.getApprovedResponseArtifact({ caseId: CASE, artifactId: result.artifact.artifact_id, authContext: AUTH, channel: CHANNEL })).client_text, candidate.exact_text);
});

test("enforced supervisor artifact projections and service status agree with refusal of legacy export", async (t) => {
  const env = await environment(t, { policy: "advisory" }), result = await env.submit();
  assert.equal(result.exportable, true);
  const access = createPrivateCaseAccessService({ ...env.accessOptions, responseEvidencePolicy: "enforced" });
  const service = createPrivateSupervisorDraftService({ privateCaseSource: access, modelRuntime: env.runtime });
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1), operationKey = candidate.metadata.supervisor_draft.operation_key;
  const snapshot = await service.prepareResponseContext({ caseId: CASE, authContext: AUTH });
  assert.equal(snapshot.artifacts.find(a => a.candidate_id === candidate.id).exportable, false);
  const status = await service.getReviewStatus({ caseId: CASE, operationKey, authContext: AUTH });
  assert.equal(status.exportable, false); assert.equal(status.artifact.exportable, false);
  await assert.rejects(service.submitCandidateForReview({ caseId: CASE, source: "external_draft", text: candidate.exact_text, idempotencyKey: "one", authContext: AUTH, channel: CHANNEL }), code("RESPONSE_EVIDENCE_REQUIRED"));
  await assert.rejects(service.getApprovedResponseArtifact({ caseId: CASE, artifactId: result.artifact.artifact_id, authContext: AUTH, channel: CHANNEL }), code("RESPONSE_EVIDENCE_REQUIRED"));
});

test("supervisor approval pre-check uses the enforced store policy before calling the approval mutation", async (t) => {
  const env = await environment(t, { policy: "advisory" });
  const paused = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async approveSupervisorDraft() { throw new Error("pause before approval"); } }, modelRuntime: env.runtime });
  await assert.rejects(paused.submitCandidateForReview({ caseId: CASE, source: "external_draft", text: "Legacy reviewed reply.", idempotencyKey: "legacy", authContext: AUTH }), /pause before approval/);
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1);
  assert.equal(candidate.status, "audited");
  let approvals = 0;
  const source = createPrivateCaseAccessService({ ...env.accessOptions, responseEvidencePolicy: "enforced" });
  const service = createPrivateSupervisorDraftService({ privateCaseSource: { ...source, async approveSupervisorDraft(...args) { approvals++; return source.approveSupervisorDraft(...args); } }, modelRuntime: env.runtime });
  await assert.rejects(service.resumeReview({ caseId: CASE, operationKey: candidate.metadata.supervisor_draft.operation_key, authContext: AUTH }), code("RESPONSE_EVIDENCE_REQUIRED"));
  assert.equal(approvals, 0);
  assert.deepEqual(await env.store.load(CASE), record);
});

test("one provider response may back only one immutable completed supervisor call", async (t) => {
  const env = await environment(t, { onAudit() { throw new Error("pause audit"); } });
  await assert.rejects(env.submit());
  const record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1), snapshot = record.response_evidence_snapshots.at(-1);
  const input = { operationKey: snapshot.owner.operation_key, stage: "audit", candidateId: candidate.id, snapshotId: snapshot.id };
  const started = await env.store.startSupervisorInvocation(CASE, { ...input, attemptContextId: "attempt:one" });
  const output = { contextId: "context:sealed:one", providerReceipt: { provider: "synthetic", model: "synthetic", response_id: "unique:response" },
    responseEvidenceInclusion: inclusion({ snapshot, viewSha256: buildEvidenceModelView(record, snapshot).view_sha256 }),
    value: { findings: [], repair_induced_checks: [], evidence_review: review() } };
  const completed = await env.store.completeSupervisorInvocation(CASE, { startedId: started.id, output });
  const beforeReplay = await env.store.load(CASE);
  assert.deepEqual(await env.store.completeSupervisorInvocation(CASE, { startedId: started.id, output }), completed);
  assert.deepEqual(await env.store.load(CASE), beforeReplay);
  await assert.rejects(env.store.completeSupervisorInvocation(CASE, { startedId: started.id, output: { ...output, contextId: "changed" } }), code("RESPONSE_EVIDENCE_INVALID"));
  const second = await env.store.startSupervisorInvocation(CASE, { ...input, attemptContextId: "attempt:two" });
  const before = await env.store.load(CASE);
  await assert.rejects(env.store.completeSupervisorInvocation(CASE, { startedId: second.id, output: { ...output, contextId: "context:sealed:two" } }), code("RESPONSE_EVIDENCE_INVALID"));
  assert.deepEqual(await env.store.load(CASE), before);
});

for (const stage of ["candidate", "audit", "repair"]) for (const changed of [false, true]) test(`restart records completed supervisor ${stage} before resolving sources (changed: ${changed})`, async (t) => {
  const env = await environment(t, { review(candidate, evidence, n) { return stage === "repair" && n === 0 ? review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]) : review(); } });
  const method = stage === "candidate" ? "submitSupervisorDraft" : stage === "audit" ? "recordSupervisorAudit" : "reconstructSupervisorDraft";
  const interrupted = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async [method]() { throw new Error("sealed output boundary"); } }, modelRuntime: env.runtime });
  const input = { caseId: CASE, source: stage === "candidate" ? "backend_produced" : "external_draft", ...(stage === "candidate" ? {} : { text: "Exact initial words." }), idempotencyKey: "sealed-restart", authContext: AUTH };
  await assert.rejects(interrupted.submitCandidateForReview(input), /sealed output boundary/);
  const before = await env.store.load(CASE), completion = before.supervisor_invocations.filter(e => e.event_type === "COMPLETED").at(-1);
  assert.equal(completion.input.stage, stage);
  if (changed) await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:sealed", targetTurnId: "E2-user", completionText: " More exact words.", sourceArtifactId: "source:sealed", producerContextId: "operator:completion" });
  let calls = 0;
  const noInference = Object.fromEntries(Object.keys(env.runtime).map(key => [key, async () => { calls++; assert.fail("record completion first"); }]));
  const recording = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async [method](...args) {
    await env.access[method](...args); throw new Error("completion recorded");
  } }, modelRuntime: noInference });
  await assert.rejects(recording.submitCandidateForReview(input), /completion recorded/);
  assert.equal(calls, 0);
  const after = await env.store.load(CASE);
  assert.equal(after.supervisor_invocations.filter(e => e.event_type === "COMPLETED" && e.input.stage === stage).length, 1);
  if (stage === "audit") assert.equal(after.candidate_responses.at(-1).audit_history.at(-1).auditor_context_id, completion.actual_context_id);
  else {
    assert.equal(after.candidate_responses.at(-1).exact_text, completion.output.exactText);
    assert.equal(after.candidate_responses.at(-1).metadata.response_evidence.dependency_status, changed ? "stale_at_commit" : "current_at_commit");
  }
});

test("origin/main preserves every supervisor invocation state, including repairs, through its own encrypted writes", async (t) => {
  const { originMainPrivateCaseModule } = await import("./helpers/origin-main-private-case-validator.mjs");
  const old = await originMainPrivateCaseModule(t);
  const env = await environment(t, { review(candidate, evidence, n) { return n === 0 ? review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]) : review(); } });
  const result = await env.submit(null, { source: "backend_produced" });
  await env.exportDraft(result.artifact.artifact_id);
  const before = await env.store.load(CASE);
  assert.deepEqual(before.supervisor_invocations.filter(e => e.event_type === "COMPLETED").map(e => e.input.stage), ["candidate", "audit", "repair", "audit"]);
  for (let count = 0; count <= before.supervisor_invocations.length; count++) {
    const prefix = structuredClone(before); prefix.supervisor_invocations = prefix.supervisor_invocations.slice(0, count);
    assert.doesNotThrow(() => old.validatePrivateCaseRecord(prefix));
  }
  const oldStore = old.createEncryptedPrivateCaseStore({ rootDir: env.access.rootDir, routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), developmentExternalCredentialAuthorized: true });
  try {
    assert.deepEqual((await oldStore.load(CASE)).supervisor_invocations, before.supervisor_invocations);
    await oldStore.saveCaseState(CASE, before.case_state);
  } finally { oldStore.close(); }
  assert.deepEqual((await env.store.load(CASE)).supervisor_invocations, before.supervisor_invocations);
});

test("governed supervisor audits bind the sealed input and output independently of display receipts", async (t) => {
  const env = await environment(t, { onAudit() { throw new Error("pause before audit"); } });
  await assert.rejects(env.submit(), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
  const before = await env.store.load(CASE), candidate = before.candidate_responses.at(-1), snapshot = before.response_evidence_snapshots[0];
  const audit = createCandidateAuditEvidence({ auditId: "audit:direct", candidate, auditorContext: { kind: "independent", context_id: "direct:auditor" }, findings: [],
    responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256, auditorInclusionSha256: buildEvidenceModelView(before, snapshot).view_sha256, review: review(), snapshot } });
  const receipt = { disclosureManifest: { response_evidence_view_included: true }, providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: "response:direct" } };
  const invalidReceipts = [undefined, {}, { ...receipt, providerReceipt: null }, { ...receipt, disclosureManifest: {} },
    { ...receipt, disclosureManifest: { response_evidence_view_included: "true" } }, { ...receipt, disclosureManifest: { response_evidence_view_included: false } },
    ...["provider", "model", "response_id"].map(key => ({ ...receipt, providerReceipt: { ...receipt.providerReceipt, [key]: " " } }))];
  for (const invalid of invalidReceipts) {
    await assert.rejects(env.store.recordSupervisorAudit(CASE, candidate.id, audit, invalid), code("RESPONSE_EVIDENCE_INVALID"));
    assert.deepEqual(await env.store.load(CASE), before);
  }
  await assert.rejects(env.store.recordSupervisorAudit(CASE, candidate.id, audit, receipt), code("RESPONSE_EVIDENCE_INVALID"));
  const started = await env.store.startSupervisorInvocation(CASE, { operationKey: snapshot.owner.operation_key, stage: "audit", candidateId: candidate.id,
    snapshotId: snapshot.id, attemptContextId: "attempt:direct:sealed" });
  await env.store.completeSupervisorInvocation(CASE, { startedId: started.id, output: { contextId: audit.auditor_context_id,
    providerReceipt: receipt.providerReceipt, responseEvidenceInclusion: inclusion({ snapshot, viewSha256: audit.response_evidence.auditor_inclusion_sha256 }),
    value: { findings: [], repair_induced_checks: [], evidence_review: review() } } });
  await env.store.recordSupervisorAudit(CASE, candidate.id, audit);
  const recorded = await env.store.load(CASE), head = recorded.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(recorded, head).admissible, true);
  for (const tamper of [
    ...["candidate_id", "candidate_version", "candidate_sha256", "snapshot_id", "snapshot_sha256", "view_sha256"].map(key => r => {
      const entry = r.supervisor_invocations.find(e => e.event_type === "COMPLETED"); entry.input[key] = typeof entry.input[key] === "number" ? 2 : "different";
    }),
    r => { r.supervisor_invocations.find(e => e.event_type === "COMPLETED").actual_context_id = "different"; },
    r => { r.supervisor_invocations.find(e => e.event_type === "COMPLETED").output.value.findings.push({ id: "lost", code: "SYNTHETIC", severity: "high", summary: "Must retain." }); },
    r => { r.supervisor_invocations.find(e => e.event_type === "COMPLETED").output.value.repair_induced_checks.push("different"); },
    r => { r.supervisor_invocations.find(e => e.event_type === "COMPLETED").output.value.evidence_review.coverage[0].reason += " changed"; }
  ]) {
    const altered = structuredClone(recorded); tamper(altered);
    assert.equal(assessResponseEvidenceAdmission(altered, head).code, "RESPONSE_EVIDENCE_INVALID");
  }
});

test("a received runtime message blocks the older supervisor draft before and after inbound commit", async (t) => {
  const env = await environment(t), result = await env.submit();
  const old = (await env.store.load(CASE)).candidate_responses.at(-1), audit = old.audit_history.at(-1);
  await env.store.beginPrivateRuntimeTurn(CASE, { runtimeTurnId: "runtime:newer", exchangeId: "exchange:newer", userTurnId: "turn:newer", exactText: "New exact client words." });
  for (const committed of [false, true]) {
    if (committed) await env.store.appendTranscriptTurn(CASE, { id: "turn:newer", exchange_id: "exchange:newer", role: "user", text: "New exact client words.", at: "2026-11-23T12:00:00.000Z", episode_id: null });
    const record = await env.store.load(CASE);
    assert.equal(assessResponseEvidenceAdmission(record, old).code, "RESPONSE_EVIDENCE_STALE");
    await assert.rejects(env.exportDraft(result.artifact.artifact_id), code("SUPERVISOR_ARTIFACT_STALE"));
    await assert.rejects(env.store.approveCandidateForDelivery(CASE, old.id, audit.id), code("RESPONSE_EVIDENCE_STALE"));
    await assert.rejects(env.store.deliverCandidateResponse(CASE, old.id, { auditId: audit.id, assistantTurnId: "turn:old-reply", inReplyToTurnId: "E2-user" }), code("RESPONSE_EVIDENCE_STALE"));
    assert.deepEqual(await env.store.load(CASE), record);
  }
});

for (const stage of ["audit", "repair"]) for (const amendment of [false, true]) test(`changed case refreshes before supervisor ${stage}, then blocks without inference when revisions run out (amendment: ${amendment})`, async (t) => {
  let paused = true;
  const env = await environment(t, { onAudit() { if (stage === "audit" && paused) throw new Error("pause audit"); },
    review(candidate) { return stage === "repair" ? review([{ ...item(candidate.exact_text, "personal_history", "src:turn:E2-user"), source_ids: [], assessment: "unsupported" }]) : review(); } });
  if (stage === "repair") env.runtime.repairCandidate = async () => { throw new Error("pause repair"); };
  await assert.rejects(env.submit(), code("SUPERVISOR_REVIEW_UNAVAILABLE"));
  paused = false;
  if (amendment) await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:pending", targetTurnId: "E2-user", completionText: " More exact words.", sourceArtifactId: "source:pending", producerContextId: "operator:completion" });
  else await env.store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:pending", inputType: "client_message", text: "The case moved on." }], channel: "owner_ui" });
  const before = await env.store.load(CASE), head = before.candidate_responses.at(-1), operationKey = head.metadata.supervisor_draft.operation_key;
  const pending = await env.service.getReviewStatus({ caseId: CASE, operationKey, authContext: AUTH });
  assert.equal(pending.status, "reviewing", "status polling must let refreshable work reach recovery");
  assert.deepEqual(await env.store.load(CASE), before);
  let calls = 0;
  env.runtime.auditCandidate = env.runtime.repairCandidate = async () => { calls++; assert.fail("refresh must precede inference"); };
  const refreshing = createPrivateSupervisorDraftService({ privateCaseSource: { ...env.access, async freezeResponseEvidence(...args) {
    const snapshot = await env.access.freezeResponseEvidence(...args);
    throw new Error(`refreshed:${snapshot.revision_reason}`);
  } }, modelRuntime: env.runtime });
  await assert.rejects(refreshing.resumeReview({ caseId: CASE, operationKey, authContext: AUTH }), /refreshed:dependency_refresh/);
  assert.equal(calls, 0);
  const second = (await env.store.load(CASE)).response_evidence_snapshots.at(-1);
  assert.equal(second.revision, 2);
  await env.store.freezeResponseEvidence(CASE, { snapshotId: "snapshot:exhausted:r3", owner: second.owner, candidateOrigin: second.candidate_origin,
    inbound: second.inbound, revision: 3, parentSnapshotId: second.id, revisionReason: "dependency_refresh" });
  await env.store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:exhausted", inputType: "client_message", text: "Changed again after the last revision." }], channel: "owner_ui" });
  const exhausted = await env.store.load(CASE);
  const restarted = createPrivateSupervisorDraftService({ privateCaseSource: env.access, modelRuntime: env.runtime });
  for (const read of [() => restarted.resumeReview({ caseId: CASE, operationKey, authContext: AUTH }), () => restarted.getReviewStatus({ caseId: CASE, operationKey, authContext: AUTH }), () => env.submit()]) {
    const result = await read();
    assert.equal(result.status, "blocked"); assert.equal(result.reason, "case_changed"); assert.equal(result.exportable, false);
    assert.match(result.notice, /case changed during review/); assert.match(result.notice, /[Nn]othing is approved/); assert.match(result.notice, /[Pp]repare the case again.*new draft/);
    assert.deepEqual(await env.store.load(CASE), exhausted);
  }
  assert.equal(calls, 0);
});

test("connector supervisor writes refuse another process's root lock without changing the case", async (t) => {
  const { spawn } = await import("node:child_process");
  const { setTimeout: delay } = await import("node:timers/promises");
  const env = await environment(t), rootDir = env.access.rootDir;
  const ticket = await env.access.supervisorDraftAccess.authorize(CASE, AUTH), source = env.access.supervisorDraftAccess.source;
  const ready = path.join(rootDir, "lock-ready");
  const lockModule = new URL("../src/storage/shared-case-coordinator.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs/promises";
    import { acquirePrivateRootWriterLock } from ${JSON.stringify(lockModule)};
    const lock = await acquirePrivateRootWriterLock({ rootDir: process.argv[1] });
    await fs.writeFile(process.argv[2], "ready");
    const timer = setInterval(() => {}, 1000);
    process.once("SIGTERM", async () => { clearInterval(timer); await lock.release(); });
  `, rootDir, ready], { stdio: "ignore" });
  const exited = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => { child.kill("SIGTERM"); await exited; });
  let found = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fs.stat(ready).then(() => true, () => false)) { found = true; break; }
    await delay(20);
  }
  assert.equal(found, true, "lock holder must signal readiness through a file");
  const before = await env.store.load(CASE);
  const snapshotInput = { snapshotId: "snapshot:locked", owner: { kind: "supervisor_draft", operation_key: "a".repeat(24) }, candidateOrigin: "external_draft",
    inbound: { turn_id: "E2-user", exact_text_sha256: sha256Text(before.raw_transcript.at(-1).text), audience: "client", source_kind: "exact_client_turn" } };
  const writes = [
    () => source.freezeResponseEvidence(CASE, snapshotInput, ticket),
    () => source.startSupervisorInvocation(CASE, {}, ticket),
    () => source.completeSupervisorInvocation(CASE, {}, ticket),
    () => source.recordSupervisorEvidenceStale(CASE, "missing", ticket),
    () => source.submitSupervisorDraft(CASE, {}, ticket),
    () => source.recordSupervisorAudit(CASE, "missing", {}, {}, ticket),
    () => source.approveCandidateForDelivery(CASE, "missing", "missing", ticket),
    () => source.reconstructSupervisorDraft(CASE, "missing", {}, ticket),
    () => source.exportSupervisorArtifact(CASE, {}, AUTH),
    () => source.recordSupervisorReport(CASE, {}, AUTH)
  ];
  for (const write of writes) {
    await assert.rejects(write(), code("PRIVATE_ROOT_WRITER_ACTIVE"));
    assert.deepEqual(await env.store.load(CASE), before);
  }
  child.kill("SIGTERM"); await exited;
  assert.equal((await source.freezeResponseEvidence(CASE, snapshotInput, ticket)).id, snapshotInput.snapshotId);
});

test("origin/main reads a governed supervisor draft through export", async (t) => {
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const validateOld = await originMainPrivateCaseValidator(t);
  const env = await environment(t); const result = await env.submit(); await env.exportDraft(result.artifact.artifact_id);
  const record = await env.store.load(CASE);
  assert.equal(record.supervisor_artifacts.find(e => e.kind === "review_receipt").disclosure_manifest.response_evidence_view_included, true);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
  await env.store.beginPrivateRuntimeTurn(CASE, { runtimeTurnId: "runtime:pending", exchangeId: "exchange:pending", userTurnId: "turn:pending", exactText: "Pending client words." });
  const pending = await env.store.load(CASE);
  assert.doesNotThrow(() => validateOld(structuredClone(pending)));
  await env.store.freezeResponseEvidence(CASE, { snapshotId: "snapshot:with-pending-inbound", owner: { kind: "supervisor_draft", operation_key: "c".repeat(24) }, candidateOrigin: "external_draft", inbound: record.response_evidence_snapshots[0].inbound });
  const frozenWithPending = await env.store.load(CASE);
  assert.notEqual(frozenWithPending.response_evidence_snapshots.at(-1).dependency_binding.transcript_digest, record.response_evidence_snapshots[0].dependency_binding.transcript_digest);
  assert.doesNotThrow(() => validateOld(structuredClone(frozenWithPending)));
});

test("a source amended during supervisor review preserves approval without allowing export", async (t) => {
  const env = await environment(t, { async onAudit({ store }) {
    await store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:during-review", targetTurnId: "E2-user", completionText: " More exact words.", sourceArtifactId: "source:during-review", producerContextId: "operator:completion" });
  } });
  const result = await env.submit();
  assert.equal(result.status, "approved"); assert.equal(result.exportable, false);
  assert.match(result.notice, /the case has changed since/);
  await assert.rejects(env.exportDraft(result.artifact.artifact_id), code("SUPERVISOR_ARTIFACT_STALE"));
});

test("connector supervisor writes reuse the root lock already held by the host process", async (t) => {
  const { acquirePrivateRootWriterLock } = await import("../src/storage/shared-case-coordinator.mjs");
  const env = await environment(t), lock = await acquirePrivateRootWriterLock({ rootDir: env.access.rootDir });
  try {
    const access = createPrivateCaseAccessService({ ...env.accessOptions, heldRootDir: lock.rootDir });
    const ticket = await access.supervisorDraftAccess.authorize(CASE, AUTH);
    const record = await env.store.load(CASE);
    const snapshot = await access.supervisorDraftAccess.source.freezeResponseEvidence(CASE, {
      snapshotId: "snapshot:host-held", owner: { kind: "supervisor_draft", operation_key: "a".repeat(24) }, candidateOrigin: "external_draft",
      inbound: { turn_id: "E2-user", exact_text_sha256: sha256Text(record.raw_transcript.at(-1).text), audience: "client", source_kind: "exact_client_turn" }
    }, ticket);
    assert.equal(snapshot.id, "snapshot:host-held");
  } finally { await lock.release(); }
});
