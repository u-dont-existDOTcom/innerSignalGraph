import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSuggestedFixes, isActiveLaneFile, discoverWith, authenticatedCliAvailable } from "../scripts/suggested-fix-inbox.mjs";
const p = "suggested-fixes/innerSignalGraph/";

test("unmerged upstream submission cannot vanish behind main-only queue", () => {
  const items = reconcileSuggestedFixes([p + "older.md"], [{ path: p + "new.md", pr: 412 }], []);
  assert.equal(items.length, 2);
  const newItem = items.find(x => x.path.endsWith("new.md"));
  assert.deepEqual(newItem.openPrs, [412]);
  assert.equal(newItem.actionRequired, true);
  assert.equal(newItem.onDefault, false);
});

test("a merged suggestion and an open PR of the same path are one entry", () => {
  const items = reconcileSuggestedFixes([p + "same.md"], [{ path: p + "same.md", pr: 1 }], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].onDefault, true);
  assert.deepEqual(items[0].openPrs, [1]);
});

test("acknowledgment includes a traceable disposition and destination", () => {
  const items = reconcileSuggestedFixes([], [{ path: p + "new.md", pr: 412 }],
    [{ path: p + "new.md", disposition: "ADOPTED", destination: "task PR", implementation: "PROPOSED_ON_TASK_BRANCH" }]);
  assert.equal(items[0].actionRequired, false);
  assert.equal(items[0].disposition, "ADOPTED");
  assert.equal(items[0].destination, "task PR");
});

test("unresolved, undocumented or wrong-lane receipts never pass the check", () => {
  const items = reconcileSuggestedFixes([p + "noted.md"], [{ path: "other-project/no.md", pr: 5 }],
    [{ path: p + "noted.md", disposition: "ADOPTED", destination: "" }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].actionRequired, true);
  assert.equal(items[0].onDefault, true);
});

test("deferred submissions must retain an explicit reopening condition", () => {
  const incomplete = reconcileSuggestedFixes([p + "pending.md"], [],
    [{ path: p + "pending.md", disposition: "DEFERRED", destination: "owner review" }]);
  assert.equal(incomplete[0].actionRequired, true);
  const complete = reconcileSuggestedFixes([p + "pending.md"], [],
    [{ path: p + "pending.md", disposition: "DEFERRED", destination: "owner review",
       nextCondition: "Claude reviews and owner finalizes" }]);
  assert.equal(complete[0].actionRequired, false);
});

test("an installed but unauthenticated GitHub CLI falls back, an authenticated CLI can be used", () => {
  assert.equal(authenticatedCliAvailable(null, () => { throw new Error("no authorization"); }), false);
  assert.equal(authenticatedCliAvailable(null, () => {}), true);
  assert.equal(authenticatedCliAvailable("ci-token", () => { throw new Error("must not run"); }), false);
});

test("ignore done/ archival paths even in an unmerged PR with a renamed file", () => {
  assert.equal(isActiveLaneFile(p + "done/old.md"), false);
  assert.equal(isActiveLaneFile(p + "new.md"), true);
  const items = reconcileSuggestedFixes([p + "old.md"], [{ path: p + "done/old.md", pr: 123 }],
    [{ path: p + "old.md", disposition: "ADOPTED", destination: "commit" }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].actionRequired, false);
});

test("declining a suggestion requires reason and source disposition location", () => {
  const path = p + "proposal.md";
  const empty = reconcileSuggestedFixes([path], [], [{ path, disposition: "DECLINED" }]);
  assert.equal(empty[0].actionRequired, true);
  const noReason = reconcileSuggestedFixes([path], [],
    [{ path, disposition: "DECLINED", destination: "ledger" }]);
  assert.equal(noReason[0].actionRequired, true);
  const complete = reconcileSuggestedFixes([path], [],
    [{ path, disposition: "DECLINED", destination: "ledger", reason: "already covered by active constraints" }]);
  assert.equal(complete[0].actionRequired, false);
});

test("directory contents are fetched exactly once even when over 100 entries", async () => {
  const calls = [];
  const directory = Array.from({length: 101}, (_, i) => ({type:"file", path:p+"item-"+i+".md"}));
  const result = await discoverWith(
    async (url) => { calls.push(["directory", url]); return directory; },
    async (url) => {
      calls.push(["pages", url]);
      if (url.includes("/pulls/")) return [];
      return [];
    }
  );
  assert.equal(calls.filter(c => c[0] === "directory").length, 1);
  assert.equal(result.defaultFiles.length, 101);
  assert.equal(result.proposed.length, 0);
});

test("reject ambiguous directory truncation rather than claiming a complete scan", async () => {
  const listing = Array.from({length:1000},(_,i) => ({type:"file",path:p+i+".md"}));
  await assert.rejects(discoverWith(async () => listing, async () => { throw Error("unexpected call"); }), /directory limit/);
});
