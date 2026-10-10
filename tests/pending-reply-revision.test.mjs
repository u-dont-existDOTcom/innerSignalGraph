import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingReplyEdits, assertUnchangedReplyPassages, normalizePendingReplyRevision, pendingReplyRevisionPromptBlock } from "../src/orchestrator/pending-reply-revision.mjs";
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
