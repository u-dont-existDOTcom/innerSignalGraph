import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import { canonicalJson } from "../src/guide-packet/contract.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { runGuidePacketRegressionSuite } from "../src/guide-packet/regressions.mjs";
import { stageGuidePacket, recordGuidePacketDecision, installApprovedGuidePacket } from "../src/guide-packet/store.mjs";

const packetPath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function rebuildPacket(entries, date = new Date("2026-08-11T20:00:00.000Z")) {
  entries.delete("SHA256SUMS.txt");
  const lines = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => `${sha256(data)}  ${name}`)
    .join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(lines));
  return createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), date);
}

function mutatePacket(buffer, mutate) {
  const entries = readZipEntries(buffer);
  mutate(entries);
  return rebuildPacket(entries);
}

function removeDelayedEdge(entries) {
  const somaticPath = "graphs/somatic.graph.json";
  const bundlePath = "graphs/bundle.json";
  const manifestPath = "manifest.json";
  const somatic = JSON.parse(entries.get(somaticPath).toString("utf8"));
  somatic.edges = somatic.edges.filter((edge) => !(edge.from === "SOM.EMDR_DISCRETE" && edge.to === "SOM.DELAYED_RESPONSE_REASSESSMENT"));
  const bundle = JSON.parse(entries.get(bundlePath).toString("utf8"));
  const bundledSomatic = bundle.graphs.find((graph) => graph.graphId === somatic.graphId);
  bundledSomatic.edges = somatic.edges;
  const somaticData = Buffer.from(canonicalJson(somatic));
  entries.set(somaticPath, somaticData);
  entries.set(bundlePath, Buffer.from(canonicalJson(bundle)));
  const manifest = JSON.parse(entries.get(manifestPath).toString("utf8"));
  manifest.guides.find((guide) => guide.id === "somatic").graphSha256 = sha256(somaticData);
  entries.set(manifestPath, Buffer.from(canonicalJson(manifest)));
}

test("candidate packet runs all embedded affected-case regressions", async () => {
  const packet = await fs.readFile(packetPath);
  const result = runGuidePacketRegressionSuite(packet);
  assert.equal(result.ok, true);
  assert.equal(result.count, 4);
  assert.equal(result.passed, 4);
  assert.deepEqual(result.results.map((item) => item.id), ["A001", "G-EMDR-DISCRETE", "G-SOM-DELAYED", "H001"]);
  assert.ok(result.results.every((item) => item.status === "pass"));
});

test("affected-case regression catches a source-valid graph that drops delayed EMDR reassessment", async () => {
  const original = await fs.readFile(packetPath);
  const changed = mutatePacket(original, removeDelayedEdge);
  const result = runGuidePacketRegressionSuite(changed);
  assert.equal(result.ok, false);
  const delayed = result.results.find((item) => item.id === "G-SOM-DELAYED");
  assert.equal(delayed.status, "fail");
  assert.match(delayed.failures.join("\n"), /SOM\.EMDR_DISCRETE.*SOM\.DELAYED_RESPONSE_REASSESSMENT/i);
});

test("staging stores the exact affected-case regression verdict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-regression-stage-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const staged = await stageGuidePacket(config, await fs.readFile(packetPath));
  assert.equal(staged.regressionStatus.ok, true);
  assert.equal(staged.regressionStatus.count, 4);
  assert.equal(staged.regressionStatus.passed, 4);
});

test("atomic install reruns affected regressions and refuses a tampered approved packet", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-regression-install-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const staged = await stageGuidePacket(config, await fs.readFile(packetPath));
  for (const card of staged.decisionCards) {
    await recordGuidePacketDecision(config, { candidateId: staged.packetId, cardId: card.id, decision: "approve" });
  }
  const approvedPath = path.join(config.guidePacketRoot, "candidates", staged.packetId, "approved.zip");
  const approved = await fs.readFile(approvedPath);
  await fs.writeFile(approvedPath, mutatePacket(approved, removeDelayedEdge));
  await assert.rejects(
    () => installApprovedGuidePacket(config, staged.packetId),
    /affected-case regression.*G-SOM-DELAYED|G-SOM-DELAYED.*regression/i
  );
  await assert.rejects(() => fs.access(path.join(config.guidePacketRoot, "installed", "current")));
});
