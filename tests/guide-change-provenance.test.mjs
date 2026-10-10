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

test("blank field cannot borrow text from the next line", () => {
  const queue=full.replace("Reader need: A reader would misunderstand.", "Reader need:\nAlready covered: Existing guide paragraph.");
  const errors=assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md","guides/inner-child-guide-2026-10-04-r4.txt"],oldQueue:"# Queue",newQueue:queue});
  assert.ok(errors.some(x=>x.includes("missing Reader need")));
});

test("bare placeholder does not satisfy reader need or prior coverage", () => {
  const queue=full.replace("Reader need: A reader would misunderstand.","Reader need: none")
                  .replace("Already covered: Existing guide paragraph.","Already covered: none");
  const errors=assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:"# Queue",newQueue:queue});
  assert.ok(errors.some(x=>x.includes("non-substantive Reader need")));
  assert.ok(errors.some(x=>x.includes("Already covered")));
});

test("an app-only declaration cannot suppress a direct canonical guide edit", () => {
  const errors=assessGuideChangeProvenance({changedPaths:["guides/inner-child-guide-2026-10-04-r4.txt"],oldQueue:"# Queue",newQueue:"# Queue",prBody:"Guide impact: app-only — A valid-looking justification that should not override actual prose changes."});
  assert.ok(errors.some(x=>x.includes("cannot be app-only")));
});

test("moving prompt-bearing text outside src/prompts cannot evade provenance admission", () => {
  const errors=assessGuideChangeProvenance({changedPaths:["src/orchestrator/pending-reply-revision.mjs"],oldQueue:"# Queue",newQueue:"# Queue"});
  assert.ok(errors.some(x=>x.includes("require")));
  const errors2=assessGuideChangeProvenance({changedPaths:["src/orchestrator/run-formulated-pipeline.mjs"],oldQueue:"# Queue",newQueue:"# Queue"});
  assert.ok(errors2.some(x=>x.includes("require")));
});

test("consumption requires public-guide sync bookkeeping", () => {
  const old=full;
  const after="# Queue\n";
  const errors=assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:old,newQueue:after});
  assert.ok(errors.some(x=>x.includes("sync-manifest")));
  assert.deepEqual(assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md","authoring/public-guide-sync.json"],oldQueue:old,newQueue:after}),[]);
});

test("new PGQ ID collision is invalid", () => {
  const queue=full+"\n"+full.slice(full.indexOf("### PGQ-900"));
  const errors=assessGuideChangeProvenance({changedPaths:[...changed,"authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:"# Queue",newQueue:queue});
  assert.ok(errors.some(x=>x.includes("Duplicate PGQ")));
});

test("a substantive update to a pending PGQ ID is valid when source and queue agree", () => {
  const revised=full.replace("Teaching point: Learn the distinction.","Teaching point: Learn the refined distinction with added context.");
  assert.deepEqual(assessGuideChangeProvenance({changedPaths:["guides/inner-child-guide-2026-10-04-r4.txt","authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:full,newQueue:revised}),[]);
});

test("Nothing close with punctuation cannot masquerade as prior canonical coverage", () => {
  const revised=full.replace("Already covered: Existing guide paragraph.","Already covered: Nothing close.");
  const errs=assessGuideChangeProvenance({changedPaths:["guide-graphs/candidates/cross-guide.graph.json","authoring/PENDING-PUBLIC-GUIDE-CHANGES.md"],oldQueue:"# Queue",newQueue:revised});
  assert.ok(errs.some(e=>e.includes("specific already-covered anchor")));
});
