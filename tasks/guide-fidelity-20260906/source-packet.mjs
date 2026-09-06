import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

// The grader/reference use source sections, not graph recommendations as the oracle.
export async function loadSourcePacket(root) {
  const references = {};
  const files = {};
  let full = '';
  for (const name of ['inner-child-guide', 'somatic-sequencing-guide']) {
    const file = `guides/${name}.txt`;
    const text = await fs.readFile(path.join(root, file), 'utf8');
    files[file] = hash(text);
    full += `\n\n# AUTHOR GUIDE: ${name}\n${text}`;
    const map = JSON.parse(await fs.readFile(path.join(root, `guide-graphs/source-maps/${name}.json`), 'utf8'));
    const lines = text.split(/\r?\n/);
    for (const section of map.sections) {
      const content = lines.slice(section.lineStart - 1, section.lineEnd).join('\n').trim();
      references[section.id] = { id: section.id, file, lines: [section.lineStart, section.lineEnd], text: content, hash: hash(content) };
    }
  }
  const amendmentsFile = 'guides/owner-amendments.json';
  const amendmentsText = await fs.readFile(path.join(root, amendmentsFile), 'utf8');
  const amendments = JSON.parse(amendmentsText);
  files[amendmentsFile] = hash(amendmentsText);
  full += '\n\n# APPROVED AMENDMENTS (specific later amendments qualify earlier guide language)\n';
  for (const item of amendments.items) {
    if (item.status !== 'owner-approved') continue;
    references[item.id] = { id: item.id, file: amendmentsFile, text: item.text, hash: hash(item.text) };
    full += `\n[${item.id}] ${item.text}\n`;
  }
  return { version: 1, files, references, full, sha256: hash({ files, full }), characters: full.length, truncated: false };
}

export function sourceForCase(packet, scenario) {
  return scenario.sourceRefs.map(id => {
    if (!packet.references[id]) throw new Error(`Unresolved source reference ${id}; cannot grade from an invented source.`);
    return packet.references[id];
  });
}
