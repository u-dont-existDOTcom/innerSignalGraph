import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { createPrivateCaseMcpServer, listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { NATIVE_BRIDGE_TOOL_DEFINITIONS } from "../src/server/private-case-chatgpt-app.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";

const CASE_ID = "synthetic-native-bridge";
const RESOURCE = "https://private-mcp.synthetic.example";
const UI_RESOURCE_URI = "ui://inner-signal/controlled-turn-v1.html";
const ORIGINAL_READ_ONLY_TOOLS = [
  "load_handoff",
  "load_case_context",
  "get_state_diff",
  "get_recent_verbatim",
  "retrieve_case_evidence",
  "get_pending_candidate",
  "get_tracker_window",
  "get_journal_entries",
  "get_candidate_response",
  "get_source_artifact"
];

async function rpc(url, method, params = {}, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function makeEnvironment(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-native-bridge-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const routineKek = randomBytes(32);
  const recoverySecretBytes = randomBytes(32);
  const seed = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.from(routineKek),
    recoverySecretBytes: Buffer.from(recoverySecretBytes),
    managedSecretAuthorized: true,
    now: () => "2026-09-18T03:20:00.000Z"
  });
  await seed.loadOrCreate(CASE_ID);
  seed.close();

  let keyRequests = 0;
  const grants = new Map([
    ["owner-all-scopes", ["case:read", "case:write", "case:audit"]],
    ["owner-no-audit", ["case:read", "case:write"]],
    ["owner-read-only", ["case:read"]]
  ]);
  const authorizationProvider = {
    async authorize({ caseId, authContext, requiredScope }) {
      const scopes = grants.get(authContext?.bearerToken) ?? [];
      return caseId === CASE_ID && scopes.includes(requiredScope)
        ? { allowed: true, principalId: "owner", scopes, grantEpoch: "synthetic-epoch" }
        : { allowed: false };
    }
  };
  const keyProvider = {
    async getCaseKeyMaterial() {
      keyRequests += 1;
      return {
        routineKek: Buffer.from(routineKek),
        recoverySecretBytes: Buffer.from(recoverySecretBytes),
        accessAssurance: "managed_secret_provider",
        managedSecretProvider: true
      };
    }
  };
  const service = createPrivateCaseAccessService({
    rootDir,
    authorizationProvider,
    keyProvider,
    now: () => "2026-09-18T03:20:00.000Z"
  });
  const listener = await listenPrivateCaseMcp({
    caseAccessService: service,
    oauth: {
      resource: RESOURCE,
      authorizationServers: ["https://identity.synthetic.example"],
      scopesSupported: ["case:read", "case:write", "case:audit"]
    },
    productionAuthReady: true
  });
  t.after(() => listener.close());
  t.after(() => {
    routineKek.fill(0);
    recoverySecretBytes.fill(0);
  });
  return { listener, service, keyRequests: () => keyRequests };
}

test("native bridge input and structured-output schemas compile strictly", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const tool of NATIVE_BRIDGE_TOOL_DEFINITIONS) {
    assert.doesNotThrow(() => ajv.compile(tool.inputSchema), `${tool.name} input schema must compile`);
    assert.doesNotThrow(() => ajv.compile(tool.outputSchema), `${tool.name} output schema must compile`);
  }
});

test("MCP app bridge preserves the incumbent tools and publishes a minimal inline resource", async (t) => {
  const { listener } = await makeEnvironment(t);
  const initialized = await rpc(listener.url, "initialize", {});
  assert.deepEqual(initialized.body.result.capabilities.resources, { listChanged: false });

  const listed = await rpc(listener.url, "tools/list", {});
  const tools = listed.body.result.tools;
  assert.deepEqual(tools.slice(0, ORIGINAL_READ_ONLY_TOOLS.length).map((tool) => tool.name), ORIGINAL_READ_ONLY_TOOLS);
  const openTool = tools.find((tool) => tool.name === "open_controlled_case_turn");
  assert.equal(openTool._meta.ui.resourceUri, UI_RESOURCE_URI);
  assert.deepEqual(openTool._meta.ui.visibility, ["model", "app"]);
  assert.equal(openTool.outputSchema.properties.profile.const, "native_controlled");
  assert.deepEqual(openTool._meta.securitySchemes, openTool.securitySchemes);
  assert.deepEqual(tools.find((tool) => tool.name === "prepare_controlled_case_turn")._meta.ui.visibility, ["app"]);
  assert.deepEqual(tools.find((tool) => tool.name === "submit_native_candidate").securitySchemes[0].scopes, ["case:read", "case:write"]);

  const resources = await rpc(listener.url, "resources/list", {});
  assert.equal(resources.body.result.resources[0].uri, UI_RESOURCE_URI);
  const resource = await rpc(listener.url, "resources/read", { uri: UI_RESOURCE_URI });
  const content = resource.body.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.equal(content._meta.ui.domain, new URL(RESOURCE).origin);
  assert.equal(content._meta["openai/widgetDomain"], new URL(RESOURCE).origin);
  assert.match(content.text, /Controlled case turn/u);
  assert.match(content.text, /tools\/call/u);
  assert.match(content.text, /ui\/message/u);
  assert.match(content.text, /window\.openai\?\.callTool/u);
  assert.match(content.text, /textContent/u);
  assert.doesNotMatch(content.text, /innerHTML/u);
});

