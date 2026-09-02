import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileGuidePacketCandidate } from "../src/guide-packet/model-compiler.mjs";
import { verifyGuidePacket } from "../src/guide-packet/verifier.mjs";
import { runGuidePacketRegressionSuite } from "../src/guide-packet/regressions.mjs";
import { canonicalJson } from "../src/guide-packet/contract.mjs";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { DEFAULT_BUNDLED_GUIDE_PACKET, ensureBundledGuidePacketCandidate } from "../src/guide-packet/autopilot.mjs";
import {
  applyGuidePacketCompilation,
  readGuidePacketStatus,
  recordGuidePacketDecision,
  stageGuidePacket
} from "../src/guide-packet/store.mjs";

const r01FixturePath = path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip");
const r02FixturePath = path.resolve("guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function compilationValue() {
  return {
    verdict: "compiled",
    summary: "Every source role is reviewable without approving owner policy.",
    unresolved_material_disagreement: false,
    source_roles: [],
    graph_changes: [],
    findings: [],
    worst_plausible_failure: "A source could still be interpreted too broadly."
  };
}

class CapturingCompiler {
  constructor() {
    this.id = "anthropic";
    this.model = "claude-opus-5";
    this.requests = [];
  }
  async generate(request) {
    this.requests.push(request);
    return { text: JSON.stringify(compilationValue()), requestId: "opus-r02-1" };
  }
}

async function r02Bytes() {
  return await fs.readFile(r02FixturePath);
}

test("archived r01 candidate bytes remain exact", async () => {
  const preserved = await fs.readFile(r01FixturePath);
  assert.equal(sha256(preserved), "9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263");
  const verified = verifyGuidePacket(preserved, { installedRevision: 0 });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  assert.equal(verified.manifest.packetVersion, "2026.08.11-r01-candidate");
});

test("the runtime bundles r02 as the default active candidate source while retaining r01 separately", async () => {
  assert.equal(path.basename(DEFAULT_BUNDLED_GUIDE_PACKET), "inner-signal-guide-packet-r02-candidate.zip");
  const bundled = await fs.readFile(DEFAULT_BUNDLED_GUIDE_PACKET);
  const verified = verifyGuidePacket(bundled, { installedRevision: 0 });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  assert.equal(verified.manifest.packetVersion, "2026.08.12-r02-candidate");
  assert.equal(verified.manifest.packetRevision, 2);
  assert.equal(sha256(await fs.readFile(r01FixturePath)), "9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263");
});

function compilerInput(request) {
  const start = request.user.indexOf("{");
  assert.notEqual(start, -1, "compiler request must contain JSON input");
  return JSON.parse(request.user.slice(start));
}

function rebuildPacket(entries) {
  entries.delete("SHA256SUMS.txt");
  const checksums = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => `${sha256(data)}  ${name}`)
    .join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(checksums));
  return createStoredZip(
    [...entries.entries()].map(([name, data]) => ({ name, data })),
    new Date("2026-08-12T02:45:00.000Z")
  );
}

function removeGraphOwnedAdvancedReleaseBlock(buffer) {
  const entries = readZipEntries(buffer);
  const graphPath = "graphs/somatic.graph.json";
  const bundlePath = "graphs/bundle.json";
  const manifestPath = "manifest.json";
  const graph = JSON.parse(entries.get(graphPath).toString("utf8"));
  graph.nodes.find((node) => node.id === "SOM.ADVANCED_RELEASE_BLOCK").effects.blockNodes = [];
  const bundle = JSON.parse(entries.get(bundlePath).toString("utf8"));
  bundle.graphs.find((item) => item.graphId === graph.graphId).nodes = graph.nodes;
  const graphData = Buffer.from(canonicalJson(graph));
  entries.set(graphPath, graphData);
  entries.set(bundlePath, Buffer.from(canonicalJson(bundle)));
  const manifest = JSON.parse(entries.get(manifestPath).toString("utf8"));
  manifest.guides.find((guide) => guide.id === "somatic").graphSha256 = sha256(graphData);
  entries.set(manifestPath, Buffer.from(canonicalJson(manifest)));
  return rebuildPacket(entries);
}

