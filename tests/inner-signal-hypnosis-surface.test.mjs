import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGraph } from '../src/guide-graph/validate.mjs';
import { renderGuideSurfaceMap } from '../scripts/generate-guide-surface-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graphPath = path.join(root,'guide-graphs/candidates/inner-signal-hypnosis.graph.json');
const mapPath = path.join(root,'guide-graphs/source-maps/inner-signal-hypnosis-guide.json');
const docPath = path.join(root,'docs/INNER-SIGNAL-HYPNOSIS-MAP.md');

test('Inner Signal hypnosis guide graph resolves every source ref and generated surface is current', async () => {
  const graphBytes = await fs.readFile(graphPath);
  const sourceMapBytes = await fs.readFile(mapPath);
  const graph = JSON.parse(graphBytes.toString('utf8'));
  const sourceMap = JSON.parse(sourceMapBytes.toString('utf8'));
  const sourceIds = new Set(sourceMap.sections.map((section) => section.id));
  validateGraph(graph,{knownSourceRefs:sourceIds});
  assert.equal(graph.guideId, sourceMap.guideId);
  assert.equal(sourceMap.sourceAuthority.masterSha256,'06987f70e7264a5ac72d132e4b8420cf75cda60f33bbb430c83a0146e612adf9');
  const actual = await fs.readFile(docPath,'utf8');
  const expected = renderGuideSurfaceMap({graph,sourceMap,graphBytes,sourceMapBytes});
  assert.equal(actual, expected);
});
