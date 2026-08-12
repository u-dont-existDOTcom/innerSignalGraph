import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { prepareRuntimeEnvironment } from "../autopilot/prepare-environment.mjs";

const quiet = process.argv.includes("--quiet");
const result = await prepareRuntimeEnvironment({
  envPath: path.join(projectRoot, ".env"),
  defaultsPath: path.join(projectRoot, ".env.cli.example")
});

if (!quiet) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.changed) {
  const backup = result.backupPath ? ` Backup: ${result.backupPath}` : "";
  console.error(`Prepared local CLI environment; repaired: ${result.changedKeys.join(", ")}.${backup}`);
}
