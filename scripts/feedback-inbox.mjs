#!/usr/bin/env node
// The owner's side of InnerSignal's feedback place (design section 7). Runs on the owner's laptop only: it holds his private keys
// and his read token, reads sealed messages from the server, opens them here, and writes them as an ArtifactData batch for his
// InnerSignal Inbox. It prints counts and ids only, never a word of a message, so a session that runs it never reads the texts.
//
//   keygen [--server URL]                 make the key and the token (never overwrites; again adds a key); print the two settings
//   fetch --out DIR                       read new messages and deletions; write DIR/plan.json and DIR/docs/; print counts
//   fetch --confirm DIR                   after the batch was sent: move the cursor on and delete DIR
//   fetch --discard DIR                   an earlier batch that wasn't sent (or not fully): delete DIR; the next fetch reads it again
//   delete ID --export DIR --confirm ID   delete one message; needs his "Delete" choice for it in the Inbox export
//   delete-many --via chat|page --from DAY --to DAY --confirm "VIA FROM TO"   bulk delete, for a flood
//   publish ID --export DIR --confirm ID  show a review publicly; needs his "Show publicly" choice for it in the Inbox export
//   unpublish ID --export DIR --confirm ID  take a public review down (and write the Inbox update)
//   status                                the server address, key ids and cursor (no secrets)
//
// The danger reader (the owner's 5b): fetch has an AI with no tools read each newly opened message only to flag possible danger
// (src/feedback/danger-reader.mjs); the Inbox shows flagged messages first, and fetch prints how many. --danger-check off skips it;
// --danger-model, --claude-config-dir and --claude-bin choose the model, the Claude sign-in folder and the claude command.
//
// Options: --config-dir DIR (default ~/.config/innersignal-feedback). Files there: owner-keys.json and owner-token (0600),
// config.json (the server address), state.json (the cursor). Keep a second copy of the first two somewhere only you can open.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_ID_PATTERN } from "../src/feedback/codes.mjs";
import { generateOwnerKeyPair, openSealedForOwner, readOwnerPrivateKey } from "../src/feedback/open-sealed.mjs";
import { keyIdFor, readOwnerPublicKey } from "../src/feedback/sealed-box.mjs";
import { DANGER_READER_DEFAULT_MODEL, DANGER_READER_VERSION, createDangerReader } from "../src/feedback/danger-reader.mjs";

const BATCH = 50;
const MAX_EVENTS_PER_FETCH = 1_000;
// With the danger reader on, each opened message takes one model call: at most this many calls per fetch (retries included); the
// rest wait for the next one.
const MAX_EVENTS_PER_CHECKED_FETCH = 50;
// After this many checks in a row fail (a lapsed sign-in, a plan limit), the rest of the fetch is marked "not checked" at once.
const MAX_FAILED_CHECKS_IN_A_ROW = 3;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
// The server deletes a message after this many days; the Inbox copy goes after the same time, even if no deletion record arrives.
const RETENTION_DAYS = 365;

export class FeedbackInboxError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedbackInboxError";
  }
}

const fail = (message) => { throw new FeedbackInboxError(message); };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--")) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else {
      options._.push(arg);
    }
  }
  return { command, options };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writePrivate(file, text, { exclusive = false } = {}) {
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, text, { mode: 0o600, flag: "wx" });
  try {
    if (exclusive) await fs.link(temporary, file);
    else await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function configPaths(configDir) {
  return {
    dir: configDir,
    keys: path.join(configDir, "owner-keys.json"),
    token: path.join(configDir, "owner-token"),
    config: path.join(configDir, "config.json"),
    state: path.join(configDir, "state.json")
  };
}

async function ensureConfigDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

// One command at a time changes the state and the folders. On Linux (the owner's laptop) the lock is an abstract Unix socket held
// by the running command: the kernel lets only one process hold the name and frees it when that process ends, so there is no stale
// lock to judge and no take-over to race. Elsewhere it is a lock file created exclusively, which a crash leaves for the owner to
// remove by hand (the message says where).
async function withLock(paths, task) {
  await ensureConfigDir(paths.dir);
  const busy = () => fail("Another feedback-inbox command is running; run this one when it has ended.");
  if (process.platform === "linux") {
    const name = `\0innersignal-feedback-${createHash("sha256").update(path.resolve(paths.dir)).digest("hex").slice(0, 32)}`;
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ path: name, exclusive: true }, resolve);
      });
    } catch (error) {
      if (error?.code === "EADDRINUSE") busy();
      throw error;
    }
    server.unref();
    try {
      return await task();
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }
  const lock = path.join(paths.dir, "lock");
  try {
    await (await fs.open(lock, "wx", 0o600)).close();
  } catch (error) {
    if (error?.code === "EEXIST") fail(`Another feedback-inbox command is running, or one stopped without finishing: if none is running, remove ${lock}.`);
    throw error;
  }
  try {
    return await task();
  } finally {
    await fs.unlink(lock).catch(() => {});
  }
}

