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
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
regression_refs:
  - G001
  - G002
  - G005
  - G008
  - G011
  - G012
  - G017
  - G033
base_record_sha256: bb389ac48bbc66d4d012f917c4819207bd94731c1c2e11c4ef53494ea7bce14c
base_graph_sha256: 8c8a59965c4ee3ffc9fd9dc835e9589808638bd346510a3b4d2c44ba31f3f968
projection_input_sha256: 2b23083b114602af50c57f715c5afb16d1c1b9959e3ca8ea9d7f87f501a49b2f
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
          "low"
        ]
      },
      {
        "field": "coherent_child_state",
        "op": "in",
        "value": [
          "unclear",
          "absent"
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

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]
