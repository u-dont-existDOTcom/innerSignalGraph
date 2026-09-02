import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCurrentAuthority } from '../src/authoring/projection.mjs';
import { canonicalJson } from '../src/authoring/canonical-json.mjs';

const root = process.cwd();
const proposalId = 'love-horizon-r1';
const proposalRoot = path.join(root, 'authoring/obsidian/proposals', proposalId);
const oldProjection = '2cd50da8bfdb8e3e7b08926f7d1b9eabc9cf854231c4fa59350f27a7bf684320';

function baseVars(overrides = {}) {
  return {
    present_safety:'safe', orientation:'oriented', ability_to_stop:'yes', ability_to_return:'yes', activation:'moderate', dissociation:'none', altered_state:'sober',
    inner_adult_access:'partial', witness_capacity:'present', parent_imagery:'not_used', love_access:'limited', existential_sufficiency:'profoundly_insufficient',
    spiritual_curiosity:'absent', wellbeing_horizon:'ordinary_known', deep_love_access:'none_known', child_love_inclusion:'unknown', spiritual_bypass_pattern:'not_applicable',
    suicidal_state:'intent', suicide_goal:'self_annihilation', self_body_model:'identical', death_model:'annihilation_assumed',
    self_directed_love:'inaccessible', solar_plexus_tension:'absent', protective_response:'absent', urge_to_escape:'absent', credibility_conflict:'absent',
    credibility_evidence_state:'none', internal_speaker_relation:'unresolved', age_agency_ambiguity:'absent', resentment_toward_younger_self:'absent', coherent_child_state:'present',
    identity_blur:'absent', belonging_pressure:'absent', self_criticism:'present', current_intent:'conversation', memory_source_risk:'absent', forgiveness_interest:'absent',
    support_available:'present', body_capacity:'adequate', target_type:'none', trigger_loop:'absent', freeze_pattern:'absent', discharge_used:'no', emdr_interest:'absent',
    advanced_release_interest:'absent', advanced_release_physical_risk:'unknown', panic_instability:'absent', bypass_risk:'absent', guide_readiness:'absent',
    deep_work_readiness:'unknown', basic_reparenting_capacity:'unknown', stable_for_advanced_release:'unknown', ...overrides
  };
}

