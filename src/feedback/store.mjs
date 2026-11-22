import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { feedbackIdForCode, newDeletionCode, FEEDBACK_ID_PATTERN } from "./codes.mjs";
import { keyIdFor, sealForOwner } from "./sealed-box.mjs";
import { readFeedbackInput } from "./validate.mjs";

// The feedback store (design section 4): one sealed file per message under items/, approved reviews under published/, deletion
// records (no content) under deleted/, and counter.json with the next arrival number. Files are written to tmp/ and linked or
// renamed into place, so a reader never sees half a file and a message's name is never overwritten. The store opens nothing: it
// seals to the owner's public key and keeps in clear only what the server needs: the id, the arrival number, the day, which door
// (page or chat), which key sealed it, a chat message's hold, and for a page review the sender let be shown, its publish check.
// Every change goes through one queue, so arrival numbers are strictly increasing and the counts stay right.

export const FEEDBACK_FORMAT = "inner-signal-feedback-v1";
export const FEEDBACK_DOORS = Object.freeze(["page", "chat"]);
export const FEEDBACK_STORE_DEFAULTS = Object.freeze({
  maxItems: 5_000,
  maxBytes: 50 * 1024 * 1024,
  doorShares: Object.freeze({ page: 3_500, chat: 1_500 }),
  doorByteShares: Object.freeze({ page: 35 * 1024 * 1024, chat: 15 * 1024 * 1024 }),
  retentionDays: 365,
  deletionRecordMaxDays: 400,
  chatHoldMs: 3_600_000
});
const DAY_MS = 24 * 3_600_000;
// The smallest stored message (a record with the first 512-byte step of sealed text): a door with less room than this is full.
const MIN_MESSAGE_BYTES = 1_024;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/u;
const DIRECTORIES = Object.freeze(["items", "published", "deleted", "tmp"]);

export class FeedbackStoreError extends Error {
  constructor(code) {
    super("The feedback store refused the request.");
    this.name = "FeedbackStoreError";
    this.code = code;
  }
}

