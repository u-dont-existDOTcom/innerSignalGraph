#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const COUNT_KEYS = Object.freeze([
  "actionLogs",
  "actionRuns",
  "artifacts",
  "blobs",
  "branches",
  "commits",
  "issueComments",
  "issues",
  "objects",
  "pullRequests",
  "refs",
  "reviewComments",
  "reviews"
]);
const RESULT_KEYS = Object.freeze(["counts", "findings", "ok", "scannedRecords", "schemaVersion"]);
const FAILURE_RESULT_KEYS = Object.freeze(["findings", "ok", "scannedRecords", "schemaVersion"]);
const FINDING_KEYS = Object.freeze(["code", "identifier", "severity", "surface"]);

function hasExactKeys(value, expected) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function readValidatedResult(resultPath, auditStatus) {
  if (![0, 1, 2].includes(auditStatus)) throw new Error("invalid-status");
  const absolutePath = path.resolve(resultPath);
  const [fileStat, rootStat] = await Promise.all([lstat(absolutePath), lstat(path.dirname(absolutePath))]);
  if (
    !fileStat.isFile() ||
    fileStat.isSymbolicLink() ||
    (fileStat.mode & 0o777) !== 0o600 ||
    fileStat.size === 0 ||
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== 0o700
  ) {
    throw new Error("invalid-result-file");
  }

  const bytes = await readFile(absolutePath);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const result = JSON.parse(decoded);
  if (!isRecord(result)) throw new Error("invalid-result-shape");
  const hasCounts = Object.hasOwn(result, "counts");
  if (!hasExactKeys(result, hasCounts ? RESULT_KEYS : FAILURE_RESULT_KEYS)) throw new Error("invalid-result-shape");
  if (result.schemaVersion !== 1 || typeof result.ok !== "boolean" || !isNonnegativeInteger(result.scannedRecords)) {
    throw new Error("invalid-result-fields");
  }
  if (
    !Array.isArray(result.findings) ||
    (!hasCounts && result.ok) ||
    (hasCounts && (!isRecord(result.counts) || !hasExactKeys(result.counts, COUNT_KEYS)))
  ) {
    throw new Error("invalid-result-collections");
  }
  if (hasCounts) {
    for (const count of Object.values(result.counts)) {
      if (!isNonnegativeInteger(count)) throw new Error("invalid-count");
    }
  }
  for (const finding of result.findings) {
    if (!isRecord(finding) || !hasExactKeys(finding, FINDING_KEYS)) throw new Error("invalid-finding-shape");
    if (
      finding.severity !== "error" ||
      typeof finding.code !== "string" ||
      finding.code.length === 0 ||
      typeof finding.surface !== "string" ||
      finding.surface.length === 0 ||
      typeof finding.identifier !== "string" ||
      finding.identifier.length === 0
    ) {
      throw new Error("invalid-finding-fields");
    }
  }

  const derivedOk = result.findings.length === 0;
  if (result.ok !== derivedOk || (auditStatus === 0) !== result.ok) throw new Error("inconsistent-result-status");
  return result;
}

if (process.argv.length !== 4 || !/^(?:0|1|2)$/.test(process.argv[3])) {
  process.exitCode = 2;
} else {
  try {
    const result = await readValidatedResult(process.argv[2], Number(process.argv[3]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.exitCode = 2;
  }
}
