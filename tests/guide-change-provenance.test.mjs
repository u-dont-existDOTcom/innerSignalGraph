import test from "node:test";
import assert from "node:assert/strict";
import { assessGuideChangeProvenance } from "../scripts/check-guide-change-provenance.mjs";
const full = `# Queue
### PGQ-900 — Test
Caused by: Synthetic revision.
Teaching point: Learn the distinction.
Reader need: A reader would misunderstand.
Already covered: Existing guide paragraph.
Where: Existing section.
`;
const changed = ["src/prompts/realize.mjs"];
test("a changed prompt without queue or app-only disposition fails", () => {
  assert.match(assessGuideChangeProvenance({changedPaths:changed,oldQueue:"",newQueue:"",prBody:""})[0], /require/);
});
test("a correctly reasoned app-only edit passes", () => {
  assert.deepEqual(assessGuideChangeProvenance({changedPaths:changed,oldQueue:"",newQueue:"",prBody:"Guide impact: app-only — Only the handling of a pending unsent draft changes."}), []);
});
test("a changed graph accompanied by a complete teaching point passes", () => {
  assert.deepEqual(assessGuideChangeProvenance({changedPaths:["guide-graphs/candidates/cross-guide.graph.json","guides/inner-child-guide-2026-10-04-r4.txt","authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:"# Queue",newQueue:full}), []);
});
test("missing reader need fails even if queue changed", () => {
  const errors=assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:"# Queue",newQueue:full.replace("Reader need: A reader would misunderstand.\n", "")});
  assert.ok(errors.some(x => x.includes("Reader need")));
});
