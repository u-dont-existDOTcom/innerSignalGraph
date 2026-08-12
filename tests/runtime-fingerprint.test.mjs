import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeRuntimeFingerprint } from "../src/autopilot/runtime-fingerprint.mjs";

async function makeMiniRuntime() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-fingerprint-"));
  for (const dir of ["src", "apps", "guides", "guide-graphs", "guide-packets", "corpus", "tests", "scripts"]) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  await fs.writeFile(path.join(root, "src", "a.mjs"), "export const x = 1;\n");
  await fs.writeFile(path.join(root, "package.json"), '{"version":"x"}\n');
  await fs.writeFile(path.join(root, "run-autopilot.sh"), "echo ok\n");
  await fs.writeFile(path.join(root, ".env.cli.example"), "INNER_SIGNAL_MODE=cli\n");
  await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nOPENAI_MODEL=gpt-5.6-sol\nIRRELEVANT=one\n");
  return root;
}

test("runtime fingerprint is stable and changes when code changes", async () => {
  const root = await makeMiniRuntime();
  try {
    const a = await computeRuntimeFingerprint(root);
    const b = await computeRuntimeFingerprint(root);
    assert.equal(a, b);
    await fs.writeFile(path.join(root, "src", "a.mjs"), "export const x = 2;\n");
    const c = await computeRuntimeFingerprint(root);
    assert.notEqual(c, a);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime fingerprint includes relevant model settings but ignores unrelated env values", async () => {
  const root = await makeMiniRuntime();
  try {
    const a = await computeRuntimeFingerprint(root);
    await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nOPENAI_MODEL=gpt-5.6-sol\nIRRELEVANT=two\n");
    const b = await computeRuntimeFingerprint(root);
    assert.equal(b, a);
    await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nOPENAI_MODEL=another-model\nIRRELEVANT=two\n");
    const c = await computeRuntimeFingerprint(root);
    assert.notEqual(c, a);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("runtime fingerprint includes bundled guide packet fixtures", async () => {
  const root = await makeMiniRuntime();
  try {
    await fs.writeFile(path.join(root, "guide-packets", "candidate.txt"), "one\n");
    const a = await computeRuntimeFingerprint(root);
    await fs.writeFile(path.join(root, "guide-packets", "candidate.txt"), "two\n");
    const b = await computeRuntimeFingerprint(root);
    assert.notEqual(b, a);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime fingerprint includes the configured guide packet state root", async () => {
  const root = await makeMiniRuntime();
  try {
    await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nOPENAI_MODEL=gpt-5.6-sol\nGUIDE_PACKET_ROOT=./.inner-signal-autopilot/guide-packets-a\n");
    const a = await computeRuntimeFingerprint(root);
    await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nOPENAI_MODEL=gpt-5.6-sol\nGUIDE_PACKET_ROOT=./.inner-signal-autopilot/guide-packets-b\n");
    const b = await computeRuntimeFingerprint(root);
    assert.notEqual(b, a);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
