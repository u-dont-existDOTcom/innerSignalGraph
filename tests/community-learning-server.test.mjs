import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInnerSignalCommunityServer, formatHttpError, requestToken } from "../src/community-learning/server.mjs";

const seedCard = {
  format: "inner-signal-community-learning-card-v1",
  cardId: "synthetic-server-card",
  sourceKind: "synthetic",
  status: "PRODUCT_PROPOSAL",
  reviewStatus: "synthetic-example",
  runtimeAuthority: "none",
  practiceOrFeature: "Private-first sharing chooser",
  observation: "Synthetic usability example for the server endpoint test.",
  independentContributorCount: 3,
  sourceCount: 3,
  outcomeCounts: { benefit: 3, "no-change": 0, mixed: 0, worsening: 0, unclear: 0 },
  timeCoverage: { immediate: 3, laterSameDay: 0, nextMorning: 0, followingTwoToThreeDays: 0, longerFollowUp: 0 },
  contexts: [],
  confounders: [],
  adverseSignals: [],
  unknowns: ["Synthetic evidence."],
  externalEvidence: { status: "not-checked", references: [] },
  evidenceProfile: { independentContributors: 3 },
  productProposalEligible: true,
  createdAt: "2026-08-30T16:00:00.000Z",
  updatedAt: "2026-08-30T16:00:00.000Z",
  nextReviewAt: "2026-09-30T16:00:00.000Z"
};

