---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.SAFETY_STABILIZATION
title: Safety, orientation, and stopping capacity
kind: decision-node
tier: 1
priority: 100
authority: author-framework
graph_tags:
  - safety
  - stabilization
source_refs:
  - SOM.MAP_NOT_LADDER
  - SOM.PHASE1
  - SOM.SE
regression_refs:
  - G014
  - G025
  - G031
  - G035
base_record_sha256: e89d236a5e416e45a6e8a909a2c70bcde7a48e74c6e06d29e26eff011966b92b
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
projection_input_sha256: 1f98e966e76da6e426ced6cfc6e014ba9b97033cb71512468963415ca21e4169
---

# Safety, orientation, and stopping capacity

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
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
      },
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "suicidal_state",
        "op": "eq",
        "value": "imminent"
      }
    ]
  },
  "avoid": [
    "Do not treat capacity-building as proof that trauma processing occurred."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "SOM.DEEP_BRAINSPOTTING",
      "SOM.EMDR_DEVELOPMENTAL",
      "SOM.EMDR_DISCRETE",
      "SOM.ADVANCED_RELEASE_OPTIONAL"
    ],
    "forbiddenOverclaims": [
      "Do not confuse intensity with healing."
    ],
    "requiredNuance": [
      "Capacity-building should not become an endless waiting room."
    ]
  },
  "recommendations": [
    "Use outside safety, orientation, low-dose regulation, and qualified support before processing.",
    "Choose the smallest step that can be stopped and recovered from."
  ],
  "successSignals": [
    "The person can remain present, stop, and return to ordinary life."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.MAP_NOT_LADDER]]

[[current/sources/somatic-sequencing-guide/SOM.PHASE1]]

[[current/sources/somatic-sequencing-guide/SOM.SE]]
