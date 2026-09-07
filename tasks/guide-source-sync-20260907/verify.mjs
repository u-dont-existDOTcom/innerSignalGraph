import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
function replaceUnique(text, before, after, id) {
  assert.equal(text.split(before).length - 1, 1, `${id}: exact span must occur once`);
  return text.replace(before, after);
}

export async function verifySourceSync({ projectRoot = root, candidateText } = {}) {
  const read = file => fs.readFile(path.join(projectRoot, file));
  const receipt = JSON.parse(await read('tasks/guide-source-sync-20260907/SOURCE-SYNC.json'));
  for (const entry of [receipt.source, receipt.approvedPatch, receipt.ownerAdoption, receipt.operations, receipt.historicalSource]) {
    assert.equal(hash(await read(entry.file)), entry.sha256, `Pinned source changed: ${entry.file}`);
  }
  const original = (await read(receipt.source.file)).toString('utf8');
  const actual = candidateText ?? (await read(receipt.target.file)).toString('utf8');
  const { operations } = JSON.parse(await read(receipt.operations.file));
  assert.deepEqual(operations.map(op => op.id), Array.from({ length: 12 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`));
  let expected = original;
  for (const op of operations) expected = replaceUnique(expected, op.anchor, op.replacement, op.id);
  assert.equal(actual, expected, 'Candidate differs from the exact twelve approved operations');
  let reversed = actual;
  for (const op of operations.toReversed()) reversed = replaceUnique(reversed, op.replacement, op.anchor, op.id);
  assert.equal(reversed, original, 'Inverse transformation must recover the original source exactly');
  assert.equal(hash(actual), receipt.target.sha256, 'Target hash mismatch');
  const manifest = JSON.parse(await read('guides/manifest.json'));
  const current = manifest.sources.find(source => source.id === 'inner-child-guide');
  assert.equal(`guides/${current.file}`, receipt.target.file);
  assert.equal(current.sha256, receipt.target.sha256);
  assert.equal(current.version, receipt.target.version);
  return { status: 'PASS', operations: 12, forwardReconstruction: true, inverseReconstruction: true,
    unexplainedChanges: 0, sourceSha256: hash(original), targetSha256: hash(actual) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifySourceSync(), null, 2));
}