async function loadKeys(paths) {
  const value = await readJson(paths.keys);
  if (!value || !Array.isArray(value.keys) || value.keys.length === 0) fail(`No owner keys in ${paths.keys}: run keygen first.`);
  const keys = new Map();
  for (const entry of value.keys) keys.set(entry.key_id, readOwnerPrivateKey({ privateKey: entry.private_key, publicKey: entry.public_key }));
  return keys;
}

async function loadToken(paths) {
  const token = (await fs.readFile(paths.token, "utf8").catch(() => "")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) fail(`No owner token in ${paths.token}: run keygen first.`);
  return token;
}

async function serverUrl(paths, options) {
  const fromConfig = (await readJson(paths.config, {}))?.server;
  const value = options.server ?? fromConfig;
  if (typeof value !== "string") fail("No server address: pass --server https://…/feedback once (keygen saves it).");
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    fail("The server address must use https.");
  }
  return url.toString().replace(/\/$/u, "");
}

async function ownerRequest(base, token, route, { method = "GET", body = undefined, query = "" } = {}) {
  const response = await fetch(`${base}/owner/${route}${query}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) fail(`The server refused ${route}: HTTP ${response.status}${payload?.code ? ` ${payload.code}` : ""}.`);
  return payload;
}

// --- keygen -----------------------------------------------------------------------------------------------------------------
async function keygen(paths, options) {
  await ensureConfigDir(paths.dir);
  const existing = await readJson(paths.keys);
  const pair = generateOwnerKeyPair();
  const keyId = keyIdFor(readOwnerPublicKey(pair.publicKey));
  const keys = { format: "inner-signal-feedback-owner-keys-v1", keys: [...(existing?.keys ?? []), {
    key_id: keyId, public_key: pair.publicKey, private_key: pair.privateKey, created_at: new Date().toISOString()
  }] };
  await writePrivate(paths.keys, `${JSON.stringify(keys, null, 2)}\n`);
  let token = (await fs.readFile(paths.token, "utf8").catch(() => "")).trim();
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await writePrivate(paths.token, `${token}\n`, { exclusive: true });
  }
  if (options.server) await writePrivate(paths.config, `${JSON.stringify({ server: await serverUrl(paths, options) })}\n`);
  return [
    `Key ${keyId} added (${keys.keys.length} key(s) in ${paths.keys}). Keep a second copy of ${paths.keys} and ${paths.token}.`,
    "Server settings:",
    `INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY=${pair.publicKey}`,
    `INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256=${createHash("sha256").update(token, "utf8").digest("hex")}`
  ].join("\n");
}

// --- fetch ------------------------------------------------------------------------------------------------------------------
// danger: "flagged" (the reader thinks the writer or someone they mention may be in danger: read first), "refused" (the model
// declined to read it, which can mean it describes something serious: read first too), "not_flagged", or "not_checked" (the
// reader was off or failed: read these next). danger_check names the reader's version that set it.
function inboxDoc(event, opened, danger) {
  return {
    id: event.id,
    danger,
    ...(danger === "not_checked" ? {} : { danger_check: DANGER_READER_VERSION }),
    kind: opened.kind,
    text: opened.text,
    reply_address: opened.reply_address ?? null,
    received_at: opened.received_at,
    via: event.via,
    public_review: event.public_review === true,
    published: false,
    updatedAt: new Date().toISOString()
  };
}

// The clear record a message was sealed with, rebuilt from what the server returns.
function recordOf(event) {
  return {
    format: event.format, id: event.id, seq: event.seq, received_day: event.received_day, via: event.via, key_id: event.key_id,
    public_review: event.public_review,
    ...(event.held_until ? { held_until: event.held_until } : {}),
    ...(event.publish_mac ? { publish_mac: event.publish_mac } : {})
  };
}

// Opens one message, or returns null when no key opens it or its sealed part disagrees with its clear record.
function openMessage(keys, event) {
  const key = keys.get(event.key_id);
  if (!key) return null;
  try {
    const opened = openSealedForOwner({ ownerPrivateKey: key, id: event.id, record: recordOf(event), sealed: event.sealed });
    return opened.via === event.via && String(opened.received_at ?? "").slice(0, 10) === event.received_day ? opened : null;
  } catch {
    return null;
  }
}

async function fetchEvents(paths, options, now, reader, maxChecked = MAX_EVENTS_PER_CHECKED_FETCH) {
  const out = options.out;
  if (typeof out !== "string" || !path.isAbsolute(out)) fail("fetch needs --out with an absolute path to a new, empty folder.");
  const state = (await readJson(paths.state, {})) ?? {};
  const save = () => writePrivate(paths.state, `${JSON.stringify(state)}\n`);
  // A finished batch not yet confirmed belongs to the turn that made it (it may be sending it now): it is confirmed or discarded
  // explicitly, never removed by another fetch.
  if (state.pending?.complete) {
    fail(`An earlier batch is waiting in ${state.pending.folder}: if its batches were sent, run fetch --confirm ${state.pending.folder}; if not, run fetch --discard ${state.pending.folder}.`);
  }
  // A folder an interrupted fetch left (never finished): it goes, and the same messages are read again.
  if (state.pending?.folder) {
    await fs.rm(state.pending.folder, { recursive: true, force: true });
    state.pending = null;
    await save();
  }
  await fs.mkdir(out, { mode: 0o700 }).catch((error) => {
    if (error?.code === "EEXIST") fail(`${out} already exists: give a new, empty folder.`);
    throw error;
  });
  // The folder is on record before any opened message is written into it, so a failure anywhere below can't leave words behind.
  state.pending = { folder: out, complete: false, at: new Date().toISOString() };
  await save();
  try {
    const base = await serverUrl(paths, options);
    const token = await loadToken(paths);
    const keys = await loadKeys(paths);
    const after = Number.isSafeInteger(state.after) ? state.after : 0;
    const entries = [];
    const counts = { new: 0, by_kind: {}, reviews_waiting: 0, flagged: 0, refused: 0, not_checked: 0, check_failures: {}, deleted: 0, expired_here: 0, unreadable: 0, held: 0, full: {}, stored: {} };
    // Events read per fetch; model calls have their own budget (maxChecked), so a lost key can't hold up new messages.
    const maxEvents = MAX_EVENTS_PER_FETCH;
    const unreadable = [];
    // Which messages the Inbox may hold, by id and day only (no words), so their Inbox copies go after a year even if a deletion record
    // never arrives. A fetch only proposes: its additions and its removals are kept apart, a discard keeps every addition (any of them
    // may have reached the Inbox), and only a confirmation applies the removals.
    const known = { ...(state.imported && typeof state.imported === "object" ? state.imported : {}) };
    const additions = {};
    const removals = new Set();
    let failedInARow = 0;
    // The budget counts model calls only: an unreadable message or a deletion costs nothing, and once the calls reach the budget
    // the fetch stops just before the next message that would need one (it waits, with its place in the cursor, for the next fetch).
    let calls = 0;
    const needsCall = () => Boolean(reader) && failedInARow < MAX_FAILED_CHECKS_IN_A_ROW;
    const budgetSpent = () => needsCall() && calls >= maxChecked;
    const dangerOf = async (text) => {
      if (!reader) return "not_checked";
      if (failedInARow >= MAX_FAILED_CHECKS_IN_A_ROW) {
        counts.not_checked += 1;
        return "not_checked";
      }
      calls += 1;
      const verdict = await reader.check(text);
      if (verdict.reason === "REFUSED") {
        failedInARow = 0;
        counts.refused += 1;
        return "refused";
      }
      if (verdict.flag === null) {
        failedInARow += 1;
        counts.not_checked += 1;
        counts.check_failures[verdict.reason] = (counts.check_failures[verdict.reason] ?? 0) + 1;
        return "not_checked";
      }
      failedInARow = 0;
      if (verdict.flag) counts.flagged += 1;
      return verdict.flag ? "flagged" : "not_flagged";
    };
    const add = async (event, opened) => {
      const file = path.join(out, "docs", "feedback", `${event.id}.json`);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, `${JSON.stringify(inboxDoc(event, opened, await dangerOf(opened.text)))}\n`, { mode: 0o600, flag: "wx" });
      entries.push({ op: "set", collection: "feedback", doc_id: event.id, file_path: file });
      additions[event.id] = event.received_day;
      counts.new += 1;
      counts.by_kind[opened.kind] = (counts.by_kind[opened.kind] ?? 0) + 1;
      if (event.public_review) counts.reviews_waiting += 1;
    };
    // Messages an earlier fetch couldn't open (a missing key, say) are tried again first, within the same budget of model calls;
    // past it they wait, unchanged, for the next fetch. One the server no longer has is dropped.
    for (const earlier of Array.isArray(state.unreadable) ? state.unreadable : []) {
      if (!FEEDBACK_ID_PATTERN.test(earlier?.id ?? "")) continue;
      if (budgetSpent()) {
        unreadable.push({ id: earlier.id, seq: earlier.seq });
        continue;
      }
      const response = await fetch(`${base}/owner/message?id=${encodeURIComponent(earlier.id)}`, { headers: { authorization: `Bearer ${token}` } });
      if (response.status === 404) continue;
      if (!response.ok) fail(`The server refused message: HTTP ${response.status}.`);
      const event = (await response.json()).message;
      const opened = openMessage(keys, event);
      if (opened) await add(event, opened);
      else unreadable.push({ id: earlier.id, seq: earlier.seq });
    }
    let cursor = after;
    let read = 0;
    let stopped = false;
    for (;;) {
      // `confirmed` stays at the last confirmed read while paging, so no deletion record is removed before the Inbox has it.
      const page = await ownerRequest(base, token, "events", { query: `?after=${cursor}&confirmed=${after}&limit=100` });
      for (const event of page.events) {
        if (!FEEDBACK_ID_PATTERN.test(event.id ?? "")) fail("The server sent an event with an invalid id.");
        if (event.type === "deleted") {
          entries.push({ op: "delete", collection: "feedback", doc_id: event.id });
          removals.add(event.id);
          counts.deleted += 1;
        } else {
          const opened = openMessage(keys, event);
          if (opened && budgetSpent()) {
            // This message would need a call past the budget: it and everything after it wait for the next fetch.
            stopped = true;
            break;
          }
          if (opened) await add(event, opened);
          else unreadable.push({ id: event.id, seq: event.seq });
        }
        cursor = Math.max(cursor, event.seq);
        read += 1;
      }
      counts.held = page.held ?? 0;
      counts.full = page.full ?? {};
      counts.stored = page.stored ?? {};
      if (stopped) {
        counts.more_waiting = true;
        break;
      }
      cursor = Math.max(cursor, page.next_after ?? cursor);
      if (!page.more || read >= maxEvents) {
        counts.more_waiting = Boolean(page.more);
        break;
      }
    }
    counts.unreadable = unreadable.length;
    const today = now();
    for (const [id, day] of Object.entries({ ...known, ...additions })) {
      if (removals.has(id)) continue;
      if (!DAY.test(day) || today - Date.parse(`${day}T00:00:00Z`) >= RETENTION_DAYS * 24 * 3_600_000) {
        entries.push({ op: "delete", collection: "feedback", doc_id: id });
        removals.add(id);
        counts.expired_here += 1;
      }
    }
    const batches = [];
    for (let index = 0; index < entries.length; index += BATCH) batches.push(entries.slice(index, index + BATCH));
    await fs.writeFile(path.join(out, "plan.json"), `${JSON.stringify({ batches, counts }, null, 1)}\n`, { mode: 0o600 });
    state.pending = { folder: out, complete: true, next_after: cursor, unreadable, additions, removals: [...removals], at: new Date().toISOString() };
    await save();
    return [
      `Feedback: ${counts.new} new (${Object.entries(counts.by_kind).map(([kind, count]) => `${count} ${kind}`).join(", ") || "none"}), ${counts.reviews_waiting} review(s) waiting for a yes, ${counts.deleted} deletion(s), ${counts.held} held for the first hour.`,
      `Danger check: ${reader ? `${counts.flagged} flagged as possibly in danger, ${counts.refused} the AI declined to read (read those first too), ${counts.not_checked} not checked` : "off"}${Object.keys(counts.check_failures).length ? ` (${Object.entries(counts.check_failures).map(([reason, count]) => `${count} ${reason}`).join(", ")})` : ""}.`,
      ...(counts.expired_here ? [`${counts.expired_here} Inbox cop(ies) past a year removed.`] : []),
      ...(counts.unreadable ? [`${counts.unreadable} message(s) could not be opened with the keys in ${paths.keys}; each fetch tries them again.`] : []),
      ...(Object.entries(counts.full).filter(([, full]) => full).map(([door]) => `The ${door} door is full.`)),
      ...(counts.more_waiting ? ["More are waiting: fetch again after confirming."] : []),
      `Batches: ${batches.length} in ${path.join(out, "plan.json")} (send each with ArtifactData batch to the Inbox, then fetch --confirm ${out}).`
    ].join("\n");
  } catch (error) {
    await fs.rm(out, { recursive: true, force: true });
    state.pending = null;
    await save();
    throw error;
  }
}

async function discardFetch(paths, options) {
  const folder = options.discard;
  const state = (await readJson(paths.state, {})) ?? {};
  if (!state.pending || state.pending.folder !== folder) fail(`No unconfirmed fetch for ${folder}.`);
  await fs.rm(folder, { recursive: true, force: true });
  // Some of the batch may already be in the Inbox: every id it added stays in the inventory (ids and days only), so a copy that
  // reached the Inbox is still removed after a year; none of its removals is applied. Only a confirmation takes an id out.
  state.imported = { ...(state.imported ?? {}), ...(state.pending.additions ?? {}) };
  state.pending = null;
  await writePrivate(paths.state, `${JSON.stringify(state)}\n`);
  return `Discarded ${folder}; the next fetch reads the same messages again.`;
}

async function confirmFetch(paths, options) {
  const folder = options.confirm;
  const state = (await readJson(paths.state, {})) ?? {};
  if (!state.pending?.complete || state.pending.folder !== folder) fail(`No unconfirmed fetch for ${folder}.`);
  // The folder goes first: if it can't be removed, the record of it stays, and the next fetch removes it.
  await fs.rm(folder, { recursive: true, force: true });
  state.after = state.pending.next_after;
  state.unreadable = state.pending.unreadable ?? [];
  const inventory = { ...(state.imported ?? {}), ...(state.pending.additions ?? {}) };
  for (const id of state.pending.removals ?? []) delete inventory[id];
  state.imported = inventory;
  state.pending = null;
  await writePrivate(paths.state, `${JSON.stringify(state)}\n`);
  return `Confirmed: the cursor is at ${state.after}; ${folder} deleted.`;
}

// --- owner actions ----------------------------------------------------------------------------------------------------------
function requireConfirm(options, expected) {
  if (options.confirm !== expected) fail(`Type the same value after --confirm to go ahead: --confirm ${expected}`);
}

async function ownerChoice(exportDir, id) {
  if (typeof exportDir !== "string" || !path.isAbsolute(exportDir)) fail("Pass --export with the folder of this turn's Inbox export (ArtifactData list of choices).");
  const choice = await readJson(path.join(exportDir, "choices", `feedback-${id}.json`));
  return typeof choice?.choice === "string" ? choice.choice : null;
}

async function inboxUpdatePlan(exportDir, id, entry) {
  const file = path.join(exportDir, `feedback-${id}-update.json`);
  await fs.writeFile(file, `${JSON.stringify(entry.data)}\n`, { mode: 0o600 });
  const plan = path.join(exportDir, `feedback-${id}-plan.json`);
  await fs.writeFile(plan, `${JSON.stringify({ batches: [[{ op: entry.op, collection: "feedback", doc_id: id, ...(entry.op === "update" ? { file_path: file } : {}) }]] })}\n`, { mode: 0o600 });
  return plan;
}

async function deleteOne(paths, options) {
  const id = options._[0];
  if (!FEEDBACK_ID_PATTERN.test(id ?? "")) fail("delete needs a message id (fb_…).");
  requireConfirm(options, id);
  if ((await ownerChoice(options.export, id)) !== "delete") fail(`The Inbox export has no "Delete" choice from the owner for ${id}.`);
  const base = await serverUrl(paths, options);
  const response = await fetch(`${base}/owner/delete`, {
    method: "POST",
    headers: { authorization: `Bearer ${await loadToken(paths)}`, "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  // Already gone on the server (the sender deleted it, say): the Inbox copy still goes.
  if (response.status !== 200 && response.status !== 404) fail(`The server refused delete: HTTP ${response.status}.`);
  // The inventory keeps the id: the server's deletion record takes it out at a confirmed fetch, and if that record is long gone, the
  // year's removal does (removing an Inbox copy that is already gone changes nothing).
  const plan = await inboxUpdatePlan(options.export, id, { op: "delete" });
  return `${response.status === 200 ? "Deleted" : "Already gone on the server"}: ${id}. Inbox write: ${plan}`;
}

async function deleteMany(paths, options) {
  const { via, from, to } = options;
  if (!["page", "chat"].includes(via) || !DAY.test(from ?? "") || !DAY.test(to ?? "")) fail("delete-many needs --via page|chat --from YYYY-MM-DD --to YYYY-MM-DD.");
  requireConfirm(options, `${via} ${from} ${to}`);
  const result = await ownerRequest(await serverUrl(paths, options), await loadToken(paths), "delete-many", { method: "POST", body: { via, from_day: from, to_day: to } });
  return `Deleted ${result.deleted} ${via} message(s) received ${from} to ${to}; their removals come with the next fetch.`;
}

async function publish(paths, options) {
  const id = options._[0];
  if (!FEEDBACK_ID_PATTERN.test(id ?? "")) fail("publish needs a message id (fb_…).");
  requireConfirm(options, id);
  if ((await ownerChoice(options.export, id)) !== "publish") fail(`The Inbox export has no "Show publicly" choice from the owner for ${id}.`);
  const base = await serverUrl(paths, options);
  const token = await loadToken(paths);
  const keys = await loadKeys(paths);
  // The message is read again from the server and opened here, so what is published is exactly what was sealed.
  const response = await fetch(`${base}/owner/message?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404) fail(`${id} is not among the server's stored messages (deleted or expired).`);
  if (!response.ok) fail(`The server refused message: HTTP ${response.status}.`);
  const found = (await response.json()).message;
  if (!found.public_review) fail(`${id} is not a review its sender let be shown.`);
  const key = keys.get(found.key_id) ?? fail(`No key ${found.key_id} in ${paths.keys}.`);
  const opened = openSealedForOwner({ ownerPrivateKey: key, id, record: recordOf(found), sealed: found.sealed });
  await ownerRequest(base, token, "publish", { method: "POST", body: { id, text: opened.text, publish_key: opened.publish_key } });
  const plan = await inboxUpdatePlan(options.export, id, { op: "update", data: { published: true, updatedAt: new Date().toISOString() } });
  return `Published: ${id}. Inbox write: ${plan}`;
}

