import test from "node:test";
import assert from "node:assert/strict";
import {
  moderationFlags,
  validateAccountDeletionInput,
  validateFieldNoteInput,
  validatePostInput,
  validatePotentialLessonInput,
  validateReplyInput,
  validateSessionRequest
} from "../src/community-learning/contracts.mjs";

test("session requests require adult and participation acknowledgments", () => {
  assert.throws(() => validateSessionRequest({ pseudonym: "Quiet River", adultConfirmed: false, communityAgreementAccepted: true }), /at least 18/i);
  assert.throws(() => validateSessionRequest({ pseudonym: "Quiet River", adultConfirmed: true, communityAgreementAccepted: false }), /participation boundary/i);
});

test("session requests preserve invitation and recovery fields without broadening the pseudonym contract", () => {
  assert.deepEqual(validateSessionRequest({
    pseudonym: "Quiet River",
    inviteCode: "invite",
    recoveryCode: "recover",
    adultConfirmed: true,
    communityAgreementAccepted: true
  }), {
    pseudonym: "Quiet River",
    inviteCode: "invite",
    recoveryCode: "recover",
    adultConfirmed: true,
    communityAgreementAccepted: true
  });
  assert.throws(() => validateSessionRequest({ pseudonym: "<script>", adultConfirmed: true, communityAgreementAccepted: true }), /unsupported characters/);
});

test("Commons posts remain bounded by room and response contract", () => {
  const post = validatePostInput({
    room: "sleep",
    title: "What helped after waking at 3am?",
    body: "I tried a short body scan and noticed a mixed result the following morning.",
    responseContract: "similar-experiences",
    contentNote: "sleep difficulty"
  });
  assert.equal(post.room, "sleep");
  assert.throws(() => validateReplyInput({ replyType: "challenge", body: "You are wrong." }, post.responseContract), /not allowed/);
  assert.deepEqual(validateReplyInput({ replyType: "similar-experience", body: "I noticed something similar." }, post.responseContract), {
    replyType: "similar-experience",
    body: "I noticed something similar."
  });
});

test("Field Note consent refuses external sharing without a defined research protocol", () => {
  const base = {
    practiceOrFeature: "Short sleep body scan",
    goal: "Return to sleep",
    whatTried: "A five-minute body scan.",
    outcomes: {},
    overallOutcome: "mixed",
    wouldRepeat: "unsure",
    causalConfidence: 40,
    consentScopes: ["community-aggregate"]
  };
  const valid = validateFieldNoteInput(base);
  assert.equal(valid.outcomes.followingTwoToThreeDays, "");
  assert.throws(() => validateFieldNoteInput({ ...base, consentScopes: ["external-researcher-sharing"] }), /research-protocol/);
});

test("potential lessons require explicit bounded input and privacy acknowledgement for free text", () => {
  assert.deepEqual(validatePotentialLessonInput({
    category: "did-not-work",
    summary: "",
    privacyAcknowledged: false
  }), {
    category: "did-not-work",
    summary: "",
    privacyAcknowledged: false
  });
  assert.deepEqual(validatePotentialLessonInput({
    category: "correction",
    summary: "The response used an assumption I had already rejected.",
    privacyAcknowledged: true
  }), {
    category: "correction",
    summary: "The response used an assumption I had already rejected.",
    privacyAcknowledged: true
  });
  assert.throws(() => validatePotentialLessonInput({
    category: "did-not-make-sense",
    summary: "A manually written summary.",
    privacyAcknowledged: false
  }), /privacy and redaction acknowledgement/i);
  assert.throws(() => validatePotentialLessonInput({
    category: "disagreement",
    summary: "",
    privacyAcknowledged: false,
    messageId: "private-message-id",
    transcript: "private transcript"
  }), /unsupported fields/i);
});

test("deterministic moderation flags hold rather than adjudicate sensitive content", () => {
  assert.deepEqual(moderationFlags("ordinary meditation discussion"), []);
  assert.ok(moderationFlags("email me at person@example.com").includes("personal-contact-data"));
  assert.ok(moderationFlags("hypnotize them without their consent").includes("coercive-hypnosis"));
});


test("account deletion fails closed without exact confirmation", () => {
  assert.deepEqual(validateAccountDeletionInput({ confirmation: "DELETE" }), { confirmation: "DELETE" });
  assert.throws(() => validateAccountDeletionInput({ confirmation: "delete" }), /exact confirmation DELETE/);
});
