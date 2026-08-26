import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  MANDATORY_REALIZATION_INVARIANTS,
  MAP_SHA256,
  TASK,
  buildRelevantRouteProjection,
  buildRepresentationPrompt,
  sha256
} from "../scripts/run-a001-representation-experiment.mjs";

test("R1 places the whole map first, exact user content second, and neutral task last", () => {
  const architecture = "FROZEN MAP BYTES";
  const userMessage = "EXACT A001 BYTES";
  const prompt = buildRepresentationPrompt({ architecture, userMessage, mode: "r1" });

  assert.equal(prompt.system, "");
  assert.equal(
    prompt.user,
    `<therapy_map>\n${architecture}\n</therapy_map>\n\n<user_message>\n${userMessage}\n</user_message>\n\n<task>\n${TASK}\n</task>`
  );
  assert.ok(prompt.user.indexOf(architecture) < prompt.user.indexOf(userMessage));
  assert.ok(prompt.user.indexOf(userMessage) < prompt.user.indexOf(TASK));
  assert.doesNotMatch(prompt.user, /SUPPLIED THERAPY MAP/);
});

test("R2 changes only the architecture wrapper", () => {
  const prompt = buildRepresentationPrompt({
    architecture: "EXISTING-MAP PROJECTION",
    userMessage: "EXACT A001 BYTES",
    mode: "r2"
  });

  assert.match(prompt.user, /^<relevant_therapy_architecture>/);
  assert.doesNotMatch(prompt.user, /<therapy_map>/);
  assert.ok(prompt.user.endsWith(`\n${TASK}\n</task>`));
});

test("C+1 appends general mandatory invariants and a silent self-check after the neutral task", () => {
  const architecture = "EXISTING R2 PROJECTION";
  const userMessage = "EXACT A001 BYTES";
  const prompt = buildRepresentationPrompt({ architecture, userMessage, mode: "c1" });

  assert.equal(prompt.system, "");
  assert.ok(prompt.user.indexOf(architecture) < prompt.user.indexOf(userMessage));
  assert.ok(prompt.user.indexOf(userMessage) < prompt.user.indexOf(TASK));
  assert.ok(prompt.user.indexOf(TASK) < prompt.user.indexOf(MANDATORY_REALIZATION_INVARIANTS));
  assert.ok(prompt.user.endsWith(`\n${MANDATORY_REALIZATION_INVARIANTS}\n</mandatory_realization_invariants>`));
  assert.match(MANDATORY_REALIZATION_INVARIANTS, /silently check the draft/);
  assert.match(MANDATORY_REALIZATION_INVARIANTS, /they do not prescribe its formulation/);
  assert.doesNotMatch(MANDATORY_REALIZATION_INVARIANTS, /target answer|prior response|evaluation rubric/i);
});

test("R2 projection is selected from the frozen map and excludes whole-map topology", async () => {
  const map = await fs.readFile(new URL("../docs/INNER-CHILD-THERAPY-MAP.md", import.meta.url), "utf8");
  const projection = buildRelevantRouteProjection(map);

  assert.equal(sha256(map), MAP_SHA256);
  assert.match(projection, /## Credibility-route response contract/);
  assert.match(projection, /## Borrowed-care source ladder/);
  assert.match(projection, /## Credibility route — canonical sequence/);
  assert.match(projection, /Sequence is not speaker identity/);
  assert.match(projection, /Anger and resentment get a differential/);
  assert.match(projection, /Validation is not epistemic surrender/);
  assert.doesNotMatch(projection, /```mermaid/);
  assert.doesNotMatch(projection, /owner-approved overlay versus current executable graph/);
});
