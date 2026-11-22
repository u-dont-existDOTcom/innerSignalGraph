import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FeedbackSealError, readOwnerPublicKey, sealForOwner } from "../src/feedback/sealed-box.mjs";
import { generateOwnerKeyPair, openSealedForOwner, readOwnerPrivateKey } from "../src/feedback/open-sealed.mjs";
import { CODE_ALPHABET, FEEDBACK_ID_PATTERN, feedbackIdForCode, newDeletionCode, normalizeDeletionCode } from "../src/feedback/codes.mjs";
import { FEEDBACK_KINDS, readFeedbackInput } from "../src/feedback/validate.mjs";
import { FeedbackStoreError, openFeedbackStore } from "../src/feedback/store.mjs";
import { createClientKeyer, createRateLimiter } from "../src/feedback/limits.mjs";

// Synthetic texts only. MARKER must never appear in anything the server keeps in clear.
const MARKER = "synthetic-feedback-marker-4c1d";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ownerKeys() {
  const pair = generateOwnerKeyPair();
  return { pair, publicKey: readOwnerPublicKey(pair.publicKey), privateKey: readOwnerPrivateKey(pair) };
}

async function temporaryRoot(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-store-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "store");
  await fs.mkdir(root, { mode: 0o700 });
  return root;
}

async function listFiles(directory) {
  const out = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full);
  }
  return out;
}

test("a sealed message opens only with the owner's key and its own record", () => {
  const keys = ownerKeys();
  const record = { format: "inner-signal-feedback-v1", id: "fb_TEST", received_at: "2026-11-22T01:00:00Z", via: "page", public_review: false };
  const sealed = sealForOwner({ ownerPublicKey: keys.publicKey, id: "fb_TEST", record, plaintext: { text: MARKER } });
  assert.equal(JSON.stringify(sealed).includes(MARKER), false);
  assert.deepEqual(openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record, sealed }), { text: MARKER });

  const other = ownerKeys();
  const unreadable = (fn) => assert.throws(fn, (error) => error instanceof FeedbackSealError && error.code === "FEEDBACK_SEAL_UNREADABLE");
  unreadable(() => openSealedForOwner({ ownerPrivateKey: other.privateKey, id: "fb_TEST", record, sealed }));
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record: { ...record, public_review: true }, sealed }));
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_OTHER", record, sealed }));
  const flipped = Buffer.from(sealed.ciphertext, "base64url");
  flipped[0] ^= 1;
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record, sealed: { ...sealed, ciphertext: flipped.toString("base64url") } }));
});

test("owner keys are checked: wrong length, a degenerate key and a mismatched pair are refused", () => {
  assert.throws(() => readOwnerPublicKey("short"), { code: "FEEDBACK_OWNER_KEY_INVALID" });
  assert.throws(() => readOwnerPublicKey(Buffer.alloc(32).toString("base64url")), { code: "FEEDBACK_OWNER_KEY_INVALID" }, "a degenerate key");
  const one = Buffer.alloc(32);
  one[0] = 1;
  assert.throws(() => readOwnerPublicKey(one.toString("base64url")), { code: "FEEDBACK_OWNER_KEY_INVALID" }, "another low-order point");
  const a = generateOwnerKeyPair();
  const b = generateOwnerKeyPair();
  assert.throws(() => readOwnerPrivateKey({ privateKey: a.privateKey, publicKey: b.publicKey }), { code: "FEEDBACK_OWNER_KEY_INVALID" });
});

test("no server module imports the code that opens sealed messages", async () => {
  const serverFiles = [
    ...(await fs.readdir(path.join(repositoryRoot, "src/feedback"))).filter((name) => name !== "open-sealed.mjs").map((name) => `src/feedback/${name}`),
    ...(await fs.readdir(path.join(repositoryRoot, "src/server"))).map((name) => `src/server/${name}`),
    "src/cli/private-case-mcp.mjs"
  ];
  for (const file of serverFiles) {
    const source = await fs.readFile(path.join(repositoryRoot, file), "utf8");
    assert.equal(/["'][^"'\n]*open-sealed(?:\.mjs)?["']/u.test(source), false, `${file} must not import open-sealed.mjs`);
  }
});

