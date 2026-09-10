import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { chunkExactSourceText } from "../src/storage/exact-source-artifact.mjs";
import { assessContinuationSafety } from "../src/storage/private-case-continuity.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createPrivateCaseOrchestrator } from "../src/supervisor/private-case-orchestration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASE_ID = "synthetic-private-orchestration";
const ORIGINAL_ID = "candidate:synthetic:version-1";
const REPAIR_ID = "candidate:synthetic:version-2";
const AUDIT_ID = "audit:synthetic:version-1";
const HANDOFF_ID = "handoff:00000000-0000-4000-8000-000000000222";
const NOW = "2026-09-10T14:00:00.000Z";

function turn(id, role, text) {
  return { id, exchange_id: "exchange:synthetic", role, text, at: NOW, episode_id: "episode:synthetic" };
}

function operation(operation, body = {}) {
  return { schema_version: 1, operation, case_id: CASE_ID, ...body };
}

function serviceFor(store) {
  return {
    getTranscriptAmendments: (caseId) => store.getTranscriptAmendments(caseId),
    appendTranscriptCompletionAmendment: (caseId, amendment) => store.appendTranscriptCompletionAmendment(caseId, amendment),
    getCandidateResponse: (caseId, selector) => store.getCandidateResponse(caseId, selector),
    recordCandidateAudit: (caseId, candidateId, evidence) => store.recordCandidateAudit(caseId, candidateId, evidence),
    reconstructCandidateResponse: (caseId, parentId, candidateId, exactText, metadata) => store.reconstructCandidateResponse(caseId, parentId, candidateId, exactText, metadata),
    approveCandidateForDelivery: (caseId, candidateId, auditId) => store.approveCandidateForDelivery(caseId, candidateId, auditId),
    markCandidateSent: (caseId, candidateId) => store.markCandidateSent(caseId, candidateId),
    createHandoff: (caseId, options) => store.createHandoff(caseId, options),
    async loadHandoff(handoffId) {
      try { return await store.loadHandoff(CASE_ID, handoffId); }
      catch (error) {
        if (error?.code === "PRIVATE_HANDOFF_NOT_FOUND") throw new PrivateCaseAccessDeniedError();
        throw error;
      }
    },
    async loadCaseContext(caseId, _authContext, options) {
      const context = await store.loadCaseContext(caseId, options);
      return { ...context, continuation_safety: assessContinuationSafety(context) };
    }
  };
}

async function makeHarness(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-orchestrator-"));
  const store = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 51),
    recoverySecretBytes: Buffer.alloc(32, 52),
    developmentExternalCredentialAuthorized: true,
    now: () => NOW
  });
  t.after(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const state = applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    current_episode: {
      id: "episode:synthetic",
      target: "Test private mutation lifecycle.",
      route: "SYNTHETIC.ROUTE",
      prediction: "Exact provenance remains intact.",
      next_question: "What changed?",
      started_turn_id: "turn:synthetic:user",
      constitutional_aim_ids: ["CARE"],
      adverse_signs: ["less choice"],
      stay_conditions: ["more information"],
      switch_conditions: ["no movement"],
      stop_conditions: ["decline"],
      source_item_ids: []
    }
  });
  await store.saveCaseState(CASE_ID, state);
  await store.saveCaseDiff(CASE_ID, { schema_version: 1, additions: [], current_episode_changed: true }, { turnId: "turn:synthetic:user", diffId: "diff:synthetic" });
  await store.appendTranscriptTurn(CASE_ID, turn("turn:synthetic:user", "user", "Synthetic raw prefix"));
  await store.saveSourceArtifact(CASE_ID, "source:synthetic:older", chunkExactSourceText("Synthetic older exact provenance."), { kind: "synthetic" });
  await store.saveCandidateResponse(CASE_ID, ORIGINAL_ID, "Synthetic candidate version one.", { producer_context_id: "session:producer:version-1" });
  const service = serviceFor(store);
  return { store, orchestrator: createPrivateCaseOrchestrator({ caseAccessService: service }) };
}

test("completion amendment preserves raw bytes and produces effective handoff context", async (t) => {
  const { store, orchestrator } = await makeHarness(t);
  const request = operation("append_transcript_completion", {
    amendment_id: "amendment:synthetic:completion",
    target_turn_id: "turn:synthetic:user",
    completion_text: " with an append-only completion.",
    source_artifact_id: "source:synthetic:completion",
    producer_context_id: "session:source:synthetic",
    source_metadata: { provenance: "synthetic-test" }
  });
  const first = await orchestrator.execute(request, {});
  const replay = await orchestrator.execute(request, {});
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  const record = await store.load(CASE_ID);
  assert.equal(record.raw_transcript[0].text, "Synthetic raw prefix");
  assert.equal(record.transcript_amendments.length, 1);
  assert.equal(record.source_artifacts.find((entry) => entry.id === request.source_artifact_id).exact_text, request.completion_text);
  const recent = await store.getRecentVerbatim(CASE_ID, { requireCompleteEpisode: true });
  assert.equal(recent.turns[0].text, `${record.raw_transcript[0].text}${request.completion_text}`);
  await assert.rejects(() => orchestrator.execute({ ...request, completion_text: " conflicting completion" }, {}), /conflicts with an existing immutable record/i);
});

