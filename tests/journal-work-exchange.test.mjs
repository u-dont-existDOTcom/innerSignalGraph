import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createJournalWorkExchange,
  deriveJournalWorkExchangeKeys,
  journalWorkFileKey
} from "../src/journal-import/work-exchange.mjs";

const WORK_ID = "job:synthetic-work-0001";
const CASE_ID = "synthetic-journal-case";

function workEntry(overrides = {}) {
  return {
    schema_version: 1,
    work_id: WORK_ID,
    case_id: CASE_ID,
    role: "extractor",
    instruction: "Synthetic role instruction.",
    packet: { core_units: [{ unit_id: "u1", text: "A synthetic sentence." }] },
    output_schema_name: "synthetic-result",
    output_schema: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
    expected_generation: "generation:synthetic",
    issued_at: "2026-09-27T00:00:00.000Z",
    expires_at: "2026-09-28T00:00:00.000Z",
    ...overrides
  };
}

async function tempRoot(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "journal-work-exchange-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const secret = () => randomBytes(32).toString("base64");

test("a published work item and its answer round-trip with an authenticated receipt", async (t) => {
  const root = await tempRoot(t);
  const exchange = createJournalWorkExchange({ root, secret: secret(), now: () => new Date("2026-09-27T01:00:00.000Z") });
  assert.deepEqual(await exchange.publishWork(workEntry()), { fileKey: journalWorkFileKey(WORK_ID), created: true });
  assert.deepEqual(await exchange.readWork(WORK_ID), workEntry());
  assert.equal(await exchange.hasResult(WORK_ID), false);
  assert.equal(await exchange.readResult(WORK_ID), null);

  const stored = await exchange.submitResult({ workId: WORK_ID, output: { items: [1, 2] }, subject: "synthetic-subject" });
  assert.equal(stored.stored, true);
  assert.equal(stored.already, false);
  assert.match(stored.receipt_id, /^journal-work-receipt:/u);
  assert.equal(await exchange.hasResult(WORK_ID), true);

  const result = await exchange.readResult(WORK_ID);
  assert.deepEqual(result.output, { items: [1, 2] });
  assert.equal(result.receipt.transport, "chatgpt_connector_tool");
  assert.equal(result.receipt.completion_status, "completed");
  assert.equal(result.receipt.received_at, "2026-09-27T01:00:00.000Z");
  assert.notEqual(result.receipt.subject_sha256, "synthetic-subject");
  assert.equal(result.receipt.tag.length, 64);
});

test("the first answer wins, and re-publishing a work item keeps the first entry", async (t) => {
  const root = await tempRoot(t);
  const exchange = createJournalWorkExchange({ root, secret: secret() });
  await exchange.publishWork(workEntry());
  assert.equal((await exchange.publishWork(workEntry({ instruction: "Different." }))).created, false);
  assert.equal((await exchange.readWork(WORK_ID)).instruction, "Synthetic role instruction.");
  await exchange.submitResult({ workId: WORK_ID, output: { items: ["first"] }, subject: "a" });
  assert.deepEqual(await exchange.submitResult({ workId: WORK_ID, output: { items: ["late"] }, subject: "b" }), { stored: true, already: true });
  assert.deepEqual((await exchange.readResult(WORK_ID)).output, { items: ["first"] });
});

test("files are private, named without the work ID, and hold no plaintext", async (t) => {
  const root = await tempRoot(t);
  const exchange = createJournalWorkExchange({ root, secret: secret() });
  await exchange.publishWork(workEntry());
  await exchange.submitResult({ workId: WORK_ID, output: { items: ["synthetic answer"] }, subject: "s" });
  for (const dir of ["outbox", "inbox"]) {
    const info = await fs.stat(path.join(root, dir));
    assert.equal(info.mode & 0o777, 0o700);
    const names = await fs.readdir(path.join(root, dir));
    assert.deepEqual(names, [`${journalWorkFileKey(WORK_ID)}.json`]);
    // One handle for the mode check and the read, so both look at the same file.
    const handle = await fs.open(path.join(root, dir, names[0]), "r");
    try {
      assert.equal((await handle.stat()).mode & 0o777, 0o600);
      const text = await handle.readFile("utf8");
      for (const secretText of ["synthetic", WORK_ID, CASE_ID, "instruction"]) assert.ok(!text.includes(secretText), `${dir} leaks ${secretText}`);
    } finally {
      await handle.close();
    }
  }
});

test("tampered, moved or wrongly keyed files are refused", async (t) => {
  const root = await tempRoot(t);
  const key = secret();
  const exchange = createJournalWorkExchange({ root, secret: key });
  await exchange.publishWork(workEntry());
  await exchange.publishWork(workEntry({ work_id: "job:synthetic-work-0002" }));
  await exchange.submitResult({ workId: WORK_ID, output: { items: [] }, subject: "s" });

  await assert.rejects(createJournalWorkExchange({ root, secret: secret() }).readWork(WORK_ID), { code: "JOURNAL_WORK_ENTRY_INVALID" });

  // A result copied under another work item's name fails its bound associated data.
  const inbox = path.join(root, "inbox");
  await fs.copyFile(path.join(inbox, `${journalWorkFileKey(WORK_ID)}.json`), path.join(inbox, `${journalWorkFileKey("job:synthetic-work-0002")}.json`));
  await assert.rejects(exchange.readResult("job:synthetic-work-0002"), { code: "JOURNAL_WORK_ENTRY_INVALID" });

  // Flipped ciphertext fails authentication.
  const handle = await fs.open(path.join(inbox, `${journalWorkFileKey(WORK_ID)}.json`), "r+");
  try {
    const envelope = JSON.parse(await handle.readFile("utf8"));
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] ^= 1;
    envelope.ciphertext = bytes.toString("base64");
    await handle.truncate(0);
    await handle.write(JSON.stringify(envelope), 0);
  } finally {
    await handle.close();
  }
  await assert.rejects(exchange.readResult(WORK_ID), { code: "JOURNAL_WORK_ENTRY_INVALID" });
});

