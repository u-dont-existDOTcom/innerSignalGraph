import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../core/errors.mjs";
import {
  COMMUNITY_FORMAT,
  CONSENT_TEXT_VERSION,
  activeConsentScopes,
  learningEligibility,
  moderationFlags,
  publicReplyTypes
} from "./contracts.mjs";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultExamplesRoot = path.resolve(moduleRoot, "../../community-learning/examples");
const queues = new Map();
export const MIN_PUBLIC_CARD_CONTRIBUTORS = 3;

function nowIso(clock) {
  return clock().toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function sha256Json(value) {
  return sha256Text(canonicalJson(value));
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function initialState(at) {
  return {
    format: COMMUNITY_FORMAT,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    participants: [],
    sessions: [],
    posts: [],
    consentGrants: [],
    fieldNotes: [],
    receipts: [],
    reports: [],
    proposalExports: []
  };
}

function queueMutation(key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  let queued;
  queued = next.finally(() => {
    if (queues.get(key) === queued) queues.delete(key);
  });
  queues.set(key, queued);
  return queued;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function appendEvent(file, event) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function normalizePractice(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unnamed-practice";
}

function publicParticipant(participant) {
  return {
    participantId: participant.participantId,
    pseudonym: participant.pseudonym,
    joinedAt: participant.joinedAt,
    status: participant.status
  };
}

function countReactions(reactions = []) {
  const output = { social: {}, evidence: {} };
  for (const item of reactions) {
    const bucket = output[item.channel];
    bucket[item.value] = (bucket[item.value] ?? 0) + 1;
  }
  return output;
}

function publicReply(reply, viewerParticipantId) {
  const own = reply.participantId === viewerParticipantId;
  if (reply.moderation.status !== "published" && !own) return null;
  return {
    replyId: reply.replyId,
    pseudonym: reply.pseudonymSnapshot,
    replyType: reply.replyType,
    body: reply.body,
    createdAt: reply.createdAt,
    moderation: own ? reply.moderation : undefined
  };
}

function publicPost(post, viewerParticipantId) {
  const own = post.participantId === viewerParticipantId;
  if (post.moderation.status !== "published" && !own) return null;
  return {
    postId: post.postId,
    own,
    pseudonym: post.pseudonymSnapshot,
    room: post.room,
    title: post.title,
    body: post.body,
    responseContract: post.responseContract,
    allowedReplyTypes: publicReplyTypes(post.responseContract),
    contentNote: post.contentNote,
    createdAt: post.createdAt,
    moderation: own ? post.moderation : undefined,
    reactions: countReactions(post.reactions),
    replies: post.replies.map((reply) => publicReply(reply, viewerParticipantId)).filter(Boolean)
  };
}

function publicCard(card) {
  const { sourceFieldNoteIds, sourceConsentGrantIds, ...safe } = card;
  return safe;
}

async function loadSeedCards(examplesRoot) {
  const cards = [];
  try {
    for (const name of (await fs.readdir(examplesRoot)).filter((item) => item.startsWith("learning-card-") && item.endsWith(".json")).sort()) {
      const value = await readJson(path.join(examplesRoot, name));
      if (value) cards.push(value);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return cards;
}

function fieldNoteGrant(state, note) {
  return state.consentGrants.find((grant) => grant.grantId === note.consentGrantId) ?? null;
}

function eligibleFieldNotes(state) {
  return state.fieldNotes.filter((note) => {
    if (note.learningStatus === "withdrawn") return false;
    const scopes = activeConsentScopes(fieldNoteGrant(state, note));
    return scopes.includes("community-aggregate") || scopes.includes("product-improvement");
  });
}

export function buildCommunityLearningCards(state, seedCards = [], clock = () => new Date()) {
  const cards = seedCards.map((card) => ({ ...card }));
  const groups = new Map();
  for (const note of eligibleFieldNotes(state)) {
    const key = normalizePractice(note.practiceOrFeature);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }

  for (const [key, notes] of groups) {
    const contributors = new Set(notes.map((note) => note.participantId));
    const counts = { benefit: 0, "no-change": 0, mixed: 0, worsening: 0, unclear: 0 };
    for (const note of notes) counts[note.overallOutcome] += 1;
    const nonzeroOutcomes = Object.values(counts).filter((count) => count > 0).length;
    const status = notes.length === 1
      ? "SINGLE_STORY"
      : nonzeroOutcomes > 1 ? "CONTESTED_PATTERN" : "COMMUNITY_PATTERN_CANDIDATE";
    const grants = notes.map((note) => fieldNoteGrant(state, note));
    const productProposalEligible = contributors.size >= MIN_PUBLIC_CARD_CONTRIBUTORS
      && notes.length >= MIN_PUBLIC_CARD_CONTRIBUTORS
      && grants.every((grant) => activeConsentScopes(grant).includes("product-improvement"));
    const timeCoverage = {
      immediate: notes.filter((note) => note.outcomes.immediate).length,
      laterSameDay: notes.filter((note) => note.outcomes.laterSameDay).length,
      nextMorning: notes.filter((note) => note.outcomes.nextMorning).length,
      followingTwoToThreeDays: notes.filter((note) => note.outcomes.followingTwoToThreeDays).length,
      longerFollowUp: notes.filter((note) => note.outcomes.longerFollowUp).length
    };
    const downsideReportCount = notes.filter((note) => note.downsides).length;
    const contextReportCount = notes.filter((note) => note.context).length;
    const confounderReportCount = notes.filter((note) => note.confounders).length;
    const contexts = contextReportCount
      ? [`Context information was supplied in ${contextReportCount} of ${notes.length} eligible Field Notes; raw context remains reviewer-restricted in this MVP.`]
      : [];
    const confounders = confounderReportCount
      ? [`Possible confounders were reported in ${confounderReportCount} of ${notes.length} eligible Field Notes; raw prose is not republished on this card.`]
      : [];
    const practice = notes[0].practiceOrFeature;
    cards.push({
      format: "inner-signal-community-learning-card-v1",
      cardId: `community-${key}-${sha256Text(key).slice(0, 10)}`,
      sourceKind: "community-field-notes",
      status,
      reviewStatus: "unreviewed",
      runtimeAuthority: "none",
      practiceOrFeature: practice,
      observation: `${notes.length} eligible Field Note${notes.length === 1 ? "" : "s"} currently describe ${practice}. This is a bounded community observation, not an efficacy claim.`,
      independentContributorCount: contributors.size,
      sourceCount: notes.length,
      outcomeCounts: counts,
      timeCoverage,
      contexts,
      confounders,
      adverseSignals: [
        ...(counts.worsening ? [`${counts.worsening} Field Note${counts.worsening === 1 ? " reports" : "s report"} overall worsening.`] : []),
        ...(downsideReportCount ? [`${downsideReportCount} Field Note${downsideReportCount === 1 ? " includes" : "s include"} a downside or unwanted effect; verbatim details remain reviewer-restricted.`] : [])
      ],
      unknowns: [
        "Participation is self-selected.",
        "The reports are not a controlled comparison.",
        "External evidence has not been checked.",
        "Field Note prose is not republished in participant-facing Learning Cards.",
        ...(contributors.size < MIN_PUBLIC_CARD_CONTRIBUTORS
          ? [`This card is suppressed from the shared Learning Card view until at least ${MIN_PUBLIC_CARD_CONTRIBUTORS} independent contributors are represented.`]
          : [])
      ],
      externalEvidence: { status: "not-checked", references: [] },
      evidenceProfile: {
        independentContributors: contributors.size,
        withinPersonRepetition: notes.filter((note) => note.repeatedObservation === true).length,
        temporalSpecificity: Object.values(timeCoverage).reduce((sum, value) => sum + value, 0),
        negativeAndAdverseCoverage: counts["no-change"] + counts.mixed + counts.worsening,
        confoundingBurden: confounderReportCount,
        missingLongerFollowUp: notes.length - timeCoverage.longerFollowUp,
        freshness: "current"
      },
      productProposalEligible,
      sourceFieldNoteIds: notes.map((note) => note.fieldNoteId),
      sourceConsentGrantIds: grants.map((grant) => grant.grantId),
      createdAt: notes.map((note) => note.createdAt).sort()[0],
      updatedAt: nowIso(clock),
      nextReviewAt: new Date(clock().getTime() + 30 * 86_400_000).toISOString()
    });
  }
  return cards.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
}

function refreshReceiptUsage(state, seedCards, clock) {
  const cards = buildCommunityLearningCards(state, seedCards, clock);
  for (const receipt of state.receipts) {
    receipt.usageRefs.cardIds = cards
      .filter((card) => card.sourceFieldNoteIds?.includes(receipt.contributionId))
      .map((card) => card.cardId);
    receipt.updatedAt = nowIso(clock);
  }
  const cardById = new Map(cards.map((card) => [card.cardId, card]));
  for (const proposal of state.proposalExports) {
    const current = cardById.get(proposal.sourceCardId);
    if (!current || (current.sourceKind !== "synthetic" && !current.productProposalEligible)) {
      proposal.status = "stale-consent-change";
      proposal.staleAt ??= nowIso(clock);
    }
  }
  return cards;
}

export class CommunityStore {
  constructor({ rootDir, examplesRoot = defaultExamplesRoot, seedCards = null, sessionDays = 30, clock = () => new Date() }) {
    if (!rootDir) throw new ValidationError("CommunityStore rootDir is required.");
    this.rootDir = path.resolve(rootDir);
    this.stateFile = path.join(this.rootDir, "state.json");
    this.eventsFile = path.join(this.rootDir, "events.ndjson");
    this.examplesRoot = examplesRoot;
    this.seedCardsOverride = seedCards;
    this.sessionDays = sessionDays;
    this.clock = clock;
    this.seedCards = [];
  }

  async initialize() {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    this.seedCards = this.seedCardsOverride ?? await loadSeedCards(this.examplesRoot);
    const current = await readJson(this.stateFile);
    if (!current) await atomicWriteJson(this.stateFile, initialState(nowIso(this.clock)));
    else if (current.format !== COMMUNITY_FORMAT) throw new ValidationError("Unsupported community state format.");
    return this;
  }

  async readState() {
    const state = await readJson(this.stateFile);
    if (!state || state.format !== COMMUNITY_FORMAT) throw new ValidationError("Community state is missing or invalid.");
    return state;
  }

  async mutate(type, actorParticipantId, subjectId, operation) {
    return queueMutation(this.stateFile, async () => {
      const state = await this.readState();
      const result = await operation(state);
      state.revision += 1;
      state.updatedAt = nowIso(this.clock);
      await atomicWriteJson(this.stateFile, state);
      await appendEvent(this.eventsFile, {
        format: "inner-signal-community-event-v1",
        eventId: crypto.randomUUID(),
        type,
        actorParticipantId: actorParticipantId ?? null,
        subjectId: subjectId ?? null,
        at: state.updatedAt,
        stateRevision: state.revision
      });
      return result;
    });
  }

  async createSession({ pseudonym, recoveryCode = "" }) {
    let issuedToken;
    let issuedRecoveryCode = null;
    const result = await this.mutate("session-created", null, null, (state) => {
      const normalized = pseudonym.toLocaleLowerCase();
      let participant = state.participants.find((item) => item.pseudonym.toLocaleLowerCase() === normalized && item.status === "active");
      const at = nowIso(this.clock);
      if (participant) {
        if (!recoveryCode || sha256Text(recoveryCode) !== participant.recoveryCodeHash) {
          throw new ValidationError("That pseudonym already exists. Supply its recovery code to return.");
        }
      } else {
        issuedRecoveryCode = randomSecret(12);
        participant = {
          participantId: crypto.randomUUID(),
          pseudonym,
          recoveryCodeHash: sha256Text(issuedRecoveryCode),
          joinedAt: at,
          status: "active"
        };
        state.participants.push(participant);
      }
      state.sessions = state.sessions.filter((item) => !item.revokedAt && new Date(item.expiresAt) > this.clock());
      issuedToken = randomSecret(32);
      const session = {
        sessionId: crypto.randomUUID(),
        participantId: participant.participantId,
        tokenHash: sha256Text(issuedToken),
        csrfToken: randomSecret(24),
        createdAt: at,
        expiresAt: new Date(this.clock().getTime() + this.sessionDays * 86_400_000).toISOString(),
        revokedAt: null,
        adultConfirmedAt: at,
        communityAgreementAcceptedAt: at,
        agreementVersion: CONSENT_TEXT_VERSION
      };
      state.sessions.push(session);
      return { participant: publicParticipant(participant), session: { sessionId: session.sessionId, csrfToken: session.csrfToken, expiresAt: session.expiresAt } };
    });
    return { ...result, token: issuedToken, recoveryCode: issuedRecoveryCode };
  }

  async authenticate(token) {
    if (!token) return null;
    const state = await this.readState();
    const tokenHash = sha256Text(token);
    const session = state.sessions.find((item) => item.tokenHash === tokenHash && !item.revokedAt && new Date(item.expiresAt) > this.clock());
    if (!session) return null;
    const participant = state.participants.find((item) => item.participantId === session.participantId && item.status === "active");
    if (!participant) return null;
    return { state, session, participant };
  }

  async revokeSession(sessionId, participantId) {
    return this.mutate("session-revoked", participantId, sessionId, (state) => {
      const session = state.sessions.find((item) => item.sessionId === sessionId && item.participantId === participantId);
      if (session) session.revokedAt = nowIso(this.clock);
      return { ok: true };
    });
  }

  async createPost(participant, input) {
    const postId = crypto.randomUUID();
    return this.mutate("post-created", participant.participantId, postId, (state) => {
      const flags = moderationFlags(`${input.title}\n${input.body}`);
      const post = {
        postId,
        participantId: participant.participantId,
        pseudonymSnapshot: participant.pseudonym,
        room: input.room,
        title: input.title,
        body: input.body,
        responseContract: input.responseContract,
        contentNote: input.contentNote,
        conversationOnly: true,
        createdAt: nowIso(this.clock),
        moderation: {
          status: flags.length ? "held-for-human-review" : "published",
          flags,
          reviewedAt: null,
          reviewerNote: ""
        },
        reactions: [],
        replies: []
      };
      state.posts.push(post);
      return publicPost(post, participant.participantId);
    });
  }

  async createReply(participant, postId, input) {
    const replyId = crypto.randomUUID();
    return this.mutate("reply-created", participant.participantId, replyId, (state) => {
      const post = state.posts.find((item) => item.postId === postId);
      if (!post) throw new ValidationError("Post not found.");
      const flags = moderationFlags(input.body);
      const reply = {
        replyId,
        participantId: participant.participantId,
        pseudonymSnapshot: participant.pseudonym,
        replyType: input.replyType,
        body: input.body,
        createdAt: nowIso(this.clock),
        moderation: { status: flags.length ? "held-for-human-review" : "published", flags, reviewedAt: null, reviewerNote: "" }
      };
      post.replies.push(reply);
      return publicReply(reply, participant.participantId);
    });
  }

  async setReaction(participant, postId, input) {
    return this.mutate("reaction-set", participant.participantId, postId, (state) => {
      const post = state.posts.find((item) => item.postId === postId);
      if (!post) throw new ValidationError("Post not found.");
      post.reactions = post.reactions.filter((item) => !(item.participantId === participant.participantId && item.channel === input.channel));
      post.reactions.push({ participantId: participant.participantId, channel: input.channel, value: input.value, at: nowIso(this.clock) });
      return countReactions(post.reactions);
    });
  }

  async reportPost(participant, postId, input) {
    const reportId = crypto.randomUUID();
    return this.mutate("post-reported", participant.participantId, reportId, (state) => {
      if (!state.posts.some((item) => item.postId === postId)) throw new ValidationError("Post not found.");
      const report = {
        reportId,
        reporterParticipantId: participant.participantId,
        postId,
        category: input.category,
        detail: input.detail,
        createdAt: nowIso(this.clock),
        status: "open"
      };
      state.reports.push(report);
      return { reportId, status: report.status };
    });
  }

  async readModerationQueue() {
    const state = await this.readState();
    return {
      posts: state.posts
        .filter((post) => post.moderation.status === "held-for-human-review")
        .map((post) => ({
          targetType: "post",
          targetId: post.postId,
          pseudonym: post.pseudonymSnapshot,
          title: post.title,
          body: post.body,
          responseContract: post.responseContract,
          flags: post.moderation.flags,
          createdAt: post.createdAt
        })),
      replies: state.posts.flatMap((post) => post.replies
        .filter((reply) => reply.moderation.status === "held-for-human-review")
        .map((reply) => ({
          targetType: "reply",
          targetId: reply.replyId,
          postId: post.postId,
          pseudonym: reply.pseudonymSnapshot,
          body: reply.body,
          replyType: reply.replyType,
          flags: reply.moderation.flags,
          createdAt: reply.createdAt
        }))),
      reports: state.reports.filter((report) => report.status === "open")
    };
  }

  async recordModerationDecision(input) {
    return this.mutate("moderation-decision-recorded", null, input.targetId, (state) => {
      const at = nowIso(this.clock);
      if (input.targetType === "post") {
        const post = state.posts.find((item) => item.postId === input.targetId);
        if (!post) throw new ValidationError("Moderation post target not found.");
        if (!["publish", "remove", "escalate"].includes(input.decision)) throw new ValidationError("Invalid decision for a post.");
        post.moderation.status = input.decision === "publish" ? "published" : input.decision === "remove" ? "removed" : "escalated";
        post.moderation.reviewedAt = at;
        post.moderation.reviewerNote = input.note;
        return { targetType: "post", targetId: input.targetId, status: post.moderation.status };
      }
      if (input.targetType === "reply") {
        const reply = state.posts.flatMap((post) => post.replies).find((item) => item.replyId === input.targetId);
        if (!reply) throw new ValidationError("Moderation reply target not found.");
        if (!["publish", "remove", "escalate"].includes(input.decision)) throw new ValidationError("Invalid decision for a reply.");
        reply.moderation.status = input.decision === "publish" ? "published" : input.decision === "remove" ? "removed" : "escalated";
        reply.moderation.reviewedAt = at;
        reply.moderation.reviewerNote = input.note;
        return { targetType: "reply", targetId: input.targetId, status: reply.moderation.status };
      }
      const report = state.reports.find((item) => item.reportId === input.targetId);
      if (!report) throw new ValidationError("Moderation report target not found.");
      if (!["resolve", "escalate"].includes(input.decision)) throw new ValidationError("Invalid decision for a report.");
      report.status = input.decision === "resolve" ? "resolved" : "escalated";
      report.reviewedAt = at;
      report.reviewerNote = input.note;
      return { targetType: "report", targetId: input.targetId, status: report.status };
    });
  }

  async createFieldNote(participant, input) {
    const fieldNoteId = crypto.randomUUID();
    const grantId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    return this.mutate("field-note-created", participant.participantId, fieldNoteId, (state) => {
      if (input.sourcePostId) {
        const source = state.posts.find((item) => item.postId === input.sourcePostId && item.participantId === participant.participantId);
        if (!source) throw new ValidationError("A Field Note may only reference your own existing post.");
      }
      const at = nowIso(this.clock);
      const grant = {
        format: "inner-signal-consent-grant-v1",
        grantId,
        participantId: participant.participantId,
        contributionId: fieldNoteId,
        contributionType: "field-note",
        consentTextVersion: CONSENT_TEXT_VERSION,
        scopes: input.consentScopes,
        revokedScopes: [],
        grantedAt: at,
        updatedAt: at
      };
      const note = {
        format: "inner-signal-field-note-v1",
        fieldNoteId,
        participantId: participant.participantId,
        pseudonymSnapshot: participant.pseudonym,
        sourcePostId: input.sourcePostId || null,
        practiceOrFeature: input.practiceOrFeature,
        goal: input.goal,
        whatTried: input.whatTried,
        context: input.context,
        priorExperience: input.priorExperience,
        outcomes: input.outcomes,
        overallOutcome: input.overallOutcome,
        downsides: input.downsides,
        confounders: input.confounders,
        wouldRepeat: input.wouldRepeat,
        causalConfidence: input.causalConfidence,
        repeatedObservation: false,
        consentGrantId: grantId,
        learningStatus: learningEligibility(input.consentScopes),
        createdAt: at,
        updatedAt: at
      };
      const receipt = {
        format: "inner-signal-contribution-receipt-v1",
        receiptId,
        participantId: participant.participantId,
        contributionId: fieldNoteId,
        contributionType: "field-note",
        consentGrantId: grantId,
        consentTextVersion: CONSENT_TEXT_VERSION,
        activeScopes: [...input.consentScopes],
        withdrawnScopes: [],
        usageRefs: { cardIds: [], proposalIds: [] },
        createdAt: at,
        updatedAt: at
      };
      state.consentGrants.push(grant);
      state.fieldNotes.push(note);
      state.receipts.push(receipt);
      refreshReceiptUsage(state, this.seedCards, this.clock);
      return { fieldNote: note, receipt };
    });
  }

  async withdrawFieldNote(participant, fieldNoteId, input) {
    return this.mutate("field-note-consent-withdrawn", participant.participantId, fieldNoteId, (state) => {
      const note = state.fieldNotes.find((item) => item.fieldNoteId === fieldNoteId && item.participantId === participant.participantId);
      if (!note) throw new ValidationError("Field Note not found.");
      const grant = fieldNoteGrant(state, note);
      const receipt = state.receipts.find((item) => item.contributionId === fieldNoteId);
      const revoked = new Set(grant.revokedScopes);
      for (const scope of input.scopes) {
        if (grant.scopes.includes(scope)) revoked.add(scope);
      }
      grant.revokedScopes = [...revoked].sort();
      grant.updatedAt = nowIso(this.clock);
      const active = activeConsentScopes(grant);
      note.learningStatus = learningEligibility(active) === "private-draft" ? "withdrawn" : learningEligibility(active);
      note.updatedAt = grant.updatedAt;
      receipt.activeScopes = active;
      receipt.withdrawnScopes = [...grant.revokedScopes];
      receipt.withdrawalReason = input.reason;
      receipt.updatedAt = grant.updatedAt;
      refreshReceiptUsage(state, this.seedCards, this.clock);
      return { fieldNote: note, receipt };
    });
  }

  async deleteParticipantData(participant) {
    return this.mutate("participant-data-deleted", participant.participantId, participant.participantId, (state) => {
      const at = nowIso(this.clock);
      const removedReceipts = state.receipts.filter((item) => item.participantId === participant.participantId);
      const affectedCardIds = new Set(removedReceipts.flatMap((item) => item.usageRefs.cardIds));
      const removedPostIds = new Set(state.posts.filter((post) => post.participantId === participant.participantId).map((post) => post.postId));
      const removedCounts = {
        posts: removedPostIds.size,
        replies: state.posts.reduce((sum, post) => sum + post.replies.filter((reply) => reply.participantId === participant.participantId).length, 0),
        fieldNotes: state.fieldNotes.filter((note) => note.participantId === participant.participantId).length,
        receipts: removedReceipts.length
      };

      state.posts = state.posts
        .filter((post) => !removedPostIds.has(post.postId))
        .map((post) => ({
          ...post,
          replies: post.replies.filter((reply) => reply.participantId !== participant.participantId),
          reactions: post.reactions.filter((reaction) => reaction.participantId !== participant.participantId)
        }));
      state.fieldNotes = state.fieldNotes.filter((note) => note.participantId !== participant.participantId);
      state.consentGrants = state.consentGrants.filter((grant) => grant.participantId !== participant.participantId);
      state.receipts = state.receipts.filter((receipt) => receipt.participantId !== participant.participantId);
      state.reports = state.reports.filter((report) => report.reporterParticipantId !== participant.participantId && !removedPostIds.has(report.postId));
      state.sessions = state.sessions.filter((session) => session.participantId !== participant.participantId);

      const record = state.participants.find((item) => item.participantId === participant.participantId);
      if (record) {
        record.pseudonym = "Deleted member";
        record.recoveryCodeHash = null;
        record.status = "deleted";
        record.deletedAt = at;
      }
      for (const proposal of state.proposalExports) {
        if (proposal.generatedByParticipantId === participant.participantId) proposal.generatedByParticipantId = null;
        if (affectedCardIds.has(proposal.sourceCardId) || proposal.generatedByParticipantId === null) {
          proposal.status = "stale-data-deletion";
          proposal.staleAt ??= at;
        }
      }
      refreshReceiptUsage(state, this.seedCards, this.clock);
      return { deletedAt: at, removedCounts };
    });
  }

  async buildBootstrap(participant) {
    const state = await this.readState();
    const cards = buildCommunityLearningCards(state, this.seedCards, this.clock);
    return {
      format: "inner-signal-community-bootstrap-v1",
      participant: publicParticipant(participant),
      rooms: [
        ["using-innersignal", "Using InnerSignal"],
        ["inner-child-parts", "Inner-child and parts work"],
        ["meditation-awareness", "Meditation and awareness"],
        ["somatic-practices", "Somatic practices"],
        ["self-hypnosis", "Self-hypnosis"],
        ["sleep", "Sleep"],
        ["relationships-daily-life", "Relationships and everyday experiments"],
        ["governance-learning", "Governance and product learning"]
      ],
      posts: state.posts.map((post) => publicPost(post, participant.participantId)).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      learningCards: cards
        .filter((card) => card.sourceKind === "synthetic" || card.independentContributorCount >= MIN_PUBLIC_CARD_CONTRIBUTORS)
        .map(publicCard),
      myFieldNotes: state.fieldNotes.filter((note) => note.participantId === participant.participantId),
      myReceipts: state.receipts.filter((receipt) => receipt.participantId === participant.participantId),
      stats: {
        participants: state.participants.filter((item) => item.status === "active").length,
        publishedPosts: state.posts.filter((item) => item.moderation.status === "published").length,
        eligibleFieldNotes: eligibleFieldNotes(state).length,
        openModerationReports: state.reports.filter((item) => item.status === "open").length
      },
      policy: {
        privateSessionsImported: false,
        postsConversationOnlyByDefault: true,
        directMessagesEnabled: false,
        rawPostModelTrainingEnabled: false,
        runtimeActivationEnabled: false,
        consentTextVersion: CONSENT_TEXT_VERSION
      }
    };
  }

  async exportProposal(participant, cardId) {
    let downloadable;
    const result = await this.mutate("proposal-exported", participant.participantId, cardId, (state) => {
      const cards = buildCommunityLearningCards(state, this.seedCards, this.clock);
      const card = cards.find((item) => item.cardId === cardId);
      if (!card) throw new ValidationError("Learning Card not found.");
      if (card.sourceKind !== "synthetic" && !card.productProposalEligible) {
        throw new ValidationError(`This card requires at least ${MIN_PUBLIC_CARD_CONTRIBUTORS} independent, product-improvement-consented contributors.`);
      }
      const generatedAt = nowIso(this.clock);
      const proposalId = crypto.randomUUID();
      const consentSnapshot = card.sourceConsentGrantIds?.map((grantId) => {
        const grant = state.consentGrants.find((item) => item.grantId === grantId);
        return { grantId, activeScopes: activeConsentScopes(grant), updatedAt: grant?.updatedAt ?? null };
      }) ?? [];
      const proposal = {
        format: "inner-signal-community-proposal-v1",
        proposalId,
        candidateOnly: true,
        activation: "proposal-only",
        runtimeWritable: false,
        sourceCardId: card.cardId,
        sourceCardSha256: sha256Json(card),
        consentSnapshotSha256: sha256Json(consentSnapshot),
        generatedAt,
        generatedByParticipantId: participant.participantId,
        card: publicCard(card),
        unresolvedLimitations: card.unknowns,
        requiredNextGate: card.sourceKind === "synthetic" ? "replace-synthetic-evidence" : "human-learning-review",
        prohibitedTransitions: ["runtime activation", "stable installation", "direct guide-graph write"],
        integrity: { algorithm: "sha256", sha256: "" }
      };
      proposal.integrity.sha256 = sha256Json({ ...proposal, integrity: { algorithm: "sha256", sha256: "" } });
      state.proposalExports.push({
        proposalId,
        sourceCardId: card.cardId,
        generatedByParticipantId: participant.participantId,
        generatedAt,
        sha256: proposal.integrity.sha256,
        candidateOnly: true,
        runtimeWritable: false,
        status: "current",
        staleAt: null
      });
      for (const receipt of state.receipts.filter((item) => card.sourceFieldNoteIds?.includes(item.contributionId))) {
        if (!receipt.usageRefs.proposalIds.includes(proposalId)) receipt.usageRefs.proposalIds.push(proposalId);
        receipt.updatedAt = generatedAt;
      }
      downloadable = proposal;
      return { proposalId, sha256: proposal.integrity.sha256 };
    });
    return { ...result, proposal: downloadable };
  }

  async exportParticipantData(participant) {
    const state = await this.readState();
    return {
      format: "inner-signal-community-participant-export-v1",
      exportedAt: nowIso(this.clock),
      participant: publicParticipant(participant),
      posts: state.posts.filter((post) => post.participantId === participant.participantId).map((post) => ({ ...post, reactions: post.reactions.filter((item) => item.participantId === participant.participantId) })),
      replies: state.posts.flatMap((post) => post.replies.filter((reply) => reply.participantId === participant.participantId).map((reply) => ({ postId: post.postId, ...reply }))),
      fieldNotes: state.fieldNotes.filter((note) => note.participantId === participant.participantId),
      consentGrants: state.consentGrants.filter((grant) => grant.participantId === participant.participantId),
      receipts: state.receipts.filter((receipt) => receipt.participantId === participant.participantId),
      reports: state.reports.filter((report) => report.reporterParticipantId === participant.participantId),
      proposalExports: state.proposalExports.filter((proposal) => proposal.generatedByParticipantId === participant.participantId)
    };
  }
}
