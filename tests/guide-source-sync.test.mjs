import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { verifySourceSync } from '../tasks/guide-source-sync-20260907/verify.mjs';

test('current source is exactly the recovered owner article plus adopted E01-E12', async () => {
  const result = await verifySourceSync();
  assert.equal(result.operations, 12);
  assert.equal(result.unexplainedChanges, 0);
});

test('preservation proof rejects both loss and unapproved extra wording', async () => {
  const text = await fs.readFile(new URL('../guides/inner-child-guide-2026-09-07.txt', import.meta.url), 'utf8');
  await assert.rejects(() => verifySourceSync({ candidateText: text.replace('If it says no, don’t turn that into permission.', '') }));
  await assert.rejects(() => verifySourceSync({ candidateText: text + '\nUnapproved extra claim.' }));
});
