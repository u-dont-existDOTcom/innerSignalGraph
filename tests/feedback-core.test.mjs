import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FeedbackSealError, keyIdFor, readOwnerPublicKey, sealForOwner } from "../src/feedback/sealed-box.mjs";
import { generateOwnerKeyPair, openSealedForOwner, readOwnerPrivateKey } from "../src/feedback/open-sealed.mjs";
import { CODE_ALPHABET, FEEDBACK_ID_PATTERN, feedbackIdForCode, newDeletionCode, normalizeDeletionCode } from "../src/feedback/codes.mjs";
import { FEEDBACK_KINDS, readFeedbackInput } from "../src/feedback/validate.mjs";
import { FeedbackStoreError, openFeedbackStore } from "../src/feedback/store.mjs";
import { clientAddressKey, createClientKeyer, createRateLimiter } from "../src/feedback/limits.mjs";

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

// The clear record a message was sealed with, rebuilt from what the owner's read returns.
const recordOf = (event) => ({
  format: event.format, id: event.id, seq: event.seq, received_day: event.received_day, via: event.via, key_id: event.key_id,
  public_review: event.public_review, ...(event.held_until ? { held_until: event.held_until } : {}), ...(event.publish_mac ? { publish_mac: event.publish_mac } : {})
});
const open = (keys, event) => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: event.id, record: recordOf(event), sealed: event.sealed });
const messages = (listed) => listed.events.filter((event) => event.type === "message");

test("a sealed message opens only with the owner's key and its own record", () => {
  const keys = ownerKeys();
  const record = { format: "inner-signal-feedback-v1", id: "fb_TEST", seq: 1, received_day: "2026-11-22", via: "page", public_review: false };
  const sealed = sealForOwner({ ownerPublicKey: keys.publicKey, id: "fb_TEST", record, plaintext: { text: MARKER } });
  assert.equal(JSON.stringify(sealed).includes(MARKER), false);
  assert.deepEqual(openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record, sealed }), { text: MARKER });
  assert.equal(Buffer.from(sealed.ciphertext, "base64url").length, 512, "padded to the first size step");

  const other = ownerKeys();
  const unreadable = (fn) => assert.throws(fn, (error) => error instanceof FeedbackSealError && error.code === "FEEDBACK_SEAL_UNREADABLE");
  unreadable(() => openSealedForOwner({ ownerPrivateKey: other.privateKey, id: "fb_TEST", record, sealed }));
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record: { ...record, public_review: true }, sealed }));
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_OTHER", record, sealed }));
  const flipped = Buffer.from(sealed.ciphertext, "base64url");
  flipped[0] ^= 1;
  unreadable(() => openSealedForOwner({ ownerPrivateKey: keys.privateKey, id: "fb_TEST", record, sealed: { ...sealed, ciphertext: flipped.toString("base64url") } }));
});

test("owner keys are checked: wrong length, degenerate keys and a mismatched pair are refused", () => {
  assert.throws(() => readOwnerPublicKey("short"), { code: "FEEDBACK_OWNER_KEY_INVALID" });
  assert.throws(() => readOwnerPublicKey(Buffer.alloc(32).toString("base64url")), { code: "FEEDBACK_OWNER_KEY_INVALID" }, "a degenerate key");
  const one = Buffer.alloc(32);
  one[0] = 1;
  assert.throws(() => readOwnerPublicKey(one.toString("base64url")), { code: "FEEDBACK_OWNER_KEY_INVALID" }, "another low-order point");
  const a = generateOwnerKeyPair();
  const b = generateOwnerKeyPair();
  assert.throws(() => readOwnerPrivateKey({ privateKey: a.privateKey, publicKey: b.publicKey }), { code: "FEEDBACK_OWNER_KEY_INVALID" });
  assert.match(keyIdFor(readOwnerPublicKey(a.publicKey)), /^[0-9a-f]{16}$/u);
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
});

