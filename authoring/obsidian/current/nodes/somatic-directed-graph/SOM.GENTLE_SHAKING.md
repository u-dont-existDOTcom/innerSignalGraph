---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.GENTLE_SHAKING
title: Gentle shaking or qigong as regulation or discharge
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
regression_refs: []
base_record_sha256: 362d523fb3bdb6c7f8786345f6a2169a33ff07dc6bda641a578109fe15f1be5e
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Gentle shaking or qigong as regulation or discharge

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
    "Do not chase catharsis, let unsupported neck whipping continue, or treat shaking as the primary treatment for severe PTSD."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use short, playful movement that can stop easily; increase dose only when the person can orient and settle afterward.",
    "Follow stronger discharge with settling rather than walking away raw."
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
