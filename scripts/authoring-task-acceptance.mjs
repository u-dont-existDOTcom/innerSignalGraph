#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const status = findings.length === 0 ? "READY_FOR_PROTECTED_MERGE" : "INCOMPLETE";
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, taskId: task.taskId, status, findings }, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
