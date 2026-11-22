import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { candidatePrompt } from "../src/prompts/candidate.mjs";
import { critiquePrompt } from "../src/prompts/critique.mjs";
import { adjudicationPrompt } from "../src/prompts/adjudicate.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { loadCompiledGuideGraphBundle } from "../src/guide-graph/compiler.mjs";

// Issue #206 (the owner's request of 29 Oct 2026): a quiet, wordless or bodily no keeps its place beside a fluent yes,
// and agreement, a convincing explanation or one good session is not taken for real change. The audit of 22 Nov 2026
// found every point already served, so nothing was reworded; the owner's answer i70 1b asked for the issue's six cases as
// tests. For each case, these tests pin the rules it relies on where they are delivered: to a chat host by
// load_therapy_protocol (SKILL.md and its references, a map sentence inside its own box), and to the app's model roles
// (the role prompts that carry it, and the compiled-map node the planner hands on). They fail if a later edit drops one
// of those rules from that place; they do not show that a model follows them.

const fixture = JSON.parse(await fs.readFile(new URL("../corpus/quiet-dissent-cases.json", import.meta.url), "utf8"));

const protocol = loadTherapyProtocol();
const chatHost = new Map([["SKILL.md", protocol.instructions], ...protocol.files.map((file) => [file.path, file.content])]);
const BOX_FILE = "references/INNER-CHILD-BOX-GUIDANCE.md";

// One box of the served box file: from its "### ID:" heading to the next heading.
function boxSection(id) {
  const content = chatHost.get(BOX_FILE) ?? "";
  const start = content.indexOf(`\n### ${id}:`);
  if (start < 0) return null;
  const rest = content.slice(start + 1);
  const end = rest.slice(1).search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

const context = { guideManifest: { version: "synthetic" }, guideExcerpts: "", userFacts: [], recentTranscript: "", userMessage: "synthetic" };
const systemText = (prompt) => (typeof prompt === "string" ? prompt : prompt.system);
const roles = new Map([
  ["caseExtraction", systemText(caseExtractionPrompt(context))],
  // The strategy-tracking rules (immediate versus durable evidence) are added when the candidate pipeline tracks a path.
  ["caseExtractionWithPathPerformance", systemText(caseExtractionPrompt({ ...context, pathPerformanceEnabled: true }))],
  ["caseAudit", systemText(caseAuditPrompt(context, {}))],
  ["candidate", systemText(candidatePrompt(context, "synthetic"))],
  ["critique", systemText(critiquePrompt(context, {}, "synthetic", "synthetic"))],
  ["adjudication", systemText(adjudicationPrompt(context, {}, "synthetic"))],
  ["realization", systemText(realizationPrompt(context, {}, "synthetic"))]
]);

const bundle = await loadCompiledGuideGraphBundle();
const compiledNodes = new Map(bundle.graphs.flatMap((graph) => graph.nodes ?? []).map((node) => [node.id, JSON.stringify(node)]));

test("the fixture holds the issue's six synthetic cases, each with rules on both surfaces", () => {
  assert.deepEqual(fixture.cases.map((entry) => entry.issue_case).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);
  for (const entry of fixture.cases) {
    assert.ok(entry.conversation.length > 0 && entry.expected.trim(), `${entry.id} has a conversation and an expectation`);
    assert.ok(entry.chat_host.length > 0, `${entry.id} names chat-host rules`);
    assert.ok(entry.app.length > 0, `${entry.id} names app rules`);
    for (const pin of entry.chat_host) assert.ok(!pin.box || pin.file === BOX_FILE, `${entry.id}: a box is named only for ${BOX_FILE}`);
    for (const pin of entry.app) {
      assert.ok(Boolean(pin.node) !== Boolean(pin.roles?.length), `${entry.id}: an app rule names either roles or a node`);
      for (const role of pin.roles ?? []) assert.ok(roles.has(role), `${entry.id}: ${role} is a role prompt this test builds`);
    }
  }
});

for (const entry of fixture.cases) {
  test(`case ${entry.issue_case} (${entry.id}): the rules it relies on reach chat hosts`, () => {
    for (const { file, box, text } of entry.chat_host) {
      assert.ok(chatHost.has(file), `${file} is served to chat hosts`);
      if (box) {
        const section = boxSection(box);
        assert.ok(section, `${file} serves the box ${box}`);
        assert.ok(section.includes(text), `${entry.id}: the box ${box} no longer says "${text}"`);
      } else {
        assert.ok(chatHost.get(file).includes(text), `${entry.id}: ${file} no longer says "${text}"`);
      }
    }
  });

  test(`case ${entry.issue_case} (${entry.id}): the rules it relies on reach the app's roles`, () => {
    for (const { roles: names = [], node, text } of entry.app) {
      for (const name of names) assert.ok(roles.get(name).includes(text), `${entry.id}: the ${name} prompt no longer says "${text}"`);
      if (node) {
        assert.ok(compiledNodes.has(node), `the compiled map has the node ${node}`);
        assert.ok(compiledNodes.get(node).includes(text), `${entry.id}: the compiled node ${node} no longer says "${text}"`);
      }
    }
  });
}

test("a box section stops at the next box, so a sentence from a neighbouring box does not count", () => {
  const guard = boxSection("IC.MEET_GUARD");
  assert.ok(guard.startsWith("### IC.MEET_GUARD:"));
  assert.ok(!guard.includes("\n### ", 1));
  assert.ok(!guard.includes("Present danger and past childhood fear are different problems."), "that sentence belongs to IC.SAFETY_ORIENTATION");
});
