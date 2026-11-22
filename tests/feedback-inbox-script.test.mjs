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
  const run = (...argv) => runFeedbackInbox([...argv, "--config-dir", configDir]);
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
  return { base, configDir, root, run, keys, server, origin, sendPage, sendChat, advance: (ms) => { clock += ms; } };
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

  // Not confirmed: the next fetch drops the folder and reads the same messages again.
  const out2 = path.join(w.base, "fetch-2");
  await w.run("fetch", "--out", out2);
  await assert.rejects(fs.stat(out1), { code: "ENOENT" }, "the unconfirmed folder is gone");
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
