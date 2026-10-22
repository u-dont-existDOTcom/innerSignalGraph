import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSuggestedFixes } from "../scripts/suggested-fix-inbox.mjs";
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
