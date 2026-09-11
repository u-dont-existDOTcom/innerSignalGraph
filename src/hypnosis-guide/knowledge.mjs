import { createHash } from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function validateKnowledge(library) {
  if (library?.format!=='hypnosis-knowledge-v2' || !Array.isArray(library.records)) throw new TypeError('Invalid knowledge contract');
  const ids=new Set();
  for (const r of library.records) {
    if (!r.id || ids.has(r.id)) throw new TypeError('Missing/duplicate source id'); ids.add(r.id);
    if (typeof r.text!=='string' || hash(r.text)!==r.textSha256) throw new TypeError(`Source text drift: ${r.id}`);
    if (!r.source?.document || !r.epistemicRole) throw new TypeError(`Missing provenance: ${r.id}`);
  }
  for (const r of library.records) if (r.parent && !ids.has(r.parent)) throw new TypeError(`Dangling parent ${r.id}`);
  return library;
}
/** Returns literal cited records. It never transforms them into enacted suggestions. */
export function getKnowledge(library, id, {includeChildren=false}={}) {
  const root=library.records.find(r=>r.id===id);
  if (!root) return {status:'lookup-required',records:[],missing:id};
  const selected=[root];
  if (includeChildren) for (let i=0;i<selected.length;i++) selected.push(...library.records.filter(r=>r.parent===selected[i].id));
  return {status:'found',records:structuredClone(selected),narrate:false};
}
const stop=new Set('what is are the a an how to can i you me about teach explain please of in and with hypnosis method'.split(' '));
const words=s=>[...new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).filter(w=>!stop.has(w) && w.length>1))];
/** Bounded keyword lookup, not a claimed semantic retriever. All substantive tokens
 * must match one source record; an unfamiliar branded term cannot disappear. */
export function searchKnowledge(library, query, {layer=null,limit=5}={}) {
  if (typeof query!=='string' || query.length>4000) throw new TypeError('Bounded query required');
  if (!Number.isInteger(limit) || limit<1 || limit>20) throw new TypeError('Limit must be 1-20');
  const tokens=words(query);
  if (!tokens.length) return {status:'clarify-topic',records:[]};
  const hits=library.records.filter(r=>!layer || r.layer===layer).filter(r=>{
    const set=new Set(words(r.title+' '+r.text)); return tokens.every(t=>set.has(t));
  }).sort((a,b)=>tokens.filter(t=>b.title.toLowerCase().includes(t)).length-tokens.filter(t=>a.title.toLowerCase().includes(t)).length || a.id.localeCompare(b.id));
  return {status:hits.length?'found':'lookup-required',records:structuredClone(hits.slice(0,limit)),total:hits.length,
    truncated:hits.length>limit,narrate:false,scope:'literal-source keyword lookup; current external claims still need verification'};
}
