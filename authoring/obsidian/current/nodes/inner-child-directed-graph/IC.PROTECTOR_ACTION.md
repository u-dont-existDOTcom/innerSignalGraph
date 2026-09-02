---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PROTECTOR_ACTION
title: Make the Protector visible in ordinary life
kind: decision-node
tier: 4
priority: 90
authority: author-framework
graph_tags:
  - protector
  - ordinary-life
  - credibility
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.ADULT_APPRENTICE
regression_refs:
  - G003
  - G008
  - G011
base_record_sha256: ea3047ef98652e45c526e0d1db708957e808e99e9b546ad8386f655fae889bbf
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
projection_input_sha256: 0f787fed212f0e7bf6a0201fd36f1c6f0b3f1189425f42a1db02e96ca90501a8
---

# Make the Protector visible in ordinary life

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "credibility_conflict",
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
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not choose an action so large that failure becomes new evidence of unreliability."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Choose one bounded action: a meal, sleep, a boundary, a phone put down, a task handled, an unsafe exchange ended, or help requested.",
    "Report the action without requiring the younger state to trust it yet."
  ],
  "successSignals": [
    "One small promise is kept."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]
