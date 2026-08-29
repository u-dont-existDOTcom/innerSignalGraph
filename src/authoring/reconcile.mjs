import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { readZipEntries } from "../core/zip.mjs";
import { compileGuideGraphs } from "../guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../guide-graph/regressions.mjs";
import { canonicalJson, sha256Bytes } from "./canonical-json.mjs";
import { buildMapFiles, writeMapFiles } from "./map-files.mjs";
import { parseAuthoringNote } from "./note-parser.mjs";
import { assertNoSymlinkAncestors, assertPublicAuthoringText, resolveInside } from "./private-data-boundary.mjs";
import { createCurrentProjection, loadCurrentAuthority } from "./projection.mjs";
import { assertProjectionCurrent, writeProjectionAtomically } from "./projection-check.mjs";
import { verifyGuidePacket } from "../guide-packet/verifier.mjs";
import { safePacketId } from "../guide-packet/contract.mjs";

const execFileAsync = promisify(execFile);
const GRAPH_PATHS = Object.freeze({
  "inner-child-directed-graph": "guide-graphs/candidates/inner-child.graph.json",
  "somatic-directed-graph": "guide-graphs/candidates/somatic.graph.json",
  "inner-child-somatic-cross-guide": "guide-graphs/candidates/cross-guide.graph.json"
});

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

async function currentBranch(root) {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
  return stdout.trim();
}

function assertTaskBranch(branch) {
  if (!branch || /^(?:main|master|stable|release(?:\/.*)?)$/i.test(branch)) fail("RECONCILE_PROTECTED_BRANCH", `Proposal reconciliation is forbidden on protected branch ${branch || "(detached)"}.`);
}

