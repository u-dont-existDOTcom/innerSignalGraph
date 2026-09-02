---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.NEUTRAL_WITNESS
title: Begin with a neutral witness
kind: decision-node
tier: 3
priority: 95
authority: author-framework
graph_tags:
  - borrowed-adulthood
  - witness
source_refs:
  - IC.NEUTRAL_WITNESS
  - IC.BORROW_ADULT
regression_refs:
  - G001
  - G002
  - G005
  - G008
  - G011
  - G012
base_record_sha256: b14122b3e2b27c418d0ccdf67a83190bda71621c6952eecd14a17882b4e5f3a9
base_graph_sha256: 55b079263bc6ced7c1cf9b1ed3d1a786fa0b191dde1ad700485294ac72804c92
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
---

# Begin with a neutral witness

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "unknown"
        ]
      },
      {
        "field": "coherent_child_state",
        "op": "in",
        "value": [
          "unclear",
          "absent",
          "unknown"
        ]
      },
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "dissociation",
        "op": "in",
        "value": [
          "mild",
          "high"
        ]
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
      },
      {
        "field": "witness_capacity",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not turn witnessing into proof that a complete inner adult is present."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not declare the calm Self or adult already exists underneath everything."
    ],
    "requiredNuance": [
      "Witnessing is a starting function, not evidence that the whole adult role is built.",
      "When the person can already observe and distinguish the internal positions, do not send them back through witness bootstrap merely because the adult role remains incomplete."
    ]
  },
  "recommendations": [
    "Name that a younger or distressed state is present and that something can notice it, without pretending warmth or wisdom already exists."
  ],
  "successSignals": [
    "A small amount of psychological distance appears without losing present orientation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.NEUTRAL_WITNESS]]

[[current/sources/inner-child-guide/IC.BORROW_ADULT]]
