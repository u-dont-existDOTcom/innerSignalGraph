---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.AGE_RESPONSIBILITY_CLARIFICATION
title: Separate developmental ages and responsibility
kind: decision-node
tier: 3
priority: 91
authority: author-framework
graph_tags:
  - age
  - agency
  - responsibility
source_refs:
  - IC.INHERITED_PARENT
  - IC.BOTTOM_UP_SEQUENCE
regression_refs:
  - G001
  - G012
base_record_sha256: 79edfb36dffb16c2670c7d479094e371bf7be00629a56637843006eaa46ad943
base_graph_sha256: eb53a26b4f7b166afd60e0ecffc81439bbaa7b847d022dea2d2f3f4f9d368ecc
projection_input_sha256: c9e563fdad998e15db8d98d0bbd7edc76cda90f0145459cc620ef5fcb869df78
---

# Separate developmental ages and responsibility

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "age_agency_ambiguity",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "resentment_toward_younger_self",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not flatten literal childhood, adolescence, younger adulthood, and a present child-state into one powerless category."
  ],
  "defaultQuestion": "Which age or version of you is the resentment actually directed toward, and what opportunity do you believe that version failed to use?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Identify which age or version is being blamed and what opportunity it supposedly failed to use.",
    "Allocate responsibility according to actual developmental capacity and later constrained agency."
  ],
  "successSignals": [
    "The accusation becomes specific enough to evaluate rather than globally prosecuting the child."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.INHERITED_PARENT]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]
