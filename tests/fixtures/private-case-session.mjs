import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../../src/storage/private-case-access.mjs";
import { projectHandoffTherapeuticContinuity } from "../../src/storage/private-case-handoff.mjs";
import { runPrivateCandidateAudit } from "../../src/supervisor/private-candidate-audit.mjs";

const [action, credentialsPath, primaryId, payloadPathOrUrl = null, outputPath = null] = process.argv.slice(2);
const token = process.env.INNER_SIGNAL_PRIVATE_CASE_TEST_TOKEN;
if (!action || !credentialsPath || !primaryId || !token) throw new Error("Private case session fixture arguments are incomplete.");
const caseId = primaryId;

const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
const service = createPrivateCaseAccessService({
  rootDir: providers.rootDir,
  authorizationProvider: providers.authorizationProvider,
  keyProvider: providers.keyProvider,
  allowDevelopmentFileProvider: true,
  now: () => "2026-09-09T12:00:00.000Z"
});
const authContext = { bearerToken: token };
const writeJson = async (value) => {
  const body = `${JSON.stringify(value)}\n`;
  if (outputPath) await fs.writeFile(outputPath, body, { mode: 0o600 });
  else await new Promise((resolve, reject) => {
    process.stdout.write(body, (error) => error ? reject(error) : resolve());
  });
};

try {
  if (action === "seed") {
    const payload = JSON.parse(await fs.readFile(payloadPathOrUrl, "utf8"));
    await service.saveCaseState(caseId, payload.case_state, authContext);
    await service.saveCaseDiff(caseId, payload.state_diff, { turnId: payload.state_diff_turn_id, diffId: payload.state_diff_id }, authContext);
    for (const turn of payload.transcript_turns) await service.appendTranscriptTurn(caseId, turn, authContext);
    for (const candidate of payload.candidate_responses ?? [{ id: payload.candidate_id, exact_text: payload.candidate_text, metadata: payload.candidate_metadata }]) {
      await service.saveCandidateResponse(caseId, candidate.id, candidate.exact_text, candidate.metadata, authContext);
    }
    for (const entry of payload.tracker_entries ?? []) await service.appendTracker(caseId, entry, authContext);
    for (const entry of payload.journal_entries ?? []) await service.appendJournal(caseId, entry, authContext);
    for (const artifact of payload.source_artifacts ?? []) {
      await service.saveSourceArtifact(caseId, artifact.id, artifact.chunks, artifact.metadata, authContext);
    }
    await writeJson({ seeded: true, case_id: caseId, candidate_id: payload.candidate_id });
  } else if (action === "load") {
    const value = await service.loadCaseContext(caseId, authContext, {
      candidateId: process.env.INNER_SIGNAL_PRIVATE_CASE_CANDIDATE_ID ?? "current_pending",
      requireContinuationSafe: true,
      requireAuditScope: true,
      episodePolicy: { minimumCompleteExchanges: 3, requireCompleteEpisode: true }
    });
    await writeJson(value);
  } else if (action === "audit") {
    const value = await runPrivateCandidateAudit({
      caseAccessService: service,
      caseId,
      candidateId: process.env.INNER_SIGNAL_PRIVATE_CASE_CANDIDATE_ID ?? "current_pending",
      authContext,
      auditor: async (input) => ({ audited_exact_text: input.candidate_response, recent_turn_ids: input.recent_verbatim.turns.map((turn) => turn.id) })
    });
    await writeJson(value);
  } else if (action === "source") {
    const value = await service.getSourceArtifact(caseId, payloadPathOrUrl, authContext);
    if (!value) throw new Error("Exact source artifact was not found.");
    await writeJson(value);
  } else if (action === "handoff-create") {
    const receipt = await service.createHandoff(caseId, {
      handoffId: process.env.INNER_SIGNAL_PRIVATE_HANDOFF_ID,
      runtimeVersion: "synthetic-runtime-v1",
      auditVersion: "synthetic-audit-v1"
    }, authContext);
    const packet = await service.loadHandoff(receipt.handoff_id, authContext, { requireContinuationSafe: true });
    await writeJson({ ...receipt, session_a_decision_projection: projectHandoffTherapeuticContinuity(packet) });
  } else if (action === "handoff-load") {
    const packet = await service.loadHandoff(primaryId, authContext, { requireContinuationSafe: true });
    await writeJson({
      fresh_session_status: "FRESH_SESSION_GREEN",
      packet,
      decision_projection: projectHandoffTherapeuticContinuity(packet)
    });
  } else if (action === "candidate-by-id") {
    const candidate = await service.getPendingCandidateByReference({ candidateId: primaryId }, authContext);
    if (!candidate) throw new Error("Candidate response was not found.");
    await writeJson(candidate);
  } else if (action === "mcp-load") {
    const response = await fetch(payloadPathOrUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "load_case_context", arguments: { case_id: caseId, candidate_id: process.env.INNER_SIGNAL_PRIVATE_CASE_CANDIDATE_ID ?? "current_pending" } }
      })
    });
    const value = await response.json();
    const expectedPath = process.env.INNER_SIGNAL_PRIVATE_CASE_EXPECTED_PATH;
    if (!expectedPath) throw new Error("Expected private case fixture path is required for MCP verification.");
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf8"));
    assert.equal(response.status, 200);
    assert.equal(value.result.structuredContent.candidate_response.exact_text, expected.candidate_text);
    assert.deepEqual(value.result.structuredContent.recent_verbatim.turns, expected.transcript_turns.slice(2));
    assert.equal(value.result.structuredContent.continuation_safety.continuation_safe, true);
    await writeJson({ status: 200, exactCandidateVerified: true, exactRecentVerbatimVerified: true, continuationSafe: true });
  } else {
    throw new Error(`Unknown private case fixture action ${action}.`);
  }
} finally {
  providers.close();
}