test("native bridge binds exact input, host-correlated provenance, pending review, and artifact acknowledgements", async (t) => {
  const environment = await makeEnvironment(t);
  const exactInput = "Louka said this exactly — café.\nKeep both lines.";

  const keyRequestsBeforeDenial = environment.keyRequests();
  const denied = await rpc(environment.listener.url, "tools/call", {
    name: "prepare_controlled_case_turn",
    arguments: { case_id: CASE_ID, idempotency_key: "native-input-1", original_text: exactInput }
  }, "owner-read-only");
  assert.equal(denied.response.status, 401);
  assert.equal(environment.keyRequests(), keyRequestsBeforeDenial, "ACL denial must happen before key release");

  const prepared = await rpc(environment.listener.url, "tools/call", {
    name: "prepare_controlled_case_turn",
    arguments: { case_id: CASE_ID, idempotency_key: "native-input-1", original_text: exactInput }
  }, "owner-all-scopes");
  assert.equal(prepared.response.status, 200);
  assert.equal(prepared.body.result.structuredContent.status, "READY_FOR_DRAFT");
  assert.equal(prepared.body.result.structuredContent.profile, "native_controlled");
  const runtimeTurnId = prepared.body.result.structuredContent.runtime_turn_id;

  const duplicate = await rpc(environment.listener.url, "tools/call", {
    name: "prepare_controlled_case_turn",
    arguments: { case_id: CASE_ID, idempotency_key: "native-input-1", original_text: exactInput }
  }, "owner-all-scopes");
  assert.equal(duplicate.body.result.structuredContent.runtime_turn_id, runtimeTurnId);
  assert.equal(duplicate.body.result.structuredContent.status, "READY_FOR_DRAFT");

  const context = await rpc(environment.listener.url, "tools/call", {
    name: "get_controlled_turn_context",
    arguments: { case_id: CASE_ID, runtime_turn_id: runtimeTurnId }
  }, "owner-all-scopes");
  assert.equal(context.body.result.structuredContent.original_text, exactInput);
  assert.equal(context.body.result.structuredContent.profile, "native_controlled");

  const missingHostContext = await rpc(environment.listener.url, "tools/call", {
    name: "submit_native_candidate",
    arguments: {
      case_id: CASE_ID,
      runtime_turn_id: runtimeTurnId,
      exact_text: "Exact draft — not reviewed.",
      language: "en",
      context_use: { source_ids: [], open_discriminators: [] }
    }
  }, "owner-all-scopes");
  assert.equal(missingHostContext.response.status, 422);
  assert.equal(missingHostContext.body.error.data.code, "NATIVE_PRODUCER_CONTEXT_UNAVAILABLE");

  const submitted = await rpc(environment.listener.url, "tools/call", {
    name: "submit_native_candidate",
    arguments: {
      case_id: CASE_ID,
      runtime_turn_id: runtimeTurnId,
      exact_text: "Exact draft — not reviewed.",
      language: "en",
      context_use: { source_ids: [], open_discriminators: [] }
    },
    _meta: { "openai/session": "synthetic-chat-session-9" }
  }, "owner-all-scopes");
  assert.equal(submitted.body.result.structuredContent.status, "DRAFT_PENDING_REVIEW");
  assert.equal(submitted.body.result.structuredContent.independent_review_completed, false);

  const keyRequestsBeforeAuditDenial = environment.keyRequests();
  const deniedArtifact = await rpc(environment.listener.url, "tools/call", {
    name: "get_controlled_reply_artifact",
    arguments: { case_id: CASE_ID, runtime_turn_id: runtimeTurnId }
  }, "owner-no-audit");
  assert.equal(deniedArtifact.response.status, 401);
  assert.equal(environment.keyRequests(), keyRequestsBeforeAuditDenial, "audit-scope denial must happen before key release");

  const artifact = await rpc(environment.listener.url, "tools/call", {
    name: "get_controlled_reply_artifact",
    arguments: { case_id: CASE_ID, runtime_turn_id: runtimeTurnId }
  }, "owner-all-scopes");
  assert.equal(artifact.body.result.structuredContent.status, "DRAFT_PENDING_REVIEW");
  assert.equal(artifact.body.result.structuredContent.exact_text, "Exact draft — not reviewed.");
  assert.equal(artifact.body.result.structuredContent.externally_delivered, false);

  const acknowledged = await rpc(environment.listener.url, "tools/call", {
    name: "acknowledge_controlled_reply",
    arguments: {
      case_id: CASE_ID,
      runtime_turn_id: runtimeTurnId,
      interaction_id: "interaction:synthetic:copied:1",
      interaction_kind: "copied",
      artifact_sha256: artifact.body.result.structuredContent.sha256
    }
  }, "owner-all-scopes");
  assert.equal(acknowledged.body.result.structuredContent.acknowledgements.copied, true);
  assert.equal(acknowledged.body.result.structuredContent.acknowledgements.operator_reported_sent, false);
  assert.equal(acknowledged.body.result.structuredContent.acknowledgements.external_delivery_confirmed, false);

  const status = await rpc(environment.listener.url, "tools/call", {
    name: "get_controlled_turn_status",
    arguments: { case_id: CASE_ID, runtime_turn_id: runtimeTurnId }
  }, "owner-all-scopes");
  assert.equal(status.body.result.structuredContent.status, "DRAFT_PENDING_REVIEW");
  assert.equal(status.body.result.structuredContent.acknowledgements.copied, true);

  const record = await environment.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: "owner-all-scopes" });
  assert.equal(record.runtime_turns[0].inbound.exact_text, exactInput);
  assert.equal(record.runtime_turns[0].inbound.idempotency_key, "native-input-1");
  assert.equal(record.candidate_responses[0].producer_context_id.startsWith("chatgpt-session:"), true);
  assert.equal(record.candidate_responses[0].metadata.producer_interface, "native_chatgpt");
  assert.equal(record.candidate_responses[0].status, "pending_audit");
});
