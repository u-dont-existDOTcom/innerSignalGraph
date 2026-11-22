#!/usr/bin/env node
// The owner's side of InnerSignal's feedback place (design section 7). Runs on the owner's laptop only: it holds his private keys
// and his read token, reads sealed messages from the server, opens them here, and writes them as an ArtifactData batch for his
// InnerSignal Inbox. It prints counts and ids only, never a word of a message, so a session that runs it never reads the texts.
//
//   keygen [--server URL]                 make the key and the token (never overwrites; again adds a key); print the two settings
//   fetch --out DIR                       read new messages and deletions; write DIR/plan.json and DIR/docs/; print counts
//   fetch --confirm DIR                   after the batch was sent: move the cursor on and delete DIR
//   delete ID --export DIR --confirm ID   delete one message; needs his "Delete" choice for it in the Inbox export
//   delete-many --via chat|page --from DAY --to DAY --confirm "VIA FROM TO"   bulk delete, for a flood
//   publish ID --export DIR --confirm ID  show a review publicly; needs his "Show publicly" choice for it in the Inbox export
//   unpublish ID --confirm ID             take a public review down
//   status                                the server address, key ids and cursor (no secrets)
//
// Options: --config-dir DIR (default ~/.config/innersignal-feedback). Files there: owner-keys.json and owner-token (0600),
// config.json (the server address), state.json (the cursor). Keep a second copy of the first two somewhere only you can open.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_ID_PATTERN } from "../src/feedback/codes.mjs";
import { generateOwnerKeyPair, openSealedForOwner, readOwnerPrivateKey } from "../src/feedback/open-sealed.mjs";
import { keyIdFor, readOwnerPublicKey } from "../src/feedback/sealed-box.mjs";

const BATCH = 50;
const MAX_EVENTS_PER_FETCH = 1_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

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
function inboxDoc(event, opened) {
  return {
    id: event.id,
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

async function fetchEvents(paths, options) {
  const out = options.out;
  if (typeof out !== "string" || !path.isAbsolute(out)) fail("fetch needs --out with an absolute path to a new, empty folder.");
  const state = (await readJson(paths.state, {})) ?? {};
  const save = () => writePrivate(paths.state, `${JSON.stringify(state)}\n`);
  // A folder an interrupted or unconfirmed turn left: its batch was never confirmed, so it goes, and the same messages are read again.
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
    const counts = { new: 0, by_kind: {}, reviews_waiting: 0, deleted: 0, unreadable: 0, held: 0, full: {}, stored: {} };
    const unreadable = [];
    const add = async (event, opened) => {
      const file = path.join(out, "docs", "feedback", `${event.id}.json`);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, `${JSON.stringify(inboxDoc(event, opened))}\n`, { mode: 0o600, flag: "wx" });
      entries.push({ op: "set", collection: "feedback", doc_id: event.id, file_path: file });
      counts.new += 1;
      counts.by_kind[opened.kind] = (counts.by_kind[opened.kind] ?? 0) + 1;
      if (event.public_review) counts.reviews_waiting += 1;
    };
    // Messages an earlier fetch couldn't open (a missing key, say) are tried again first; one the server no longer has is dropped.
    for (const earlier of Array.isArray(state.unreadable) ? state.unreadable : []) {
      if (!FEEDBACK_ID_PATTERN.test(earlier?.id ?? "")) continue;
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
    for (;;) {
      // `confirmed` stays at the last confirmed read while paging, so no deletion record is removed before the Inbox has it.
      const page = await ownerRequest(base, token, "events", { query: `?after=${cursor}&confirmed=${after}&limit=100` });
      for (const event of page.events) {
        if (!FEEDBACK_ID_PATTERN.test(event.id ?? "")) fail("The server sent an event with an invalid id.");
        if (event.type === "deleted") {
          entries.push({ op: "delete", collection: "feedback", doc_id: event.id });
          counts.deleted += 1;
        } else {
          const opened = openMessage(keys, event);
          if (opened) await add(event, opened);
          else unreadable.push({ id: event.id, seq: event.seq });
        }
        cursor = Math.max(cursor, event.seq);
        read += 1;
      }
      cursor = Math.max(cursor, page.next_after ?? cursor);
      counts.held = page.held ?? 0;
      counts.full = page.full ?? {};
      counts.stored = page.stored ?? {};
      if (!page.more || read >= MAX_EVENTS_PER_FETCH) {
        counts.more_waiting = Boolean(page.more);
        break;
      }
    }
    counts.unreadable = unreadable.length;
    const batches = [];
    for (let index = 0; index < entries.length; index += BATCH) batches.push(entries.slice(index, index + BATCH));
    await fs.writeFile(path.join(out, "plan.json"), `${JSON.stringify({ batches, counts }, null, 1)}\n`, { mode: 0o600 });
    state.pending = { folder: out, complete: true, next_after: cursor, unreadable, at: new Date().toISOString() };
    await save();
    return [
      `Feedback: ${counts.new} new (${Object.entries(counts.by_kind).map(([kind, count]) => `${count} ${kind}`).join(", ") || "none"}), ${counts.reviews_waiting} review(s) waiting for a yes, ${counts.deleted} deletion(s), ${counts.held} held for the first hour.`,
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

async function confirmFetch(paths, options) {
  const folder = options.confirm;
  const state = (await readJson(paths.state, {})) ?? {};
  if (!state.pending?.complete || state.pending.folder !== folder) fail(`No unconfirmed fetch for ${folder}.`);
  // The folder goes first: if it can't be removed, the record of it stays, and the next fetch removes it.
  await fs.rm(folder, { recursive: true, force: true });
  state.after = state.pending.next_after;
  state.unreadable = state.pending.unreadable ?? [];
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
  const result = await ownerRequest(await serverUrl(paths, options), await loadToken(paths), "delete", { method: "POST", body: { id } });
  const plan = await inboxUpdatePlan(options.export, id, { op: "delete" });
  return `${result.deleted ? "Deleted" : "Not found on the server (already deleted)"}: ${id}. Inbox write: ${plan}`;
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
  const result = await ownerRequest(await serverUrl(paths, options), await loadToken(paths), "unpublish", { method: "POST", body: { id } });
  return result.unpublished ? `Taken down: ${id}.` : `${id} was not shown publicly.`;
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

export async function runFeedbackInbox(argv, { configDir = path.join(os.homedir(), ".config", "innersignal-feedback") } = {}) {
  const { command, options } = parseArgs(argv);
  const paths = configPaths(options["config-dir"] ?? configDir);
  switch (command) {
    case "keygen": return keygen(paths, options);
    case "fetch": return options.confirm ? confirmFetch(paths, options) : fetchEvents(paths, options);
    case "delete": return deleteOne(paths, options);
    case "delete-many": return deleteMany(paths, options);
    case "publish": return publish(paths, options);
    case "unpublish": return unpublish(paths, options);
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
