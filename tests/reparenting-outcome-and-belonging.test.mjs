import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { protocolProvenanceRules } from "../src/prompts/protocol-provenance.mjs";

const read = (file) => readFile(new URL("../" + file, import.meta.url), "utf8");
const nodeById = (graph, id) => graph.nodes.find((n) => n.id === id);
const prose = (node) => [
  ...(node.recommendations || []),
  ...(node.avoid || []),
  ...(node.successSignals || []),
  ...(node.effects?.requiredNuance || [])
].join(" ");

test("self-care is a central reparenting outcome, while ease and independence are optional", async () => {
  const graph = JSON.parse(await read("guide-graphs/candidates/inner-child.graph.json"));
  const apprentice = prose(nodeById(graph, "IC.ADULT_APPRENTICE"));
  const transfer = prose(nodeById(graph, "IC.PRACTICE_TO_LIFE_TRANSFER"));
  assert.match(apprentice, /central outcome/);
  assert.match(apprentice, /conscious effort|automaticity/);
  assert.match(transfer, /central reparenting outcomes/);
  assert.match(transfer, /not required/);
  assert.match(transfer, /appropriate help/);
  const guide = await read("guides/inner-child-guide-2026-10-23-r8.txt");
  assert.match(guide, /central outcome of reparenting/);
  assert.match(guide, /not a required condition of success/);
  assert.match(protocolProvenanceRules, /core aim and outcome of reparenting/);
});

test("happiness, compassion and relational costs are held together without invented motives", async () => {
  const inner = JSON.parse(await read("guide-graphs/candidates/inner-child.graph.json"));
  const cross = JSON.parse(await read("guide-graphs/candidates/cross-guide.graph.json"));
  const differentiation = prose(nodeById(inner, "IC.DIFFERENTIATION"));
  const relational = prose(nodeById(cross, "ROUTE.RELATIONAL_REALITY_CHECK"));
  assert.match(differentiation, /cultivating.*happiness/);
  assert.match(differentiation, /genuinely resent or withdraw/);
  assert.match(differentiation, /incapable of caring for others/);
  assert.match(relational, /actual evidence|observed|specific conduct/);
  assert.match(relational, /resent or withdraw/);
  const guide = await read("guides/inner-child-guide-2026-10-23-r8.txt");
  assert.match(guide, /cultivating his own happiness/);
  assert.match(guide, /Sometimes there are real social consequences/);
  assert.match(protocolProvenanceRules, /Others may really resent or reject/);
});

test("public-guide handoff preserves the teaching without claiming publication", async () => {
  const queue = await read("authoring/PENDING-PUBLIC-GUIDE-CHANGES.md");
  assert.match(queue, /### PGQ-044/);
  assert.match(queue, /### PGQ-046/);
  assert.match(queue, /central outcome of reparenting/);
  assert.match(queue, /Some companions may genuinely resent/);
  assert.match(queue, /pending the responsible editor's placement\/approval receipt/);
});
