---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.ADULT_APPRENTICE
title: Move from receiving care to doing five percent
kind: decision-node
tier: 4
priority: 86
authority: author-framework
graph_tags:
  - adult-apprentice
  - five-percent
  - relationship
source_refs:
  - IC.ADULT_APPRENTICE
  - IC.RELATIONSHIP
regression_refs: []
base_record_sha256: 4d9a03f5d84e4c1b5513ae0388739069f893801344a16925bbbf9cb6a5124cfa
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
---

# Move from receiving care to doing five percent

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "support_available",
        "op": "eq",
        "value": "present"
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
    "Do not create permanent authority dependency."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role back to the user."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.RELATIONSHIP]]