test("what a message may hold: four kinds, bounded text in any script, no hidden characters, a one-line address", () => {
  assert.deepEqual([...FEEDBACK_KINDS], ["suggestion", "bug", "praise", "review"]);
  const ok = (input) => { const read = readFeedbackInput(input); assert.equal(read.ok, true, JSON.stringify(read)); return read.value; };
  const refused = (input, code) => assert.equal(readFeedbackInput(input).code, code);
  assert.equal(ok({ kind: "bug", text: "  line one\r\nline two\u0000\u0007\tend  " }).text, "line one\nline two\tend");
  assert.equal(ok({ kind: "bug", text: "a\u202Eb\u2066c\u200Bd\uFEFFe\u00ADf" }).text, "abcdef", "direction overrides and invisible characters go");
  assert.equal(ok({ kind: "praise", text: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} م\u200Cن" }).text, "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} م\u200Cن", "joiners stay");
  assert.equal(ok({ kind: "praise", text: "x".repeat(5_000) }).text.length, 5_000);
  assert.equal([...ok({ kind: "praise", text: "\u{1F600}".repeat(5_000) }).text].length, 5_000, "counted in code points");
  assert.equal(ok({ kind: "review", text: "漢".repeat(5_000) }).text.length, 5_000);
  refused({ kind: "praise", text: "x".repeat(5_001) }, "FEEDBACK_TEXT_INVALID");
  refused({ kind: "praise", text: " \n\t\u200B " }, "FEEDBACK_TEXT_INVALID");
  refused({ kind: "complaint", text: "x" }, "FEEDBACK_KIND_INVALID");
  refused({ kind: "praise" }, "FEEDBACK_TEXT_INVALID");
  assert.equal(ok({ kind: "bug", text: "x", replyAddress: " person@example.invalid\nBcc: other " }).replyAddress, "person@example.invalid Bcc: other");
  assert.equal(ok({ kind: "bug", text: "x", replyAddress: "   " }).replyAddress, null);
  refused({ kind: "bug", text: "x", replyAddress: "a".repeat(201) }, "FEEDBACK_ADDRESS_INVALID");
  assert.equal(ok({ kind: "review", text: "x", mayShowPublicly: true }).mayShowPublicly, true);
  refused({ kind: "praise", text: "x", mayShowPublicly: true }, "FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS");
  refused({ kind: "review", text: "x", mayShowPublicly: "yes" }, "FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS");
});

test("the store keeps one sealed file per message: the day, the door and an arrival number in clear, nothing else", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => new Date("2026-11-22T13:02:03.456Z") });
  const sent = await store.add({ kind: "bug", text: `The page froze ${MARKER}`, replyAddress: `reply-${MARKER}@example.invalid` }, { via: "page" });
  assert.match(sent.id, FEEDBACK_ID_PATTERN);
  assert.equal(sent.id, feedbackIdForCode(sent.code));
  assert.equal(sent.receivedAt, "2026-11-22T13:02:03Z");
  assert.equal(sent.heldUntil, null);
  assert.deepEqual({ ...sent.stored }, { kind: "bug", text: `The page froze ${MARKER}`, replyAddress: `reply-${MARKER}@example.invalid`, mayShowPublicly: false });

  const file = path.join(root, "items", `${sent.id}.json`);
  const info = await fs.stat(file);
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(info.mtime.toISOString(), "2026-11-22T00:00:00.000Z", "the file's time shows the day only");
  for (const name of await listFiles(root)) {
    const body = await fs.readFile(name, "utf8");
    assert.equal(body.includes(MARKER), false, `${path.relative(root, name)} holds no clear text`);
    assert.equal(body.includes(sent.code.replaceAll("-", "")), false, "the code is never kept");
    assert.equal(body.includes("13:02"), false, "no time of day in clear");
  }
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.deepEqual(Object.keys(stored).sort(), ["format", "id", "key_id", "public_review", "received_day", "sealed", "seq", "via"]);

  const listed = await store.listEvents();
  assert.equal(messages(listed).length, 1);
  assert.deepEqual(open(keys, listed.events[0]), {
    kind: "bug", text: `The page froze ${MARKER}`, reply_address: `reply-${MARKER}@example.invalid`, may_show_publicly: false,
    received_at: "2026-11-22T13:02:03Z", via: "page"
  });
  assert.equal(JSON.stringify(listed).includes(MARKER), false);
  assert.deepEqual(listed.stored, { page: 1, chat: 0 });
});

