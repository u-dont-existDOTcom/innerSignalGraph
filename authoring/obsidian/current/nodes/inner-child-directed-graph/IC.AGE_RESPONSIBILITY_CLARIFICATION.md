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
base_graph_sha256: a757a341d88d71f3f5a1ede615e16e0746b86c0b002a35585bc7fa1feb8628e1
projection_input_sha256: 1af4fa8d1b56af3ee7d4dfce8cac182006477e75f5d39960c5535b7223b5b58a
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
