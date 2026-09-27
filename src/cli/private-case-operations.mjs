import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../storage/private-case-access.mjs";
import {
  loadHostedPrivateCaseOperatorProvidersFromEnvironment,
  loadHostedPrivateCaseProvidersFromEnvironment
} from "../storage/hosted-private-case-providers.mjs";
import { acquirePrivateRootWriterLock } from "../storage/shared-case-coordinator.mjs";
import { createPrivateCaseOrchestrator } from "../supervisor/private-case-orchestration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const outsideRepository = (candidate) => {
  const relative = path.relative(repositoryRoot, candidate);
  return relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative));
};

const hosted = process.argv.includes("--hosted-env");
const hostedOperator = process.argv.includes("--hosted-operator-env");
const credentials = valueAfter("--credentials");
const requestPath = path.resolve(valueAfter("--request") ?? "");
const receiptPath = path.resolve(valueAfter("--receipt") ?? "");
if ([hosted, hostedOperator, Boolean(credentials)].filter(Boolean).length !== 1 || !valueAfter("--request") || !valueAfter("--receipt")) {
  throw new Error("Usage: node src/cli/private-case-operations.mjs (--hosted-operator-env | --hosted-env | --credentials /absolute/private-credentials.json) --request /absolute/mode-0600-request.json --receipt /absolute/private-receipt.json");
}
if (!outsideRepository(requestPath) || !outsideRepository(receiptPath)) throw new Error("Private operation requests and receipts must remain outside the public repository.");

const request = await withOpenedRegularFile(requestPath, async (handle, info) => {
  if ((info.mode & 0o077) !== 0) throw new Error("Private operation request must have mode 0600 or stricter.");
  return JSON.parse(await handle.readFile("utf8"));
});
const providers = hostedOperator
  ? loadHostedPrivateCaseOperatorProvidersFromEnvironment()
  : hosted
    ? loadHostedPrivateCaseProvidersFromEnvironment()
  : await loadDevelopmentPrivateCaseProviders(path.resolve(credentials));
const service = createPrivateCaseAccessService({
  rootDir: providers.rootDir,
  authorizationProvider: providers.authorizationProvider,
  keyProvider: providers.keyProvider,
  allowDevelopmentFileProvider: !hosted
});
const token = process.env.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN;
if (typeof token !== "string" || !token) throw new Error("INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN is required and must not be passed on the command line.");
let writerLock = null;

try {
  // Every mode can change the vault, so every mode holds its writer lock: no operator write runs
  // under a running InnerSignal server, a journal publication or another operator.
  writerLock = await acquirePrivateRootWriterLock({ rootDir: providers.rootDir });
  const receipt = await createPrivateCaseOrchestrator({ caseAccessService: service }).execute(request, { bearerToken: token });
  const temporary = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, receiptPath);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  process.stdout.write(`${JSON.stringify({ operation_succeeded: true, receipt_path: receiptPath })}\n`);
} finally {
  await writerLock?.release();
  providers.close();
}
