#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../src/authoring/canonical-json.mjs";
import { AUTHORING_CONTRACTS, edgeDigest, edgeId, validateSchema } from "../src/authoring/contract.mjs";
import { renderFrontmatterNote, renderNodeNote } from "../src/authoring/note-renderer.mjs";
import { loadCurrentAuthority } from "../src/authoring/projection.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packetRoot = path.resolve(process.argv[2] ?? "../packet");
const proposalId = "protective-compatibility-20260918";
const graphId = "inner-child-somatic-cross-guide";
const graphPath = "guide-graphs/candidates/cross-guide.graph.json";
const proposalRoot = path.join(root, "authoring", "obsidian", "proposals", proposalId);

function nodePayload(node) {
  return {
    activation: node.activation,
    recommendations: node.recommendations,
    avoid: node.avoid,
    successSignals: node.successSignals,
    effects: node.effects,
    defaultQuestion: node.defaultQuestion
  };
}

async function main() {
  const [drafts, amendments, authority] = await Promise.all([
    fs.readFile(path.join(packetRoot, "NODE-DRAFTS.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(packetRoot, "AMENDMENTS.json"), "utf8").then(JSON.parse),
    loadCurrentAuthority({ root })
  ]);
  const regressionPacket = JSON.parse(await fs.readFile(path.join(packetRoot, "REGRESSION-CASES.json"), "utf8"));
  await fs.mkdir(path.join(root, "corpus"), { recursive: true });
  await fs.writeFile(path.join(root, "corpus", "protective-compatibility-cases.json"), canonicalJson(regressionPacket));
  await fs.mkdir(path.join(proposalRoot, "nodes"), { recursive: true });
  await fs.mkdir(path.join(proposalRoot, "edges"), { recursive: true });
  await fs.mkdir(path.join(proposalRoot, "tests"), { recursive: true });
  const graphHash = authority.graphHashes.get(graphPath);
  const regressionIds = drafts.nodes.flatMap((node, index) => [`PCG${String(index + 1).padStart(2, "0")}A`, `PCG${String(index + 1).padStart(2, "0")}B`]);
  const manifest = {
    authoring_contract: AUTHORING_CONTRACTS.proposal,
    entity_type: "proposal",
    proposal_id: proposalId,
    status: "draft",
    base_projection_input_sha256: authority.projectionInputSha256,
    target_graph_ids: [graphId],
    declared_regression_ids: regressionIds,
    owner_decision_required: true,
    contains_therapy_semantic_change: true,
    contains_documentation_overlay_change: false
  };
  validateSchema("proposalManifest", manifest, { label: `${proposalId} proposal manifest` });
  const proposalBody = "## Intent\n\nStage the exact protective-compatibility route nodes and source amendments from the frozen 2026-09-18 work packet for owner review. The shared runtime gate is implemented separately and does not depend on approval of these convenience routes.\n\n## Non-goals\n\nThis proposal does not approve its own source amendments, install a guide packet, diagnose a person, infer harmful intent from religion, or create an automated clinical-clearance service.\n\n## Worst plausible failure\n\nA route could accidentally facilitate child-directed contact for a person with supported harmful intent, persist a false moral label, or erase urgent safety handling. The shared pre/post selection guard, evidence revision, actor scope, and independent threat pathway are hard boundaries.\n\n## Acceptance distinctions\n\nSupported harmful intent blocks child contact while preserving adult-focused help. Material ambiguity holds contact. Unwanted thoughts, quotations, scoped simulations, identity, and Satanism alone do not block. Genuine prior restrictions require evidence-bound re-entry review.";
  await fs.writeFile(path.join(proposalRoot, "proposal.md"), renderFrontmatterNote({ frontmatter: manifest, heading: proposalId, body: proposalBody }));
  await fs.writeFile(path.join(proposalRoot, "base-authority.json"), canonicalJson({
    contractVersion: "inner-signal-authoring-base-authority-v1",
    proposalId,
    projectionInputSha256: authority.projectionInputSha256,
    authoritativeInputs: authority.authoritativeInputs
  }));
  await fs.writeFile(path.join(proposalRoot, "source-amendments.json"), canonicalJson({
    contractVersion: "inner-signal-proposed-source-amendments-v1",
    proposalId,
    status: "PROPOSED_NOT_APPROVED",
    items: amendments.items
  }));

  for (const [index, node] of drafts.nodes.entries()) {
    const frontmatter = {
      authoring_contract: AUTHORING_CONTRACTS.nodeProposal,
      entity_type: "graph-node-proposal",
      proposal_id: proposalId,
      operation: "add",
      graph_id: graphId,
      node_id: node.id,
      title: node.title,
      kind: node.kind,
      tier: node.tier,
      priority: node.priority,
      authority: node.authority,
      graph_tags: node.tags,
      source_refs: node.sourceRefs,
      base_graph_sha256: graphHash,
      base_projection_input_sha256: authority.projectionInputSha256
    };
    validateSchema("nodeProposal", frontmatter, { label: node.id });
    await fs.writeFile(path.join(proposalRoot, "nodes", `${node.id}.md`), renderNodeNote({
      frontmatter,
      payload: nodePayload(node),
      heading: node.title,
      warning: "Editable proposal record. Building it never changes canonical graph files.",
      rationaleTemplate: true
    }));
    const baseVariables = {
      present_safety: "safe",
      orientation: "oriented",
      ability_to_stop: "yes",
      ability_to_return: "yes",
      dissociation: "none",
      altered_state: "sober",
      current_intent: "conversation",
      child_contact_gate: "BLOCKED",
      compatibility_route: node.activation.all[0].value
    };
    const positive = {
      id: `PCG${String(index + 1).padStart(2, "0")}A`,
      description: `${node.id} is selected only for its exact compatibility route.`,
      variables: baseVariables,
      unknowns: [],
      expected: {
        primary: node.id,
        selectedIncludes: [node.id],
        nextQuestion: node.defaultQuestion,
        requiredNuancePatterns: ["present adult perspective", "religious identity is not evidence"],
        forbiddenOverclaimPatterns: ["proven treatment for psychopathy", "permission to resume child contact"]
      }
    };
    const negative = {
      id: `PCG${String(index + 1).padStart(2, "0")}B`,
      description: `${node.id} is not selected when the compatibility route does not match.`,
      variables: { ...baseVariables, present_safety: "unsafe", compatibility_route: "ordinary" },
      unknowns: [],
      expected: { selectedExcludes: [node.id] }
    };
    await fs.writeFile(path.join(proposalRoot, "tests", `${positive.id}.json`), canonicalJson(positive));
    await fs.writeFile(path.join(proposalRoot, "tests", `${negative.id}.json`), canonicalJson(negative));
  }

  for (const edge of drafts.edgeIntents) {
    const tuple = { graphId, from: edge.from, relation: edge.relation, to: edge.to };
    const digest = edgeDigest(tuple);
    const frontmatter = {
      authoring_contract: AUTHORING_CONTRACTS.edgeProposal,
      entity_type: "graph-edge-proposal",
      proposal_id: proposalId,
      operation: "add",
      edge_id: edgeId(tuple),
      edge_sha256: digest,
      graph_id: graphId,
      from_node_id: edge.from,
      to_node_id: edge.to,
      relation: edge.relation,
      base_graph_sha256: graphHash,
      base_projection_input_sha256: authority.projectionInputSha256
    };
    validateSchema("edgeProposal", frontmatter, { label: frontmatter.edge_id });
    await fs.writeFile(path.join(proposalRoot, "edges", `${frontmatter.edge_id}.md`), renderFrontmatterNote({
      frontmatter,
      heading: `${edge.from} ${edge.relation} ${edge.to}`,
      body: `Proposed topology only. Source intent: ${edge.sourceRefs.join(", ")}. This conditional edge never grants child contact.`
    }));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, proposalId, nodes: drafts.nodes.length, edges: drafts.edgeIntents.length, tests: regressionIds.length, projectionInputSha256: authority.projectionInputSha256 }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? "STAGE_FAILED", message: error.message })}\n`);
  process.exitCode = 1;
});