test("a chat message is held for an hour, the read stops before it, and its code deletes it unread", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T10:15:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const first = await store.add({ kind: "praise", text: "page one" }, { via: "page" });
  const chat = await store.add({ kind: "suggestion", text: "from a chat" }, { via: "chat" });
  const later = await store.add({ kind: "praise", text: "page two" }, { via: "page" });
  assert.equal(chat.heldUntil, "2026-11-22T12:00:00Z", "the full hour after one hour from arrival");
  await assert.rejects(store.add({ kind: "review", text: "x", mayShowPublicly: true }, { via: "chat" }), { code: "FEEDBACK_PUBLIC_ONLY_ON_PAGE" });

  const during = await store.listEvents();
  assert.deepEqual(during.events.map((event) => event.id), [first.id], "stops before the held message; the later one waits too");
  assert.equal(during.held, 1);
  assert.equal(during.more, false);
  assert.equal(during.next_after, first.seq);

  clock = new Date("2026-11-22T12:00:00Z");
  const after = await store.listEvents({ after: during.next_after, confirmed: during.next_after });
  assert.deepEqual(after.events.map((event) => event.id), [chat.id, later.id]);
  assert.equal(after.events[0].held_until, "2026-11-22T12:00:00Z");
  assert.equal(open(keys, after.events[0]).text, "from a chat");

  // Deleted during its hold: the owner's read never returns it, only its deletion record.
  clock = new Date("2026-11-22T13:00:00Z");
  const regret = await store.add({ kind: "bug", text: "not what I agreed" }, { via: "chat" });
  assert.deepEqual(await store.deleteByCode(regret.code), { deleted: true, id: regret.id });
  const fromNow = await store.listEvents({ after: after.next_after, confirmed: after.next_after });
  assert.deepEqual(fromNow.events.map((event) => [event.type, event.id]), [["deleted", regret.id]]);
});

