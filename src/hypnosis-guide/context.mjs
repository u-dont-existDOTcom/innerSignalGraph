import { advanceSession } from './session.mjs';
import { getKnowledge, searchKnowledge } from './knowledge.mjs';
import { validateHypnosisGraph } from './validate.mjs';
/** Candidate adapter for structured teaching/session context. No model, audio,
 * private persistence, emergency service or deployed application integration. */
export function prepareHypnosisContext(graph, library, session, event, {today,maxCharacters=24000}={}) {
  validateHypnosisGraph(graph,library);
  if (!Number.isInteger(maxCharacters) || maxCharacters<100 || maxCharacters>100000) throw new TypeError('Bounded context size required');
  const result=advanceSession(graph,session,event,{today});
  const knowledgeRequest=['LEARN','CONSULT'].includes(event.type);
  const requested=knowledgeRequest
    ? event.topicId ? getKnowledge(library,event.topicId) : searchKnowledge(library,event.query ?? '')
    : {status:'found',records:result.plan.sourceRefs.flatMap(id=>getKnowledge(library,id).records)};
  const records=[];const omitted=[];let used=0;const seen=new Set();
  for (const r of requested.records) {
    if (seen.has(r.id)) continue; seen.add(r.id);
    if (used+r.text.length>maxCharacters) {omitted.push(r.id);continue;}
    records.push(r);used+=r.text.length;
  }
  return {...result,knowledge:{status:requested.status,records,omitted,sourceTruncated:requested.truncated ?? false,
    externalLookupRequired:requested.status==='lookup-required',narrateCitations:false,
    usage:knowledgeRequest?'explanation with attribution, not live enactment':'source-grounded candidate guidance; not a performed session'}};
}
