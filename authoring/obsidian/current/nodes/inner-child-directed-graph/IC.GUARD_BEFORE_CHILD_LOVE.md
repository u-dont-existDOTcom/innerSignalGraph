---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.GUARD_BEFORE_CHILD_LOVE
title: Hear the guard first when the younger self doesn’t want the love
kind: decision-node
tier: 3
priority: 96
authority: author-framework
graph_tags:
  - guard
  - protector
  - deep-love
  - child-inclusion
source_refs:
  - IC.GUARDS
  - AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014
  - AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014
regression_refs:
  - G114
  - G115
  - G121
base_record_sha256: 4f001be5457bbc3237d82d5b0d2d92aaf5209c732bc5cc4d41231d15f16fd2be
base_graph_sha256: 9ea2f37e05e3a754efde7af7df7b9e645cd645802a7f13940c2c738c525dc0fb
projection_input_sha256: 9de22010a10603aa8ce7fdb13b383fd00cd5b3cdc2f88dab87a34b27aef56ad4
---

# Hear the guard first when the younger self doesn’t want the love

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "deep_love_access",
        "op": "in",
        "value": [
          "intermittent",
          "reliable"
        ]
      },
      {
        "field": "child_love_inclusion",
        "op": "eq",
        "value": "blocked"
      }
    ],
    "any": [
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "urge_to_escape",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "guard_engagement",
        "op": "eq",
        "value": "blocking"
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
        "field": "guard_engagement",
        "op": "eq",
        "value": "willing_to_allow"
      }
    ]
  },
  "avoid": [
    "Do not argue the child into receiving love, intensify the spiritual practice, or treat the refusal as failure or as a test of the adult."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_LOVE_TO_CHILD"
    ],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "When the younger self doesn’t want the love, the guard comes first; the love is offered again after the guard has been heard."
    ]
  },
  "recommendations": [
    "When the younger self doesn’t want the love (it recoils, freezes, distrusts or refuses, and a guard shows), hear its guard first instead of pressing the love on it.",
    "Ask what it expects would happen if the love came in, and acknowledge the answer before saying anything back.",
    "Treat the refusal as honest information. Show care that doesn’t depend on the child accepting it, and offer the love again once the guard has been heard and allows it, without arguing.",
    "The child owes no thanks and no proof of readiness."
  ],
  "successSignals": [
    "The guard’s concern is heard, and the younger self can stay present without being pushed to receive the love."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.GUARDS]]

[[current/governance/amendments/AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014]]

[[current/governance/amendments/AMEND.IC.GRATITUDE_LOVE_ACCESS_20261014]]
