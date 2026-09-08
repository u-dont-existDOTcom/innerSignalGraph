#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCaseState } from "../src/case-state/longitudinal-state.mjs";
import { validateSyntheticPrivacy, validateHarness } from "../tasks/audit-architecture-eval-20260907/score.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const findings = [];
const required = [
  "src/therapy/constitution.mjs", "src/case-state/longitudinal-state.mjs", "src/case-state/context-window.mjs",
  "src/case-state/tracker.mjs", "src/storage/private-case-store.mjs", "tests/constitution-context-state.test.mjs",
  "docs/superpowers/specs/2026-09-08-constitution-context-state-architecture.md",
  "tasks/constitution-context-audit-20260908/synthetic-case-state.json",
  "tasks/audit-architecture-eval-20260907/STEERING-CONTEXT-SUPPLEMENT.json"
];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) findings.push({ code: "REQUIRED_ARTIFACT_MISSING", path: relative });

const syntheticCaseState = json("tasks/constitution-context-audit-20260908/synthetic-case-state.json");
try { validateCaseState(syntheticCaseState); } catch (error) { findings.push({ code: "CASE_STATE_INVALID", detail: error.message }); }
try { validateSyntheticPrivacy(syntheticCaseState); } catch (error) { findings.push({ code: "CASE_STATE_PRIVACY_INVALID", detail: error.message }); }
const cases = json("tasks/audit-architecture-eval-20260907/cases.json");
const drafts = json("tasks/audit-architecture-eval-20260907/drafts.json");
const referenceTarget = json("tasks/audit-architecture-eval-20260907/reference-target.json");
const rubric = json("tasks/audit-architecture-eval-20260907/rubric.json");
const architectures = json("tasks/audit-architecture-eval-20260907/architectures.json");
const controls = json("tasks/audit-architecture-eval-20260907/grader-controls.json");
try { validateHarness({ cases, drafts, referenceTarget, rubric, architectures, controls }); } catch (error) { findings.push({ code: "AUDIT_HARNESS_INVALID", detail: error.message }); }
try { validateSyntheticPrivacy(json("tasks/audit-architecture-eval-20260907/STEERING-CONTEXT-SUPPLEMENT.json")); } catch (error) { findings.push({ code: "SYNTHETIC_PRIVACY_INVALID", detail: error.message }); }

const common = read("src/prompts/common.mjs");
const web = read("apps/web/app.js");
const html = read("apps/web/index.html");
if (!common.includes("renderInnerSignalConstitution")) findings.push({ code: "CONSTITUTION_NOT_INJECTED" });
if (web.includes("setItem(STORAGE_KEY, JSON.stringify(state))")) findings.push({ code: "SENSITIVE_BROWSER_PERSISTENCE" });
for (const label of ["Current saved state", "What changed this turn", "Trajectory entry"]) if (!html.includes(label)) findings.push({ code: "INSPECTION_CONTROL_MISSING", label });
if (!read("tasks/audit-architecture-eval-20260907/PROTOCOL.md").includes("new frozen run and complete recalibration")) findings.push({ code: "SEMANTIC_REFREEZE_BOUNDARY_MISSING" });

const status = findings.length ? "INCOMPLETE" : "SOURCE_ACCEPTANCE_PASS";
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, taskId: "constitution-context-audit-20260908", status, findings }, null, 2)}\n`);
if (findings.length) process.exitCode = 1;
