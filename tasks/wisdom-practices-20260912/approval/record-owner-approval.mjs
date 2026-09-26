import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStoredZip, readZipEntries } from "../../../src/core/zip.mjs";
import { canonicalJson } from "../../../src/guide-packet/contract.mjs";
import { verifyGuidePacket } from "../../../src/guide-packet/verifier.mjs";

const taskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRelative = "candidate/packet/proposal.zip";
const approvedRelative = "approval/authoring-wisdom-practices-20260912-approved.zip";
const approvalRelative = "approval/OWNER-APPROVAL.json";
const sourcePath = path.join(taskRoot, sourceRelative);
const approvedPath = path.join(taskRoot, approvedRelative);
const approvalPath = path.join(taskRoot, approvalRelative);
const sourcePacketSha256 = "f2d67e1990ceadb4120955c4c46c65d95aed0ad0c0270f2e6d652f778fa4ab8c";
const packetId = "authoring-wisdom-practices-20260912";
const proposalId = "wisdom-practices-20260912";
const decidedAt = "2026-09-12T14:48:55.000Z";
const ownerNote = "Owner approved all 32 exact decision cards in Chat.";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const source = await fs.readFile(sourcePath);
assert.equal(sha256(source), sourcePacketSha256, "Source proposal packet does not match the owner-approved SHA-256.");
const entries = readZipEntries(source);
const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
assert.equal(manifest.packetId, packetId);
assert.equal(manifest.proposalId, proposalId);
assert.equal(manifest.status, "candidate");
assert.equal(decisions.status, "awaiting-owner");
assert.equal(decisions.allApproved, false);
assert.equal(decisions.cards.length, 32);
assert.ok(decisions.cards.every((card) => card.status === "pending"));

decisions.cards = decisions.cards.map((card) => ({ ...card, status: "approve", ownerNote, decidedAt }));
decisions.allApproved = true;
decisions.status = "approved";
decisions.decidedAt = decidedAt;
manifest.status = "approved";
manifest.candidateOnly = false;
manifest.approvalRequired = false;
manifest.approvedAt = decidedAt;
manifest.approvalDecisionHash = sha256(Buffer.from(canonicalJson(decisions)));
entries.set("manifest.json", Buffer.from(canonicalJson(manifest)));
entries.set("audit/owner-decisions.json", Buffer.from(canonicalJson(decisions)));
entries.delete("SHA256SUMS.txt");
const sums = [...entries.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, data]) => `${sha256(data)}  ${name}`)
  .join("\n") + "\n";
entries.set("SHA256SUMS.txt", Buffer.from(sums));
const approved = createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date(decidedAt));
const verification = verifyGuidePacket(approved);
assert.equal(verification.ok, true, verification.errors.join("; "));
assert.equal(verification.approved, true, "Approved packet did not satisfy the exact approval contract.");
const approvedPacketSha256 = sha256(approved);
const approvalDecisionSha256 = sha256(Buffer.from(canonicalJson(decisions)));

const approval = {
  contractVersion: "inner-signal-owner-approval-record-v1",
  proposalId,
  packetId,
  sourcePacket: {
    path: sourceRelative,
    sha256: sourcePacketSha256,
    decisionCards: decisions.cards.length
  },
  decision: {
    authority: "owner-explicit-chat-approval",
    scope: "approve-all-exact-decision-cards",
    status: "approved",
    allApproved: true,
    decidedAt,
    ownerNote,
    approvalDecisionSha256
  },
  approvedPacket: {
    path: approvedRelative,
    sha256: approvedPacketSha256,
    verified: verification.ok,
    approved: verification.approved
  },
  boundaries: {
    reconciliationAuthorized: true,
    mergeAuthorized: true,
    installAuthorized: false,
    deployAuthorized: false,
    stablePromotionAuthorized: false
  }
};

await fs.mkdir(path.dirname(approvedPath), { recursive: true });
await fs.writeFile(approvedPath, approved);
await fs.writeFile(approvalPath, canonicalJson(approval), "utf8");
process.stdout.write(canonicalJson({
  packetId,
  sourcePacketSha256,
  approvedPacketSha256,
  approvalDecisionSha256,
  decisionCards: decisions.cards.length,
  verified: verification.ok,
  approved: verification.approved
}));
