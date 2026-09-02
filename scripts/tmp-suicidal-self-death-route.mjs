import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCurrentAuthority } from '../src/authoring/projection.mjs';
import { canonicalJson } from '../src/authoring/canonical-json.mjs';

const root = process.cwd();
const proposalId = 'love-horizon-r1';
const proposalRoot = path.join(root, 'authoring/obsidian/proposals', proposalId);
const oldProjection = 'ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb';

function baseVars(overrides = {}) {
  return {
    present_safety:'safe', orientation:'oriented', ability_to_stop:'yes', ability_to_return:'yes', activation:'moderate', dissociation:'none', altered_state:'sober',
    inner_adult_access:'partial', witness_capacity:'present', parent_imagery:'not_used', love_access:'limited', existential_sufficiency:'profoundly_insufficient',
    spiritual_curiosity:'absent', wellbeing_horizon:'ordinary_known', deep_love_access:'none_known', child_love_inclusion:'unknown', spiritual_bypass_pattern:'not_applicable',
    suicidal_state:'absent', suicide_goal:'unknown', self_body_model:'unknown', death_model:'unknown',
    self_directed_love:'inaccessible', solar_plexus_tension:'absent', protective_response:'absent', urge_to_escape:'absent', credibility_conflict:'absent',
    credibility_evidence_state:'none', internal_speaker_relation:'unresolved', age_agency_ambiguity:'absent', resentment_toward_younger_self:'absent', coherent_child_state:'present',
    identity_blur:'absent', belonging_pressure:'absent', self_criticism:'present', current_intent:'conversation', memory_source_risk:'absent', forgiveness_interest:'absent',
    support_available:'present', body_capacity:'adequate', target_type:'none', trigger_loop:'absent', freeze_pattern:'absent', discharge_used:'no', emdr_interest:'absent',
    advanced_release_interest:'absent', advanced_release_physical_risk:'unknown', panic_instability:'absent', bypass_risk:'absent', guide_readiness:'absent',
    deep_work_readiness:'unknown', basic_reparenting_capacity:'unknown', stable_for_advanced_release:'unknown', ...overrides
  };
}

