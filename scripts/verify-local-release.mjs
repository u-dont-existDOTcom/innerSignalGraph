import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalReleaseMatrix } from "../src/release/local-release-matrix.mjs";

if (process.argv.length !== 2) {
  console.error("Usage: node scripts/verify-local-release.mjs");
  process.exitCode = 2;
} else {
  const result = await runLocalReleaseMatrix();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.join(root, "tasks", "dev-r003-release-browser-matrix-20260831", "RESULTS.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
