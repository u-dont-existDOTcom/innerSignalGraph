import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const proposalId = 'love-horizon-r1';
const readText = (relative) => fs.readFile(path.join(root, relative), 'utf8');
const writeText = async (relative, text) => {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
};
const readJson = async (relative) => JSON.parse(await readText(relative));
const writeJson = async (relative, value) => writeText(relative, `${JSON.stringify(value, null, 2)}\n`);

function assertIncludes(text, marker, label) {
  if (!text.includes(marker)) throw new Error(`Missing ${label} marker`);
}
function uniquePush(list, value) { if (!list.includes(value)) list.push(value); }
function upsertById(list, value) {
  const index = list.findIndex((item) => item.id === value.id);
  if (index >= 0) list[index] = value; else list.push(value);
}

async function preparePrerequisites() {
  {
    const relative = 'src/guide-graph/contract.mjs';
    let text = await readText(relative);
    const marker = '  love_access: ["accessible", "limited", "absent", "unknown"],\n';
    assertIncludes(text, marker, 'case-variable insertion');
    if (!text.includes('existential_sufficiency:')) {
      text = text.replace(marker, `${marker}  existential_sufficiency: ["sufficient", "insufficient", "profoundly_insufficient", "unknown"],\n  spiritual_curiosity: ["present", "absent", "unknown"],\n  wellbeing_horizon: ["ordinary_known", "deeper_conceptual", "deeper_experiential", "unknown"],\n  deep_love_access: ["none_known", "past_glimpse", "state_dependent", "intermittent", "reliable", "unknown"],\n  child_love_inclusion: ["untested", "blocked", "partial", "reliable", "unknown"],\n  spiritual_bypass_pattern: ["not_applicable", "none_observed", "attainment_outpaces_love", "doctrine_outpaces_love", "group_warmth_mismatch", "unknown"],\n`);
    }
    await writeText(relative, text);
  }

  {
    const relative = 'src/prompts/case-extract.mjs';
    let text = await readText(relative);
    const marker = '- Track credibility evidence separately from credibility conflict. If the younger position points to how adult life actually turned out as evidence against the promise, that is an adverse track record, not an absence of track record.\n';
    assertIncludes(text, marker, 'extractor-rule insertion');
    const insertion = `- Treat love_access as ordinary accessible affection, care, warmth, or love; do not use it as a proxy for profound spiritual or transpersonal love.\n- existential_sufficiency describes whether the love, meaning, belonging, beauty, purpose, or wellbeing currently available feels sufficient to the user. Use profoundly_insufficient only from explicit radical hopelessness, a stated lack of reason to live, or an explicit statement that ordinary goods are nowhere near enough; do not infer it merely from depression or distress.\n- spiritual_curiosity tracks curiosity about deeper love, spiritual experience, realization, or a larger horizon of wellbeing. Do not infer it from religion, atheism, Buddhism, Christianity, or any affiliation, and do not mark it absent merely because the person rejects a doctrine.\n- wellbeing_horizon tracks what depth of wellbeing the user actually knows or seriously understands as possible: ordinary_known for explicitly ordinary/practical horizons, deeper_conceptual when deeper possibilities are known only through ideas or other people's reports, and deeper_experiential when the user reports direct experience of profound peace, liberation, divine/universal love, or comparable wellbeing. Mystical intensity alone does not establish love depth.\n- deep_love_access is phenomenological and source-agnostic. Distinguish no known experience, a past glimpse that is not currently accessible, access confined to a distinct state/context, intermittent present access, and reliable present access. Do not substitute belief, doctrine, group membership, or an attainment claim for felt access.\n- child_love_inclusion asks whether already-accessible deep love can include the wounded younger self. Use blocked for explicit recoil, numbness, threat, refusal, or inability; do not call skepticism a rejection of love without evidence.\n- spiritual_bypass_pattern is only for transcript-supported mismatches: attainment_outpaces_love when realization/awakening claims coexist with inaccessible or excluded love; doctrine_outpaces_love when teachings about divine/unconditional love are present without felt access; group_warmth_mismatch when a supposedly loving spiritual community is experienced as conditional, fake, or emotionally hollow. Use not_applicable when no spiritual/realization material is in play.\n`;
    if (!text.includes('- existential_sufficiency describes')) text = text.replace(marker, marker + insertion);
    await writeText(relative, text);
  }

  {
    const relative = 'guides/owner-amendments.json';
    const value = await readJson(relative);
    value.version = '2026-09-01-r1';
    value.approvedAt = '2026-09-01';
    const additions = [
      {
        id: 'AMEND.IC.EXISTENTIAL_LOVE_ROUTING', domain: 'inner-child', status: 'owner-approved',
        text: 'Deep spiritual love is not a universal prerequisite for healing. First distinguish whether the love, meaning, belonging, beauty, purpose, and wellbeing already available feel sufficient, whether the person is curious for something deeper, or whether ordinary life feels radically insufficient. Do not push spiritual exploration on somebody who is satisfied and not curious. When hopelessness is profound, immediate safety and human support remain first, but do not pretend a tiny behavioral action answers the person’s existential question. Never romanticize suicidality or suggest an NDE, psychedelic experience, conversion, or other dangerous or extraordinary event as the route to hope.'
      },
      {
        id: 'AMEND.IC.WELLBEING_HORIZON', domain: 'inner-child', status: 'owner-approved',
        text: 'Love includes wanting wellbeing for beings, and the horizon of that love can expand when a person directly learns that deeper happiness, peace, freedom, or unconditional love is possible. Ordinary practical love is real and important; profound spiritual realization may disclose a much larger horizon, but mystical intensity is not itself proof of deep love. Metta or loving-kindness meditation is one way to cultivate, stabilize, or extend love; it is not equivalent to the deepest love and is not a universal first step.'
      },
      {
        id: 'AMEND.IC.DEEP_LOVE_TO_CHILD', domain: 'inner-child', status: 'owner-approved',
        text: 'Classify deep or transpersonal love by actual experience and present access, not by theism, religion, doctrine, or identity. When profound love is genuinely accessible, contact that real love first and then see whether the younger self can be included in it—the feast must reach the hungry child. If the child recoils, goes numb, distrusts the source, or cannot receive it, do not intensify the spiritual exercise; hear the guard or credibility problem and continue Nurturer or Protector repair without forcing transfer.'
      },
      {
        id: 'AMEND.IC.REALIZATION_LOVE_INTEGRATION', domain: 'inner-child', status: 'owner-approved',
        text: 'Spiritual realization, religious rebirth, meditation, mystical experience, or another opening can reveal a much deeper horizon of wellbeing and thereby deepen compassion, but do not let mystery outrun love indefinitely. Respect genuine realization without treating attainment claims, doctrines about love, or group warmth as proof that love is actually accessible. Test whether the opening deepens and widens love, reaches the inner child, and becomes practical protection, truth, service, relationship, Hearthwork, and community participation. Community can precede, accompany, or follow a breakthrough; do not assume that finding loving people is always what creates access to deep love.'
      }
    ];
    for (const item of additions) upsertById(value.items, item);
    await writeJson(relative, value);
  }

  {
    const relative = 'guides/manifest.json';
    const value = await readJson(relative);
    const ownerSource = value.sources.find((item) => item.id === 'owner-amendments');
    if (!ownerSource) throw new Error('Missing owner-amendments manifest source');
    ownerSource.version = '2026-09-01-r1';
    await writeJson(relative, value);
  }
}

