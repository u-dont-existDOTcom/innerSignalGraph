import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildProposalGuidePacket } from "../src/authoring/proposal-packet.mjs";
import { loadCurrentAuthority } from "../src/authoring/projection.mjs";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import { verifyGuidePacket } from "../src/guide-packet/verifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function rezipWithChecksums(entries) {
  const next = new Map(entries);
  next.delete("SHA256SUMS.txt");
  const sums = [...next.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`).join("\n") + "\n";
  next.set("SHA256SUMS.txt", Buffer.from(sums));
  return createStoredZip([...next.entries()].map(([name, data]) => ({ name, data })), new Date("1980-01-01T00:00:00.000Z"));
}

test("repository-source proposal packet preserves exact sources and remains owner-gated", async () => {
  const authority = await loadCurrentAuthority({ root });
  const graphFiles = ["inner-child.graph.json", "somatic.graph.json", "cross-guide.graph.json"];
  const candidateGraphs = await Promise.all(graphFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(root, "guide-graphs", "candidates", file), "utf8"))));
  const caseRows = authority.regressionCases.map((definition) => ({ id: definition.id, affectedNodeIds: [] }));
  const evidence = { contractVersion: "inner-signal-proposal-evidence-v1", proposalId: "packet-no-change-r1", manifestBody: "No semantic change.", nodeEvidence: [], edgeEvidence: [], proposedTests: [] };
  const packet = await buildProposalGuidePacket({
    proposal: { id: "packet-no-change-r1", manifest: { base_projection_input_sha256: authority.projectionInputSha256 } },
    authority,
    candidateGraphs,
    candidateBundle: authority.bundle,
    diff: { contractVersion: "guide-behavioral-diff-v2", installedVersion: authority.bundle.version, baselineVersion: authority.bundle.version, candidateVersion: authority.bundle.version, changes: [], changedNodeIds: [], affectedCases: [], substantive: false },
    decisions: [],
    regressionCases: authority.regressionCases,
    caseRows,
    provenanceImpact: { contractVersion: "inner-signal-provenance-impact-v1", ok: true, changes: [], unresolved: [] },
    evidence
  });
  const verified = verifyGuidePacket(packet.buffer, { installedBundle: authority.bundle });
  assert.equal(verified.ok, true, verified.errors.join("\n"));
  assert.equal(verified.approved, false);
  assert.equal(verified.installable, false);
  assert.equal(verified.manifest.sourceMode, "repository-current-v1");
  assert.equal(verified.regressionStatus.passed, authority.regressionCases.length);
  assert.equal(verified.manifest.repositorySources.every((source) => source.sourceSha256.length === 64), true);

  const sourceMapEntries = readZipEntries(packet.buffer);
  const bundle = JSON.parse(sourceMapEntries.get("graphs/bundle.json").toString("utf8"));
  bundle.sourceMaps[0].sections[0].heading += " tampered";
  sourceMapEntries.set("graphs/bundle.json", Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`));
  const sourceMapResult = verifyGuidePacket(rezipWithChecksums(sourceMapEntries), { installedBundle: authority.bundle });
  assert.equal(sourceMapResult.ok, false);
  assert.match(sourceMapResult.errors.join("\n"), /source map differs|behavioral diff could not be built/i);

  const candidateEntries = readZipEntries(packet.buffer);
  const manifest = JSON.parse(candidateEntries.get("manifest.json").toString("utf8"));
  const candidateRecord = manifest.candidateGraphs[0];
  const candidate = JSON.parse(candidateEntries.get(candidateRecord.path).toString("utf8"));
  candidate.description += " tampered";
  const candidateData = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  candidateEntries.set(candidateRecord.path, candidateData);
  candidateRecord.sha256 = createHash("sha256").update(candidateData).digest("hex");
  candidateEntries.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  const candidateResult = verifyGuidePacket(rezipWithChecksums(candidateEntries), { installedBundle: authority.bundle });
  assert.equal(candidateResult.ok, false);
  assert.match(candidateResult.errors.join("\n"), /does not compile to packet bundle member/i);

  const diffEntries = readZipEntries(packet.buffer);
  const embeddedDiff = JSON.parse(diffEntries.get("audit/behavioral-diff.json").toString("utf8"));
  embeddedDiff.contractVersion = "incomplete-diff";
  diffEntries.set("audit/behavioral-diff.json", Buffer.from(`${JSON.stringify(embeddedDiff, null, 2)}\n`));
  const diffResult = verifyGuidePacket(rezipWithChecksums(diffEntries), { installedBundle: authority.bundle });
  assert.equal(diffResult.ok, false);
  assert.match(diffResult.errors.join("\n"), /complete guide-behavioral-diff-v2/i);
});