test("a missing exchange root is created with private modes and works end to end", async (t) => {
  const parent = await tempRoot(t);
  const root = path.join(parent, "fresh", "exchange");
  const exchange = createJournalWorkExchange({ root, secret: secret() });
  await exchange.publishWork(workEntry());
  await exchange.submitResult({ workId: WORK_ID, output: { items: [] }, subject: "s" });
  assert.deepEqual((await exchange.readResult(WORK_ID)).output, { items: [] });
  for (const dir of [path.join(parent, "fresh"), root, path.join(root, "outbox"), path.join(root, "inbox")]) {
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700, dir);
  }
});

test("an entry replaced by a symbolic link is refused, not followed", async (t) => {
  const root = await tempRoot(t);
  const exchange = createJournalWorkExchange({ root, secret: secret() });
  await exchange.publishWork(workEntry());
  const file = path.join(root, "outbox", `${journalWorkFileKey(WORK_ID)}.json`);
  const moved = path.join(root, "elsewhere.json");
  await fs.rename(file, moved);
  await fs.symlink(moved, file);
  await assert.rejects(exchange.readWork(WORK_ID), { code: "JOURNAL_WORK_ENTRY_INVALID" });
});

test("a receipt signed with another key is refused even when the payload decrypts", async (t) => {
  const root = await tempRoot(t);
  const a = deriveJournalWorkExchangeKeys(secret());
  const b = deriveJournalWorkExchangeKeys(secret());
  const writer = createJournalWorkExchange({ root, keys: { encryption: a.encryption, receipt: b.receipt } });
  const reader = createJournalWorkExchange({ root, keys: a });
  await writer.publishWork(workEntry());
  await writer.submitResult({ workId: WORK_ID, output: { items: [] }, subject: "s" });
  await assert.rejects(reader.readResult(WORK_ID), { code: "JOURNAL_WORK_RECEIPT_INVALID" });
});

test("malformed entries, oversized answers and weak secrets are refused; retiring leaves a tombstone", async (t) => {
  const root = await tempRoot(t);
  assert.throws(() => createJournalWorkExchange({ root, secret: randomBytes(16).toString("base64") }), { code: "JOURNAL_WORK_EXCHANGE_SECRET_INVALID" });
  assert.throws(() => createJournalWorkExchange({ root: "relative/path", secret: secret() }), { code: "JOURNAL_WORK_EXCHANGE_ROOT_INVALID" });
  const exchange = createJournalWorkExchange({ root, secret: secret(), now: () => new Date("2026-09-29T00:00:00.000Z") });
  await assert.rejects(exchange.publishWork(workEntry({ work_id: "bad id" })), { code: "JOURNAL_WORK_ID_INVALID" });
  await assert.rejects(exchange.publishWork(workEntry({ case_id: "Bad Case" })), { code: "JOURNAL_WORK_ENTRY_INVALID" });
  await assert.rejects(exchange.publishWork(workEntry({ expires_at: "2026-09-26T00:00:00.000Z" })), { code: "JOURNAL_WORK_ENTRY_INVALID" });
  await assert.rejects(exchange.publishWork(workEntry({ packet: "text" })), { code: "JOURNAL_WORK_ENTRY_INVALID" });
  await exchange.publishWork(workEntry());
  assert.equal(exchange.isExpired(await exchange.readWork(WORK_ID)), true);
  await assert.rejects(exchange.submitResult({ workId: WORK_ID, output: { items: ["x".repeat(900_001)] }, subject: "s" }), { code: "JOURNAL_WORK_OUTPUT_TOO_LARGE" });
  await assert.rejects(exchange.submitResult({ workId: WORK_ID, output: [1], subject: "s" }), { code: "JOURNAL_WORK_OUTPUT_INVALID" });
  await exchange.submitResult({ workId: WORK_ID, output: { items: ["first"] }, subject: "s" });
  await exchange.retireWork(WORK_ID);
  assert.equal(await exchange.readWork(WORK_ID), null);
  assert.equal(await exchange.hasResult(WORK_ID), true);
  assert.deepEqual(await exchange.readResult(WORK_ID), { retired: true, retired_at: "2026-09-29T00:00:00.000Z" });
  // A duplicate still in flight when the item was retired cannot leave a late answer behind.
  assert.deepEqual(await exchange.submitResult({ workId: WORK_ID, output: { items: ["late"] }, subject: "s" }), { stored: true, already: true });
  assert.deepEqual(await exchange.readResult(WORK_ID), { retired: true, retired_at: "2026-09-29T00:00:00.000Z" });
  // Retiring an item that never got an answer closes it too.
  await exchange.publishWork(workEntry({ work_id: "job:synthetic-work-0003" }));
  await exchange.retireWork("job:synthetic-work-0003");
  assert.deepEqual(await exchange.submitResult({ workId: "job:synthetic-work-0003", output: { items: [] }, subject: "s" }), { stored: true, already: true });
  assert.deepEqual((await fs.readdir(path.join(root, "inbox"))).filter((name) => name.startsWith(".tmp-")), []);
});