test("deletion records stay until the owner's read confirms them, and paging never removes one early", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T01:00:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const sent = [];
  for (let index = 0; index < 5; index += 1) sent.push(await store.add({ kind: "suggestion", text: `n${index}` }, { via: "page" }));
  assert.deepEqual(await store.deleteByCode("not-a-code"), { deleted: false, reason: "FEEDBACK_CODE_INVALID" });
  assert.deepEqual(await store.deleteByCode(newDeletionCode()), { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" });
  assert.deepEqual(await store.deleteByCode(sent[1].code.toLowerCase()), { deleted: true, id: sent[1].id });
  assert.deepEqual(await store.deleteByCode(sent[1].code), { deleted: false, reason: "FEEDBACK_CODE_UNKNOWN" }, "a second time finds nothing");

  // A page of two, then the next page from there while the last confirmed read is still 0: the deletion record survives.
  const page1 = await store.listEvents({ after: 0, confirmed: 0, limit: 2 });
  assert.equal(page1.more, true);
  const page2 = await store.listEvents({ after: page1.next_after, confirmed: 0, limit: 10 });
  const ids = [...page1.events, ...page2.events].map((event) => `${event.type}:${event.id}`);
  assert.deepEqual(ids, [...[0, 2, 3, 4].map((index) => `message:${sent[index].id}`), `deleted:${sent[1].id}`]);
  const again = await store.listEvents({ after: 0, confirmed: 0 });
  assert.equal(again.events.filter((event) => event.type === "deleted").length, 1, "nothing removed before confirmation");
  // Confirming up to the end removes it.
  const confirmed = await store.listEvents({ after: page2.next_after, confirmed: page2.next_after });
  assert.deepEqual(confirmed.events, []);
  assert.deepEqual(await fs.readdir(path.join(root, "deleted")), []);
  await assert.rejects(store.listEvents({ after: 1, confirmed: 2 }), { code: "FEEDBACK_CURSOR_INVALID" });
  assert.equal(await store.deleteById("../items/x", "owner"), false);
});

test("arrival numbers never skip a message stored in the same second as a read, and survive a lost counter file", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  const clock = new Date("2026-11-22T05:00:05Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const a = await store.add({ kind: "praise", text: "a" }, { via: "page" });
  const read1 = await store.listEvents();
  const b = await store.add({ kind: "praise", text: "b" }, { via: "page" });
  const read2 = await store.listEvents({ after: read1.next_after, confirmed: read1.next_after });
  assert.deepEqual(read1.events.map((event) => event.id), [a.id]);
  assert.deepEqual(read2.events.map((event) => event.id), [b.id]);

  await fs.unlink(path.join(root, "counter.json"));
  const reopened = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const c = await reopened.add({ kind: "praise", text: "c" }, { via: "page" });
  assert.ok(c.seq > b.seq, "the next number comes after every one stored");
});

test("only a page review the sender let be shown can be published, only in its exact words, and its code withdraws it", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T03:00:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  const review = await store.add({ kind: "review", text: "Helpful and kind.", mayShowPublicly: true }, { via: "page" });
  const privateReview = await store.add({ kind: "review", text: "Keep this private." }, { via: "page" });
  const event = (await store.listEvents()).events.find((entry) => entry.id === review.id);
  assert.equal(event.public_review, true);
  assert.equal(typeof event.publish_mac, "string");
  const opened = open(keys, event);
  assert.deepEqual((await store.getMessage(review.id)).sealed, event.sealed);
  assert.equal(await store.getMessage("fb_00000000000000000000"), null);

  await assert.rejects(store.publish({ id: review.id, text: "Helpful and kind!", publishKey: opened.publish_key }), { code: "FEEDBACK_PUBLISH_MISMATCH" });
  await assert.rejects(store.publish({ id: review.id, text: opened.text, publishKey: Buffer.alloc(32).toString("base64url") }), { code: "FEEDBACK_PUBLISH_MISMATCH" });
  await assert.rejects(store.publish({ id: privateReview.id, text: "Keep this private.", publishKey: opened.publish_key }), { code: "FEEDBACK_NOT_PUBLISHABLE" });
  await assert.rejects(store.publish({ id: "fb_00000000000000000000", text: "x", publishKey: opened.publish_key }), { code: "FEEDBACK_NOT_FOUND" });
  assert.deepEqual(await store.publishedReviews(), []);

  assert.deepEqual(await store.publish({ id: review.id, text: opened.text, publishKey: opened.publish_key }), { published: true, id: review.id });
  assert.deepEqual(await store.publishedReviews(), [{ text: "Helpful and kind.", month: "2026-11" }]);
  assert.deepEqual(await store.unpublish(review.id), { unpublished: true });
  assert.deepEqual(await store.publishedReviews(), []);

  // The public copy outlives the message's year, and the sender's code still takes it down.
  await store.publish({ id: review.id, text: opened.text, publishKey: opened.publish_key });
  clock = new Date("2027-11-23T00:00:00Z");
  await store.sweep();
  assert.equal(await store.getMessage(review.id), null, "the message expired");
  assert.deepEqual(await store.publishedReviews(), [{ text: "Helpful and kind.", month: "2026-11" }], "the public copy stays");
  assert.deepEqual(await store.deleteByCode(review.code), { deleted: true, id: review.id });
  assert.deepEqual(await store.publishedReviews(), []);
});

