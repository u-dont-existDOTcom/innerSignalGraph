import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("development replay admission is delegated to the preservation-aware helper", async () => {
  const worker = await fs.readFile(new URL("../src/dev/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /import \{ replayReviewRequiresRetry \} from "\.\/replay-review-admission\.mjs";/u);
  assert.match(worker, /if \(replayReviewRequiresRetry\(replayReview\)\)/u);
  assert.doesNotMatch(worker, /replayReview\.verdict === "not-improved" \|\|/u);
});

test("private candidate production delegates final text to the canonical assembler", async () => {
  const runtime = await fs.readFile(new URL("../src/supervisor/private-therapy-model-runtime.mjs", import.meta.url), "utf8");
  assert.match(runtime, /import \{ assembleCanonicalCandidateText \} from "\.\/canonical-candidate-text\.mjs";/u);
  assert.match(runtime, /exactText: assembleCanonicalCandidateText\(result\)/u);
  assert.doesNotMatch(runtime, /function finalCandidateText/u);
});

test("the consumer map keeps repository governance out of therapy and private packets", async () => {
  const map = await fs.readFile(new URL("../docs/INSTRUCTION-CONSUMER-MAP.md", import.meta.url), "utf8");
  assert.match(map, /not an always-injected checklist/u);
  assert.match(map, /Do not paste Universal, Mission Control, repository governance, or reasoning-selection prose into therapy system prompts/u);
  assert.match(map, /Private audit and repair receive only the authorized packet/u);
  assert.match(map, /Passing replay preservation or canonical candidate assembly is only admission to the existing next gate/u);
});
