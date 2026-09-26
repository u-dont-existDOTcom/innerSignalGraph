import { CONTRACT, GUARDS, PHASES } from './session.mjs';
import { validateKnowledge } from './knowledge.mjs';
export function validateHypnosisGraph(graph, library) {
  if (graph?.contractVersion!==CONTRACT || !Array.isArray(graph.nodes) || !Array.isArray(graph.transitions) || !Array.isArray(graph.interrupts)) throw new TypeError('Invalid hypnosis graph contract');
  validateKnowledge(library);
  if (graph.sourceAuthority.sha256!==library.binding.article.sha256) throw new TypeError('Guide identity mismatch');
  const sources=new Set(library.records.map(r=>r.id)); const ids=new Set();
  for (const n of graph.nodes) {
    if (!n.id || ids.has(n.id)) throw new TypeError('Duplicate/missing graph node');ids.add(n.id);
    if (!n.title || !n.kind || !n.instruction || !n.successCriterion || !n.provenance || !n.sourceRefs.length) throw new TypeError(`Incomplete node ${n.id}`);
    for (const ref of n.sourceRefs) if (!sources.has(ref)) throw new TypeError(`Unknown source ${ref}`);
  }
  const ruleIds=new Set();
  for (const t of [...graph.transitions,...graph.interrupts]) {
    if (!t.id || ruleIds.has(t.id)) throw new TypeError('Duplicate/missing transition id');ruleIds.add(t.id);
    if (!GUARDS[t.guard] || !ids.has(t.node)) throw new TypeError(`Unknown transition guard/node ${t.id}`);
    if (t.from && (!t.event || t.from.some(p=>!PHASES.includes(p)) || ![...PHASES,'same'].includes(t.to))) throw new TypeError(`Invalid transition phase ${t.id}`);
  }
  for (const e of graph.edges) if (!ids.has(e.from) || !ids.has(e.to) || e.semantics!=='conceptual-only') throw new TypeError('Invalid conceptual edge');
  if (!graph.boundaries || graph.boundaries.productionGraphChanged!==false || graph.boundaries.installedPacketChanged!==false) throw new TypeError('Candidate must not claim installed policy');
  return graph;
}