test("failed v1 audit, v2 reconstruction, handoff retrieval, and delivery gates are exact-version-bound", async (t) => {
  const { store, orchestrator } = await makeHarness(t);
  const failedAudit = operation("record_candidate_audit", {
    candidate_id: ORIGINAL_ID,
    audit_id: AUDIT_ID,
    auditor_context: { kind: "independent", context_id: "session:auditor:version-1" },
    completed_at: NOW,
    result: { findings: [{ id: "finding:synthetic:v1", code: "CAUSAL_OVERCLAIM", severity: "substantive", summary: "Synthetic version one requires repair." }] }
  });
  const failureReceipt = await orchestrator.execute(failedAudit, {});
  assert.equal(failureReceipt.candidate_status, "audit_failed");
  assert.equal((await orchestrator.execute(failedAudit, {})).reused, true);

  const reconstruct = operation("reconstruct_candidate_and_create_handoff", {
    parent_candidate_id: ORIGINAL_ID,
    candidate_id: REPAIR_ID,
    exact_text: "Synthetic candidate version two.",
    producer_context_id: "session:auditor:version-1",
    based_on_audit_id: AUDIT_ID,
    handoff_id: HANDOFF_ID,
    runtime_version: "synthetic-runtime-v2",
    audit_version: "private-candidate-audit-v2"
  });
  const repairReceipt = await orchestrator.execute(reconstruct, {});
  assert.equal(repairReceipt.candidate_version, 2);
  assert.equal(repairReceipt.candidate_status, "reconstructed_pending_audit");
  assert.equal(repairReceipt.repair_cycle, 1);
  assert.equal(repairReceipt.next_action, "FRESH_INDEPENDENT_AUDIT");
  assert.equal(repairReceipt.delivery_allowed, false);
  assert.equal((await orchestrator.execute(reconstruct, {})).reused, true);

  const packet = await store.loadHandoff(CASE_ID, HANDOFF_ID);
  assert.equal(packet.schema_version, 2);
  assert.equal(packet.pending_artifacts.at(-1).id, REPAIR_ID);
  assert.equal(packet.pending_artifacts.at(-1).exact_text, reconstruct.exact_text);
  assert.equal(packet.candidate_lifecycle.current_candidate_version, 2);
  assert.equal(packet.candidate_lifecycle.reconstruction_audit_fidelity_status, "pending_fresh_independent_audit");
  await assert.rejects(() => orchestrator.execute(operation("approve_candidate_for_delivery", { candidate_id: REPAIR_ID, audit_id: AUDIT_ID }), {}), /fresh independent audit/i);

  const selfAudit = operation("record_candidate_audit", {
    candidate_id: REPAIR_ID,
    audit_id: "audit:synthetic:self-version-2",
    auditor_context: { kind: "independent", context_id: reconstruct.producer_context_id },
    completed_at: NOW,
    result: { findings: [], repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] }
  });
  await assert.rejects(() => orchestrator.execute(selfAudit, {}), /producer cannot certify/i);

  const passingAuditId = "audit:synthetic:fresh-version-2";
  const passingReceipt = await orchestrator.execute(operation("record_candidate_audit", {
    candidate_id: REPAIR_ID,
    audit_id: passingAuditId,
    auditor_context: { kind: "independent", context_id: "session:auditor:fresh-version-2" },
    completed_at: NOW,
    result: { findings: [], repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] }
  }), {});
  assert.equal(passingReceipt.candidate_status, "audited");
  const approval = await orchestrator.execute(operation("approve_candidate_for_delivery", { candidate_id: REPAIR_ID, audit_id: passingAuditId }), {});
  assert.equal(approval.candidate_status, "approved_for_delivery");
  assert.equal((await orchestrator.execute(operation("approve_candidate_for_delivery", { candidate_id: REPAIR_ID, audit_id: passingAuditId }), {})).reused, true);
  const sent = await orchestrator.execute(operation("mark_candidate_sent", { candidate_id: REPAIR_ID }), {});
  assert.equal(sent.candidate_status, "sent");
  assert.equal((await orchestrator.execute(operation("mark_candidate_sent", { candidate_id: REPAIR_ID }), {})).reused, true);
});

test("published private operation schemas compile strictly", async () => {
  const schemaDir = path.join(root, "schemas/private-case");
  const names = ["transcript-amendment-v1.schema.json", "candidate-audit-v1.schema.json", "candidate-version-v1.schema.json", "operation-request-v1.schema.json"];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(path.join(schemaDir, name), "utf8"))));
  const ajv = new Ajv2020({ strict: true, validateFormats: false });
  for (const schema of schemas) ajv.addSchema(schema);
  for (const schema of schemas) assert.equal(typeof ajv.getSchema(schema.$id), "function");
  const validateOperation = ajv.getSchema(schemas.at(-1).$id);
  assert.equal(validateOperation(operation("mark_candidate_sent", { candidate_id: REPAIR_ID })), true);
  assert.equal(validateOperation({ schema_version: 1, operation: "mutate_everything", case_id: CASE_ID }), false);
});
