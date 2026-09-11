import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadPrivateRuntimeAccessFromEnvironment } from "../src/storage/private-runtime-environment.mjs";

const CASE_ID = "synthetic-environment-case";

test("unconfigured startup does not invent a plaintext or implicit private store", async () => {
  assert.equal(await loadPrivateRuntimeAccessFromEnvironment({}), null);
});

test("local runtime loads an external encrypted mutation boundary with a transport token", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runtime-environment-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const vaultRoot = path.join(root, "vaults");
  const credentialsPath = path.join(root, "credentials.json");
  const token = "synthetic-transport-token";
  const credentials = {
    schema_version: 1,
    root_dir: vaultRoot,
    grants: [{
      token_sha256: createHash("sha256").update(token).digest("hex"),
      principal_id: "synthetic-runtime-owner",
      case_ids: [CASE_ID],
      scopes: ["case:read", "case:write", "case:audit"]
    }],
    case_keys: {
      [CASE_ID]: {
        routine_kek_base64: Buffer.alloc(32, 31).toString("base64"),
        recovery_secret_base64: Buffer.alloc(32, 32).toString("base64")
      }
    }
  };
  await fs.writeFile(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  const runtime = await loadPrivateRuntimeAccessFromEnvironment({
    INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: credentialsPath,
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: token
  });
  t.after(() => runtime.close());
  assert.equal(runtime.productionReady, false);
  assert.equal(runtime.mode, "development");
  await runtime.privateCaseAccessService.beginPrivateRuntimeTurn(CASE_ID, {
    runtimeTurnId: "runtime:synthetic:environment",
    exchangeId: "exchange:synthetic:environment",
    userTurnId: "turn:synthetic:environment:user",
    exactText: "Synthetic private intake."
  }, runtime.privateAuthContext);
  const loaded = await runtime.privateCaseAccessService.loadPrivateRuntimeCase(CASE_ID, runtime.privateAuthContext);
  assert.equal(loaded.runtime_turns[0].inbound.exact_text, "Synthetic private intake.");
  assert.doesNotMatch(await fs.readFile(path.join(vaultRoot, `${CASE_ID}.vault.json`), "utf8"), /Synthetic private intake/u);
});

test("local runtime fails closed when its transport token is absent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runtime-no-token-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const credentialsPath = path.join(root, "credentials.json");
  await fs.writeFile(credentialsPath, JSON.stringify({
    schema_version: 1,
    root_dir: path.join(root, "vaults"),
    grants: [{ token_sha256: "a".repeat(64), principal_id: "synthetic", case_ids: [CASE_ID], scopes: ["case:read"] }],
    case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 1).toString("base64"), recovery_secret_base64: Buffer.alloc(32, 2).toString("base64") } }
  }), { mode: 0o600 });
  await assert.rejects(() => loadPrivateRuntimeAccessFromEnvironment({
    INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: credentialsPath
  }), (error) => error.code === "BAD_CONFIG");
});
