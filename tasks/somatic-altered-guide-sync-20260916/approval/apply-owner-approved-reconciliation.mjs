import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createStoredZip, readZipEntries } from "../../../src/core/zip.mjs";
import { canonicalJson } from "../../../src/guide-packet/contract.mjs";
import { verifyGuidePacket } from "../../../src/guide-packet/verifier.mjs";
import { createProposal } from "../../../src/authoring/proposal.mjs";
import { parseAuthoringNote } from "../../../src/authoring/note-parser.mjs";
import { renderFrontmatterNote, renderNodeNote } from "../../../src/authoring/note-renderer.mjs";
import { AUTHORING_CONTRACTS, NODE_PAYLOAD_FIELDS, edgeDigest, edgeId, validateSchema } from "../../../src/authoring/contract.mjs";
import { blankCaseVariables } from "../../../src/guide-graph/contract.mjs";
import { reconcileApprovedProposal } from "../../../src/authoring/reconcile.mjs";

const root = process.cwd();
const id = process.env.PROPOSAL_ID ?? "somatic-altered-guide-sync-20260916";
const baseSha = process.env.BASE_SHA ?? "5bc037327392eef45b3c0f7bf4e3be0a3f341245";
const reviewedHead = process.env.REVIEWED_HEAD ?? "827e7f771aaf2b3ad9966f92be79e14b4c423772";
const decidedAt = process.env.DECIDED_AT ?? "2026-09-16T19:03:00.000Z";
const ownerNote = process.env.OWNER_NOTE ?? "Owner approved all five grouped semantic decisions in Chat, covering all 31 exact decision cards.";
const taskRoot = path.join(root, "tasks", id);
const proposalRoot = path.join(root, "authoring", "obsidian", "proposals", id);
const candidateDir = path.join(process.env.RUNNER_TEMP ?? path.join(root, ".tmp"), "owner-reviewed-candidate");
const graphFiles = {
  "inner-child-directed-graph": "inner-child.graph.json",
  "somatic-directed-graph": "somatic.graph.json",
  "inner-child-somatic-cross-guide": "cross-guide.graph.json"
};
const graphPaths = Object.values(graphFiles).map((filename) => `guide-graphs/candidates/${filename}`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", maxBuffer: 32 * 1024 * 1024, ...options });
}

// Bind approval to the exact graph candidate reviewed by the owner.
run("git", ["diff", "--quiet", reviewedHead, "--", ...graphPaths]);
await fs.rm(candidateDir, { recursive: true, force: true });
await fs.mkdir(candidateDir, { recursive: true });
for (const filename of Object.values(graphFiles)) {
  await fs.copyFile(path.join(root, "guide-graphs", "candidates", filename), path.join(candidateDir, filename));
}

// Reconstruct the canonical pre-change authoring base inside this isolated checkout.
run("git", ["checkout", baseSha, "--", ...graphPaths]);
run("npm", ["run", "graph:compile"]);
run("npm", ["run", "authoring:project"]);

await fs.rm(proposalRoot, { recursive: true, force: true });
await createProposal({
  root,
  id,
  nodeIds: ["IC.ALTERED_STATE_GATE", "SOM.MEANING_INTEGRATION", "ROUTE.GO_INWARD"]
});

const anchorNodes = {
  "inner-child-directed-graph": "IC.ALTERED_STATE_GATE",
  "somatic-directed-graph": "SOM.MEANING_INTEGRATION",
  "inner-child-somatic-cross-guide": "ROUTE.GO_INWARD"
};
const candidateGraphs = new Map();
const baseGraphs = new Map();
const baseMeta = new Map();

for (const [graphId, filename] of Object.entries(graphFiles)) {
  candidateGraphs.set(graphId, JSON.parse(await fs.readFile(path.join(candidateDir, filename), "utf8")));
  baseGraphs.set(graphId, JSON.parse(await fs.readFile(path.join(root, "guide-graphs", "candidates", filename), "utf8")));
  const anchor = parseAuthoringNote(await fs.readFile(path.join(proposalRoot, "nodes", `${anchorNodes[graphId]}.md`), "utf8"));
  baseMeta.set(graphId, {
    baseGraphSha256: anchor.data.base_graph_sha256,
    baseProjectionInputSha256: anchor.data.base_projection_input_sha256
  });
}

