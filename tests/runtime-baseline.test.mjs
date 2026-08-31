import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { evaluateNodeRuntime } from "../src/release/runtime-requirements.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recommendedNode = "24.18.0";
const supportedNodeRange = ">=24 <25";
const supportedNpm = "11.16.0";

async function read(relative) {
  return await fs.readFile(path.join(root, relative), "utf8");
}

test("repository metadata separates the recommended Node patch from the supported major range", async () => {
  const nvmrc = (await read(".nvmrc")).trim();
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(nvmrc, recommendedNode);
  assert.equal(packageJson.engines?.node, supportedNodeRange);
  assert.equal(packageJson.packageManager, `npm@${supportedNpm}`);

  const lock = JSON.parse(await read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages?.[""]?.engines?.node, supportedNodeRange);
});

test("installer and local automation use the centralized Node-major validator", async () => {
  for (const relative of ["packaging/install-from-git.sh", "scripts/auto-cli.sh"]) {
    const source = await read(relative);
    assert.match(source, /src\/cli\/check-runtime-requirements\.mjs" --quiet/);
    assert.doesNotMatch(source, /SUPPORTED_NODE_VERSION|process\.versions\.node/);
  }
});

test("Node 24 patches are accepted while adjacent majors fail before local runtime state exists", async (t) => {
  assert.equal(evaluateNodeRuntime("24.18.1").ok, true);

  for (const nodeVersion of ["23.99.0", "25.0.0"]) {
    await t.test(nodeVersion, async (t) => {
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-node-range-"));
      t.after(() => fs.rm(fixture, { recursive: true, force: true }));
      await fs.mkdir(path.join(fixture, "scripts"), { recursive: true });
      await fs.copyFile(path.join(root, "scripts", "auto-cli.sh"), path.join(fixture, "scripts", "auto-cli.sh"));
      await fs.copyFile(path.join(root, ".env.cli.example"), path.join(fixture, ".env.cli.example"));
      const bin = path.join(fixture, "bin");
      await fs.mkdir(bin, { recursive: true });
      await fs.writeFile(path.join(bin, "node"), `#!/usr/bin/env bash
set -eu
if [[ "$*" == *"src/cli/check-runtime-requirements.mjs"* ]]; then
  printf 'BLOCKED: Node.js >=24 <25 is required; found %s. Recommended patch: 24.18.0.\n' "$INNER_SIGNAL_TEST_NODE_VERSION" >&2
  exit 1
fi
exit 97
`, { mode: 0o755 });
      await fs.writeFile(path.join(bin, "npm"), "#!/usr/bin/env bash\nexit 97\n", { mode: 0o755 });

      await assert.rejects(
        execFileAsync("bash", [path.join(fixture, "scripts", "auto-cli.sh"), "--no-h001"], {
          cwd: fixture,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            INNER_SIGNAL_TEST_NODE_VERSION: nodeVersion
          }
        }),
        (error) => {
          assert.match(error.stderr, new RegExp(`Node\\.js >=24 <25 is required; found ${nodeVersion.replaceAll(".", "\\.")}`));
          return true;
        }
      );
      await assert.rejects(fs.access(path.join(fixture, ".env")));
      await assert.rejects(fs.access(path.join(fixture, "runs")));
    });
  }
});

test("GitHub Actions resolves the supported runtime through .nvmrc", async () => {
  for (const relative of [
    ".github/workflows/verify.yml",
    ".github/workflows/repository-workflow-policy.yml"
  ]) {
    assert.match(await read(relative), /node-version-file:\s*\.nvmrc/, relative);
  }
});
