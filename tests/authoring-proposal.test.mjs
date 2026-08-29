import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "../src/authoring/canonical-json.mjs";
import { createProposal, loadProposal } from "../src/authoring/proposal.mjs";
import { buildProposal, checkProposal, materializeProposal } from "../src/authoring/proposal-builder.mjs";
import { reconcileApprovedProposal } from "../src/authoring/reconcile.mjs";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import { canonicalJson as packetCanonicalJson } from "../src/guide-packet/contract.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function copyTree(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(path.join(sourceRoot, from), to, { recursive: true });
}

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-authoring-proposal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of [
    "guides",
    "guide-graphs",
    "corpus/graph-cases",
    "authoring/overlays",
    "authoring/migration",
    "authoring/obsidian/current"
  ]) await copyTree(directory, path.join(root, directory));
  for (const file of [
    "src/guide-graph/compiler.mjs",
    "src/guide-graph/contract.mjs",
    "src/guide-graph/planner.mjs",
    "src/guide-graph/regressions.mjs",
    "src/guide-graph/source-map.mjs",
    "src/guide-graph/validate.mjs"
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.copyFile(path.join(sourceRoot, file), path.join(root, file));
  }
  return root;
}

async function graphHashes(root) {
  const output = {};
  for (const file of ["inner-child.graph.json", "somatic.graph.json", "cross-guide.graph.json"]) {
    output[file] = sha256Bytes(await fs.readFile(path.join(root, "guide-graphs", "candidates", file)));
  }
  return output;
}

