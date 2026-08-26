import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  MANDATORY_REALIZATION_INVARIANTS,
  MAP_SHA256,
  MODEL,
  buildRelevantRouteProjection,
  buildRepresentationPrompt,
  sha256
} from "../scripts/run-a001-representation-experiment.mjs";
import {
  CRITIC_CONTRACT,
  INVARIANTS_SHA256,
  PROJECTION_SHA256,
  buildCriticPrompt
} from "../scripts/run-a001-two-pass-revision-experiment.mjs";
import { GPT_MODEL, GPT_REASONING_EFFORT } from "../scripts/run-a001-cross-family-critic-experiment.mjs";
import { CASE_X, CASE_Y } from "../scripts/run-cross-family-two-pass-experiment.mjs";

test("Cross-family flow changes only the critic family", async () => {
  const map = await fs.readFile(new URL("../docs/INNER-CHILD-THERAPY-MAP.md", import.meta.url), "utf8");
  const projection = buildRelevantRouteProjection(map);
  const pass1 = buildRepresentationPrompt({ architecture: projection, userMessage: "EXACT INPUT", mode: "c1" });
  const pass2 = buildCriticPrompt({ userMessage: "EXACT INPUT", draft: "EXACT FRESH DRAFT" });

  assert.equal(MODEL, "claude-sonnet-4-6");
  assert.equal(GPT_MODEL, "gpt-5.6-sol");
  assert.equal(GPT_REASONING_EFFORT, "high");
  assert.match(pass1.user, /<relevant_therapy_architecture>/);
  assert.match(pass1.user, new RegExp(MANDATORY_REALIZATION_INVARIANTS.slice(0, 48)));
  assert.doesNotMatch(pass2.user, /<relevant_therapy_architecture>|<therapy_map>/);
  assert.match(pass2.user, new RegExp(CRITIC_CONTRACT.slice(0, 48)));
  assert.equal(sha256(map), MAP_SHA256);
  assert.equal(sha256(projection), PROJECTION_SHA256);
  assert.equal(sha256(MANDATORY_REALIZATION_INVARIANTS), INVARIANTS_SHA256);
});

test("Anti-overfit cases are fixed and distinct", () => {
  assert.equal(
    CASE_X,
    "I cannot think of anyone I love or trust enough for the best-friend exercise. Imagining somebody who cared about me makes me feel more alone."
  );
  assert.equal(
    CASE_Y,
    "I made a choice that seriously hurt somebody. I understand why I did it, but it was still wrong and there are consequences."
  );
  assert.notEqual(sha256(CASE_X), sha256(CASE_Y));
});
