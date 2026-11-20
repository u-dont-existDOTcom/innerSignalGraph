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
  - AMEND.IC.SCAFFOLDING_IS_READINESS_20261120
  - IC.LIVE_GUIDE_DECISIONS_20261120
regression_refs:
  - G014
  - G025
  - G031
  - G035
  - G069
  - G079
  - G096
  - G104
  - G106
  - G131
  - G154
base_record_sha256: 7d6dac93489f2821e8bfb9f38c0a1401fb617b53198d996b039d78427481af68
base_graph_sha256: 41dbf0e44fd2ebc7bb452db405c70d727d9392795729e3cf406a233fc543882f
projection_input_sha256: 439821153203668fa2e716b0247c6b73c7c6f075d3b5889d95c9995c95c7c2a3
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
    "When self-harm action is imminent, prioritize distance from means, immediate human contact and urgent in-person help. Defer deeper or metaphysical inquiry until immediate safety and reflective capacity are restored.",
    "Scaffolding is the readiness check: start with the smallest step that feels possible and go deeper only after the last one went well. Coming back to the room is practised on those small steps, never tested before starting; what sends the work here first is noticing that the person plainly can't stay present or find their way back right now."
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

[[current/governance/amendments/AMEND.IC.SCAFFOLDING_IS_READINESS_20261120]]

[[current/sources/inner-child-guide/IC.LIVE_GUIDE_DECISIONS_20261120]]
