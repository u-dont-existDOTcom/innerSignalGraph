// Records the owner's 2026-09-26 instruction against the exact D09 candidate
// packet and produces the approved derivative consumed by
// `npm run authoring:proposal:reconcile`. The candidate packet is rebuilt
// deterministically by `npm run authoring:proposal:build -- --id nonpunitive-review-20260926`
// on the pre-reconciliation base; its bytes are not committed (2 MB), so this
// script refuses to run unless they match the recorded SHA-256 exactly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStoredZip, readZipEntries } from "../../../src/core/zip.mjs";
import { canonicalJson } from "../../../src/guide-packet/contract.mjs";
import { verifyGuidePacket } from "../../../src/guide-packet/verifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const proposalId = "nonpunitive-review-20260926";
const packetId = `authoring-${proposalId}`;
const sourceRelative = `authoring/.build/${proposalId}/packet/proposal.zip`;
const approvedRelative = `authoring/.build/${proposalId}/packet/approved.zip`;
const approvalRelative = "tasks/nonpunitive-review-20260926/approval/OWNER-APPROVAL.json";
const sourcePacketSha256 = "1d103cfded4d662072c448fb983bebf24a09946f080cd78294279a9d77dc39bc";
const decidedAt = "2026-09-26T01:30:04.000Z";
const ownerNote = "Owner instruction 2026-09-26 (relayed by the supervising session): \"yes that is important\" — build the approved non-punitive review into the current map, resolving the pending D09 sub-decisions consistently with the owner-approved lines and the current map. Worker resolution: every card carries the owner-revised 2026-08-29 D09 wording verbatim; see tasks/nonpunitive-review-20260926/INTEGRATION.md. Final owner review happens at pull-request merge.";

// Exact expected card set: the nine D09 sub-decisions from closed PR #14 mapped
// onto the current records, plus the third owner-approved overlay anchor.
const expectedCards = new Set([
  "node IC.ADULT_APPRENTICE: recommendations",
  "node IC.ADULT_APPRENTICE: avoid",
  "node IC.ADULT_APPRENTICE: successSignals",
  "node IC.ADULT_APPRENTICE: effects.requiredNuance",
  "node IC.ADULT_APPRENTICE: sourceRefs",
  "node IC.CREDIBILITY_REPAIR: recommendations",
  "node IC.CREDIBILITY_REPAIR: avoid",
  "node IC.CREDIBILITY_REPAIR: effects.requiredNuance",
  "node IC.CREDIBILITY_REPAIR: sourceRefs",
  "node IC.PROTECTOR_ACTION: recommendations",
  "node IC.PROTECTOR_ACTION: avoid",
  "node IC.PROTECTOR_ACTION: sourceRefs"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const source = await fs.readFile(path.join(root, sourceRelative));
assert.equal(sha256(source), sourcePacketSha256, "Candidate packet does not match the recorded SHA-256.");
const entries = readZipEntries(source);
const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
const decisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
assert.equal(manifest.packetId, packetId);
assert.equal(manifest.proposalId, proposalId);
assert.equal(manifest.status, "candidate");
assert.equal(decisions.status, "awaiting-owner");
assert.equal(decisions.allApproved, false);
assert.deepEqual(new Set(decisions.cards.map((card) => card.title)), expectedCards);
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

const approval = {
  contractVersion: "inner-signal-owner-approval-record-v1",
  proposalId,
  packetId,
  sourcePacket: { path: sourceRelative, sha256: sourcePacketSha256, decisionCards: decisions.cards.length, committed: false },
  decision: {
    authority: "owner-instruction-relayed-by-supervising-session-with-delegated-subdecision-resolution",
    ownerQuote: "yes that is important",
    ownerApprovedUserFacingLines: [
      "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time.",
      "When an effort at improvement doesn’t go as hoped, name what happened, repair what can be repaired, and make the next promise more credible."
    ],
    underlyingOwnerDecision: "OWNER.MAP.RESOLUTION.2026-08-29.D09",
    scope: "approve-all-exact-decision-cards",
    status: "approved",
    allApproved: true,
    decidedAt,
    ownerNote,
    workerResolvedSubdecisions: true,
    ownerReviewAtMerge: true,
    approvalDecisionSha256: manifest.approvalDecisionHash
  },
  approvedPacket: { path: approvedRelative, sha256: approvedPacketSha256, verified: verification.ok, approved: verification.approved, committed: false },
  boundaries: {
    reconciliationAuthorized: true,
    mergeAuthorized: false,
    installAuthorized: false,
    deployAuthorized: false,
    stablePromotionAuthorized: false
  }
};

await fs.writeFile(path.join(root, approvedRelative), approved);
await fs.writeFile(path.join(root, approvalRelative), canonicalJson(approval), "utf8");
process.stdout.write(canonicalJson({ packetId, sourcePacketSha256, approvedPacketSha256, approvalDecisionSha256: manifest.approvalDecisionHash, decisionCards: decisions.cards.length, verified: verification.ok, approved: verification.approved }) + "\n");
