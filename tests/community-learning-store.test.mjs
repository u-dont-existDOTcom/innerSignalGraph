import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CommunityStore } from "../src/community-learning/store.mjs";
import { validateFieldNoteInput, validatePostInput, validateReplyInput } from "../src/community-learning/contracts.mjs";

function noteInput(outcome, consentScopes = ["community-aggregate", "product-improvement"]) {
  return validateFieldNoteInput({
    practiceOrFeature: "Brief pre-sleep self-hypnosis",
    goal: "Fall asleep more easily",
    whatTried: "A short inward session immediately before bed.",
    context: "PRIVATE-CONTEXT-PHRASE home ordinary evening",
    priorExperience: "Some prior hypnosis experience",
    outcomes: {
      immediate: outcome === "benefit" ? "Felt quieter." : "Felt more alert.",
      nextMorning: outcome === "benefit" ? "Slept somewhat sooner." : "Took longer to sleep.",
      followingTwoToThreeDays: "No repeated test yet."
    },
    overallOutcome: outcome,
    downsides: outcome === "worsening" ? "PRIVATE-ADVERSE-PHRASE mental activation lasted about an hour." : "",
    confounders: "PRIVATE-CONFOUNDER-PHRASE caffeine timing was not recorded.",
    wouldRepeat: outcome === "benefit" ? "yes" : "unsure",
    causalConfidence: 55,
    consentScopes
  });
}

test("store keeps conversation, consent, moderation, recomputation, and proposal authority separate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innersignal-community-store-"));
  const store = await new CommunityStore({ rootDir: root, seedCards: [] }).initialize();

  const first = await store.createSession({ pseudonym: "Quiet River" });
  assert.ok(first.recoveryCode);
  const returning = await store.createSession({ pseudonym: "Quiet River", recoveryCode: first.recoveryCode });
  assert.equal(returning.participant.participantId, first.participant.participantId);
  await assert.rejects(() => store.createSession({ pseudonym: "Quiet River", recoveryCode: "wrong" }), /recovery code/);

  const second = await store.createSession({ pseudonym: "Night Owl" });
  const third = await store.createSession({ pseudonym: "Still Lake" });
  const post = await store.createPost(first.participant, validatePostInput({
    room: "sleep",
    title: "Self-hypnosis before sleep",
    body: "I had a mixed result and want similar experiences rather than advice.",
    responseContract: "similar-experiences",
    contentNote: "sleep"
  }));
  assert.equal(post.moderation.status, "published");
  assert.equal(post.own, true);
  await store.createReply(second.participant, post.postId, validateReplyInput({
    replyType: "similar-experience",
    body: "I also became more alert when the return language was energizing."
  }, post.responseContract));

  const held = await store.createPost(first.participant, validatePostInput({
    room: "using-innersignal",
    title: "Contact details test",
    body: "Email me at person@example.com so we can discuss it.",
    responseContract: "questions-welcome",
    contentNote: ""
  }));
  assert.equal(held.moderation.status, "held-for-human-review");
  const queue = await store.readModerationQueue();
  assert.equal(queue.posts[0].targetId, held.postId);
  await store.recordModerationDecision({ targetType: "post", targetId: held.postId, decision: "publish", note: "Safe after review." });
  const visibleAfterReview = await store.buildBootstrap(second.participant);
  assert.ok(visibleAfterReview.posts.some((item) => item.postId === held.postId));

  const one = await store.createFieldNote(first.participant, noteInput("benefit"));
  await store.createFieldNote(second.participant, noteInput("worsening"));
  const belowThreshold = await store.buildBootstrap(first.participant);
  assert.equal(belowThreshold.learningCards.some((item) => item.practiceOrFeature === "Brief pre-sleep self-hypnosis"), false);

  const three = await store.createFieldNote(third.participant, noteInput("mixed"));
  const bootstrap = await store.buildBootstrap(first.participant);
  const card = bootstrap.learningCards.find((item) => item.practiceOrFeature === "Brief pre-sleep self-hypnosis");
  assert.equal(card.status, "CONTESTED_PATTERN");
  assert.equal(card.independentContributorCount, 3);
  assert.equal(card.outcomeCounts.benefit, 1);
  assert.equal(card.outcomeCounts.worsening, 1);
  assert.equal(card.outcomeCounts.mixed, 1);
  assert.equal(card.productProposalEligible, true);
  assert.equal(one.receipt.usageRefs.cardIds.length, 1);
  assert.doesNotMatch(JSON.stringify(card), /PRIVATE-(?:CONTEXT|ADVERSE|CONFOUNDER)-PHRASE/);

  const proposal = await store.exportProposal(first.participant, card.cardId);
  assert.equal(proposal.proposal.candidateOnly, true);
  assert.equal(proposal.proposal.activation, "proposal-only");
  assert.equal(proposal.proposal.runtimeWritable, false);
  assert.equal(proposal.proposal.card.runtimeAuthority, "none");

  const beforeWithdrawal = await store.buildBootstrap(first.participant);
  const receiptBefore = beforeWithdrawal.myReceipts.find((item) => item.contributionId === one.fieldNote.fieldNoteId);
  assert.ok(receiptBefore.usageRefs.cardIds.includes(card.cardId));
  assert.ok(receiptBefore.usageRefs.proposalIds.includes(proposal.proposalId));

  await store.withdrawFieldNote(first.participant, one.fieldNote.fieldNoteId, {
    scopes: ["community-aggregate", "product-improvement"],
    reason: "Changed my mind."
  });
  const afterWithdrawal = await store.buildBootstrap(first.participant);
  assert.equal(afterWithdrawal.learningCards.some((item) => item.practiceOrFeature === "Brief pre-sleep self-hypnosis"), false, "two-person cells remain suppressed");
  const receiptAfter = afterWithdrawal.myReceipts.find((item) => item.contributionId === one.fieldNote.fieldNoteId);
  assert.deepEqual(receiptAfter.activeScopes, []);
  assert.deepEqual(receiptAfter.usageRefs.cardIds, []);

  const exported = await store.exportParticipantData(first.participant);
  assert.doesNotMatch(JSON.stringify(exported), /tokenHash|recoveryCodeHash|csrfToken/);
  assert.equal(exported.participant.pseudonym, "Quiet River");
  assert.equal(exported.proposalExports[0].status, "stale-consent-change");
  assert.equal(three.fieldNote.learningStatus, "product-improvement");
});
