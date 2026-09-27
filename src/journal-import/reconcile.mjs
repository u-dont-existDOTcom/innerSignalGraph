import { ValidationError } from "../core/errors.mjs";
import { createHash } from "node:crypto";
import { JOURNAL_GRAPH_CONTRACT, validateJournalSchema } from "./contracts.mjs";

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

export function validateReconciliationResult(result, graph) {
  const checked = validateJournalSchema("reconciliation-result", result);
  invariant(checked.target_generation === graph.generation, "RECONCILIATION_GENERATION_MISMATCH");
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const proposal of checked.proposals) {
    invariant(proposal.subject_ids.every((id) => nodes.has(id)), "RECONCILIATION_SUBJECT_MISSING");
    invariant(proposal.evidence_ids.every((id) => nodes.get(id)?.kind === "passage"), "RECONCILIATION_EVIDENCE_INVALID");
    if (["link", "possible_identity", "group_retelling"].includes(proposal.operation)) {
      const relation = JOURNAL_GRAPH_CONTRACT.relations[proposal.relation];
      invariant(relation && proposal.subject_ids.length === 2, "RECONCILIATION_RELATION_INVALID");
      invariant(relation.from_kinds.includes(nodes.get(proposal.subject_ids[0]).kind)
        && relation.to_kinds.includes(nodes.get(proposal.subject_ids[1]).kind), "RECONCILIATION_ENDPOINT_KIND_INVALID");
      invariant(proposal.subject_ids[0] !== proposal.subject_ids[1]
        && proposal.evidence_ids.length > 0, "RECONCILIATION_EVIDENCE_INVALID");
    }
    if (proposal.operation === "possible_identity") invariant(proposal.relation === "possible_same_entity", "RECONCILIATION_IDENTITY_RELATION_INVALID");
    if (proposal.operation === "group_retelling") invariant(proposal.relation === "retells", "RECONCILIATION_RETELLING_RELATION_INVALID");
  }
  return checked;
}

/** Apply source-linked proposals without merging identities or rewriting claims/time. */
export function applyReconciliationResult({ graph, result, receipt }) {
  const checked = validateReconciliationResult(result, graph);
  invariant(receipt?.completion_status === "completed" && receipt.target_generation === graph.generation
    && typeof receipt.receipt_id === "string", "RECONCILIATION_RECEIPT_INVALID");
  const next = structuredClone(graph);
  const existing = new Map(next.edges.map(e => [`${e.relation}\0${e.from}\0${e.to}`, e]));
  const deferred = [];
  for (const proposal of checked.proposals) {
    if (!["link", "possible_identity", "group_retelling"].includes(proposal.operation)) {
      deferred.push(structuredClone(proposal));
      continue;
    }
    const [from,to] = proposal.subject_ids;
    const identity = `${proposal.relation}\0${from}\0${to}`;
    if (existing.has(identity)) continue;
    const edge = { id: `edge:${createHash("sha256").update(`${graph.generation}\0${identity}`).digest("hex").slice(0,32)}`,
      case_id: graph.case_id, corpus_id: graph.corpus_id, version: 1, lifecycle: "candidate",
      relation: proposal.relation, from, to, evidence_ids: [...new Set(proposal.evidence_ids)],
      basis: proposal.relation === "reported_effect_of" ? "author_attribution" : "derived_proposal",
      derivation_ref: receipt.receipt_id };
    next.edges.push(edge); existing.set(identity,edge);
  }
  // Retelling support is counted by connected episode groups. Source occurrences
  // and assertion text stay distinct; possible identities do not merge people.
  const parent = new Map();
  const find = id => { let root=id; while(parent.has(root)&&parent.get(root)!==root) root=parent.get(root); let cur=id;while(parent.has(cur)&&parent.get(cur)!==cur){const p=parent.get(cur);parent.set(cur,root);cur=p;}return root; };
  for (const edge of next.edges) if (edge.relation === "retells" && !["deleted","revoked"].includes(edge.lifecycle)) {
    const a=find(edge.from), b=find(edge.to);parent.set(a,a<b?a:b);parent.set(b,a<b?a:b);
  }
  for (const node of next.nodes) {
    const episode = node.kind === "episode" ? node.id : node.kind === "assertion" ? node.data.episode_id : null;
    if (episode && parent.has(episode)) {
      const support = `support:${createHash("sha256").update(`${graph.generation}\0retelling\0${find(episode)}`).digest("hex").slice(0,32)}`;
      if(node.data.support_group_id!==support){node.data.support_group_id=support;node.version+=1;}
    }
  }
  return { graph: next, unresolved_ids: [...checked.unresolved_ids], deferred_proposals: deferred,
    status: checked.status, source_assertions_rewritten: false, identities_merged: false };
}