test("deletion codes: 80 bits in four groups, forgiving to read, one-way to an id", () => {
  const code = newDeletionCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/u);
  for (const character of code.replaceAll("-", "")) assert.ok(CODE_ALPHABET.includes(character));
  const id = feedbackIdForCode(code);
  assert.match(id, FEEDBACK_ID_PATTERN);
  assert.equal(feedbackIdForCode(code.toLowerCase().replaceAll("-", " ")), id);
  assert.equal(feedbackIdForCode(` ${code.replaceAll("-", "")} `), id);
  assert.equal(normalizeDeletionCode("oooo-iiii-llll-0000"), "0000111111110000");
  assert.equal(normalizeDeletionCode("UUUU-0000-0000-0000"), null, "U is not in the alphabet");
  assert.equal(normalizeDeletionCode("0000-0000-0000"), null);
  assert.equal(normalizeDeletionCode(null), null);
  assert.equal(feedbackIdForCode("not a code"), null);
  assert.notEqual(feedbackIdForCode(newDeletionCode()), id);
  assert.equal(id.includes(code.replaceAll("-", "").slice(0, 8)), false);
});

test("what a message may hold: four kinds, bounded text in any script, a one-line address, the public tick only on a review", () => {
  assert.deepEqual([...FEEDBACK_KINDS], ["suggestion", "bug", "praise", "review"]);
  const ok = (input) => { const read = readFeedbackInput(input); assert.equal(read.ok, true, JSON.stringify(read)); return read.value; };
  const refused = (input, code) => assert.equal(readFeedbackInput(input).code, code);
  assert.equal(ok({ kind: "bug", text: "  line one\r\nline two\u0000\u0007\tend  " }).text, "line one\nline two\tend");
  assert.equal(ok({ kind: "praise", text: "x".repeat(5_000) }).text.length, 5_000);
  assert.equal([...ok({ kind: "praise", text: "\u{1F600}".repeat(5_000) }).text].length, 5_000, "counted in code points");
  assert.equal(ok({ kind: "review", text: "漢".repeat(5_000) }).text.length, 5_000);
  refused({ kind: "praise", text: "x".repeat(5_001) }, "FEEDBACK_TEXT_INVALID");
  refused({ kind: "praise", text: " \n\t " }, "FEEDBACK_TEXT_INVALID");
  refused({ kind: "complaint", text: "x" }, "FEEDBACK_KIND_INVALID");
  refused({ kind: "praise" }, "FEEDBACK_TEXT_INVALID");
  assert.equal(ok({ kind: "bug", text: "x", replyAddress: " person@example.invalid\nBcc: other " }).replyAddress, "person@example.invalid Bcc: other");
  assert.equal(ok({ kind: "bug", text: "x", replyAddress: "   " }).replyAddress, null);
  refused({ kind: "bug", text: "x", replyAddress: "a".repeat(201) }, "FEEDBACK_ADDRESS_INVALID");
  assert.equal(ok({ kind: "review", text: "x", mayShowPublicly: true }).mayShowPublicly, true);
  refused({ kind: "praise", text: "x", mayShowPublicly: true }, "FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS");
  refused({ kind: "review", text: "x", mayShowPublicly: "yes" }, "FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS");
});

test("the store keeps one sealed file per message, readable only by the owner, and nothing in clear but the record", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => new Date("2026-11-22T01:02:03.456Z") });
  const sent = await store.add({ kind: "bug", text: `The page froze ${MARKER}`, replyAddress: `reply-${MARKER}@example.invalid` }, { via: "page" });
  assert.match(sent.id, FEEDBACK_ID_PATTERN);
  assert.equal(sent.id, feedbackIdForCode(sent.code));
  assert.equal(sent.receivedAt, "2026-11-22T01:02:03Z");

  const file = path.join(root, "items", `${sent.id}.json`);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  for (const name of await listFiles(root)) {
    const body = await fs.readFile(name, "utf8");
    assert.equal(body.includes(MARKER), false, `${path.relative(root, name)} holds no clear text`);
    assert.equal(body.includes(sent.code), false, "the code is never kept");
    assert.equal(body.includes(sent.code.replaceAll("-", "")), false, "the code is never kept");
  }
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(Object.keys(stored).sort(), ["format", "id", "public_review", "received_at", "sealed", "via"]);

  const listed = await store.listForOwner();
  assert.equal(listed.items.length, 1);
  const item = listed.items[0];
  const record = { format: item.format, id: item.id, received_at: item.received_at, via: item.via, public_review: item.public_review };
  const opened = openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: item.id, record, sealed: item.sealed });
  assert.deepEqual(opened, { kind: "bug", text: `The page froze ${MARKER}`, reply_address: `reply-${MARKER}@example.invalid`, may_show_publicly: false, received_at: "2026-11-22T01:02:03Z", via: "page" });
  assert.equal(JSON.stringify(listed).includes(MARKER), false);
});