async function copyIfPresent(source, destination) {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function restoreSnapshot(root, snapshot, paths) {
  for (const relative of paths) {
    const target = path.join(root, relative);
    await fs.rm(target, { recursive: true, force: true });
    await copyIfPresent(path.join(snapshot, relative), target);
  }
}

function reconciledProposalText(text) {
  const parsed = parseAuthoringNote(text, { label: "proposal manifest" });
  if (!["approved", "awaiting-owner", "built", "draft"].includes(parsed.data.status)) fail("PROPOSAL_STATUS_INVALID", `Proposal status ${parsed.data.status} cannot transition to reconciled.`);
  return text.replace(/^status: .+$/m, "status: reconciled");
}

async function runCompletePackageGate(root) {
  try {
    await execFileAsync("npm", ["run", "verify"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    fail("RECONCILE_PACKAGE_GATE_FAILED", "Reconciled graph failed the complete package verification gate.", { stdout: error.stdout ?? "", stderr: error.stderr ?? "" });
  }
}

export async function reconcileApprovedProposal({ root, id, packetId, packetPath, packetSha256, branchName = null, runCompleteGates = true }) {
  let expectedPacketId;
  try { expectedPacketId = safePacketId(packetId); }
  catch { fail("PACKET_ID_REQUIRED", "Reconciliation requires the exact approved packet id."); }
  if (!/^[a-f0-9]{64}$/.test(packetSha256 ?? "")) fail("PACKET_SHA256_REQUIRED", "Reconciliation requires the exact lowercase packet SHA-256.");
  const branch = branchName ?? await currentBranch(root);
  assertTaskBranch(branch);
  assertNoSymlinkAncestors(root, packetPath, { allowMissingLeaf: false });
  const packetFile = resolveInside(root, packetPath);
  const buffer = await withOpenedRegularFile(packetFile, (handle) => handle.readFile());
  const actualPacketSha256 = sha256Bytes(buffer);
  if (actualPacketSha256 !== packetSha256) fail("PACKET_SHA256_MISMATCH", "Supplied packet SHA-256 does not match the approved packet bytes.");

  const authority = await loadCurrentAuthority({ root });
  const verified = verifyGuidePacket(buffer, { installedBundle: authority.bundle });
  if (!verified.ok || !verified.approved) fail("PACKET_NOT_APPROVED", `Packet is not a fully verified owner-approved proposal packet: ${verified.errors.join("; ")}`);
  if (verified.manifest.packetId !== expectedPacketId) fail("PACKET_ID_MISMATCH", "Supplied packet id does not match the approved packet manifest.");
  if (verified.manifest.sourceMode !== "repository-current-v1" || verified.manifest.proposalId !== id) fail("PACKET_PROPOSAL_MISMATCH", "Approved packet does not identify this repository authoring proposal.");
  if (verified.manifest.baseProjectionInputSha256 !== authority.projectionInputSha256) fail("STALE_AUTHORING_BASE", "Canonical authority changed after the approved proposal packet was built.");

  const entries = readZipEntries(buffer);
  const candidates = [];
  for (const record of verified.manifest.candidateGraphs ?? []) {
    const target = GRAPH_PATHS[record.graphId];
    const data = entries.get(record.path);
    if (!target || !data || sha256Bytes(data) !== record.sha256) fail("PACKET_CANDIDATE_GRAPH_INVALID", `Approved packet candidate graph is missing or invalid: ${record.graphId}.`);
    let graph;
    try { graph = JSON.parse(data.toString("utf8")); } catch (error) { fail("PACKET_CANDIDATE_GRAPH_INVALID", `${record.graphId} is invalid JSON: ${error.message}`); }
    if (graph.graphId !== record.graphId) fail("PACKET_CANDIDATE_GRAPH_INVALID", `${record.path} has the wrong graphId.`);
    candidates.push({ graphId: record.graphId, target, data, graph });
  }
  if (candidates.length !== Object.keys(GRAPH_PATHS).length) fail("PACKET_CANDIDATE_GRAPH_INVALID", "Approved packet must contain all canonical candidate graphs.");
  const compiled = await compileGuideGraphs({ root, write: false, candidateGraphs: Object.keys(GRAPH_PATHS).map((graphId) => candidates.find((item) => item.graphId === graphId).graph) });
  if (canonicalJson(compiled) !== canonicalJson(verified.packetGraphBundle)) fail("PACKET_CANDIDATE_BUNDLE_MISMATCH", "Approved candidate graph members do not compile to the approved packet bundle.");
  const regression = await runGraphRegressionSuite({ root, bundle: compiled });
  if (!regression.ok) fail("PROPOSAL_REGRESSION_FAILURE", "Approved candidate graph fails canonical regressions.");

  const proposalRelative = `authoring/obsidian/proposals/${id}/proposal.md`;
  assertNoSymlinkAncestors(root, proposalRelative, { allowMissingLeaf: false });
  const proposalFile = resolveInside(root, proposalRelative);
  const proposalText = await withOpenedRegularFile(proposalFile, (handle) => handle.readFile("utf8"));
  const nextProposalText = reconciledProposalText(proposalText);
  assertPublicAuthoringText(nextProposalText, { label: proposalRelative });
  const snapshotPaths = [
    "guide-graphs/candidates", "guide-graphs/compiled", "guide-graphs/source-maps", "guide-graphs/reports",
    "authoring/obsidian/current", "docs/INNER-CHILD-THERAPY-MAP.md", proposalRelative
  ];
  const snapshot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-reconcile-backup-"));
  const temporaryFiles = new Set();
  for (const relative of snapshotPaths) await copyIfPresent(path.join(root, relative), path.join(snapshot, relative));
  try {
    for (const item of candidates) {
      const file = path.join(root, item.target);
      const temporary = `${file}.${process.pid}.reconcile`;
      temporaryFiles.add(temporary);
      await fs.writeFile(temporary, item.data, { flag: "wx" });
      await fs.rename(temporary, file);
      temporaryFiles.delete(temporary);
    }
    const proposalTemporary = `${proposalFile}.${process.pid}.reconcile`;
    temporaryFiles.add(proposalTemporary);
    await fs.writeFile(proposalTemporary, nextProposalText, { encoding: "utf8", flag: "wx" });
    await fs.rename(proposalTemporary, proposalFile);
    temporaryFiles.delete(proposalTemporary);
    await compileGuideGraphs({ root, write: true });
    const projected = await createCurrentProjection({ root });
    await writeProjectionAtomically(projected.output, path.join(root, "authoring", "obsidian", "current"));
    await writeMapFiles({ root, files: buildMapFiles(projected.authority) });
    await assertProjectionCurrent(projected.output, path.join(root, "authoring", "obsidian", "current"));
    const finalRegression = await runGraphRegressionSuite({ root });
    if (!finalRegression.ok) fail("PROPOSAL_REGRESSION_FAILURE", "Reconciled graph fails canonical regressions.");
    if (runCompleteGates) await runCompletePackageGate(root);
    const result = {
      contractVersion: "inner-signal-authoring-reconciliation-v1",
      proposalId: id,
      packetId: verified.manifest.packetId,
      packetSha256,
      branch,
      candidateGraphs: candidates.map((item) => ({ graphId: item.graphId, path: item.target, sha256: sha256Bytes(item.data) })),
      compiledBundleSha256: sha256Bytes(Buffer.from(`${JSON.stringify(projected.authority.bundle, null, 2)}\n`, "utf8")),
      projectionInputSha256: projected.authority.projectionInputSha256,
      regressionStatus: { ok: finalRegression.ok, count: finalRegression.count },
      installed: false,
      stableChanged: false
    };
    const receipt = path.join(root, "authoring", ".build", id, "reconciliation.json");
    await fs.mkdir(path.dirname(receipt), { recursive: true });
    const receiptTemporary = `${receipt}.${process.pid}.reconcile`;
    temporaryFiles.add(receiptTemporary);
    await fs.writeFile(receiptTemporary, canonicalJson(result), { encoding: "utf8", flag: "wx" });
    await fs.rename(receiptTemporary, receipt);
    temporaryFiles.delete(receiptTemporary);
    return result;
  } catch (error) {
    await Promise.all([...temporaryFiles].map((file) => fs.rm(file, { force: true })));
    await restoreSnapshot(root, snapshot, snapshotPaths);
    throw error;
  } finally {
    await fs.rm(snapshot, { recursive: true, force: true });
  }
}
