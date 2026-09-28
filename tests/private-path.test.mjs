import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isOutside, realLocation } from "../src/core/private-path.mjs";

test("containment is judged on real locations, not on how a path is spelled", async (t) => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-path-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checkout = path.join(directory, "checkout");
  await fs.mkdir(path.join(checkout, "..private"), { recursive: true });
  await fs.mkdir(path.join(directory, "outside"));
  await fs.symlink(checkout, path.join(directory, "outside", "link"));
  // A name inside the checkout that merely starts with ".." is inside.
  assert.equal(isOutside(checkout, path.join(checkout, "..private", "run.json")), false);
  // An outside-looking path whose ancestor links back into the checkout is inside.
  assert.equal(isOutside(checkout, path.join(directory, "outside", "link", "run.json")), false);
  assert.equal(realLocation(path.join(directory, "outside", "link", "not-yet", "run.json")), path.join(checkout, "not-yet", "run.json"));
  // Genuinely outside, whether or not the path exists yet.
  assert.equal(isOutside(checkout, path.join(directory, "outside", "run.json")), true);
  assert.equal(isOutside(checkout, path.join(directory, "elsewhere", "later", "run.json")), true);
  assert.equal(isOutside(checkout, directory), true);
  assert.equal(isOutside(checkout, checkout), false);
});
