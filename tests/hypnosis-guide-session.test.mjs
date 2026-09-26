import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createSession, advanceSession, GUARDS} from '../src/hypnosis-guide/session.mjs';
import {getKnowledge,searchKnowledge,validateKnowledge} from '../src/hypnosis-guide/knowledge.mjs';
import {validateHypnosisGraph} from '../src/hypnosis-guide/validate.mjs';
import {prepareHypnosisContext} from '../src/hypnosis-guide/context.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(root+p,'utf8'));
const graph=read('guide-graphs/candidates/inner-signal-hypnosis.graph.json');
const library=read('reference/hypnosis/knowledge.json');
const today='2026-09-11'; let seq=0;
const step=(s,type,data={},g=graph,day=today)=>advanceSession(g,s,{id:`test-${++seq}`,type,...data},{today:day});
const ready={safePlace:'yes',orientation:'present',canStop:'yes',canReturn:'yes',capacity:'workable',willingness:'yes',methodUse:'ordinary'};
const plan=(facts={},extras={})=>step(createSession(),'PLAN',{purpose:'chosen love or contact',focus:'positive',facts:{...ready,...facts},evidenceId:'synthetic-report',...extras}).session;
const exploring=(facts={},extras={})=>step(step(plan(facts,extras),'BEGIN').session,'ENTRY_COMPLETE',{response:'adequate'}).session;
const has=(out,id)=>out.plan.selectedNodeIds.includes('HYP.'+id);

