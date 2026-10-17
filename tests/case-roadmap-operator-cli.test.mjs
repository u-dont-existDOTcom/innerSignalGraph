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

// Issue #172, change B: an authorized person records a case plan decision with the one-shot operator. Synthetic only.

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src/cli/private-case-operations.mjs");
const CASE_ID = "synthetic-roadmap-operator-case";
const SUBJECT = "service-account-synthetic-supervisor";
const ISSUER = "https://identity.synthetic.example/realms/inner-signal";
const AUDIENCE = "https://private-mcp.synthetic.example";
const DECISION = {
  decision_id: "plan-operator-1",
  source: "authorized_plan",
  at: "2026-10-18T10:00:00.000Z",
  evidence_refs: [],
  changes: [{ op: "add", goal: { id: "goal:synthetic-aim", kind: "primary_aim", title: "A synthetic aim that must not reach the receipt" } }]
};

async function writePrivateJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

test("the operator records a plan decision under the audit scope; the write scope alone is refused", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-roadmap-operator-"));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const routineKek = Buffer.alloc(32, 111);
  const recoverySecretBytes = Buffer.alloc(32, 112);
  const keys = { [CASE_ID]: { routine_kek_base64: routineKek.toString("base64"), recovery_secret_base64: recoverySecretBytes.toString("base64") } };
  const seed = createEncryptedPrivateCaseStore({ rootDir: directory, routineKek, recoverySecretBytes, developmentExternalCredentialAuthorized: true });
  await seed.saveCaseState(CASE_ID, createEmptyCaseState({ caseId: CASE_ID }));
  seed.close();

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "synthetic-supervisor-key", use: "sig", alg: "RS256" });
  const tokenWith = (scope) => new SignJWT({ scope }).setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(SUBJECT).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const environment = async (scope) => ({
    PATH: process.env.PATH,
    INNER_SIGNAL_PRIVATE_ROOT: directory,
    INNER_SIGNAL_OAUTH_ISSUER: ISSUER,
    INNER_SIGNAL_OAUTH_AUDIENCE: AUDIENCE,
    INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
    INNER_SIGNAL_OPERATOR_CASE_ACL_JSON: JSON.stringify([{ subject: SUBJECT, case_ids: [CASE_ID], scopes: [scope], purposes: [] }]),
    INNER_SIGNAL_CASE_ACL_JSON: JSON.stringify([{ subject: "chatgpt-read-only-subject", case_ids: [CASE_ID], scopes: ["case:read", "case:audit"] }]),
    INNER_SIGNAL_CASE_KEYS_JSON: JSON.stringify(keys),
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: await tokenWith(scope)
  });
  const requestPath = path.join(directory, "decision.json");
  await writePrivateJson(requestPath, { schema_version: 1, operation: "record_roadmap_decision", case_id: CASE_ID, decision: DECISION });

  const refusedReceipt = path.join(directory, "refused-receipt.json");
  const writeOnly = await environment("case:write");
  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, "--hosted-operator-env", "--request", requestPath, "--receipt", refusedReceipt], { cwd: root, env: writeOnly }),
    (error) => /Private case access was denied/u.test(error.stderr) && !error.stderr.includes("synthetic aim")
  );
  await assert.rejects(() => fs.stat(refusedReceipt), { code: "ENOENT" });

  const receiptPath = path.join(directory, "receipt.json");
  await execFileAsync(process.execPath, [cli, "--hosted-operator-env", "--request", requestPath, "--receipt", receiptPath], { cwd: root, env: await environment("case:audit") });
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  assert.deepEqual([receipt.operation_succeeded, receipt.case_id, receipt.decision_id, receipt.applied], [true, CASE_ID, "plan-operator-1", true]);
  assert.equal(JSON.stringify(receipt).includes("synthetic aim"), false, "the receipt holds no plan content");
  assert.equal((await fs.stat(receiptPath)).mode & 0o777, 0o600);

  const reader = createEncryptedPrivateCaseStore({ rootDir: directory, routineKek, recoverySecretBytes, developmentExternalCredentialAuthorized: true });
  t.after(() => reader.close());
  const state = await reader.getCaseState(CASE_ID);
  assert.deepEqual(state.roadmap.goals.map((goal) => [goal.id, goal.priority_source]), [["goal:synthetic-aim", "authorized_plan"]]);
});
