#!/usr/bin/env node
// Every map change records what it means for a reader, in the same pull request (owner request,
// 8-9 Oct 2026; docs/PUBLIC-GUIDE-HUMANIZATION.md, "Teaching points for map changes").
//
// A pull request that changes the owner amendments, a graph candidate, the prompt or realization
// rules, or canonical guide text must either add its teaching point to the public-guide queue or
// declare in its description that nothing changes for a reader:
//
//   Guide impact: app-only — <why nothing changes for a reader>
//
// Every queue entry the pull request adds must carry the five fields of a teaching point.
//
// CI runs it with GUIDE_IMPACT_BASE_SHA, GUIDE_IMPACT_HEAD_SHA and GUIDE_IMPACT_PR_BODY. It prints
// repository paths and field names only.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const GUIDE_QUEUE_PATH = "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md";
export const TEACHING_POINT_FIELDS = Object.freeze(["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"]);

// The map: what a person using InnerSignal or reading its guide learns from. A change to any of these
// may change what someone should understand or do.
const MAP_PATTERNS = Object.freeze([
  /^guides\/owner-amendments\.json$/u,
  /^guides\/[^/]+\.txt$/u,
  /^guide-graphs\/candidates\/[^/]+\.graph\.json$/u,
  /^src\/prompts\/[^/]+\.mjs$/u,
  /^authoring\/obsidian\/current\/(?:sources\/owner-amendments|governance\/amendments|nodes)\//u
]);

export const isMapPath = (file) => MAP_PATTERNS.some((pattern) => pattern.test(file));

// "Guide impact: app-only — <reason>" on a line of its own, with a dash or em dash and a reason of a
// few words.
const APP_ONLY = /^\s*Guide impact:\s*app-only\s*(?:—|–|-{1,2})\s*(\S.{9,})$/imu;

export function appOnlyReason(body) {
  const match = APP_ONLY.exec(typeof body === "string" ? body : "");
  return match ? match[1].trim() : null;
}

// The queue entries a change adds: each new "### PGQ-..." heading and the text under it in the new
// queue, up to the next heading.
export function addedQueueEntries(queueText, addedHeadings) {
  const lines = queueText.split(/\r?\n/u);
  return addedHeadings.map((heading) => {
    const start = lines.findIndex((line) => line.trimEnd() === heading.trimEnd());
    if (start < 0) return { heading, body: "" };
    let end = start + 1;
    while (end < lines.length && !/^#{2,3}\s/u.test(lines[end])) end += 1;
    return { heading, body: lines.slice(start + 1, end).join("\n") };
  });
}

// A field counts when a line opens with its label and has text after it. The labels hold no regular
// expression characters.
export function missingFields(entryBody) {
  return TEACHING_POINT_FIELDS.filter((field) => !new RegExp(`^${field}[ \\t]*\\S`, "mu").test(entryBody));
}

/**
 * The verdict for one pull request: the files it changes, its description, and the queue entries it
 * adds (heading and body). Returns { ok, problems, map_files, queue_changed, app_only }.
 */
export function guideImpactVerdict({ changedFiles, prBody, addedEntries = [] }) {
  const mapFiles = changedFiles.filter(isMapPath).sort();
  const queueChanged = changedFiles.includes(GUIDE_QUEUE_PATH);
  const reason = appOnlyReason(prBody);
  const problems = [];
  for (const entry of addedEntries) {
    const missing = missingFields(entry.body);
    if (missing.length) problems.push(`${GUIDE_QUEUE_PATH}: "${entry.heading.replace(/^###\s*/u, "")}" is missing ${missing.join(", ")}`);
  }
  if (mapFiles.length && !queueChanged && !reason) {
    problems.push(`This pull request changes the map (${mapFiles.join(", ")}) without a teaching point. Add one to ${GUIDE_QUEUE_PATH} `
      + `with the fields ${TEACHING_POINT_FIELDS.join(" ")}, or, if nothing changes for a reader, put this line in the pull request `
      + "description: Guide impact: app-only — <why nothing changes for a reader>");
  }
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems), map_files: Object.freeze(mapFiles),
    queue_changed: queueChanged, app_only: reason !== null });
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function readPullRequestChange({ base, head, cwd = process.cwd() }) {
  const range = `${base}...${head}`;
  const changedFiles = git(["diff", "--name-only", "--no-renames", range], cwd).split("\n").filter(Boolean);
  let addedEntries = [];
  if (changedFiles.includes(GUIDE_QUEUE_PATH)) {
    const added = git(["diff", "--unified=0", "--no-renames", range, "--", GUIDE_QUEUE_PATH], cwd)
      .split("\n").filter((line) => /^\+### PGQ-/u.test(line)).map((line) => line.slice(1));
    const queueText = git(["show", `${head}:${GUIDE_QUEUE_PATH}`], cwd);
    addedEntries = addedQueueEntries(queueText, added);
  }
  return { changedFiles, addedEntries };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const base = process.env.GUIDE_IMPACT_BASE_SHA;
  const head = process.env.GUIDE_IMPACT_HEAD_SHA;
  if (!/^[0-9a-f]{40}$/u.test(base ?? "") || !/^[0-9a-f]{40}$/u.test(head ?? "")) {
    console.error("GUIDE_IMPACT_BASE_SHA and GUIDE_IMPACT_HEAD_SHA must be full commit SHAs.");
    process.exit(2);
  }
  const change = readPullRequestChange({ base, head });
  const verdict = guideImpactVerdict({ ...change, prBody: process.env.GUIDE_IMPACT_PR_BODY ?? "" });
  console.log(JSON.stringify({ ok: verdict.ok, map_files: verdict.map_files, queue_changed: verdict.queue_changed, app_only: verdict.app_only,
    queue_entries_added: change.addedEntries.length }));
  for (const problem of verdict.problems) console.error(problem);
  process.exit(verdict.ok ? 0 : 1);
}
