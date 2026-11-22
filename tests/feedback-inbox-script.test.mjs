import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createFeedbackFromEnvironment } from "../src/feedback/setup.mjs";
import { runFeedbackInbox } from "../scripts/feedback-inbox.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";

// The owner's laptop script against a real local connector: keys, fetching into an Inbox batch, the hour's hold, deletions, and
// publishing only with his own choice in the Inbox export. Synthetic texts only; the script's output never holds a message's words.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "synthetic-feedback-marker-77c2";
const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); }
});

async function world(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "feedback-script-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const configDir = path.join(base, "config");
  const root = path.join(base, "store");
  await fs.mkdir(root, { mode: 0o700 });
  let laptopNow = Date.parse("2026-11-22T12:00:00Z");
  const run = (...argv) => runFeedbackInbox([...argv, "--config-dir", configDir], { now: () => laptopNow });
  // The server's address is known only once it listens, so keygen runs first without it.
  const keys = await run("keygen");
  const setting = (name) => new RegExp(`^${name}=(.+)$`, "mu").exec(keys)?.[1];
  let clock = Date.parse("2026-11-22T09:30:00Z");
  const feedback = await createFeedbackFromEnvironment({
    repositoryRoot,
    now: () => clock,
    environment: {
      INNER_SIGNAL_FEEDBACK: "on",
      INNER_SIGNAL_FEEDBACK_TOOL: "on",
      INNER_SIGNAL_FEEDBACK_ROOT: root,
      INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY: setting("INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY"),
      INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256: setting("INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256"),
      INNER_SIGNAL_FEEDBACK_PUBLIC_URL: "https://feedback.synthetic.example/feedback"
    }
  });
  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService, therapyProtocol: null, feedback });
  t.after(async () => { feedback.close(); await listener.close(); });
  const origin = listener.url.replace(/\/mcp$/u, "");
  const server = `${origin}/feedback`;
  const sendPage = async (fields) => {
    const html = await (await fetch(server)).text();
    clock += 3_000;
    const token = /name="form_token" value="([^"]+)"/u.exec(html)[1];
    const response = await fetch(server, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ form_token: token, extra: "", ...fields }).toString() });
    return /class="code">([0-9A-Z-]{19})</u.exec(await response.text())?.[1];
  };
  const sendChat = async (args) => {
    const response = await fetch(listener.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_feedback", arguments: { person_approved_exact_text: true, ...args } } }) });
    return (await response.json()).result.structuredContent;
  };
  return { base, configDir, root, run, keys, server, origin, sendPage, sendChat, advance: (ms) => { clock += ms; }, laptopAdvance: (ms) => { laptopNow += ms; } };
}

test("keygen writes private files, prints only the two server settings, and a second run adds a key", async (t) => {
  const w = await world(t);
  const keyFile = JSON.parse(await fs.readFile(path.join(w.configDir, "owner-keys.json"), "utf8"));
  const token = (await fs.readFile(path.join(w.configDir, "owner-token"), "utf8")).trim();
  for (const name of ["owner-keys.json", "owner-token"]) assert.equal((await fs.stat(path.join(w.configDir, name))).mode & 0o777, 0o600, name);
  assert.equal((await fs.stat(w.configDir)).mode & 0o777, 0o700);
  assert.equal(w.keys.includes(keyFile.keys[0].private_key), false, "the private key is never printed");
  assert.equal(w.keys.includes(token), false, "the token is never printed");
  const second = await w.run("keygen", "--server", w.server);
  const after = JSON.parse(await fs.readFile(path.join(w.configDir, "owner-keys.json"), "utf8"));
  assert.equal(after.keys.length, 2, "the old key is kept");
  assert.equal((await fs.readFile(path.join(w.configDir, "owner-token"), "utf8")).trim(), token, "the token is kept");
  assert.match(second, /INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256=[0-9a-f]{64}/u);
  assert.match(await w.run("status"), /Keys: [0-9a-f]{16}, [0-9a-f]{16}/u);
});

