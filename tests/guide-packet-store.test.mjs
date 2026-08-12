import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.mjs';
import { readZipEntries } from '../src/core/zip.mjs';
import { buildGuidePacket } from '../src/guide-packet/builder.mjs';
import { loadCompiledGuideGraphBundle } from '../src/guide-graph/compiler.mjs';
import { loadGuide, loadSomaticGuide } from '../src/guide/load-guide.mjs';
import {
  stageGuidePacket,
  readGuidePacketStatus,
  recordGuidePacketDecision,
  installApprovedGuidePacket,
  rollbackGuidePacket,
  exportInstalledGuidePacket,
  applyGuidePacketCompilation,
  applyGuidePacketReview
} from '../src/guide-packet/store.mjs';

const runtimeRoot = path.resolve('.');

const source = {
  somatic: path.resolve('guide-packets/source-input/somatic-guide-r01-candidate.html'),
  innerChild: path.resolve('guide-packets/source-input/inner-child-guide-r01-candidate.html')
};

async function approveAll(config, candidateId) {
  let status = await readGuidePacketStatus(config);
  for (const card of status.candidate.decisionCards) {
    await recordGuidePacketDecision(config, { candidateId, cardId: card.id, decision: 'approve' });
  }
  return readGuidePacketStatus(config);
}

test('candidate staging never changes installed policy before owner approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-packet-store-'));
  const config = loadConfig({ mode: 'mock', autopilotStateDir: root, guidePacketRoot: path.join(root, 'guide-packets') });
  const zip = await fs.readFile('guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip');
  const staged = await stageGuidePacket(config, zip);
  assert.equal(staged.status, 'awaiting-owner');
  const status = await readGuidePacketStatus(config);
  assert.equal(status.installed, null);
  assert.equal(status.candidate.packetId, staged.packetId);
  assert.equal(status.candidate.sourceDiff.baselineType, "bundled-guides");
  assert.ok(status.candidate.sourceDiff.guides.every((item) => item.changed === true));
  assert.ok(status.candidate.sourceDiff.guides.every((item) => item.sectionDiff));
  assert.ok(status.candidate.sourceDiff.guides.find((item) => item.id === "inner-child").sectionDiff.added.some((item) => item.id === "IC.LOVE_UNSAFE"));
  assert.ok(status.candidate.sourceDiff.guides.find((item) => item.id === "somatic").sectionDiff.added.some((item) => item.id === "SOM.INNER_CHILD_PARALLEL"));
  await assert.rejects(() => installApprovedGuidePacket(config, staged.packetId), /owner-approved|pending decision/i);
});

test('approved packet installs atomically, exports byte-identically, and same revision cannot replace it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-packet-install-'));
  const config = loadConfig({ mode: 'mock', autopilotStateDir: root, guidePacketRoot: path.join(root, 'guide-packets') });
  const original = await fs.readFile('guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip');
  const staged = await stageGuidePacket(config, original);
  const approved = await approveAll(config, staged.packetId);
  assert.equal(approved.candidate.allApproved, true);
  const installed = await installApprovedGuidePacket(config, staged.packetId);
  assert.equal(installed.manifest.packetRevision, 1);
  const exported = await exportInstalledGuidePacket(config);
  assert.deepEqual(exported, installed.packetBuffer);
  const again = await stageGuidePacket(config, original);
  await approveAll(config, again.packetId);
  await assert.rejects(() => installApprovedGuidePacket(config, again.packetId), /same or older|newer/i);
});

test('second install retains exact rollback and rollback restores prior packet identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-packet-rollback-'));
  const config = loadConfig({ mode: 'mock', autopilotStateDir: root, guidePacketRoot: path.join(root, 'guide-packets') });
  const first = await fs.readFile('guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip');
  const c1 = await stageGuidePacket(config, first);
  await approveAll(config, c1.packetId);
  const i1 = await installApprovedGuidePacket(config, c1.packetId);

  const buildDir = path.join(root, 'build-r02');
  const secondBuild = await buildGuidePacket({ runtimeRoot: path.resolve('.'), somaticHtmlPath: source.somatic, innerChildHtmlPath: source.innerChild, outputDir: buildDir, packetVersion: '2026.08.12-r02-candidate', packetRevision: 2, status: 'candidate', createdAt: '2026-08-12T00:00:00.000Z' });
  const c2 = await stageGuidePacket(config, secondBuild.buffer);
  await approveAll(config, c2.packetId);
  const i2 = await installApprovedGuidePacket(config, c2.packetId);
  assert.equal(i2.manifest.packetRevision, 2);
  const rolled = await rollbackGuidePacket(config);
  assert.equal(rolled.manifest.packetRevision, 1);
  assert.deepEqual(await exportInstalledGuidePacket(config), i1.packetBuffer);
});

