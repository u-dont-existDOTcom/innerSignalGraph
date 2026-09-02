import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { buildHypnosisContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runHypnosisCompilerPipeline } from "../src/orchestrator/run-hypnosis-compiler.mjs";
import { auditHypnosisDraft } from "../src/hypnosis/deterministic-audit.mjs";
import { buildHypnosisPlaybackPlan, renderHypnosisRoute } from "../src/hypnosis/compiler.mjs";

const H001_FIXTURE_PATH = path.join(projectRoot, "fixtures/mock-responses/H001.json");

async function h001({ fixturePath = H001_FIXTURE_PATH, ledgerMode = "off", ledgerDir } = {}) {
  const casePath = path.join(projectRoot, "corpus/difficult-cases/H001-borrowed-adulthood-hypnosis/case.json");
  const definition = JSON.parse(await fs.readFile(casePath, "utf8"));
  const config = loadConfig({ mode: "mock", ledgerMode, ...(ledgerDir ? { ledgerDir } : {}) });
  const context = await buildHypnosisContext(definition.input, config);
  const providers = createProviders(config, { fixturePath });
  const providerCalls = {};
  for (const provider of new Set(Object.values(providers))) {
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) => {
      const key = request.metadata?.fixtureKey ?? request.metadata?.stage ?? "unknown";
      providerCalls[key] = (providerCalls[key] ?? 0) + 1;
      return generate(request);
    };
  }
  return { definition, config, context, providers, providerCalls };
}

async function modifiedFixture(t, mutate) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hypnosis-compiler-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = JSON.parse(await fs.readFile(H001_FIXTURE_PATH, "utf8"));
  mutate(fixture);
  const fixturePath = path.join(root, "H001.json");
  await fs.writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return { fixture, fixturePath, root };
}

test("H001 compiler applies one orientation-only patch and releases an app-owned plan", async () => {
  const { definition, config, context, providers, providerCalls } = await h001();
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.mode, "hypnosis-compiler");
  assert.equal(result.status, "releaseable");
  assert.equal(result.releaseable, true);
  assert.equal(result.deterministicAudit.ok, true);
  assert.equal(result.finalReview.verdict, "pass");
  assert.deepEqual(result.repairScope.seedComponentIds, ["orientation"]);
  assert.deepEqual(result.repairScope.componentIds, ["orientation"]);
  assert.equal(providerCalls.hypnosis_repair, 1);
  assert.equal(providerCalls.hypnosis_final_review, 1);
  assert.ok(result.playbackPlan);
  assert.match(result.playbackPlan.gate.intro, /Playback pauses here/);
  assert.doesNotMatch(result.playbackPlan.preGateTranscript, /close your eyes|deeper|count down/i);
  assert.doesNotMatch(result.playbackPlan.preGateTranscript, /Continue inward|Remain at this distance|Finish here/i);
});

test("app-owned route selection exposes only the selected route and one waking ending", async () => {
  const { definition, config, context, providers } = await h001();
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  const plan = result.playbackPlan;
  const inward = renderHypnosisRoute(plan, "continue_inward");
  const external = renderHypnosisRoute(plan, "stay_external");
  const end = renderHypnosisRoute(plan, "end_session");

  assert.match(inward, /You selected Continue inward/);
  assert.match(inward, /borrowed function/i);
  assert.doesNotMatch(inward, /You selected Remain at this distance/);
  assert.doesNotMatch(external, /three ordinary breaths|borrowed function receives/i);
  assert.match(external, /eyes open/i);
  assert.doesNotMatch(end, /induction|deepening|younger|borrowed function/i);

  for (const text of [inward, external, end]) {
    assert.equal((text.match(/This session is complete\./g) || []).length, 1);
    assert.ok(text.trim().endsWith("This session is complete."));
  }
});

test("deterministic audit rejects model attempts to own gate, ending, or external deepening", async () => {
  const fixture = JSON.parse(await fs.readFile(H001_FIXTURE_PATH, "utf8"));
  const base = fixture.anthropic.hypnosis_draft;
  const bad = structuredClone(base);
  bad.orientation = "Protector choice point. Playback pauses here.";
  bad.stay_external.grounding = "Close your eyes and go deeper toward the inner child.";
  bad.continue_inward.return_lead = "You are fully awake, clear, and present. This session is complete.";
  const audit = auditHypnosisDraft(bad);
  assert.equal(audit.ok, false);
  const codes = audit.issues.map((issue) => issue.code);
  assert.ok(codes.includes("model_emitted_gate_copy"));
  assert.ok(codes.includes("stay_external_advances_inward"));
  assert.ok(codes.includes("model_emitted_waking_return"));
});