test("fetch writes an Inbox batch, prints counts only, holds chat messages for the hour, and moves on only when confirmed", async (t) => {
  const w = await world(t);
  await w.run("keygen", "--server", w.server);
  const pageCode = await w.sendPage({ kind: "bug", text: `It froze ${MARKER}`, reply_address: "reader@example.invalid" });
  await w.sendPage({ kind: "review", text: `Kind and clear ${MARKER}`, may_show_publicly: "yes" });
  const chat = await w.sendChat({ kind: "suggestion", text: `A dark mode ${MARKER}` });
  assert.ok(pageCode && chat.deletion_code);

  const out1 = path.join(w.base, "fetch-1");
  const report1 = await w.run("fetch", "--out", out1);
  assert.equal(report1.includes(MARKER), false, "counts only");
  assert.match(report1, /2 new \(1 bug, 1 review\), 1 review\(s\) waiting for a yes, 0 deletion\(s\), 1 held for the first hour/u);
  const plan1 = JSON.parse(await fs.readFile(path.join(out1, "plan.json"), "utf8"));
  const sets = plan1.batches.flat().filter((entry) => entry.op === "set");
  assert.equal(sets.length, 2);
  const docs = await Promise.all(sets.map(async (entry) => JSON.parse(await fs.readFile(entry.file_path, "utf8"))));
  assert.deepEqual(docs.map((doc) => doc.kind).sort(), ["bug", "review"]);
  assert.ok(docs.some((doc) => doc.text === `It froze ${MARKER}` && doc.reply_address === "reader@example.invalid"));
  assert.equal((await fs.stat(sets[0].file_path)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(plan1).includes(MARKER), false, "the plan holds ids and paths, never words");

  // A finished batch that isn't confirmed is never removed by another fetch: it is confirmed or discarded explicitly.
  const out2 = path.join(w.base, "fetch-2");
  await assert.rejects(w.run("fetch", "--out", out2), /An earlier batch is waiting/u);
  assert.match(await w.run("fetch", "--discard", out1), /Discarded/u);
  await assert.rejects(fs.stat(out1), { code: "ENOENT" }, "the discarded folder is gone");
  assert.match(await w.run("fetch", "--out", out2), /2 new/u, "the same messages are read again");
  assert.match(await w.run("fetch", "--confirm", out2), /Confirmed/u);
  await assert.rejects(fs.stat(out2), { code: "ENOENT" });

  // After its hold (the full hour after one hour: here 11:00 for a 09:30 send) the chat message comes; a page deletion comes as a
  // removal.
  w.advance(2 * 3_600_000);
  await fetch(`${w.server}/delete`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: pageCode }).toString() });
  const out3 = path.join(w.base, "fetch-3");
  const report3 = await w.run("fetch", "--out", out3);
  assert.match(report3, /1 new \(1 suggestion\), 0 review\(s\) waiting for a yes, 1 deletion\(s\), 0 held/u);
  const plan3 = JSON.parse(await fs.readFile(path.join(out3, "plan.json"), "utf8"));
  assert.deepEqual(plan3.batches.flat().map((entry) => entry.op).sort(), ["delete", "set"]);
  await w.run("fetch", "--confirm", out3);
  const out4 = path.join(w.base, "fetch-4");
  assert.match(await w.run("fetch", "--out", out4), /0 new/u);
  await assert.rejects(w.run("fetch", "--confirm", path.join(w.base, "never")), /No unconfirmed fetch/u);
});

