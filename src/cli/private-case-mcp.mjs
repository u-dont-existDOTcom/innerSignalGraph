import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../storage/private-case-access.mjs";
import { loadHostedPrivateCaseProvidersFromEnvironment } from "../storage/hosted-private-case-providers.mjs";
import { listenPrivateCaseMcp } from "../server/private-case-mcp.mjs";

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
const listener = await listenPrivateCaseMcp({
  caseAccessService: service,
  port,
  host: hosted ? "0.0.0.0" : "127.0.0.1",
  productionAuthReady: providers.productionReady,
  oauth: hosted ? {
    resource,
    authorizationServers: [providers.oauth.issuer],
    scopesSupported: providers.oauth.scopesSupported,
    resourceDocumentation: process.env.INNER_SIGNAL_RESOURCE_DOCUMENTATION || undefined
  } : null
});
const ready = {
  ready: true,
  mcpUrl: hosted ? new URL("/mcp", `${resource}/`).toString() : listener.url,
  provider: providers.kind,
  productionReady: providers.productionReady
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