test("a deletion code deletes its message and leaves a content-free record the owner's read reports", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T01:00:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const first = await store.add({ kind: "suggestion", text: "one" }, { via: "page" });
  clock = new Date("2026-11-22T01:00:05Z");
  const second = await store.add({ kind: "praise", text: "two" }, { via: "chat" });
  assert.deepEqual(await store.deleteByCode("not-a-code"), { deleted: false, reason: "FEEDBACK_CODE_INVALID" });
  assert.deepEqual(await store.deleteByCode(newDeletionCode()), { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" });
  clock = new Date("2026-11-22T02:00:00Z");
  assert.deepEqual(await store.deleteByCode(first.code.toLowerCase()), { deleted: true, id: first.id });
  assert.deepEqual(await store.deleteByCode(first.code), { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" }, "a second time finds nothing");
  const listed = await store.listForOwner();
  assert.deepEqual(listed.items.map((item) => item.id), [second.id]);
  assert.deepEqual(listed.deleted, [{ id: first.id, deleted_at: "2026-11-22T02:00:00Z", by: "sender" }]);
  assert.equal(store.stats().stored, 1);

  // The cursors move on: nothing is reported twice.
  const again = await store.listForOwner({ itemsAfter: listed.next.items_after, deletedAfter: listed.next.deleted_after });
  assert.deepEqual([again.items.length, again.deleted.length], [0, 0]);
  assert.deepEqual(again.next, listed.next);
  await assert.rejects(store.listForOwner({ itemsAfter: "../../etc" }), { code: "FEEDBACK_CURSOR_INVALID" });
  assert.equal(await store.deleteById("../items/x", "owner"), false);
});

test("pages of the owner's read are in time order and complete", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let second = 0;
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => new Date(Date.UTC(2026, 10, 22, 1, 0, Math.floor(second++ / 2))) });
  const ids = [];
  for (let index = 0; index < 7; index += 1) ids.push((await store.add({ kind: "praise", text: `n${index}` }, { via: "page" })).id);
  const seen = [];
  let cursor = null;
  for (;;) {
    const page = await store.listForOwner({ itemsAfter: cursor, limit: 3 });
    seen.push(...page.items.map((item) => item.id));
    cursor = page.next.items_after;
    if (!page.more) break;
  }
  assert.deepEqual(new Set(seen), new Set(ids));
  assert.equal(seen.length, 7);
});

test("only a review the sender let be shown can be published, and only in the sender's exact words", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => new Date("2026-11-22T03:00:00Z") });
  const review = await store.add({ kind: "review", text: "Helpful and kind.", mayShowPublicly: true }, { via: "page" });
  const privateReview = await store.add({ kind: "review", text: "Keep this private." }, { via: "page" });
  const item = (await store.listForOwner()).items.find((entry) => entry.id === review.id);
  assert.equal(item.public_review, true);
  assert.equal(typeof item.publish_mac, "string");
  const record = { format: item.format, id: item.id, received_at: item.received_at, via: item.via, public_review: true, publish_mac: item.publish_mac };
  const opened = openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: item.id, record, sealed: item.sealed });

  await assert.rejects(store.publish({ id: review.id, text: "Helpful and kind!", publishKey: opened.publish_key }), { code: "FEEDBACK_PUBLISH_MISMATCH" });
  await assert.rejects(store.publish({ id: review.id, text: opened.text, publishKey: Buffer.alloc(32).toString("base64url") }), { code: "FEEDBACK_PUBLISH_MISMATCH" });
  await assert.rejects(store.publish({ id: privateReview.id, text: "Keep this private.", publishKey: opened.publish_key }), { code: "FEEDBACK_NOT_PUBLISHABLE" });
  await assert.rejects(store.publish({ id: "fb_00000000000000000000", text: "x", publishKey: opened.publish_key }), { code: "FEEDBACK_NOT_FOUND" });
  assert.deepEqual(await store.publishedReviews(), []);

  assert.deepEqual(await store.publish({ id: review.id, text: opened.text, publishKey: opened.publish_key }), { published: true, id: review.id });
  assert.deepEqual(await store.publishedReviews(), [{ text: "Helpful and kind.", month: "2026-11" }]);
  assert.equal((await store.listForOwner()).items.find((entry) => entry.id === review.id).published, true);
  assert.deepEqual(await store.unpublish(review.id), { unpublished: true });
  assert.deepEqual(await store.publishedReviews(), []);

  // Deleting a published review takes its public copy with it.
  await store.publish({ id: review.id, text: opened.text, publishKey: opened.publish_key });
  await store.deleteByCode(review.code);
  assert.deepEqual(await store.publishedReviews(), []);
});

