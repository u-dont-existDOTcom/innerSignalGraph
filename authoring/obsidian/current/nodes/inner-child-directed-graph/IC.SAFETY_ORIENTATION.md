---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SAFETY_ORIENTATION
title: Outside safety and present orientation first
kind: decision-node
tier: 1
priority: 100
authority: author-framework
graph_tags:
  - safety
  - orientation
source_refs:
  - IC.BEFORE_DEEP
  - IC.REGULATION_BEFORE_DIALOGUE
regression_refs: []
base_record_sha256: 9e83e56f6ec8c4992858d1ae666290ea161c0b01675269545dc1b2e44657b8d3
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
projection_input_sha256: 0f787fed212f0e7bf6a0201fd36f1c6f0b3f1189425f42a1db02e96ca90501a8
---

# Outside safety and present orientation first

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
      }
    ]
  },
  "avoid": [
    "Do not deepen, interpret memories, or require an inner-child response."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "IC.GUIDE_LATER",
      "IC.FORGIVENESS_LATER"
    ],
    "forbiddenOverclaims": [
      "Do not claim a hidden adult capacity or hidden progress."
    ],
    "requiredNuance": [
      "Present danger and past childhood fear are different problems."
    ]
  },
  "recommendations": [
    "Pause deeper dialogue; orient to the actual room, body, time, and available human support.",
    "Use eyes-open, present-focused contact and the smallest reversible action."
  ],
  "successSignals": [
    "The person can stop, orient, and return to ordinary life."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.REGULATION_BEFORE_DIALOGUE]]
