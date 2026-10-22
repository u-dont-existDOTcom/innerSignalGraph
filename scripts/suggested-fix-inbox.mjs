#!/usr/bin/env node
// Read-only discovery: include owner suggestions still inside unmerged UDA pull requests.
// Disposition belongs to the InnerSignal owner/worker, not to this detector.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const UPSTREAM = "u-dont-existDOTcom/universal-dev-architecture";
const PREFIX = "suggested-fixes/innerSignalGraph/";
const API = "https://api.github.com/repos/" + UPSTREAM;
const HERE = dirname(fileURLToPath(import.meta.url));

export function reconcileSuggestedFixes(defaultFiles, proposedFiles, receipts) {
  const registry = new Map();
  for (const path of defaultFiles) {
    if (path.startsWith(PREFIX)) registry.set(path, { path, onDefault: true, openPrs: [] });
  }
  for (const { path, pr } of proposedFiles) {
    if (!path.startsWith(PREFIX)) continue;
    const item = registry.get(path) ?? { path, onDefault: false, openPrs: [] };
    if (!item.openPrs.includes(pr)) item.openPrs.push(pr);
    registry.set(path, item);
  }
  const out = [...registry.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const item of out) {
    const receipt = receipts.find(r => r.path === item.path);
    item.disposition = receipt?.disposition ?? "UNACKNOWLEDGED";
    item.destination = receipt?.destination ?? null;
    item.nextCondition = receipt?.nextCondition ?? null;
    item.implementation = receipt?.implementation ?? "UNVERIFIED";
    item.actionRequired = !receipt || !["ADOPTED", "DEFERRED", "DECLINED", "SUPERSEDED"].includes(receipt.disposition)
      || (receipt.disposition === "ADOPTED" && !receipt.destination)
      || (receipt.disposition === "DEFERRED" && !receipt.nextCondition)
      || (receipt.disposition === "SUPERSEDED" && !receipt.destination);
  }
  return out;
}

// The user's authenticated GitHub CLI is a legitimate read-only transport. Use
// it when present rather than exhausting GitHub's anonymous rate limit while
// scanning multiple still-open PRs. Neither method prints or stores credentials.
let ghAvailable;
function useGhApi() {
  if (process.env.GITHUB_TOKEN) return false; // CI's credential uses ordinary fetch.
  if (ghAvailable === undefined) {
    try { execFileSync("gh", ["version"], { stdio: "ignore", timeout: 3000 }); ghAvailable = true; }
    catch { ghAvailable = false; }
  }
  return ghAvailable;
}

async function apiPages(url) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const target = new URL(url);
    if (target.hostname !== "api.github.com" || !target.pathname.startsWith("/repos/" + UPSTREAM + "/")) {
      throw new Error("Unrecognized repository API endpoint; inbox state unknown");
    }
    target.searchParams.set("per_page", "100");
    target.searchParams.set("page", String(page));
    let data;
    if (useGhApi()) {
      try {
        const raw = execFileSync("gh", ["api", target.pathname + target.search], {
          encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error("Authenticated GitHub CLI failed on " + target.pathname + "; inbox state unknown: " + String(err.code || "request-failed"));
      }
    } else {
      const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
      const res = await fetch(target, { headers, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error("GitHub " + res.status + " on " + target.pathname + "; inbox state unknown");
      data = await res.json();
    }
    if (!Array.isArray(data)) throw new Error("Unexpected GitHub array response; inbox state unknown");
    out.push(...data);
    if (data.length < 100) return out;
  }
  throw new Error("GitHub pagination exceeded 10 pages; inbox state unknown");
}

async function discover() {
  const defaultData = await apiPages(API + "/contents/" + PREFIX.slice(0, -1) + "?ref=main&per_page=100");
  const defaultFiles = defaultData.filter(x => x.type === "file").map(x => x.path);
  const prs = await apiPages(API + "/pulls?state=open&per_page=100");
  const candidates = prs.filter(x => (x.labels ?? []).some(y => y.name === "uda-lane"));
  const proposed = [];
  for (const pr of candidates) {
    const files = await apiPages(API + "/pulls/" + pr.number + "/files?per_page=100");
    for (const f of files) {
      if (f.filename?.startsWith(PREFIX) && f.status !== "removed") {
        proposed.push({ path: f.filename, pr: pr.number });
      }
    }
  }
  return { defaultFiles, proposed };
}

async function main() {
  const receiptPath = resolve(HERE, "../docs/suggested-fixes-inbox-receipts.json");
  const manifest = JSON.parse(await readFile(receiptPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.receipts)) throw new Error("Invalid intake receipt registry");
  const { defaultFiles, proposed } = await discover();
  const items = reconcileSuggestedFixes(defaultFiles, proposed, manifest.receipts);
  const attention = items.filter(x => x.actionRequired);
  console.log(JSON.stringify({ status: attention.length ? "ACTION_REQUIRED" : "ALL_DISCOVERED_DISPOSITIONED",
    discovered: items.length, onDefault: items.filter(x => x.onDefault).length,
    submittedInOpenPr: items.filter(x => x.openPrs.length).length, attention: attention.length, items }, null, 2));
  if (process.argv.includes("--check") && attention.length) process.exitCode = 2;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error("Suggested-fix inbox: " + err.message); process.exitCode = 3; });
}
