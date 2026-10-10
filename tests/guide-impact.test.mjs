import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GUIDE_QUEUE_PATH, addedQueueEntries, appOnlyReason, guideImpactVerdict, isMapPath, missingFields } from "../scripts/check-guide-impact.mjs";

// Every map change records what it means for a reader (docs/PUBLIC-GUIDE-HUMANIZATION.md,
// "Teaching points for map changes"). All entry text here is invented.

const ENTRY = [
  "### PGQ-901 — A sample teaching point",
  "Caused by: #999, AMEND.CROSS.SAMPLE; owner outcome: \"keep it small\"",
  "Teaching point: Small steps count; one done step teaches more than a perfect plan.",
  "Reader need: Without it a reader may wait for certainty before acting.",
  "Already covered: nothing close",
  "Where: When to Change the Strategy"
].join("\n");

test("the map is the amendments, graph candidates, prompt and realization rules, and canonical guide text", () => {
  for (const file of ["guides/owner-amendments.json", "guides/inner-child-guide-2026-10-04-r4.txt", "guides/somatic-sequencing-guide.txt",
    "guide-graphs/candidates/inner-child.graph.json", "src/prompts/realize.mjs", "src/prompts/candidate.mjs",
    "authoring/obsidian/current/sources/owner-amendments/AMEND.CROSS.X.md", "authoring/obsidian/current/nodes/inner-child-directed-graph/IC.X.md"]) {
    assert.equal(isMapPath(file), true, file);
  }
  for (const file of ["src/journal-import/retrieval.mjs", "guides/manifest.json", "guide-graphs/compiled/inner-child.json", "docs/INDEX.md",
    GUIDE_QUEUE_PATH, "tests/guide-impact.test.mjs"]) {
    assert.equal(isMapPath(file), false, file);
  }
});

test("an app-only declaration needs its own line and a reason", () => {
  assert.equal(appOnlyReason("Summary\n\nGuide impact: app-only — only changes how the planner re-offers a practice\n"), "only changes how the planner re-offers a practice");
  assert.equal(appOnlyReason("guide impact: APP-ONLY - routing labels only, nothing a reader sees"), "routing labels only, nothing a reader sees");
  assert.equal(appOnlyReason("Guide impact: app-only"), null);
  assert.equal(appOnlyReason("Guide impact: app-only — n/a"), null, "a reason of a few words");
  assert.equal(appOnlyReason("We think the guide impact is app-only — trust us on this one"), null, "on a line of its own");
  assert.equal(appOnlyReason(null), null);
});

test("a teaching point needs all five fields, each with text", () => {
  const [entry] = addedQueueEntries(`# Queue\n\n${ENTRY}\n\n### PGQ-902 — Next\nCaused by: x\n`, ["### PGQ-901 — A sample teaching point"]);
  assert.deepEqual(missingFields(entry.body), []);
  assert.deepEqual(missingFields("Caused by: #1\nTeaching point:\nReader need: y"), ["Teaching point:", "Already covered:", "Where:"]);
});

test("the verdict asks a map change for a teaching point or an app-only reason", () => {
  const mapOnly = guideImpactVerdict({ changedFiles: ["guide-graphs/candidates/inner-child.graph.json", "tests/x.test.mjs"], prBody: "Adds a route." });
  assert.equal(mapOnly.ok, false);
  assert.match(mapOnly.problems[0], /changes the map \(guide-graphs\/candidates\/inner-child\.graph\.json\) without a teaching point/u);
  assert.match(mapOnly.problems[0], /Guide impact: app-only/u);

  const appOnly = guideImpactVerdict({ changedFiles: ["src/prompts/realize.mjs"], prBody: "Guide impact: app-only — only the planner's internal labels change" });
  assert.equal(appOnly.ok, true);
  assert.equal(appOnly.app_only, true);

  const withEntry = guideImpactVerdict({ changedFiles: ["guides/owner-amendments.json", GUIDE_QUEUE_PATH], prBody: "",
    addedEntries: [{ heading: "### PGQ-901 — A sample teaching point", body: ENTRY.split("\n").slice(1).join("\n") }] });
  assert.equal(withEntry.ok, true);

  const thinEntry = guideImpactVerdict({ changedFiles: ["guides/owner-amendments.json", GUIDE_QUEUE_PATH], prBody: "",
    addedEntries: [{ heading: "### PGQ-903 — Thin", body: "Preserve the distinction." }] });
  assert.equal(thinEntry.ok, false);
  assert.match(thinEntry.problems[0], /"PGQ-903 — Thin" is missing Caused by:, Teaching point:, Reader need:, Already covered:, Where:/u);

  assert.equal(guideImpactVerdict({ changedFiles: ["src/journal-import/retrieval.mjs"], prBody: "" }).ok, true, "no map change, nothing asked");
});

function gitRepo(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } }).trim();
  return git;
}

test("the CLI reads a pull request's change from Git and fails a map change with no teaching point", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-impact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = gitRepo(root);
  git("init", "-q", "-b", "main");
  await fs.mkdir(path.join(root, "guide-graphs/candidates"), { recursive: true });
  await fs.mkdir(path.join(root, "authoring"), { recursive: true });
  await fs.writeFile(path.join(root, "guide-graphs/candidates/inner-child.graph.json"), "{}\n");
  await fs.writeFile(path.join(root, GUIDE_QUEUE_PATH), "# Pending public guide changes\n\nStatus: **PENDING**\n\n### PGQ-001 — Old entry\nPreserve it.\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  await fs.writeFile(path.join(root, "guide-graphs/candidates/inner-child.graph.json"), "{\"nodes\":[]}\n");
  git("commit", "-q", "-am", "map change");
  const mapHead = git("rev-parse", "HEAD");
  const cli = path.resolve(new URL("../scripts/check-guide-impact.mjs", import.meta.url).pathname);
  const run = (head, body) => spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8",
    env: { PATH: process.env.PATH, GUIDE_IMPACT_BASE_SHA: base, GUIDE_IMPACT_HEAD_SHA: head, GUIDE_IMPACT_PR_BODY: body } });

  const bare = run(mapHead, "Changes a route.");
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /without a teaching point/u);
  assert.deepEqual(JSON.parse(bare.stdout).map_files, ["guide-graphs/candidates/inner-child.graph.json"]);
  assert.equal(run(mapHead, "Guide impact: app-only — only internal routing metadata changes").status, 0);

  await fs.appendFile(path.join(root, GUIDE_QUEUE_PATH), `\n${ENTRY.replace("PGQ-901", "PGQ-002")}\n`);
  git("commit", "-q", "-am", "teaching point");
  const entryHead = git("rev-parse", "HEAD");
  const withEntry = run(entryHead, "");
  assert.equal(withEntry.status, 0, withEntry.stderr);
  assert.equal(JSON.parse(withEntry.stdout).queue_entries_added, 1);

  await fs.appendFile(path.join(root, GUIDE_QUEUE_PATH), "\n### PGQ-003 — Missing fields\nPreserve the distinction.\n");
  git("commit", "-q", "-am", "thin entry");
  const thin = run(git("rev-parse", "HEAD"), "Guide impact: app-only — the declaration doesn't excuse a thin entry");
  assert.equal(thin.status, 1);
  assert.match(thin.stderr, /"PGQ-003 — Missing fields" is missing/u);

  assert.equal(spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } }).status, 2);
});
