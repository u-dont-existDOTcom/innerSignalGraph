import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedNode = "24.18.0";
const supportedNpm = "11.16.0";

async function read(relative) {
  return await fs.readFile(path.join(root, relative), "utf8");
}

test("repository metadata pins one exact Node and npm toolchain", async () => {
  const nvmrc = (await read(".nvmrc")).trim();
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(nvmrc, supportedNode);
  assert.equal(packageJson.engines?.node, supportedNode);
  assert.equal(packageJson.packageManager, `npm@${supportedNpm}`);

  const lock = JSON.parse(await read("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages?.[""]?.engines?.node, supportedNode);
});

test("installer and local automation enforce the .nvmrc patch version", async () => {
  for (const relative of ["packaging/install-from-git.sh", "scripts/auto-cli.sh"]) {
    const source = await read(relative);
    assert.match(source, /\.nvmrc/);
    assert.match(source, /SUPPORTED_NODE_VERSION/);
    assert.doesNotMatch(source, /NODE_MAJOR/);
    assert.match(source, /Node\.js .* is required/);
  }
});

test("local automation rejects a different Node patch before creating runtime state", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-node-pin-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, "scripts"), { recursive: true });
  await fs.copyFile(path.join(root, "scripts", "auto-cli.sh"), path.join(fixture, "scripts", "auto-cli.sh"));
  await fs.copyFile(path.join(root, ".nvmrc"), path.join(fixture, ".nvmrc"));
  await fs.copyFile(path.join(root, ".env.cli.example"), path.join(fixture, ".env.cli.example"));
  const bin = path.join(fixture, "bin");
  await fs.mkdir(bin, { recursive: true });
  const fakeNode = path.join(bin, "node");
  await fs.writeFile(
    fakeNode,
    "#!/usr/bin/env bash\nset -eu\nif [[ \"$1\" == \"-p\" ]]; then printf '%s\\n' '24.18.1'; exit 0; fi\nexit 97\n",
    { mode: 0o755 }
  );

  await assert.rejects(
    execFileAsync("bash", [path.join(fixture, "scripts", "auto-cli.sh"), "--no-h001"], {
      cwd: fixture,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
    }),
    (error) => {
      assert.match(error.stderr, /Node\.js 24\.18\.0 is required; found v?24\.18\.1/);
      return true;
    }
  );
});

test("GitHub Actions resolves the supported runtime through .nvmrc", async () => {
  for (const relative of [
    ".github/workflows/verify.yml",
    ".github/workflows/repository-workflow-policy.yml"
  ]) {
    assert.match(await read(relative), /node-version-file:\s*\.nvmrc/, relative);
  }
});
