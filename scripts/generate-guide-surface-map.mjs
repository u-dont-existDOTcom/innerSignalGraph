#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateHypnosisGraph} from '../src/hypnosis-guide/validate.mjs';
import {GUARD_TEXT,PHASES} from '../src/hypnosis-guide/session.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const ident=x=>'N_'+sha(x).slice(0,16);
const esc=x=>String(x).replaceAll('"','&quot;').replaceAll('|','&#124;');
export function renderGuideSurfaceMap({graph,sourceMap,library,graphBytes,sourceMapBytes,libraryBytes,controllerBytes}) {
  validateHypnosisGraph(graph,library);
  if (sourceMap.librarySha256!==sha(libraryBytes) || graph.librarySha256!==sha(libraryBytes)) throw new TypeError('Library hash mismatch');
  const inputHash=sha(Buffer.concat([graphBytes,sourceMapBytes,libraryBytes,controllerBytes]));
  const out=['# Inner Signal hypnosis: source, knowledge and session map','',
    '> Development candidate, not installed policy or a live voice app. This map is generated from the actual candidate records and transition table. It is not clinical validation.',
    `> Input SHA-256: \`${inputHash}\``,
    `> Article: \`${graph.sourceAuthority.repository}@${graph.sourceAuthority.commit}:${graph.sourceAuthority.path}\``,
    `> Article SHA-256: \`${graph.sourceAuthority.sha256}\``,
    `> Controller SHA-256: \`${sha(controllerBytes)}\``, '',
    '## What is available', '',
    `- ${library.counts['hypnosis-guide']} hypnosis source records from the exact updated guide, with actual text.`,
    `- ${library.counts['inner-child-companion']} records from the current supplied companion, kept separately attributed.`,
    '- 36 outside-guide research topic cards, plus their source ledger and consultation/acceptance protocol. Source account and design application remain distinct.',
    `- ${graph.nodes.length} functional nodes; ${graph.transitions.length} executed phase-transition rows; ${graph.interrupts.length} explicit reported-state interrupts.`,
    '- Keyword/exact-ID lookup is implemented for these records; NLP extraction, model teaching answers, live audio and installed retrieval integration are not.', '',
    '## Executed phase transitions', '',
    'These arrows are the rows the candidate controller actually evaluates. Guard names are defined below. An arrow is not a requirement to visit every phase. Purpose selection, corrections and knowledge requests also use the event handlers listed below.', '',
    '```mermaid','stateDiagram-v2'];
  out.push('  [*] --> idle');
  for (const t of graph.transitions) for (const from of t.from) {
    const to=t.to==='same'?from:t.to;
    out.push(`  ${from} --> ${to}: ${t.event} [${t.guard}]`);
  }
  out.push('```','','| Rule | Event | From | To | Guard | Action node |','|---|---|---|---|---|---|');
  for(const t of graph.transitions)out.push(`| ${t.id} | ${t.event} | ${t.from.join(', ')} | ${t.to} | ${t.guard} | ${t.node} |`);
  out.push('','## Reported-state interrupts','','These act on structured reports of the current situation, not words inside a question about someone else’s method. No diagnosis keyword, numeric intensity, or mere availability of help triggers them.','',
    '| Priority | Reported condition | Result |','|---|---|---|');
  graph.interrupts.forEach((t,i)=>out.push(`| ${i+1} | ${t.guard}: ${GUARD_TEXT[t.guard]} | ${t.node}; end inward work / return as applicable |`));
  out.push('','## Event handlers outside the transition table','',
    '| Event | Actual handling |','|---|---|',
    '| PLAN | Idle/preparing/closed only; chooses purpose and mode. New scope resets prior consent/readiness; day hold survives. |',
    '| LEARN / CONSULT | Retrieves literal relevant source material without induction, readiness interrogation or a session-phase change. |',
    '| REPORT | Records evidence-linked observations; interrupts only on actual reported constraints. No response is manufactured. |',
    '| SELECT_FOCUS | Explicitly selects a relevant focus; available witness skips witness bootstrap. The source texts govern interpretation. |',
    '| NEXT | Uses current focus and phase, not generic purpose setup. Quiet persists; no new question required for silence/checking-loop closure. |',
    '| QUIET | Stops narration without inferring consent, safety, dissociation or success from silence. |',
    '| REJECT | Stops the refused approach; a new explicit selection is needed to resume it. |',
    '| Unmatched or invalid event | No inferred action; invalid schema throws, unmet guards are reported. |', '',
    '## Guard definitions','','| Guard | Meaning |','|---|---|');
  for(const [name,text] of Object.entries(GUARD_TEXT))out.push(`| ${name} | ${text} |`);
  out.push('','## Conceptual knowledge relationships','',
    'The following 45 relationships organize the guide. They are explicitly **not** executable gates or mandatory sequencing. Read the transition table and the actual node/source records to evaluate behavior.','',
    '```mermaid','flowchart TD');
  const kinds=[...new Set(graph.nodes.map(n=>n.kind))];
  for (const k of kinds) {
    out.push(`  subgraph ${ident(k)}["${esc(k)}"]`);
    for(const n of graph.nodes.filter(n=>n.kind===k))out.push(`    ${ident(n.id)}["${esc(n.id)}<br/>${esc(n.title)}"]`);
    out.push('  end');
  }
  for(const e of graph.edges)out.push(`  ${ident(e.from)} -. "${esc(e.relation)}" .-> ${ident(e.to)}`);
  out.push('```','','## Node/source inspection','','Each node retains an inspectable instruction and success criterion. These are source-derived development interpretations, not independent evidence that the whole system is effective.','');
  for(const n of graph.nodes) {
    out.push(`### ${n.id} — ${n.title}`,'',`Role: ${n.kind}.`, '',n.instruction,'',`Success: ${n.successCriterion}`,'', 'Sources:');
    for(const id of n.sourceRefs){const r=library.records.find(x=>x.id===id);out.push(`- \`${id}\`: ${r.title} (${r.layer}; text SHA-256 \`${r.textSha256}\`).`);}
    out.push('');
  }
  out.push('## Validation and remaining boundaries','',
    '- Actual candidate JS selection, phase, correction, return and lookup functions have authored synthetic regressions. These are not a deployed NLP/voice evaluation.',
    '- Every indexed record has usable text and a source/paragraph hash. Build reproducibility against the exact upstream inputs is a separate source gate.',
    '- The owner’s personal/theoretical claims remain attributed reference material, not independently validated facts or authority to conduct a procedure.',
    '- Outside-guide knowledge is available for consultation without becoming the source of the guide’s own words.',
    '- The existing production graph, compiled inner-child/somatic bundle, installed Guide Packets and stable branch are unchanged.',
    '- Independent semantic review, actual voice interruptions and stop controls, live retrieval/model answers, and clinical usefulness remain untested.', '');
  return out.join('\n');
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  const args=process.argv.slice(2);const get=k=>args[args.indexOf(k)+1];
  for(const k of ['--graph','--source-map','--library','--out'])if(!args.includes(k))throw new TypeError(`Missing ${k}`);
  const [graphBytes,sourceMapBytes,libraryBytes,controllerBytes]=await Promise.all([
    fs.readFile(get('--graph')),fs.readFile(get('--source-map')),fs.readFile(get('--library')),fs.readFile(new URL('../src/hypnosis-guide/session.mjs',import.meta.url))]);
  const text=renderGuideSurfaceMap({graph:JSON.parse(graphBytes),sourceMap:JSON.parse(sourceMapBytes),library:JSON.parse(libraryBytes),graphBytes,sourceMapBytes,libraryBytes,controllerBytes});
  await fs.writeFile(get('--out'),text);console.log(`Generated ${get('--out')}`);
}
