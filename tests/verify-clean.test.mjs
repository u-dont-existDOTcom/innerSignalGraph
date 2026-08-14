import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function executable(file, body) {
  await fs.writeFile(file, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`, { mode: 0o755 });
}

async function verifierFixture(t, packageBody) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-hermetic-verify-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.mkdir(path.join(root, "guide-graphs", "compiled"), { recursive: true });
  await fs.copyFile(path.join(projectRoot, "scripts", "verify-clean.sh"), path.join(root, "scripts", "verify-clean.sh"));
  await fs.writeFile(path.join(root, "H001-MOCK-RESULT.json"), "h001-original\n");
  await fs.writeFile(path.join(root, "guide-graphs", "compiled", "bundle.json"), "bundle-original\n");
  await fs.writeFile(path.join(root, "guide-graphs", "compiled", "inner-child-directed-graph.json"), "graph-original\n");
  await executable(path.join(root, "scripts", "verify-package.sh"), packageBody);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  return root;
}

async function runVerifier(root) {
  try {
    const result = await execFileAsync("bash", ["scripts/verify-clean.sh"], { cwd: root });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: Number(error.code),
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? "")
    };
  }
}

async function generated(root) {
  return {
    h001: await fs.readFile(path.join(root, "H001-MOCK-RESULT.json"), "utf8"),
    bundle: await fs.readFile(path.join(root, "guide-graphs", "compiled", "bundle.json"), "utf8")
  };
}

test("declared generated outputs are restored byte-for-byte", async (t) => {
  const root = await verifierFixture(t, `printf 'h001-generated\\n' > H001-MOCK-RESULT.json
printf 'bundle-generated\\n' > guide-graphs/compiled/bundle.json`);

  const result = await runVerifier(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(await generated(root), {
    h001: "h001-original\n",
    bundle: "bundle-original\n"
  });
});

test("an unexpected untracked verifier artifact fails and remains diagnosable", async (t) => {
  const root = await verifierFixture(t, "printf 'unexpected\\n' > unexpected-output.txt");

  const result = await runVerifier(root);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /unexpected-output\.txt/);
  assert.equal(await fs.readFile(path.join(root, "unexpected-output.txt"), "utf8"), "unexpected\n");
});

test("an unchanged pre-existing owner file is preserved without a false positive", async (t) => {
  const root = await verifierFixture(t, "printf 'generated\\n' > H001-MOCK-RESULT.json");
  await fs.writeFile(path.join(root, "owner-work.txt"), "preserve exactly\n");

  const result = await runVerifier(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(await fs.readFile(path.join(root, "owner-work.txt"), "utf8"), "preserve exactly\n");
  assert.equal((await generated(root)).h001, "h001-original\n");
});

test("a dirty generated graph retains its exact owner bytes", async (t) => {
  const relative = path.join("guide-graphs", "compiled", "inner-child-directed-graph.json");
  const root = await verifierFixture(t, `printf 'package-generated\\n' > ${relative}`);
  const file = path.join(root, relative);
  await fs.writeFile(file, "owner-uncommitted-bytes\n");

  const result = await runVerifier(root);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(await fs.readFile(file, "utf8"), "owner-uncommitted-bytes\n");
});

test("a failing package command retains its status after restoring generated outputs", async (t) => {
  const root = await verifierFixture(t, `printf 'generated\\n' > H001-MOCK-RESULT.json
printf 'generated\\n' > guide-graphs/compiled/bundle.json
exit 7`);

  const result = await runVerifier(root);
  assert.equal(result.code, 7, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(await generated(root), {
    h001: "h001-original\n",
    bundle: "bundle-original\n"
  });
});
