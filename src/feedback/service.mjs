import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { FeedbackStoreError } from "./store.mjs";
import { createClientKeyer, createRateLimiter } from "./limits.mjs";
import {
  pageHeaders,
  renderAlreadySentPage,
  renderClosedPage,
  renderDeletePage,
  renderFormPage,
  renderNotFoundPage,
  renderReviewsPage,
  renderThanksPage
} from "./page.mjs";

// The feedback service (design sections 5 to 10): the page's routes under /feedback, the owner's routes under /feedback/owner/,
// and the send the chat tool uses. The connector hands it every request whose path is /feedback or starts with /feedback/;
// nothing else reaches it. It takes everything it needs as arguments, so it could run in a process of its own.

export const FEEDBACK_BASE_PATH = "/feedback";
const PAGE_BODY_MAX = 64 * 1024;
const DELETE_BODY_MAX = 4 * 1024;
const OWNER_BODY_MAX = 64 * 1024;
const BODY_TIMEOUT_MS = 10_000;
const TOKEN_MIN_AGE_MS = 2_000;
const TOKEN_MAX_AGE_MS = 24 * 3_600_000;
const CODE_MEMORY_MS = 30 * 60_000;
const USED_TOKEN_MAX = 5_000;
const SWEEP_EVERY_MS = 3_600_000;

export const ownsFeedbackPath = (pathname) => pathname === FEEDBACK_BASE_PATH || pathname.startsWith(`${FEEDBACK_BASE_PATH}/`);

class RequestBodyError extends Error {
  constructor(status) {
    super("The request body was refused.");
    this.status = status;
  }
}

// Reads a body up to `maxBytes` within `timeoutMs`. A larger or slower body is refused; the caller answers and closes the
// connection. These limits apply to /feedback only: the connector's own timeouts don't change.
function readBody(req, { maxBytes, timeoutMs = BODY_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      if (error) {
        req.pause();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return finish(new RequestBodyError(413));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => finish(null, Buffer.concat(chunks));
    const onError = () => finish(new RequestBodyError(400));
    const timer = setTimeout(() => finish(new RequestBodyError(408)), timeoutMs);
    const declared = Number.parseInt(req.headers["content-length"] ?? "", 10);
    if (Number.isFinite(declared) && declared > maxBytes) return finish(new RequestBodyError(413));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

// Form tokens: issued time and a random value, signed with a key made at start, accepted from 2 seconds to 24 hours after issue,
// and once. A used token is remembered for its whole life; the code it gave is kept with it for 30 minutes only, so a second
// press of Send within that time shows the same thank-you page and later shows "already sent".
function createFormTokens({ now, secret = randomBytes(32) }) {
  const used = new Map();
  const mac = (payload) => createHmac("sha256", secret).update(payload, "utf8").digest("base64url").slice(0, 32);
  const forget = (at) => {
    for (const [nonce, entry] of used) {
      if (entry.until <= at) used.delete(nonce);
      else if (entry.code && entry.codeUntil <= at) entry.code = null;
    }
    while (used.size > USED_TOKEN_MAX) used.delete(used.keys().next().value);
  };
  return Object.freeze({
    issue() {
      const payload = `${now()}.${randomBytes(12).toString("base64url")}`;
      return `${payload}.${mac(payload)}`;
    },
    check(token) {
      const match = typeof token === "string" ? /^(\d{1,16})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{32})$/u.exec(token) : null;
      if (!match) return { ok: false, reason: "invalid" };
      const expected = Buffer.from(mac(`${match[1]}.${match[2]}`), "utf8");
      const actual = Buffer.from(match[3], "utf8");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "invalid" };
      const at = now();
      forget(at);
      const previous = used.get(match[2]);
      if (previous) return { ok: false, reason: "used", code: previous.code };
      const age = at - Number(match[1]);
      if (age < TOKEN_MIN_AGE_MS) return { ok: false, reason: "too_fast" };
      if (age > TOKEN_MAX_AGE_MS) return { ok: false, reason: "invalid" };
      return { ok: true, nonce: match[2], issuedAt: Number(match[1]) };
    },
    markUsed(nonce, issuedAt, code) {
      const at = now();
      used.set(nonce, { until: issuedAt + TOKEN_MAX_AGE_MS, code, codeUntil: at + CODE_MEMORY_MS });
      forget(at);
    }
  });
}

function respond(res, status, body, headers, { close = false } = {}) {
  const bytes = Buffer.from(body, "utf8");
  res.writeHead(status, { ...headers, "content-length": String(bytes.length), ...(close ? { connection: "close" } : {}) });
  if (close) res.once("finish", () => res.socket?.destroySoon?.());
  res.end(bytes);
}

function sendHtml(res, status, html, extraHeaders = {}, options = {}) {
  respond(res, status, html, pageHeaders(extraHeaders), options);
}

function sendJson(res, status, payload, extraHeaders = {}, options = {}) {
  respond(res, status, `${JSON.stringify(payload)}\n`, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders
  }, options);
}

