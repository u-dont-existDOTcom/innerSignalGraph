---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.REFRACTORY_PAIN_NAVIGATION
title: Coordinate a specialist chronic-pain pathway and flare plan
kind: route-node
tier: 1
priority: 100
authority: owner-approved-extension
graph_tags:
  - medical
  - chronic-pain
  - specialist-referral
  - trust
  - care-navigation
source_refs:
  - AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY
  - AMEND.CROSS.CARE_TRAUMA_DISCLOSURE_AND_TRUST
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.CROSS.RESPONSE_FIDELITY_20261025
  - AMEND.IC.NEWER_GUIDE_PARTS_20261120
  - AMEND.CROSS.KEEP_CAREFUL_LINES_20261120
  - IC.LIVE_GUIDE_DECISIONS_20261120
regression_refs:
  - G099
  - G100
  - G101
  - G102
  - G103
  - G104
  - G105
  - G106
  - G107
  - G108
  - G127
base_record_sha256: 48e464fdd0d2efeb32cb1d9ec04ba48af4f4ea3ef63bc1c31ca0cd03f0921da2
base_graph_sha256: 897752bf50221828d784020ccd4b98cbdb9271432bc4b7baaab3c49dbfd3f23c
projection_input_sha256: fbe2b994e7af17ae9395f3c916d8ca41cf133ab7702b7490e0917a793e6ed853
---

# Coordinate a specialist chronic-pain pathway and flare plan

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "refractory_pain_care",
        "op": "eq",
        "value": "indicated"
      }
    ],
    "any": [
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "absent",
          "unknown"
        ]
      },
      {
        "field": "suicidal_ideation_context",
        "op": "eq",
        "value": "pain_episode"
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "medical_urgency",
        "op": "eq",
        "value": "urgent"
      },
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "intent",
          "imminent"
        ]
      },
      {
        "field": "suicidal_ideation_context",
        "op": "eq",
        "value": "other_or_unclear"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "no"
      }
    ]
  },
  "avoid": [
    "Do not advise routinely calling an ambulance every day just to be taken seriously or imply many visits guarantee a referral.",
    "Do not recommend volunteering transient pain-triggered suicidal thoughts as leverage for physical-pain treatment; prior harmful psychiatric care must inform referral feasibility.",
    "Do not coach a false denial of current suicidal intent, a suicide plan, inability to remain safe, or imminent danger, inability to stay safe or another actual urgent danger; immediate protection still matters in that situation.",
    "Do not overdiagnose central sensitization or claim a PPI, antidepressant or neuromodulation response proves the pain mechanism or repairs drug-related injury.",
    "Do not confuse treatments offered, declined, actually taken and ineffective, or invent access guarantees.",
    "Do not treat another checkup as inherently therapeutic after an already extensive unsuccessful workup; do not promise specific relief or erase the person's informed understanding of local services.",
    "Do not present an emotional side as \"the pain isn't real\", or offer it before the medical checks."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.SUICIDAL_SELF_DEATH_INQUIRY",
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim repeated emergency contact guarantees a particular medicine or specialist care.",
      "Do not infer suicidal intent or a confirmed pain diagnosis from brief distress or treatment response.",
      "Do not treat any psychiatric or clinical institution as universally harmless or harmful."
    ],
    "requiredNuance": [
      "The immediate safety route remains available if intent or inability to stay safe emerges, even if the person has been harmed by coercive treatment.",
      "The primary solution to predictable recurring pain is continuity of specialist care and flare planning, not repeated emergency contact alone.",
      "Trusted voluntary advocacy is valuable when prior coercive encounters limit trust; an unsafe family member is not an automatic support.",
      "Referral urgency and access remain clinically and locally determined.",
      "Unknown stopping/return capacity or present safety is not, by itself, evidence of impairment; the referral action is reversible, and concern about danger must be based on concrete evidence. For reported pain-triggered suicidal ideation, keep the observing/adult safety-support node selected alongside chronic-pain coordination, and never overrule actual present_safety unsafe, demonstrated lost capacity, suicidal intent or new medical red flags.",
      "Before proposing another nonurgent consultation after multiple ineffective or coercive encounters, identify a plausible new evaluation, treatment or support function that could change the plan, with actual access burdens; if none is known, ask what the person considers helpful rather than repeating a generic referral."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Recognize recurrent severe refractory bodily pain as a treatment access and longitudinal care problem without assuming the person is psychologically imagining it or that a specific mechanism has been proven.",
    "Select one feasible access step: a referral to a locally verified type of chronic-pain specialist service, without inventing a clinic or contact details. In France a physician can send the HAS adult SDC referral form and justify a sollicitation urgente for priority assessment if warranted. Do not promise acceptance, expedited scheduling, cure or a particular intervention.",
    "Seek an individualized written plan for predictable pain flares: whom to contact, agreed treatments and which features require urgent medical triage. SAMU or emergency care is a backup for new red flags, changed or atypical symptoms, unusually severe or unmanageable attacks, not the only near-daily strategy.",
    "Preserve previous investigations and distinguish offered/prescribed from actually tried medicines and experienced effects. A specialist may evaluate structural, visceral, neuropathic and nociplastic possibilities without claiming a diagnosis from a response.",
    "Respect prior coercive or harmful care, patient agency and an appropriately chosen trusted friend/advocate without assuming family or medical institutions are automatically safe or automatically malicious.",
    "Consider tDCS/rTMS only if a qualified pain specialist finds an appropriate condition and indication, without promising symptom relief or recommending home stimulation.",
    "Pain can have an emotional side. After the medical checks, the person may consider that as one possibility among others; normal test results don't prove the pain is imaginary, and not all illness is rooted in emotional issues."
  ],
  "successSignals": [
    "A specific specialist referral or justified priority request is submitted, or its exact current blocker and next step are identified.",
    "A written flare response plan is made or a practical request for one is documented."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY]]

[[current/governance/amendments/AMEND.CROSS.CARE_TRAUMA_DISCLOSURE_AND_TRUST]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.RESPONSE_FIDELITY_20261025]]

[[current/governance/amendments/AMEND.IC.NEWER_GUIDE_PARTS_20261120]]

[[current/governance/amendments/AMEND.CROSS.KEEP_CAREFUL_LINES_20261120]]

[[current/sources/inner-child-guide/IC.LIVE_GUIDE_DECISIONS_20261120]]