const secondsTimestamp = (date) => date.toISOString().replace(/\.\d{3}Z$/u, "Z");
const dayOf = (date) => date.toISOString().slice(0, 10);
const dayStart = (day) => new Date(`${day}T00:00:00Z`);
// The full hour after one hour from arrival: the owner's read returns a chat message only from then on.
const holdUntil = (date, holdMs) => {
  const later = new Date(date.getTime() + holdMs);
  const hour = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate(), later.getUTCHours()));
  if (hour.getTime() < later.getTime()) hour.setUTCHours(hour.getUTCHours() + 1);
  return hour.toISOString().replace(/\.\d{3}Z$/u, "Z");
};

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
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
  const settings = {
    ...FEEDBACK_STORE_DEFAULTS,
    ...limits,
    doorShares: { ...FEEDBACK_STORE_DEFAULTS.doorShares, ...(limits.doorShares ?? {}) },
    doorByteShares: { ...FEEDBACK_STORE_DEFAULTS.doorByteShares, ...(limits.doorByteShares ?? {}) }
  };
  const keyId = keyIdFor(ownerPublicKey);
  for (const name of DIRECTORIES) await fs.mkdir(path.join(root, name), { recursive: true, mode: 0o700 });
  const dir = (name) => path.join(root, name);
  const fileFor = (name, id) => path.join(dir(name), `${id}.json`);
  const counterFile = path.join(root, "counter.json");

  // Every change runs after the one before it.
  let queue = Promise.resolve();
  const exclusive = (task) => {
    const run = queue.then(task, task);
    queue = run.then(() => {}, () => {});
    return run;
  };

  async function writeAtomically(target, value, { exclusive: noOverwrite = false } = {}) {
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
      if (noOverwrite) await fs.link(temporary, target);
      else await fs.rename(temporary, target);
    } finally {
      if (noOverwrite) await fs.unlink(temporary).catch(() => {});
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

  // A deletion whose record is written is finished here: the message always, the public copy unless the message only expired.
  // True when nothing of it is left; a file that can't be removed keeps its record, so the deletion is tried again.
  async function finishDeletion(id, by) {
    let done = true;
    for (const file of [fileFor("items", id), ...(by === "expiry" ? [] : [fileFor("published", id)])]) {
      try {
        await fs.unlink(file);
      } catch (error) {
        if (error?.code !== "ENOENT") done = false;
      }
    }
    return done;
  }

  async function readDeletionRecords() {
    const records = new Map();
    for (const name of await fs.readdir(dir("deleted"))) {
      const id = name.replace(/\.json$/u, "");
      if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
      const value = await readJsonFile(path.join(dir("deleted"), name));
      if (value?.id === id && Number.isSafeInteger(value.seq)) records.set(id, value);
    }
    return records;
  }

  // What is stored, read from the disk at open and before every owner's read (so a read also sees what another process wrote):
  // each message's arrival number, day, door, hold and size. A message with a deletion record is never indexed; its deletion is
  // finished instead (a crash or a failed removal part-way).
  const index = new Map();
  let storedBytes = 0;
  async function rebuildIndex() {
    const records = await readDeletionRecords();
    const fresh = new Map();
    let bytes = 0;
    let highest = 0;
    for (const value of records.values()) highest = Math.max(highest, value.seq);
    for (const name of await fs.readdir(dir("items"))) {
      const id = name.replace(/\.json$/u, "");
      if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
      if (records.has(id)) {
        await finishDeletion(id, records.get(id).by);
        continue;
      }
      const file = path.join(dir("items"), name);
      const value = await readJsonFile(file);
      if (!value || value.id !== id || !Number.isSafeInteger(value.seq) || !DAY.test(value.received_day ?? "") || !FEEDBACK_DOORS.includes(value.via)) continue;
      let size;
      try {
        size = (await fs.stat(file)).size;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      fresh.set(id, { seq: value.seq, day: value.received_day, via: value.via, heldUntil: HOUR.test(value.held_until ?? "") ? value.held_until : null, size });
      bytes += size;
      highest = Math.max(highest, value.seq);
    }
    index.clear();
    for (const [id, entry] of fresh) index.set(id, entry);
    storedBytes = bytes;
    return { records, highest };
  }
  const opened = await rebuildIndex();
  const counter = await readJsonFile(counterFile);
  let nextSeq = Math.max(Number.isSafeInteger(counter?.next) ? counter.next : 1, opened.highest + 1);

  // The next arrival number, saved before it is used, so a number is never given twice, also by two processes sharing the store
  // (one process is the expected setup): the counter is read and written under a lock file, which a holder that died leaves
  // stale after 10 seconds.
  const counterLock = path.join(root, "counter.lock");
  async function takeSeq() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await (await fs.open(counterLock, "wx", 0o600)).close();
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const info = await fs.stat(counterLock).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 10_000) {
          await fs.unlink(counterLock).catch(() => {});
          continue;
        }
        if (attempt >= 200) throw new FeedbackStoreError("FEEDBACK_UNAVAILABLE");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      const saved = await readJsonFile(counterFile);
      const seq = Math.max(nextSeq, Number.isSafeInteger(saved?.next) ? saved.next : 1);
      await writeAtomically(counterFile, { next: seq + 1 });
      nextSeq = seq + 1;
      return seq;
    } finally {
      await fs.unlink(counterLock).catch(() => {});
    }
  }

  const doorCount = (via) => {
    let count = 0;
    for (const entry of index.values()) if (entry.via === via) count += 1;
    return count;
  };
  const doorBytes = (via) => {
    let bytes = 0;
    for (const entry of index.values()) if (entry.via === via) bytes += entry.size;
    return bytes;
  };
  // A door is full when its own count or its own share of the bytes is used up (so one door can't fill the other's room), or
  // when the store as a whole is. `adding` is the size of a message about to be written.
  const doorFull = (via, adding = 0) => doorCount(via) >= settings.doorShares[via] || doorBytes(via) + adding > settings.doorByteShares[via]
    || index.size >= settings.maxItems || storedBytes + adding > settings.maxBytes;

  async function writeDeletionRecord(id, by) {
    const seq = await takeSeq();
    await writeAtomically(fileFor("deleted", id), { format: FEEDBACK_FORMAT, id, seq, day: dayOf(now()), by });
  }

  function forget(id) {
    const entry = index.get(id);
    if (entry) {
      index.delete(id);
      storedBytes = Math.max(0, storedBytes - entry.size);
    }
  }

  // Removes a message (and, unless it only expired, its public copy). The deletion record is written first and the message leaves
  // the index at once, so a crash or a failed removal part-way leaves a record that finishes the deletion later (at the next open
  // or owner's read), never a deleted message without the record that removes the owner's Inbox copy. A public copy whose message
  // already expired is removed too (its record went out then).
  async function deleteNow(id, by) {
    if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id)) return false;
    const hasItem = index.has(id);
    if (hasItem) {
      await writeDeletionRecord(id, by);
      forget(id);
      await finishDeletion(id, by);
      return true;
    }
    if (by === "expiry") return false;
    try {
      await fs.unlink(fileFor("published", id));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  return Object.freeze({
    keyId,

    // Seals and keeps one message. Returns its id, deletion code, arrival time and number, its hold (chat), and what was stored.
    add(input, { via }) {
      return exclusive(async () => {
        if (!FEEDBACK_DOORS.includes(via)) throw new TypeError("via must be page or chat.");
        const read = readFeedbackInput(input);
        if (!read.ok) throw new FeedbackStoreError(read.code);
        const value = read.value;
        if (via === "chat" && value.mayShowPublicly) throw new FeedbackStoreError("FEEDBACK_PUBLIC_ONLY_ON_PAGE");
        if (doorFull(via, MIN_MESSAGE_BYTES)) throw new FeedbackStoreError("FEEDBACK_FULL");
        const publicReview = value.kind === "review" && value.mayShowPublicly === true;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const code = newDeletionCode(random);
          const id = feedbackIdForCode(code);
          if (index.has(id)) continue;
          const arrived = now();
          const seq = await takeSeq();
          const receivedDay = dayOf(arrived);
          const heldUntil = via === "chat" ? holdUntil(arrived, settings.chatHoldMs) : null;
          const publishKey = publicReview ? random(32) : null;
          const record = {
            format: FEEDBACK_FORMAT,
            id,
            seq,
            received_day: receivedDay,
            via,
            key_id: keyId,
            public_review: publicReview,
            ...(heldUntil ? { held_until: heldUntil } : {}),
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
              received_at: secondsTimestamp(arrived),
              via,
              ...(publicReview ? { publish_key: publishKey.toString("base64url") } : {})
            }
          });
          publishKey?.fill(0);
          const prospective = Buffer.byteLength(`${JSON.stringify({ ...record, sealed })}\n`);
          if (doorFull(via, prospective)) throw new FeedbackStoreError("FEEDBACK_FULL");
          let bytes;
          try {
            bytes = await writeAtomically(fileFor("items", id), { ...record, sealed }, { exclusive: true });
          } catch (error) {
            if (error?.code === "EEXIST") continue;
            throw error;
          }
          const start = dayStart(receivedDay);
          await fs.utimes(fileFor("items", id), start, start).catch(() => {});
          index.set(id, { seq, day: receivedDay, via, heldUntil, size: bytes });
          storedBytes += bytes;
          return Object.freeze({
            id,
            code,
            seq,
            receivedAt: secondsTimestamp(arrived),
            heldUntil,
            stored: Object.freeze({ kind: value.kind, text: value.text, replyAddress: value.replyAddress, mayShowPublicly: value.mayShowPublicly })
          });
        }
        throw new FeedbackStoreError("FEEDBACK_UNAVAILABLE");
      });
    },

    deleteByCode(code, by = "sender") {
      const id = feedbackIdForCode(code);
      if (!id) return Promise.resolve({ deleted: false, reason: "FEEDBACK_CODE_INVALID" });
      return exclusive(async () => ((await deleteNow(id, by)) ? { deleted: true, id } : { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" }));
    },

    deleteById(id, by = "owner") {
      return exclusive(() => deleteNow(id, by));
    },

    // The owner's bulk delete, for a flood: every message from one door received on the days from..to (UTC dates).
    deleteMany({ via, fromDay, toDay }) {
      return exclusive(async () => {
        if (!FEEDBACK_DOORS.includes(via) || !DAY.test(fromDay ?? "") || !DAY.test(toDay ?? "") || fromDay > toDay) {
          throw new FeedbackStoreError("FEEDBACK_RANGE_INVALID");
        }
        let deleted = 0;
        for (const [id, entry] of [...index]) {
          if (entry.via === via && entry.day >= fromDay && entry.day <= toDay && (await deleteNow(id, "owner"))) deleted += 1;
        }
        return { deleted };
      });
    },

    // The owner's read: messages (sealed) and deletion records with an arrival number above `after`, in order, at most `limit`,
    // stopping before the first chat message still held. `confirmed` is the arrival number up to which his Inbox has taken in
    // everything (his last confirmed read): deletion records up to it are removed, and never any later one.
    listEvents({ after = 0, confirmed = 0, limit = 100 } = {}) {
      return exclusive(async () => {
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > after) {
          throw new FeedbackStoreError("FEEDBACK_CURSOR_INVALID");
        }
        const size = Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 100;
        const at = now();
        const { records } = await rebuildIndex();
        const deletions = [];
        for (const value of records.values()) {
          // A confirmed record goes only once nothing of its message is left; otherwise it stays to finish the deletion.
          if (value.seq <= confirmed) {
            if (await finishDeletion(value.id, value.by)) await removeIfPresent(fileFor("deleted", value.id));
          } else if (value.seq > after) {
            deletions.push({ seq: value.seq, kind: "deleted", value });
          }
        }
        const items = [...index].filter(([, entry]) => entry.seq > after).map(([id, entry]) => ({ seq: entry.seq, kind: "item", id, entry }));
        const events = [...items, ...deletions].sort((a, b) => a.seq - b.seq);
        const isHeld = (event) => event.kind === "item" && event.entry.heldUntil !== null && Date.parse(event.entry.heldUntil) > at.getTime();
        const out = [];
        let next = after;
        let stoppedForSize = false;
        for (const event of events) {
          if (out.length >= size) {
            stoppedForSize = true;
            break;
          }
          if (isHeld(event)) break;
          if (event.kind === "item") {
            const value = await readJsonFile(fileFor("items", event.id));
            if (!value) continue;
            out.push({
              type: "message",
              seq: value.seq,
              id: value.id,
              received_day: value.received_day,
              via: value.via,
              key_id: value.key_id,
              public_review: value.public_review === true,
              ...(value.held_until ? { held_until: value.held_until } : {}),
              ...(value.publish_mac ? { publish_mac: value.publish_mac } : {}),
              format: value.format,
              sealed: value.sealed
            });
          } else {
            out.push({ type: "deleted", seq: event.value.seq, id: event.value.id, day: event.value.day, by: event.value.by });
          }
          next = event.seq;
        }
        return {
          events: out,
          next_after: next,
          more: stoppedForSize,
          held: events.filter(isHeld).length,
          stored: { page: doorCount("page"), chat: doorCount("chat") },
          full: { page: doorFull("page", MIN_MESSAGE_BYTES), chat: doorFull("chat", MIN_MESSAGE_BYTES) }
        };
      });
    },

    // One stored message, sealed, by id (for publishing and for retrying one the owner's laptop couldn't open), or null; confirms
    // nothing, and keeps a chat message's hold like the owner's read does.
    async getMessage(id) {
      if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id) || !index.has(id)) return null;
      const held = index.get(id).heldUntil;
      if (held && Date.parse(held) > now().getTime()) return null;
      const value = await readJsonFile(fileFor("items", id));
      return value?.id === id ? value : null;
    },

    // Shows a review publicly: only a page review the sender let be shown, and only its exact words (design section 8).
    publish({ id, text, publishKey }) {
      return exclusive(async () => {
        if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id) || !index.has(id)) throw new FeedbackStoreError("FEEDBACK_NOT_FOUND");
        const value = await readJsonFile(fileFor("items", id));
        if (!value) throw new FeedbackStoreError("FEEDBACK_NOT_FOUND");
        if (value.public_review !== true || typeof value.publish_mac !== "string") throw new FeedbackStoreError("FEEDBACK_NOT_PUBLISHABLE");
        if (typeof text !== "string" || typeof publishKey !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(publishKey)) {
          throw new FeedbackStoreError("FEEDBACK_PUBLISH_MISMATCH");
        }
        const expected = Buffer.from(value.publish_mac, "utf8");
        const actual = Buffer.from(publishMac(Buffer.from(publishKey, "base64url"), text), "utf8");
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new FeedbackStoreError("FEEDBACK_PUBLISH_MISMATCH");
        await writeAtomically(fileFor("published", id), {
          format: FEEDBACK_FORMAT,
          id,
          text,
          month: value.received_day.slice(0, 7),
          published_at: secondsTimestamp(now())
        });
        return { published: true, id };
      });
    },

    unpublish(id) {
      return exclusive(async () => {
        if (typeof id !== "string" || !FEEDBACK_ID_PATTERN.test(id)) return { unpublished: false };
        return { unpublished: await removeIfPresent(fileFor("published", id)) };
      });
    },

    // Published reviews, newest first: their text and month only.
    async publishedReviews() {
      const reviews = [];
      for (const name of await fs.readdir(dir("published"))) {
        const id = name.replace(/\.json$/u, "");
        if (!name.endsWith(".json") || !FEEDBACK_ID_PATTERN.test(id)) continue;
        const value = await readJsonFile(path.join(dir("published"), name));
        if (value?.id === id && typeof value.text === "string" && /^\d{4}-\d{2}$/u.test(value.month ?? "")) {
          reviews.push({ text: value.text, month: value.month, publishedAt: String(value.published_at ?? "") });
        }
      }
      return reviews.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(({ text, month }) => ({ text, month }));
    },

    // Deletes messages past their keeping time (a public copy stays), deletion records past theirs, and temporary files an
    // interrupted write left.
    sweep() {
      return exclusive(async () => {
        const at = now().getTime();
        let expired = 0;
        for (const [id, entry] of [...index]) {
          // The public copy of a review stays (design section 4).
          if (at - dayStart(entry.day).getTime() >= settings.retentionDays * DAY_MS && (await deleteNow(id, "expiry"))) expired += 1;
        }
        for (const name of await fs.readdir(dir("deleted"))) {
          const file = path.join(dir("deleted"), name);
          const value = await readJsonFile(file);
          if (DAY.test(value?.day ?? "") && at - dayStart(value.day).getTime() >= settings.deletionRecordMaxDays * DAY_MS
              && (await finishDeletion(value.id, value.by))) await removeIfPresent(file);
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
      });
    },

    stats() {
      return {
        stored: { page: doorCount("page"), chat: doorCount("chat") },
        bytes: storedBytes,
        doorBytes: { page: doorBytes("page"), chat: doorBytes("chat") },
        full: { page: doorFull("page", MIN_MESSAGE_BYTES), chat: doorFull("chat", MIN_MESSAGE_BYTES) }
      };
    }
  });
}
