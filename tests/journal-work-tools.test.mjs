import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createJournalWorkTools } from "../src/server/journal-work-tools.mjs";
import { PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";

const CASE_ID = "synthetic-journal-case";
const WORK_ID = "job:synthetic-work-0001";
const RESOURCE = "https://private-mcp.synthetic.example";
const ISSUER = "https://identity.synthetic.example";
// Synthetic tokens: "full" may read and submit, "reader" may only read.
const TOKENS = Object.freeze({ full: ["case:read", "journal:submit"], reader: ["case:read"] });

const deniedService = Object.freeze({
  async loadCaseContext() { throw new PrivateCaseAccessDeniedError(); },
  async loadCaseContextByAlias() { throw new PrivateCaseAccessDeniedError(); },
  async authenticate() { return null; }
});

async function authorizeCase(caseId, authContext, scope) {
  const scopes = TOKENS[authContext?.bearerToken];
  if (caseId !== CASE_ID || !scopes?.includes(scope)) throw new PrivateCaseAccessDeniedError();
  return { principalId: `subject-${authContext.bearerToken}`, scopes };
}

function workEntry(overrides = {}) {
  return {
    schema_version: 1,
    work_id: WORK_ID,
    case_id: CASE_ID,
    role: "extractor",
    instruction: "Synthetic role instruction.",
    packet: { core_units: [{ unit_id: "u1", text: "A synthetic sentence." }] },
    output_schema_name: "synthetic-result",
    output_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:synthetic:result:1.0",
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: { items: { type: "array", items: { type: "string" } } }
    },
    expected_generation: "generation:synthetic",
    issued_at: "2026-09-27T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides
  };
}

async function setup(t, { oauth = null, withTools = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-work-tools-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exchange = createJournalWorkExchange({ root, secret: randomBytes(32).toString("base64") });
  const journalWork = withTools ? createJournalWorkTools({ exchange, caseId: CASE_ID, authorizeCase }) : null;
  const listener = await listenPrivateCaseMcp({ caseAccessService: deniedService, oauth, journalWork });
  t.after(() => listener.close());
  return { exchange, url: listener.url };
}

async function rpc(url, method, params = {}, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { status: response.status, body: await response.json() };
}

const call = (url, name, args, token) => rpc(url, "tools/call", { name, arguments: args }, token);

async function challengeFor(url, name, args) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  });
  await response.json();
  return { status: response.status, challenge: response.headers.get("www-authenticate") };
}

