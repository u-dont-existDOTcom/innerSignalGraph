import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readValidatedPublicationResult } from "../src/compliance/publication-result-validator.mjs";
import { withOpenedRegularFile } from "../src/core/opened-regular-file.mjs";

function result(scannedRecords) {
  return {
    schemaVersion: 1,
    ok: true,
    scannedRecords,
    findings: [],
    counts: {
      actionLogs: 0,
      actionRuns: 0,
      artifacts: 0,
      blobs: 1,
      branches: 1,
      commits: 1,
      issueComments: 0,
      issues: 0,
      objects: 1,
      pullRequests: 0,
      refs: 1,
      reviewComments: 0,
      reviews: 0
    }
  };
}

test("publication-result validation reads the opened private inode after pathname replacement", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-publication-result-"));
  context.after(async () => await fs.rm(root, { recursive: true, force: true }));
  await fs.chmod(root, 0o700);
  const subject = path.join(root, "result.json");
  const replacement = path.join(root, "replacement.json");
  await fs.writeFile(subject, `${JSON.stringify(result(7))}\n`, { mode: 0o600 });
  await fs.writeFile(replacement, `${JSON.stringify(result(99))}\n`, { mode: 0o600 });
  let replaced = false;

  const validated = await readValidatedPublicationResult(subject, 0, {
    withOpenedFile: async (file, reader) => await withOpenedRegularFile(file, async (handle, openedStat) => {
      await fs.rename(file, `${file}.original`);
      await fs.symlink(replacement, file);
      replaced = true;
      return await reader(handle, openedStat);
    })
  });

  assert.equal(replaced, true);
  assert.equal(validated.scannedRecords, 7);
});
