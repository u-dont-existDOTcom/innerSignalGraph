import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingReplyEdits, assertUnchangedReplyPassages, normalizePendingReplyRevision, pendingReplyRevisionPromptBlock, reviseUnsentSupervisorCandidate, rejectSupervisorRevisionInTherapyPipeline } from "../src/orchestrator/pending-reply-revision.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runFormulatedPipeline } from "../src/orchestrator/run-formulated-pipeline.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { runAdversarialPipeline, runCompactAdversarialPipeline, realizeAdjudication } from "../src/orchestrator/run-pipeline.mjs";
const draft = [
  "An opening acknowledging genuine progress.",
  "A temporary coping idea known to be harmful is proposed.",
  "A paragraph on honesty and reciprocal connection.",
  "A closing about evaluating paid support."
].join("\n\n");
const pain = "A temporary coping idea known to be harmful is proposed.";
const safer = "During an unbearable crisis, contact appropriate local acute medical triage for assessment and possible pain relief.";
test("one localized owner correction edits the ENTIRE unsent draft and preserves unaffected paragraphs", () => {
  const merged = applyPendingReplyEdits({ draftText:draft, status:"unsent",operations:[{kind:"replace",anchor:pain,text:safer}] });
  assert.ok(merged.startsWith("An opening acknowledging genuine progress."));
  assert.ok(merged.includes(safer));
  assert.ok(merged.endsWith("A closing about evaluating paid support."));
  assert.equal(assertUnchangedReplyPassages({oldDraft:draft,newDraft:merged,unchangedPassages:["An opening acknowledging genuine progress.","A paragraph on honesty and reciprocal connection.","A closing about evaluating paid support."]}),true);
  assert.throws(() => assertUnchangedReplyPassages({oldDraft:draft,newDraft:safer,unchangedPassages:["An opening acknowledging genuine progress."]}),/lost/);
});
test("sent or unknown delivery status blocks editing the wrong conversational edge", () => {
  assert.throws(() => applyPendingReplyEdits({draftText:draft,status:"sent",operations:[{kind:"replace",anchor:pain,text:safer}]}),/delivered/);
  assert.throws(() => normalizePendingReplyRevision({status:"sent",draftText:draft,ownerFeedback:"Change this"}),/unsent/);
});
test("supervisor correction is bound to current candidate, not treated as the recipient's next message", () => {
  const block=pendingReplyRevisionPromptBlock({status:"unsent",draftText:draft,ownerFeedback:"Replace only the pain advice."});
  assert.match(block,/NOT.*recipient|not an inbound from the recipient/i);
  assert.match(block,/COMPLETE ready-to-send reply/);
  assert.match(block,/A closing about evaluating paid support/);
});
test("ambiguous exact replacements reject rather than silently deleting unrelated content", () => {
  assert.throws(() => applyPendingReplyEdits({draftText:"repeat repeat",status:"unsent",operations:[{kind:"replace",anchor:"repeat",text:"new"}]}),/exactly once/);
});

const revision = {
  status:"unsent", draftText:draft, ownerFeedback:"Replace the harmful temporary relief idea with a medical triage option.",
  operations:[{kind:"replace",anchor:pain,text:safer}]
};

test("supervisor edit returns exact full pending candidate without delivery or inherited approval", () => {
  const result = reviseUnsentSupervisorCandidate(revision);
  assert.equal(result.kind,"supervisor_reply_revision");
  assert.equal(result.delivery_status,"unsent");
  assert.equal(result.recipient_delivery_performed,false);
  assert.equal(result.requires_independent_audit,true);
  assert.ok(result.draft_text.startsWith("An opening"));
  assert.ok(result.draft_text.includes(safer));
  assert.ok(result.draft_text.endsWith("A closing about evaluating paid support."));
  assert.match(result.previous_draft_sha256,/^[0-9a-f]{64}$/);
});

test("unstructured feedback cannot enter the therapist pipeline as client speech", () => {
  assert.throws(() => reviseUnsentSupervisorCandidate({status:"unsent",draftText:draft,ownerFeedback:"Rewrite only one paragraph."}),/exact anchored|explicit anchored/i);
  assert.throws(() => rejectSupervisorRevisionInTherapyPipeline({pendingReplyRevision:revision}),/Unsent supervisor revisions/);
  assert.throws(() => reviseUnsentSupervisorCandidate({status:"sent",draftText:draft,ownerFeedback:"Edit",operations:revision.operations}),/unsent/);
});

test("all ordinary therapist pipelines reject supervisor feedback BEFORE any model call", async () => {
  const context={pendingReplyRevision:revision};
  const ops=[
    runFormulatedPipeline({context,providers:{},config:{}}),
    runTieredTherapyPipeline({context,providers:{},config:{}}),
    runAdversarialPipeline({context,providers:{},config:{}}),
    runCompactAdversarialPipeline({context,providers:{},config:{}}),
    realizeAdjudication({context,adjudication:{},provider:{}})
  ];
  for(const operation of ops) await assert.rejects(operation,/Unsent supervisor revisions/);
});

test("the real respond CLI edits a draft without invoking clinical providers and refuses unstructured edits", () => {
  const path = fileURLToPath(new URL("../src/cli/respond.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[path],{input:JSON.stringify({pendingReplyRevision:revision}),encoding:"utf8",timeout:5000});
  assert.equal(result.status,0,result.stderr+"\n"+result.stdout);
  const payload=JSON.parse(result.stdout);
  assert.equal(payload.delivery_status,"unsent");
  assert.equal(payload.requires_independent_audit,true);
  assert.equal(payload.draft_text.split("\n\n").length,4);
  const bad=spawnSync(process.execPath,[path],{input:JSON.stringify({pendingReplyRevision:{status:"unsent",draftText:draft,ownerFeedback:"Only correct the middle paragraph."}}),encoding:"utf8",timeout:5000});
  assert.notEqual(bad.status,0);
  assert.match(JSON.parse(bad.stdout).error.message,/explicit anchored/i);
});

test("an insertion of a paragraph break is allowed; omission and reordering of untouched sections fail", () => {
  const inserted=applyPendingReplyEdits({draftText:draft,status:"unsent",operations:[{kind:"insert_after",anchor:"progress.",text:"\n\n"}]});
  assert.match(inserted,/progress\.\n\n\n\nA temporary/);
  const saved=["An opening acknowledging genuine progress.","A paragraph on honesty and reciprocal connection.","A closing about evaluating paid support."];
  assert.throws(()=>assertUnchangedReplyPassages({oldDraft:draft,newDraft:safer,unchangedPassages:[]}),/protected passages/);
  assert.throws(()=>assertUnchangedReplyPassages({oldDraft:draft,newDraft:draft.split("\n\n").reverse().join("\n\n"),unchangedPassages:saved}),/reordered/);
  assert.equal(assertUnchangedReplyPassages({oldDraft:draft,newDraft:inserted,unchangedPassages:saved}),true);
});
