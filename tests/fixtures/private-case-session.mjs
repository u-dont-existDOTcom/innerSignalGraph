import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../../src/storage/private-case-access.mjs";
import { runPrivateCandidateAudit } from "../../src/supervisor/private-candidate-audit.mjs";

const [action, credentialsPath, caseId, payloadPathOrUrl = null, outputPath = null] = process.argv.slice(2);
const token = process.env.INNER_SIGNAL_PRIVATE_CASE_TEST_TOKEN;
if (!action || !credentialsPath || !caseId || !token) throw new Error("Private case session fixture arguments are incomplete.");

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
    await service.saveCandidateResponse(caseId, payload.candidate_id, payload.candidate_text, payload.candidate_metadata, authContext);
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
