import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { feedbackIdForCode, newDeletionCode, FEEDBACK_ID_PATTERN } from "./codes.mjs";
import { sealForOwner } from "./sealed-box.mjs";
import { readFeedbackInput } from "./validate.mjs";

// The feedback store (design section 4): one sealed file per message under items/, approved reviews under published/, deletions
// (no content) under deleted/. Files are written to tmp/ and linked into place, so a reader never sees half a file and an existing
// name is never overwritten. The store opens nothing: it seals to the owner's public key and keeps the clear record the server
// needs (id, time, page or chat, whether it is a review the sender let be shown, and that review's publish check).

export const FEEDBACK_FORMAT = "inner-signal-feedback-v1";
export const FEEDBACK_STORE_DEFAULTS = Object.freeze({
  maxItems: 5_000,
  maxBytes: 50 * 1024 * 1024,
  retentionDays: 365,
  tombstoneDays: 90
});
const DAY_MS = 24 * 3_600_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)~(fb_[0-9A-HJKMNP-TV-Z]{20})$/u;
const DIRECTORIES = Object.freeze(["items", "published", "deleted", "tmp"]);

export class FeedbackStoreError extends Error {
  constructor(code) {
    super("The feedback store refused the request.");
    this.name = "FeedbackStoreError";
    this.code = code;
  }
}

const secondsTimestamp = (date) => date.toISOString().replace(/\.\d{3}Z$/u, "Z");
const cursorOf = (time, id) => `${time}~${id}`;
const compareByTime = (a, b) => (a.time === b.time ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.time < b.time ? -1 : 1);

function readCursor(value) {
  if (value == null || value === "") return null;
  const match = typeof value === "string" ? CURSOR.exec(value) : null;
  if (!match) throw new FeedbackStoreError("FEEDBACK_CURSOR_INVALID");
  return { time: match[1], id: match[2] };
}

const after = (entry, cursor) => !cursor || compareByTime(entry, cursor) > 0;

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function publishMac(publishKey, text) {
  return createHmac("sha256", publishKey).update(text, "utf8").digest("base64url");
}