test("r02 gives Opus complete hash-verified canonical prose and attached Vagal safety evidence", async () => {
  const buffer = await r02Bytes();
  const verified = verifyGuidePacket(buffer, { installedRevision: 0 });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  assert.equal(verified.manifest.packetVersion, "2026.08.12-r02-candidate");
  assert.equal(verified.manifest.packetRevision, 2);
  assert.ok(Array.isArray(verified.externalSources), "r02 verification must expose attached external source evidence");
  assert.equal(verified.externalSources.length, 1);
  assert.equal(verified.externalSources[0].id, "VAGAL.SAFETY.P5");
  assert.equal(verified.externalSources[0].page, 5);

  const compiler = new CapturingCompiler();
  await compileGuidePacketCandidate({ packetBuffer: buffer, compiler });
  const input = compilerInput(compiler.requests[0]);
  const innerSection = input.sourceSections["inner-child"].find((section) => section.id === "IC.CHICKEN_EGG");
  const somaticSection = input.sourceSections.somatic.find((section) => section.id === "SOM.MAP_NOT_LADDER");
  assert.match(innerSection.text, /The child remains\. What can change is who leads\./);
  assert.ok(innerSection.text.length > 1000, "inner-child canonical section must not be a short preview");
  assert.match(somaticSection.text, /map/i);
  assert.ok(somaticSection.text.length > 500, "somatic canonical section must not be a short preview");
  assert.equal(input.provenance.sourceFamilies.every((family) => family.availableInWorker === true), true);
  assert.equal(input.externalSourceExcerpts.length, 1);
  assert.equal(input.externalSourceExcerpts[0].id, "VAGAL.SAFETY.P5");
  assert.match(input.externalSourceExcerpts[0].text, /MANDATORY POSITIONING: Lying Down Only/i);
  assert.match(input.externalSourceExcerpts[0].text, /High Anxiety, Panic Disorder, or CPTSD/i);
  assert.equal(input.externalSourceExcerpts[0].independentlyValidated, false);
});

test("r02 owns the advanced-release suppression in the graph and embeds a mutation-sensitive fifth regression", async () => {
  const buffer = await r02Bytes();
  const verified = verifyGuidePacket(buffer, { installedRevision: 0 });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  const block = verified.graphs.flatMap((graph) => graph.nodes ?? []).find((node) => node.id === "SOM.ADVANCED_RELEASE_BLOCK");
  assert.deepEqual(block.effects.blockNodes, ["SOM.ADVANCED_RELEASE_OPTIONAL"]);

  const result = runGuidePacketRegressionSuite(buffer);
  assert.equal(result.ok, true, JSON.stringify(result.results));
  assert.equal(result.count, 5);
  assert.equal(result.passed, 5);
  assert.ok(result.results.some((item) => item.id === "G-SOM-ADVANCED-BLOCK"));

  const mutated = runGuidePacketRegressionSuite(removeGraphOwnedAdvancedReleaseBlock(buffer));
  assert.equal(mutated.ok, false);
  const safety = mutated.results.find((item) => item.id === "G-SOM-ADVANCED-BLOCK");
  assert.equal(safety.status, "fail");
  assert.match(safety.failures.join("\n"), /blockNodes|SOM\.ADVANCED_RELEASE_OPTIONAL/i);
});

test("r02 supersedes a blocked r01 candidate while preserving r01 bytes and unchanged owner decisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-r02-supersede-"));
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets")
  });
  const r01Bytes = await fs.readFile(r01FixturePath);
  const r01 = await stageGuidePacket(config, r01Bytes);
  await recordGuidePacketDecision(config, {
    candidateId: r01.packetId,
    cardId: "decision-1",
    decision: "keep-current",
    note: "Preserve this unchanged owner decision when the restorative packet supersedes r01."
  });
  await applyGuidePacketCompilation(config, r01.packetId, {
    contractVersion: "guide-packet-opus-compilation-v1",
    status: "blocked",
    compiledAt: "2026-08-12T01:00:00.000Z",
    compiler: { provider: "anthropic", model: "claude-opus-5", requestId: "blocked-r01" },
    report: {
      verdict: "blocked",
      summary: "Canonical source previews were empty.",
      unresolved_material_disagreement: true,
      source_roles: [],
      graph_changes: [],
      findings: [],
      worst_plausible_failure: "Unsupported rules could be certified."
    }
  });

  const oldCandidateDir = path.join(config.guidePacketRoot, "candidates", r01.packetId);
  const oldStateBefore = JSON.parse(await fs.readFile(path.join(oldCandidateDir, "state.json"), "utf8"));
  const result = await ensureBundledGuidePacketCandidate({
    config,
    fixturePath: r02FixturePath,
    compiler: null,
    reviewer: null
  });

  assert.equal(result.staged, true);
  assert.equal(result.reviewed, false);
  const status = await readGuidePacketStatus(config);
  assert.equal(status.candidate.packetVersion, "2026.08.12-r02-candidate");
  assert.equal(status.candidate.packetRevision, 2);
  assert.equal(status.installed, null);
  const carried = status.candidate.decisionCards.find((card) => card.id === "decision-1");
  assert.equal(carried.status, "keep-current");
  assert.equal(carried.ownerNote, "Preserve this unchanged owner decision when the restorative packet supersedes r01.");
  assert.equal(status.candidate.decisionCards.find((card) => card.id === "decision-5").status, "pending");

  const oldStateAfter = JSON.parse(await fs.readFile(path.join(oldCandidateDir, "state.json"), "utf8"));
  assert.deepEqual(oldStateAfter, oldStateBefore);
  assert.equal(sha256(await fs.readFile(path.join(oldCandidateDir, "original.zip"))), sha256(r01Bytes));
});
