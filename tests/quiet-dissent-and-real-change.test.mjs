import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { longitudinalClinicalRules, sharedClinicalRules } from "../src/prompts/common.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { loadCompiledGuideGraphBundle } from "../src/guide-graph/compiler.mjs";

// Issue #206 (the owner's request of 29 Oct 2026): a quiet, wordless or bodily no keeps its place beside a fluent yes,
// and agreement, a convincing explanation or one good session is not taken for real change. The audit of 22 Nov 2026
// found every point already served, so nothing was reworded; the owner's answer i70 1b asked for the issue's six cases as
// tests. For each case, these tests pin the rules it relies on, on both surfaces: what a chat host receives from
// load_therapy_protocol (SKILL.md and its references) and what the app's model roles receive (their prompts and the
// compiled map). They fail if a later edit drops one of those rules; they do not show that a model follows them.

const fixture = JSON.parse(await fs.readFile(new URL("../corpus/quiet-dissent-cases.json", import.meta.url), "utf8"));
const protocol = loadTherapyProtocol();
const chatHost = new Map([["SKILL.md", protocol.instructions], ...protocol.files.map((file) => [file.path, file.content])]);
const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], recentTranscript: "", userMessage: "synthetic" };
const systemText = (prompt) => (typeof prompt === "string" ? prompt : prompt.system);
const app = new Map([
  ["sharedClinicalRules", sharedClinicalRules],
  ["longitudinalClinicalRules", longitudinalClinicalRules],
  ["caseExtraction", systemText(caseExtractionPrompt(context))],
  // The strategy-tracking rules (immediate versus durable evidence) are added when the candidate pipeline tracks a path.
  ["caseExtractionWithPathPerformance", systemText(caseExtractionPrompt({ ...context, pathPerformanceEnabled: true }))],
  ["caseAudit", systemText(caseAuditPrompt(context, {}))],
  ["realization", systemText(realizationPrompt(context, {}, "synthetic"))],
  ["compiledMap", JSON.stringify(await loadCompiledGuideGraphBundle())]
]);

test("the fixture holds the issue's six synthetic cases, each with rules on both surfaces", () => {
  assert.deepEqual(fixture.cases.map((entry) => entry.issue_case).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
  for (const entry of fixture.cases) {
    assert.ok(entry.conversation.length > 0 && entry.expected.trim(), `${entry.id} has a conversation and an expectation`);
    assert.ok(entry.chat_host.length > 0, `${entry.id} names chat-host rules`);
    assert.ok(entry.app.length > 0, `${entry.id} names app rules`);
  }
});

for (const entry of fixture.cases) {
  test(`case ${entry.issue_case} (${entry.id}): the rules it relies on reach chat hosts`, () => {
    for (const { file, text } of entry.chat_host) {
      assert.ok(chatHost.has(file), `${file} is served to chat hosts`);
      assert.ok(chatHost.get(file).includes(text), `${entry.id}: ${file} no longer says "${text}"`);
    }
  });

  test(`case ${entry.issue_case} (${entry.id}): the rules it relies on reach the app's roles`, () => {
    for (const { source, text } of entry.app) {
      assert.ok(app.has(source), `${source} is an app source this test reads`);
      assert.ok(app.get(source).includes(text), `${entry.id}: ${source} no longer says "${text}"`);
    }
  });
}
