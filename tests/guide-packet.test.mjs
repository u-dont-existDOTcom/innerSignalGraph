import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createStoredZip, readZipEntries } from '../src/core/zip.mjs';
import { extractEditorBody, extractHtmlSections } from '../src/guide-packet/source-html.mjs';
import { buildGuidePacket } from '../src/guide-packet/builder.mjs';
import { verifyGuidePacket } from '../src/guide-packet/verifier.mjs';
import { buildBehavioralDiff, buildDecisionCards } from '../src/guide-packet/diff.mjs';
import { runGuideQualityAudit } from '../src/guide-packet/quality-audit.mjs';

const fixtureRoot = path.resolve('guide-packets/fixtures/r01-candidate');
const sourceFiles = {
  somatic: path.resolve('guide-packets/source-input/somatic-guide-r01-candidate.html'),
  innerChild: path.resolve('guide-packets/source-input/inner-child-guide-r01-candidate.html')
};

function mutateEntry(zipBuffer, name, transform) {
  const entries = readZipEntries(zipBuffer);
  return createStoredZip([...entries.entries()].map(([entryName, data]) => ({
    name: entryName,
    data: entryName === name ? transform(Buffer.from(data)) : data
  })), new Date('2026-08-11T00:00:00Z'));
}

function rezipWithChecksums(entries) {
  const next = new Map(entries);
  next.delete('SHA256SUMS.txt');
  const sums = [...next.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}`)
    .join('\n') + '\n';
  next.set('SHA256SUMS.txt', Buffer.from(sums));
  return createStoredZip([...next.entries()].map(([name, data]) => ({ name, data })), new Date('2026-08-11T00:00:00Z'));
}

test('ZIP reader round-trips stored entries and rejects zip-slip paths', () => {
  const zip = createStoredZip([{ name: 'a/b.txt', data: 'hello' }], new Date('2026-08-11T00:00:00Z'));
  const entries = readZipEntries(zip);
  assert.equal(entries.get('a/b.txt').toString('utf8'), 'hello');
  const unsafe = createStoredZip([{ name: '../evil.txt', data: 'x' }], new Date('2026-08-11T00:00:00Z'));
  assert.throws(() => readZipEntries(unsafe), /unsafe zip path/i);
});

test('candidate HTML exact editor-body hashes match the handoff', async () => {
  const somatic = await fs.readFile(sourceFiles.somatic, 'utf8');
  const innerChild = await fs.readFile(sourceFiles.innerChild, 'utf8');
  assert.equal(extractEditorBody(somatic).sha256, '8c8a0ef5ce88d90e46dc8b8760488abe766a125b7851f9d987d82ee32ab39bf5');
  assert.equal(extractEditorBody(innerChild).sha256, '043870d7dffd56fa8c2c92b7e7b47c9a658693fe55bb7771c3f14b812c89eaab');
  const sections = extractHtmlSections(innerChild, { guideId: 'inner-child', aliases: { 'When Love Is There but Doesn’t Feel Safe': 'IC.LOVE_UNSAFE' } });
  assert.ok(sections.some((item) => item.id === 'IC.LOVE_UNSAFE'));
  assert.ok(sections.some((item) => /Borrow One Function/.test(item.heading)));
});

test('valid candidate packet verifies but remains candidate-only', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-packet-valid-candidate-'));
  const built = await buildGuidePacket({
    runtimeRoot: path.resolve('.'),
    somaticHtmlPath: sourceFiles.somatic,
    innerChildHtmlPath: sourceFiles.innerChild,
    outputDir,
    packetVersion: '2026.08.11-r01-candidate',
    packetRevision: 1,
    status: 'candidate'
  });
  const result = verifyGuidePacket(built.buffer, { installedRevision: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.manifest.status, 'candidate');
  assert.equal(result.installable, false);
  assert.ok(result.decisionCards.length >= 4);
  assert.ok(result.qualityAudit.findings.length >= 1);
});

test('tampered member, missing provenance, and stale source/graph are rejected', async () => {
  const zip = await fs.readFile(path.join(fixtureRoot, 'inner-signal-guide-packet-r01-candidate.zip'));
  const tampered = mutateEntry(zip, 'guides/inner-child/canonical-source.html', (data) => Buffer.concat([data, Buffer.from('tamper')]));
  assert.equal(verifyGuidePacket(tampered).ok, false);
  const entries = readZipEntries(zip);
  const missing = createStoredZip([...entries.entries()].filter(([name]) => name !== 'policy/provenance.json').map(([name, data]) => ({ name, data })));
  assert.match(verifyGuidePacket(missing).errors.join('\n'), /provenance/i);
  const stale = mutateEntry(zip, 'manifest.json', (data) => {
    const manifest = JSON.parse(data.toString('utf8'));
    manifest.guides[0].graphSourceSha256 = '0'.repeat(64);
    return Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  });
  assert.match(verifyGuidePacket(stale).errors.join('\n'), /stale|source hash/i);
});

test('graph-only rule requires exact source support or owner-amendment provenance', async () => {
  const zip = await fs.readFile(path.join(fixtureRoot, 'inner-signal-guide-packet-r01-candidate.zip'));
  const entries = readZipEntries(zip);
  const graph = JSON.parse(entries.get('graphs/inner-child.graph.json').toString('utf8'));
  graph.nodes.push({
    id: 'IC.UNSUPPORTED_TEST', title: 'Unsupported', kind: 'decision-node', tier: 4, priority: 1,
    activation: { any: [{ field: 'current_intent', op: 'eq', value: 'conversation' }] },
    sourceRefs: ['MISSING.SOURCE'], authority: 'model-inference', recommendations: ['Do x'], avoid: [], successSignals: [], tags: [],
    effects: { deferNodes: [], blockNodes: [], requiredNuance: [], forbiddenOverclaims: [] }, defaultQuestion: ''
  });
  const bad = createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data: name === 'graphs/inner-child.graph.json' ? Buffer.from(JSON.stringify(graph, null, 2) + '\n') : data })));
  assert.match(verifyGuidePacket(bad).errors.join('\n'), /source support|owner amendment|MISSING\.SOURCE/i);
});

test('behavioral diff describes route, question, priority, blocked/deferred, and affected case changes', async () => {
  const installed = JSON.parse(await fs.readFile('guide-graphs/compiled/bundle.json', 'utf8'));
  const zip = await fs.readFile(path.join(fixtureRoot, 'inner-signal-guide-packet-r01-candidate.zip'));
  const verified = verifyGuidePacket(zip);
  const diff = buildBehavioralDiff(installed, verified.packetGraphBundle, { regressionCases: verified.regressionCases });
  assert.ok(diff.nodes.added.some((item) => item.id === 'SOM.DELAYED_RESPONSE_REASSESSMENT'));
  assert.ok(diff.changedQuestions.length >= 1);
  assert.ok(diff.changedPriorities.length >= 1);
  assert.ok(diff.changedBlockedOrDeferred.length >= 1);
  assert.ok(diff.affectedCases.length >= 1);
  const cards = buildDecisionCards(diff, verified.provenance);
  assert.ok(cards.some((card) => card.classification === 'substantive'));
  assert.ok(cards.every((card) => card.worstPlausibleFailure));
});

test('quality audit catches graph-only amendments, categorical wording, and unsupported or unreachable graph structure', async () => {
  const zip = await fs.readFile(path.join(fixtureRoot, 'inner-signal-guide-packet-r01-candidate.zip'));
  const verified = verifyGuidePacket(zip);
  const audit = runGuideQualityAudit({
    manifest: verified.manifest,
    sectionsByGuide: verified.sectionsByGuide,
    graphs: verified.graphs,
    provenance: verified.provenance,
    ownerAmendments: verified.ownerAmendments
  });
  assert.ok(audit.findings.some((item) => item.code === 'GRAPH_ONLY_OWNER_AMENDMENT'));
  assert.ok(audit.findings.some((item) => item.code === 'CATEGORICAL_SOURCE_WORDING'));
});


test('derived source maps and section inventories must exactly match canonical source', async () => {
  const zip = await fs.readFile(path.join(fixtureRoot, 'inner-signal-guide-packet-r01-candidate.zip'));
  const sectionEntries = readZipEntries(zip);
  const sections = JSON.parse(sectionEntries.get('guides/inner-child/sections.json').toString('utf8'));
  sections[0].heading = 'Invented heading';
  sectionEntries.set('guides/inner-child/sections.json', Buffer.from(JSON.stringify(sections, null, 2) + '\n'));
  const staleSections = rezipWithChecksums(sectionEntries);
  assert.match(verifyGuidePacket(staleSections).errors.join('\n'), /sections.*stale|derived.*source/i);

  const mapEntries = readZipEntries(zip);
  const sourceMap = JSON.parse(mapEntries.get('guides/somatic/source-map.json').toString('utf8'));
  sourceMap.sections[0].startOffset += 1;
  mapEntries.set('guides/somatic/source-map.json', Buffer.from(JSON.stringify(sourceMap, null, 2) + '\n'));
  const staleMap = rezipWithChecksums(mapEntries);
  assert.match(verifyGuidePacket(staleMap).errors.join('\n'), /source map.*stale|derived.*source/i);
});