test("playback renderer rejects missing or unknown route authorization", async () => {
  const fixture = JSON.parse(await fs.readFile(H001_FIXTURE_PATH, "utf8"));
  const plan = buildHypnosisPlaybackPlan(fixture.anthropic.hypnosis_draft);
  assert.throws(() => renderHypnosisRoute(plan, ""), (error) => error.code === "BAD_HYPNOSIS_ROUTE");
  assert.throws(() => renderHypnosisRoute(plan, "continue_anyway"), (error) => error.code === "BAD_HYPNOSIS_ROUTE");
});

test("H001 full local ledger proves patch-only scope and exact untouched identity", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hypnosis-ledger-full-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { definition, config, context, providers } = await h001({ ledgerMode: "full", ledgerDir: root });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  const ledger = JSON.parse(await fs.readFile(result.decisionLedgerPath, "utf8"));
  const fixture = JSON.parse(await fs.readFile(H001_FIXTURE_PATH, "utf8"));
  const original = fixture.anthropic.hypnosis_draft;
  const replacement = fixture.anthropic.hypnosis_repair.replacements[0].replacement;

  assert.equal(ledger.evidence.repairPatch.patch_version, "hypnosis-component-patch-v1");
  assert.deepEqual(ledger.evidence.repairPatch.replacements.map((item) => item.component_id), ["orientation"]);
  assert.equal(ledger.evidence.mergedDraft.orientation, replacement);
  assert.deepEqual(ledger.evidence.mergedDraft.continue_inward, original.continue_inward);
  assert.deepEqual(ledger.evidence.mergedDraft.stay_external, original.stay_external);
  assert.equal(ledger.evidence.mergedDraft.aftercare, original.aftercare);
  for (const key of ["target", "premise", "relationship", "scope", "design_notes"]) {
    assert.deepEqual(ledger.evidence.mergedDraft[key], original[key]);
  }
  assert.equal(ledger.evidence.preservation.allUnaffectedByteIdentical, true);
  assert.deepEqual(
    ledger.evidence.preservation.metadataHashesBefore,
    ledger.evidence.preservation.metadataHashesAfter
  );
  assert.equal(ledger.evidence.providerMetadata.repairer.requestId, "mock-anthropic-hypnosis_repair");
});

test("reduced hypnosis ledger retains structural evidence without hypnosis prose", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hypnosis-ledger-redacted-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { definition, config, context, providers } = await h001({ ledgerMode: "redacted", ledgerDir: root });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  const ledgerText = await fs.readFile(result.decisionLedgerPath, "utf8");
  const ledger = JSON.parse(ledgerText);
  const fixture = JSON.parse(await fs.readFile(H001_FIXTURE_PATH, "utf8"));

  assert.deepEqual(ledger.evidence.repairScope.componentIds, ["orientation"]);
  assert.equal(ledger.evidence.preservation.allUnaffectedByteIdentical, true);
  assert.equal(ledger.evidence.finalVerdict, "pass");
  assert.equal(ledger.evidence.repairPatch, undefined);
  assert.equal(ledger.evidence.mergedDraft, undefined);
  assert.doesNotMatch(ledgerText, new RegExp(fixture.anthropic.hypnosis_draft.orientation.slice(0, 45)));
  assert.doesNotMatch(ledgerText, new RegExp(fixture.anthropic.hypnosis_repair.replacements[0].replacement.slice(0, 45)));
  assert.doesNotMatch(ledgerText, new RegExp(context.userMessage.slice(0, 45)));
});

test("unauthorized patch component fails closed without final review or playback", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.anthropic.hypnosis_repair.replacements[0].component_id = "gate.intro";
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.status, "blocked");
  assert.equal(result.releaseable, false);
  assert.equal(result.playbackPlan, null);
  assert.equal(result.finalReview, null);
  assert.equal(result.repairFailure.code, "UNKNOWN_PATCH_COMPONENT");
  assert.equal(providerCalls.hypnosis_repair, 1);
  assert.equal(providerCalls.hypnosis_final_review ?? 0, 0);
});

test("blank patch replacement fails closed without partial merge or final review", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.anthropic.hypnosis_repair.replacements[0].replacement = "   ";
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.releaseable, false);
  assert.equal(result.playbackPlan, null);
  assert.equal(result.repairFailure.code, "PATCH_SCOPE_MISMATCH");
  assert.equal(providerCalls.hypnosis_repair, 1);
  assert.equal(providerCalls.hypnosis_final_review ?? 0, 0);
});

