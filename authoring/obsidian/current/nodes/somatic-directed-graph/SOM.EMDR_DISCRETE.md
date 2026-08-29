---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.EMDR_DISCRETE
title: EMDR for a discrete target in a stable person
kind: decision-node
tier: 6
priority: 72
authority: author-framework
graph_tags:
  - EMDR
  - discrete-target
source_refs:
  - SOM.PHASE4
  - SOM.EMDR
  - AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL
regression_refs:
  - G004
base_record_sha256: 2a36db3d57035768292f7c90baa1da929afd564a3df8be7b16bd65e75f55cddf
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: e4e31e4dded7f0ec1f824717e405289f76163ca88db84795b2b1ceda149c7378
---

# EMDR for a discrete target in a stable person

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "target_type",
        "op": "eq",
        "value": "discrete"
      },
      {
        "field": "deep_work_readiness",
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
    "Do not require a long preliminary sequence merely because the modality is placed in Phase 4."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Consider EMDR for a clear event or residual trigger when the person can regulate and integrate afterward."
  ],
  "successSignals": [
    "The specific trigger changes without broad destabilization."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE4]]

[[current/sources/somatic-sequencing-guide/SOM.EMDR]]

[[current/governance/amendments/AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL]]