async function unpublish(paths, options) {
  const id = options._[0];
  if (!FEEDBACK_ID_PATTERN.test(id ?? "")) fail("unpublish needs a message id (fb_…).");
  requireConfirm(options, id);
  if (typeof options.export !== "string" || !path.isAbsolute(options.export)) fail("Pass --export with this turn's Inbox export folder (the Inbox write goes there).");
  const result = await ownerRequest(await serverUrl(paths, options), await loadToken(paths), "unpublish", { method: "POST", body: { id } });
  // As publish writes published: true to the Inbox, this writes false, so the view offers "Show publicly" again.
  const plan = await inboxUpdatePlan(options.export, id, { op: "update", data: { published: false, updatedAt: new Date().toISOString() } });
  return `${result.unpublished ? "Taken down" : "Was not shown publicly"}: ${id}. Inbox write: ${plan}`;
}

async function status(paths) {
  const keys = await readJson(paths.keys);
  const state = (await readJson(paths.state, {})) ?? {};
  const config = (await readJson(paths.config, {})) ?? {};
  return [
    `Server: ${config.server ?? "not set"}`,
    `Keys: ${(keys?.keys ?? []).map((entry) => entry.key_id).join(", ") || "none"}`,
    `Cursor: ${state.after ?? 0}${state.pending ? `; unconfirmed fetch in ${state.pending.folder}` : ""}`
  ].join("\n");
}

