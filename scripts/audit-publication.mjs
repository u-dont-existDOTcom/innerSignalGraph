#!/usr/bin/env node

import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

import {
  auditGitPublication,
  collectHostedPublicationRecords,
  mergePublicationResults,
  runGitleaks,
  scanPublicationRecords
} from "../src/compliance/publication-audit.mjs";

const EXPECTED_REPOSITORY = "u-dont-existDOTcom/innerSignalGraph";

function failure(code, identifier, surface = "cli") {
  return {
    schemaVersion: 1,
    ok: false,
    scannedRecords: 0,
    findings: [{ severity: "error", code, surface, identifier }]
  };
}

function parseArguments(argv) {
  const options = { root: process.cwd() };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--root", "--github", "--gitleaks"].includes(name) || seen.has(name)) return undefined;
    if (index + 1 >= argv.length || argv[index + 1].length === 0) return undefined;
    seen.add(name);
    if (name === "--root") options.root = argv[index + 1];
    if (name === "--github") options.repository = argv[index + 1];
    if (name === "--gitleaks") options.gitleaks = argv[index + 1];
    index += 1;
  }
  const hostedPair = options.repository !== undefined || options.gitleaks !== undefined;
  if (hostedPair && (options.repository !== EXPECTED_REPOSITORY || options.gitleaks === undefined)) return undefined;
  return options;
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  emit(failure("invalid-arguments", "arguments"), 2);
} else {
  let privateHostedRoot;
  let phase = "git";
  try {
    const gitResult = await auditGitPublication({ root: options.root });
    if (!options.repository) {
      emit(gitResult, gitResult.ok ? 0 : 1);
    } else {
      phase = "hosted";
      privateHostedRoot = await mkdtemp(`${pathFromTemp("inner-signal-hosted-publication-")}`);
      await chmod(privateHostedRoot, 0o700);
      const hosted = await collectHostedPublicationRecords({
        repository: options.repository,
        tempRoot: privateHostedRoot
      });
      const hostedScan = scanPublicationRecords(hosted.records);
      phase = "gitleaks";
      const gitleaksResult = await runGitleaks({
        binary: options.gitleaks,
        root: options.root,
        hostedRoot: privateHostedRoot,
        hostedFileIdentifiers: hosted.hostedFileIdentifiers
      });
      const result = mergePublicationResults(gitResult, hostedScan, gitleaksResult);
      emit(
        {
          ...result,
          counts: {
            ...gitResult.counts,
            ...hosted.counts
          }
        },
        result.ok ? 0 : 1
      );
    }
  } catch (error) {
    if (error?.code === "audit-incomplete") {
      emit(failure("audit-incomplete", error.identifier, "hosted"), 1);
    } else {
      emit(failure("audit-tool-failure", phase), 2);
    }
  } finally {
    if (privateHostedRoot) await rm(privateHostedRoot, { recursive: true, force: true });
  }
}

function pathFromTemp(prefix) {
  return `${os.tmpdir()}/${prefix}`;
}