test("the store refuses new messages when full, expires old ones and rebuilds its count when reopened", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T00:00:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock, limits: { maxItems: 2 } });
  const a = await store.add({ kind: "praise", text: "a" }, { via: "page" });
  clock = new Date("2026-12-01T00:00:00Z");
  const b = await store.add({ kind: "praise", text: "b" }, { via: "page" });
  await assert.rejects(store.add({ kind: "praise", text: "c" }, { via: "page" }), (error) => error instanceof FeedbackStoreError && error.code === "FEEDBACK_FULL");
  await assert.rejects(store.add({ kind: "praise", text: "" }, { via: "page" }), { code: "FEEDBACK_TEXT_INVALID" });

  await fs.writeFile(path.join(root, "tmp", "left-over.json"), "{}");
  const old = new Date("2026-11-22T00:00:00Z");
  await fs.utimes(path.join(root, "tmp", "left-over.json"), old, old);
  clock = new Date("2027-11-22T00:00:01Z");
  assert.deepEqual(await store.sweep(), { expired: 1 });
  assert.deepEqual(await fs.readdir(path.join(root, "tmp")), []);
  const listed = await store.listForOwner();
  assert.equal(listed.items.length, 1);
  assert.deepEqual(listed.deleted.map((entry) => [entry.id, entry.by]), [[a.id, "expiry"]]);

  const reopened = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock, limits: { maxItems: 2 } });
  assert.equal(reopened.stats().stored, 1);
  clock = new Date("2028-03-01T00:00:00Z");
  assert.deepEqual(await reopened.sweep(), { expired: 1 });
  const later = await reopened.listForOwner();
  assert.deepEqual(later.deleted.map((entry) => entry.id), [b.id], "a's deletion record went after 90 days; b's is new");
  assert.equal(later.items.length, 0);
});

test("rate limits count per key and window, refuse without counting, and forget addresses", () => {
  let clock = 0;
  const limiter = createRateLimiter({ rules: { r: [{ windowMs: 1_000, max: 2 }, { windowMs: 10_000, max: 3 }] }, now: () => clock, maxKeys: 2 });
  assert.equal(limiter.take("r", "a"), true);
  assert.equal(limiter.take("r", "a"), true);
  assert.equal(limiter.take("r", "a"), false);
  assert.equal(limiter.take("r", "b"), true, "another key has its own count");
  clock = 1_000;
  assert.equal(limiter.take("r", "a"), true, "the short window starts again");
  assert.equal(limiter.take("r", "a"), false, "the long window is full");
  clock = 20_000;
  assert.equal(limiter.take("r", "a"), true, "an old key is forgotten");
  limiter.take("r", "c");
  limiter.take("r", "d");
  assert.equal(limiter.size(), 2, "the map stays bounded");
  assert.throws(() => limiter.take("unknown", "a"), TypeError);

  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} });
  const plain = createClientKeyer({ trustForwardedFor: false, secret: Buffer.alloc(32, 1) });
  assert.equal(plain(req("10.0.0.2", "198.51.100.7")), plain(req("10.0.0.2", "203.0.113.9")), "forwarded addresses are ignored unless trusted");
  const trusted = createClientKeyer({ trustForwardedFor: true, secret: Buffer.alloc(32, 1) });
  assert.notEqual(trusted(req("10.0.0.2", "198.51.100.7")), trusted(req("10.0.0.2", "203.0.113.9")));
  assert.equal(trusted(req("10.0.0.2", "1.1.1.1, 198.51.100.7")), trusted(req("10.0.0.2", "198.51.100.7")), "the last address, the one our proxy appends");
  assert.equal(trusted(req("10.0.0.2", "198.51.100.7")).includes("198.51"), false, "the key is not the address");
});
