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
regression_refs: []
base_record_sha256: f274e3d130d1f380cb942f7c15fb7c9277dfe2de431c0745ff3b61e732c9ff9c
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 2cd50da8bfdb8e3e7b08926f7d1b9eabc9cf854231c4fa59350f27a7bf684320
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
