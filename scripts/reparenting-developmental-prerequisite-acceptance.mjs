#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const parse = relative => JSON.parse(read(relative));
const findings = [];
const requireFile = relative => {
  if (!fs.existsSync(path.join(root, relative))) findings.push({ code: "REQUIRED_ARTIFACT_MISSING", path: relative });
};
const requireText = (relative, value, code) => {
  if (!read(relative).includes(value)) findings.push({ code, path: relative, value });
};

for (const relative of [
  "src/case-formulation/developmental-capacity.mjs",
  "tests/developmental-prerequisite.test.mjs",
  "guide-graphs/candidates/inner-child.graph.json",
  "guides/owner-amendments.json",
  "guide-graphs/source-maps/owner-amendments.json",
  "docs/superpowers/specs/2026-09-11-reparenting-telos-target-gate.md",
  "tasks/reparenting-telos-target-gate-20260911/OWNER-OUTCOME.json",
  "tasks/reparenting-telos-target-gate-20260911/EXECUTION-DIRECTIVE.json",
  "tasks/reparenting-telos-target-gate-20260911/ACTIVE-LESSON-CONTRACT.json",
  "tasks/reparenting-telos-target-gate-20260911/COMPLETION-MATRIX.json"
]) requireFile(relative);

const tests = read("tests/developmental-prerequisite.test.mjs");
for (let index = 1; index <= 12; index += 1) {
  const id = `R-ADULT-${String(index).padStart(2, "0")}`;
  if (!tests.includes(id)) findings.push({ code: "REGRESSION_MISSING", id });
}

requireText("src/case-formulation/developmental-capacity.mjs", "DEVELOPMENTAL_PREREQUISITE_VIOLATION", "AUDIT_CODE_MISSING");
requireText("src/case-formulation/developmental-capacity.mjs", "pair_tolerated", "PAIR_TOLERANCE_EVIDENCE_MISSING");
requireText("src/case-formulation/developmental-capacity.mjs", "preferred_order", "CONTEXT_ORDER_MISSING");
requireText("src/guide-graph/contract.mjs", "developmental_inquiry_route", "GRAPH_PROJECTION_MISSING");
requireText("src/orchestrator/response-contract.mjs", "canonical-pair", "PAIR_RESPONSE_ENFORCEMENT_MISSING");
requireText("src/case-state/longitudinal-state.mjs", "developmentalCapacity", "LONGITUDINAL_CAPACITY_MISSING");

const amendment = parse("guides/owner-amendments.json").items.find(item => item.id === "AMEND.IC.DEVELOPMENTAL_PREREQUISITE_GATE");
if (!amendment) findings.push({ code: "CANONICAL_AMENDMENT_MISSING" });
else {
  for (const phrase of ["not a mandatory pair or fixed sequence", "Use both in the same reply only when", "Preserve the context-selected order"]) {
    if (!amendment.text.includes(phrase)) findings.push({ code: "CONTEXT_SENSITIVE_AMENDMENT_MISSING", phrase });
  }
}

const graph = parse("guide-graphs/candidates/inner-child.graph.json");
const contrastNode = graph.nodes.find(node => node.id === "IC.DEVELOPMENTAL_CAPACITY_CONTRAST");
if (!contrastNode) findings.push({ code: "CONTRAST_NODE_MISSING" });
else if (!JSON.stringify(contrastNode.activation).includes("developmental_inquiry_route")) findings.push({ code: "CONTRAST_NODE_ROUTE_MISSING" });

const staleSources = [
  "tasks/ACTIVE-TASK.json",
  "tasks/reparenting-telos-target-gate-20260911/OWNER-OUTCOME.json",
  "tasks/reparenting-telos-target-gate-20260911/ACTIVE-LESSON-CONTRACT.json",
  "tasks/reparenting-telos-target-gate-20260911/COMPLETION-MATRIX.json",
  "guide-graphs/candidates/inner-child.graph.json"
];
const stalePatterns = [
  "ask the successful exception first and breakdown under distress second",
  "the normative pair",
  "asking only one member of the paired comparison"
];
for (const relative of staleSources) {
  const source = read(relative);
  for (const phrase of stalePatterns) if (source.toLowerCase().includes(phrase)) findings.push({ code: "STALE_MANDATORY_PAIR_RULE", path: relative, phrase });
}

const status = findings.length ? "ACCEPTANCE_FAILED" : "SOURCE_ACCEPTANCE_PASS";
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, taskId: "reparenting-developmental-prerequisite-20260911", status, findings }, null, 2)}\n`);
if (findings.length) process.exitCode = 1;
