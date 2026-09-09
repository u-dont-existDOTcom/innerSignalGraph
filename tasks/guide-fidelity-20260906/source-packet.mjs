import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

// The grader/reference use source sections, not graph recommendations as the oracle.
export async function loadSourcePacket(root) {
  const references = {};
  const files = {};
  const manifestFile = 'guides/manifest.json';
  const manifestBytes = await fs.readFile(path.join(root, manifestFile));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  files[manifestFile] = hash(manifestBytes);
  const sourceById = id => {
    const matches = manifest.sources?.filter(source => source.id === id) ?? [];
    if (matches.length !== 1 || typeof matches[0].file !== 'string' || !matches[0].file) {
      throw new Error(`Guide manifest must select exactly one file for ${id}.`);
    }
    return matches[0];
  };
  let full = '';
  for (const id of ['inner-child-guide', 'somatic-sequencing-guide']) {
    const source = sourceById(id);
    const file = `guides/${source.file}`;
    const sourceBytes = await fs.readFile(path.join(root, file));
    const text = sourceBytes.toString('utf8');
    files[file] = hash(sourceBytes);
    if (files[file] !== source.sha256) throw new Error(`Source hash mismatch for ${file}.`);
    full += `\n\n# AUTHOR GUIDE: ${id}\n${text}`;
    const mapFile = `guide-graphs/source-maps/${id}.json`;
    const mapBytes = await fs.readFile(path.join(root, mapFile));
    files[mapFile] = hash(mapBytes);
    const map = JSON.parse(mapBytes.toString('utf8'));
    if (map.guideId !== id || map.file !== source.file) {
      throw new Error(`Source map ${mapFile} does not match manifest source ${file}.`);
    }
    if (!Array.isArray(map.sections) || !map.sections.length) throw new Error(`Source map ${mapFile} has no sections.`);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (const section of map.sections) {
      if (typeof section.id !== 'string' || !section.id || Object.hasOwn(references, section.id)) {
        throw new Error(`Missing or duplicate source reference in ${mapFile}: ${section.id}.`);
      }
      if (!Number.isSafeInteger(section.lineStart) || !Number.isSafeInteger(section.lineEnd)
          || section.lineStart < 1 || section.lineEnd < section.lineStart || section.lineEnd > lines.length) {
        throw new Error(`Invalid source span bounds for ${section.id} in ${mapFile}.`);
      }
      const content = lines.slice(section.lineStart - 1, section.lineEnd).join('\n').trim();
      if (hash(content) !== section.sha256) throw new Error(`Source span hash mismatch for ${section.id} in ${mapFile}.`);
      references[section.id] = { id: section.id, file, lines: [section.lineStart, section.lineEnd], text: content, hash: hash(content) };
    }
  }
  const amendmentsSource = sourceById('owner-amendments');
  const amendmentsFile = `guides/${amendmentsSource.file}`;
  const amendmentsBytes = await fs.readFile(path.join(root, amendmentsFile));
  const amendments = JSON.parse(amendmentsBytes.toString('utf8'));
  files[amendmentsFile] = hash(amendmentsBytes);
  if (amendmentsSource.sha256 && files[amendmentsFile] !== amendmentsSource.sha256) throw new Error(`Source hash mismatch for ${amendmentsFile}.`);
  full += '\n\n# APPROVED AMENDMENTS (specific later amendments qualify earlier guide language)\n';
  for (const item of amendments.items) {
    if (item.status !== 'owner-approved') continue;
    if (typeof item.id !== 'string' || !item.id || Object.hasOwn(references, item.id)) {
      throw new Error(`Missing or duplicate source reference in ${amendmentsFile}: ${item.id}.`);
    }
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
