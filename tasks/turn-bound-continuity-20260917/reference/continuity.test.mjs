import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256, canonicalJson, jsonDigest, prepareEvidence, verifyPacket, verifyContextUse, checkRelease} from './continuity.mjs';
const clone = x => structuredClone(x);
const error = code => e => e?.code===code;
function source(id, text, extra={}) {return {id,case_id:'case-a',text,sha256:sha256(text),kind:'supervisor_report',status:'reported',...extra};}
function input(extra={}) {
  return {
    case_id:'case-a',turn_id:'turn-new',inbound:'The study room is quieter now.',
    authorization:{allowed:true,case_id:'case-a',epoch:4}, evidence_revision:7,
    source_watermark:7,index_watermark:7,guide_ref:'guide-1',constitution_ref:'constitution-1',
    sources:[source('old','In a quiet room I found reading easier.'),source('episode','I am looking for a new study room.'),source('noise','I bought some red shoes.')],
    episode_ids:['episode'],episode_complete:true,required_ids:[],
    topic_aliases:{quiet:['quiet','quieter','calme','silencieux'],reading:['reading','lire','lecture']},
    relationships:[],prefer_full_history:false,max_source_bytes:10000,
    prepared_at:'2026-09-17T20:00:00Z',expires_at:'2026-09-17T21:00:00Z',...extra
  };
}
function releaseFixture() {
  const packet=prepareEvidence(input());
  const candidate={case_id:'case-a',turn_id:'turn-new',id:'candidate-1',version:1,exact_text:'Has reading become easier in the quieter room?',language:'en',packet_digest:packet.digest,evidence_revision:7,inbound_sha256:packet.inbound_sha256,producer_context_id:'producer-session'};
  candidate.sha256=sha256(candidate.exact_text);
  const audit={case_id:'case-a',turn_id:'turn-new',candidate_id:candidate.id,candidate_version:1,candidate_sha256:candidate.sha256,packet_digest:packet.digest,evidence_revision:7,context_id:'review-session',identity_evidence_level:'accepted_external_provenance',completed_at:'2026-09-17T20:02:00Z',verdict:'PASS',audit_packet_digest:jsonDigest({independently_prepared:true,source_ids:packet.sources.map(s=>s.id)}),coverage_disposition:'adequate'};
  const current={authorized:true,case_id:'case-a',turn_id:'turn-new',inbound_sha256:packet.inbound_sha256,evidence_revision:7,record_revision:50,authorization_epoch:4,guide_ref:'guide-1',constitution_ref:'constitution-1',registered_packet_digest:packet.digest,current_candidate_id:candidate.id,registered_audit_packet_digest:audit.audit_packet_digest};
  return {current,packet,candidate,audit,now:'2026-09-17T20:03:00Z',language:'en'};
}