const expectedAddedNodes = new Set([
  "SOM.SIBAM_TRACKING",
  "SOM.CONSENSUAL_TOUCH",
  "SOM.AQUATIC_BODYWORK",
  "ROUTE.ALTERED_MEDICAL_SAFETY",
  "ROUTE.ALTERED_ACUTE_STABILIZATION",
  "ROUTE.ALTERED_ACTION_LOCK",
  "ROUTE.ALTERED_PREPARATION",
  "ROUTE.ALTERED_STABLE_THERAPY",
  "ROUTE.ALTERED_AFTERMATH"
]);
const expectedChangedNodes = new Set(["IC.ALTERED_STATE_GATE", "SOM.MEANING_INTEGRATION"]);
const actualAddedNodes = new Set();
const actualChangedNodes = new Set();

for (const [graphId, candidate] of candidateGraphs) {
  const base = baseGraphs.get(graphId);
  const baseById = new Map(base.nodes.map((node) => [node.id, node]));
  const candidateById = new Map(candidate.nodes.map((node) => [node.id, node]));
  for (const node of base.nodes) assert(candidateById.has(node.id), `Unexpected removed node ${node.id}.`);
  for (const node of candidate.nodes) {
    const old = baseById.get(node.id);
    if (!old) actualAddedNodes.add(node.id);
    else if (canonicalJson(old) !== canonicalJson(node)) actualChangedNodes.add(node.id);
  }
}
assert.deepEqual([...actualAddedNodes].sort(), [...expectedAddedNodes].sort(), "Added-node set drifted from the reviewed candidate.");
assert.deepEqual([...actualChangedNodes].sort(), [...expectedChangedNodes].sort(), "Changed-node set drifted from the reviewed candidate.");

function payloadFor(node) {
  return Object.fromEntries(NODE_PAYLOAD_FIELDS.filter((field) => Object.hasOwn(node, field)).map((field) => [field, node[field]]));
}

function frontmatterFor(node, graphId, operation, meta, baseRecordSha256 = undefined) {
  const value = {
    authoring_contract: AUTHORING_CONTRACTS.nodeProposal,
    entity_type: "graph-node-proposal",
    proposal_id: id,
    operation,
    graph_id: graphId,
    node_id: node.id,
    title: node.title,
    kind: node.kind,
    tier: node.tier,
    priority: node.priority,
    authority: node.authority,
    graph_tags: node.tags,
    source_refs: node.sourceRefs,
    base_graph_sha256: meta.baseGraphSha256,
    base_projection_input_sha256: meta.baseProjectionInputSha256
  };
  if (baseRecordSha256) value.base_record_sha256 = baseRecordSha256;
  validateSchema("nodeProposal", value, { label: `${id}/${node.id}` });
  return value;
}

async function writeNodeProposal(node, graphId, operation, baseRecordSha256 = undefined) {
  const text = renderNodeNote({
    frontmatter: frontmatterFor(node, graphId, operation, baseMeta.get(graphId), baseRecordSha256),
    payload: payloadFor(node),
    heading: node.title,
    warning: "Editable proposal record. Building it never changes canonical graph files.",
    rationaleTemplate: true
  });
  await fs.writeFile(path.join(proposalRoot, "nodes", `${node.id}.md`), text);
}

for (const [graphId, nodeId] of [
  ["inner-child-directed-graph", "IC.ALTERED_STATE_GATE"],
  ["somatic-directed-graph", "SOM.MEANING_INTEGRATION"]
]) {
  const currentProposal = parseAuthoringNote(await fs.readFile(path.join(proposalRoot, "nodes", `${nodeId}.md`), "utf8"));
  const candidateNode = candidateGraphs.get(graphId).nodes.find((node) => node.id === nodeId);
  await writeNodeProposal(candidateNode, graphId, "replace", currentProposal.data.base_record_sha256);
}

for (const [graphId, graph] of candidateGraphs) {
  for (const node of graph.nodes) if (expectedAddedNodes.has(node.id)) await writeNodeProposal(node, graphId, "add");
}