test("sign-in challenges ask only for the called tool's scopes", async (t) => {
  const { exchange, url } = await setup(t, { oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit", "journal:submit"] } });
  await exchange.publishWork(workEntry());
  const ordinary = await challengeFor(url, "load_case_context", { case_id: CASE_ID });
  assert.equal(ordinary.status, 401);
  assert.match(ordinary.challenge, /scope="case:read case:audit"/u);
  const submit = await challengeFor(url, "submit_journal_work_result", { work_id: WORK_ID, output: { items: [] } });
  assert.equal(submit.status, 401);
  assert.match(submit.challenge, /scope="case:read journal:submit"/u);
  const packet = await challengeFor(url, "get_journal_work_packet", { work_id: WORK_ID });
  assert.match(packet.challenge, /scope="case:read journal:submit"/u);
});

test("journal work tools are advertised only when configured, with narrow scopes", async (t) => {
  const plain = await setup(t, { withTools: false });
  const plainTools = (await rpc(plain.url, "tools/list")).body.result.tools.map((tool) => tool.name);
  assert.ok(!plainTools.includes("get_journal_work_packet"));
  const plainInit = (await rpc(plain.url, "initialize")).body.result.instructions;
  assert.match(plainInit, /The private case tools are read-only\. Authorization/u);
  assert.doesNotMatch(plainInit, /journal/u);

  const { url } = await setup(t, { oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit", "journal:submit"] } });
  const tools = (await rpc(url, "tools/list")).body.result.tools;
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(byName.get_journal_work_packet.securitySchemes, [{ type: "oauth2", scopes: ["case:read"] }]);
  assert.deepEqual(byName.submit_journal_work_result.securitySchemes, [{ type: "oauth2", scopes: ["journal:submit"] }]);
  assert.equal(byName.get_journal_work_packet.annotations.readOnlyHint, true);
  assert.equal(byName.submit_journal_work_result.annotations.readOnlyHint, false);
  assert.match((await rpc(url, "initialize")).body.result.instructions, /except submit_journal_work_result/u);
});

test("a work item is served only to an authorized caller and only while it is outstanding", async (t) => {
  const { exchange, url } = await setup(t);
  await exchange.publishWork(workEntry());

  const anonymous = await call(url, "get_journal_work_packet", { work_id: WORK_ID });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.result.isError, true);

  const served = await call(url, "get_journal_work_packet", { work_id: WORK_ID }, "reader");
  assert.equal(served.status, 200);
  const packet = served.body.result.structuredContent;
  assert.equal(packet.status, "ready");
  assert.equal(packet.role, "extractor");
  assert.equal(packet.instruction, "Synthetic role instruction.");
  assert.deepEqual(packet.packet, workEntry().packet);
  assert.equal(packet.submit_with, "submit_journal_work_result");

  const missing = await call(url, "get_journal_work_packet", { work_id: "job:synthetic-work-9999" }, "reader");
  assert.equal(missing.body.result.isError, true);
  assert.equal(missing.body.result.structuredContent.code, "JOURNAL_WORK_NOT_FOUND");

  const malformed = await call(url, "get_journal_work_packet", { work_id: "../etc" }, "reader");
  assert.equal(malformed.body.result.structuredContent.code, "JOURNAL_WORK_ID_INVALID");

  await exchange.publishWork(workEntry({ work_id: "job:synthetic-expired", expires_at: "2026-09-27T00:00:01.000Z" }));
  const expired = await call(url, "get_journal_work_packet", { work_id: "job:synthetic-expired" }, "reader");
  assert.equal(expired.body.result.structuredContent.code, "JOURNAL_WORK_EXPIRED");

  await exchange.publishWork(workEntry({ work_id: "job:synthetic-other-case", case_id: "another-case" }));
  const otherCase = await call(url, "get_journal_work_packet", { work_id: "job:synthetic-other-case" }, "reader");
  assert.equal(otherCase.body.result.structuredContent.code, "JOURNAL_WORK_NOT_FOUND");
});

test("submissions are schema-checked so the model can fix them, and the first valid answer is kept", async (t) => {
  const { exchange, url } = await setup(t);
  await exchange.publishWork(workEntry());

  const readerOnly = await call(url, "submit_journal_work_result", { work_id: WORK_ID, output: { items: ["a"] } }, "reader");
  assert.equal(readerOnly.status, 401);

  const invalid = await call(url, "submit_journal_work_result", { work_id: WORK_ID, output: { items: [1], extra: true } }, "full");
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.result.isError, true);
  const problems = invalid.body.result.structuredContent;
  assert.equal(problems.code, "JOURNAL_OUTPUT_SCHEMA_INVALID");
  assert.ok(problems.errors.some((error) => error.keyword === "additionalProperties"));
  assert.ok(problems.errors.some((error) => error.instance_path === "/property/0" && error.keyword === "type"));
  assert.equal(await exchange.hasResult(WORK_ID), false);

  const stored = await call(url, "submit_journal_work_result", { work_id: WORK_ID, output: { items: ["a", "b"] } }, "full");
  assert.equal(stored.body.result.isError, false);
  assert.equal(stored.body.result.structuredContent.stored, true);
  assert.equal(stored.body.result.structuredContent.already, false);
  assert.equal(stored.body.result.structuredContent.message, "Stored. Reply only: done.");

  const again = await call(url, "submit_journal_work_result", { work_id: WORK_ID, output: { items: ["late"] } }, "full");
  assert.equal(again.body.result.structuredContent.already, true);

  const after = await call(url, "get_journal_work_packet", { work_id: WORK_ID }, "reader");
  assert.equal(after.body.result.structuredContent.status, "already_submitted");
  assert.equal(after.body.result.structuredContent.packet, undefined);

  const result = await exchange.readResult(WORK_ID);
  assert.deepEqual(result.output, { items: ["a", "b"] });
  assert.notEqual(result.receipt.subject_sha256, "subject-full");
});