export async function openFeedbackStore({
  root,
  ownerPublicKey,
  now = () => new Date(),
  random = randomBytes,
  limits = {}
} = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new TypeError("The feedback store needs an absolute root.");
  if (!ownerPublicKey) throw new TypeError("The feedback store needs the owner's public key.");
  const settings = { ...FEEDBACK_STORE_DEFAULTS, ...limits };
  for (const name of DIRECTORIES) await fs.mkdir(path.join(root, name), { recursive: true, mode: 0o700 });
  const dir = (name) => path.join(root, name);
  const fileFor = (name, id) => path.join(dir(name), `${id}.json`);

  // Every stored message's time and size, kept in memory and rebuilt at open, so the owner's read opens only the files it returns.
  const index = new Map();
  let storedBytes = 0;
  async function rebuildIndex() {
    index.clear();
    storedBytes = 0;
    for (const name of await fs.readdir(dir("items"))) {
      const id = name.replace(/\.json$/u, "");
      if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
      const file = path.join(dir("items"), name);
      const value = await readJsonFile(file);
      if (!value || value.id !== id || !TIMESTAMP.test(value.received_at ?? "")) continue;
      try {
        const size = (await fs.stat(file)).size;
        index.set(id, { receivedAt: value.received_at, size });
        storedBytes += size;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  await rebuildIndex();
  const isFull = () => index.size >= settings.maxItems || storedBytes >= settings.maxBytes;

  // Writes `value` as `<name>/<id>.json`. With `exclusive`, an existing file is never replaced (EEXIST is thrown).
  async function writeRecord(name, id, value, { exclusive }) {
    const body = `${JSON.stringify(value)}\n`;
    const temporary = path.join(dir("tmp"), `${random(12).toString("hex")}.json`);
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (exclusive) await fs.link(temporary, fileFor(name, id));
      else await fs.rename(temporary, fileFor(name, id));
    } finally {
      if (exclusive) await fs.unlink(temporary).catch(() => {});
    }
    return Buffer.byteLength(body);
  }

  async function removeIfPresent(file) {
    try {
      await fs.unlink(file);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function deleteById(id, by) {
    if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id)) return false;
    await removeIfPresent(fileFor("published", id));
    if (!(await removeIfPresent(fileFor("items", id)))) return false;
    const entry = index.get(id);
    if (entry) {
      index.delete(id);
      storedBytes = Math.max(0, storedBytes - entry.size);
    }
    await writeRecord("deleted", id, { format: FEEDBACK_FORMAT, id, deleted_at: secondsTimestamp(now()), by }, { exclusive: false });
    return true;
  }

  return Object.freeze({
    // Seals and keeps one message. Returns its id, deletion code and time; the code is never kept.
    async add(input, { via }) {
      if (!["page", "chat"].includes(via)) throw new TypeError("via must be page or chat.");
      const read = readFeedbackInput(input);
      if (!read.ok) throw new FeedbackStoreError(read.code);
      if (isFull()) throw new FeedbackStoreError("FEEDBACK_FULL");
      const value = read.value;
      const publicReview = value.kind === "review" && value.mayShowPublicly === true;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = newDeletionCode(random);
        const id = feedbackIdForCode(code);
        const receivedAt = secondsTimestamp(now());
        const publishKey = publicReview ? random(32) : null;
        const record = {
          format: FEEDBACK_FORMAT,
          id,
          received_at: receivedAt,
          via,
          public_review: publicReview,
          ...(publicReview ? { publish_mac: publishMac(publishKey, value.text) } : {})
        };
        const sealed = sealForOwner({
          ownerPublicKey,
          id,
          record,
          random,
          plaintext: {
            kind: value.kind,
            text: value.text,
            reply_address: value.replyAddress,
            may_show_publicly: value.mayShowPublicly,
            received_at: receivedAt,
            via,
            ...(publicReview ? { publish_key: publishKey.toString("base64url") } : {})
          }
        });
        publishKey?.fill(0);
        try {
          const bytes = await writeRecord("items", id, { ...record, sealed }, { exclusive: true });
          index.set(id, { receivedAt, size: bytes });
          storedBytes += bytes;
          return Object.freeze({ id, code, receivedAt });
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
      }
      throw new FeedbackStoreError("FEEDBACK_UNAVAILABLE");
    },

    async deleteByCode(code, by = "sender") {
      const id = feedbackIdForCode(code);
      if (!id) return { deleted: false, reason: "FEEDBACK_CODE_INVALID" };
      return (await deleteById(id, by)) ? { deleted: true, id } : { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" };
    },

    deleteById,

    // The owner's read: sealed messages and deletions after the cursors, oldest first, at most `limit` of each.
    async listForOwner({ itemsAfter = null, deletedAfter = null, limit = 100 } = {}) {
      const itemsCursor = readCursor(itemsAfter);
      const deletedCursor = readCursor(deletedAfter);
      const size = Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 100;
      const items = [];
      for (const [id, entry] of index) {
        if (after({ time: entry.receivedAt, id }, itemsCursor)) items.push({ time: entry.receivedAt, id });
      }
      items.sort(compareByTime);
      const deleted = [];
      for (const name of await fs.readdir(dir("deleted"))) {
        const id = name.replace(/\.json$/u, "");
        if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
        const value = await readJsonFile(path.join(dir("deleted"), name));
        if (!value || value.id !== id || !TIMESTAMP.test(value.deleted_at ?? "")) continue;
        if (after({ time: value.deleted_at, id }, deletedCursor)) deleted.push({ time: value.deleted_at, id, value });
      }
      deleted.sort(compareByTime);
      const pageItems = [];
      for (const entry of items) {
        if (pageItems.length >= size) break;
        const value = await readJsonFile(fileFor("items", entry.id));
        if (value && value.id === entry.id) pageItems.push({ ...entry, value });
      }
      const pageDeleted = deleted.slice(0, size);
      const published = new Set((await fs.readdir(dir("published"))).map((name) => name.replace(/\.json$/u, "")));
      return {
        items: pageItems.map(({ value }) => ({
          id: value.id,
          received_at: value.received_at,
          via: value.via,
          public_review: value.public_review === true,
          published: published.has(value.id),
          ...(value.publish_mac ? { publish_mac: value.publish_mac } : {}),
          format: value.format,
          sealed: value.sealed
        })),
        deleted: pageDeleted.map(({ value }) => ({ id: value.id, deleted_at: value.deleted_at, by: value.by })),
        next: {
          items_after: pageItems.length ? cursorOf(pageItems.at(-1).time, pageItems.at(-1).id) : itemsAfter ?? null,
          deleted_after: pageDeleted.length ? cursorOf(pageDeleted.at(-1).time, pageDeleted.at(-1).id) : deletedAfter ?? null
        },
        more: items.length > size || deleted.length > size,
        stored: index.size,
        full: isFull()
      };
    },

    // Shows a review publicly: only one the sender let be shown, and only its exact words (the publish check of design section 8).
    async publish({ id, text, publishKey }) {
      if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id)) throw new FeedbackStoreError("FEEDBACK_NOT_FOUND");
      const value = await readJsonFile(fileFor("items", id));
      if (!value) throw new FeedbackStoreError("FEEDBACK_NOT_FOUND");
      if (value.public_review !== true || typeof value.publish_mac !== "string") throw new FeedbackStoreError("FEEDBACK_NOT_PUBLISHABLE");
      if (typeof text !== "string" || typeof publishKey !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(publishKey)) {
        throw new FeedbackStoreError("FEEDBACK_PUBLISH_MISMATCH");
      }
      const expected = Buffer.from(value.publish_mac, "utf8");
      const actual = Buffer.from(publishMac(Buffer.from(publishKey, "base64url"), text), "utf8");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new FeedbackStoreError("FEEDBACK_PUBLISH_MISMATCH");
      await writeRecord("published", id, {
        format: FEEDBACK_FORMAT,
        id,
        text,
        month: value.received_at.slice(0, 7),
        published_at: secondsTimestamp(now())
      }, { exclusive: false });
      return { published: true, id };
    },

    async unpublish(id) {
      if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id)) return { unpublished: false };
      return { unpublished: await removeIfPresent(fileFor("published", id)) };
    },

    // Published reviews, newest first: their text and month only.
    async publishedReviews() {
      const reviews = [];
      for (const name of await fs.readdir(dir("published"))) {
        const id = name.replace(/\.json$/u, "");
        if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
        const value = await readJsonFile(path.join(dir("published"), name));
        if (value?.id === id && typeof value.text === "string" && /^\d{4}-\d{2}$/u.test(value.month ?? "")) {
          reviews.push({ id, text: value.text, month: value.month, published_at: value.published_at ?? "" });
        }
      }
      return reviews.sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0))
        .map(({ text, month }) => ({ text, month }));
    },

    // Deletes messages past their keeping time, deletion records past theirs, and temporary files an interrupted write left.
    async sweep() {
      const at = now().getTime();
      let expired = 0;
      for (const [id, entry] of [...index]) {
        const received = Date.parse(entry.receivedAt);
        if (Number.isFinite(received) && at - received >= settings.retentionDays * DAY_MS && (await deleteById(id, "expiry"))) expired += 1;
      }
      for (const name of await fs.readdir(dir("deleted"))) {
        const value = await readJsonFile(path.join(dir("deleted"), name));
        const deletedAt = Date.parse(value?.deleted_at ?? "");
        if (Number.isFinite(deletedAt) && at - deletedAt >= settings.tombstoneDays * DAY_MS) await removeIfPresent(path.join(dir("deleted"), name));
      }
      for (const name of await fs.readdir(dir("tmp"))) {
        const file = path.join(dir("tmp"), name);
        try {
          if (at - (await fs.stat(file)).mtimeMs >= 3_600_000) await removeIfPresent(file);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return { expired };
    },

    stats() {
      return { stored: index.size, bytes: storedBytes, full: isFull() };
    }
  });
}
