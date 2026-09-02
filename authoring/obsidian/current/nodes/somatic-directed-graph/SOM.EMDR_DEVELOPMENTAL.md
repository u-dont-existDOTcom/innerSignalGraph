---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.EMDR_DEVELOPMENTAL
title: Developmental EMDR after basic reparenting capacity
kind: decision-node
tier: 6
priority: 68
authority: author-framework
graph_tags:
  - EMDR
  - developmental
  - reparenting
source_refs:
  - SOM.EMDR
  - AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL
regression_refs:
  - G002
  - G005
base_record_sha256: 24373e0a9caec3d2adb21905de2bed479103893100a91b4966aa792bfaff1339
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Developmental EMDR after basic reparenting capacity

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
        "field": "deep_work_readiness",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "basic_reparenting_capacity",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not turn this conditional sequencing preference into a universal prerequisite."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "For diffuse developmental or relational material, use EMDR after some access to Nurturer/Protector capacity and post-session integration."
  ],
  "successSignals": [
    "Memory work can be held by enough present-day adult and relational capacity."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.EMDR]]

[[current/governance/amendments/AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL]]
