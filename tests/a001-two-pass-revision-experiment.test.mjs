import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
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

test("Pass 2 receives only A001, the exact draft, frozen invariants, and critic contract", () => {
  const userMessage = "EXACT A001 BYTES";
  const draft = "EXACT FRESH DRAFT BYTES";
  const prompt = buildCriticPrompt({ userMessage, draft });

  assert.equal(prompt.system, "");
  assert.equal(
    prompt.user,
    `<user_message>\n${userMessage}\n</user_message>\n\n<draft>\n${draft}\n</draft>\n\n<mandatory_realization_invariants>\n${MANDATORY_REALIZATION_INVARIANTS}\n</mandatory_realization_invariants>\n\n<task>\n${CRITIC_CONTRACT}\n</task>`
  );
  assert.ok(prompt.user.indexOf(userMessage) < prompt.user.indexOf(draft));
  assert.ok(prompt.user.indexOf(draft) < prompt.user.indexOf(MANDATORY_REALIZATION_INVARIANTS));
  assert.ok(prompt.user.indexOf(MANDATORY_REALIZATION_INVARIANTS) < prompt.user.indexOf(CRITIC_CONTRACT));
  assert.doesNotMatch(prompt.user, /<therapy_map>|<relevant_therapy_architecture>/);
});

test("Critic contract requires minimal invariant repair rather than replanning", () => {
  assert.match(CRITIC_CONTRACT, /Do not replace its formulation/);
  assert.match(CRITIC_CONTRACT, /Revise only actual invariant violations/);
  assert.match(CRITIC_CONTRACT, /Prefer the smallest repair/);
  assert.match(CRITIC_CONTRACT, /must stand alone/);
  assert.doesNotMatch(CRITIC_CONTRACT, /target answer|owner critique|evaluation rubric/i);
});

test("Two-pass experiment locks the map, projection, and final invariant bytes", async () => {
  const map = await fs.readFile(new URL("../docs/INNER-CHILD-THERAPY-MAP.md", import.meta.url), "utf8");
  const projection = buildRelevantRouteProjection(map);

  assert.equal(sha256(map), MAP_SHA256);
  assert.equal(sha256(projection), PROJECTION_SHA256);
  assert.equal(sha256(MANDATORY_REALIZATION_INVARIANTS), INVARIANTS_SHA256);
});
