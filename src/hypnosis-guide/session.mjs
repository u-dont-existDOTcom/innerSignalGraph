/** Development-only hypnosis session controller. No audio, model calls, or I/O.
 * It consumes explicit, provenance-bearing reports; it does not infer a body state.
 * Version 2 is deliberately incompatible with the legacy guide-graph-v1 selector.
 */
import { createHash } from 'node:crypto';

export const CONTRACT = 'hypnosis-session-map-v2';
export const PHASES = ['idle','preparing','entering','exploring','external','returning','reviewing','closed','sleep'];
export const FACTS = Object.freeze({
  safePlace: ['unknown','yes','no','attention_task'], orientation: ['unknown','present','lost'],
  canStop: ['unknown','yes','no'], canReturn: ['unknown','yes','no'],
  capacity: ['unknown','workable','overwhelmed'], willingness: ['unknown','yes','no'],
  danger: ['unknown','none','immediate'], medical: ['unknown','none','concerning'],
  dissociation: ['unknown','none','acute'], intensity: ['unknown','low','high'],
  supportAvailable: ['unknown','yes','no'], witness: ['unknown','present','unavailable'],
  missingAdult: ['unknown','none','warmth','protection','direction'],
  love: ['unknown','present','unavailable'], trust: ['unknown','present','doubt','adverse_track_record'],
  loop: ['unknown','live_work','reassurance_checking'], relationalIssue: ['unknown','present','absent'],
  externalAssessed: ['unknown','yes','no'], entryReturnLearned: ['unknown','yes','no'],
  returnReport: ['unknown','oriented_alert_moving'], cueUnwanted: ['unknown','yes','no'],
  methodUse: ['unknown','ordinary','resourcing','known_recollection','trauma_origin_search','deliberate_trauma_regression','substantial_flashbacks']
});
export const GUARD_TEXT = Object.freeze({
  always: 'No additional eligibility claim; event and source phase still must match.',
  canPlan: 'No active inward session is silently overwritten; plan only from idle, preparing or closed.',
  canEnter: 'Chosen waking entry; suitable place, present orientation, workable reported capacity and usable stop/return; no current acute risk, no same-day deeper-work hold; ordinary or resourcing method.',
  canEnterExternal: 'Chosen no-trance route in suitable surroundings with present orientation and usable stopping; no requirement to learn hypnotic return first.',
  canEnterSleep: 'Chosen bedtime resource in a suitable place, with reported orientation and stopping; no acute risk or trauma procedure. This selects the sleep resource, not a clinical session.',
  canExplore: 'Present, willing, able to shift/stop/return, workable current response; same-day deeper-work hold absent. Intensity alone is not a failed guard.',
  entryAccepted: 'User reports the entry useful or adequate and elects to continue; no dramatic trance sign is required.',
  mayTrainCue: 'Entry and return already learned; explicit cue-training request during suitable welcome practice, not an unwanted cue or difficult peak.',
  mayResume: 'Explicit resumption after reducing contact, with current workable reports and no rejection of the selected approach.',
  returnConfirmed: 'Current explicit report of oriented, alert, voluntary movement; a count or elapsed time alone is insufficient.',
  isWaking: 'An inward waking session needs its full return.',
  isExternal: 'No inward session was opened; close ordinary-awareness contact without invented de-induction.',
  isSleep: 'The separately chosen sleep practice may end in sleep/rest; no acute warning is inferred from silence.',
  isAcute: 'Actual report of acute dissociation or lost orientation; preserve source instruction to end deeper practice for the day.',
  isUrgent: 'Actual reported immediate danger, concerning physical symptoms, unsafe surroundings or inability to stop/return.',
  isOverwhelmed: 'The report says current contact is unworkable, not merely intense.',
  isRefusal: 'The person has withdrawn willingness; comfort does not make refusal negotiable.',
  needsClinician: 'The requested live procedure is deliberate trauma regression, unknown-origin trauma bridging, or substantial flashback work. Explanations remain accessible.',
});
const clinicianMethods = new Set(['trauma_origin_search','deliberate_trauma_regression','substantial_flashbacks']);
const active = s => ['entering','exploring','external','returning'].includes(s.phase);
const urgent = s => s.facts.danger==='immediate' || s.facts.medical==='concerning'
  || ['no','attention_task'].includes(s.facts.safePlace) || s.facts.canStop==='no' || s.facts.canReturn==='no';
