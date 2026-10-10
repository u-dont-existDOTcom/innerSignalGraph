---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.GENTLE_SHAKING
title: Use gentle shaking for regulation and judge benefit by carryover
kind: decision-node
tier: 4
priority: 82
authority: author-framework
graph_tags:
  - shaking
  - qigong
  - discharge
source_refs:
  - SOM.GENTLE_SHAKING
  - SOM.SHAKING_QIGONG
  - AMEND.SOM.PREP_MODALITIES
  - AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION
regression_refs:
  - G015
  - G016
  - G018
  - G053
  - G058
  - G060
  - G062
  - G066
  - G068
  - G074
  - G085
  - G087
  - G088
  - G089
  - G090
  - G091
base_record_sha256: 9abd685a7a54c9265c03891516135ff34ba0fcbe17e24b3ed3bcea7eb54283d0
base_graph_sha256: e498876bf5106a5742a4b66be29c7a78a766034320bf3c5a402704aeedf6bd71
projection_input_sha256: 4e2c21f579757efa586193e93fd481be32616ab07c84fc5177ab65a4e3572784
---

# Use gentle shaking for regulation and judge benefit by carryover

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "freeze_pattern",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "activation",
        "op": "in",
        "value": [
          "moderate",
          "high"
        ]
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "gentle_practice"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      }
    ]
  },
  "avoid": [
    "Do not chase catharsis, let unsupported neck whipping continue, or treat shaking as the primary treatment for severe PTSD.",
    "Do not escalate shaking merely because it produced brief relief, and do not use repeated symptom checks to force certainty about whether it worked."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that shaking ended an episode, produced durable improvement, treated its underlying cause, or established a mechanism when symptoms returned shortly afterward."
    ],
    "requiredNuance": [
      "Match the claim to the observed horizon: short-lived relief followed by recurrence is evidence of short-lived relief or association, not durable resolution."
    ]
  },
  "recommendations": [
    "Use short, playful movement that can stop easily; increase dose only when the person can orient and settle afterward.",
    "Follow stronger discharge with settling rather than walking away raw.",
    "Use a brief bounded check of onset, duration, recurrence and later functioning when evaluating benefit; brief relief can be worth noting without inflating it into resolution or turning tracking into another monitoring ritual."
  ],
  "successSignals": [
    "The person finishes more regulated rather than blasted open."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.GENTLE_SHAKING]]

[[current/sources/somatic-sequencing-guide/SOM.SHAKING_QIGONG]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]

[[current/governance/amendments/AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION]]
