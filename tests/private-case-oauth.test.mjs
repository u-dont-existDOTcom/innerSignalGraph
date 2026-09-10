import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createPrivateCaseMcpServer, listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createJwtPrivateCaseAuthorizationProvider, createManagedSecretCaseKeyProvider } from "../src/storage/hosted-private-case-providers.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";

const CASE_ID = "synthetic-oauth-case";
const SUBJECT = "owner-subject-001";
const ISSUER = "https://identity.synthetic.example";
const RESOURCE = "https://private-mcp.synthetic.example";
const PRIVATE_MARKER = "synthetic-private-oauth-evidence-π";

async function makeEnvironment(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-oauth-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const routineKek = randomBytes(32);
  const recoverySecretBytes = randomBytes(32);
  const seed = createEncryptedPrivateCaseStore({
    rootDir: directory,
    routineKek,
    recoverySecretBytes,
    developmentExternalCredentialAuthorized: true
  });
  await seed.saveCaseState(CASE_ID, createEmptyCaseState({ caseId: CASE_ID }));
  await seed.appendTranscriptTurn(CASE_ID, {
    id: "oauth-evidence-user",
    exchange_id: "oauth-evidence",
    role: "user",
    text: PRIVATE_MARKER,
    at: "2026-09-10T00:00:00.000Z",
    episode_id: null
  });
  seed.close();

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "synthetic-key-1";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  const grants = [{ subject: SUBJECT, case_ids: [CASE_ID], scopes: ["case:read", "case:audit"] }];
  const authorizationProvider = createJwtPrivateCaseAuthorizationProvider({ issuer: ISSUER, audience: RESOURCE, jwks: { keys: [publicJwk] }, grants });
  const keyProvider = createManagedSecretCaseKeyProvider({
    caseKeys: {
      [CASE_ID]: {
        routine_kek_base64: routineKek.toString("base64"),
        recovery_secret_base64: recoverySecretBytes.toString("base64")
      }
    }
  });
  routineKek.fill(0);
  recoverySecretBytes.fill(0);
  t.after(() => keyProvider.close());
  const service = createPrivateCaseAccessService({ rootDir: directory, authorizationProvider, keyProvider });
  const token = await new SignJWT({ scope: "case:read case:audit" })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-key-1" })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE)
    .setSubject(SUBJECT)
    .setJti("synthetic-jti-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { service, token, privateKey };
}

async function rpc(url, name, args, token = null) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  });
  return { response, body: await response.json() };
}

test("hosted OAuth metadata, per-tool schemes, JWT verification, case ACL, and managed key release work together", async (t) => {
  const environment = await makeEnvironment(t);
  const listener = await listenPrivateCaseMcp({
    caseAccessService: environment.service,
    oauth: { resource: RESOURCE, authorizationServers: [ISSUER], scopesSupported: ["case:read", "case:audit"] },
    productionAuthReady: true
  });
  t.after(() => listener.close());

  const metadata = await fetch(listener.url.replace(/\/mcp$/u, "/.well-known/oauth-protected-resource"));
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: ["case:read", "case:audit"]
  });

  const listed = await fetch(listener.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  const tools = (await listed.json()).result.tools;
  assert.deepEqual(tools.find((tool) => tool.name === "load_handoff").securitySchemes[0], { type: "oauth2", scopes: ["case:read", "case:audit"] });

  const missing = await rpc(listener.url, "retrieve_case_evidence", { case_id: CASE_ID, query: "oauth" });
  assert.equal(missing.response.status, 401);
  assert.match(missing.response.headers.get("www-authenticate"), /oauth-protected-resource/);
  assert.match(missing.body.result._meta["mcp/www_authenticate"][0], /error="invalid_token"/);
  assert.equal(JSON.stringify(missing.body).includes(PRIVATE_MARKER), false);

  const allowed = await rpc(listener.url, "retrieve_case_evidence", { case_id: CASE_ID, query: "oauth" }, environment.token);
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.result.structuredContent.turns[0].text, PRIVATE_MARKER);

  const wrongSubjectToken = await new SignJWT({ scope: "case:read case:audit" })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-key-1" })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE)
    .setSubject("not-in-case-acl")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(environment.privateKey);
  const denied = await rpc(listener.url, "retrieve_case_evidence", { case_id: CASE_ID, query: "oauth" }, wrongSubjectToken);
  assert.equal(denied.response.status, 401);
  assert.match(denied.body.result._meta["mcp/www_authenticate"][0], /error="insufficient_scope"/);
  assert.equal(JSON.stringify(denied.body).includes(PRIVATE_MARKER), false);

  const wrongAudienceToken = await new SignJWT({ scope: "case:read case:audit" })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-key-1" })
    .setIssuer(ISSUER)
    .setAudience("https://wrong-resource.synthetic.example")
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(environment.privateKey);
  const wrongAudience = await rpc(listener.url, "retrieve_case_evidence", { case_id: CASE_ID, query: "oauth" }, wrongAudienceToken);
  assert.equal(wrongAudience.response.status, 401);
  assert.equal(JSON.stringify(wrongAudience.body).includes(PRIVATE_MARKER), false);
});

test("production-ready server configuration cannot omit OAuth discovery", () => {
  const caseAccessService = { loadCaseContext() {} };
  assert.throws(() => createPrivateCaseMcpServer({ caseAccessService, productionAuthReady: true }), /requires OAuth metadata/);
});
