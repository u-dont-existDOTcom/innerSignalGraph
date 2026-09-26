import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { roleBeliefIntegrityRules, ROLE_BELIEF_BLOCKING_CODES } from "../src/prompts/role-belief-integrity.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { hypnosisDraftPrompt } from "../src/prompts/hypnosis-draft.mjs";
import { hypnosisReviewPrompt } from "../src/prompts/hypnosis-review.mjs";
import { hypnosisRepairPrompt } from "../src/prompts/hypnosis-repair.mjs";
import { hypnosisFinalReviewPrompt } from "../src/prompts/hypnosis-final-review.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";

// These assertions verify activation, not semantic model adherence.
test("all affected prompt consumers receive the role/belief contract exactly once", () => {
  const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [],
    userMessage: "A synthetic report.", recentTranscript: "", hypnosisRequest: { target: "synthetic" } };
  const prompts = [caseExtractionPrompt(context), caseAuditPrompt(context, {}), candidatePrompt(context, "synthetic"),
    realizationPrompt(context, {}, "synthetic"), privateRuntimeAuditPrompt({}), privateRuntimeRepairPrompt({}),
    hypnosisDraftPrompt(context, "synthetic"), hypnosisReviewPrompt(context, {}, {}, "synthetic", "synthetic"),
    hypnosisRepairPrompt(context, {}, {}, {}, {}, "synthetic"), hypnosisFinalReviewPrompt(context, {}, {}, "synthetic")];
  for (const prompt of prompts) assert.equal(prompt.system.split(roleBeliefIntegrityRules).length - 1, 1);
  for (const code of ROLE_BELIEF_BLOCKING_CODES) assert.ok(roleBeliefIntegrityRules.includes(code));
});

test("plugin reference is the exact shared rule and activated in its skill", async () => {
  const base = new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/", import.meta.url);
  const skill = await fs.readFile(new URL("SKILL.md", base), "utf8");
  const reference = await fs.readFile(new URL("references/ROLE-BELIEF-INTEGRITY.md", base), "utf8");
  assert.ok(skill.includes("references/ROLE-BELIEF-INTEGRITY.md"));
  assert.ok(reference.endsWith(roleBeliefIntegrityRules));
});

function fallbackRuntime(findings, candidateId = "current") {
  return createPrivateTherapyModelRuntime({ providers: {}, config: {}, privateCaseSource: {
    async loadPrivateRuntimeCase() { return { case_state: { current_episode: { next_question: "Which detail would help clarify this?" } },
      candidate_responses: [{ id: candidateId, audit_history: [{ findings }] }] }; }
  } });
}

test("each unresolved substantive integrity code blocks only the current unaudited fallback", async () => {
  const args = { caseId: "synthetic", runtimeTurn: { id: "turn", current_candidate_id: "current" }, attemptContextId: "attempt" };
  for (const code of ROLE_BELIEF_BLOCKING_CODES) {
    const finding = { code, severity: "substantive", unresolved: true };
    await assert.rejects(() => fallbackRuntime([finding]).produceDiscriminator(args), (error) => error.code === "PRIVATE_DISCRIMINATOR_ROLE_BELIEF_BLOCKED");
    for (const runtime of [fallbackRuntime([{ ...finding, unresolved: false }]), fallbackRuntime([{ ...finding, severity: "low" }]),
      fallbackRuntime([finding], "unrelated-old-candidate"), fallbackRuntime([{ ...finding, code: "UNRELATED_UNCERTAINTY" }])]) {
      assert.equal((await runtime.produceDiscriminator(args)).exactText, "Which detail would help clarify this?");
    }
  }
});
