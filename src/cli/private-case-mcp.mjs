import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_CASE_SCOPES, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../storage/private-case-access.mjs";
import { loadHostedPrivateCaseProvidersFromEnvironment } from "../storage/hosted-private-case-providers.mjs";
import { listenPrivateCaseMcp } from "../server/private-case-mcp.mjs";
import { assertJournalWorkExchangeRoot, createJournalWorkExchange, journalWorkExchangeSecret, resolveJournalWorkExchangeRoot } from "../journal-import/work-exchange.mjs";
import { createJournalPrivateApi } from "../journal-import/http.mjs";
import { createJournalWorkTools } from "../server/journal-work-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const hosted = process.argv.includes("--hosted-env");
const credentials = valueAfter("--credentials");
if (!hosted && !credentials) throw new Error("Usage: node src/cli/private-case-mcp.mjs (--hosted-env | --credentials /absolute/private-credentials.json) [--port 0] [--ready-file /absolute/private-ready.json]");
if (hosted && credentials) throw new Error("Choose exactly one provider mode: --hosted-env or --credentials.");
const portRaw = valueAfter("--port") ?? (hosted ? process.env.PORT : null) ?? "0";
const port = Number.parseInt(portRaw, 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");

const providers = hosted
  ? loadHostedPrivateCaseProvidersFromEnvironment()
  : await loadDevelopmentPrivateCaseProviders(path.resolve(credentials));
const service = createPrivateCaseAccessService({
  rootDir: providers.rootDir,
  authorizationProvider: providers.authorizationProvider,
  keyProvider: providers.keyProvider,
  allowDevelopmentFileProvider: !hosted
});
const resource = hosted ? process.env.INNER_SIGNAL_MCP_RESOURCE : null;
if (hosted && !resource) throw new Error("INNER_SIGNAL_MCP_RESOURCE is required in hosted mode.");

// Optional private journal work exchange (two connector tools). All three settings, or none.
const journalWorkSecretEnvironment = {
  INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64,
  INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE
};
const journalWorkSettings = [
  process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT,
  process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 || process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE,
  process.env.INNER_SIGNAL_JOURNAL_WORK_CASE_ID
].map((value) => value || null);
delete process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64;
const configuredJournalWork = journalWorkSettings.filter(Boolean).length;
if (configuredJournalWork !== 0 && configuredJournalWork !== 3) {
  throw new Error("Set INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 and INNER_SIGNAL_JOURNAL_WORK_CASE_ID together, or none of them.");
}
let journalWork = null;
if (configuredJournalWork === 3) {
  const [exchangeRoot, , journalCaseId] = journalWorkSettings;
  const exchangeSecret = await journalWorkExchangeSecret(journalWorkSecretEnvironment);
  if (!path.isAbsolute(exchangeRoot)) throw new Error("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT must be an absolute path.");
  // Canonical, so a symbolic link cannot place the exchange inside the public checkout.
  const canonicalRoot = await resolveJournalWorkExchangeRoot(exchangeRoot, { outside: repositoryRoot });
  // The exchange never creates its root: deployment does, owned by the user both processes run as.
  try {
    await assertJournalWorkExchangeRoot(canonicalRoot);
  } catch (error) {
    const problem = {
      JOURNAL_WORK_EXCHANGE_ROOT_MISSING: "must name an existing directory",
      JOURNAL_WORK_EXCHANGE_ROOT_INVALID: "must name a directory, not a file or a symbolic link",
      JOURNAL_WORK_EXCHANGE_ROOT_INSECURE: "must be owned by this process's user, have mode 0700, and sit in directories no other user can change"
    }[error?.code];
    if (!problem) throw error;
    throw new Error(`INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT ${problem}.`);
  }
  const exchange = createJournalWorkExchange({ root: canonicalRoot, secret: exchangeSecret });
  await exchange.removeStaleTemporaries();
  journalWork = createJournalWorkTools({
    exchange,
    caseId: journalCaseId,
    authorizeCase: (caseId, authContext, scope) => service.authorizeCase(caseId, authContext, scope)
  });
}

const listener = await listenPrivateCaseMcp({
  caseAccessService: service,
  journalApi: providers.journalEnabled ? createJournalPrivateApi({ caseAccessService: service }) : null,
  port,
  host: hosted ? "0.0.0.0" : "127.0.0.1",
  productionAuthReady: providers.productionReady,
  journalWork,
  oauth: hosted ? {
    resource,
    authorizationServers: [providers.oauth.issuer],
    scopesSupported: [...providers.oauth.scopesSupported, ...(journalWork ? [PRIVATE_CASE_SCOPES.JOURNAL_SUBMIT] : [])],
    resourceDocumentation: process.env.INNER_SIGNAL_RESOURCE_DOCUMENTATION || undefined
  } : null
});
const ready = {
  ready: true,
  mcpUrl: hosted ? new URL("/mcp", `${resource}/`).toString() : listener.url,
  provider: providers.kind,
  productionReady: providers.productionReady,
  journalEnabled: providers.journalEnabled === true,
  journalWork: Boolean(journalWork)
};
const readyFile = valueAfter("--ready-file");
if (readyFile) {
  const resolvedReadyFile = path.resolve(readyFile);
  const temporaryReadyFile = `${resolvedReadyFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryReadyFile, `${JSON.stringify(ready)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporaryReadyFile, resolvedReadyFile);
  } finally {
    await fs.unlink(temporaryReadyFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
console.log(JSON.stringify(ready));

async function shutdown() {
  await listener.close();
  providers.close();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
