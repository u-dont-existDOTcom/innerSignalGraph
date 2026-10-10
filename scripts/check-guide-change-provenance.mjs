#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md";
const SEMANTIC_SOURCE = /^(?:guide-graphs\/candidates\/.*\.graph\.json|guides\/owner-amendments\.json|guides\/inner-child-guide-[^/]*\.txt|src\/prompts\/.*\.mjs|plugins\/inner-signal-therapy\/skills\/inner-signal-therapy\/.*\.md)$/;
const GUIDE_SOURCE = /^guides\/inner-child-guide-[^/]*\.txt$/;
const NEW_ENTRY = /^### (PGQ-\d+)\s+—.*$/gm;
const FIELDS = ["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"];

export function assessGuideChangeProvenance({ changedPaths, oldQueue, newQueue, prBody = "" }) {
  const affected = changedPaths.filter((p) => SEMANTIC_SOURCE.test(p));
  if (!affected.length) return [];
  const errors = [];
  const queueChanged = changedPaths.includes(queuePath);
  const appOnly = /^Guide impact: app-only\s*[—-]\s*\S.{10,}/mi.test(prBody);
  if (!queueChanged && !appOnly) errors.push("Map/guide/prompt changes require a changed teaching-point queue or a reasoned 'Guide impact: app-only — ...' PR declaration.");
  if (!queueChanged) return errors;
  if (!newQueue || oldQueue === newQueue) errors.push("The guide change queue was named but its content did not change.");
  const oldIds = new Set([...oldQueue.matchAll(NEW_ENTRY)].map((x) => x[1]));
  const matches = [...newQueue.matchAll(NEW_ENTRY)];
  const newEntries = matches.filter((x) => !oldIds.has(x[1]));
  if (!newEntries.length) errors.push("A changed queue must add a teaching point or explicitly document consumption/disposition.");
  for (const entry of newEntries) {
    const start = entry.index + entry[0].length;
    const following = matches.find((x) => x.index > entry.index);
    const nextBundle = newQueue.indexOf("\n## ", start);
    const end = Math.min(...[following?.index, nextBundle].filter((v) => Number.isInteger(v) && v >= 0).concat(newQueue.length));
    const body = newQueue.slice(start, end);
    for (const field of FIELDS) if (!new RegExp(`^${field}\\s*\\S`, "m").test(body)) errors.push(`${entry[1]} missing ${field}`);
  }
  if (!appOnly && !changedPaths.some((p) => GUIDE_SOURCE.test(p))) {
    // Backfills/consumption of previously canonicalized entries can legitimately skip
    // a new guide edit; require each new item to explain its current canonical coverage.
    if (!newEntries.length || newEntries.some((x) => {
      const next = matches.find((m) => m.index > x.index);
      const block = newQueue.slice(x.index, next?.index ?? newQueue.length);
      return !/Already covered:\s*.+/m.test(block);
    })) errors.push("Reader teaching points need a canonical guide edit or explicit prior-coverage explanation.");
  }
  return errors;
}

function git(...args) { return execFileSync("git", args, {cwd:root, encoding:"utf8"}).trimEnd(); }
function main() {
  const base = process.env.GUIDE_BASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw Error("GUIDE_BASE_SHA must be an exact 40-character PR-base commit SHA.");
  const changedPaths = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  let oldQueue = "";
  try { oldQueue = git("show", `${base}:${queuePath}`); } catch {}
  const newQueue = fs.readFileSync(path.join(root, queuePath), "utf8");
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const prBody = eventPath && fs.existsSync(eventPath)
    ? JSON.parse(fs.readFileSync(eventPath,"utf8"))?.pull_request?.body ?? ""
    : "";
  const errors = assessGuideChangeProvenance({changedPaths, oldQueue, newQueue, prBody});
  if (errors.length) { for (const e of errors) console.error(`GUIDE-PROVENANCE: ${e}`); process.exitCode = 1; }
  else console.log("Guide teaching-point / app-only provenance: PASS");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