function approvePacket(buffer) {
  const entries = readZipEntries(buffer);
  const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
  decisions.cards = decisions.cards.map((card) => ({ ...card, status: "approve", ownerNote: "Synthetic test approval.", decidedAt: "1980-01-01T00:00:00.000Z" }));
  decisions.allApproved = true;
  decisions.status = "approved";
  decisions.decidedAt = "1980-01-01T00:00:00.000Z";
  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  manifest.status = "approved";
  manifest.candidateOnly = false;
  manifest.approvalRequired = false;
  manifest.approvedAt = decisions.decidedAt;
  manifest.approvalDecisionHash = createHash("sha256").update(Buffer.from(packetCanonicalJson(decisions))).digest("hex");
  entries.set("manifest.json", Buffer.from(packetCanonicalJson(manifest)));
  entries.set("audit/owner-decisions.json", Buffer.from(packetCanonicalJson(decisions)));
  entries.delete("SHA256SUMS.txt");
  const sums = [...entries.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`).join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(sums));
  return createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date("1980-01-01T00:00:00.000Z"));
}

test("proposal-new copies exact hash-bound records without changing graph authority", async (t) => {
  const root = await fixtureRoot(t);
  const before = await graphHashes(root);
  const created = await createProposal({ root, id: "neutral-title-r1", nodeIds: ["IC.NEUTRAL_WITNESS"], regressionIds: ["G001"] });
  assert.equal(created.selectedRecords, 1);
  assert.deepEqual(await graphHashes(root), before);
  const proposal = await loadProposal({ root, id: created.id });
  assert.equal(proposal.nodes[0].data.operation, "replace");
  assert.equal(proposal.nodes[0].record.id, "IC.NEUTRAL_WITNESS");
  assert.equal(proposal.nodes[0].data.base_record_sha256.length, 64);
});

test("no-change proposal round-trips, builds deterministically, and check does not write", async (t) => {
  const root = await fixtureRoot(t);
  await createProposal({ root, id: "neutral-roundtrip-r1", nodeIds: ["IC.NEUTRAL_WITNESS"] });
  const built = await buildProposal({ root, id: "neutral-roundtrip-r1" });
  assert.equal(built.changes, 0);
  assert.equal(built.decisions, 0);
  const receiptFile = path.join(root, "authoring", ".build", "neutral-roundtrip-r1", "receipt.json");
  const before = await fs.readFile(receiptFile, "utf8");
  const checked = await checkProposal({ root, id: "neutral-roundtrip-r1" });
  assert.equal(checked.ok, true);
  assert.equal(await fs.readFile(receiptFile, "utf8"), before);
});

test("proposal build emits an exact per-field decision card with regression evidence", async (t) => {
  const root = await fixtureRoot(t);
  await createProposal({ root, id: "neutral-title-r2", nodeIds: ["IC.NEUTRAL_WITNESS"], regressionIds: ["G001"] });
  const note = path.join(root, "authoring", "obsidian", "proposals", "neutral-title-r2", "nodes", "IC.NEUTRAL_WITNESS.md");
  const text = await fs.readFile(note, "utf8");
  await fs.writeFile(note, text.replace("title: Begin with a neutral witness", "title: Begin with a calm neutral witness"), "utf8");
  const built = await materializeProposal({ root, id: "neutral-title-r2" });
  assert.deepEqual(built.diff.changes.map((item) => item.fieldPath), ["title"]);
  assert.equal(built.decisions.length, 1);
  assert.match(built.decisions[0].current, /Begin with a neutral witness/);
  assert.match(built.decisions[0].candidate, /Begin with a calm neutral witness/);
  assert.ok(built.decisions[0].affectedRegressions.includes("G001"));
  assert.equal(built.packetVerification.ok, true);
  assert.equal(built.packetVerification.manifest.sourceMode, "repository-current-v1");
  assert.equal(built.packetVerification.installable, false);
  assert.equal(built.packetVerification.manifest.candidateOnly, true);
});

test("stale proposal base fails before writing build output", async (t) => {
  const root = await fixtureRoot(t);
  await createProposal({ root, id: "neutral-stale-r1", nodeIds: ["IC.NEUTRAL_WITNESS"] });
  const semanticInput = path.join(root, "src", "guide-graph", "planner.mjs");
  await fs.appendFile(semanticInput, "\n// synthetic stale-base change\n", "utf8");
  await assert.rejects(() => buildProposal({ root, id: "neutral-stale-r1" }), (error) => {
    assert.equal(error.code, "STALE_AUTHORING_BASE");
    assert.deepEqual(error.details.changedInputs.map((item) => item.path), ["src/guide-graph/planner.mjs"]);
    return true;
  });
  await assert.rejects(() => fs.access(path.join(root, "authoring", ".build", "neutral-stale-r1")));
});

test("coverage gate rejects a changed route without an affected declared case", async (t) => {
  const root = await fixtureRoot(t);
  await createProposal({ root, id: "neutral-uncovered-r1", nodeIds: ["IC.NEUTRAL_WITNESS"] });
  const note = path.join(root, "authoring", "obsidian", "proposals", "neutral-uncovered-r1", "nodes", "IC.NEUTRAL_WITNESS.md");
  const text = await fs.readFile(note, "utf8");
  await fs.writeFile(note, text.replace("title: Begin with a neutral witness", "title: Begin with a revised neutral witness"), "utf8");
  await assert.rejects(() => materializeProposal({ root, id: "neutral-uncovered-r1" }), { code: "PROPOSAL_REGRESSION_COVERAGE_GAP" });
});

test("proposal build rejects a symlinked canonical graph input", async (t) => {
  const root = await fixtureRoot(t);
  await createProposal({ root, id: "neutral-symlink-r1", nodeIds: ["IC.NEUTRAL_WITNESS"] });
  const graph = path.join(root, "guide-graphs", "candidates", "inner-child.graph.json");
  const external = path.join(root, "inner-child-external-copy.json");
  await fs.copyFile(graph, external);
  await fs.rm(graph);
  await fs.symlink(external, graph);
  await assert.rejects(() => materializeProposal({ root, id: "neutral-symlink-r1" }), { code: "AUTHORING_SYMLINK_FORBIDDEN" });
});

test("only an exact approved packet can reconcile candidate graphs on a task branch", async (t) => {
  const root = await fixtureRoot(t);
  const sourceBefore = await graphHashes(root);
  await createProposal({ root, id: "neutral-reconcile-r1", nodeIds: ["IC.NEUTRAL_WITNESS"], regressionIds: ["G001"] });
  const note = path.join(root, "authoring", "obsidian", "proposals", "neutral-reconcile-r1", "nodes", "IC.NEUTRAL_WITNESS.md");
  await fs.writeFile(note, (await fs.readFile(note, "utf8")).replace("title: Begin with a neutral witness", "title: Begin with a reconciled neutral witness"), "utf8");
  await buildProposal({ root, id: "neutral-reconcile-r1" });
  const candidatePacketPath = path.join(root, "authoring", ".build", "neutral-reconcile-r1", "packet", "proposal.zip");
  const candidateBuffer = await fs.readFile(candidatePacketPath);
  await assert.rejects(() => reconcileApprovedProposal({ root, id: "neutral-reconcile-r1", packetId: "authoring-neutral-reconcile-r1", packetPath: path.relative(root, candidatePacketPath), packetSha256: sha256Bytes(candidateBuffer), branchName: "codex/test-task" }), { code: "PACKET_NOT_APPROVED" });

  const approved = approvePacket(candidateBuffer);
  const approvedPath = path.join(root, "authoring", ".build", "neutral-reconcile-r1", "packet", "approved.zip");
  await fs.writeFile(approvedPath, approved);
  await assert.rejects(() => reconcileApprovedProposal({ root, id: "neutral-reconcile-r1", packetId: "authoring-wrong-packet-r1", packetPath: path.relative(root, approvedPath), packetSha256: sha256Bytes(approved), branchName: "codex/test-task", runCompleteGates: false }), { code: "PACKET_ID_MISMATCH" });
  const result = await reconcileApprovedProposal({ root, id: "neutral-reconcile-r1", packetId: "authoring-neutral-reconcile-r1", packetPath: path.relative(root, approvedPath), packetSha256: sha256Bytes(approved), branchName: "codex/test-task", runCompleteGates: false });
  assert.equal(result.installed, false);
  assert.equal(result.stableChanged, false);
  const graph = JSON.parse(await fs.readFile(path.join(root, "guide-graphs", "candidates", "inner-child.graph.json"), "utf8"));
  assert.equal(graph.nodes.find((node) => node.id === "IC.NEUTRAL_WITNESS").title, "Begin with a reconciled neutral witness");
  const projectedNote = await fs.readFile(path.join(root, "authoring", "obsidian", "current", "nodes", "inner-child-directed-graph", "IC.NEUTRAL_WITNESS.md"), "utf8");
  assert.match(projectedNote, /^title: Begin with a reconciled neutral witness$/m);
  assert.match(await fs.readFile(path.join(root, "authoring", "obsidian", "proposals", "neutral-reconcile-r1", "proposal.md"), "utf8"), /^status: reconciled$/m);
  const after = await graphHashes(root);
  assert.equal(after["somatic.graph.json"], sourceBefore["somatic.graph.json"]);
  assert.equal(after["cross-guide.graph.json"], sourceBefore["cross-guide.graph.json"]);
});
