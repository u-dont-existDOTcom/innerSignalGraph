import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCurrentAuthority } from '../src/authoring/projection.mjs';

const root = process.cwd();
const edgesDir = path.join(root, 'authoring/obsidian/proposals/love-horizon-r1/edges');
const oldProjection = 'ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb';
const authority = await loadCurrentAuthority({ root });

for (const name of await fs.readdir(edgesDir)) {
  const file = path.join(edgesDir, name);
  let text = await fs.readFile(file, 'utf8');
  text = text.replaceAll(oldProjection, authority.projectionInputSha256);
  await fs.writeFile(file, text);
}
console.log(JSON.stringify({ ok: true, projectionInputSha256: authority.projectionInputSha256 }));
