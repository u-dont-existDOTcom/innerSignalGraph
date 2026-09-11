import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {renderGuideSurfaceMap} from '../scripts/generate-guide-surface-map.mjs';
const base=new URL('../',import.meta.url);
test('hypnosis map is byte-current with graph, real source records and controller',async()=>{
 const paths=['guide-graphs/candidates/inner-signal-hypnosis.graph.json','guide-graphs/source-maps/inner-signal-hypnosis-guide.json','reference/hypnosis/knowledge.json','src/hypnosis-guide/session.mjs'];
 const [graphBytes,sourceMapBytes,libraryBytes,controllerBytes]=await Promise.all(paths.map(p=>fs.readFile(new URL(p,base))));
 const inputs={graph:JSON.parse(graphBytes),sourceMap:JSON.parse(sourceMapBytes),library:JSON.parse(libraryBytes),graphBytes,sourceMapBytes,libraryBytes,controllerBytes};
 const expected=renderGuideSurfaceMap(inputs);assert.equal(await fs.readFile(new URL('docs/INNER-SIGNAL-HYPNOSIS-MAP.md',base),'utf8'),expected);
 assert.match(expected,/not.*executable gates/);assert.match(expected,/hypnosis-session|phase transitions/);
 const changed=Buffer.concat([controllerBytes,Buffer.from('\n// changed guard implementation')]);
 assert.notEqual(renderGuideSurfaceMap({...inputs,controllerBytes:changed}),expected);
});
