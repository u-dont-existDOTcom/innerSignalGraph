#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeLiveCases,
  executeMultiTurn,
  gradeLiveCases,
  gradeMultiTurn
} from "../src/therapy-protocol/live-campaign.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const value = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const limit = value("--limit") ? Number.parseInt(value("--limit"), 10) : null;
const outputFile = value("--output") ? path.resolve(value("--output")) : undefined;
const retryBlocked = process.argv.includes("--retry-blocked");

let result;
if (process.argv.includes("--execute-live")) result = await executeLiveCases({ root, outputFile, limit, retryBlocked });
else if (process.argv.includes("--grade-live")) result = await gradeLiveCases({ root, outputFile });
else if (process.argv.includes("--execute-multiturn")) result = await executeMultiTurn({ root, outputFile, limit, retryBlocked });
else if (process.argv.includes("--grade-multiturn")) result = await gradeMultiTurn({ root, outputFile });
else throw new Error("Use --execute-live, --grade-live, --execute-multiturn, or --grade-multiturn.");

process.stdout.write(`${JSON.stringify({
  campaignVersion: result.campaignVersion,
  phase: result.phase,
  overallStatus: result.overallStatus,
  caseCount: result.caseCount,
  trajectoryCount: result.trajectoryCount,
  turnCount: result.turnCount,
  unresolvedSevereCount: result.unresolvedSevereCount
}, null, 2)}\n`);
