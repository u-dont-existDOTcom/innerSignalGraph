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

const active = (record) => Boolean(record) && !["deleted", "revoked"].includes(record.lifecycle);

// The graph's own rules for a new edge, checked before a proposal is applied. A proposal that would
// break them is deferred for review; applying it would make the whole reconciled graph invalid, and
// the saved result would fail the same way on every later run.
function edgeRuleViolation(nodes, edge) {
  // An assertion's evidence edges must match its own evidence list, which only extraction writes.
  if (edge.relation === "supported_by") return "RECONCILIATION_EVIDENCE_EDGE";
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!active(from) || !active(to)) return "ACTIVE_EDGE_TO_REVOKED";
  if (edge.relation === "corrects" && from.data?.assertion_kind !== "explicit_correction") return "CORRECTION_WITHOUT_CORRECTION_ASSERTION";
  if (edge.relation === "reported_effect_of"
    && (from.data?.assertion_kind !== "reported_outcome" || to.data?.assertion_kind !== "reported_action")) return "INTENTION_CONFUSED_WITH_EFFECTIVE_ACTION";
  return null;
}

/** Apply source-linked proposals without merging identities or rewriting claims/time. */
export function applyReconciliationResult({ graph, result, receipt }) {
  const checked = validateReconciliationResult(result, graph);
  invariant(receipt?.completion_status === "completed" && receipt.target_generation === graph.generation
    && typeof receipt.receipt_id === "string", "RECONCILIATION_RECEIPT_INVALID");
  const next = structuredClone(graph);
  const nodes = new Map(next.nodes.map((node) => [node.id, node]));
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
    const violation = edgeRuleViolation(nodes, edge);
    if (violation) {
      deferred.push({ ...structuredClone(proposal), deferred_reason: violation });
      continue;
    }
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