function nodePayload(node) {
  return {
    activation: node.activation,
    avoid: node.avoid,
    defaultQuestion: node.defaultQuestion,
    effects: node.effects,
    recommendations: node.recommendations,
    successSignals: node.successSignals
  };
}

function buildNewNodes() {
  const commonNone = [
    { field: 'present_safety', op: 'eq', value: 'unsafe' },
    { field: 'orientation', op: 'eq', value: 'disoriented' }
  ];
  return [
    {
      id: 'IC.EXISTENTIAL_NOURISHMENT',
      title: 'Match the work to existential hunger without making spirituality mandatory', kind: 'decision-node', tier: 2, priority: 98, authority: 'author-framework',
      tags: ['existential', 'love', 'meaning', 'curiosity', 'safety'],
      sourceRefs: ['AMEND.IC.EXISTENTIAL_LOVE_ROUTING', 'AMEND.IC.WELLBEING_HORIZON'],
      activation: { any: [{ field: 'existential_sufficiency', op: 'in', value: ['insufficient', 'profoundly_insufficient'] }] },
      recommendations: [
        'Distinguish whether the person is simply working on a wound within a basically sufficient life, is hungry and curious for a deeper horizon, or experiences ordinary life as radically insufficient.',
        'When the person says they hate themselves yet voluntarily seeks help, believe the self-hating part and also ask what the help-seeking part hoped might happen; do not name that motive love for them.',
        'When hopelessness is profound, keep immediate safety and human contact first while also taking the why-live question seriously; a small protective action can preserve the person without pretending to answer the existential question.'
      ],
      avoid: [
        'Do not tell a satisfied, non-curious person that they are spiritually deficient or must seek a profound experience.',
        'Do not romanticize suicidal crisis, despair, an NDE, psychedelics, conversion, or extraordinary states as a route to transformation.'
      ],
      successSignals: ['The intervention matches the scale of the person’s hunger while preserving safety and choice about spiritual exploration.'],
      effects: {
        deferNodes: [], blockNodes: [],
        requiredNuance: [
          'Immediate safety action and existential nourishment solve different problems; do not confuse preserving life today with answering why life feels worth living.',
          'Curiosity can open a route without proving that a spiritual conclusion is true or required.'
        ],
        forbiddenOverclaims: [
          'Do not say a small practical act should be sufficient for profound existential hopelessness.',
          'Do not say a suicidal crisis is spiritually useful or necessary.'
        ]
      }, defaultQuestion: ''
    },
    {
      id: 'IC.LOVE_HORIZON_EXPLORATION',
      title: 'Explore a deeper horizon of wellbeing when curiosity is genuine', kind: 'decision-node', tier: 2, priority: 94, authority: 'author-framework',
      tags: ['spiritual-curiosity', 'love', 'wellbeing-horizon', 'guide'],
      sourceRefs: ['AMEND.IC.EXISTENTIAL_LOVE_ROUTING', 'AMEND.IC.WELLBEING_HORIZON', 'IC.GUIDE_LATER'],
      activation: {
        all: [
          { field: 'spiritual_curiosity', op: 'eq', value: 'present' },
          { field: 'deep_love_access', op: 'in', value: ['none_known', 'past_glimpse', 'state_dependent', 'unknown'] }
        ], none: commonNone
      },
      recommendations: [
        'Invite investigation rather than belief: notice people, practices, traditions, experiences, nature, art, service, prayer, meditation, or other sources whose lived fruits make a deeper kind of love or wellbeing seem worth exploring.',
        'Use metta or loving-kindness as one possible cultivation practice, especially when it feels meaningful, without presenting it as the definition or guaranteed depth of love.',
        'Follow the fruits: prefer paths and exemplars that become more loving, honest, grounded, protective, and able to face pain rather than merely more impressive or certain.'
      ],
      avoid: [
        'Do not prescribe a religion, theism, awakening, nonduality, conversion, psychedelics, NDEs, or a metaphysical conclusion.',
        'Do not imply that everyone needs profound spiritual love when the person says their present horizon is sufficient.'
      ],
      successSignals: ['Curiosity becomes a voluntary experiment with no forced doctrine, attainment target, or promise of extraordinary experience.'],
      effects: {
        deferNodes: [], blockNodes: [],
        requiredNuance: [
          'The relevant distinction is experiential access to deeper wellbeing and love, not believer versus atheist or one religion versus another.',
          'A conceptual horizon and a directly experienced horizon are different; do not pretend reading about profound love is the same as having touched it.'
        ],
        forbiddenOverclaims: ['Do not say everyone needs profound spiritual love in order to heal or live well.']
      }, defaultQuestion: ''
    },
    {
      id: 'IC.DEEP_LOVE_TO_CHILD',
      title: 'Bring already-accessible deep love to the younger self without force', kind: 'decision-node', tier: 3, priority: 91, authority: 'author-framework',
      tags: ['deep-love', 'inner-child', 'integration', 'anti-bypass'],
      sourceRefs: ['AMEND.IC.DEEP_LOVE_TO_CHILD', 'AMEND.IC.WELLBEING_HORIZON', 'IC.HEART_SOLAR_LOOP', 'IC.BOTTOM_UP_SEQUENCE'],
      activation: {
        all: [
          { field: 'deep_love_access', op: 'in', value: ['intermittent', 'reliable'] },
          { field: 'child_love_inclusion', op: 'in', value: ['untested', 'blocked', 'partial'] }
        ], none: commonNone
      },
      recommendations: [
        'Contact the real profound love first in whatever already-valid way it is accessible; do not manufacture a special inner-child feeling.',
        'Then bring the younger self into awareness and see whether the same love can include them—the feast has to reach the hungry child.',
        'If inclusion is blocked by numbness, distrust, threat, recoil, or a credibility objection, keep the love from becoming an argument and route toward the Guard, credibility repair, Nurturer, or Protector instead of increasing spiritual intensity.'
      ],
      avoid: [
        'Do not force transfer, interpret reluctance as spiritual failure, or prescribe a stronger altered state because the child cannot receive the love.'
      ],
      successSignals: ['Profound love can include the younger self without coercion, or the specific block becomes clear enough to work with relationally.'],
      effects: {
        deferNodes: [], blockNodes: [],
        requiredNuance: [
          'Having access to profound love and being able to let the wounded child receive it are separate capacities.',
          'Love can remain present while distrust or refusal is heard; the child’s objection does not need to be argued away.'
        ],
        forbiddenOverclaims: ['Do not call a blocked transfer proof that the child rejects love, is spiritually deficient, or needs a stronger altered state.']
      }, defaultQuestion: ''
    },
    {
      id: 'IC.REALIZATION_LOVE_INTEGRATION',
      title: 'Keep realization, doctrine, and community answerable to lived love', kind: 'decision-node', tier: 2, priority: 99, authority: 'author-framework',
      tags: ['spiritual-bypass', 'realization', 'doctrine', 'community', 'integration'],
      sourceRefs: ['AMEND.IC.REALIZATION_LOVE_INTEGRATION', 'AMEND.IC.DEEP_LOVE_TO_CHILD', 'IC.GUIDE_LATER', 'IC.PROTECTOR_VISIBLE', 'IC.RELATIONSHIP'],
      activation: { any: [{ field: 'spiritual_bypass_pattern', op: 'in', value: ['attainment_outpaces_love', 'doctrine_outpaces_love', 'group_warmth_mismatch'] }] },
      recommendations: [
        'Respect whatever realization, rebirth, doctrine, or community experience is genuine while testing separately whether love is actually felt, can include the inner child, and survives ordinary relational difficulty.',
        'Do not let mystery outrun love indefinitely: if attainment or doctrine is far ahead of felt love, turn toward the missing love rather than prescribing a more advanced abstraction.',
        'Translate spiritual opening into protection, truth, reliability, service, Hearthwork or reciprocal relationship, and community where useful; community may reinforce an opening without being assumed to have caused it.'
      ],
      avoid: [
        'Do not dismiss genuine nibbana, nondual, Christian, mystical, or other realization merely because emotional integration is incomplete.',
        'Do not treat claims about divine love, spiritual attainment, or a welcoming group atmosphere as proof that the person actually experiences love.'
      ],
      successSignals: ['The person can distinguish spiritual truth or identity from felt love and practical integration, and the next step addresses the actual mismatch rather than protecting a status claim.'],
      effects: {
        deferNodes: [], blockNodes: [],
        requiredNuance: [
          'Mystical intensity, doctrinal certainty, and love depth are not interchangeable.',
          'Practical love and profound love are complementary: practical conduct embodies love, while a deeper wellbeing horizon may enlarge what the person can sincerely wish for beings.'
        ],
        forbiddenOverclaims: [
          'Do not say that awakening, religious belief, church or sangha membership, or mystical experience proves emotional integration.',
          'Do not say that ordinary practical care is worthless because profound spiritual love is not accessible.'
        ]
      }, defaultQuestion: ''
    }
  ];
}