// The danger reader for a fetch: on unless --danger-check off. Its model, Claude sign-in folder and command come from the options or
// config.json ("danger_model", "claude_config_dir", "claude_bin"), else the defaults.
async function dangerReaderFor(paths, options, createReader) {
  const setting = options["danger-check"] ?? "on";
  if (!["on", "off"].includes(setting)) fail("--danger-check must be on or off.");
  if (setting === "off") return null;
  const config = (await readJson(paths.config, {})) ?? {};
  return createReader({
    model: options["danger-model"] ?? config.danger_model ?? DANGER_READER_DEFAULT_MODEL,
    configDir: options["claude-config-dir"] ?? config.claude_config_dir ?? null,
    command: options["claude-bin"] ?? config.claude_bin ?? "claude"
  });
}

export async function runFeedbackInbox(argv, { configDir = path.join(os.homedir(), ".config", "innersignal-feedback"), now = Date.now, createReader = createDangerReader, maxChecked = MAX_EVENTS_PER_CHECKED_FETCH } = {}) {
  const { command, options } = parseArgs(argv);
  const paths = configPaths(options["config-dir"] ?? configDir);
  const locked = (task) => withLock(paths, task);
  switch (command) {
    case "keygen": return locked(() => keygen(paths, options));
    case "fetch":
      if (options.confirm) return locked(() => confirmFetch(paths, options));
      if (options.discard) return locked(() => discardFetch(paths, options));
      return locked(async () => fetchEvents(paths, options, now, await dangerReaderFor(paths, options, createReader), maxChecked));
    case "delete": return locked(() => deleteOne(paths, options));
    case "delete-many": return locked(() => deleteMany(paths, options));
    case "publish": return locked(() => publish(paths, options));
    case "unpublish": return locked(() => unpublish(paths, options));
    case "status": return status(paths);
    default: return fail("Commands: keygen, fetch, delete, delete-many, publish, unpublish, status (see the top of scripts/feedback-inbox.mjs).");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFeedbackInbox(process.argv.slice(2)).then((output) => {
    console.log(output);
  }, (error) => {
    console.error(error instanceof FeedbackInboxError ? error.message : `Failed: ${error?.code ?? error?.name ?? "error"}`);
    process.exitCode = 1;
  });
}