async function updateOwnerAmendments() {
  const file = path.join(root, 'guides/owner-amendments.json');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  value.version = '2026-09-02-r2';
  value.approvedAt = '2026-09-02';
  const item = {
    id: 'AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY',
    domain: 'inner-child',
    status: 'owner-approved',
    text: 'When a person expresses suicidal desire or intent, immediate physical safety and human contact come first when action is imminent, but once they can reflect, suicidal intent itself activates a strict inquiry into what self they intend to kill and what they believe bodily death will accomplish; prior spiritual curiosity is not required. Ask what they are trying to end or obtain, whether they equate self with body, and what evidence supports the assumption that bodily death ends the mind-state or suffering. The guide may state plainly, without invented probabilities or condemnation, that Buddhist teaching warns that intentional mental trajectories have consequences across death and rebirth, that hellish states are possible, and that human birth is rare and valuable for investigating and ending dukkha. Psychology supports the within-life part of the mental-trajectory model: rumination, attentional narrowing, withdrawal, and repeated self-hating or self-destructive cognition can become self-reinforcing; psychology does not establish postmortem continuation. Dream phenomenology, rebirth evidence, NDE reports, and their survivor-selection limits may be examined as reasons not to assume death is an off-switch, but none should be presented as proof or assigned postmortem odds. Also ask what previously feared but reversible life changes become negotiable if the person is already contemplating losing everything. Do not shame the person, guarantee hell, say spiritual motives make suicide safer, prescribe an NDE or psychedelic experience, or substitute solitary spiritual practice for urgent real-world safety when danger is imminent.'
  };
  const index = value.items.findIndex((x) => x.id === item.id);
  if (index >= 0) value.items[index] = item; else value.items.push(item);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

  const manifestFile = path.join(root, 'guides/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const src = manifest.sources.find((x) => x.id === 'owner-amendments');
  src.version = '2026-09-02-r2';
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function updateContract() {
  const file = path.join(root, 'src/guide-graph/contract.mjs');
  let s = await fs.readFile(file, 'utf8');
  if (!s.includes('suicidal_state:')) {
    s = s.replace('  spiritual_bypass_pattern: ["not_applicable", "none_observed", "attainment_outpaces_love", "doctrine_outpaces_love", "group_warmth_mismatch", "unknown"],\n',
`  spiritual_bypass_pattern: ["not_applicable", "none_observed", "attainment_outpaces_love", "doctrine_outpaces_love", "group_warmth_mismatch", "unknown"],\n  suicidal_state: ["absent", "ideation", "intent", "imminent", "unknown"],\n  suicide_goal: ["self_annihilation", "escape_suffering", "self_punishment", "love_or_reunion", "god_or_spiritual_contact", "liberation_or_release", "mixed", "other", "unknown"],\n  self_body_model: ["identical", "distinct", "uncertain", "unknown"],\n  death_model: ["annihilation_assumed", "uncertain", "continuity_possible", "unknown"],\n`);
  }
  await fs.writeFile(file, s);
}

async function updateExtractor() {
  const file = path.join(root, 'src/prompts/case-extract.mjs');
  let s = await fs.readFile(file, 'utf8');
  const anchor = '- spiritual_bypass_pattern is only for transcript-supported mismatches: attainment_outpaces_love when realization/awakening claims coexist with inaccessible or excluded love; doctrine_outpaces_love when teachings about divine/unconditional love are present without felt access; group_warmth_mismatch when a supposedly loving spiritual community is experienced as conditional, fake, or emotionally hollow. Use not_applicable when no spiritual/realization material is in play.\n';
  if (!s.includes('- suicidal_state tracks')) {
    const add = `${anchor}- suicidal_state tracks explicit suicidal material only: ideation for thoughts or wishes without stated intent, intent when the person says they mean or plan to act, and imminent only when the transcript indicates near-term action or inability to delay. Do not infer suicidality from hopelessness alone.\n- suicide_goal records what the user says death is intended to accomplish or reach; preserve mixed or unknown rather than assigning a motive. Do not infer a better or worse postmortem outcome from motive.\n- self_body_model records whether the user explicitly equates the self they want to end with the body, distinguishes them, or is uncertain. death_model records whether bodily death is explicitly assumed to annihilate the relevant self/mind/problem, is treated as uncertain, or the user allows continuity. Do not infer either metaphysical position from religious identity.\n- Suicidal desire or intent does not require spiritual_curiosity to be present. These variables exist so the planner can challenge the irreversible self/death assumption once immediate safety allows reflection without forcing a belief conclusion.\n`;
    s = s.replace(anchor, add);
  }
  await fs.writeFile(file, s);
}

async function updateInventoryTests() {
  const p = path.join(root, 'tests/authoring-projection.test.mjs');
  let s = await fs.readFile(p, 'utf8');
  s = s.replace('length, 66);', 'length, 67);').replace('length, 13);', 'length, 14);');
  await fs.writeFile(p, s);
  const g = path.join(root, 'tests/guide-graph.test.mjs');
  s = await fs.readFile(g, 'utf8');
  s = s.replace('ownerAmendmentCount, 13);', 'ownerAmendmentCount, 14);');
  await fs.writeFile(g, s);
}

function newNodeText(projection) {
  return `---\nauthoring_contract: inner-signal-authoring-node-proposal-v1\nentity_type: graph-node-proposal\nproposal_id: love-horizon-r1\noperation: add\ngraph_id: inner-child-directed-graph\nnode_id: IC.SUICIDAL_SELF_DEATH_INQUIRY\ntitle: Examine the self/death assumption before an irreversible act\nkind: decision-node\ntier: 1\npriority: 99\nauthority: author-framework\ngraph_tags:\n  - suicide-prevention\n  - self-inquiry\n  - rebirth\n  - existential\n  - safety\nsource_refs:\n  - AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY\n  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING\n  - AMEND.IC.WELLBEING_HORIZON\nbase_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6\nbase_projection_input_sha256: ${projection}\n---\n\n# Examine the self/death assumption before an irreversible act\n\n> [!warning] Editable proposal record. Building it never changes canonical graph files.\n\n## Structured graph payload\n\n<!-- inner-signal:payload:start -->\n\`\`\`json\n${JSON.stringify({
    activation:{all:[{field:'suicidal_state',op:'in',value:['ideation','intent','imminent']}],none:[{field:'present_safety',op:'eq',value:'unsafe'},{field:'orientation',op:'eq',value:'disoriented'},{field:'ability_to_stop',op:'eq',value:'no'},{field:'ability_to_return',op:'eq',value:'no'},{field:'altered_state',op:'eq',value:'altered'}]},
    avoid:[
      'Do not shame or condemn the person, guarantee hell, assign postmortem odds, or say that a spiritual motive makes suicide safer.',
      'Do not present dreams, NDEs, rebirth reports, or religious teachings as empirical proof of a specific individual’s postmortem outcome.',
      'Do not claim psychology proves postmortem mental continuity.',
      'Do not prescribe an NDE, psychedelic experience, or solitary spiritual practice as a substitute for urgent real-world protection when danger is imminent.'
    ],
    defaultQuestion:'What exactly is the self you want to kill, and what makes you think killing this body ends that self or the suffering you are trying to escape?',
    effects:{
      blockNodes:[], deferNodes:['IC.EXISTENTIAL_NOURISHMENT','IC.LOVE_HORIZON_EXPLORATION'],
      forbiddenOverclaims:[
        'Do not say suicide reliably leads to hell or reliably leads to heaven, nothingness, liberation, reunion, or any other postmortem outcome.',
        'Do not infer that suicidality itself proves spiritual attainment or that a person must be curious about spirituality before this inquiry is relevant.'
      ],
      requiredNuance:[
        'Suicidal intent itself stakes an irreversible act on assumptions about self, body, mind, and death; the guide therefore examines those assumptions even when ordinary spiritual curiosity is absent, while belief remains voluntary.',
        'Immediate safety preserves the opportunity for inquiry but does not answer the existential or metaphysical question.',
        'Repeated self-hatred, despair, rumination, attentional narrowing, withdrawal, and self-destructive cognition can become self-reinforcing within life; Buddhism additionally teaches continuity of intentional mental causation through death and rebirth. Keep those evidentiary levels distinct.',
        'A Buddhist warning may explicitly include rebirth, hellish states, and the rarity/value of human birth without claiming certainty about this individual’s destination.'
      ]
    },
    recommendations:[
      'Ask what the person is trying to end or obtain through death—annihilation, escape, punishment, love or reunion, God or spiritual contact, liberation or release, or something else—without using motive to predict a postmortem outcome.',
      'Examine whether the person is equating the relevant self with the body and what evidence supports the belief that bodily death ends the mind-state, identity, or suffering they want ended.',
      'Challenge annihilation certainty without demanding belief: examine dream phenomenology, rebirth arguments and reports, NDE accounts and their survivor-selection limits, and major contemplative traditions that warn bodily death may not end suffering.',
      'When Buddhist framing is acceptable, state the warning plainly: intentional mental trajectories have consequences, rebirth and hellish states are possible, and a human birth is a rare opportunity to investigate dukkha and its cessation. Do not invent odds or threaten divine punishment.',
      'Use the shared mental-trajectory principle carefully: psychology supports self-reinforcing negative cognition within life, while Buddhist teaching extends intentional causation across death and rebirth; therefore bodily death should not be assumed to interrupt the process the person is trying to escape.',
      'Ask what previously forbidden but reversible changes become negotiable if the person is already contemplating losing everything: what would they change before making the one irreversible change?',
      'Keep the body alive while investigating. If danger becomes imminent or the person cannot delay action, return immediately to concrete human contact and physical safety.'
    ],
    successSignals:[
      'The person can name what death is supposed to accomplish, recognize uncertainty in the self/death assumption, and delay irreversible action while investigating spiritual claims and reversible life changes.'
    ]
  }, null, 2)}\n\`\`\`\n<!-- inner-signal:payload:end -->\n\n## Proposal rationale\n\nSuicidal desire or intent changes the routing problem: the person is contemplating an irreversible bodily act that assumes something about self, mind, death, and the fate of suffering. This node makes that assumption explicit without requiring prior spiritual curiosity, while preserving immediate safety, epistemic uncertainty, and non-condemnation.\n\n## Regression intent\n\nG021 must route a safe, sober, non-spiritually-curious suicidal user here first. G022 must prove that imminent unsafe/altered conditions keep this inquiry out until enough safety and orientation exist.\n`;
}

async function updateProposalAfterProjection() {
  const authority = await loadCurrentAuthority({ root });
  const projection = authority.projectionInputSha256;
  let manifest = await fs.readFile(path.join(proposalRoot, 'proposal.md'), 'utf8');
  manifest = manifest.replaceAll(oldProjection, projection);
  if (!manifest.includes('  - G021')) manifest = manifest.replace('  - G020\n', '  - G020\n  - G021\n  - G022\n');
  manifest = manifest.replace('Separate ordinary care from profound love, add existential-sufficiency and curiosity routing, route already-accessible deep love toward the inner child, and detect realization or doctrine that has outrun lived love.', 'Separate ordinary care from profound love, add existential-sufficiency and curiosity routing, route already-accessible deep love toward the inner child, detect realization or doctrine that has outrun lived love, and add a strict self/death/rebirth inquiry when suicidal desire or intent is present.');
  manifest = manifest.replace('G019 proves a past or state-bound opening is treated as a wellbeing-horizon reference without requiring recreation. All existing G001-G012 behavior must remain green.', 'G019 proves a past or state-bound opening is treated as a wellbeing-horizon reference without requiring recreation. G021 proves suicidal desire/intent activates self/death inquiry without prior spiritual curiosity; G022 proves immediate danger or alteration keeps reflective inquiry behind safety. All existing G001-G012 behavior must remain green.');
  await fs.writeFile(path.join(proposalRoot, 'proposal.md'), manifest);
  await fs.writeFile(path.join(proposalRoot, 'base-authority.json'), canonicalJson({contractVersion:'inner-signal-authoring-base-authority-v1',proposalId,projectionInputSha256:projection,authoritativeInputs:authority.authoritativeInputs}));

  const nodesDir = path.join(proposalRoot, 'nodes');
  for (const name of await fs.readdir(nodesDir)) {
    const file = path.join(nodesDir, name);
    let s = await fs.readFile(file, 'utf8');
    s = s.replaceAll(oldProjection, projection);
    await fs.writeFile(file, s);
  }
  await fs.writeFile(path.join(nodesDir, 'IC.SUICIDAL_SELF_DEATH_INQUIRY.md'), newNodeText(projection));

  const existentialFile = path.join(nodesDir, 'IC.EXISTENTIAL_NOURISHMENT.md');
  let e = await fs.readFile(existentialFile, 'utf8');
  e = e.replace('      {\n        "field": "altered_state",\n        "op": "eq",\n        "value": "altered"\n      }\n', '      {\n        "field": "altered_state",\n        "op": "eq",\n        "value": "altered"\n      },\n      {\n        "field": "suicidal_state",\n        "op": "in",\n        "value": ["ideation", "intent", "imminent"]\n      }\n');
  await fs.writeFile(existentialFile, e);

  const explorationFile = path.join(nodesDir, 'IC.LOVE_HORIZON_EXPLORATION.md');
  let x = await fs.readFile(explorationFile, 'utf8');
  x = x.replace('      {\n        "field": "altered_state",\n        "op": "eq",\n        "value": "altered"\n      }\n', '      {\n        "field": "altered_state",\n        "op": "eq",\n        "value": "altered"\n      },\n      {\n        "field": "suicidal_state",\n        "op": "in",\n        "value": ["ideation", "intent", "imminent"]\n      }\n');
  await fs.writeFile(explorationFile, x);

  const testsDir = path.join(proposalRoot, 'tests');
  await fs.mkdir(testsDir, { recursive:true });
  const G021 = {
    id:'G021', description:'Safe, sober suicidal intent activates strict self/death inquiry even without prior spiritual curiosity.',
    variables:baseVars({suicidal_state:'intent',suicide_goal:'self_annihilation',self_body_model:'identical',death_model:'annihilation_assumed',spiritual_curiosity:'absent'}), unknowns:[],
    expected:{primary:'IC.SUICIDAL_SELF_DEATH_INQUIRY',selectedIncludes:['IC.SUICIDAL_SELF_DEATH_INQUIRY'],selectedExcludes:['IC.LOVE_HORIZON_EXPLORATION','IC.EXISTENTIAL_NOURISHMENT'],nextQuestion:'What exactly is the self you want to kill, and what makes you think killing this body ends that self or the suffering you are trying to escape?',requiredNuancePatterns:['Suicidal intent itself','Immediate safety preserves','self-reinforcing within life','rebirth and hellish states'],forbiddenOverclaimPatterns:['reliably leads to hell','prior spiritual curiosity']}
  };
  const G022 = {
    id:'G022', description:'Imminent unsafe suicidal state keeps reflective self/death inquiry behind immediate safety.',
    variables:baseVars({present_safety:'unsafe',ability_to_stop:'no',suicidal_state:'imminent',suicide_goal:'escape_suffering',death_model:'annihilation_assumed'}), unknowns:[],
    expected:{primary:'IC.SAFETY_ORIENTATION',selectedIncludes:['IC.SAFETY_ORIENTATION'],selectedExcludes:['IC.SUICIDAL_SELF_DEATH_INQUIRY','IC.LOVE_HORIZON_EXPLORATION','IC.EXISTENTIAL_NOURISHMENT']}
  };
  await fs.writeFile(path.join(testsDir,'G021.json'), `${JSON.stringify(G021,null,2)}\n`);
  await fs.writeFile(path.join(testsDir,'G022.json'), `${JSON.stringify(G022,null,2)}\n`);

  const t = path.join(root, 'tests/love-horizon-proposal.test.mjs');
  let ts = await fs.readFile(t, 'utf8');
  ts = ts.replace('count: 20, passed: 20', 'count: 22, passed: 22');
  ts = ts.replace('for (const id of ["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION"])', 'for (const id of ["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION", "IC.SUICIDAL_SELF_DEATH_INQUIRY"])');
  if (!ts.includes('suicidalSelfDeath')) ts = ts.replace('  const deepLove = nodeById(built.candidateBundle, "IC.DEEP_LOVE_TO_CHILD");', `  const suicidalSelfDeath = nodeById(built.candidateBundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");\n  assert.ok(suicidalSelfDeath);\n  assert.equal(suicidalSelfDeath.tier, 1);\n  assert.equal(suicidalSelfDeath.priority, 99);\n  assert.ok(suicidalSelfDeath.activation.all.some((condition) => condition.field === "suicidal_state"));\n  assert.ok(!suicidalSelfDeath.activation.all.some((condition) => condition.field === "spiritual_curiosity"));\n  assert.ok(suicidalSelfDeath.effects.deferNodes.includes("IC.LOVE_HORIZON_EXPLORATION"));\n  assert.ok(suicidalSelfDeath.effects.forbiddenOverclaims.some((item) => /postmortem outcome/i.test(item)));\n\n  const deepLove = nodeById(built.candidateBundle, "IC.DEEP_LOVE_TO_CHILD");`);
  await fs.writeFile(t, ts);
  console.log(JSON.stringify({ok:true,projection,proposalId},null,2));
}

const cmd = process.argv[2];
if (cmd === 'prepare') {
  await updateOwnerAmendments(); await updateContract(); await updateExtractor(); await updateInventoryTests();
} else if (cmd === 'proposal') {
  await updateProposalAfterProjection();
} else throw new Error('Usage: node scripts/tmp-suicidal-self-death-route.mjs prepare|proposal');