function regressionCases() {
  return [
    {
      id: 'G013', description: 'Current love and meaning are sufficient and there is no spiritual curiosity; do not prescribe deeper spirituality.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',love_access:'accessible',self_directed_love:'safe',coherent_child_state:'present',existential_sufficiency:'sufficient',spiritual_curiosity:'absent',wellbeing_horizon:'ordinary_known',deep_love_access:'none_known',child_love_inclusion:'untested',spiritual_bypass_pattern:'not_applicable',protective_response:'absent',credibility_conflict:'absent',self_criticism:'absent',current_intent:'conversation',support_available:'present' },
      unknowns: [], expected: { selectedExcludes:['IC.EXISTENTIAL_NOURISHMENT','IC.LOVE_HORIZON_EXPLORATION','IC.DEEP_LOVE_TO_CHILD','IC.REALIZATION_LOVE_INTEGRATION'] }
    },
    {
      id: 'G014', description: 'Curious about deeper love but has not experienced it; invite exploration without doctrine or promise.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',love_access:'accessible',self_directed_love:'safe',coherent_child_state:'present',existential_sufficiency:'sufficient',spiritual_curiosity:'present',wellbeing_horizon:'deeper_conceptual',deep_love_access:'none_known',child_love_inclusion:'untested',spiritual_bypass_pattern:'not_applicable',protective_response:'absent',credibility_conflict:'absent',self_criticism:'absent',current_intent:'conversation',support_available:'present' },
      unknowns: [], expected: { primary:'IC.LOVE_HORIZON_EXPLORATION',selectedIncludes:['IC.LOVE_HORIZON_EXPLORATION'],forbiddenOverclaimPatterns:['everyone needs profound spiritual love'] }
    },
    {
      id: 'G015', description: 'Deep love is presently accessible but cannot yet fully include the inner child.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',love_access:'accessible',self_directed_love:'unsafe',coherent_child_state:'present',existential_sufficiency:'sufficient',spiritual_curiosity:'present',wellbeing_horizon:'deeper_experiential',deep_love_access:'reliable',child_love_inclusion:'blocked',spiritual_bypass_pattern:'none_observed',protective_response:'absent',credibility_conflict:'absent',self_criticism:'absent',current_intent:'integration',support_available:'present',guide_readiness:'present' },
      unknowns: [], expected: { primary:'IC.DEEP_LOVE_TO_CHILD',selectedIncludes:['IC.DEEP_LOVE_TO_CHILD'],requiredNuancePatterns:['separate capacities'],forbiddenOverclaimPatterns:['stronger altered state'] }
    },
    {
      id: 'G016', description: 'Spiritual attainment is ahead of actual love access; integration outranks more abstraction.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',love_access:'limited',self_directed_love:'inaccessible',coherent_child_state:'present',existential_sufficiency:'insufficient',spiritual_curiosity:'present',wellbeing_horizon:'deeper_experiential',deep_love_access:'none_known',child_love_inclusion:'untested',spiritual_bypass_pattern:'attainment_outpaces_love',protective_response:'absent',credibility_conflict:'absent',self_criticism:'present',current_intent:'integration',support_available:'present',guide_readiness:'present' },
      unknowns: [], expected: { primary:'IC.REALIZATION_LOVE_INTEGRATION',selectedIncludes:['IC.REALIZATION_LOVE_INTEGRATION'],requiredNuancePatterns:['mystical intensity'],forbiddenOverclaimPatterns:['awakening'] }
    },
    {
      id: 'G017', description: 'Profound existential insufficiency without spiritual curiosity; take why-live seriously without evangelizing or romanticizing crisis.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'moderate',dissociation:'none',altered_state:'sober',inner_adult_access:'low',witness_capacity:'present',love_access:'limited',self_directed_love:'inaccessible',coherent_child_state:'present',existential_sufficiency:'profoundly_insufficient',spiritual_curiosity:'absent',wellbeing_horizon:'ordinary_known',deep_love_access:'none_known',child_love_inclusion:'untested',spiritual_bypass_pattern:'not_applicable',protective_response:'absent',credibility_conflict:'absent',self_criticism:'present',current_intent:'conversation',support_available:'present' },
      unknowns: [], expected: { primary:'IC.EXISTENTIAL_NOURISHMENT',selectedExcludes:['IC.LOVE_HORIZON_EXPLORATION'],requiredNuancePatterns:['safety action','curiosity'],forbiddenOverclaimPatterns:['small practical act','suicidal crisis'] }
    },
    {
      id: 'G018', description: 'Doctrine says love but the person reports no felt love; treat doctrine as distinct from experiential access.',
      variables: { present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',love_access:'limited',self_directed_love:'inaccessible',coherent_child_state:'present',existential_sufficiency:'insufficient',spiritual_curiosity:'present',wellbeing_horizon:'deeper_conceptual',deep_love_access:'none_known',child_love_inclusion:'untested',spiritual_bypass_pattern:'doctrine_outpaces_love',protective_response:'absent',credibility_conflict:'absent',self_criticism:'present',current_intent:'integration',support_available:'present' },
      unknowns: [], expected: { primary:'IC.REALIZATION_LOVE_INTEGRATION',selectedIncludes:['IC.REALIZATION_LOVE_INTEGRATION'],forbiddenOverclaimPatterns:['religious belief'] }
    }
  ];
}

