#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = relative => JSON.parse(read(relative));
const fail = (code, detail) => {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
};
const requireIncludes = (text, value, label) => {
  if (!text.includes(value)) fail("IMPLEMENTATION_ANCHOR_MISSING", `${label}: ${value}`);
};

const task = readJson("tasks/ACTIVE-TASK.json");
const outcome = readJson("tasks/pr46-completion-audit-20260909/OWNER-OUTCOME.json");
const directive = readJson("tasks/pr46-completion-audit-20260909/EXECUTION-DIRECTIVE.json");
const matrix = readJson("tasks/pr46-completion-audit-20260909/COMPLETION-MATRIX.json");

if (task.taskId !== "pr46-completion-audit-20260909" || !["active", "complete"].includes(task.status)) {
  fail("TASK_STATE_MISMATCH", "completion audit must be the active or just-completed task");
}
if (directive.ownerOutcomeId !== outcome.ownerOutcomeId || directive.taskId !== task.taskId) {
  fail("AUTHORITY_IDENTITY_MISMATCH", "task, directive, and owner outcome must agree");
}
if (matrix.status !== "READY_FOR_FINAL_GITHUB_CLOSEOUT") {
  fail("MATRIX_NOT_READY", matrix.status);
}

const expectedRows = new Set([
  "PATH_PERFORMANCE",
  "RELATIONAL_READINESS",
  "ROMANCE_SOURCE",
  "ROMANCE_RUNTIME",
  "ROMANCE_OPTIONAL_REFERENCE",
  "PRIVATE_CASE_BOUNDARY",
  "REPRESENTATION_DELIVERY",
  "EXTERNAL_MOVEMENT_SOURCE_AND_SCOPE",
  "LATENCY_VERIFY_BLOCKER",
  "CANONICAL_HANDOFF_COMPLETION_RECEIPT"
]);
const actualRows = new Set(matrix.rows.map(row => row.id));
if (actualRows.size !== expectedRows.size || [...expectedRows].some(id => !actualRows.has(id))) {
  fail("COMPLETION_ROWS_MISMATCH", `expected ${[...expectedRows].join(", ")}`);
}

const runIds = new Set(matrix.proofRuns.filter(run => run.result === "PASS" || run.result === "PASS_WITH_HOST_BOUNDARY_RERUN").map(run => run.id));
for (const row of matrix.rows) {
  if (row.status !== "VERIFIED_CURRENT_TREE") fail("ROW_NOT_VERIFIED", row.id);
  if (!row.requiredOutcomeIds?.length || !row.implementationAnchors?.length || !row.directTestAnchors?.length || !row.proofRunIds?.length) {
    fail("ROW_EVIDENCE_INCOMPLETE", row.id);
  }
  for (const relative of [...row.implementationAnchors, ...row.directTestAnchors]) {
    if (!fs.existsSync(path.join(root, relative))) fail("ROW_ANCHOR_MISSING", `${row.id}: ${relative}`);
  }
  for (const runId of row.proofRunIds) if (!runIds.has(runId)) fail("ROW_PROOF_RUN_MISSING", `${row.id}: ${runId}`);
  if (!row.observedCompletion?.trim()) fail("ROW_OBSERVATION_MISSING", row.id);
}

const coveredOutcomes = new Set(matrix.rows.flatMap(row => row.requiredOutcomeIds));
for (const requirement of outcome.requiredOutcomes) {
  if (requirement.terminalRequired && !coveredOutcomes.has(requirement.id)) fail("OWNER_OUTCOME_UNMAPPED", requirement.id);
}

const pathPerformance = read("src/case-formulation/path-performance.mjs");
for (const anchor of [
  'REPRESENTATION_MODES = Object.freeze(["CLEAR", "EXPERIENTIAL", "BRIDGE"])',
  '"REPRESENTATION_MISMATCH"',
  '"reality_testing_instability"',
  "The user owns every symbol and metaphor",
  "drawings are not projective tests",
  "explain any suggestion in plain language"
]) requireIncludes(pathPerformance, anchor, "path performance/representation");