test('actual graph and complete source records validate; no implied production installation',()=>{
 assert.equal(validateHypnosisGraph(graph,library),graph);
 assert.equal(graph.boundaries.installedPacketChanged,false);
 const bytes=fs.readFileSync(root+'reference/hypnosis/knowledge.json');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),graph.librarySha256);
 assert.equal(library.counts['external-research'],38); // 36 cards, ledger and consultation protocol
});
test('fresh unknown context does not select a return before a session exists',()=>{
 const o=step(createSession(),'REPORT');assert.equal(o.session.phase,'idle');assert.equal(o.plan.selectedNodeIds.length,0);
});
test('purpose is not reasked after plan, during practice or at ending',()=>{
 const o=step(exploring(),'NEXT');assert.ok(has(o,'POSITIVE_RESOURCE'));assert.ok(!has(o,'CHOOSE_PURPOSE'));
 assert.equal(step(o.session,'FINISH').session.phase,'returning');
});
test('consulting about a hypnotist never requires a practice or an induction',()=>{
 const o=prepareHypnosisContext(graph,library,createSession(),{id:'consult',type:'CONSULT',topicId:'REF.T26'},{today});
 assert.ok(has(o,'PRACTITIONER_VETTING'));assert.equal(o.session.phase,'idle');assert.equal(o.knowledge.records[0].id,'REF.T26');assert.equal(o.plan.liveEnactmentCandidate,false);
});
test('teaching actually retrieves induction text rather than only a heading',()=>{
 const o=prepareHypnosisContext(graph,library,createSession(),{id:'learn',type:'LEARN',topicId:'HYP.S.sober-induction-3-5-minutes'},{today});
 assert.ok(has(o,'APP_BRIDGE'));assert.ok(o.knowledge.records[0].text.includes('Let your eyes settle'));assert.equal(o.knowledge.narrateCitations,false);
});
test('sources preserve external author account versus application and source ledger',()=>{
 const c=getKnowledge(library,'REF.T11').records[0];assert.match(c.text,/Source account/);assert.match(c.text,/Application/);
 assert.equal(c.layer,'external-research');assert.ok(getKnowledge(library,'REF.SOURCES').records[0].text.length>1000);
});
test('unknown branded method cannot be replaced by generic hypnosis matches',()=>{
 assert.equal(searchKnowledge(library,'What is Quarzflumpling hypnosis?').status,'lookup-required');
 assert.equal(getKnowledge(library,'REF.MADE_UP').status,'lookup-required');
});
test('reference access is independent of live method eligibility',()=>{
 const s=plan({methodUse:'trauma_origin_search'});assert.ok(has(step(s,'BEGIN'),'SUPPORT_WITH_TRAINED_PERSON'));
 const o=prepareHypnosisContext(graph,library,s,{id:'question',type:'CONSULT',topicId:'REF.T26'},{today});
 assert.ok(o.knowledge.records[0].text.includes('regression'));assert.equal(o.plan.liveEnactmentCandidate,false);
});
test('known recollection and positive resourcing are not blanket regression bans',()=>{
 for(const methodUse of ['known_recollection','resourcing']) assert.equal(step(plan({methodUse}),'BEGIN').session.phase,'entering');
});
test('merely available support does not change normal selection',()=>{
 const a=step(plan({supportAvailable:'yes'}),'BEGIN'), b=step(plan({supportAvailable:'no'}),'BEGIN');
 assert.equal(a.plan.rule,b.plan.rule);assert.deepEqual(a.plan.selectedNodeIds,b.plan.selectedNodeIds);
});
test('high intensity with workable chosen contact can continue',()=>{
 const o=step(exploring({intensity:'high'}),'NEXT');assert.equal(o.session.phase,'exploring');assert.ok(has(o,'POSITIVE_RESOURCE'));
});
test('unworkable response is different from high intensity',()=>{
 const o=step(exploring(),'REPORT',{facts:{capacity:'overwhelmed'},evidenceId:'report-unworkable'});assert.ok(has(o,'CAPACITY_BEFORE_CONTENT'));assert.equal(o.session.phase,'returning');
});
test('comfort never overrides explicit refusal',()=>{
 const o=step(exploring(),'REPORT',{facts:{willingness:'no'},evidenceId:'withdrawn'});assert.equal(o.session.phase,'returning');assert.ok(has(o,'FULL_RETURN'));
});
test('stop before entering is an ordinary close, not an induction',()=>{
 assert.equal(step(plan(),'STOP').session.phase,'closed');assert.equal(step(createSession(),'STOP').session.phase,'closed');
});
test('less contact and chosen resumption do not reset the purpose',()=>{
 const x=step(exploring(),'LESS');assert.equal(x.session.phase,'external');assert.ok(has(x,'CONTACT_DOSE'));
 const y=step(x.session,'RESUME');assert.equal(y.session.phase,'exploring');assert.equal(y.session.purpose,x.session.purpose);
});
test('quiet and silence are not evidence of consent, success or dissociation',()=>{
 const x=step(exploring(),'QUIET'), y=step(x.session,'NEXT',{response:'silence'});
 assert.equal(y.plan.question,'');assert.equal(y.plan.narration,'quiet');assert.equal(y.session.facts.dissociation,'unknown');
 assert.equal(step(y.session,'STOP').session.phase,'returning');
});
test('rejection stops repeating the same approach until a new explicit choice',()=>{
 const x=step(exploring(),'REJECT');assert.equal(x.session.phase,'external');
 const y=step(x.session,'RESUME');assert.notEqual(y.session.phase,'exploring');
 const z=step(x.session,'SELECT_FOCUS',{focus:'feeling'});assert.equal(step(z.session,'RESUME').session.phase,'exploring');
});
test('tightening alone does not diagnose a protector or reject the wording',()=>{
 const o=step(exploring(),'NEXT',{response:'tightness'});assert.equal(o.session.rejectedFocus,null);assert.ok(o.plan.constraints.includes('HYP.BODY_SIGNAL_NOT_VERDICT'));
});
test('no response gets a different-route teaching option, not hidden success',()=>{
 const o=step(step(plan(),'BEGIN').session,'NO_RESPONSE');assert.equal(o.session.phase,'returning');assert.ok(has(o,'ALTERNATIVE_ENTRY'));
});
test('inability to stop cannot leave induction eligible alongside a safety message',()=>{
 const o=step(plan({canStop:'no'}),'BEGIN');assert.ok(!has(o,'INDUCTION'));assert.equal(o.plan.liveEnactmentCandidate,false);
});
test('attention-requiring setting refuses trance entry including eyes-open claims',()=>{
 const o=step(plan({safePlace:'attention_task'}),'BEGIN');assert.ok(!has(o,'INDUCTION'));assert.equal(o.plan.liveEnactmentCandidate,false);
});
test('unknown return skill is preparation to learn, not proof of pathology or automatic return',()=>{
 const o=step(plan({canReturn:'unknown'}),'BEGIN');assert.equal(o.session.phase,'preparing');assert.ok(has(o,'PREPARATION'));assert.ok(o.plan.unresolvedFields.includes('canReturn'));assert.ok(!has(o,'FULL_RETURN'));
});
test('acute dissociation preserves the source’s day endpoint',()=>{
 let x=step(exploring(),'REPORT',{facts:{dissociation:'acute',orientation:'lost'},evidenceId:'acute'});
 assert.equal(x.session.deeperWorkHoldDay,today);assert.equal(x.session.phase,'returning');assert.ok(has(x,'DISSOCIATION_RESPONSE'));
 x=step(x.session,'RETURN_CONFIRMED',{facts:{dissociation:'none',orientation:'present',returnReport:'oriented_alert_moving',canStop:'yes',canReturn:'yes'},evidenceId:'returned'});
 assert.equal(x.session.phase,'reviewing');
 const carry=createSession({carry:x.session});
 const p=step(carry,'PLAN',{purpose:'new practice',facts:ready,evidenceId:'new-report'}).session;
 assert.ok(has(step(p,'BEGIN'),'DISSOCIATION_RESPONSE'));
 const tomorrow='2026-09-12';assert.equal(step(p,'BEGIN',{},graph,tomorrow).session.phase,'entering');
});
test('epistemic cautions are constraints, never suppressed with low capacity',()=>{
 const x=step(exploring(),'REPORT',{facts:{capacity:'overwhelmed'},evidenceId:'unworkable'});
 assert.ok(x.plan.constraints.includes('HYP.MEMORY_CAUTION'));assert.equal(x.plan.protectiveKnowledgeAvailable,true);
});
test('known return ability does not suppress an explicit ending',()=>assert.equal(step(exploring(),'FINISH').session.phase,'returning'));
test('count ending is not evidence of waking return',()=>{
 const x=step(exploring(),'FINISH');assert.equal(step(x.session,'RETURN_CONFIRMED').session.phase,'returning');
 assert.equal(step(x.session,'RETURN_CONFIRMED',{facts:{returnReport:'oriented_alert_moving'},evidenceId:'actual-return-report'}).session.phase,'reviewing');
});
test('waking recording interruption selects accessible fallback',()=>{
 const x=step(exploring(),'INTERRUPTED');assert.equal(x.session.phase,'returning');assert.ok(has(x,'INTERRUPTION_RETURN'));
});
test('ordinary-awareness contact can investigate and close without a phantom trance',()=>{
 const x=step(plan({canReturn:'unknown'},{mode:'no_trance'}),'BEGIN');assert.equal(x.session.phase,'external');assert.ok(has(x,'NO_TRANCE_CONTACT'));
 assert.ok(has(step(x.session,'NEXT'),'POSITIVE_RESOURCE'));assert.equal(step(x.session,'FINISH').session.phase,'closed');
});
test('sleep endpoint is distinct and does not become a waking return on silence',()=>{
 const x=step(plan({canReturn:'unknown'},{mode:'sleep'}),'BEGIN');assert.equal(x.session.phase,'external');
 const y=step(x.session,'FINISH');assert.equal(y.session.phase,'sleep');assert.ok(has(y,'SLEEP'));
});
test('cue training needs learned entry/return and a welcome receptive context',()=>{
 assert.equal(step(exploring(),'TRAIN_CUE',{response:'welcome_receptive'}).plan.rule,'cue-prerequisites-not-met');
 const s=exploring({entryReturnLearned:'yes'});
 assert.equal(step(s,'TRAIN_CUE',{response:'welcome_receptive'}).plan.rule,'cue-learning');
 assert.notEqual(step(s,'TRAIN_CUE',{response:'peak_emotion'}).plan.rule,'cue-learning');
 assert.notEqual(step(exploring({entryReturnLearned:'yes',cueUnwanted:'yes'}),'TRAIN_CUE',{response:'welcome_receptive'}).plan.rule,'cue-learning');
});
test('already present witness leads to missing adult function, not observer drill',()=>{
 const x=step(exploring({witness:'present',missingAdult:'warmth'},{focus:'borrow_adult'}),'NEXT');
 assert.ok(has(x,'BORROW_ADULT'));assert.ok(!has(x,'WITNESS'));assert.match(x.plan.question,/take good care/);
});
test('witness remains available when that is the missing capacity',()=>{
 const x=step(exploring({witness:'unavailable',missingAdult:'warmth'},{focus:'borrow_adult'}),'NEXT');assert.ok(has(x,'WITNESS'));
});
test('distrust does not suppress available love or require practical proof first',()=>{
 const x=step(exploring({love:'present',trust:'adverse_track_record'},{focus:'trust'}),'NEXT');assert.ok(has(x,'LOVE_AND_TRUST'));
 const record=getKnowledge(library,'HYP.S.love-doesn-t-have-to-wait-for-trust').records[0];assert.match(record.text,/relational|Hearing anger/);assert.match(record.text,/blaming voice/);
});
test('repetitive grief is not automatically a checking loop',()=>{
 const live=step(exploring({loop:'live_work'},{focus:'loop'}),'NEXT');assert.ok(!has(live,'PROCESSING_LOOP'));
 const check=step(exploring({loop:'reassurance_checking'},{focus:'loop'}),'NEXT');assert.ok(has(check,'PROCESSING_LOOP'));assert.equal(check.plan.question,'');
});
test('current outward assessment and spiritual struggle have distinct source routes',()=>{
 assert.ok(has(step(exploring({},{focus:'relational'}),'NEXT'),'RELATIONAL_REALITY'));
 assert.ok(has(step(exploring({},{focus:'spiritual_struggle'}),'NEXT'),'SPIRITUAL_STRUGGLE'));
});
test('positive practice does not require child appearance, action or greater depth',()=>{
 const o=step(exploring(),'NEXT');assert.ok(has(o,'POSITIVE_RESOURCE'));
 const weekly=graph.nodes.find(n=>n.id==='HYP.WEEKLY_DEEPER');assert.match(weekly.title,/need not/);assert.doesNotMatch(weekly.successCriterion,/Depth increases/);
});
test('new session plan cannot inherit prior-session consent or current safety silently',()=>{
 const x=step(step(exploring(),'FINISH').session,'RETURN_CONFIRMED',{facts:{returnReport:'oriented_alert_moving'},evidenceId:'returned'});
 const closed=step(x.session,'CLOSE').session;
 const p=step(closed,'PLAN',{purpose:'different issue'});assert.equal(p.session.facts.willingness,'unknown');assert.equal(step(p.session,'BEGIN').session.phase,'preparing');
});
test('reported evidence, fact enum and phase contracts are validated',()=>{
 assert.throws(()=>step(createSession(),'REPORT',{facts:{orientation:'present'}}),/evidence/);
 assert.throws(()=>step(createSession(),'REPORT',{facts:{orientation:'miraculously'},evidenceId:'x'}),/orientation/);
 assert.throws(()=>step(createSession(),'FAKE'),/Unknown event/);
 assert.throws(()=>step(createSession(),'REPORT',{facts:{diagnosis:'xyz'},evidenceId:'x'}),/Unknown/);
});
test('same event replay idempotent; changed content under same id rejected',()=>{
 const e={id:'replay',type:'PLAN',purpose:'rest'};const a=advanceSession(graph,createSession(),e,{today});const b=advanceSession(graph,a.session,e,{today});assert.deepEqual(a,b);
 assert.throws(()=>advanceSession(graph,a.session,{...e,purpose:'other'},{today}),/reused/);
});
test('source drift and wrong graph-source binding fail',()=>{
 const l=structuredClone(library);l.records[0].text+='x';assert.throws(()=>validateKnowledge(l),/drift/);
 const g=structuredClone(graph);g.sourceAuthority.sha256='0'.repeat(64);assert.throws(()=>validateHypnosisGraph(g,library),/identity/);
});
test('budget omission is visible and no source text is silently chopped',()=>{
 const o=prepareHypnosisContext(graph,library,createSession(),{id:'budget',type:'LEARN',topicId:'REF.SOURCES'},{today,maxCharacters:100});
 assert.deepEqual(o.knowledge.omitted,['REF.SOURCES']);assert.equal(o.knowledge.records.length,0);
});
test('transition guard mutation loses protected entry behavior and is detectable',()=>{
 const s=plan({canReturn:'unknown'});assert.equal(step(s,'BEGIN').session.phase,'preparing');
 const mutant=structuredClone(graph);mutant.transitions.find(t=>t.id==='begin-waking').guard='always';assert.equal(step(s,'BEGIN',{},mutant).session.phase,'entering');
});
test('all transition guards exist; no accidental legacy-v1 execution contract',()=>{
 assert.equal(graph.contractVersion,'hypnosis-session-map-v2');
 for(const t of graph.transitions)assert.equal(typeof GUARDS[t.guard],'function');
 assert.ok(!Object.hasOwn(graph,'taskPolicyVersion'));
});

test('risk before any induction does not invent a trance or strand later preparation',()=>{
 let o=step(createSession(),'REPORT',{facts:{safePlace:'no'},evidenceId:'unsafe-place'});assert.equal(o.session.inwardSessionOpened,false);assert.ok(!has(o,'FULL_RETURN'));
 o=step(o.session,'REPORT',{facts:ready,evidenceId:'now-ready'});o=step(o.session,'PLAN',{purpose:'new adequate setting',facts:ready,evidenceId:'current'});
 assert.equal(o.session.phase,'preparing');assert.equal(step(o.session,'BEGIN').session.phase,'entering');
});
test('external support without prior induction can stop normally',()=>{
 const x=step(createSession(),'REPORT',{facts:{capacity:'overwhelmed'},evidenceId:'overwhelmed'});
 const y=step(x.session,'REPORT',{facts:{capacity:'workable'},evidenceId:'settled'});
 const z=step(y.session,'STOP');assert.equal(z.session.phase,'closed');assert.ok(has(z,'NO_TRANCE_CLOSE'));
});
