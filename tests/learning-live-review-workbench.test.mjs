import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local data contains the bounded owner review workbench and truthful warnings", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  assert.match(html, /<section class="learning-review-section"/);
  assert.match(html, /Local learning review/);
  assert.match(html, /Review generalized learning evidence saved on this device\./);
  assert.match(html, /no raw therapy transcript or assistant answer/i);
  assert.match(html, /cannot change InnerSignal therapy behavior/i);
  assert.match(html, /This is a local maintainer view\./);
  assert.match(html, /Anyone with access to this running InnerSignal instance/i);
  assert.match(html, /only changes triage status to/);
  assert.match(html, /It does not approve, install, or change therapy\./);
  for (const id of ["learning-review-refresh", "learning-review-availability", "learning-review-summary", "learning-review-records"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("review UI uses only the four same-origin review routes and six triage actions", async () => {
  const source = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const start = source.indexOf("const LEARNING_REVIEW_ROUTES");
  const end = source.indexOf("\nasync function postBinary", start);
  assert.ok(start >= 0 && end > start);
  const review = source.slice(start, end);
  const routes = [...review.matchAll(/"(\/v1\/learning\/review\/[^"\n]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes, [
    "/v1/learning/review/status",
    "/v1/learning/review/records",
    "/v1/learning/review/records/:receipt",
    "/v1/learning/review/records/:receipt/decision"
  ]);
  assert.doesNotMatch(review, /https?:\/\//);
  const dispositions = [...review.matchAll(/disposition: "([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(dispositions, [
    "reject",
    "insufficient-evidence",
    "duplicate",
    "personalization-process-only",
    "needs-external-evidence",
    "prepare-therapy-policy-decision"
  ]);
  for (const label of ["Reject", "Insufficient evidence", "Duplicate", "Personalization/process only", "Needs external evidence", "Flag for owner therapy-policy decision"]) {
    assert.match(review, new RegExp(label.replace("/", "\\/")));
  }
});

test("review UI renders required generalized fields without credential fields", async () => {
  const source = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const start = source.indexOf("const LEARNING_REVIEW_ROUTES");
  const end = source.indexOf("\nasync function postBinary", start);
  const review = source.slice(start, end);
  for (const field of ["candidateReceipt", "status", "feedbackCategory", "evidenceClass", "causalBoundary", "generalizedObservation", "occurrenceCount", "updatedAt", "userAuthoredSummary"]) {
    assert.match(review, new RegExp(field));
  }
  assert.match(review, /JSON\.stringify\(current\.candidate, null, 2\)/);
  assert.match(review, /if \(candidate\.userAuthoredSummary\)/);
  assert.match(review, /Queue unavailable — counts not shown\./);
  assert.match(review, /No zero count has been inferred\./);
  assert.doesNotMatch(review, /occurrenceHash|revocationHash|revocationToken|occurrenceToken|previewNonce|rawUserMessage|assistantAnswer|recentTranscript|private-learning|queue\.json/);
  assert.doesNotMatch(review, /innerHTML|insertAdjacentHTML|document\.write/);
});

test("review workbench styles remain responsive inside the existing Local Data surface", async () => {
  const css = await fs.readFile(path.join(root, "apps/web/styles.css"), "utf8");
  const source = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(css, /\.learning-review-section/);
  assert.match(css, /\.learning-review-records/);
  assert.match(css, /\.learning-review-card/);
  assert.match(css, /\.learning-review-detail/);
  assert.match(css, /\.learning-review-card h4 \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.learning-review-card dd \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.learning-review-detail pre \{[^}]*overflow: auto;[^}]*word-break: break-word;/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.learning-review-heading \{ flex-direction: column; \}[\s\S]*\.learning-review-card dl \{ grid-template-columns: 1fr; \}/);
  assert.match(source, /actions\.className = "actions wrap learning-review-actions";/);
});

test("refresh preserves its button reference across the async boundary", async () => {
  const source = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(source, /#learning-review-refresh[\s\S]*const button = event\.currentTarget;[\s\S]*try \{[\s\S]*await refreshLearningReview\(\);[\s\S]*\} finally \{[\s\S]*setBusy\(button, false\);/);
  assert.doesNotMatch(source, /await refreshLearningReview\(\);\s*setBusy\(event\.currentTarget, false\);/);
});
