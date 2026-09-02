---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.EMDR_DEVELOPMENTAL_DEFER
title: Defer developmental EMDR while reparenting capacity is missing
kind: decision-node
tier: 3
priority: 89
authority: author-framework
graph_tags:
  - EMDR
  - defer
  - developmental
source_refs:
  - AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL
  - IC.BORROW_ONE_FUNCTION
  - IC.PROTECTOR_VISIBLE
regression_refs:
  - G005
base_record_sha256: 9002335be1848c984a09c4b9aecfad54de603d9cbdb13d51736b8aef7829a323
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 4b5bea805e0b1d4aee6cc9121081d2b08ca6fa6bf019444d2cd96ac39680268f
---

# Defer developmental EMDR while reparenting capacity is missing

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "target_type",
        "op": "in",
        "value": [
          "developmental",
          "diffuse"
        ]
      },
      {
        "field": "basic_reparenting_capacity",
        "op": "eq",
        "value": "no"
      }
    ],
    "any": [
      {
        "field": "current_intent",
        "op": "eq",
        "value": "memory_processing"
      },
      {
        "field": "emdr_interest",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not imply EMDR is permanently contraindicated."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "SOM.EMDR_DEVELOPMENTAL"
    ],
    "forbiddenOverclaims": [
      "Do not say everyone must finish inner-child therapy before EMDR."
    ],
    "requiredNuance": [
      "A stable discrete target is a different case."
    ]
  },
  "recommendations": [
    "Build basic Nurturer/Protector or borrowed-adulthood capacity first while continuing appropriate regulation and present-focused work."
  ],
  "successSignals": [
    "The person gains enough capacity to hold what memory work opens."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]
