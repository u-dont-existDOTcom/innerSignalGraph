import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  withOpenedRegularFile,
  withOpenedRegularFileSync
} from "../src/core/opened-regular-file.mjs";

async function fixture(context) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "inner-signal-opened-file-"));
  context.after(async () => await fsp.rm(root, { recursive: true, force: true }));
  const subject = path.join(root, "subject.txt");
  const outside = path.join(root, "outside.txt");
  await fsp.writeFile(subject, "trusted\n");
  await fsp.writeFile(outside, "replacement\n");
  return { root, subject, outside };
}

test("regular-file openers declare a private creation mode", () => {
  assert.match(
    withOpenedRegularFile.toString(),
    /open\(filePath,\s*noFollowFlags\(\),\s*0o600\)/
  );
  assert.match(
    withOpenedRegularFileSync.toString(),
    /openSync\(filePath,\s*noFollowFlags\(\),\s*0o600\)/
  );
});

test("async regular-file reads stay bound to the opened inode after pathname replacement", async (context) => {
  const { subject, outside } = await fixture(context);

  const content = await withOpenedRegularFile(subject, async (handle, openedStat) => {
    assert.equal(openedStat.isFile(), true);
    await fsp.rename(subject, `${subject}.original`);
    await fsp.symlink(outside, subject);
    return await handle.readFile("utf8");
  });

  assert.equal(content, "trusted\n");
});

test("async regular-file opens reject a symbolic link before invoking the reader", async (context) => {
  const { root, outside } = await fixture(context);
  const link = path.join(root, "link.txt");
  await fsp.symlink(outside, link);
  let invoked = false;

  await assert.rejects(withOpenedRegularFile(link, async () => {
    invoked = true;
  }));
  assert.equal(invoked, false);
});

test("sync regular-file reads stay bound to the opened inode after pathname replacement", async (context) => {
  const { subject, outside } = await fixture(context);

  const content = withOpenedRegularFileSync(subject, (descriptor, openedStat) => {
    assert.equal(openedStat.isFile(), true);
    fs.renameSync(subject, `${subject}.original`);
    fs.symlinkSync(outside, subject);
    return fs.readFileSync(descriptor, "utf8");
  });

  assert.equal(content, "trusted\n");
});

test("sync regular-file opens reject directories before invoking the reader", async (context) => {
  const { root } = await fixture(context);
  let invoked = false;

  assert.throws(() => withOpenedRegularFileSync(root, () => {
    invoked = true;
  }));
  assert.equal(invoked, false);
});
