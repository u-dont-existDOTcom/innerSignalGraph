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
regression_refs:
  - G099
  - G100
  - G101
  - G102
base_record_sha256: d98401cbdd329bcca008313261a695031592799dc1dad676ab3f9152ebaee7d0
base_graph_sha256: 56b8cd4d3fdb8ceb2c08ddac32120eb1eaaaf0c33f8a2063e134b6bb2c915318
projection_input_sha256: 576865b8baa3e849e062d5ddd215ecabe4e84a4f6a78e75b6784f314e49bba57
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
      }
    ]
  },
  "avoid": [
    "Do not advise calling an ambulance every day just to be taken seriously or imply many visits guarantee a referral.",
    "Do not recommend volunteering transient pain-triggered suicidal thoughts as leverage for physical-pain treatment; prior harmful psychiatric care must inform referral feasibility.",
    "Do not coach a false denial of genuine imminent suicidal intent, inability to stay safe or another actual urgent danger; immediate protection still matters in that situation.",
    "Do not overdiagnose central sensitization or claim a PPI, antidepressant or neuromodulation response proves the pain mechanism or repairs drug-related injury.",
    "Do not confuse treatments offered, declined, actually taken and ineffective, or invent access guarantees."
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
      "Referral urgency and access remain clinically and locally determined."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Recognize recurrent severe refractory bodily pain as a treatment access and longitudinal care problem without assuming the person is psychologically imagining it or that a specific mechanism has been proven.",
    "Select one feasible access step: a referral to a named chronic-pain specialist service. In France a physician can send the HAS adult SDC referral form and justify a sollicitation urgente for priority assessment if warranted. Do not promise acceptance, expedited scheduling, cure or a particular intervention.",
    "Seek an individualized written plan for predictable pain flares: whom to contact, agreed treatments and which features require urgent medical triage. SAMU or emergency care is a backup for truly dangerous, unusually severe or unmanageable events, not the only near-daily strategy.",
    "Preserve previous investigations and distinguish offered/prescribed from actually tried medicines and experienced effects. A specialist may evaluate structural, visceral, neuropathic and nociplastic possibilities without claiming a diagnosis from a response.",
    "Respect prior coercive or harmful care, patient agency and an appropriately chosen trusted friend/advocate without assuming family or medical institutions are automatically safe or automatically malicious.",
    "Consider tDCS/rTMS only if a qualified pain specialist finds an appropriate condition and indication, without promising symptom relief or recommending home stimulation."
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
