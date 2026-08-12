import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectRoot } from "../src/core/config.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import {
  loadLegacyA001BlockedRun,
  loadCheckpointCache,
  writeCheckpointCache,
  H001_PIPELINE_REVISION,
  A001_PIPELINE_REVISION
} from "../src/autopilot/resume-state.mjs";

const currentGuideVersion = "inner-child-somatic-pilot-2026-08-09-r5";
const priorCompatibleGuideVersion = "inner-child-somatic-pilot-2026-08-06-r1";
const selectedModels = { openai: "gpt-5.6-sol", anthropicPrimary: "claude-opus-5" };

async function fixtures() {
  const [bundle, a001Definition, g001] = await Promise.all([
    compileGuideGraphs({ write: false }),
    fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(projectRoot, "corpus/graph-cases/G001.json"), "utf8").then(JSON.parse)
  ]);
  return { bundle, a001Definition, g001 };
}

function h001(guideVersion = priorCompatibleGuideVersion) {
  return {
    ok: true,
    escalated: false,
    attempts: [{ attempt: 1 }],
    result: {
      mode: "hypnosis-compiler",
      status: "releaseable",
      releaseable: true,
      contractVersion: "hypnosis-components-v1",
      guideVersion,
      decisionLedgerId: "h001-ledger"
    }
  };
}

function a001({ guideVersion = priorCompatibleGuideVersion, variables, includeCoreText = true } = {}) {
  return {
    ok: false,
    escalated: true,
    result: {
      answer: includeCoreText
        ? "This is a credibility conflict. Relaxation alone does not settle the track record. The sarcastic question is a request for concrete evidence, and the next step is to distinguish which younger version is being blamed. Do one protective act without demanding trust, then show up again."
        : "A cautious but incomplete answer.",
      what_is_clear: [],
      uncertainties: [],
      next_question: includeCoreText ? "Which age or version of you is the resentment actually directed toward, and what opportunity do you believe that version failed to use?" : "",
      accepted_insights: [],
      rejected_claims: [],
      safety_flags: [],
      decision_summary: "The answer avoids categorical assignments.",
      guideVersion,
      graphBundleVersion: guideVersion,
      decisionLedgerId: "a001-ledger",
      caseFormulation: {
        user_goal: "Understand the internal conflict.",
        current_issue: "Credibility conflict.",
        direct_observations: [],
        variables,
        hypotheses: [],
        unknowns: []
      }
    }
  };
}

async function writeLegacyRun({ stateDir, a001Wrapper, h001Wrapper = h001() }) {
  const runDir = path.join(stateDir, "run-old");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "latest.json"), JSON.stringify({
    stage: "A001-adversarial-therapy-benchmark",
    runDir
  }));
  await fs.writeFile(path.join(runDir, "model-resolution.json"), JSON.stringify({
    selected: { openai: selectedModels.openai, anthropic: selectedModels.anthropicPrimary }
  }));
  await fs.writeFile(path.join(runDir, "H001-autopilot-result.json"), JSON.stringify(h001Wrapper));
  await fs.writeFile(path.join(runDir, "A001-autopilot-result.json"), JSON.stringify(a001Wrapper));
  return runDir;
}

test("prior v0.7 A001 preserves formulation and plan for a realization-only upgrade", async () => {
  const { bundle, a001Definition, g001 } = await fixtures();
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-resume-"));
  await writeLegacyRun({ stateDir, a001Wrapper: a001({ variables: g001.variables }) });

  const resumed = await loadLegacyA001BlockedRun({
    stateDir,
    selectedModels,
    guideVersion: currentGuideVersion,
    a001Definition,
    graphs: bundle.graphs
  });
  assert.equal(resumed.source, "legacy-a001-blocked-run-replanned");
  assert.equal(resumed.H001.ok, true);
  assert.equal(resumed.A001.ok, true);
  assert.equal(resumed.A001.needsRealizationUpgrade, true);
  assert.equal(resumed.A001.result.guideVersion, currentGuideVersion);
  assert.equal(resumed.A001.result.migratedFromGuideVersion, priorCompatibleGuideVersion);
  assert.ok(resumed.A001.result.interventionContract.selectedNodes.some((item) => item.id === "IC.BORROW_ONE_FUNCTION"));
  assert.ok(resumed.A001.result.interventionContract.requiredNuance.some((item) => /not only the younger state/i.test(item)));
});

test("checkpoint cache is atomic and requires matching models while accepting the bounded prior guide version", async () => {
  const { bundle, a001Definition, g001 } = await fixtures();
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-cache-"));
  const currentPlan = planFromGraphs({ variables: g001.variables, unknowns: [], graphs: bundle.graphs });
  const currentA001 = a001({ guideVersion: currentGuideVersion, variables: g001.variables });
  currentA001.ok = true;
  currentA001.result.interventionContract = currentPlan;

  await writeCheckpointCache({
    stateDir,
    selectedModels,
    guideVersion: currentGuideVersion,
    H001: h001(priorCompatibleGuideVersion),
    A001: {
      ...currentA001,
      acceptanceVersion: a001Definition.acceptanceVersion,
      acceptance: { ok: true }
    }
  });

  const resumed = await loadCheckpointCache({
    stateDir,
    selectedModels,
    guideVersion: currentGuideVersion,
    a001Definition,
    graphs: bundle.graphs
  });
  assert.equal(resumed.source, "resume-cache");
  assert.equal(resumed.H001.pipelineRevision, H001_PIPELINE_REVISION);
  assert.equal(resumed.A001.pipelineRevision, A001_PIPELINE_REVISION);
  assert.equal(resumed.A001.acceptance.ok, true);

  const wrongModel = await loadCheckpointCache({
    stateDir,
    selectedModels: { ...selectedModels, anthropicPrimary: "claude-fable-5" },
    guideVersion: currentGuideVersion,
    a001Definition,
    graphs: bundle.graphs
  });
  assert.equal(wrongModel, null);
});

test("legacy import preserves A001 reasoning even when old prose lacks the new realization contract", async () => {
  const { bundle, a001Definition, g001 } = await fixtures();
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-h001-only-"));
  await writeLegacyRun({ stateDir, a001Wrapper: a001({ variables: g001.variables, includeCoreText: false }) });

  const resumed = await loadLegacyA001BlockedRun({
    stateDir,
    selectedModels,
    guideVersion: currentGuideVersion,
    a001Definition,
    graphs: bundle.graphs
  });
  assert.equal(resumed.H001.ok, true);
  assert.equal(resumed.A001.needsRealizationUpgrade, true);
  assert.equal(resumed.A001.result.answer, "A cautious but incomplete answer.");
});
