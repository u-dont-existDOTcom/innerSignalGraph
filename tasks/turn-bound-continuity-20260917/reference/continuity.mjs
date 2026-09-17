/**
 * Isolated, dependency-free specification reference. NOT a production access
 * service, clinical model, native ChatGPT adapter, or drop-in repository patch.
 * All release inputs must be loaded by a trusted server from its own records;
 * accepting these records directly from an untrusted caller is NOT secure.
 */
import { createHash } from 'node:crypto';

export class ContinuityError extends Error {
  constructor(code, message = code) { super(message); this.name = 'ContinuityError'; this.code = code; }
}
const fail = (code, message) => { throw new ContinuityError(code, message); };
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, name) {
  if (typeof value !== 'string' || !value.length) fail('INVALID_INPUT', `${name} must be nonempty text`);
  // JS silently replaces unpaired surrogates when converted to UTF-8.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = value.charCodeAt(++i);
      if (!(n >= 0xDC00 && n <= 0xDFFF)) fail('INVALID_UTF8', name);
    } else if (c >= 0xDC00 && c <= 0xDFFF) fail('INVALID_UTF8', name);
  }
  return value;
}
export function sha256(value) {
  if (typeof value !== 'string') fail('INVALID_INPUT', 'hash input must be exact text');
  if (value.length) text(value, 'hash input');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function canonicalJson(value) {
  const active = new Set();
  const visit = v => {
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') { if (v.length) text(v, 'JSON text'); return JSON.stringify(v); }
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null) fail('INVALID_JSON', 'non-JSON value');
    if (active.has(v)) fail('INVALID_JSON', 'cycle');
    active.add(v);
    let out;
    if (Array.isArray(v)) {
      // Sparse arrays are not silently serialized differently from explicit nulls.
      if (Object.keys(v).length !== v.length) fail('INVALID_JSON', 'sparse/extended array');
      out = '[' + v.map(visit).join(',') + ']';
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('INVALID_JSON', 'non-plain object');
      out = '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+visit(v[k])).join(',') + '}';
    }
    active.delete(v);
    return out;
  };
  return visit(value);
}
export const jsonDigest = value => sha256(canonicalJson(value));
const tokens = s => new Set((s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(x => x.length > 2));
const hasTopic = (value, aliases) => {
  const t = tokens(value);
  return aliases.some(alias => [...tokens(alias)].every(word => t.has(word)));
};

/** Select exact case evidence. Scores nominate sources, never diagnose or
 * decide whether a historical relationship is causal/current. No model calls.
 * `sources` are already authorized effective sources with amendments resolved.
 * `episode_ids` and `required_ids` are supplied by the trusted case projection.
 */
export function prepareEvidence(input) {
  if (!obj(input) || !obj(input.authorization)) fail('INVALID_INPUT');
  const { case_id, turn_id, inbound, sources, authorization } = input;
  if (!authorization.allowed || authorization.case_id !== case_id) fail('CASE_ACCESS_DENIED');
  text(case_id, 'case_id'); text(turn_id, 'turn_id'); text(inbound, 'inbound');
  if (!Number.isSafeInteger(input.evidence_revision) || input.evidence_revision < 0) fail('INVALID_INPUT', 'evidence_revision');
  if (!Array.isArray(sources) || !Array.isArray(input.episode_ids)) fail('INVALID_INPUT', 'sources/episode_ids');
  if (input.source_watermark !== input.index_watermark && input.raw_scan !== true) fail('INDEX_STALE');
  const ids = new Map();
  for (const s of sources) {
    if (!obj(s) || s.case_id !== case_id) fail('CASE_SCOPE_VIOLATION');
    text(s.id, 'source.id'); text(s.text, 'source.text');
    if (ids.has(s.id)) fail('DUPLICATE_SOURCE');
    if (s.sha256 !== sha256(s.text)) fail('SOURCE_DIGEST_MISMATCH');
    if (s.amendment_pending === true) fail('CONTEXT_SOURCE_MISSING', 'effective amendment unresolved');
    ids.set(s.id, s);
  }
  const required = [...new Set([...(input.required_ids ?? []), ...input.episode_ids])];
  if (required.some(id => !ids.has(id))) fail('CONTEXT_SOURCE_MISSING');
  if (input.episode_complete !== true) fail('EPISODE_INCOMPLETE');
  const aliases = input.topic_aliases ?? {};
  if (!obj(aliases) || Object.values(aliases).some(v => !Array.isArray(v) || !v.length || v.some(a => typeof a !== 'string' || !a.trim()))) fail('INVALID_INPUT', 'topic aliases');
  const query = `${inbound}\n${input.active_topic ?? ''}`;
  const q = tokens(query);
  const topics = new Set(Object.entries(aliases).filter(([, a]) => hasTopic(query, a)).map(([key]) => key));
  const reasons = new Map(sources.map(s => [s.id, new Set()]));
  const score = new Map(sources.map(s => [s.id, 0]));
  for (const id of required) { reasons.get(id).add('required'); score.set(id, 1000); }
  for (const s of sources) {
    // A prior draft is only included when explicitly required for episode/context,
    // not promoted as independent factual evidence through ordinary search.
    if (['assistant_draft', 'translation'].includes(s.kind)) continue;
    const st = tokens(s.text);
    const lexical = [...q].filter(t => st.has(t)).length;
    const matched = [...topics].filter(t => hasTopic(s.text, aliases[t]) || (s.topics ?? []).includes(t));
    if (lexical) { reasons.get(s.id).add('incoming-lexical'); score.set(s.id, score.get(s.id)+lexical); }
    if (matched.length) { reasons.get(s.id).add('incoming-topic'); score.set(s.id, score.get(s.id)+matched.length*5); }
  }
  for (const rel of input.relationships ?? []) {
    if (!obj(rel) || !Array.isArray(rel.source_ids) || !Array.isArray(rel.topics)) fail('INVALID_INPUT', 'relationship');
    if (!rel.topics.some(t => topics.has(t))) continue;
    for (const id of rel.source_ids) {
      if (!ids.has(id)) fail('CONTEXT_SOURCE_MISSING', 'relationship source unresolved');
      reasons.get(id).add('relationship'); score.set(id, score.get(id)+10);
    }
  }
  // Include source-linked corrections and the originals they qualify in either
  // direction. This is linkage, not an automatic newest-claim-wins rule.
  for (const s of sources) for (const id of [...(s.updates ?? []), ...(s.context_ids ?? [])]) {
    if (!ids.has(id)) fail('CONTEXT_SOURCE_MISSING', 'linked source unresolved');
  }
  const links = new Map(sources.map(s => [s.id, new Set()]));
  for (const s of sources) for (const id of [...(s.updates ?? []), ...(s.context_ids ?? [])]) {
    links.get(s.id).add(id); links.get(id).add(s.id);
  }
  const visited = new Set();
  const queue = sources.filter(s => score.get(s.id)>0).map(s=>s.id);
  while (queue.length) {
    const id=queue.shift(); if (visited.has(id)) continue; visited.add(id);
    for (const other of links.get(id)) {
      reasons.get(other).add('source-neighborhood'); score.set(other, Math.max(score.get(other), 1));
      if (!visited.has(other)) queue.push(other);
    }
  }
  const sourceBytes = s => Buffer.byteLength(canonicalJson(s), 'utf8');
  const max = input.max_source_bytes ?? 64000;
  if (!Number.isSafeInteger(max) || max <= 0) fail('INVALID_INPUT', 'source budget');
  const total = sources.reduce((n,s)=>n+sourceBytes(s),0);
  const chosen = new Set(); let used=0;
  let mode;
  if (input.prefer_full_history !== false && total <= max) {
    mode='full-history'; sources.forEach(s=>chosen.add(s.id)); used=total;
  } else {
    mode='targeted';
    for (const id of required) {
      used+=sourceBytes(ids.get(id)); chosen.add(id);
    }
    if (used>max) fail('CONTEXT_BUDGET_UNRESOLVED');
    const ranked=sources.filter(s=>score.get(s.id)>0 && !chosen.has(s.id)).sort((a,b)=>score.get(b.id)-score.get(a.id) || a.id.localeCompare(b.id));
    for (const s of ranked) {
      // Add a linked context neighborhood atomically, avoiding a correction
      // without its referent solely because the byte budget happened to split it.
      const group=new Set([s.id]); const pending=[s.id];
      while(pending.length){const id=pending.pop();for(const other of links.get(id))if(!group.has(other)){group.add(other);pending.push(other);}}
      const add=[...group].filter(id=>!chosen.has(id));
      const size=add.reduce((n,id)=>n+sourceBytes(ids.get(id)),0);
      if(used+size<=max){add.forEach(id=>chosen.add(id));used+=size;}
    }
  }
  const selected = sources.filter(s=>chosen.has(s.id));
  const omitted=sources.filter(s=>!chosen.has(s.id));
  const candidateOmitted=omitted.filter(s=>score.get(s.id)>0).map(s=>s.id);
  const coverage={
    episode_complete:true, unresolved_source_ids:[], omitted_required_source_ids:[],
    source_watermark:input.source_watermark, index_watermark:input.index_watermark,
    raw_scan_used: input.raw_scan===true,
    declared_source_bytes:used, budget_mode:mode,
    omitted_source_count:omitted.length, omitted_relevant_candidate_ids:candidateOmitted,
    semantic_sufficiency:'not_assessed'
  };
  const binding={
    schema_version:1, case_id, turn_id, inbound_sha256:sha256(inbound),
    evidence_revision:input.evidence_revision, authorization_epoch:authorization.epoch,
    guide_ref:input.guide_ref, constitution_ref:input.constitution_ref,
    retrieval_policy_version:'reference-1', source_watermark:input.source_watermark,
    index_watermark:input.index_watermark, raw_scan_used:input.raw_scan===true,
    effective_transcript_digest:jsonDigest(sources),
    prepared_at:input.prepared_at ?? null, expires_at:input.expires_at ?? null,
    episode_ids:input.episode_ids, required_ids:required,
    source_manifest:selected.map(s=>({id:s.id,sha256:s.sha256,record_digest:jsonDigest(s),kind:s.kind,status:s.status??'unknown',reasons:[...reasons.get(s.id)].sort()})),
    coverage
  };
  const packet={...binding, digest:jsonDigest(binding), sources:structuredClone(selected)};
  return packet;
}

export function verifyPacket(packet) {
  if (!obj(packet) || !Array.isArray(packet.sources) || !Array.isArray(packet.source_manifest)) fail('CONTEXT_REQUIRED');
  const {sources, digest, ...binding}=packet;
  if(jsonDigest(binding)!==digest) fail('PACKET_DIGEST_MISMATCH');
  if(sources.length!==packet.source_manifest.length) fail('CONTEXT_SOURCE_MISSING');
  sources.forEach((s,i)=>{
    const m=packet.source_manifest[i];
    if(s.case_id!==packet.case_id)fail('CASE_SCOPE_VIOLATION');
    if(s.id!==m.id || sha256(s.text)!==m.sha256 || jsonDigest(s)!==m.record_digest)fail('SOURCE_DIGEST_MISMATCH');
  });
  return true;
}

export function verifyContextUse(packet, citedSourceIds) {
  verifyPacket(packet);
  if(!Array.isArray(citedSourceIds)) fail('INVALID_INPUT');
  const available=new Set(packet.source_manifest.map(s=>s.id));
  if(citedSourceIds.some(id=>!available.has(id))) fail('SOURCE_NOT_IN_PACKET');
  return {references_resolve:true, semantic_entailment:'not_assessed'};
}

/** Pure release predicate. Records here must come from trusted server storage.
 * Production additionally requires atomic read/check/append under its current
 * authorization and durable concurrency boundary. This does not implement that.
 */
export function checkRelease({current, packet, candidate, audit, now, language}) {
  if(!current?.authorized) fail('CASE_ACCESS_DENIED');
  verifyPacket(packet);
  const same=(actual,expected,code)=>{if(actual!==expected)fail(code);};
  for(const record of [packet,candidate,audit]) {
    if(!record || record.case_id!==current.case_id) fail('CASE_SCOPE_VIOLATION');
    same(record.turn_id,current.turn_id,'TURN_BINDING_MISMATCH');
  }
  same(packet.inbound_sha256,current.inbound_sha256,'INBOUND_MISMATCH');
  same(packet.evidence_revision,current.evidence_revision,'EVIDENCE_CHANGED');
  same(packet.authorization_epoch,current.authorization_epoch,'CASE_ACCESS_DENIED');
  same(packet.guide_ref,current.guide_ref,'GUIDANCE_CHANGED');
  same(packet.constitution_ref,current.constitution_ref,'GUIDANCE_CHANGED');
  same(packet.digest,current.registered_packet_digest,'CONTEXT_REQUIRED');
  if(!packet.coverage?.episode_complete || packet.coverage.unresolved_source_ids.length || packet.coverage.omitted_required_source_ids.length) fail('CONTEXT_INCOMPLETE');
  if(packet.source_watermark!==packet.index_watermark && !packet.raw_scan_used) fail('INDEX_STALE');
  if(packet.coverage.omitted_relevant_candidate_ids?.length && audit.coverage_disposition!=='adequate_despite_declared_omissions') fail('COVERAGE_NOT_ADJUDICATED');
  if(packet.expires_at!=null) {
    if(!Number.isFinite(Date.parse(packet.expires_at)) || !Number.isFinite(Date.parse(now))) fail('INVALID_INPUT','clock');
    if(Date.parse(now)>Date.parse(packet.expires_at)) fail('CONTEXT_EXPIRED');
  }
  same(candidate.id,current.current_candidate_id,'CANDIDATE_SUPERSEDED');
  if(candidate.superseded) fail('CANDIDATE_SUPERSEDED');
  same(candidate.packet_digest,packet.digest,'CONTEXT_BINDING_MISMATCH');
  same(candidate.evidence_revision,packet.evidence_revision,'EVIDENCE_CHANGED');
  same(candidate.inbound_sha256,current.inbound_sha256,'INBOUND_MISMATCH');
  same(candidate.sha256,sha256(candidate.exact_text),'CANDIDATE_DIGEST_MISMATCH');
  same(candidate.language,language,'DELIVERY_VARIANT_CHANGED');
  for(const [key,value] of Object.entries({candidate_id:candidate.id,candidate_version:candidate.version,candidate_sha256:candidate.sha256,packet_digest:packet.digest,evidence_revision:packet.evidence_revision})) same(audit[key],value,'AUDIT_BINDING_MISMATCH');
  if(audit.verdict!=='PASS') fail('AUDIT_NOT_PASS');
  if(!audit.context_id || !candidate.producer_context_id || audit.context_id===candidate.producer_context_id) fail('INDEPENDENCE_NOT_ESTABLISHED');
  if(!['provider_verified','accepted_external_provenance'].includes(audit.identity_evidence_level)) fail('INDEPENDENCE_NOT_ESTABLISHED');
  if(!audit.completed_at || !Number.isFinite(Date.parse(audit.completed_at))) fail('AUDIT_TIME_REQUIRED');
  same(audit.audit_packet_digest,current.registered_audit_packet_digest,'AUDIT_CONTEXT_UNREGISTERED');
  if(!audit.audit_packet_digest) fail('AUDIT_CONTEXT_UNREGISTERED');
  return {admitted:true, exact_text:candidate.exact_text, approved_against_evidence_revision:packet.evidence_revision, clinical_validity:'not_established'};
}
