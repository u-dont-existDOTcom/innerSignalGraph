import fs from "node:fs/promises";
import path from "node:path";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../storage/private-case-access.mjs";
import { listenPrivateCaseMcp } from "../server/private-case-mcp.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const credentials = valueAfter("--credentials");
if (!credentials) throw new Error("Usage: node src/cli/private-case-mcp.mjs --credentials /absolute/private-credentials.json [--port 0] [--ready-file /absolute/private-ready.json]");
const credentialsPath = path.resolve(credentials);
const portRaw = valueAfter("--port") ?? "0";
const port = Number.parseInt(portRaw, 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");

const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
const service = createPrivateCaseAccessService({
  rootDir: providers.rootDir,
  authorizationProvider: providers.authorizationProvider,
  keyProvider: providers.keyProvider,
  allowDevelopmentFileProvider: true
});
const listener = await listenPrivateCaseMcp({ caseAccessService: service, port });
const ready = {
  ready: true,
  mcpUrl: listener.url,
  provider: providers.kind,
  productionReady: providers.productionReady
};
const readyFile = valueAfter("--ready-file");
if (readyFile) await fs.writeFile(path.resolve(readyFile), `${JSON.stringify(ready)}\n`, { mode: 0o600 });
console.log(JSON.stringify(ready));

async function shutdown() {
  await listener.close();
  providers.close();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
