import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  A001_SHA256,
  MANDATORY_REALIZATION_INVARIANTS,
  MAP_SHA256,
  buildRelevantRouteProjection,
  sha256
} from "../scripts/run-a001-representation-experiment.mjs";
import {
  CRITIC_CONTRACT,
  INVARIANTS_SHA256,
  PROJECTION_SHA256,
  buildCriticPrompt
} from "../scripts/run-a001-two-pass-revision-experiment.mjs";
import {
  CONTROLLED_CRITIC_PROMPT_SHA256,
  FIXED_DRAFT_SHA256,
  GPT_MODEL,
  GPT_REASONING_EFFORT
} from "../scripts/run-a001-cross-family-critic-experiment.mjs";

test("Stage I changes critic model only and preserves the controlled prompt identities", () => {
  assert.equal(GPT_MODEL, "gpt-5.6-sol");
  assert.equal(GPT_REASONING_EFFORT, "high");
  assert.equal(FIXED_DRAFT_SHA256, "6805b23441f0c3a78bea98e497e7d0cc20325350b0486aae7dfd20d3bb37efdb");
  assert.equal(CONTROLLED_CRITIC_PROMPT_SHA256, "2b787220fd5be819afa2a7b13e3801104aa40a0c16c616e876014c731c8adb67");
  assert.equal(A001_SHA256, "13b6503e2557665add98fd4f96b3f841ec40c06a9bfda3c2a7442efc2baf19b6");
});

test("Stage-I GPT prompt is the same semantic critic input used for Sonnet", () => {
  const prompt = buildCriticPrompt({ userMessage: "EXACT A001", draft: "EXACT FIXED DRAFT" });
  assert.equal(prompt.system, "");
  assert.ok(prompt.user.indexOf("EXACT A001") < prompt.user.indexOf("EXACT FIXED DRAFT"));
  assert.ok(prompt.user.indexOf("EXACT FIXED DRAFT") < prompt.user.indexOf(MANDATORY_REALIZATION_INVARIANTS));
  assert.ok(prompt.user.indexOf(MANDATORY_REALIZATION_INVARIANTS) < prompt.user.indexOf(CRITIC_CONTRACT));
  assert.doesNotMatch(prompt.user, /<therapy_map>|<relevant_therapy_architecture>/);
});

test("Cross-family critic locks map, projection, and invariant bytes", async () => {
  const map = await fs.readFile(new URL("../docs/INNER-CHILD-THERAPY-MAP.md", import.meta.url), "utf8");
  assert.equal(sha256(map), MAP_SHA256);
  assert.equal(sha256(buildRelevantRouteProjection(map)), PROJECTION_SHA256);
  assert.equal(sha256(MANDATORY_REALIZATION_INVARIANTS), INVARIANTS_SHA256);
});
