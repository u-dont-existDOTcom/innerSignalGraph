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
regression_refs:
  - G014
  - G025
  - G031
  - G035
base_record_sha256: b1e65d2504260a9a984e57eccfe96057e0116ab9e8b7aeba5957e00552b94344
base_graph_sha256: 8c8a59965c4ee3ffc9fd9dc835e9589808638bd346510a3b4d2c44ba31f3f968
projection_input_sha256: 9499803d7373c2217bf3f59035cf680e8b679dbf7281c7db14797be0b132a557
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
      },
      {
        "field": "suicidal_state",
        "op": "eq",
        "value": "imminent"
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
      "IC.FORGIVENESS_LATER",
      "IC.SUICIDAL_SELF_DEATH_INQUIRY",
      "IC.PRECIOUS_HUMAN_OPPORTUNITY"
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
    "Use eyes-open, present-focused contact and the smallest reversible action.",
    "When self-harm action is imminent, prioritize distance from means, immediate human contact and urgent in-person help. Defer deeper or metaphysical inquiry until immediate safety and reflective capacity are restored."
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
