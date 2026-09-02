import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../core/errors.mjs";
import {
  CONSENT_TEXT_VERSION,
  SESSION_COOKIE,
  validateAccountDeletionInput,
  validateFieldNoteInput,
  validateModerationDecisionInput,
  validatePostInput,
  validatePotentialLessonInput,
  validateProposalExportInput,
  validateReactionInput,
  validateReplyInput,
  validateReportInput,
  validateSessionRequest,
  validateWithdrawalInput
} from "./contracts.mjs";
import { CommunityStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "../../apps/community");
const STATIC = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"]
});

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8", ...extraHeaders }));
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendDownload(res, filename, payload) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
  res.writeHead(200, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    "content-length": String(body.length)
  }));
  res.end(body);
}

async function sendStatic(res, pathname) {
  const entry = STATIC[pathname];
  if (!entry) return false;
  const [filename, contentType] = entry;
  const body = await fs.readFile(path.join(WEB_ROOT, filename));
  res.writeHead(200, securityHeaders({ "content-type": contentType, "content-length": String(body.length) }));
  res.end(body);
  return true;
}

async function readJson(req, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ValidationError(`Request body exceeds ${Math.round(maxBytes / 1_000_000)} MB.`);
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new ValidationError("Request body must be valid JSON.", { cause: error });
  }
}

function sessionCookieValue(req) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try { return decodeURIComponent(part.slice(separator + 1)); } catch { return ""; }
  }
  return "";
}

export function requestToken(req) {
  const authorization = String(req.headers.authorization ?? "");
  const bearer = authorization.slice(0, 6).toLowerCase() === "bearer"
    && [0x09, 0x20].includes(authorization.charCodeAt(6))
    ? authorization.slice(7).trim()
    : "";
  return bearer || sessionCookieValue(req);
}

