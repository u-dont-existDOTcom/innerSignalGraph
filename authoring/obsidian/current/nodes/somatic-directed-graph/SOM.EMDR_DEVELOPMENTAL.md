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
base_graph_sha256: 5f2387789deec1cc04e6d7ff0f1a66b455472b1dccdf6cb3cb5afc0707ba47fc
projection_input_sha256: d807775fcdfe2d3cd1ab0a040505f4c1e14aba98e39945a00dffa26a60306034
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
