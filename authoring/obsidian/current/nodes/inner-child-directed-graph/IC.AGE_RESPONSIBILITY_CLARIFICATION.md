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
base_graph_sha256: d4b4c8dcccb63795c523c14bf995d9957c6c3e0b0b0af4f137ec9ae9bb58744e
projection_input_sha256: 3b334606ff10f36690771c46f59b87e7b90a407aca49d339e05f9e0b8c5117f7
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
