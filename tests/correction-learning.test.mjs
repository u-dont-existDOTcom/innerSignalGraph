import test from "node:test";
import assert from "node:assert/strict";
import {
  CORRECTION_DETECTOR_VERSION,
  LEARNING_CONTRIBUTION_FORMAT,
  POTENTIAL_LESSON_FORMAT,
  buildLiveLearningEvidence,
  completeLearningContribution,
  createAutomaticPotentialLesson,
  createManualPotentialLesson,
  createPendingLearningContribution,
  createRefusedLearningContribution,
  deletePotentialLesson,
  detectCorrectionSignal,
  restoreLearningContributions,
  restorePotentialLessons,
  reviewPotentialLesson,
  validatePotentialLesson
} from "../apps/web/correction-learning.js";

const CREATED_AT = "2026-08-31T20:00:00.000Z";
const REVIEWED_AT = "2026-08-31T20:05:00.000Z";

function automatic(message, id = "pl-00000000") {
  return createAutomaticPotentialLesson(message, { id, now: CREATED_AT });
}

test("named did-not-work signals create exactly one category-only stub", () => {
  for (const phrase of [
    "that didn't work",
    "that did not work",
    "this didn't work",
    "this did not work",
    "it didn't work",
    "it did not work"
  ]) {
    const candidate = automatic(`Please notice: ${phrase}.`);
    assert.equal(candidate.category, "did-not-work", phrase);
    assert.equal(candidate.triggerCode, "DID_NOT_WORK_DIRECTED", phrase);
  }
});

test("named did-not-make-sense signals map without semantic inference", () => {
  for (const phrase of [
    "that doesn't make sense",
    "that does not make sense",
    "that makes no sense",
    "this doesn't make sense",
    "this does not make sense",
    "this makes no sense"
  ]) {
    assert.deepEqual(detectCorrectionSignal(phrase), {
      category: "did-not-make-sense",
      triggerCode: "DID_NOT_MAKE_SENSE_DIRECTED"
    });
  }
});

test("explicit first-person disagreement maps while third-party disagreement does not", () => {
  for (const phrase of ["I disagree", "I don't agree", "I do not agree"]) {
    assert.equal(detectCorrectionSignal(phrase)?.category, "disagreement", phrase);
  }
  assert.equal(detectCorrectionSignal("My partner doesn't agree with me."), null);
});

test("explicit correction forms map to correction", () => {
  for (const phrase of [
    "That's wrong",
    "That is wrong",
    "You're wrong",
    "You are wrong",
    "You misunderstood me",
    "I meant something else",
    "Correction: the order was reversed"
  ]) {
    assert.equal(detectCorrectionSignal(phrase)?.category, "correction", phrase);
  }
});

test("unrelated therapy text and broad sentiment words do not create candidates", () => {
  for (const phrase of [
    "I feel uncertain about this.",
    "My partner said no.",
    "Actually I feel calmer now.",
    "This is difficult.",
    "I am distressed and want to slow down."
  ]) {
    assert.equal(createAutomaticPotentialLesson(phrase), null, phrase);
  }
});

test("detector precedence selects did-not-work before later correction signals", () => {
  assert.equal(detectCorrectionSignal("That didn't work; you misunderstood me.")?.category, "did-not-work");
});

