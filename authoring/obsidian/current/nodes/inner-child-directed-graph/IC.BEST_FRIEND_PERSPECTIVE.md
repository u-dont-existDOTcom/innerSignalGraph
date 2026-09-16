---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.BEST_FRIEND_PERSPECTIVE
title: Borrow the best-friend standard of care
kind: decision-node
tier: 4
priority: 88
authority: author-framework
graph_tags:
  - best-friend
  - borrowed-adulthood
  - perspective
source_refs:
  - AMEND.IC.BEST_FRIEND_PROMPT
  - IC.BORROW_ONE_FUNCTION
  - AMEND.IC.WISDOM_CORE
regression_refs:
  - G008
  - G026
  - G027
  - G028
  - G031
  - G032
  - G033
  - G034
  - G035
  - G036
base_record_sha256: 5474d5ff4fa1c7c74908569a728d25d197c61dfe11cf3d5bc99bb3b8684523e8
base_graph_sha256: a2adb4c3f3d7727f1943c0805f713fa4a8b150353dcc5593b118500c53267342
projection_input_sha256: ce5fd7dec1e1fbcdcc7e24160f41a60bdf9bc20ff7746c255d6dfe0b19e2d52c
---

# Borrow the best-friend standard of care

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "self_criticism",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "conversation"
      }
    ]
  },
  "avoid": [
    "Do not use the friend standard to shame the person for not already treating themselves that way."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Ask: 'What would I tell my best friend in this exact situation?'",
    "Identify whether the answer supplies Nurturer, Protector, or Guide, then borrow one sentence or one five-percent action.",
    "If the person wants another caring vantage point, offer a wiser future self or supportive company as an alternative, not a compulsory addition. Preserve changed understanding, felt embodiment and companionship as different possible benefits."
  ],
  "successSignals": [
    "One concrete sentence or action becomes available."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.BEST_FRIEND_PROMPT]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]
