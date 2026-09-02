#!/usr/bin/env node
import { assertSupportedNodeRuntime } from "../release/runtime-requirements.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--quiet") || args.filter((arg) => arg === "--quiet").length > 1) {
  console.error("Usage: node src/cli/check-runtime-requirements.mjs [--quiet]");
  process.exitCode = 2;
} else {
  try {
    const result = assertSupportedNodeRuntime(process.versions.node);
    if (!args.includes("--quiet")) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}
