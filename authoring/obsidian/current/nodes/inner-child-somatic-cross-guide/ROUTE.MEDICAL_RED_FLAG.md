---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.MEDICAL_RED_FLAG
title: Handle an urgent medical red flag before therapy interpretation
kind: route-node
tier: 1
priority: 100
authority: owner-approved-extension
graph_tags:
  - medical
  - urgent
  - safety
  - red-flag
source_refs:
  - AMEND.CROSS.FOCUS_PRIORITY_BASELINE
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY
regression_refs:
  - G069
  - G079
  - G094
  - G095
  - G096
  - G098
  - G099
  - G101
base_record_sha256: 2e87b2a23c5469798c9432ab73c5047ce9fd85a4167c2a353796f954fa172fc5
base_graph_sha256: 56b8cd4d3fdb8ceb2c08ddac32120eb1eaaaf0c33f8a2063e134b6bb2c915318
projection_input_sha256: 576865b8baa3e849e062d5ddd215ecabe4e84a4f6a78e75b6784f314e49bba57
---

# Handle an urgent medical red flag before therapy interpretation

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "medical_urgency",
        "op": "eq",
        "value": "urgent"
      }
    ]
  },
  "avoid": [
    "Do not park a clearly urgent medical or neurological red flag because the person mentioned it as an aside.",
    "Do not diagnose the cause from chat, and do not turn an urgent medical turn into inner-child continuity messaging.",
    "Do not substitute a generic suicide-hotline script or repeat 'see a doctor' as new advice when thoughts of death are reported as pain-triggered and the actionable problem is unbearable bodily pain. Do not weaken immediate protective action if current self-harm intent or inability to remain safe is supported.",
    "Do not recommend daily ambulance calls simply to force recognition of an inadequately treated chronic condition, and never promise that repeat emergency visits cause specialist referral."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "IC.REACTIVATION",
      "IC.SCAFFOLDED_CHALLENGE",
      "IC.SUICIDAL_SELF_DEATH_INQUIRY"
    ],
    "forbiddenOverclaims": [
      "Do not diagnose a medical or neurological condition from a red-flag symptom alone.",
      "Do not promise an ambulance, a particular pain medication, guaranteed analgesia, a definitive diagnosis or zero cost from emergency assessment."
    ],
    "requiredNuance": [
      "Hard safety and urgent medical red flags are exempt from ordinary focus parking; they take priority only to the degree needed for immediate protection or urgent assessment.",
      "During urgent bodily pain, medical assessment and relief take precedence over existential inquiry; acute self-harm danger still requires immediate safety actions in parallel, and the supporting adult-protection function is not disabled."
    ]
  },
  "recommendations": [
    "Give direct, proportionate guidance for urgent medical assessment or emergency help before continuing therapeutic interpretation.",
    "Do not delay an urgent red flag with baseline-history questions. Once immediate safety is handled, return to the person's therapeutic focus when appropriate.",
    "For severe recurrent pain after prior unrevealing assessments, preserve that history. During an unbearable attack, an appropriate local medical emergency/urgent-care triage service can assess the live episode and consider pain relief despite diagnostic uncertainty; do not promise an ambulance, admission, a particular medicine, or zero cost.",
    "Near-daily familiar severe pain calls for a sustainable specialist pain-care pathway and written flare plan in addition to proportionate urgent care for dangerous or truly unmanageable episodes."
  ],
  "successSignals": [
    "The response prioritizes immediate medical safety without unnecessary diagnostic speculation and leaves therapy work for after the urgent issue is addressed."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.FOCUS_PRIORITY_BASELINE]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY]]
