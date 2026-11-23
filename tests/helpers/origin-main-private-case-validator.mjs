import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Export just the old source tree. This does not create a checkout or change Git state.
export async function originMainPrivateCaseModule(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-origin-main-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await promisify(execFile)("bash", ["-o", "pipefail", "-c", 'git archive origin/main src package.json | tar -x -C "$1"', "archive-main", directory], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), timeout: 15000
  });
  return import(pathToFileURL(path.join(directory, "src/storage/private-case-store.mjs")));
}

export async function originMainPrivateCaseValidator(t) {
  return (await originMainPrivateCaseModule(t)).validatePrivateCaseRecord;
}