async function buildProposalSources() {
  const { createProposal } = await import('../src/authoring/proposal.mjs');
  const { loadCurrentAuthority } = await import('../src/authoring/projection.mjs');
  const { parseAuthoringNote } = await import('../src/authoring/note-parser.mjs');
  const { renderNodeNote, renderFrontmatterNote } = await import('../src/authoring/note-renderer.mjs');
  const { AUTHORING_CONTRACTS, edgeDigest, edgeId, validateSchema } = await import('../src/authoring/contract.mjs');

  const tests = regressionCases();
  await createProposal({
    root, id: proposalId,
    nodeIds: ['IC.BORROW_LOVE', 'IC.GUIDE_LATER', 'IC.ALTERED_STATE_GATE'],
    regressionIds: tests.map((item) => item.id)
  });
  const authority = await loadCurrentAuthority({ root });
  const graphPath = 'guide-graphs/candidates/inner-child.graph.json';
  const baseGraphSha256 = authority.graphHashes.get(graphPath);
  if (!baseGraphSha256) throw new Error('Missing base inner-child graph hash');
  const projectionHash = authority.projectionInputSha256;
  const proposalRoot = `authoring/obsidian/proposals/${proposalId}`;

  async function updateExisting(nodeId, mutator) {
    const relative = `${proposalRoot}/nodes/${nodeId}.md`;
    const parsed = parseAuthoringNote(await readText(relative), { label: relative });
    const frontmatter = structuredClone(parsed.data);
    const payload = structuredClone(parsed.payload);
    mutator(frontmatter, payload);
    validateSchema('nodeProposal', frontmatter, { label: relative });
    await writeText(relative, renderNodeNote({
      frontmatter, payload, heading: frontmatter.title,
      warning: 'Editable proposal record. Building it never changes canonical graph files.', rationaleTemplate: true
    }));
  }

  await updateExisting('IC.BORROW_LOVE', (fm, payload) => {
    fm.title = 'Borrow already-accessible love without flattening its depth';
    uniquePush(fm.source_refs, 'AMEND.IC.WELLBEING_HORIZON');
    uniquePush(payload.recommendations, 'Use ordinary affection or care as a real bridge when it is available, without claiming that it is equivalent to profound spiritual or transpersonal love.');
    uniquePush(payload.effects.requiredNuance, 'Ordinary affection or care and profound transpersonal love are distinct resources; either may be therapeutically useful, and one must not be used to erase the distinction the user is making.');
  });

  await updateExisting('IC.GUIDE_LATER', (fm, payload) => {
    for (const ref of ['AMEND.IC.EXISTENTIAL_LOVE_ROUTING','AMEND.IC.WELLBEING_HORIZON','AMEND.IC.REALIZATION_LOVE_INTEGRATION']) uniquePush(fm.source_refs, ref);
    uniquePush(payload.recommendations, 'When curiosity is genuine, the Guide may support exploration of deeper wellbeing, love, spiritual practice, realization, nature, or tradition without prescribing a metaphysical conclusion.');
    uniquePush(payload.avoid, 'Do not escalate spiritual abstraction or attainment because love feels inaccessible.');
    uniquePush(payload.effects.requiredNuance, 'Spiritual exploration is optional when the person’s current horizon feels sufficient; when realization is already present, assess whether it deepens accessible love and reaches the child rather than assuming attainment itself integrates the wound.');
  });

  await updateExisting('IC.ALTERED_STATE_GATE', (fm, payload) => {
    for (const ref of ['AMEND.IC.EXISTENTIAL_LOVE_ROUTING','AMEND.IC.WELLBEING_HORIZON']) uniquePush(fm.source_refs, ref);
    uniquePush(payload.avoid, 'Do not prescribe recreating a psychedelic, NDE-like, or other extraordinary breakthrough as the answer to hopelessness.');
    uniquePush(payload.effects.requiredNuance, 'A past altered-state opening may establish that a deeper wellbeing horizon was experienced, but it does not prove present access, child inclusion, or integration.');
  });

  for (const node of buildNewNodes()) {
    const frontmatter = {
      authoring_contract: AUTHORING_CONTRACTS.nodeProposal,
      entity_type: 'graph-node-proposal', proposal_id: proposalId, operation: 'add',
      graph_id: 'inner-child-directed-graph', node_id: node.id, title: node.title, kind: node.kind,
      tier: node.tier, priority: node.priority, authority: node.authority,
      graph_tags: node.tags, source_refs: node.sourceRefs,
      base_graph_sha256: baseGraphSha256, base_projection_input_sha256: projectionHash
    };
    validateSchema('nodeProposal', frontmatter, { label: node.id });
    await writeText(`${proposalRoot}/nodes/${node.id}.md`, renderNodeNote({
      frontmatter, payload: nodePayload(node), heading: node.title,
      warning: 'Editable proposal record. Building it never changes canonical graph files.', rationaleTemplate: true
    }));
  }

  const edges = [
    { from:'IC.EXISTENTIAL_NOURISHMENT',to:'IC.LOVE_HORIZON_EXPLORATION',relation:'opens-when-curious' },
    { from:'IC.LOVE_HORIZON_EXPLORATION',to:'IC.DEEP_LOVE_TO_CHILD',relation:'can-enable' },
    { from:'IC.DEEP_LOVE_TO_CHILD',to:'IC.MEET_GUARD',relation:'routes-block-to' },
    { from:'IC.DEEP_LOVE_TO_CHILD',to:'IC.PROTECTOR_ACTION',relation:'embodies-through' },
    { from:'IC.DEEP_LOVE_TO_CHILD',to:'IC.ADULT_APPRENTICE',relation:'integrates-relationally' },
    { from:'IC.REALIZATION_LOVE_INTEGRATION',to:'IC.DEEP_LOVE_TO_CHILD',relation:'feeds-child-integration' },
    { from:'IC.REALIZATION_LOVE_INTEGRATION',to:'IC.PROTECTOR_ACTION',relation:'requires-embodiment' }
  ];
  for (const edge of edges) {
    const tuple = { graphId:'inner-child-directed-graph', ...edge };
    const frontmatter = {
      authoring_contract: AUTHORING_CONTRACTS.edgeProposal, entity_type:'graph-edge-proposal', proposal_id:proposalId, operation:'add',
      edge_id: edgeId(tuple), edge_sha256: edgeDigest(tuple), graph_id: tuple.graphId,
      from_node_id: edge.from, to_node_id: edge.to, relation: edge.relation,
      base_graph_sha256: baseGraphSha256, base_projection_input_sha256: projectionHash
    };
    validateSchema('edgeProposal', frontmatter, { label: frontmatter.edge_id });
    await writeText(`${proposalRoot}/edges/${frontmatter.edge_id}.md`, renderFrontmatterNote({
      frontmatter, heading:`${edge.from} ${edge.relation} ${edge.to}`,
      body:'> [!warning] Editable proposal edge. Building it never changes canonical graph files.'
    }));
  }
  for (const testCase of tests) await writeJson(`${proposalRoot}/tests/${testCase.id}.json`, testCase);

  const proposalFile = `${proposalRoot}/proposal.md`;
  let proposal = await readText(proposalFile);
  proposal = proposal
    .replace('State the exact problem and intended behavioral effect.', 'Separate ordinary care from profound love, add existential-sufficiency and curiosity routing, route already-accessible deep love toward the inner child, and detect realization or doctrine that has outrun lived love.')
    .replace('State what must not change.', 'Do not make spirituality universally required; do not equate mystical intensity with love depth; do not prescribe NDEs, psychedelics, conversion, or crisis; preserve safety/orientation, Guard, credibility, Protector, adult-apprentice, altered-state, identity, and memory safeguards.')
    .replace('State the strongest credible failure caused by this proposal.', 'The guide could become preachy, romanticize existential crisis, flatten ordinary practical love, overvalue mystical intensity, invalidate genuine realization, or route a blocked child toward stronger spiritual intensity instead of relational repair.')
    .replace('Describe the cases that should route differently and the cases that must remain unchanged.', 'G013 proves satisfied/non-curious users are not spiritualized. G014 proves curiosity without experience opens voluntary exploration. G015 proves accessible deep love routes toward the child without force. G016 and G018 prove attainment/doctrinal bypass routes to integration. G017 proves profound existential insufficiency is taken seriously without evangelizing or romanticizing crisis. All existing G001-G012 behavior must remain green.');
  await writeText(proposalFile, proposal);
}

const command = process.argv[2];
if (command === 'prepare') await preparePrerequisites();
else if (command === 'proposal') await buildProposalSources();
else throw new Error('Usage: tmp-love-horizon-proposal.mjs prepare|proposal');
console.log(JSON.stringify({ ok:true, command, proposalId }, null, 2));
