import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateSupervisorDraftService } from "../src/supervisor/private-supervisor-draft.mjs";
import { createPrivateTherapyModelRuntime, responseEvidenceFailures } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, assessResponseEvidenceAdmission, buildEvidenceModelView, sha256Text } from "../src/supervisor/response-evidence-contract.mjs";
import { createSupervisorReplyTools } from "../src/server/supervisor-reply-tools.mjs";
import { createSupervisorReviewRunner } from "../src/supervisor/private-supervisor-review-runner.mjs";
import { seedReplyCase } from "./fixtures/supervisor-reply-environment.mjs";

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
      return { exactText: "A present-message reply.", contextId: "writer:backend", ...(responseEvidence ? { responseEvidenceInclusion: options.forgeWriter ? { ...inclusion(responseEvidence), view_sha256: "0".repeat(64) } : inclusion(responseEvidence) } : {}) };
    },
    async auditCandidate({ candidate, responseEvidence }) {
      const n = counts.audit++;
      calls.push({ stage: "audit", responseEvidence, candidate });
      if (options.onAudit) await options.onAudit({ store, candidate, responseEvidence, n });
      return { contextId: `auditor:${n}`, value: { findings: [], repair_induced_checks: candidate.parent_candidate_id ? REPAIR_INDUCED_ERROR_CHECKS : [],
        ...(responseEvidence ? { evidence_review: options.review?.(candidate, responseEvidence, n) ?? review() } : {}) },
        ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence), disclosureManifest: {
          response_evidence_snapshot_sha256: responseEvidence.snapshot.snapshot_sha256, response_evidence_view_sha256: responseEvidence.viewSha256
        } } : {}) };
    },
    async repairCandidate({ candidate, responseEvidence }) {
      const n = ++counts.repair;
      calls.push({ stage: "repair", responseEvidence, failures: responseEvidenceFailures(candidate.audit_history.at(-1)) });
      return { exactText: `A new suggestion, without assuming earlier delivery (${n}).`, contextId: `repair:${n}`, ...(responseEvidence ? { responseEvidenceInclusion: options.forgeRepair ? { ...inclusion(responseEvidence), view_sha256: "0".repeat(64) } : inclusion(responseEvidence) } : {}) };
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
  candidate.metadata.response_evidence_view_sha256 = "0".repeat(64);
  assert.equal(assessResponseEvidenceAdmission(record, candidate).code, "RESPONSE_EVIDENCE_INVALID");
  const forged = await environment(t, { forgeWriter: true });
  await assert.rejects(forged.submit(null, { source: "backend_produced" }), code("RESPONSE_EVIDENCE_INVALID"));
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
  assert.equal((await env.store.load(CASE)).candidate_responses.length, 1);
});

test("supervisor review disclosure manifest retains only rollback-safe boolean values", async (t) => {
  const env = await environment(t); await env.submit();
  const receipt = (await env.store.load(CASE)).supervisor_artifacts.find(e => e.kind === "review_receipt");
  assert.ok(Object.values(receipt.disclosure_manifest).every(value => typeof value === "boolean"));
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
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
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
