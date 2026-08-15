#!/usr/bin/env node

import { readValidatedPublicationResult } from "../src/compliance/publication-result-validator.mjs";

if (process.argv.length !== 4 || !/^(?:0|1|2)$/.test(process.argv[3])) {
  process.exitCode = 2;
} else {
  try {
    const result = await readValidatedPublicationResult(process.argv[2], Number(process.argv[3]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.exitCode = 2;
  }
}