test("automatic candidates serialize no triggering content or private identifiers", () => {
  const source = "That didn't work because PRIVATE_SOURCE_MARKER";
  const candidate = automatic(source);
  assert.equal(candidate.format, POTENTIAL_LESSON_FORMAT);
  assert.equal(candidate.detectorVersion, CORRECTION_DETECTOR_VERSION);
  assert.equal(candidate.captureSource, "automatic-local-correction-detector");
  assert.equal(candidate.status, "captured-private-stub");
  assert.equal(candidate.automaticCategoryDetection, true);
  assert.equal(candidate.automaticTextExtraction, false);
  assert.equal(candidate.sourceContentRetained, false);
  assert.equal(candidate.conversationImported, false);
  assert.equal(candidate.runtimeAuthority, "none");
  assert.equal(candidate.therapyPolicyAuthority, "none");
  const serialized = JSON.stringify(candidate);
  assert.doesNotMatch(serialized, /PRIVATE_SOURCE_MARKER|didn't work because/i);
  for (const prohibited of ["sourceMessage", "assistantResponse", "transcript", "messageId", "sessionId", "ledgerId", "embedding", "therapyState", "generatedSummary", "sourceHash", "matchOffset"]) {
    assert.equal(Object.hasOwn(candidate, prohibited), false, prohibited);
  }
});

test("manual fallback creates only an other-category stub and copies no assistant content", () => {
  const candidate = createManualPotentialLesson({ id: "pl-11111111", now: CREATED_AT });
  assert.equal(candidate.category, "other");
  assert.equal(candidate.captureSource, "explicit-save-potential-lesson");
  assert.equal(candidate.triggerCode, "EXPLICIT_MANUAL_SAVE");
  assert.equal(candidate.automaticCategoryDetection, false);
  assert.equal(candidate.automaticTextExtraction, false);
  assert.equal(candidate.summary, "");
});

test("candidate survives browser-state JSON save and reload", () => {
  const candidate = automatic("That did not work", "pl-22222222");
  const browserState = { therapy: [], potentialLessons: [candidate] };
  const reloaded = JSON.parse(JSON.stringify(browserState));
  assert.deepEqual(restorePotentialLessons(reloaded.potentialLessons), [candidate]);
});

test("candidate record in a browser backup contains no triggering chat text", () => {
  const trigger = "This doesn't make sense PRIVATE_CHAT_MARKER";
  const candidate = automatic(trigger, "pl-33333333");
  const backup = { format: "inner-signal-backup-v1", state: { therapy: [{ role: "user", content: trigger }], potentialLessons: [candidate] } };
  const restored = JSON.parse(JSON.stringify(backup));
  assert.match(JSON.stringify(restored.state.therapy), /PRIVATE_CHAT_MARKER/);
  assert.doesNotMatch(JSON.stringify(restored.state.potentialLessons), /PRIVATE_CHAT_MARKER|doesn't make sense/i);
});

test("import rejects unsupported and prohibited candidate fields", async (t) => {
  const candidate = automatic("I disagree", "pl-44444444");
  for (const prohibited of ["transcript", "assistantResponse", "messageId", "sessionId", "ledgerId", "embedding", "therapyState", "generatedSummary", "sourceHash"]) {
    await t.test(prohibited, () => {
      assert.throws(() => restorePotentialLessons([{ ...candidate, [prohibited]: "PRIVATE_MARKER" }]), /unsupported or missing fields/);
    });
  }
});

test("import rejects authority escalation and duplicate candidate ids", () => {
  const candidate = automatic("I disagree", "pl-55555555");
  assert.throws(() => restorePotentialLessons([{ ...candidate, runtimeAuthority: "therapy" }]), /runtimeAuthority must remain none/);
  assert.throws(() => restorePotentialLessons([candidate, candidate]), /must be unique/);
});

test("non-empty user summaries require privacy acknowledgement", () => {
  const candidate = automatic("You misunderstood me", "pl-66666666");
  assert.throws(() => reviewPotentialLesson(candidate, {
    category: "correction",
    summary: "A concise review note",
    privacyAcknowledged: false,
    disposition: "keep-private-candidate",
    now: REVIEWED_AT
  }), /privacy acknowledgement/);
});

test("keep-private review records disposition and fixed-code closeout without summary duplication", () => {
  const candidate = automatic("You misunderstood me", "pl-77777777");
  const reviewed = reviewPotentialLesson(candidate, {
    category: "did-not-make-sense",
    summary: "Clarify the concrete next action.",
    privacyAcknowledged: true,
    disposition: "keep-private-candidate",
    now: REVIEWED_AT
  });
  assert.equal(reviewed.status, "reviewed-private-candidate");
  assert.equal(reviewed.category, "did-not-make-sense");
  assert.equal(reviewed.summaryAuthorship, "user");
  assert.equal(reviewed.reviewedAt, REVIEWED_AT);
  assert.deepEqual(reviewed.history.at(-1), { action: "kept-private", at: REVIEWED_AT });
  assert.doesNotMatch(JSON.stringify(reviewed.history), /Clarify the concrete/);
  assert.equal(reviewed.runtimeAuthority, "none");
});

test("governance-review queue requires an acknowledged summary and grants no authority", () => {
  const candidate = automatic("That is wrong", "pl-88888888");
  assert.throws(() => reviewPotentialLesson(candidate, {
    category: "correction",
    summary: "",
    privacyAcknowledged: false,
    disposition: "queue-for-governance-review",
    now: REVIEWED_AT
  }), /requires an acknowledged user summary/);
  const queued = reviewPotentialLesson(candidate, {
    category: "correction",
    summary: "Check whether the response contradicted the user's explicit premise.",
    privacyAcknowledged: true,
    disposition: "queue-for-governance-review",
    now: REVIEWED_AT
  });
  assert.equal(queued.status, "governance-review-candidate");
  assert.equal(queued.disposition, "queue-for-governance-review");
  assert.equal(queued.runtimeAuthority, "none");
  assert.equal(queued.therapyPolicyAuthority, "none");
});

test("dismiss is deterministic and validated", () => {
  const candidate = automatic("I do not agree", "pl-99999999");
  const dismissed = reviewPotentialLesson(candidate, {
    category: "disagreement",
    disposition: "dismissed",
    now: REVIEWED_AT
  });
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.disposition, "dismissed");
  assert.equal(validatePotentialLesson(dismissed), dismissed);
});

test("delete removes only the selected browser-local candidate", () => {
  const first = automatic("I disagree", "pl-aaaaaaaa");
  const second = automatic("That didn't work", "pl-bbbbbbbb");
  assert.deepEqual(deletePotentialLesson([first, second], first.potentialLessonId), [second]);
});

test("category-only candidate builds conservative live evidence without source chat", () => {
  const candidate = automatic("That didn't work because PRIVATE_SOURCE_MARKER", "pl-livebuild1");
  const evidence = buildLiveLearningEvidence(candidate, { runtimeVersion: "0.15.2" });
  assert.deepEqual({
    kind: evidence.candidateKind,
    observation: evidence.generalizedObservation,
    evidenceClass: evidence.evidenceClass,
    causalBoundary: evidence.causalBoundary,
    outcomeDirection: evidence.outcomeDirection
  }, {
    kind: "outcome-signal",
    observation: "A user reported that an InnerSignal response did not work for them.",
    evidenceClass: "participant-reported",
    causalBoundary: "participant-report-only-no-causal-inference",
    outcomeDirection: "unclear"
  });
  assert.equal(evidence.sourceContentRetained, false);
  assert.equal(evidence.runtimeAuthority, "none");
  assert.equal(evidence.therapyPolicyAuthority, "none");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_SOURCE_MARKER|didn't work because/i);
});

test("browser contribution credentials are private, strict, resumable, and refusal has no queue credentials", () => {
  const pending = createPendingLearningContribution("pl-livecred1", {
    occurrenceToken: "a".repeat(64),
    revocationToken: "b".repeat(64),
    now: CREATED_AT
  });
  assert.equal(pending.format, LEARNING_CONTRIBUTION_FORMAT);
  assert.equal(pending.state, "submission-pending");
  const contributed = completeLearningContribution(pending, {
    candidateReceipt: "ISL-LOCAL-ABCDEF0123456789ABCDEF01",
    occurrenceCount: 1,
    status: "needs-review"
  }, { now: REVIEWED_AT });
  assert.deepEqual(restoreLearningContributions(JSON.parse(JSON.stringify([contributed]))), [contributed]);
  assert.equal(contributed.occurrenceToken, null);
  assert.equal(contributed.revocationToken, "b".repeat(64));
  assert.throws(() => completeLearningContribution(pending, {
    candidateReceipt: "ISL-LOCAL-ABCDEF0123456789ABCDEF01",
    occurrenceCount: null,
    status: null
  }, { now: REVIEWED_AT }), /requires only a receipt, revocation credential, and queue state/);
  assert.throws(() => completeLearningContribution(pending, {
    candidateReceipt: "ISL-LOCAL-ABCDEF0123456789ABCDEF01",
    occurrenceCount: 1,
    status: "incorporated"
  }, { now: REVIEWED_AT }), /queueStatus is invalid/);

  const refused = createRefusedLearningContribution("pl-liverefus1", { now: CREATED_AT });
  assert.equal(refused.state, "refused");
  assert.equal(refused.occurrenceToken, null);
  assert.equal(refused.revocationToken, null);
  assert.equal(refused.candidateReceipt, null);
});

test("browser contribution import rejects raw chat and authority fields", async (t) => {
  const pending = createPendingLearningContribution("pl-livefail1", {
    occurrenceToken: "c".repeat(64),
    revocationToken: "d".repeat(64),
    now: CREATED_AT
  });
  for (const field of ["transcript", "assistantAnswer", "rawUserMessage", "therapyState", "runtimeAuthority", "therapyPolicyAuthority"]) {
    await t.test(field, () => assert.throws(() => restoreLearningContributions([{ ...pending, [field]: "PRIVATE_MARKER" }]), /unsupported or missing fields/));
  }
});