async function prepare() {
  const amendmentsFile = path.join(root, 'guides/owner-amendments.json');
  const amendments = JSON.parse(await fs.readFile(amendmentsFile, 'utf8'));
  amendments.version = '2026-09-02-r3';
  amendments.approvedAt = '2026-09-02';
  const item = {
    id: 'AMEND.IC.SUICIDAL_ADULT_SEAT', domain: 'inner-child', status: 'owner-approved',
    text: 'When a suicidal person appears strongly fused with the state that wants death or lacks even a minimal observing/protective adult position, do not begin by debating abstract metaphysics from inside that fused state. First invite a second seat into the room: a neutral witness, a minimally available inner adult, or one borrowed adult function from a safe person, future self, spiritual figure, plan, or value. Do not assume the suicidal voice is literally an inner child or invent multiplicity; ask whether the wish to die feels like all of them or whether any observing/protective position can sit beside it. The adult or witness does not need to prove life is good, suppress the suicidal part, or claim complete healing. Its first job is to protect the body, listen without retaliation, and postpone irreversible action long enough for inquiry. Once enough differentiation exists, continue the strict self/death/rebirth inquiry. If a witness or partial/available adult position is already present, do not force an extra ritual before that inquiry.'
  };
  const i = amendments.items.findIndex((x) => x.id === item.id);
  if (i >= 0) amendments.items[i] = item; else amendments.items.push(item);
  await fs.writeFile(amendmentsFile, `${JSON.stringify(amendments, null, 2)}\n`);

  const manifestFile = path.join(root, 'guides/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.sources.find((x) => x.id === 'owner-amendments').version = '2026-09-02-r3';
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const ap = path.join(root, 'tests/authoring-projection.test.mjs');
  let s = await fs.readFile(ap, 'utf8');
  s = s.replace('length, 67);', 'length, 68);').replace('length, 14);', 'length, 15);');
  await fs.writeFile(ap, s);

  const gg = path.join(root, 'tests/guide-graph.test.mjs');
  s = await fs.readFile(gg, 'utf8');
  s = s.replace('ownerAmendmentCount, 14);', 'ownerAmendmentCount, 15);');
  await fs.writeFile(gg, s);
}

function adultSeatNode(projection) {
  const payload = {
    activation: {
      all: [{ field:'suicidal_state', op:'in', value:['ideation','intent','imminent'] }],
      any: [
        { field:'identity_blur', op:'eq', value:'present' },
        { field:'inner_adult_access', op:'in', value:['low','unknown'] },
        { field:'witness_capacity', op:'in', value:['absent','unknown'] }
      ],
      none: [
        { field:'present_safety', op:'eq', value:'unsafe' },
        { field:'orientation', op:'eq', value:'disoriented' },
        { field:'ability_to_stop', op:'eq', value:'no' },
        { field:'ability_to_return', op:'eq', value:'no' },
        { field:'altered_state', op:'eq', value:'altered' }
      ]
    },
    avoid: [
      'Do not announce that the suicidal voice is the inner child or impose a parts model the person has not endorsed.',
      'Do not make the borrowed adult into a new external authority over memories, medicine, relationships, or spiritual conclusions.',
      'Do not use the adult position to lecture, shame, suppress, or outvote the suicidal state.'
    ],
    defaultQuestion: 'Before we decide anything, can we invite any part of you that can observe, protect the body, or simply postpone the decision to sit beside the part that wants to die—even if we have to borrow that adult position from someone you trust?',
    effects: {
      blockNodes: [],
      deferNodes: ['IC.SUICIDAL_SELF_DEATH_INQUIRY','IC.EXISTENTIAL_NOURISHMENT','IC.LOVE_HORIZON_EXPLORATION'],
      forbiddenOverclaims: [
        'Do not claim a complete inner adult already exists merely because the person can momentarily observe the suicidal state.',
        'Do not claim every suicidal state is a child-state.'
      ],
      requiredNuance: [
        'The prerequisite is a minimally reflective second position, not a fully healed or spiritually advanced self.',
        'A neutral witness, partial inner adult, or borrowed adult function can be enough to begin; adult identity may form after protective behavior.',
        'The adult position first protects the body and listens. It does not need to convince the suicidal state that life is good before the self/death inquiry can begin.'
      ]
    },
    recommendations: [
      'First discriminate fusion: ask whether the wish to die feels like the whole self right now or whether any observing/protective position can sit beside it.',
      'Invite one second seat rather than a complete ideal parent: neutral witness, Nurturer, Protector, future self, trusted person, spiritual figure, written plan, or another bounded source of adult capacity.',
      'If no internal adult position is available, borrow one function only: keep the body safe, listen without retaliation, and postpone irreversible action while the suicidal state speaks.',
      'Once the person can hold the suicidal state and an observing/protective position at the same time, continue to the strict self/death/rebirth inquiry rather than remaining indefinitely in preparatory soothing.'
    ],
    successSignals: ['The person can distinguish the suicidal state from at least one observing or protective position, even if that adult capacity is weak, borrowed, or temporary.']
  };
  return `---\nauthoring_contract: inner-signal-authoring-node-proposal-v1\nentity_type: graph-node-proposal\nproposal_id: love-horizon-r1\noperation: add\ngraph_id: inner-child-directed-graph\nnode_id: IC.SUICIDAL_ADULT_SEAT\ntitle: Bring a second adult or witness seat into the room\nkind: decision-node\ntier: 1\npriority: 100\nauthority: author-framework\ngraph_tags:\n  - suicide-prevention\n  - borrowed-adulthood\n  - witness\n  - differentiation\n  - safety\nsource_refs:\n  - AMEND.IC.SUICIDAL_ADULT_SEAT\n  - AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY\n  - IC.NEUTRAL_WITNESS\n  - IC.BORROW_ONE_FUNCTION\nbase_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6\nbase_projection_input_sha256: ${projection}\n---\n\n# Bring a second adult or witness seat into the room\n\n> [!warning] Editable proposal record. Building it never changes canonical graph files.\n\n## Structured graph payload\n\n<!-- inner-signal:payload:start -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n<!-- inner-signal:payload:end -->\n\n## Proposal rationale\n\nAbstract self/death inquiry can be wasted or distorted when the person is completely fused with the suicidal state. This gate uses the existing witness and borrowed-adulthood architecture to establish only enough differentiation to investigate rather than act.\n\n## Regression intent\n\nG023 must route fused/low-adult suicidality here before self/death inquiry. G024 must prove that a person who already has a witness and partial/available adult capacity goes directly to self/death inquiry without a redundant ritual.\n`;
}

async function proposal() {
  const authority = await loadCurrentAuthority({ root });
  const projection = authority.projectionInputSha256;
  let manifest = await fs.readFile(path.join(proposalRoot, 'proposal.md'), 'utf8');
  manifest = manifest.replaceAll(oldProjection, projection);
  if (!manifest.includes('  - G023')) manifest = manifest.replace('  - G022\n', '  - G022\n  - G023\n  - G024\n');
  manifest = manifest.replace('and add a strict self/death/rebirth inquiry when suicidal desire or intent is present.', 'add a strict self/death/rebirth inquiry when suicidal desire or intent is present, and establish a minimally adult/witness seat first when the person is fused with the suicidal state.');
  manifest = manifest.replace('G022 proves immediate danger or inability to stop keeps reflective suicide inquiry behind concrete safety until enough capacity returns.', 'G022 proves immediate danger or inability to stop keeps reflective suicide inquiry behind concrete safety until enough capacity returns. G023 proves fused or low-adult suicidality first borrows or invites an observing/protective adult seat. G024 proves an already-present witness/adult goes directly to self/death inquiry without a redundant preparatory ritual.');
  await fs.writeFile(path.join(proposalRoot, 'proposal.md'), manifest);
  await fs.writeFile(path.join(proposalRoot, 'base-authority.json'), canonicalJson({ contractVersion:'inner-signal-authoring-base-authority-v1', proposalId, projectionInputSha256:projection, authoritativeInputs:authority.authoritativeInputs }));

  for (const dirName of ['nodes','edges']) {
    const dir = path.join(proposalRoot, dirName);
    for (const name of await fs.readdir(dir)) {
      const file = path.join(dir, name);
      let text = await fs.readFile(file, 'utf8');
      text = text.replaceAll(oldProjection, projection);
      await fs.writeFile(file, text);
    }
  }
  await fs.writeFile(path.join(proposalRoot, 'nodes/IC.SUICIDAL_ADULT_SEAT.md'), adultSeatNode(projection));

  const g023 = {
    id:'G023', description:'Fused, low-adult suicidal state first establishes a borrowed adult or witness seat before metaphysical inquiry.',
    variables:baseVars({ identity_blur:'present', inner_adult_access:'low', witness_capacity:'absent' }), unknowns:[],
    expected:{
      primary:'IC.SUICIDAL_ADULT_SEAT', selectedIncludes:['IC.SUICIDAL_ADULT_SEAT'], selectedExcludes:['IC.SUICIDAL_SELF_DEATH_INQUIRY','IC.EXISTENTIAL_NOURISHMENT','IC.LOVE_HORIZON_EXPLORATION'],
      nextQuestion:'Before we decide anything, can we invite any part of you that can observe, protect the body, or simply postpone the decision to sit beside the part that wants to die—even if we have to borrow that adult position from someone you trust?',
      requiredNuancePatterns:['minimally reflective second position','borrowed adult function','first protects the body'], forbiddenOverclaimPatterns:['complete inner adult','every suicidal state']
    }
  };
  const g024 = {
    id:'G024', description:'Suicidal person with an existing witness and partial adult capacity proceeds directly to self/death inquiry.',
    variables:baseVars({ identity_blur:'absent', inner_adult_access:'partial', witness_capacity:'present' }), unknowns:[],
    expected:{
      primary:'IC.SUICIDAL_SELF_DEATH_INQUIRY', selectedIncludes:['IC.SUICIDAL_SELF_DEATH_INQUIRY'], selectedExcludes:['IC.SUICIDAL_ADULT_SEAT'],
      nextQuestion:'What exactly is the self you want to kill, and what makes you think killing this body ends that self or the suffering you are trying to escape?'
    }
  };
  await fs.writeFile(path.join(proposalRoot, 'tests/G023.json'), `${JSON.stringify(g023, null, 2)}\n`);
  await fs.writeFile(path.join(proposalRoot, 'tests/G024.json'), `${JSON.stringify(g024, null, 2)}\n`);

  const testFile = path.join(root, 'tests/love-horizon-proposal.test.mjs');
  let test = await fs.readFile(testFile, 'utf8');
  test = test.replace('count: 22, passed: 22', 'count: 24, passed: 24');
  test = test.replace('["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION", "IC.SUICIDAL_SELF_DEATH_INQUIRY"]', '["IC.EXISTENTIAL_NOURISHMENT", "IC.LOVE_HORIZON_EXPLORATION", "IC.REALIZATION_LOVE_INTEGRATION", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.SUICIDAL_ADULT_SEAT"]');
  if (!test.includes('suicidalAdultSeat')) {
    test = test.replace('  const suicidalSelfDeath = nodeById(built.candidateBundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");', `  const suicidalAdultSeat = nodeById(built.candidateBundle, "IC.SUICIDAL_ADULT_SEAT");\n  assert.ok(suicidalAdultSeat);\n  assert.equal(suicidalAdultSeat.tier, 1);\n  assert.equal(suicidalAdultSeat.priority, 100);\n  assert.ok(suicidalAdultSeat.effects.deferNodes.includes("IC.SUICIDAL_SELF_DEATH_INQUIRY"));\n  assert.ok(suicidalAdultSeat.effects.forbiddenOverclaims.some((item) => /every suicidal state/i.test(item)));\n\n  const suicidalSelfDeath = nodeById(built.candidateBundle, "IC.SUICIDAL_SELF_DEATH_INQUIRY");`);
  }
  await fs.writeFile(testFile, test);
  console.log(JSON.stringify({ ok:true, projectionInputSha256:projection }, null, 2));
}

const cmd = process.argv[2];
if (cmd === 'prepare') await prepare();
else if (cmd === 'proposal') await proposal();
else throw new Error('Usage: node scripts/tmp-suicidal-adult-seat.mjs prepare|proposal');