test("unrepairable deterministic metadata issue blocks before model repair", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.anthropic.hypnosis_draft.scope.memory = "memory-recovery";
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.releaseable, false);
  assert.equal(result.playbackPlan, null);
  assert.equal(result.repairFailure.code, "UNREPAIRABLE_DETERMINISTIC_ISSUE");
  assert.equal(providerCalls.hypnosis_repair ?? 0, 0);
  assert.equal(providerCalls.hypnosis_final_review ?? 0, 0);
});

test("adversarial block finding stops before repair and final review", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.openai.hypnosis_review = {
      verdict: "reject",
      strengths: [],
      findings: [{
        category: "target_scope",
        disposition: "block",
        target_ids: ["scope.memory"],
        summary: "The request would require changing locked memory scope."
      }]
    };
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.releaseable, false);
  assert.equal(result.repairFailure.code, "ADVERSARIAL_REJECT");
  assert.deepEqual(result.repairFailure.targetIds, ["scope.memory"]);
  assert.equal(providerCalls.hypnosis_repair ?? 0, 0);
  assert.equal(providerCalls.hypnosis_final_review ?? 0, 0);
});

test("malformed or app-owned review scope fails closed without prose inference", async (t) => {
  const { fixturePath, root } = await modifiedFixture(t, (fixture) => {
    fixture.openai.hypnosis_review.findings[0].target_ids = ["gate.intro"];
    fixture.openai.hypnosis_review.findings[0].summary = "PRIVATE REVIEW PROSE MUST NOT ENTER REDUCED LEDGER";
  });
  const { definition, config, context, providers, providerCalls } = await h001({
    fixturePath,
    ledgerMode: "redacted",
    ledgerDir: path.join(root, "ledger")
  });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  const ledgerText = await fs.readFile(result.decisionLedgerPath, "utf8");
  assert.equal(result.releaseable, false);
  assert.equal(result.repairFailure.code, "REVIEW_SCOPE_INVALID");
  assert.equal(result.repairScope, null);
  assert.doesNotMatch(ledgerText, /PRIVATE REVIEW PROSE/);
  assert.doesNotMatch(ledgerText, /gate\.intro/);
  assert.equal(providerCalls.hypnosis_repair ?? 0, 0);
  assert.equal(providerCalls.hypnosis_final_review ?? 0, 0);
});

test("a failed repaired audit cannot be overridden by final PASS or trigger another repair", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.anthropic.hypnosis_repair.replacements[0].replacement = "Close your eyes and drift deeper.";
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.status, "blocked");
  assert.equal(result.releaseable, false);
  assert.equal(result.finalReview.verdict, "pass");
  assert.equal(result.repairFailure.code, "REPAIRED_AUDIT_FAILED");
  assert.equal(result.playbackPlan, null);
  assert.equal(providerCalls.hypnosis_repair, 1);
  assert.equal(providerCalls.hypnosis_final_review, 1);
});

test("final-review revise or reject never starts a second repair cycle", async (t) => {
  for (const verdict of ["revise", "reject"]) {
    const { fixturePath } = await modifiedFixture(t, (fixture) => {
      fixture.openai.hypnosis_final_review.verdict = verdict;
      fixture.openai.hypnosis_final_review.remaining_issues = [`Final reviewer returned ${verdict}.`];
    });
    const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
    const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
    assert.equal(result.releaseable, false);
    assert.equal(result.finalReview.verdict, verdict);
    assert.equal(result.repairFailure.code, "FINAL_REVIEW_REVISE_OR_REJECT");
    assert.equal(providerCalls.hypnosis_repair, 1);
    assert.equal(providerCalls.hypnosis_final_review, 1);
  }
});

test("audit-green plus adversarial accept performs zero repair-provider calls", async (t) => {
  const { fixturePath } = await modifiedFixture(t, (fixture) => {
    fixture.anthropic.hypnosis_draft.orientation = fixture.anthropic.hypnosis_repair.replacements[0].replacement;
    fixture.openai.hypnosis_review = { verdict: "accept", strengths: ["No scoped repair is needed."], findings: [] };
  });
  const { definition, config, context, providers, providerCalls } = await h001({ fixturePath });
  const result = await runHypnosisCompilerPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.releaseable, true);
  assert.deepEqual(result.repairScope.componentIds, []);
  assert.equal(providerCalls.hypnosis_repair ?? 0, 0);
  assert.equal(providerCalls.hypnosis_final_review, 1);
});