test("publish and delete need the owner's own choice in the Inbox export and the id typed back", async (t) => {
  const w = await world(t);
  await w.run("keygen", "--server", w.server);
  await w.sendPage({ kind: "review", text: "Plain and kind.", may_show_publicly: "yes" });
  await w.sendPage({ kind: "praise", text: "Thank you." });
  const out = path.join(w.base, "fetch");
  await w.run("fetch", "--out", out);
  const plan = JSON.parse(await fs.readFile(path.join(out, "plan.json"), "utf8"));
  const docs = await Promise.all(plan.batches.flat().map(async (entry) => JSON.parse(await fs.readFile(entry.file_path, "utf8"))));
  const review = docs.find((doc) => doc.kind === "review");
  const praise = docs.find((doc) => doc.kind === "praise");
  await w.run("fetch", "--confirm", out);

  const exportDir = path.join(w.base, "export");
  await fs.mkdir(path.join(exportDir, "choices"), { recursive: true });
  await assert.rejects(w.run("publish", review.id, "--export", exportDir, "--confirm", review.id), /no "Show publicly" choice/u);
  await fs.writeFile(path.join(exportDir, "choices", `feedback-${review.id}.json`), JSON.stringify({ at: "2026-11-22T10:00:00Z", choice: "publish" }));
  await assert.rejects(w.run("publish", review.id, "--export", exportDir, "--confirm", "wrong"), /--confirm/u);
  assert.match(await w.run("publish", review.id, "--export", exportDir, "--confirm", review.id), /Published/u);
  assert.match(await (await fetch(`${w.server}/reviews`)).text(), /Plain and kind\./u);

  await fs.writeFile(path.join(exportDir, "choices", `feedback-${praise.id}.json`), JSON.stringify({ at: "2026-11-22T10:00:00Z", choice: "publish" }));
  await assert.rejects(w.run("publish", praise.id, "--export", exportDir, "--confirm", praise.id), /not a review its sender let be shown/u);
  await assert.rejects(w.run("delete", praise.id, "--export", exportDir, "--confirm", praise.id), /no "Delete" choice/u);
  await fs.writeFile(path.join(exportDir, "choices", `feedback-${praise.id}.json`), JSON.stringify({ at: "2026-11-22T10:01:00Z", choice: "delete" }));
  assert.match(await w.run("delete", praise.id, "--export", exportDir, "--confirm", praise.id), /Deleted/u);
  assert.match(await w.run("unpublish", review.id, "--confirm", review.id), /Taken down/u);
  assert.doesNotMatch(await (await fetch(`${w.server}/reviews`)).text(), /Plain and kind\./u);
  await assert.rejects(w.run("delete-many", "--via", "chat", "--from", "2026-11-22", "--to", "2026-11-22", "--confirm", "yes"), /--confirm chat 2026-11-22 2026-11-22/u);
  assert.match(await w.run("delete-many", "--via", "chat", "--from", "2026-11-22", "--to", "2026-11-22", "--confirm", "chat 2026-11-22 2026-11-22"), /Deleted 0 chat/u);
});

test("a message no key opens is kept and tried again, and a fetch that fails leaves no folder behind", async (t) => {
  const w = await world(t);
  await w.run("keygen", "--server", w.server);
  await w.sendPage({ kind: "suggestion", text: `Needs the first key ${MARKER}` });
  // The key file without the key that sealed it (the first one): the message can't be opened.
  const keysPath = path.join(w.configDir, "owner-keys.json");
  const allKeys = JSON.parse(await fs.readFile(keysPath, "utf8"));
  await fs.writeFile(keysPath, JSON.stringify({ ...allKeys, keys: allKeys.keys.slice(1) }), { mode: 0o600 });
  const out1 = path.join(w.base, "f1");
  assert.match(await w.run("fetch", "--out", out1), /0 new.*\n1 message\(s\) could not be opened/su);
  await w.run("fetch", "--confirm", out1);
  // The key comes back: the next fetch, past the cursor, still brings the message.
  await fs.writeFile(keysPath, JSON.stringify(allKeys), { mode: 0o600 });
  const out2 = path.join(w.base, "f2");
  assert.match(await w.run("fetch", "--out", out2), /1 new \(1 suggestion\)/u);
  await w.run("fetch", "--confirm", out2);
  assert.doesNotMatch(await w.run("fetch", "--out", path.join(w.base, "f3")), /could not be opened/u);
  await w.run("fetch", "--confirm", path.join(w.base, "f3"));

  // The server refuses mid-fetch (a wrong token): the folder is removed and nothing is left pending.
  const tokenPath = path.join(w.configDir, "owner-token");
  const token = await fs.readFile(tokenPath, "utf8");
  await fs.writeFile(tokenPath, `${"A".repeat(43)}\n`, { mode: 0o600 });
  const out4 = path.join(w.base, "f4");
  await assert.rejects(w.run("fetch", "--out", out4), /The server refused events/u);
  await assert.rejects(fs.stat(out4), { code: "ENOENT" });
  assert.doesNotMatch(await w.run("status"), /unconfirmed fetch/u);
  await fs.writeFile(tokenPath, token, { mode: 0o600 });
});

