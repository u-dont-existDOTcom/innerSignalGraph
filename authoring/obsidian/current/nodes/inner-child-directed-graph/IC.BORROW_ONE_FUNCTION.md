---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.BORROW_ONE_FUNCTION
title: Borrow one bounded adult function
kind: decision-node
tier: 3
priority: 94
authority: author-framework
graph_tags:
  - borrowed-adulthood
  - nurturer
  - protector
  - guide
  - adult-side-borrowing
source_refs:
  - IC.BORROW_ONE_FUNCTION
  - IC.ADULT_APPRENTICE
regression_refs:
  - G001
  - G002
  - G003
  - G005
  - G008
  - G011
  - G012
base_record_sha256: 11f21fa8d4679e259279acbf9a15ffb60035cacb540b19a8f539985730b106a2
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: e4e31e4dded7f0ec1f824717e405289f76163ca88db84795b2b1ceda149c7378
---

# Borrow one bounded adult function

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
          "partial",
          "unknown"
        ]
      },
      {
        "field": "parent_imagery",
        "op": "in",
        "value": [
          "critical",
          "frightening",
          "blank"
        ]
      },
      {
        "field": "self_directed_love",
        "op": "in",
        "value": [
          "unsafe",
          "inaccessible"
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
      }
    ]
  },
  "avoid": [
    "Do not demand an ideal parent image or let the helper become authority over memories, medicine, relationships, or future."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim the inner adult has already been built."
    ],
    "requiredNuance": [
      "Adult identity may form after behavior.",
      "Borrowed adulthood can support the part attempting the adult role, not only the younger state."
    ]
  },
  "recommendations": [
    "Borrow one narrow function—warmth, protection, or direction—from a safe person, figure, plan, value, or ordinary action.",
    "Keep it bounded, observable, and returnable.",
    "When the part attempting the adult role becomes resentful, defensive, or retaliatory, borrow one non-retaliatory adult response for that side too—for example, how a decent adult would hear contempt without arguing its own goodness."
  ],
  "successSignals": [
    "The person can perform one adult function without pretending the whole role is available."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]
