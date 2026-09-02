---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.GENTLE_REGULATION
title: Gentle regulation and embodiment
kind: decision-node
tier: 3
priority: 93
authority: author-framework
graph_tags:
  - regulation
  - SE
  - yoga
  - breathing
source_refs:
  - SOM.PHASE1
  - SOM.SE
  - SOM.YOGA
  - AMEND.SOM.PREP_MODALITIES
regression_refs:
  - G001
  - G002
  - G003
  - G005
  - G011
  - G012
base_record_sha256: c3f791e80587029c64a7840c02972042059ac60365993c1ffabbc8a9fe811d6c
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Gentle regulation and embodiment

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "activation",
        "op": "in",
        "value": [
          "moderate",
          "high"
        ]
      },
      {
        "field": "solar_plexus_tension",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "body_capacity",
        "op": "in",
        "value": [
          "low",
          "unknown"
        ]
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      }
    ]
  },
  "avoid": [
    "Do not force breath, use long holds, push through sensation, or turn regulation into catharsis."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use titrated Somatic Experiencing, trauma-sensitive yoga, gentle longer exhales, gentle Buteyko-style breathing, or low-dose body awareness.",
    "Keep eyes open and choices explicit when imagery or inward focus destabilizes."
  ],
  "successSignals": [
    "Activation can rise and settle without flooding."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE1]]

[[current/sources/somatic-sequencing-guide/SOM.SE]]

[[current/sources/somatic-sequencing-guide/SOM.YOGA]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]