test("one command at a time, an Inbox copy goes after a year even without a deletion record, and deleting twice is fine", async (t) => {
  const w = await world(t);
  await w.run("keygen", "--server", w.server);
  await w.sendPage({ kind: "praise", text: "Thank you." });
  const [first, second] = await Promise.allSettled([w.run("fetch", "--out", path.join(w.base, "c1")), w.run("fetch", "--out", path.join(w.base, "c2"))]);
  assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1, "only one runs");
  assert.match([first, second].find((result) => result.status === "rejected").reason.message, /Another feedback-inbox command is running/u);
  const done = first.status === "fulfilled" ? path.join(w.base, "c1") : path.join(w.base, "c2");
  const plan = JSON.parse(await fs.readFile(path.join(done, "plan.json"), "utf8"));
  const id = plan.batches.flat()[0].doc_id;
  await w.run("fetch", "--confirm", done);

  // A year on, with no record from the server, the laptop removes the Inbox copy itself.
  w.laptopAdvance(366 * 24 * 3_600_000);
  const late = path.join(w.base, "late");
  assert.match(await w.run("fetch", "--out", late), /1 Inbox cop\(ies\) past a year removed/u);
  const latePlan = JSON.parse(await fs.readFile(path.join(late, "plan.json"), "utf8"));
  assert.deepEqual(latePlan.batches.flat(), [{ op: "delete", collection: "feedback", doc_id: id }]);
  await w.run("fetch", "--confirm", late);

  // The owner deletes a message the sender already deleted: the Inbox write still comes.
  await w.sendPage({ kind: "bug", text: "Gone already." });
  const out = path.join(w.base, "again");
  await w.run("fetch", "--out", out);
  const docs = JSON.parse(await fs.readFile(path.join(out, "plan.json"), "utf8")).batches.flat();
  await w.run("fetch", "--confirm", out);
  const target = docs[0].doc_id;
  const exportDir = path.join(w.base, "export");
  await fs.mkdir(path.join(exportDir, "choices"), { recursive: true });
  await fs.writeFile(path.join(exportDir, "choices", `feedback-${target}.json`), JSON.stringify({ choice: "delete" }));
  assert.match(await w.run("delete", target, "--export", exportDir, "--confirm", target), /^Deleted/u);
  assert.match(await w.run("delete", target, "--export", exportDir, "--confirm", target), /^Already gone on the server: .*Inbox write:/su);
});

test("discarding a batch keeps the ids it held in the inventory, and a refused command leaves the lock free", async (t) => {
  const w = await world(t);
  await w.run("keygen", "--server", w.server);
  await w.sendPage({ kind: "praise", text: "Kept in the inventory." });
  const out = path.join(w.base, "d1");
  await w.run("fetch", "--out", out);
  const id = JSON.parse(await fs.readFile(path.join(out, "plan.json"), "utf8")).batches.flat()[0].doc_id;
  await w.run("fetch", "--discard", out);
  const state = JSON.parse(await fs.readFile(path.join(w.configDir, "state.json"), "utf8"));
  assert.deepEqual(Object.keys(state.imported), [id], "the id stays (ids and days only)");
  assert.equal(JSON.stringify(state).includes("Kept in the inventory"), false, "no words in the state");
  await assert.rejects(w.run("fetch", "--confirm", out), /No unconfirmed fetch/u);
  assert.match(await w.run("status"), /Cursor: 0/u, "the lock was freed after the refusal");
});
