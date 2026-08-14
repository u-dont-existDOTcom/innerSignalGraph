#!/usr/bin/env node

import { auditGitPublication } from "../src/compliance/publication-audit.mjs";

function failure(code, identifier) {
  return {
    schemaVersion: 1,
    ok: false,
    scannedRecords: 0,
    findings: [{ severity: "error", code, surface: "cli", identifier }]
  };
}

function parseArguments(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--root" || index + 1 >= argv.length || argv[index + 1].length === 0) return undefined;
    root = argv[index + 1];
    index += 1;
  }
  return { root };
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  emit(failure("invalid-arguments", "arguments"), 2);
} else {
  try {
    const result = await auditGitPublication(options);
    emit(result, result.ok ? 0 : 1);
  } catch {
    emit(failure("audit-tool-failure", "git"), 2);
  }
}
