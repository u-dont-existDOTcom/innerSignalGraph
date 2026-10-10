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
regression_refs:
  - G069
  - G079
  - G094
base_record_sha256: 162be0f0399a14a0d1411f1e763cf8f49f4dd5a27f2baaacf2ef6222f55fd370
base_graph_sha256: afbebefa2779fe9833dd7a974735316169e62d1ea9a769126199f53e9a9a96e5
projection_input_sha256: 42a366bf501a3e110c367dacca83a75f4384ae8d7025813f3d1d11791b525913
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
    "Do not substitute a generic suicide-hotline script or repeat 'see a doctor' as new advice when thoughts of death are reported as pain-triggered and the actionable problem is unbearable bodily pain. Do not weaken immediate protective action if current self-harm intent or inability to remain safe is supported."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "IC.REACTIVATION",
      "IC.SCAFFOLDED_CHALLENGE"
    ],
    "forbiddenOverclaims": [
      "Do not diagnose a medical or neurological condition from a red-flag symptom alone."
    ],
    "requiredNuance": [
      "Hard safety and urgent medical red flags are exempt from ordinary focus parking; they take priority only to the degree needed for immediate protection or urgent assessment."
    ]
  },
  "recommendations": [
    "Give direct, proportionate guidance for urgent medical assessment or emergency help before continuing therapeutic interpretation.",
    "Do not delay an urgent red flag with baseline-history questions. Once immediate safety is handled, return to the person's therapeutic focus when appropriate.",
    "For severe recurrent pain after prior unrevealing assessments, preserve that history. During an unbearable attack, an appropriate local medical emergency/urgent-care triage service can assess the live episode and consider pain relief despite diagnostic uncertainty; do not promise an ambulance, admission, a particular medicine, or zero cost."
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