test("installed packet becomes the active guide and graph source while a staged candidate does not", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-guide-active-"));
  const config = {
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets"),
    guideGraphBundlePath: path.join(runtimeRoot, "guide-graphs/compiled/bundle.json"),
    guidePath: path.join(runtimeRoot, "guides/inner-child-guide.txt"),
    somaticGuidePath: path.join(runtimeRoot, "guides/somatic-sequencing-guide.txt"),
    guideManifestPath: path.join(runtimeRoot, "guides/manifest.json")
  };
  const { buffer } = await buildGuidePacket({ runtimeRoot, somaticHtmlPath: source.somatic, innerChildHtmlPath: source.innerChild, outputDir: path.join(root, "build"), packetRevision: 1, packetVersion: "2026.08.11-r01-candidate" });
  const bundled = await loadCompiledGuideGraphBundle({ root: runtimeRoot, packetRoot: config.guidePacketRoot });
  assert.equal(bundled.version, "inner-child-somatic-pilot-2026-08-09-r5");
  await stageGuidePacket(config, buffer);
  const staged = await loadCompiledGuideGraphBundle({ root: runtimeRoot, packetRoot: config.guidePacketRoot });
  assert.equal(staged.version, bundled.version);
  const status = await readGuidePacketStatus(config);
  for (const card of status.candidate.decisionCards) await recordGuidePacketDecision(config, { candidateId: status.candidate.packetId, cardId: card.id, decision: "approve" });
  await installApprovedGuidePacket(config, status.candidate.packetId);
  const active = await loadCompiledGuideGraphBundle({ root: runtimeRoot, packetRoot: config.guidePacketRoot });
  assert.equal(active.version, "inner-child-somatic-packet-2026.08.11-r01-candidate");
  const guide = await loadGuide(config);
  const somatic = await loadSomaticGuide(config);
  assert.equal(guide.manifest.guidePacketVersion, "2026.08.11-r01-candidate");
  assert.match(guide.text, /When Love Is There but Doesn’t Feel Safe/);
  assert.match(somatic, /five-job map/i);
});


test('approved packet preserves Opus compilation and independent Codex review as checksummed audit members', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guide-packet-audit-preservation-'));
  const config = loadConfig({ mode: 'mock', autopilotStateDir: root, guidePacketRoot: path.join(root, 'guide-packets') });
  const original = await fs.readFile('guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip');
  const staged = await stageGuidePacket(config, original);
  await applyGuidePacketCompilation(config, staged.packetId, {
    contractVersion: 'guide-packet-opus-compilation-v1',
    status: 'compiled',
    compiledAt: '2026-08-11T20:00:00.000Z',
    compiler: { provider: 'anthropic', model: 'claude-opus-5', requestId: 'compile-1' },
    report: { verdict: 'compiled', summary: 'compiled', unresolved_material_disagreement: false, source_roles: [], graph_changes: [], findings: [], worst_plausible_failure: 'none' }
  });
  await applyGuidePacketReview(config, staged.packetId, {
    contractVersion: 'guide-packet-independent-review-v1',
    status: 'reviewed',
    reviewedAt: '2026-08-11T20:01:00.000Z',
    reviewer: { provider: 'openai', model: 'gpt-5.6-sol', requestId: 'review-1' },
    independentAudit: { verdict: 'pass', summary: 'reviewed', unresolved_material_disagreement: false, findings: [], recommended_owner_decisions: [], worst_plausible_failure: 'none' },
    escalation: null,
    finalAudit: { verdict: 'pass', summary: 'reviewed', unresolved_material_disagreement: false, findings: [], recommended_owner_decisions: [], worst_plausible_failure: 'none' }
  });
  await approveAll(config, staged.packetId);
  const approved = await fs.readFile(path.join(config.guidePacketRoot, 'candidates', staged.packetId, 'approved.zip'));
  const entries = readZipEntries(approved);
  assert.ok(entries.has('audit/source-role-compilation.json'));
  assert.ok(entries.has('audit/independent-review.json'));
  const checksums = entries.get('SHA256SUMS.txt').toString('utf8');
  assert.match(checksums, /audit\/source-role-compilation\.json/);
  assert.match(checksums, /audit\/independent-review\.json/);
});