test('exact text hashes distinguish whitespace and Unicode normalization',()=>{
  assert.notEqual(sha256('hello'),sha256('hello ')); assert.notEqual(sha256('é'),sha256('e\u0301'));
  assert.equal(sha256('😀').length,64);
});
test('invalid Unicode is not silently replaced',()=>assert.throws(()=>sha256('\uD800'),error('INVALID_UTF8')));
test('canonical object ordering stable; array order preserved',()=>{
  assert.equal(canonicalJson({b:2,a:1}),canonicalJson({a:1,b:2}));assert.notEqual(jsonDigest([1,2]),jsonDigest([2,1]));
});
test('canonical JSON rejects undefined, cycles, nonfinite numbers and sparse arrays',()=>{
  const cycle={};cycle.self=cycle;
  for(const x of [{a:undefined},cycle,NaN,new Array(2),new Date()]) assert.throws(()=>canonicalJson(x),error('INVALID_JSON'));
});
test('authorization checked before malformed source inspection',()=>assert.throws(()=>prepareEvidence(input({authorization:{allowed:false},sources:null})),error('CASE_ACCESS_DENIED')));
test('foreign-case source rejected before selection',()=>assert.throws(()=>prepareEvidence(input({sources:[source('alien','quiet',{case_id:'case-b'})]})),error('CASE_SCOPE_VIOLATION')));
test('unindexed old source found by new message, not state flags',()=>{
  const p=prepareEvidence(input());assert(p.sources.some(s=>s.id==='old'));assert(p.source_manifest.find(s=>s.id==='old').reasons.includes('incoming-topic'));
});
test('bilingual alias selects old source without translating its bytes',()=>{
  const p=prepareEvidence(input({inbound:'La pièce est enfin calme.'}));assert(p.sources.some(s=>s.id==='old'));assert.equal(p.sources.find(s=>s.id==='old').text,'In a quiet room I found reading easier.');
});
test('relationship retrieves opposite-side source even without lexical overlap',()=>{
  const i=input();i.sources.push(source('outcome','Following the move I completed three chapters.'));
  i.relationships=[{topics:['quiet'],source_ids:['old','outcome'],status:'reported_association'}];
  const p=prepareEvidence(i);assert(p.sources.some(s=>s.id==='outcome'));assert(p.source_manifest.find(s=>s.id==='outcome').reasons.includes('relationship'));
});
test('later linked correction survives even without query words',()=>{
  const i=input();i.sources.push(source('correction','That earlier pattern no longer holds.',{updates:['old']}));
  const p=prepareEvidence(i);assert(p.sources.some(s=>s.id==='correction'));assert(p.sources.some(s=>s.id==='old'));
});
test('source chain reaches earlier and later context transitively',()=>{
  const i=input();i.sources.push(source('c1','That changed.',{updates:['old']}),source('c2','It was different again.',{updates:['c1']}));
  const p=prepareEvidence(i);assert(p.sources.some(s=>s.id==='c2'));
});
test('assistant draft not selected as independent report by keyword match',()=>{
  const i=input();i.sources.push(source('draft','Quiet proves reading is cured.',{kind:'assistant_draft',status:'hypothesis'}));
  assert(!prepareEvidence(i).sources.some(s=>s.id==='draft'));
});
test('required assistant draft remains marked as draft, not report',()=>{
  const i=input();i.sources.push(source('draft','Quiet proves reading is cured.',{kind:'assistant_draft',status:'hypothesis'}));i.required_ids=['draft'];
  const p=prepareEvidence(i);assert.equal(p.sources.find(s=>s.id==='draft').status,'hypothesis');
});
test('full-history baseline includes all authorized sources when requested and fitting',()=>{
  const p=prepareEvidence(input({prefer_full_history:true}));assert.equal(p.coverage.budget_mode,'full-history');assert.equal(p.sources.length,3);
});
test('required source absence rejected rather than summarized away',()=>assert.throws(()=>prepareEvidence(input({required_ids:['missing']})),error('CONTEXT_SOURCE_MISSING')));
test('missing active episode turn rejected',()=>assert.throws(()=>prepareEvidence(input({episode_ids:['missing']})),error('CONTEXT_SOURCE_MISSING')));
test('incomplete active episode not labeled complete',()=>assert.throws(()=>prepareEvidence(input({episode_complete:false})),error('EPISODE_INCOMPLETE')));
test('required sources that exceed budget cannot silently truncate',()=>assert.throws(()=>prepareEvidence(input({max_source_bytes:1})),error('CONTEXT_BUDGET_UNRESOLVED')));
test('stale index rejected; explicit authorized raw scan is an alternative',()=>{
  assert.throws(()=>prepareEvidence(input({index_watermark:6})),error('INDEX_STALE'));
  const p=prepareEvidence(input({index_watermark:6,raw_scan:true}));assert.equal(p.raw_scan_used,true);assert.equal(p.index_watermark,6);
});
test('tampered source digest rejected',()=>{
  const i=input();i.sources[0].text='changed';assert.throws(()=>prepareEvidence(i),error('SOURCE_DIGEST_MISMATCH'));
});
test('duplicate source ID rejected even with identical bytes',()=>{
  const i=input();i.sources.push(clone(i.sources[0]));assert.throws(()=>prepareEvidence(i),error('DUPLICATE_SOURCE'));
});
test('unresolved amendment does not leak old text as effective current evidence',()=>{
  const i=input();i.sources[0].amendment_pending=true;assert.throws(()=>prepareEvidence(i),error('CONTEXT_SOURCE_MISSING'));
});
test('effective corrected source used exactly once with retained metadata',()=>{
  const i=input();i.sources[0]=source('old','In a quiet room reading was no easier.',{amendment_id:'amend-1',source_artifact_id:'artifact-1'});
  const p=prepareEvidence(i);assert.equal(p.sources.filter(s=>s.id==='old').length,1);assert.equal(p.sources[0].amendment_id,'amend-1');
});
test('source citations resolve but do not certify semantic entailment',()=>{
  const p=prepareEvidence(input());assert.equal(verifyContextUse(p,['old']).semantic_entailment,'not_assessed');assert.throws(()=>verifyContextUse(p,['fabricated']),error('SOURCE_NOT_IN_PACKET'));
});
test('packet content mutation detected',()=>{
  const p=prepareEvidence(input());p.coverage.episode_complete=false;assert.throws(()=>verifyPacket(p),error('PACKET_DIGEST_MISMATCH'));
});
test('source metadata mutation detected, not just text changes',()=>{
  const p=prepareEvidence(input());p.sources[0].status='established_fact';assert.throws(()=>verifyPacket(p),error('SOURCE_DIGEST_MISMATCH'));
});
test('valid exact bindings admitted without claiming clinical validity',()=>{
  const f=releaseFixture(),r=checkRelease(f);assert.equal(r.exact_text,f.candidate.exact_text);assert.equal(r.clinical_validity,'not_established');
});
test('audit bookkeeping revision alone does not invalidate evidence',()=>{
  const f=releaseFixture();f.current.record_revision=99;assert(checkRelease(f).admitted);
});
test('new evidence invalidates pending release',()=>{
  const f=releaseFixture();f.current.evidence_revision++;assert.throws(()=>checkRelease(f),error('EVIDENCE_CHANGED'));
});
test('revoked grant epoch and revoked access rejected',()=>{
  for(const update of [{authorization_epoch:5},{authorized:false}]){const f=releaseFixture();Object.assign(f.current,update);assert.throws(()=>checkRelease(f),error('CASE_ACCESS_DENIED'));}
});
test('changed guide invalidates release',()=>{
  const f=releaseFixture();f.current.guide_ref='guide-2';assert.throws(()=>checkRelease(f),error('GUIDANCE_CHANGED'));
});
test('unregistered packet cannot be vouched for by writer',()=>{
  const f=releaseFixture();f.current.registered_packet_digest='fake';assert.throws(()=>checkRelease(f),error('CONTEXT_REQUIRED'));
});
test('candidate changed without new digest fails',()=>{
  const f=releaseFixture();f.candidate.exact_text+=' Definitely.';assert.throws(()=>checkRelease(f),error('CANDIDATE_DIGEST_MISMATCH'));
});
test('candidate changed with new digest still invalidates prior audit',()=>{
  const f=releaseFixture();f.candidate.exact_text+=' Definitely.';f.candidate.sha256=sha256(f.candidate.exact_text);assert.throws(()=>checkRelease(f),error('AUDIT_BINDING_MISMATCH'));
});
test('changed candidate version invalidates old audit',()=>{
  const f=releaseFixture();f.candidate.version++;assert.throws(()=>checkRelease(f),error('AUDIT_BINDING_MISMATCH'));
});
test('superseded candidate cannot release',()=>{
  const f=releaseFixture();f.candidate.superseded=true;assert.throws(()=>checkRelease(f),error('CANDIDATE_SUPERSEDED'));
});
test('same context cannot supply independent approval',()=>{
  const f=releaseFixture();f.audit.context_id=f.candidate.producer_context_id;assert.throws(()=>checkRelease(f),error('INDEPENDENCE_NOT_ESTABLISHED'));
});
test('self-reported reviewer identity is not sufficient approval evidence',()=>{
  const f=releaseFixture();f.audit.identity_evidence_level='self_reported';assert.throws(()=>checkRelease(f),error('INDEPENDENCE_NOT_ESTABLISHED'));
});
test('accepted external provenance remains valid; new crypto attestation not imposed',()=>{
  const f=releaseFixture();assert.equal(f.audit.identity_evidence_level,'accepted_external_provenance');assert(checkRelease(f).admitted);
});
test('operational error is not a passing review',()=>{
  const f=releaseFixture();f.audit.verdict='OPERATIONAL_ERROR';assert.throws(()=>checkRelease(f),error('AUDIT_NOT_PASS'));
});
test('approval requires known completion time',()=>{
  const f=releaseFixture();f.audit.completed_at=null;assert.throws(()=>checkRelease(f),error('AUDIT_TIME_REQUIRED'));
});
test('review evidence packet also must be registered',()=>{
  const f=releaseFixture();f.current.registered_audit_packet_digest='other';assert.throws(()=>checkRelease(f),error('AUDIT_CONTEXT_UNREGISTERED'));
});
test('translation after approval is not the approved variant',()=>{
  const f=releaseFixture();f.language='fr';assert.throws(()=>checkRelease(f),error('DELIVERY_VARIANT_CHANGED'));
});
test('expired preparation rejected',()=>{
  const f=releaseFixture();f.now='2026-09-17T22:00:00Z';assert.throws(()=>checkRelease(f),error('CONTEXT_EXPIRED'));
});
test('cross-case audit rejected',()=>{
  const f=releaseFixture();f.audit.case_id='case-b';assert.throws(()=>checkRelease(f),error('CASE_SCOPE_VIOLATION'));
});
test('source-ready does not claim relevance comprehension',()=>assert.equal(prepareEvidence(input()).coverage.semantic_sufficiency,'not_assessed'));