for (const channel of ["PROSE_ANALYSIS", "FELT_SENSE_BODY", "IMAGE_DRAWING", "METAPHOR_STORY_POEM", "ENACTMENT_ROLE_DIALOGUE", "MOVEMENT_GESTURE"]) {
  requireIncludes(pathPerformance, channel, "representation channel");
}

const readiness = read("src/case-formulation/relational-readiness.mjs");
for (const anchor of ["PAUSE_ROMANCE", "NOT_BLOCKED", "nonRomanticSupportAllowed", "CURRENT_FORESEEABLE_HARM", "revisitable readiness markers"]) {
  requireIncludes(readiness, anchor, "relational readiness");
}

const romanceSource = readJson("tasks/romance-guide-20260907/OWNER-LINK-CONFIRMATION.json");
if (romanceSource.url !== "https://romance.u-dont-exist.com" || romanceSource.ownerConfirmedReachability !== true) {
  fail("ROMANCE_REFERENCE_AUTHORITY_MISMATCH", "canonical owner confirmation is missing");
}
const romanceReference = read("src/core/romance-reference.mjs");
requireIncludes(romanceReference, "CANONICAL_ROMANCE_REFERENCE_TOKENS", "romance reference allow-list");

const movementSource = read("guides/somatic-sequencing-guide.txt");
for (const anchor of [
  "loose, emerging, and not standardized as a clinical treatment",
  "not evidence that these elements are intrinsic to Butoh",
  "clear, specific, sober, revocable consent",
  "are adverse signals, not “deep work.”"
]) requireIncludes(movementSource, anchor, "external movement source");
requireIncludes(read("guides/source-layout.json"), "SOM.BUTOH_EXTERNAL", "external movement source layout");
const graphNodes = JSON.stringify(readJson("guide-graphs/compiled/bundle.json").graphs.flatMap(graph => graph.nodes ?? []));
if (/Butoh|ecstatic dance|BDSM/i.test(graphNodes)) fail("EXTERNAL_MOVEMENT_BECAME_AI_ROUTE", "external source material appears in selectable graph nodes");

const syntheticCases = readJson("tasks/audit-architecture-eval-20260907/cases.json");
if (syntheticCases.status !== "DE_IDENTIFIED_SYNTHETIC_FIXTURE" || syntheticCases.modelRuns !== 0) {
  fail("SYNTHETIC_FIXTURE_BOUNDARY_MISSING", "audit fixture must remain synthetic and unrun");
}
for (const key of ["containsRealPersonIdentifiers", "containsVerbatimPrivateTranscript", "containsExactPersonalAmounts", "containsExactLocations", "containsSourceConversationIdentifiers"]) {
  if (syntheticCases.privacy?.[key] !== false) fail("SYNTHETIC_PRIVACY_DECLARATION_MISSING", key);
}

const publicTaskText = [
  "tasks/pr46-completion-audit-20260909/OWNER-OUTCOME.json",
  "tasks/pr46-completion-audit-20260909/EXECUTION-DIRECTIVE.json",
  "tasks/pr46-completion-audit-20260909/ACTIVE-LESSON-CONTRACT.json",
  "tasks/pr46-completion-audit-20260909/COMPLETION-MATRIX.json",
  "tasks/pr46-completion-audit-20260909/INTEGRATION.md",
  "tasks/guide-source-sync-20260907/SOURCE-SYNC.json",
  "tasks/NEXT-CONVERSATION-HANDOFF-2026-09-07.md"
].map(read).join("\n");
if (/chatgpt-conversation:\/\/|"conversationId"|"messageId"|privateTranscriptText|realPersonName/i.test(publicTaskText)) {
  fail("PUBLIC_TASK_PRIVATE_SOURCE_SHAPE", "task files contain a private-source or identity-shaped field");
}

for (const forbidden of [
  "make provider, API, OpenRouter, or paid model calls",
  "merge PR 46 or any other pull request",
  "deploy, install, publish a release, or promote stable"
]) {
  if (!directive.forbiddenActions.includes(forbidden)) fail("RELEASE_BOUNDARY_MISSING", forbidden);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  taskId: task.taskId,
  matrixId: matrix.matrixId,
  verifiedRows: matrix.rows.length,
  coveredOwnerOutcomes: coveredOutcomes.size,
  state: "READY_FOR_FINAL_GITHUB_CLOSEOUT"
})}\n`);