const acute = s => s.facts.dissociation==='acute' || s.facts.orientation==='lost';
const base = s => s.facts.safePlace==='yes' && s.facts.orientation==='present'
  && s.facts.canStop==='yes' && s.facts.willingness==='yes' && !urgent(s) && !acute(s);
const withinSolo = s => ['ordinary','resourcing','known_recollection'].includes(s.facts.methodUse);
const canExplore = (s,e,today) => base(s) && s.facts.canReturn==='yes' && s.facts.capacity==='workable'
  && withinSolo(s) && s.deeperWorkHoldDay!==today;
export const GUARDS = Object.freeze({
  always: () => true,
  canPlan: s => ['idle','preparing','closed'].includes(s.phase) || (s.phase==='external' && !s.inwardSessionOpened),
  canEnter: (s,e,t) => s.mode==='waking' && canExplore(s,e,t),
  canEnterExternal: s => s.mode==='no_trance' && base(s) && withinSolo(s),
  canEnterSleep: s => s.mode==='sleep' && base(s) && withinSolo(s) && s.facts.capacity!=='overwhelmed',
  canExplore,
  entryAccepted: (s,e,t) => ['useful','adequate'].includes(e.response) && canExplore(s,e,t),
  mayTrainCue: (s,e,t) => canExplore(s,e,t) && s.facts.entryReturnLearned==='yes'
    && s.facts.cueUnwanted!=='yes' && ['welcome_receptive'].includes(e.response),
  mayResume: (s,e,t) => canExplore(s,e,t) && s.mode==='waking' && s.rejectedFocus!==s.focus,
  returnConfirmed: s => s.facts.returnReport==='oriented_alert_moving' && s.facts.orientation==='present'
    && s.facts.canStop==='yes' && s.facts.canReturn==='yes',
  isWaking: s => s.mode==='waking' && s.inwardSessionOpened, isExternal: s => !s.inwardSessionOpened, isSleep: s => s.mode==='sleep',
  isAcute: acute, isUrgent: urgent, isOverwhelmed: s => s.facts.capacity==='overwhelmed',
  isRefusal: s => s.facts.willingness==='no', needsClinician: s => clinicianMethods.has(s.facts.methodUse)
});
const FOCI = Object.freeze({
  positive: 'HYP.POSITIVE_RESOURCE', feeling: 'HYP.RESPONSIVE_INVITATION',
  inner_child: 'HYP.INNER_MEETING', borrow_adult: 'HYP.BORROW_ADULT',
  trust: 'HYP.LOVE_AND_TRUST', identity: 'HYP.IDENTITY_PLAY',
  spiritual_struggle: 'HYP.SPIRITUAL_STRUGGLE', relational: 'HYP.RELATIONAL_REALITY',
  loop: 'HYP.PROCESSING_LOOP', unclear: 'HYP.RESPONSIVE_INVITATION'
});
export function createSession({ carry = null } = {}) {
  return { contract: CONTRACT, phase:'idle', mode:'waking', purpose:'', focus:'unclear', inwardSessionOpened:false,
    narration:'responsive', facts:Object.fromEntries(Object.keys(FACTS).map(k=>[k,'unknown'])),
    evidence:{}, deeperWorkHoldDay:carry?.deeperWorkHoldDay ?? null, rejectedFocus:null,
    lastEventId:null, lastEventHash:null, lastResult:null };
}
function keys(obj, allowed, label) {
  if (!obj || typeof obj!=='object' || Array.isArray(obj)) throw new TypeError(`${label} must be an object`);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new TypeError(`Unknown ${label} field ${k}`);
}
function validate(s, e, today) {
  if (s?.contract!==CONTRACT || !PHASES.includes(s.phase) || typeof s.inwardSessionOpened!=='boolean') throw new TypeError('Invalid session contract or phase');
  keys(s.facts,Object.keys(FACTS),'session facts');
  for (const [k,values] of Object.entries(FACTS)) if (!values.includes(s.facts[k])) throw new TypeError(`Invalid session fact ${k}`);
  if (!['waking','sleep','no_trance'].includes(s.mode) || !Object.hasOwn(FOCI,s.focus)) throw new TypeError('Invalid session mode/focus');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '') || Number.isNaN(Date.parse(today))) throw new TypeError('Caller must supply actual YYYY-MM-DD');
  keys(e,['id','type','facts','mode','purpose','focus','response','topicId','query','evidenceId'],'event');
  if (typeof e.id!=='string' || !e.id.trim() || e.id.length>160) throw new TypeError('Bounded event id required');
  if (typeof e.type!=='string') throw new TypeError('Event type required');
  if (e.facts) {
    keys(e.facts,Object.keys(FACTS),'facts');
    if (Object.keys(e.facts).length && (typeof e.evidenceId!=='string' || !e.evidenceId.trim())) throw new TypeError('Reported facts need an evidence reference');
    for (const [k,v] of Object.entries(e.facts)) if (!FACTS[k].includes(v)) throw new TypeError(`Invalid ${k}`);
  }
  if (e.mode!=null && !['waking','no_trance','sleep'].includes(e.mode)) throw new TypeError('Invalid mode');
  if (e.focus!=null && !Object.hasOwn(FOCI,e.focus)) throw new TypeError('Invalid focus');
  for (const k of ['purpose','response','query','topicId','evidenceId']) if (e[k]!=null && (typeof e[k]!=='string' || e[k].length>4000)) throw new TypeError(`Invalid bounded ${k}`);
}
function refsFor(graph, ids) {
  return [...new Set(ids.flatMap(id=>graph.nodes.find(n=>n.id===id)?.sourceRefs ?? []))];
}
function result(graph,s,e,rule,ids,{question='',unresolved=[],enact=false}={}) {
  const out={phase:s.phase,rule,selectedNodeIds:ids,sourceRefs:refsFor(graph,ids),question,
    unresolvedFields:unresolved,narration:s.narration,liveEnactmentCandidate:enact,
    constraints:['HYP.BODY_SIGNAL_NOT_VERDICT','HYP.MEMORY_CAUTION','HYP.ANALYSIS_BALANCE'],
    protectiveKnowledgeAvailable:true,externalKnowledgeAvailable:true,
    reportStatus:'structured user/caller report, not observed physiology',installedRuntimeChanged:false};
  s.lastEventId=e.id; s.lastEventHash=createHash('sha256').update(JSON.stringify(e)).digest('hex');
  s.lastResult=structuredClone(out); return {session:s,plan:out};
}
function focusNode(s) {
  if (s.focus==='borrow_adult') return s.facts.witness==='present' ? 'HYP.BORROW_ADULT' : 'HYP.WITNESS';
  if (s.focus==='loop') return s.facts.loop==='reassurance_checking' ? 'HYP.PROCESSING_LOOP' : 'HYP.RESPONSIVE_INVITATION';
  if (s.focus==='inner_child' && s.facts.missingAdult!=='none' && s.facts.missingAdult!=='unknown') return s.facts.witness==='present' ? 'HYP.BORROW_ADULT' : 'HYP.WITNESS';
  return FOCI[s.focus];
}
/** Exact graph transition table is executed here, not decorative edge traversal. */
export function advanceSession(graph, session, event, {today} = {}) {
  if (graph.contractVersion!==CONTRACT) throw new TypeError('This controller requires hypnosis-session-map-v2');
  validate(session,event,today); const e=event;
  const digest=createHash('sha256').update(JSON.stringify(e)).digest('hex');
  if (e.id===session.lastEventId) {
    if (digest!==session.lastEventHash) throw new TypeError('Event id reused with different content');
    return {session:structuredClone(session),plan:structuredClone(session.lastResult)};
  }
  const s=structuredClone(session);
  for (const [k,v] of Object.entries(e.facts ?? {})) {s.facts[k]=v;s.evidence[k]=e.evidenceId;}
  // Consultation is a knowledge request, not a report of current impairment.
  // No session phase/consent is inferred from words such as regression or trauma.
  if (['LEARN','CONSULT'].includes(e.type)) {
    if (e.facts) throw new TypeError('Use REPORT for current state; do not mix consultation with acute intake');
    return result(graph,s,e,'knowledge-request',[e.type==='CONSULT'?'HYP.PRACTITIONER_VETTING':'HYP.APP_BRIDGE']);
  }
  const known=new Set([...graph.transitions.map(t=>t.event),'PLAN','REPORT','NEXT','SELECT_FOCUS','QUIET','REJECT','LEARN','CONSULT']);
  if (!known.has(e.type)) throw new TypeError(`Unknown event ${e.type}`);
  // Interruption precedence is part of the graph and appears separately in its map.
  if (acute(s)) s.deeperWorkHoldDay=today;
  for (const rule of graph.interrupts) {
    if (!GUARDS[rule.guard](s,e,today)) continue;
    if (rule.guard==='isAcute') s.deeperWorkHoldDay=today;
    if (rule.guard==='isRefusal' && !s.inwardSessionOpened) {s.phase='closed';return result(graph,s,e,rule.id,['HYP.NO_TRANCE_CLOSE']);}
    // Finishing confirmation must be possible after the earlier refusal to continue.
    if (rule.guard==='isRefusal' && ['returning','reviewing'].includes(s.phase)) continue;
    s.phase = !s.inwardSessionOpened ? 'external' : 'returning';
    const ids=[rule.node]; if(s.phase==='returning') ids.push('HYP.FULL_RETURN');
    return result(graph,s,e,rule.id,ids);
  }
  if (e.type==='PLAN') {
    if (!GUARDS.canPlan(s)) return result(graph,s,e,'finish-existing-session-first',['HYP.FULL_RETURN']);
    if (!e.purpose?.trim()) return result(graph,s,e,'purpose-missing',['HYP.CHOOSE_PURPOSE'],{question:'What would you like this practice to be for?'});
    // A new scope cannot silently inherit last session's consent or readiness.
    const learned=s.facts.entryReturnLearned;
    s.facts=Object.fromEntries(Object.keys(FACTS).map(k=>[k,'unknown']));s.evidence={};
    s.facts.entryReturnLearned=learned;
    for (const [k,v] of Object.entries(e.facts ?? {})) {s.facts[k]=v;s.evidence[k]=e.evidenceId;}
    s.mode=e.mode ?? 'waking';s.purpose=e.purpose;s.focus=e.focus ?? 'unclear';s.phase='preparing';s.inwardSessionOpened=false;s.narration='responsive';s.rejectedFocus=null;
    return result(graph,s,e,'plan-chosen',['HYP.PREPARATION']);
  }
  if (e.type==='QUIET') {
    s.narration='quiet'; return result(graph,s,e,'quiet-not-consent',['HYP.SILENCE_CHOICE']);
  }
  if (e.type==='REJECT') {
    s.rejectedFocus=s.focus;s.narration='quiet';
    if (['exploring','entering'].includes(s.phase)) s.phase='external';
    return result(graph,s,e,'rejection-respected',['HYP.REJECT_WORDING']);
  }
  if (e.type==='SELECT_FOCUS') {
    if (!e.focus) throw new TypeError('SELECT_FOCUS requires a named chosen focus');
    s.focus=e.focus;
    // An explicit new selection can reopen the chosen topic, not silence alone.
    s.rejectedFocus=null;
    return result(graph,s,e,'focus-chosen',[focusNode(s)],{enact:s.phase==='exploring' && GUARDS.canExplore(s,e,today)});
  }
  if (e.type==='NEXT') {
    if (s.narration==='quiet') return result(graph,s,e,'quiet-retained',['HYP.SILENCE_CHOICE']);
    if (GUARDS.needsClinician(s)) return result(graph,s,e,'procedure-needs-trained-presence',['HYP.SUPPORT_WITH_TRAINED_PERSON']);
    const ordinaryContact=s.phase==='external' && s.mode==='no_trance' && base(s) && withinSolo(s) && s.facts.capacity!=='overwhelmed';
    if (!(s.phase==='exploring' && GUARDS.canExplore(s,e,today)) && !ordinaryContact) return result(graph,s,e,'not-an-exploration-step',['HYP.PREPARATION']);
    const id=focusNode(s);
    return result(graph,s,e,'responsive-next',[id,'HYP.BODY_SIGNAL_NOT_VERDICT'],{enact:true,
      question: e.response==='silence' ? '' : id==='HYP.BORROW_ADULT'
        ? 'What would someone who genuinely wanted to take good care of you say or do next?'
        : id==='HYP.LOVE_AND_TRUST' ? 'What is the concrete complaint that needs to be heard?'
        : id==='HYP.RELATIONAL_REALITY' ? 'What is actually happening between you, and what can you realistically rely on?'
        : id==='HYP.PROCESSING_LOOP' ? '' : 'What are you noticing now?'});
  }
  for (const t of graph.transitions) {
    if (t.event!==e.type || !t.from.includes(s.phase) || !GUARDS[t.guard](s,e,today)) continue;
    s.phase=t.to==='same'?s.phase:t.to;
    if (['begin-waking','begin-sleep-resource'].includes(t.id)) s.inwardSessionOpened=true;
    if (['closed','reviewing'].includes(s.phase)) s.inwardSessionOpened=false;
    if (['RESUME','BEGIN'].includes(e.type)) s.narration='responsive';
    return result(graph,s,e,t.id,[t.node],{enact:['entering','exploring'].includes(s.phase)});
  }
  if (e.type==='BEGIN' && GUARDS.needsClinician(s)) return result(graph,s,e,'procedure-needs-trained-presence',['HYP.SUPPORT_WITH_TRAINED_PERSON']);
  if (e.type==='BEGIN' && s.deeperWorkHoldDay===today && s.mode==='waking') return result(graph,s,e,'no-further-deeper-practice-today',['HYP.DISSOCIATION_RESPONSE']);
  if (e.type==='BEGIN') {
    const required=s.mode==='waking'?['safePlace','orientation','canStop','canReturn','capacity','willingness','methodUse']:['safePlace','orientation','canStop','willingness','methodUse'];
    const unknown=required.filter(k=>s.facts[k]==='unknown');
    return result(graph,s,e,'entry-not-yet-established',['HYP.PREPARATION'],{unresolved:unknown,
      question:unknown.length?'Which part of preparation or returning needs to be learned or clarified before beginning?':''});
  }
  if (['NEXT','RESUME','ENTRY_COMPLETE'].includes(e.type) && GUARDS.needsClinician(s)) return result(graph,s,e,'procedure-needs-trained-presence',['HYP.SUPPORT_WITH_TRAINED_PERSON']);
  if (e.type==='TRAIN_CUE') return result(graph,s,e,'cue-prerequisites-not-met',['HYP.REENTRY_CUE']);
  if (e.type==='REPORT') return result(graph,s,e,'report-recorded-without-inferred-task',[]);
  return result(graph,s,e,'no-matching-transition',[],{unresolved:['event-phase-or-guard']});
}
