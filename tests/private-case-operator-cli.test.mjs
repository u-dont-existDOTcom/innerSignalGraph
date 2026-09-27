import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src/cli/private-case-operations.mjs");
const CASE_ID = "synthetic-operator-cli-case";
const SUBJECT = "service-account-synthetic-journal-operator";
const ISSUER = "https://identity.synthetic.example/realms/inner-signal";
const AUDIENCE = "https://private-mcp.synthetic.example";

async function writePrivateJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

test("one-shot hosted operator uses its separate ACL, pinned JWKS and writer lock", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-operator-cli-"));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const routineKek = Buffer.alloc(32, 101);
  const recoverySecretBytes = Buffer.alloc(32, 102);
  const seed = createEncryptedPrivateCaseStore({
    rootDir: directory,
    routineKek,
    recoverySecretBytes,
    developmentExternalCredentialAuthorized: true
  });
  await seed.saveCaseState(CASE_ID, createEmptyCaseState({ caseId: CASE_ID }));
  seed.close();

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "synthetic-operator-key", use: "sig", alg: "RS256" });
  const token = await new SignJWT({ scope: "case:write" })
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const environment = {
    PATH: process.env.PATH,
    INNER_SIGNAL_PRIVATE_ROOT: directory,
    INNER_SIGNAL_OAUTH_ISSUER: ISSUER,
    INNER_SIGNAL_OAUTH_AUDIENCE: AUDIENCE,
    INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
    INNER_SIGNAL_OPERATOR_CASE_ACL_JSON: JSON.stringify([{
      subject: SUBJECT,
      case_ids: [CASE_ID],
      scopes: ["case:write"],
      purposes: ["archive", "organize_search", "session_use"]
    }]),
    INNER_SIGNAL_CASE_ACL_JSON: JSON.stringify([{
      subject: "chatgpt-read-only-subject",
      case_ids: [CASE_ID],
      scopes: ["case:read", "case:audit"]
    }]),
    INNER_SIGNAL_CASE_KEYS_JSON: JSON.stringify({
      [CASE_ID]: {
        routine_kek_base64: routineKek.toString("base64"),
        recovery_secret_base64: recoverySecretBytes.toString("base64")
      }
    }),
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: token
  };

  const probePath = path.join(directory, "probe.json");
  const probeReceiptPath = path.join(directory, "probe-receipt.json");
  await writePrivateJson(probePath, { schema_version: 1, operation: "probe_journal_write", case_id: CASE_ID, purpose: "archive" });
  await execFileAsync(process.execPath, [cli, "--hosted-operator-env", "--request", probePath, "--receipt", probeReceiptPath], { cwd: root, env: environment });
  const probe = JSON.parse(await fs.readFile(probeReceiptPath, "utf8"));
  assert.equal(probe.required_scope, "case:write");
  assert.equal(probe.required_purpose, "archive");
  assert.equal(probe.mutation_performed, false);

  const createPath = path.join(directory, "create.json");
  const createReceiptPath = path.join(directory, "create-receipt.json");
  await writePrivateJson(createPath, {
    schema_version: 1,
    operation: "create_journal_corpus",
    case_id: CASE_ID,
    corpus_id: "corpus:synthetic:operator-cli",
    manifest_object_id: "manifest:synthetic:operator-cli:staging"
  });
  await execFileAsync(process.execPath, [cli, "--hosted-operator-env", "--request", createPath, "--receipt", createReceiptPath], { cwd: root, env: environment });
  const created = JSON.parse(await fs.readFile(createReceiptPath, "utf8"));
  assert.equal(created.corpus_id, "corpus:synthetic:operator-cli");
  assert.equal(created.active_generation, null);
  assert.equal((await fs.stat(createReceiptPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(directory, ".journal-writer.lock"))).mode & 0o777, 0o600);
});
