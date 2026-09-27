import { ValidationError } from '../core/errors.mjs';

/** Select the frozen graph revision, including reconciled relationships and
 * their exact supporting passages. Never reconstruct claims from producer text. */
export function createAuditScopeIndex(graph) {
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),edgesByNode=new Map(),edgesByDerivation=new Map(),sourcesByRepresentation=new Map();
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
  for(const edge of graph.edges){add(edgesByNode,edge.from,edge);add(edgesByNode,edge.to,edge);if(edge.derivation_ref)add(edgesByDerivation,edge.derivation_ref,edge);}
  for(const node of graph.nodes)if(node.kind==='source')add(sourcesByRepresentation,node.data.representation_id,node);
  return {graph,nodes,edgesByNode,edgesByDerivation,sourcesByRepresentation};
}

export function createReconciledAuditScope({ graph, unitGraph, derivationRef = null, index = createAuditScopeIndex(graph) }) {
  if(index.graph!==graph)throw new ValidationError('AUDIT_SCOPE_INDEX_STALE',{code:'AUDIT_SCOPE_INDEX_STALE'});
  const {nodes,edgesByNode,edgesByDerivation,sourcesByRepresentation}=index;
  const chosen = new Set(unitGraph.nodes.map(n => n.id));
  const coreIds = new Set(chosen);
  const selectedRelations=new Map((edgesByDerivation.get(derivationRef)??[]).map(e=>[e.id,e]));
  for(const id of coreIds)for(const edge of edgesByNode.get(id)??[])if(edge.derivation_ref)selectedRelations.set(edge.id,edge);
  const relationEdges=[...selectedRelations.values()];
  for (const edge of relationEdges) {
    chosen.add(edge.from); chosen.add(edge.to);
    for (const id of edge.evidence_ids) chosen.add(id);
  }
  const required = node => [
    ...(node.data.evidence_ids ?? []), ...(node.data.subject_ids ?? []),
    node.data.speaker_id, node.data.episode_id,
    ...(node.data.authored_time?.evidence_ids ?? []), ...(node.data.event_time?.evidence_ids ?? [])
  ].filter(Boolean);
  for (const id of chosen) {
    const node=nodes.get(id);
    if (!node) throw new ValidationError('AUDIT_GRAPH_REFERENCE_MISSING',{code:'AUDIT_GRAPH_REFERENCE_MISSING'});
    for (const dependency of required(node)) chosen.add(dependency);
  }
  const selectedNodes=[...chosen].map(id=>nodes.get(id));
  const representations = new Set(selectedNodes.filter(n=>n.kind==='passage').map(n=>n.data.representation_id));
  for(const representation of representations)for(const node of sourcesByRepresentation.get(representation)??[])if(!chosen.has(node.id)){
    chosen.add(node.id);selectedNodes.push(node);
  }
  const selectedEdges=new Map();
  for(const id of chosen)for(const edge of edgesByNode.get(id)??[])if(chosen.has(edge.from)&&chosen.has(edge.to)&&edge.evidence_ids.every(id=>chosen.has(id)))selectedEdges.set(edge.id,edge);
  const edges=[...selectedEdges.values()];
  const assessmentTargetIds=[...new Set([
    ...unitGraph.nodes.filter(n=>n.kind==='assertion').map(n=>n.id), ...relationEdges.map(e=>e.id)
  ])];
  return {
    graph:{...graph,nodes:selectedNodes,edges},
    assessment_target_ids:assessmentTargetIds,
    supporting_passages:selectedNodes.filter(n=>n.kind==='passage').map(n=>({
      passage_id:n.id,unit_id:n.data.unit_id,text:n.data.quote,
      disclosure:n.data.disclosure??'ordinary',locator:n.data.locator
    }))
  };
}

/** Completion and findings remain distinct. No global recall threshold here. */
export function summarizeFidelityCoverage({ reference, review, candidateIds }) {
  const assessments=new Map(review.assessments.map(a=>[a.target_id,a]));
  const expected=[...reference.reference_items.map(i=>i.id),...candidateIds];
  const unassessed=[...new Set([...expected.filter(id=>!assessments.has(id)||assessments.get(id).outcome==='unassessed'),...review.unassessed_ids])];
  const unsafe=candidateIds.filter(id=>{
    const assessment=assessments.get(id);
    return !assessment||assessment.outcome!=='preserved'||assessment.finding_type==='lost_qualifier';
  });
  return {complete:review.status!=='incomplete'&&!reference.unassessed_unit_ids.length&&!unassessed.length,
    unassessed_ids:unassessed,untrusted_candidate_ids:unsafe,
    repair_required:review.status==='repair_required'||review.assessments.some(a=>a.outcome!=='preserved')};
}
