import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.mjs';
import { loadGuide, loadSomaticGuide } from '../src/guide/load-guide.mjs';
import { hash, loadSourcePacket } from '../tasks/guide-fidelity-20260906/source-packet.mjs';

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-source-selection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'guides'));
  await fs.mkdir(path.join(root, 'guide-graphs/source-maps'), { recursive: true });
  const guides = [
    { id: 'inner-child-guide', file: 'inner-child-guide-2026-09-07.txt', ref: 'IC.CURRENT', text: 'Current inner child\nThe adopted current article.\n' },
    { id: 'somatic-sequencing-guide', file: 'somatic-current.txt', ref: 'SOM.CURRENT', text: 'Current somatic\nThe current somatic article.\n' }
  ];
  const maps = {};
  for (const guide of guides) {
    await fs.writeFile(path.join(root, 'guides', guide.file), guide.text);
    await fs.writeFile(path.join(root, 'guides', `${guide.id}.txt`), `STALE ${guide.id}\n`);
    maps[guide.id] = {
      guideId: guide.id,
      file: guide.file,
      sections: [{ id: guide.ref, heading: guide.text.split('\n')[0], lineStart: 1, lineEnd: 2, sha256: hash(guide.text.trim()) }]
    };
    await writeJson(path.join(root, 'guide-graphs/source-maps', `${guide.id}.json`), maps[guide.id]);
  }
  const amendmentsFile = 'owner-amendments-current.json';
  const amendments = { items: [
    { id: 'OWN.CURRENT', status: 'owner-approved', text: 'Current approved amendment.' },
    { id: 'OWN.DRAFT', status: 'proposed', text: 'Unapproved draft amendment.' }
  ] };
  await writeJson(path.join(root, 'guides', amendmentsFile), amendments);
  const manifest = { version: 'current-test-source', sources: [
    ...guides.map(({ id, file, text }) => ({ id, file, sha256: hash(text), format: 'text' })),
    { id: 'owner-amendments', file: amendmentsFile, format: 'json' }
  ] };
  const manifestPath = path.join(root, 'guides/manifest.json');
  await writeJson(manifestPath, manifest);
  const config = loadConfig({ mode: 'mock', guideManifestPath: manifestPath, guidePacketRoot: path.join(root, 'packets') });
  return { root, guides, maps, manifest, manifestPath, config };
}

test('default runtime readers follow renamed manifest sources while old snapshots remain present', async t => {
  const f = await fixture(t);
  assert.equal(f.config.guidePath, null);
  const guide = await loadGuide(f.config);
  assert.equal(guide.text, f.guides[0].text);
  assert.equal(guide.manifest.version, f.manifest.version);
  assert.equal(await loadSomaticGuide(f.config), f.guides[1].text);
});

test('explicit runtime source paths remain overrides of manifest source selection', async t => {
  const f = await fixture(t);
  const config = loadConfig({
    ...f.config,
    guidePath: path.join(f.root, 'guides/inner-child-guide.txt'),
    somaticGuidePath: path.join(f.root, 'guides/somatic-sequencing-guide.txt')
  });
  assert.equal((await loadGuide(config)).text, 'STALE inner-child-guide\n');
  assert.equal(await loadSomaticGuide(config), 'STALE somatic-sequencing-guide\n');
});

test('installed packet sources retain precedence over explicit paths and an unavailable bundled manifest', async t => {
  const f = await fixture(t);
  const contents = path.join(f.config.guidePacketRoot, 'installed/current/contents');
  for (const id of ['inner-child', 'somatic']) {
    const sourceDir = path.join(contents, 'guides', id);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'canonical-source.html'), `<h1>Installed ${id}</h1><p>Approved packet source.</p>`);
  }
  await writeJson(path.join(contents, 'manifest.json'), { packetVersion: 'installed-v1', guides: [] });
  const config = { ...f.config, guidePath: '/missing/override', somaticGuidePath: '/missing/override', guideManifestPath: '/missing/manifest' };
  const guide = await loadGuide(config);
  assert.match(guide.text, /Installed inner-child/);
  assert.equal(guide.manifest.guidePacketVersion, 'installed-v1');
  assert.match(await loadSomaticGuide(config), /Installed somatic/);
});

test('fidelity resolves manifest files and binds manifest and source-map bytes into packet identity', async t => {
  const f = await fixture(t);
  const packet = await loadSourcePacket(f.root);
  assert.equal(packet.references['IC.CURRENT'].file, 'guides/inner-child-guide-2026-09-07.txt');
  assert.equal(packet.references['IC.CURRENT'].text, f.guides[0].text.trim());
  assert.equal(packet.references['SOM.CURRENT'].file, 'guides/somatic-current.txt');
  assert.equal(packet.references['OWN.CURRENT'].file, 'guides/owner-amendments-current.json');
  assert.equal(packet.references['OWN.DRAFT'], undefined);
  assert.doesNotMatch(packet.full, /STALE|Unapproved draft amendment/);
  for (const file of ['guides/manifest.json', 'guide-graphs/source-maps/inner-child-guide.json', 'guide-graphs/source-maps/somatic-sequencing-guide.json']) {
    assert.equal(packet.files[file], hash(await fs.readFile(path.join(f.root, file))));
  }
  await fs.appendFile(f.manifestPath, '\n');
  const changedManifest = await loadSourcePacket(f.root);
  assert.equal(changedManifest.full, packet.full);
  assert.notEqual(changedManifest.sha256, packet.sha256);
  await fs.appendFile(path.join(f.root, 'guide-graphs/source-maps/inner-child-guide.json'), '\n');
  const changedMap = await loadSourcePacket(f.root);
  assert.equal(changedMap.full, packet.full);
  assert.notEqual(changedMap.sha256, changedManifest.sha256);
});

for (const [index, reader] of [[0, loadGuide], [1, loadSomaticGuide]]) {
  test(`runtime and fidelity reject a stale manifest hash for source ${index + 1}`, async t => {
    const f = await fixture(t);
    await fs.appendFile(path.join(f.root, 'guides', f.guides[index].file), 'Unpinned source change.\n');
    await assert.rejects(() => reader(f.config), /Source hash mismatch/);
    await assert.rejects(() => loadSourcePacket(f.root), /Source hash mismatch/);
  });
}

for (const [label, mutate, error] of [
  ['old source filename', map => { map.file = 'inner-child-guide.txt'; }, /does not match manifest source/],
  ['wrong source identity', map => { map.guideId = 'somatic-sequencing-guide'; }, /does not match manifest source/],
  ['stale span hash', map => { map.sections[0].sha256 = '0'.repeat(64); }, /Source span hash mismatch/],
  ['stale but in-range span', map => { map.sections[0].lineStart = 2; }, /Source span hash mismatch/],
  ['zero start', map => { map.sections[0].lineStart = 0; }, /Invalid source span bounds/],
  ['fractional end', map => { map.sections[0].lineEnd = 1.5; }, /Invalid source span bounds/],
  ['reversed span', map => { map.sections[0].lineStart = 2; map.sections[0].lineEnd = 1; }, /Invalid source span bounds/],
  ['end beyond source', map => { map.sections[0].lineEnd = 99; }, /Invalid source span bounds/],
  ['duplicate reference', map => { map.sections.push({ ...map.sections[0] }); }, /duplicate source reference/]
]) {
  test(`fidelity rejects ${label}`, async t => {
    const f = await fixture(t);
    const map = f.maps['inner-child-guide'];
    mutate(map);
    await writeJson(path.join(f.root, 'guide-graphs/source-maps/inner-child-guide.json'), map);
    await assert.rejects(() => loadSourcePacket(f.root), error);
  });
}