async function startServer() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innersignal-community-server-"));
  const server = createInnerSignalCommunityServer({
    rootDir: root,
    inviteCode: "pilot-code",
    moderatorKey: "moderator-code",
    requireInviteCode: true,
    seedCards: [seedCard]
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

test("community server enforces invitation, cookie session, CSRF, conversation-only posts, and non-activating exports", async () => {
  const { server, base } = await startServer();
  try {
    const health = await fetch(`${base}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.runtimeActivationEnabled, false);
    assert.equal(health.humanModerationConfigured, true);

    const denied = await fetch(`${base}/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudonym: "Quiet River", inviteCode: "wrong", adultConfirmed: true, communityAgreementAccepted: true })
    });
    assert.equal(denied.status, 403);

    const login = await fetch(`${base}/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudonym: "Quiet River", inviteCode: "pilot-code", adultConfirmed: true, communityAgreementAccepted: true })
    });
    const session = await login.json();
    const cookie = cookieFrom(login);
    assert.equal(login.status, 201);
    assert.ok(cookie.includes("inner_signal_commons="));
    assert.ok(session.recoveryCode);

    const bootstrapResponse = await fetch(`${base}/v1/bootstrap`, { headers: { cookie: `__proto__=polluted; ${cookie}` } });
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrapResponse.status, 200);
    assert.equal(bootstrap.policy.postsConversationOnlyByDefault, true);
    assert.equal(bootstrap.policy.rawPostModelTrainingEnabled, false);
    const csrf = bootstrap.session.csrfToken;

    const noCsrf = await fetch(`${base}/v1/posts`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        room: "sleep",
        title: "A bounded sleep observation",
        body: "This post should fail because the mutation lacks the CSRF header.",
        responseContract: "questions-welcome",
        contentNote: ""
      })
    });
    assert.equal(noCsrf.status, 403);

    const postResponse = await fetch(`${base}/v1/posts`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-innersignal-csrf": csrf },
      body: JSON.stringify({
        room: "sleep",
        title: "A bounded sleep observation",
        body: "A short body scan felt calming immediately, but I was unsure the next morning.",
        responseContract: "questions-welcome",
        contentNote: "sleep"
      })
    });
    const post = await postResponse.json();
    assert.equal(postResponse.status, 201);
    assert.equal(post.post.responseContract, "questions-welcome");

    const heldResponse = await fetch(`${base}/v1/posts`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-innersignal-csrf": csrf },
      body: JSON.stringify({
        room: "using-innersignal",
        title: "A held contact post",
        body: "Email me at person@example.com so we can discuss this.",
        responseContract: "questions-welcome",
        contentNote: ""
      })
    });
    const held = await heldResponse.json();
    assert.equal(heldResponse.status, 202);
    assert.equal(held.post.moderation.status, "held-for-human-review");

    const unauthorizedQueue = await fetch(`${base}/v1/moderation/queue`);
    assert.equal(unauthorizedQueue.status, 403);
    const queueResponse = await fetch(`${base}/v1/moderation/queue`, { headers: { "x-innersignal-moderator-key": "moderator-code" } });
    const queue = await queueResponse.json();
    assert.equal(queueResponse.status, 200);
    assert.equal(queue.queue.posts[0].targetId, held.post.postId);
    const moderationResponse = await fetch(`${base}/v1/moderation/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-innersignal-moderator-key": "moderator-code" },
      body: JSON.stringify({ targetType: "post", targetId: held.post.postId, decision: "remove", note: "Contact data." })
    });
    assert.equal(moderationResponse.status, 200);

    const fieldResponse = await fetch(`${base}/v1/field-notes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-innersignal-csrf": csrf },
      body: JSON.stringify({
        sourcePostId: post.post.postId,
        practiceOrFeature: "Short body scan",
        goal: "Return to sleep",
        whatTried: "A five-minute scan.",
        outcomes: { immediate: "Calmer", nextMorning: "Unclear" },
        overallOutcome: "unclear",
        downsides: "",
        confounders: "Late meal",
        wouldRepeat: "unsure",
        causalConfidence: 35,
        consentScopes: []
      })
    });
    const field = await fieldResponse.json();
    assert.equal(fieldResponse.status, 201);
    assert.equal(field.fieldNote.learningStatus, "private-draft");
    assert.deepEqual(field.receipt.activeScopes, []);

    const proposalResponse = await fetch(`${base}/v1/proposals/export`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-innersignal-csrf": csrf },
      body: JSON.stringify({ cardId: "synthetic-server-card" })
    });
    const proposal = await proposalResponse.json();
    assert.equal(proposalResponse.status, 200);
    assert.match(proposalResponse.headers.get("content-disposition"), /attachment/);
    assert.equal(proposal.candidateOnly, true);
    assert.equal(proposal.activation, "proposal-only");
    assert.equal(proposal.runtimeWritable, false);
    assert.equal(proposal.card.runtimeAuthority, "none");

    const deletionResponse = await fetch(`${base}/v1/me`, {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json", "x-innersignal-csrf": csrf },
      body: JSON.stringify({ confirmation: "DELETE" })
    });
    const deletion = await deletionResponse.json();
    assert.equal(deletionResponse.status, 200);
    assert.equal(deletion.removedCounts.posts, 2);
    const afterDeletion = await fetch(`${base}/v1/bootstrap`, { headers: { cookie } });
    assert.equal(afterDeletion.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("network-accessible construction fails closed without invitation and moderation secrets", () => {
  assert.throws(() => createInnerSignalCommunityServer({ rootDir: "/tmp/unused", requireInviteCode: true, inviteCode: "" }), /invitation code/i);
  assert.throws(() => createInnerSignalCommunityServer({ rootDir: "/tmp/unused", requireInviteCode: true, inviteCode: "invite" }), /moderator key/i);
});

test("request authentication parsing and unexpected errors fail safely", () => {
  assert.equal(requestToken({ headers: { cookie: "__proto__=polluted; inner_signal_commons=valid%20token" } }), "valid token");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(requestToken({ headers: { authorization: `Bearer${" ".repeat(250_000)}bounded-token` } }), "bounded-token");
  assert.equal(requestToken({ headers: { authorization: "Basic ignored", cookie: "inner_signal_commons=fallback" } }), "fallback");

  const unexpected = formatHttpError(new Error("PRIVATE INTERNAL EXCEPTION DETAIL"));
  assert.deepEqual(unexpected, {
    status: 500,
    payload: { error: "Unexpected server error.", code: "UNEXPECTED_ERROR" }
  });
  assert.doesNotMatch(JSON.stringify(unexpected), /PRIVATE INTERNAL EXCEPTION DETAIL/);
});