const isForm = (req) => /^application\/x-www-form-urlencoded(?:\s*;|$)/iu.test(String(req.headers["content-type"] ?? ""));
const isJson = (req) => /^application\/json(?:\s*;|$)/iu.test(String(req.headers["content-type"] ?? ""));
const sha256Bytes = (value) => createHash("sha256").update(value, "utf8").digest();

// While the page is off but the served rules name its address: every /feedback path gets the closed page (design section 10).
export function sendFeedbackClosed(res) {
  sendHtml(res, 503, renderClosedPage(), { "retry-after": "3600" });
}

export function createFeedbackService({
  store,
  ownerTokenSha256,
  trustForwardedFor = false,
  now = Date.now,
  limiter = createRateLimiter({ now }),
  clientKey = createClientKeyer({ trustForwardedFor }),
  tokens = createFormTokens({ now }),
  sweepEveryMs = SWEEP_EVERY_MS,
  log = () => {}
} = {}) {
  if (!store || typeof store.add !== "function") throw new TypeError("createFeedbackService needs a feedback store.");
  if (typeof ownerTokenSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(ownerTokenSha256)) throw new TypeError("ownerTokenSha256 must be 64 lowercase hex characters.");
  const ownerTokenDigest = Buffer.from(ownerTokenSha256, "hex");
  const counts = { limit_refusals: { page: 0, chat: 0 }, full_refusals: { page: 0, chat: 0 }, hidden_field_hits: 0, owner_refusals: 0 };
  const note = (event) => { try { log(event); } catch { /* a log sink never breaks a request */ } };

  // Sweep at start and every hour; a failed sweep is retried at the next one.
  const sweep = () => store.sweep().then((result) => note({ event: "feedback_sweep", expired: result.expired }), () => note({ event: "feedback_sweep", failed: true }));
  void sweep();
  const sweeper = sweepEveryMs > 0 ? setInterval(sweep, sweepEveryMs) : null;
  sweeper?.unref?.();

  // A send through one door, after that door's own checks. Refusals are FeedbackStoreError codes.
  async function send(value, { via, key }) {
    const own = via === "page" ? "page_send" : "chat_send";
    const all = via === "page" ? "page_all" : "chat_all";
    if (limiter.full(own, key) || limiter.full(all)) {
      counts.limit_refusals[via] += 1;
      throw new FeedbackStoreError("FEEDBACK_BUSY");
    }
    try {
      const result = await store.add(value, { via });
      limiter.take(own, key);
      limiter.take(all);
      return result;
    } catch (error) {
      if (error instanceof FeedbackStoreError) {
        if (error.code === "FEEDBACK_FULL") counts.full_refusals[via] += 1;
        throw error;
      }
      note({ event: "feedback_store_error", code: typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/u.test(error.code) ? error.code : "OTHER" });
      throw new FeedbackStoreError("FEEDBACK_UNAVAILABLE");
    }
  }

  async function handlePageSend(req, res) {
    if (!isForm(req)) return sendHtml(res, 415, renderFormPage({ token: tokens.issue(), error: "FEEDBACK_UNAVAILABLE" }));
    const form = new URLSearchParams((await readBody(req, { maxBytes: PAGE_BODY_MAX })).toString("utf8"));
    const values = {
      kind: form.get("kind") ?? "",
      text: form.get("text") ?? "",
      replyAddress: form.get("reply_address") ?? "",
      mayShowPublicly: form.get("may_show_publicly") === "yes"
    };
    // A filled hidden field: nothing is stored and the form comes back, never a false "sent" (a person's browser may have filled it).
    if ((form.get("extra") ?? "") !== "") {
      counts.hidden_field_hits += 1;
      return sendHtml(res, 400, renderFormPage({ token: tokens.issue(), values, error: "FEEDBACK_SEND_AGAIN" }));
    }
    const token = form.get("form_token") ?? "";
    const checked = tokens.check(token);
    if (!checked.ok) {
      if (checked.reason === "used") return sendHtml(res, 200, checked.code ? renderThanksPage({ code: checked.code }) : renderAlreadySentPage({}));
      return sendHtml(res, 400, renderFormPage({
        token: checked.reason === "too_fast" ? token : tokens.issue(),
        values,
        error: checked.reason === "too_fast" ? "FEEDBACK_SEND_AGAIN" : "FEEDBACK_FORM_EXPIRED"
      }));
    }
    try {
      const sent = await send({ kind: values.kind, text: values.text, replyAddress: values.replyAddress, mayShowPublicly: values.mayShowPublicly },
        { via: "page", key: clientKey(req) });
      tokens.markUsed(checked.nonce, checked.issuedAt, sent.code);
      return sendHtml(res, 200, renderThanksPage({ code: sent.code }));
    } catch (error) {
      const code = error instanceof FeedbackStoreError ? error.code : "FEEDBACK_UNAVAILABLE";
      const status = code === "FEEDBACK_BUSY" ? 429 : ["FEEDBACK_FULL", "FEEDBACK_UNAVAILABLE"].includes(code) ? 503 : 400;
      return sendHtml(res, status, renderFormPage({ token, values, error: code }), status === 429 ? { "retry-after": "600" } : {});
    }
  }

  async function handleDelete(req, res) {
    if (!isForm(req)) return sendHtml(res, 415, renderDeletePage({}));
    const form = new URLSearchParams((await readBody(req, { maxBytes: DELETE_BODY_MAX })).toString("utf8"));
    if (!limiter.take("delete_attempt", clientKey(req))) return sendHtml(res, 429, renderDeletePage({ result: "busy" }), { "retry-after": "3600" });
    const outcome = await store.deleteByCode(form.get("code") ?? "", "sender");
    if (outcome.deleted) note({ event: "feedback_deleted", by: "sender" });
    return sendHtml(res, outcome.deleted ? 200 : 400, renderDeletePage({
      result: outcome.deleted ? "deleted" : outcome.reason === "FEEDBACK_CODE_INVALID" ? "invalid" : "unknown"
    }));
  }

  // The owner's routes: the bearer token's SHA-256 must equal the configured one. A correct token always works; wrong ones are
  // counted and, past the limits, answered 429.
  function ownerAuthorized(req, res) {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9_-]{20,200})$/u.exec(header) : null;
    if (match && timingSafeEqual(sha256Bytes(match[1]), ownerTokenDigest)) return true;
    counts.owner_refusals += 1;
    const allowed = limiter.take("owner_failure", clientKey(req)) && limiter.take("owner_failure_all");
    sendJson(res, allowed ? 401 : 429, { error: "Not authorized.", code: allowed ? "FEEDBACK_OWNER_UNAUTHORIZED" : "FEEDBACK_OWNER_LIMITED" },
      allowed ? { "www-authenticate": "Bearer realm=\"inner-signal-feedback-owner\"" } : { "retry-after": "600" });
    return false;
  }

  async function readOwnerJson(req) {
    if (!isJson(req)) throw new RequestBodyError(415);
    let value;
    try {
      value = JSON.parse((await readBody(req, { maxBytes: OWNER_BODY_MAX })).toString("utf8"));
    } catch (error) {
      if (error instanceof RequestBodyError) throw error;
      throw new RequestBodyError(400);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestBodyError(400);
    return value;
  }

  async function handleOwner(req, res, url, route) {
    if (!ownerAuthorized(req, res)) return;
    if (route === "events") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed.", code: "FEEDBACK_METHOD" }, { allow: "GET" });
      const after = url.searchParams.get("after") ?? "0";
      const confirmed = url.searchParams.get("confirmed") ?? "0";
      const limit = url.searchParams.get("limit") ?? "100";
      if (![after, confirmed].every((value) => /^\d{1,15}$/u.test(value)) || !/^\d{1,3}$/u.test(limit)) {
        return sendJson(res, 400, { error: "Refused.", code: "FEEDBACK_CURSOR_INVALID" });
      }
      const listed = await store.listEvents({ after: Number(after), confirmed: Number(confirmed), limit: Number(limit) });
      return sendJson(res, 200, { ...listed, counts: structuredClone(counts) });
    }
    if (route === "message") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed.", code: "FEEDBACK_METHOD" }, { allow: "GET" });
      const message = await store.getMessage(url.searchParams.get("id") ?? "");
      return message ? sendJson(res, 200, { message }) : sendJson(res, 404, { error: "Not found.", code: "FEEDBACK_NOT_FOUND" });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed.", code: "FEEDBACK_METHOD" }, { allow: "POST" });
    const input = await readOwnerJson(req);
    if (route === "delete") {
      const deleted = await store.deleteById(input.id, "owner");
      if (deleted) note({ event: "feedback_deleted", by: "owner" });
      return sendJson(res, deleted ? 200 : 404, { deleted });
    }
    if (route === "delete-many") {
      const result = await store.deleteMany({ via: input.via, fromDay: input.from_day, toDay: input.to_day });
      note({ event: "feedback_deleted_many", count: result.deleted });
      return sendJson(res, 200, result);
    }
    if (route === "unpublish") return sendJson(res, 200, await store.unpublish(input.id));
    const published = await store.publish({ id: input.id, text: input.text, publishKey: input.publish_key });
    note({ event: "feedback_published" });
    return sendJson(res, 200, published);
  }

  return Object.freeze({
    basePath: FEEDBACK_BASE_PATH,
    owns: ownsFeedbackPath,

    async handle(req, res, url) {
      const sub = url.pathname === FEEDBACK_BASE_PATH ? "" : url.pathname.slice(FEEDBACK_BASE_PATH.length + 1).replace(/\/$/u, "");
      const owner = /^owner\/(events|message|delete|delete-many|publish|unpublish)$/u.exec(sub);
      try {
        if (owner) return await handleOwner(req, res, url, owner[1]);
        const reading = req.method === "GET" || req.method === "HEAD";
        if (sub === "") {
          if (reading) return sendHtml(res, 200, renderFormPage({ token: tokens.issue() }));
          if (req.method === "POST") return await handlePageSend(req, res);
          return sendHtml(res, 405, renderNotFoundPage({}), { allow: "GET, POST" });
        }
        if (sub === "delete") {
          // A code is read only from a POST body, never from the address.
          if (reading) return sendHtml(res, 200, renderDeletePage({}));
          if (req.method === "POST") return await handleDelete(req, res);
          return sendHtml(res, 405, renderNotFoundPage({}), { allow: "GET, POST" });
        }
        if (sub === "reviews") {
          if (reading) return sendHtml(res, 200, renderReviewsPage({ reviews: await store.publishedReviews() }));
          return sendHtml(res, 405, renderNotFoundPage({}), { allow: "GET" });
        }
        return sendHtml(res, 404, renderNotFoundPage({}));
      } catch (error) {
        if (res.headersSent) return res.destroy();
        if (error instanceof RequestBodyError) {
          return owner
            ? sendJson(res, error.status, { error: "The request was refused.", code: "FEEDBACK_REQUEST_REFUSED" }, {}, { close: true })
            : sendHtml(res, error.status, renderNotFoundPage({}), {}, { close: true });
        }
        if (error instanceof FeedbackStoreError) {
          const status = error.code === "FEEDBACK_NOT_FOUND" ? 404 : ["FEEDBACK_NOT_PUBLISHABLE", "FEEDBACK_PUBLISH_MISMATCH"].includes(error.code) ? 409 : 400;
          return owner ? sendJson(res, status, { error: "Refused.", code: error.code }) : sendHtml(res, status, renderNotFoundPage({}));
        }
        note({ event: "feedback_route_error" });
        return owner
          ? sendJson(res, 500, { error: "The feedback service failed.", code: "FEEDBACK_UNAVAILABLE" })
          : sendHtml(res, 500, renderNotFoundPage({}));
      }
    },

    // The chat tool's send: what was stored and its code, or a FeedbackStoreError.
    sendFromChat(value, req) {
      return send(value, { via: "chat", key: clientKey(req) });
    },

    counts() {
      return structuredClone(counts);
    },

    close() {
      if (sweeper) clearInterval(sweeper);
    }
  });
}
