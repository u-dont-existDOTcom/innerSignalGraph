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
regression_refs:
  - G008
base_record_sha256: 2094b53095b0213ede115a8db91bb4aab513f48ed727a16853da008dee1a192c
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
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
    "Identify whether the answer supplies Nurturer, Protector, or Guide, then borrow one sentence or one five-percent action."
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
