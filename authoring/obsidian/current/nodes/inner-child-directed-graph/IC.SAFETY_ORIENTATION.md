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
base_graph_sha256: 55b079263bc6ced7c1cf9b1ed3d1a786fa0b191dde1ad700485294ac72804c92
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
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