test("each door has its own share of the store; expiry, bulk delete and leftovers", async (t) => {
  const root = await temporaryRoot(t);
  const keys = ownerKeys();
  let clock = new Date("2026-11-22T00:00:00Z");
  const store = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock, limits: { doorShares: { page: 2, chat: 1 } } });
  const a = await store.add({ kind: "praise", text: "a" }, { via: "page" });
  await store.add({ kind: "praise", text: "flood" }, { via: "chat" });
  await assert.rejects(store.add({ kind: "praise", text: "flood 2" }, { via: "chat" }), (error) => error instanceof FeedbackStoreError && error.code === "FEEDBACK_FULL");
  clock = new Date("2026-12-01T00:00:00Z");
  const b = await store.add({ kind: "praise", text: "b" }, { via: "page" }, "the page door is still open");
  await assert.rejects(store.add({ kind: "praise", text: "c" }, { via: "page" }), { code: "FEEDBACK_FULL" });
  assert.deepEqual(store.stats().full, { page: true, chat: true });
  await assert.rejects(store.deleteMany({ via: "chat", fromDay: "2026-11-23", toDay: "2026-11-22" }), { code: "FEEDBACK_RANGE_INVALID" });
  assert.deepEqual(await store.deleteMany({ via: "chat", fromDay: "2026-11-22", toDay: "2026-11-22" }), { deleted: 1 });
  assert.equal(store.stats().full.chat, false);

  await fs.writeFile(path.join(root, "tmp", "left-over.json"), "{}");
  const old = new Date("2026-11-22T00:00:00Z");
  await fs.utimes(path.join(root, "tmp", "left-over.json"), old, old);
  clock = new Date("2027-11-22T00:00:00Z");
  assert.deepEqual(await store.sweep(), { expired: 1 });
  assert.deepEqual(await fs.readdir(path.join(root, "tmp")), []);
  const listed = await store.listEvents();
  assert.deepEqual(messages(listed).map((event) => event.id), [b.id]);
  assert.deepEqual(listed.events.filter((event) => event.type === "deleted").map((event) => event.by).sort(), ["expiry", "owner"]);
  assert.ok(listed.events.some((event) => event.type === "deleted" && event.id === a.id));

  const reopened = await openFeedbackStore({ root, ownerPublicKey: keys.publicKey, now: () => clock });
  assert.deepEqual(reopened.stats().stored, { page: 1, chat: 0 });
  clock = new Date("2028-12-30T00:00:00Z");
  await reopened.sweep();
  const late = await reopened.listEvents();
  assert.equal(late.events.filter((event) => event.type === "deleted" && event.by === "owner").length, 0, "unconfirmed records go after 400 days");
});

test("rate limits count per key and window, refuse without counting, refuse new keys when full, and key IPv6 by /64", () => {
  let clock = 0;
  const limiter = createRateLimiter({ rules: { r: [{ windowMs: 1_000, max: 2 }, { windowMs: 10_000, max: 3 }] }, now: () => clock, maxKeys: 2 });
  assert.equal(limiter.take("r", "a"), true);
  assert.equal(limiter.take("r", "a"), true);
  assert.equal(limiter.take("r", "a"), false);
  assert.equal(limiter.take("r", "b"), true, "another key has its own count");
  assert.equal(limiter.take("r", "c"), false, "a full map refuses a new key rather than drop a live one");
  clock = 1_000;
  assert.equal(limiter.take("r", "a"), true, "the short window starts again");
  assert.equal(limiter.take("r", "a"), false, "the long window is full");
  clock = 20_000;
  assert.equal(limiter.take("r", "c"), true, "expired keys make room");
  assert.throws(() => limiter.take("unknown", "a"), TypeError);

  assert.equal(clientAddressKey("2001:db8:1:2:3:4:5:6"), "2001:0db8:0001:0002::/64");
  assert.equal(clientAddressKey("2001:db8:1:2::9"), clientAddressKey("2001:db8:1:2:ffff::1"), "one /64");
  assert.notEqual(clientAddressKey("2001:db8:1:2::9"), clientAddressKey("2001:db8:1:3::9"));
  assert.equal(clientAddressKey("::ffff:192.0.2.7"), "192.0.2.7");
  assert.equal(clientAddressKey("fe80::1%eth0"), "fe80:0000:0000:0000::/64");

  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} });
  const plain = createClientKeyer({ trustForwardedFor: false, secret: Buffer.alloc(32, 1) });
  assert.equal(plain(req("10.0.0.2", "198.51.100.7")), plain(req("10.0.0.2", "203.0.113.9")), "forwarded addresses are ignored unless trusted");
  const trusted = createClientKeyer({ trustForwardedFor: true, secret: Buffer.alloc(32, 1) });
  assert.notEqual(trusted(req("10.0.0.2", "198.51.100.7")), trusted(req("10.0.0.2", "203.0.113.9")));
  assert.equal(trusted(req("10.0.0.2", "1.1.1.1, 198.51.100.7")), trusted(req("10.0.0.2", "198.51.100.7")), "the last address, the one our proxy appends");
  assert.equal(trusted(req("10.0.0.2", "198.51.100.7")).includes("198.51"), false, "the key is not the address");
});
