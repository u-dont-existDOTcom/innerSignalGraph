#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const task = JSON.parse(fs.readFileSync(path.join(root, "tasks", "ACTIVE-TASK.json"), "utf8"));
const findings = [];

for (const relative of [...task.acceptance.requiredArtifacts, ...task.acceptance.requiredDocumentation]) {
  const absolute = path.join(root, relative);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    findings.push({ code: "REQUIRED_ARTIFACT_MISSING", path: relative });
    continue;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    findings.push({ code: "REQUIRED_ARTIFACT_INVALID", path: relative });
  }
}

const baseline = JSON.parse(fs.readFileSync(path.join(root, "docs", "implementation", "obsidian-authoring-baseline-2026-08-29.json"), "utf8"));
for (const [relative, expected] of Object.entries(baseline.hashes)) {
  if (relative === "docs/INNER-CHILD-THERAPY-MAP.md") continue;
  const actual = createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
  if (actual !== expected) findings.push({ code: "BASELINE_AUTHORITY_CHANGED", path: relative, expected, actual });
}

const resolution = JSON.parse(fs.readFileSync(path.join(root, "authoring", "migration", "owner-map-resolution-2026-08-29.json"), "utf8"));
const classification = JSON.parse(fs.readFileSync(path.join(root, "authoring", "migration", "map-classification.json"), "utf8"));
const overlay = JSON.parse(fs.readFileSync(path.join(root, "authoring", "overlays", "inner-child.overlay.json"), "utf8"));
if (resolution.decisions.length !== 15) findings.push({ code: "OWNER_MAP_DECISIONS_INCOMPLETE", count: resolution.decisions.length });
if (classification.nodes.length !== 46 || classification.edges.length !== 57 || classification.operatingBullets.length !== 11 || classification.overlayRows.length !== 11 || classification.layout.length !== 6) findings.push({ code: "MAP_INVENTORY_INCOMPLETE" });
if (overlay.items.filter((item) => item.status === "owner-approved-uncompiled").length !== 12) findings.push({ code: "ACTIVE_OVERLAY_INVENTORY_INCORRECT" });
if (!resolution.decisions.find((item) => item.id.endsWith("D09"))?.futureGuideProposalRequired || !resolution.decisions.find((item) => item.id.endsWith("D10"))?.futureGuideProposalRequired) findings.push({ code: "REQUIRED_GUIDE_FOLLOWUPS_MISSING" });

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const script of ["authoring:project", "authoring:validate", "authoring:check", "authoring:proposal:new", "authoring:proposal:build", "authoring:proposal:check", "authoring:proposal:reconcile", "authoring:maps", "authoring:maps:check"]) {
  if (!packageJson.scripts[script]) findings.push({ code: "AUTHORING_SCRIPT_MISSING", script });
}
for (const file of ["tests/authoring-frontmatter.test.mjs", "tests/authoring-projection.test.mjs", "tests/authoring-proposal.test.mjs", "tests/authoring-semantic-diff.test.mjs", "tests/authoring-overlay.test.mjs", "tests/authoring-mermaid.test.mjs", "tests/authoring-canvas.test.mjs", "tests/authoring-guide-packet.test.mjs", "tests/authoring-security.test.mjs"]) {
  if (!fs.existsSync(path.join(root, file))) findings.push({ code: "AUTHORING_TEST_SURFACE_MISSING", path: file });
}

for (const command of ["validate", "check", "maps-check"]) {
  const result = spawnSync(process.execPath, [path.join(root, "src", "cli", "authoring.mjs"), command], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) findings.push({ code: "AUTHORING_GATE_FAILED", command, output: `${result.stdout}${result.stderr}`.slice(0, 2000) });
}

const status = findings.length === 0 ? "READY_FOR_PROTECTED_MERGE" : "INCOMPLETE";
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, taskId: task.taskId, status, findings }, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