const addedEdges = [];
for (const [graphId, candidate] of candidateGraphs) {
  const base = baseGraphs.get(graphId);
  const key = (edge) => `${edge.from}\u0000${edge.relation}\u0000${edge.to}`;
  const baseKeys = new Set(base.edges.map(key));
  const candidateKeys = new Set(candidate.edges.map(key));
  const removed = base.edges.filter((edge) => !candidateKeys.has(key(edge)));
  assert.equal(removed.length, 0, `Unexpected removed edges in ${graphId}.`);
  for (const edge of candidate.edges) if (!baseKeys.has(key(edge))) addedEdges.push({ graphId, edge });
}
assert.equal(addedEdges.length, 11, "Added-edge set drifted from the reviewed candidate.");
await fs.mkdir(path.join(proposalRoot, "edges"), { recursive: true });
for (const { graphId, edge } of addedEdges) {
  const tuple = { graphId, from: edge.from, relation: edge.relation, to: edge.to };
  const frontmatter = {
    authoring_contract: AUTHORING_CONTRACTS.edgeProposal,
    entity_type: "graph-edge-proposal",
    proposal_id: id,
    operation: "add",
    edge_id: edgeId(tuple),
    edge_sha256: edgeDigest(tuple),
    graph_id: graphId,
    from_node_id: edge.from,
    to_node_id: edge.to,
    relation: edge.relation,
    base_graph_sha256: baseMeta.get(graphId).baseGraphSha256,
    base_projection_input_sha256: baseMeta.get(graphId).baseProjectionInputSha256
  };
  validateSchema("edgeProposal", frontmatter, { label: `${id}/${frontmatter.edge_id}` });
  await fs.writeFile(path.join(proposalRoot, "edges", `${frontmatter.edge_id}.md`), renderFrontmatterNote({
    frontmatter,
    heading: `${edge.from} ${edge.relation} ${edge.to}`,
    body: "Owner-reviewed topology addition. The exact endpoint and relation are executable proposal content."
  }));
}

const safe = {
  ...blankCaseVariables(),
  present_safety: "safe",
  orientation: "oriented",
  ability_to_stop: "yes",
  ability_to_return: "yes",
  activation: "moderate",
  dissociation: "none",
  altered_state: "sober",
  suicidal_state: "absent",
  inner_adult_access: "available",
  support_available: "present",
  body_capacity: "adequate",
  current_intent: "conversation",
  actionable_problem: "absent",
  unresolved_inner_material: "absent",
  attention_loop: "absent",
  inward_attention_effect: "neutral",
  other_person_central: "no",
  influence_domain: "none",
  memory_source_risk: "absent"
};