export function formatHttpError(error) {
  const status = error.code === "AUTH_REQUIRED" ? 401
    : error.code === "CSRF_FAILED" || error.code === "MODERATOR_REQUIRED" ? 403
      : error.code === "RATE_LIMITED" ? 429
        : error instanceof ValidationError || error.code === "VALIDATION_ERROR" ? 400
          : 500;
  if (status === 500) {
    return { status, payload: { error: "Unexpected server error.", code: "UNEXPECTED_ERROR" } };
  }
  return {
    status,
    payload: {
      error: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionCookie(token, req, maxAgeSeconds) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  const secure = forwarded === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  const secure = forwarded === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

async function requireSession(store, req) {
  const authenticated = await store.authenticate(requestToken(req));
  if (!authenticated) {
    const error = new Error("Authentication required.");
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  return authenticated;
}

function requireCsrf(authenticated, req) {
  const received = String(req.headers["x-innersignal-csrf"] ?? "");
  if (!received || !constantTimeEqual(received, authenticated.session.csrfToken)) {
    const error = new Error("CSRF token is missing or invalid.");
    error.code = "CSRF_FAILED";
    throw error;
  }
}

function requireModerator(moderatorKey, req) {
  const received = String(req.headers["x-innersignal-moderator-key"] ?? "");
  if (!moderatorKey || !received || !constantTimeEqual(received, moderatorKey)) {
    const error = new Error("Moderator authorization required.");
    error.code = "MODERATOR_REQUIRED";
    throw error;
  }
}

function createSessionRateLimiter({ clock, windowMs = 15 * 60_000, maxAttempts = 20 } = {}) {
  const attempts = new Map();
  return function check(req) {
    const key = String(req.socket.remoteAddress ?? "unknown");
    const now = clock().getTime();
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > maxAttempts) {
      const error = new Error("Too many session attempts. Try again later.");
      error.code = "RATE_LIMITED";
      throw error;
    }
  };
}

export function createInnerSignalCommunityServer({
  rootDir,
  inviteCode = "",
  moderatorKey = "",
  requireInviteCode = false,
  sessionDays = 30,
  mainAppUrl = "http://localhost:8787",
  seedCards = null,
  clock = () => new Date()
}) {
  if (requireInviteCode && !String(inviteCode).trim()) {
    throw new ValidationError("An invitation code is required for network-accessible InnerSignal Commons.");
  }
  if (requireInviteCode && !String(moderatorKey).trim()) {
    throw new ValidationError("A moderator key is required for network-accessible InnerSignal Commons.");
  }
  const store = new CommunityStore({ rootDir, sessionDays, seedCards, clock });
  const ready = store.initialize();
  const checkSessionRate = createSessionRateLimiter({ clock });

  return http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && await sendStatic(res, url.pathname)) return;

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "innersignal-commons",
          version: "community-mvp-v1",
          storage: "first-party-json-event-ledger",
          noindex: true,
          directMessagesEnabled: false,
          rawPostModelTrainingEnabled: false,
          runtimeActivationEnabled: false,
          humanModerationConfigured: Boolean(moderatorKey)
        });
      }

      if (req.method === "GET" && url.pathname === "/v1/consent") {
        return sendJson(res, 200, {
          consentTextVersion: CONSENT_TEXT_VERSION,
          defaults: {
            privateInnerSignalSessionsImported: false,
            communityPostsUsedForLearning: false,
            fieldNotesUsedBeyondDisplay: false,
            rawPostModelTraining: false
          },
          scopes: [
            "ai-redaction",
            "community-aggregate",
            "product-improvement",
            "experiment-contact",
            "research-protocol",
            "external-researcher-sharing"
          ]
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/session") {
        checkSessionRate(req);
        const input = validateSessionRequest(await readJson(req));
        if ((requireInviteCode || inviteCode) && !constantTimeEqual(input.inviteCode, inviteCode)) {
          return sendJson(res, 403, { error: "A valid invitation code is required.", code: "INVITE_REQUIRED" });
        }
        const created = await store.createSession({ pseudonym: input.pseudonym, recoveryCode: input.recoveryCode });
        const maxAge = Math.max(60, Math.round((new Date(created.session.expiresAt).getTime() - clock().getTime()) / 1000));
        return sendJson(res, 201, {
          ok: true,
          participant: created.participant,
          session: created.session,
          recoveryCode: created.recoveryCode,
          recoveryCodeShownOnce: Boolean(created.recoveryCode),
          consentTextVersion: CONSENT_TEXT_VERSION,
          mainAppUrl
        }, { "set-cookie": sessionCookie(created.token, req, maxAge) });
      }

      if (req.method === "GET" && url.pathname === "/v1/bootstrap") {
        const authenticated = await requireSession(store, req);
        const bootstrap = await store.buildBootstrap(authenticated.participant);
        return sendJson(res, 200, { ...bootstrap, session: { csrfToken: authenticated.session.csrfToken, expiresAt: authenticated.session.expiresAt }, mainAppUrl });
      }

      if (req.method === "DELETE" && url.pathname === "/v1/session") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        await store.revokeSession(authenticated.session.sessionId, authenticated.participant.participantId);
        return sendJson(res, 200, { ok: true }, { "set-cookie": clearSessionCookie(req) });
      }

      if (req.method === "POST" && url.pathname === "/v1/posts") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const result = await store.createPost(authenticated.participant, validatePostInput(await readJson(req)));
        return sendJson(res, result.moderation?.status === "held-for-human-review" ? 202 : 201, { ok: true, post: result });
      }

      const replyMatch = url.pathname.match(/^\/v1\/posts\/([0-9a-f-]{36})\/replies$/i);
      if (req.method === "POST" && replyMatch) {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const state = await store.readState();
        const post = state.posts.find((item) => item.postId === replyMatch[1]);
        if (!post) return sendJson(res, 404, { error: "Post not found.", code: "NOT_FOUND" });
        const input = validateReplyInput(await readJson(req), post.responseContract);
        const reply = await store.createReply(authenticated.participant, post.postId, input);
        return sendJson(res, reply.moderation?.status === "held-for-human-review" ? 202 : 201, { ok: true, reply });
      }

      const reactionMatch = url.pathname.match(/^\/v1\/posts\/([0-9a-f-]{36})\/reactions$/i);
      if (req.method === "POST" && reactionMatch) {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const counts = await store.setReaction(authenticated.participant, reactionMatch[1], validateReactionInput(await readJson(req)));
        return sendJson(res, 200, { ok: true, reactions: counts });
      }

      const reportMatch = url.pathname.match(/^\/v1\/posts\/([0-9a-f-]{36})\/report$/i);
      if (req.method === "POST" && reportMatch) {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const report = await store.reportPost(authenticated.participant, reportMatch[1], validateReportInput(await readJson(req)));
        return sendJson(res, 201, { ok: true, report });
      }

      if (req.method === "POST" && url.pathname === "/v1/field-notes") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const created = await store.createFieldNote(authenticated.participant, validateFieldNoteInput(await readJson(req)));
        return sendJson(res, 201, { ok: true, ...created });
      }

      if (req.method === "POST" && url.pathname === "/v1/potential-lessons") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const potentialLesson = await store.createPotentialLesson(
          authenticated.participant,
          validatePotentialLessonInput(await readJson(req))
        );
        return sendJson(res, 201, { ok: true, potentialLesson });
      }

      const withdrawalMatch = url.pathname.match(/^\/v1\/field-notes\/([0-9a-f-]{36})\/withdraw$/i);
      if (req.method === "POST" && withdrawalMatch) {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const result = await store.withdrawFieldNote(authenticated.participant, withdrawalMatch[1], validateWithdrawalInput(await readJson(req)));
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (req.method === "GET" && url.pathname === "/v1/moderation/queue") {
        requireModerator(moderatorKey, req);
        return sendJson(res, 200, { ok: true, queue: await store.readModerationQueue() });
      }

      if (req.method === "POST" && url.pathname === "/v1/moderation/decision") {
        requireModerator(moderatorKey, req);
        const result = await store.recordModerationDecision(validateModerationDecisionInput(await readJson(req)));
        return sendJson(res, 200, { ok: true, decision: result });
      }

      if (req.method === "POST" && url.pathname === "/v1/proposals/export") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        const input = validateProposalExportInput(await readJson(req));
        const result = await store.exportProposal(authenticated.participant, input.cardId);
        return sendDownload(res, `innersignal-community-proposal-${result.proposalId}.json`, result.proposal);
      }

      if (req.method === "DELETE" && url.pathname === "/v1/me") {
        const authenticated = await requireSession(store, req);
        requireCsrf(authenticated, req);
        validateAccountDeletionInput(await readJson(req));
        const result = await store.deleteParticipantData(authenticated.participant);
        return sendJson(res, 200, { ok: true, ...result }, { "set-cookie": clearSessionCookie(req) });
      }

      if (req.method === "GET" && url.pathname === "/v1/me/export") {
        const authenticated = await requireSession(store, req);
        const exported = await store.exportParticipantData(authenticated.participant);
        return sendDownload(res, `innersignal-community-data-${authenticated.participant.participantId}.json`, exported);
      }

      return sendJson(res, 404, { error: "Not found.", code: "NOT_FOUND" });
    } catch (error) {
      const response = formatHttpError(error);
      return sendJson(res, response.status, response.payload);
    }
  });
}
