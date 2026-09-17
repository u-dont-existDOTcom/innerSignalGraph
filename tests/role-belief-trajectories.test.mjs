import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { roleBeliefIntegrityRules } from "../src/prompts/role-belief-integrity.mjs";
import { expandTrajectory, runRuntimeTrajectory } from "../tasks/role-belief-integrity-20260917/trajectory-runner.mjs";
import { makeScriptedProviders, SEEDED_DEFECTS } from "../tasks/role-belief-integrity-20260917/scripted-providers.mjs";

const corpus = JSON.parse(await fs.readFile(new URL("../corpus/role-belief-trajectories.json", import.meta.url), "utf8"));
const injectedCodes = {
  "ordinary-unsteered": "FALSE_ASSISTANT_IDENTITY",
  "self-condemnation-50": "HARMFUL_BELIEF_ENDORSEMENT",
  "gradual-role-reversal": "ROLE_REVERSAL_OR_DEPENDENCY",
  "correction-and-accountability": "CORRECTION_OR_ACCOUNTABILITY_ERASURE",
  "quotation-and-negation": "EPISTEMIC_PROVENANCE_LAUNDERING"
};

async function storage(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-synthetic-trajectory-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  return { rootDir, openStore: () => createEncryptedPrivateCaseStore({ rootDir,
    routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62), developmentExternalCredentialAuthorized: true }) };
}
const config = () => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });

for (const scenario of corpus.scenarios) {
  test(`scripted real runtime, persistence and audit: ${scenario.id}`, async (t) => {
    const { rootDir, openStore } = await storage(t);
    const messages = expandTrajectory(scenario);
    const defectCode = injectedCodes[scenario.id] ?? null;
    const { providers, counts } = await makeScriptedProviders({ scenario, defectCode, onPrompt({ input, stage, turn }) {
      assert.ok(input.system.includes(roleBeliefIntegrityRules), `${stage} must receive the semantic contract`);
      assert.ok(!input.user.includes('"review_focus"'), "review criteria must not reach the producer");
      if (stage === "case_extraction") {
        assert.ok(input.user.includes(messages[turn - 1]), "current exact message reaches generation");
        if (turn > 1) assert.ok(input.user.includes('"assertion_scope": "model_interpretation_only"'), "saved provenance reaches the next turn");
      }
    } });
    const { summary, evidence } = await runRuntimeTrajectory({ scenario, providers, config: config(), openStore,
      onExchange({ exchange, result, record }) {
        assert.equal(record.raw_transcript.at(-2).text, messages[exchange - 1]);
        assert.equal(record.raw_transcript.at(-1).text, result.answer);
        assert.ok(record.case_state.items.every((item) => item.status === "inference" && item.confidence === "low"));
        assert.equal(record.candidate_responses.at(-1).status, "sent");
      } });
    assert.equal(summary.status, "COMPLETED");
    assert.equal(summary.completed_exchanges, messages.length);
    assert.equal(summary.store_reopens, scenario.restart_before_turns?.length ?? 0);
    assert.equal(summary.semantic_verdict, "NOT_EVALUATED");
    assert.equal(summary.execution_class, "SCRIPTED_RUNTIME_ONLY");
    assert.equal(counts.case_extraction, messages.length);
    assert.equal(counts.realization, messages.length);
    assert.equal(counts.private_candidate_audit, messages.length + (defectCode ? 1 : 0));
    assert.equal(evidence.transcript.length, messages.length * 2);
    assert.equal(evidence.case_state.items.length, messages.length);
    if (defectCode) {
      const failed = evidence.candidate_responses.at(-2);
      assert.ok(failed.exact_text.includes(SEEDED_DEFECTS[defectCode]));
      assert.equal(failed.audit_history[0].findings[0].code, defectCode);
      assert.equal(failed.status, "superseded");
      assert.ok(!evidence.transcript.at(-1).text.includes(SEEDED_DEFECTS[defectCode]));
      assert.equal(evidence.candidate_responses.at(-1).repair_cycle, 1);
    }
    const reopened = openStore();
    try {
      assert.deepEqual((await reopened.load(`synthetic-${scenario.id}`)).case_state, evidence.case_state);
    } finally { reopened.close(); }
    const encrypted = await fs.readFile(path.join(rootDir, `synthetic-${scenario.id}.vault.json`), "utf8");
    assert.equal(encrypted.includes(messages[0]), false);
  });
}

test("unresolved role/belief failures cannot escape through the unaudited discriminator after two repairs", async (t) => {
  const { openStore } = await storage(t);
  const scenario = { id: "unresolved-fallback", synthetic: true, phases: [{ messages: ["Help me review an ordinary day."] }] };
  const { providers, counts } = await makeScriptedProviders({ scenario, defectCode: "FALSE_ASSISTANT_IDENTITY", failAllRepairs: true });
  await assert.rejects(() => runRuntimeTrajectory({ scenario, providers, config: config(), openStore }), (error) => {
    assert.equal(error.trajectoryProgress.status, "BLOCKED");
    assert.equal(error.trajectoryProgress.completed_exchanges, 0);
    assert.equal(error.trajectoryProgress.semantic_verdict, "NOT_EVALUATED");
    return error.code === "THERAPY_RUNTIME_UNAVAILABLE";
  });
  assert.equal(counts.private_candidate_audit, 3);
  assert.equal(counts.private_candidate_repair, 2);
  const reopened = openStore();
  try {
    const record = await reopened.load("synthetic-unresolved-fallback");
    assert.equal(record.raw_transcript.length, 1);
    assert.equal(record.raw_transcript[0].role, "user");
    assert.equal(record.runtime_turns[0].state, "DISCRIMINATING_QUESTION_REQUIRED");
  } finally { reopened.close(); }
});

test("the harness rejects accidental paid/live execution and invalid trajectory bounds before opening storage", async () => {
  const scenario = corpus.scenarios[0];
  const unopened = () => { throw new Error("Storage must not open."); };
  await assert.rejects(() => runRuntimeTrajectory({ scenario, config: { mode: "api" }, openStore: unopened }), /does not admit paid API/);
  await assert.rejects(() => runRuntimeTrajectory({ scenario, config: { mode: "cli" }, openStore: unopened }), /explicit opt-in/);
  assert.throws(() => expandTrajectory({ ...scenario, phases: [{ repeat: 100, messages: ["bounded"] }] }), /repetition bound/);
  assert.equal(expandTrajectory(corpus.scenarios.find((entry) => entry.id === "self-condemnation-50")).length, 50);
});
