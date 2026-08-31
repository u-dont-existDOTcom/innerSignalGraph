import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCommunityLearningCards, CommunityStore } from "../src/community-learning/store.mjs";
import { validateFieldNoteInput, validatePostInput, validateReplyInput } from "../src/community-learning/contracts.mjs";

function noteInput(outcome, consentScopes = ["community-aggregate", "product-improvement"], practiceOrFeature = "Brief pre-sleep self-hypnosis") {
  return validateFieldNoteInput({
    practiceOrFeature,
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
  const internalCards = buildCommunityLearningCards(await store.readState(), []);
  const card = internalCards.find((item) => item.practiceOrFeature === "Brief pre-sleep self-hypnosis");
  assert.equal(card.status, "CONTESTED_PATTERN");
  assert.equal(card.independentContributorCount, 3);
  assert.equal(card.outcomeCounts.benefit, 1);
  assert.equal(card.outcomeCounts.worsening, 1);
  assert.equal(card.outcomeCounts.mixed, 1);
  assert.equal(card.productProposalEligible, true);
  assert.equal(one.receipt.usageRefs.cardIds.length, 1);
  assert.doesNotMatch(JSON.stringify(card), /PRIVATE-(?:CONTEXT|ADVERSE|CONFOUNDER)-PHRASE/);
  const bootstrap = await store.buildBootstrap(first.participant);
  assert.equal(bootstrap.learningCards.some((item) => item.cardId === card.cardId), false, "unreviewed community cards stay participant-hidden");
  await assert.rejects(() => store.exportProposal(first.participant, card.cardId), /human review/);

  const beforeWithdrawal = await store.buildBootstrap(first.participant);
  const receiptBefore = beforeWithdrawal.myReceipts.find((item) => item.contributionId === one.fieldNote.fieldNoteId);
  assert.ok(receiptBefore.usageRefs.cardIds.includes(card.cardId));
  assert.deepEqual(receiptBefore.usageRefs.proposalIds, []);

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
  assert.equal(three.fieldNote.learningStatus, "product-improvement");
});

test("product-only consent never feeds Commons cards and repeated reports from one contributor stay personal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innersignal-community-consent-"));
  const store = await new CommunityStore({ rootDir: root, seedCards: [] }).initialize();
  const member = await store.createSession({ pseudonym: "One Observer" });

  await store.createFieldNote(member.participant, noteInput("benefit", ["community-aggregate"], "Repeated personal scan"));
  await store.createFieldNote(member.participant, noteInput("benefit", ["community-aggregate"], "Repeated personal scan"));
  await store.createFieldNote(member.participant, noteInput("benefit", ["product-improvement"], "Product-only private signal"));

  const cards = buildCommunityLearningCards(await store.readState(), []);
  assert.equal(cards.find((card) => card.practiceOrFeature === "Repeated personal scan")?.status, "REPEATED_PERSONAL_PATTERN");
  assert.equal(cards.some((card) => card.practiceOrFeature === "Product-only private signal"), false);
  const bootstrap = await store.buildBootstrap(member.participant);
  assert.equal(bootstrap.learningCards.some((card) => card.sourceKind === "community-field-notes"), false);
});

test("withdrawing a linked contribution stales its proposal while the recomputed card remains eligible", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innersignal-community-stale-proposal-"));
  const store = await new CommunityStore({ rootDir: root, seedCards: [] }).initialize();
  const members = await Promise.all(["One", "Two", "Three", "Four"].map((pseudonym) => store.createSession({ pseudonym })));
  const notes = [];
  for (const member of members) {
    notes.push(await store.createFieldNote(member.participant, noteInput("benefit")));
  }

  const state = await store.readState();
  const card = buildCommunityLearningCards(state, [])[0];
  const proposalId = "00000000-0000-4000-8000-000000000001";
  state.proposalExports.push({
    proposalId,
    sourceCardId: card.cardId,
    generatedByParticipantId: members[1].participant.participantId,
    generatedAt: state.updatedAt,
    sha256: "legacy-proposal",
    candidateOnly: true,
    runtimeWritable: false,
    status: "current",
    staleAt: null
  });
  state.receipts.find((receipt) => receipt.contributionId === notes[0].fieldNote.fieldNoteId).usageRefs.proposalIds.push(proposalId);
  await fs.writeFile(store.stateFile, `${JSON.stringify(state, null, 2)}\n`);

  await store.withdrawFieldNote(members[0].participant, notes[0].fieldNote.fieldNoteId, {
    scopes: ["community-aggregate"],
    reason: "Stop community aggregation."
  });

  const updated = await store.readState();
  const recomputed = buildCommunityLearningCards(updated, []).find((item) => item.cardId === card.cardId);
  assert.equal(recomputed.independentContributorCount, 3);
  assert.equal(recomputed.productProposalEligible, true);
  assert.equal(updated.proposalExports.find((proposal) => proposal.proposalId === proposalId).status, "stale-consent-change");
});
