import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildProposal } from "../src/authoring/proposal-builder.mjs";
import { reconcileApprovedProposal } from "../src/authoring/reconcile.mjs";
import { sha256Bytes } from "../src/authoring/canonical-json.mjs";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import { canonicalJson as packetCanonicalJson } from "../src/guide-packet/contract.mjs";

const root = process.cwd();
const proposalId = "love-horizon-r1";
const decidedAt = "2026-09-02T01:22:00.000Z";
const ownerNote = "Owner approved the final love-horizon, suicidal self/death inquiry, and suicidal adult-seat map and explicitly authorized reconciliation and merge to main in ChatGPT on 2026-09-02.";

function approvePacket(buffer) {
  const entries = readZipEntries(buffer);
  const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
  if (!Array.isArray(decisions.cards) || decisions.cards.length === 0) {
    throw new Error("Owner-approved reconciliation requires at least one substantive decision card.");
  }

  decisions.cards = decisions.cards.map((card) => ({
    ...card,
    status: "approve",
    ownerNote,
    decidedAt
  }));
  decisions.allApproved = true;
  decisions.status = "approved";
  decisions.decidedAt = decidedAt;

  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  manifest.status = "approved";
  manifest.candidateOnly = false;
  manifest.approvalRequired = false;
  manifest.approvedAt = decidedAt;
  manifest.approvalDecisionHash = createHash("sha256")
    .update(Buffer.from(packetCanonicalJson(decisions)))
    .digest("hex");

  entries.set("manifest.json", Buffer.from(packetCanonicalJson(manifest)));
  entries.set("audit/owner-decisions.json", Buffer.from(packetCanonicalJson(decisions)));
  entries.delete("SHA256SUMS.txt");

  const sums = [...entries.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}`)
    .join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(sums));

  return {
    buffer: createStoredZip(
      [...entries.entries()].map(([name, data]) => ({ name, data })),
      new Date("1980-01-01T00:00:00.000Z")
    ),
    packetId: manifest.packetId,
    decisionCount: decisions.cards.length
  };
}

await buildProposal({ root, id: proposalId });
const packetDir = path.join(root, "authoring", ".build", proposalId, "packet");
const candidatePath = path.join(packetDir, "proposal.zip");
const candidate = await fs.readFile(candidatePath);
const approved = approvePacket(candidate);
const approvedPath = path.join(packetDir, "owner-approved.zip");
await fs.writeFile(approvedPath, approved.buffer);

const result = await reconcileApprovedProposal({
  root,
  id: proposalId,
  packetId: approved.packetId,
  packetPath: path.relative(root, approvedPath),
  packetSha256: sha256Bytes(approved.buffer),
  runCompleteGates: true
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  ownerApproval: {
    decidedAt,
    decisionCount: approved.decisionCount,
    packetId: approved.packetId,
    packetSha256: sha256Bytes(approved.buffer)
  },
  reconciliation: result
}, null, 2)}\n`);