const cases = [
  {
    id: "G037",
    description: "Gentle somatic work can use SIBAM without privileging nonverbal material.",
    variables: { ...safe, current_intent: "gentle_practice", unresolved_inner_material: "present" },
    unknowns: [],
    expected: {
      selectedIncludes: ["SOM.SIBAM_TRACKING"],
      requiredNuancePatterns: ["attention map", "greater truth value"],
      forbiddenOverclaimPatterns: ["nonverbal, somatic, earlier, intuitive, or intense material"]
    }
  },
  {
    id: "G038",
    description: "Meaning integration preserves language and analysis without treating nonverbal material as truer.",
    variables: { ...safe, current_intent: "integration" },
    unknowns: [],
    expected: { selectedIncludes: ["SOM.MEANING_INTEGRATION"], requiredNuancePatterns: ["nonverbal is not deeper or truer"] }
  },
  {
    id: "G039",
    description: "Wanted touch can be selected with consent and a complete no-touch alternative.",
    variables: { ...safe, touch_interest: "present" },
    unknowns: [],
    expected: { selectedIncludes: ["SOM.CONSENSUAL_TOUCH"] }
  },
  {
    id: "G040",
    description: "Wanted aquatic bodywork is optional and carries explicit aftercare boundaries.",
    variables: { ...safe, aquatic_bodywork_interest: "present" },
    unknowns: [],
    expected: { selectedIncludes: ["SOM.AQUATIC_BODYWORK"] }
  },
  {
    id: "G041",
    description: "Medical concern or impaired altered-state capacity takes precedence over inward therapy.",
    variables: { ...safe, altered_state: "altered", altered_capacity: "impaired", altered_medical_status: "concerning", activation: "high", unresolved_inner_material: "present" },
    unknowns: [],
    expected: {
      primary: "ROUTE.ALTERED_MEDICAL_SAFETY",
      selectedIncludes: ["ROUTE.ALTERED_MEDICAL_SAFETY"],
      blockedIncludes: ["ROUTE.GO_INWARD", "ROUTE.ALTERED_STABLE_THERAPY"]
    }
  },
  {
    id: "G042",
    description: "Acute altered-state instability stabilizes before inward or stable substantive therapy.",
    variables: { ...safe, altered_state: "altered", altered_capacity: "limited", altered_medical_status: "stable", activation: "high", unresolved_inner_material: "present" },
    unknowns: [],
    expected: {
      primary: "ROUTE.ALTERED_ACUTE_STABILIZATION",
      selectedIncludes: ["ROUTE.ALTERED_ACUTE_STABILIZATION"],
      blockedIncludes: ["ROUTE.GO_INWARD", "ROUTE.ALTERED_STABLE_THERAPY"]
    }
  },
  {
    id: "G043",
    description: "Coherent stable altered participation can continue substantive and inner-child therapy at a calibrated depth.",
    variables: { ...safe, altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", activation: "low", current_intent: "deep_dialogue", deep_work_readiness: "yes", unresolved_inner_material: "present" },
    unknowns: [],
    expected: {
      selectedIncludes: ["ROUTE.ALTERED_STABLE_THERAPY", "IC.ALTERED_STATE_GATE"],
      matchedIncludes: ["IC.DEEP_CHILD_DIALOGUE"],
      requiredNuancePatterns: ["lack of habitual inner speech"],
      forbiddenOverclaimPatterns: ["articulate writing"]
    }
  },
  {
    id: "G044",
    description: "Altered-state action pressure locks consequential action while preserving later review.",
    variables: { ...safe, altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", activation: "low", altered_action_pressure: "present", altered_phase: "aftermath" },
    unknowns: [],
    expected: { primary: "ROUTE.ALTERED_ACTION_LOCK", selectedIncludes: ["ROUTE.ALTERED_ACTION_LOCK", "ROUTE.ALTERED_AFTERMATH"] }
  },
  {
    id: "G045",
    description: "Planned altered-state work can prepare capacity and closure without bypassing stable-therapy gates.",
    variables: { ...safe, altered_phase: "planned", altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", activation: "low" },
    unknowns: [],
    expected: { selectedIncludes: ["ROUTE.ALTERED_PREPARATION", "ROUTE.ALTERED_STABLE_THERAPY"] }
  },
  {
    id: "G046",
    description: "Aftermath integrates facts, meaning, and inward material only after ordinary stability.",
    variables: { ...safe, altered_phase: "aftermath", current_intent: "integration", unresolved_inner_material: "present" },
    unknowns: [],
    expected: { selectedIncludes: ["ROUTE.ALTERED_AFTERMATH", "ROUTE.GO_INWARD"], matchedIncludes: ["SOM.MEANING_INTEGRATION"] }
  }
];

await fs.mkdir(path.join(proposalRoot, "tests"), { recursive: true });
for (const definition of cases) await fs.writeFile(path.join(proposalRoot, "tests", `${definition.id}.json`), `${JSON.stringify(definition, null, 2)}\n`);

run("node", ["src/cli/authoring.mjs", "proposal-build", "--id", id]);
run("node", ["src/cli/authoring.mjs", "proposal-check", "--id", id]);

const buildRoot = path.join(root, "authoring", ".build", id);
const decisionPath = path.join(buildRoot, "audit", "owner-decisions.json");
const decisions = JSON.parse(await fs.readFile(decisionPath, "utf8"));
assert.equal(decisions.cards.length, 31, `Expected 31 exact decision cards, found ${decisions.cards.length}.`);
assert(decisions.cards.every((card) => card.status === "pending"), "All decision cards must be pending before owner approval is recorded.");
const buildReceipt = JSON.parse(await fs.readFile(path.join(buildRoot, "receipt.json"), "utf8"));
assert.equal(buildReceipt.ownerDecisionRequired, true, "Proposal builder did not preserve the owner decision gate.");

const candidateTaskDir = path.join(taskRoot, "candidate");
const approvalDir = path.join(taskRoot, "approval");
const reconciliationDir = path.join(taskRoot, "reconciliation");
await fs.rm(candidateTaskDir, { recursive: true, force: true });
await fs.rm(reconciliationDir, { recursive: true, force: true });
await fs.mkdir(candidateTaskDir, { recursive: true });
await fs.mkdir(approvalDir, { recursive: true });
await fs.mkdir(reconciliationDir, { recursive: true });
await fs.cp(buildRoot, candidateTaskDir, { recursive: true });

const packetId = `authoring-${id}`;
const sourcePacketPath = path.join(candidateTaskDir, "packet", "proposal.zip");
const sourcePacket = await fs.readFile(sourcePacketPath);
const sourcePacketSha256 = sha256(sourcePacket);
const entries = readZipEntries(sourcePacket);
const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
const embeddedDecisions = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8"));
assert.equal(manifest.packetId, packetId);
assert.equal(manifest.proposalId, id);
assert.equal(manifest.status, "candidate");
assert.equal(embeddedDecisions.status, "awaiting-owner");
assert.equal(embeddedDecisions.allApproved, false);
assert.equal(embeddedDecisions.cards.length, 31);
assert(embeddedDecisions.cards.every((card) => card.status === "pending"));

embeddedDecisions.cards = embeddedDecisions.cards.map((card) => ({ ...card, status: "approve", ownerNote, decidedAt }));
embeddedDecisions.allApproved = true;
embeddedDecisions.status = "approved";
embeddedDecisions.decidedAt = decidedAt;
manifest.status = "approved";
manifest.candidateOnly = false;
manifest.approvalRequired = false;
manifest.approvedAt = decidedAt;
manifest.approvalDecisionHash = sha256(Buffer.from(canonicalJson(embeddedDecisions)));
entries.set("manifest.json", Buffer.from(canonicalJson(manifest)));
entries.set("audit/owner-decisions.json", Buffer.from(canonicalJson(embeddedDecisions)));
entries.delete("SHA256SUMS.txt");
const sums = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => `${sha256(data)}  ${name}`).join("\n") + "\n";
entries.set("SHA256SUMS.txt", Buffer.from(sums));
const approvedPacket = createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date(decidedAt));
const approvedVerification = verifyGuidePacket(approvedPacket);
assert.equal(approvedVerification.ok, true, approvedVerification.errors.join("; "));
assert.equal(approvedVerification.approved, true, "Approved packet did not satisfy the exact owner-approval contract.");
const approvedPacketSha256 = sha256(approvedPacket);
const approvalDecisionSha256 = sha256(Buffer.from(canonicalJson(embeddedDecisions)));
const approvedPacketPath = path.join(approvalDir, `${packetId}-approved.zip`);
await fs.writeFile(approvedPacketPath, approvedPacket);

const approvalRecord = {
  contractVersion: "inner-signal-owner-approval-record-v1",
  proposalId: id,
  packetId,
  reviewedHead,
  groupApprovals: ["A", "B", "C", "D", "E"],
  sourcePacket: {
    path: path.relative(taskRoot, sourcePacketPath).replaceAll(path.sep, "/"),
    sha256: sourcePacketSha256,
    decisionCards: embeddedDecisions.cards.length
  },
  decision: {
    authority: "owner-explicit-chat-approval",
    scope: "approve-all-five-groups-and-all-31-exact-decision-cards",
    status: "approved",
    allApproved: true,
    decidedAt,
    ownerNote,
    approvalDecisionSha256
  },
  approvedPacket: {
    path: path.relative(taskRoot, approvedPacketPath).replaceAll(path.sep, "/"),
    sha256: approvedPacketSha256,
    verified: approvedVerification.ok,
    approved: approvedVerification.approved
  },
  boundaries: {
    reconciliationAuthorized: true,
    mergeAuthorized: true,
    installAuthorized: false,
    deployAuthorized: false,
    stablePromotionAuthorized: false
  }
};
await fs.writeFile(path.join(approvalDir, "OWNER-APPROVAL.json"), canonicalJson(approvalRecord));

const reconciliation = await reconcileApprovedProposal({
  root,
  id,
  packetId,
  packetPath: path.relative(root, approvedPacketPath).replaceAll(path.sep, "/"),
  packetSha256: approvedPacketSha256,
  runCompleteGates: true
});
assert.equal(reconciliation.installed, false);
assert.equal(reconciliation.stableChanged, false);
await fs.copyFile(path.join(buildRoot, "reconciliation.json"), path.join(reconciliationDir, "RECONCILIATION-RECEIPT.json"));

const integrationFile = path.join(taskRoot, "INTEGRATION.md");
let integration = await fs.readFile(integrationFile, "utf8");
const oldStatus = "Status: TESTED_ITERATION_CANDIDATE; draft PR only; not semantically owner-approved through the Guide Packet lifecycle, merged, installed, deployed, or promoted to `stable`.";
const newStatus = "Status: OWNER_APPROVED_AND_RECONCILED; merge pending; not installed, deployed, or promoted to `stable`.";
assert(integration.includes(oldStatus), "Task receipt no longer has the expected pre-approval status line.");
integration = integration.replace(oldStatus, newStatus);
integration += `\n## Owner approval and reconciliation — 2026-09-16\n\n- At ${decidedAt}, the owner explicitly approved all five grouped semantic decisions, covering all 31 exact Guide Packet decision cards.\n- Owner review was bound to graph candidate head \`${reviewedHead}\`; the three candidate graph files were verified unchanged before packet construction.\n- Candidate packet SHA-256: \`${sourcePacketSha256}\`.\n- Approved packet SHA-256: \`${approvedPacketSha256}\`; deterministic verifier reports approved=true.\n- Reconciliation consumed that exact approved packet/hash and returned installed=false, stableChanged=false.\n- Reconciled bundle SHA-256: \`${reconciliation.compiledBundleSha256}\`; canonical graph regressions: ${reconciliation.regressionStatus.count}/${reconciliation.regressionStatus.count}.\n- Merge into development \`main\` is authorized by the owner approval record. Installation, deployment, and \`stable\` promotion remain explicitly unauthorized.\n`;
await fs.writeFile(integrationFile, integration);

const stateFile = path.join(root, "state", "CODEX-CURRENT-STATE.md");
let state = await fs.readFile(stateFile, "utf8");
const marker = "\n## Wisdom-practices owner-approved reconciliation";
const split = state.indexOf(marker);
assert(split >= 0, "Could not locate the durable current-state section boundary.");
const remainder = state.slice(split);
const nextTop = `# Inner Signal Codex current state\n\nUpdated: 2026-09-16\n\n## Somatic + altered-states guide sync — owner approved and reconciled\n\nThe owner explicitly approved all five grouped semantic decisions, covering all 31 exact Guide Packet cards. The approved packet verifies and reconciliation consumed its exact hash on the task branch. The reconciled development candidate preserves SIBAM-style whole-experience tracking without nonverbal privilege, consent-led touch/aquatic routes, capacity-led altered-state safety/therapy/integration, all thirteen owner-confirmed guide destinations, and separate public-humanization tracking. Experimental rescue substances/dosing remain outside executable emergency instructions.\n\nThe reconciliation reports \`installed=false\` and \`stableChanged=false\`. The exact reconciled task branch must pass the protected hosted checks before merge to development \`main\`. Installation, deployment and \`stable\` promotion remain separate and unauthorized. Exact packet, approval and reconciliation hashes/receipts are in \`tasks/${id}/\`.\n`;
await fs.writeFile(stateFile, nextTop + remainder);

process.stdout.write(canonicalJson({
  ok: true,
  proposalId: id,
  reviewedHead,
  decisionCards: embeddedDecisions.cards.length,
  sourcePacketSha256,
  approvedPacketSha256,
  approvalDecisionSha256,
  reconciliation
}));
