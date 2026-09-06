---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.RESOURCE_BRAINSPOTTING
title: Resource-oriented or titrated Brainspotting
kind: decision-node
tier: 5
priority: 74
authority: author-framework
graph_tags:
  - brainspotting
  - resource
  - titration
source_refs:
  - SOM.BRAINSPOTTING
  - AMEND.SOM.PREP_MODALITIES
regression_refs: []
base_record_sha256: 096eff3100bda6f048bbd4275860df49c85f63c65feedc95336c82ca7d66af3b
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: c5c4aed6b8851992ca36c580a60360aeef78931bfaf972429487e3d3143f8084
---

# Resource-oriented or titrated Brainspotting

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "orientation",
        "op": "eq",
        "value": "oriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "yes"
      }
    ],
    "any": [
      {
        "field": "target_type",
        "op": "in",
        "value": [
          "developmental",
          "diffuse"
        ]
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "gentle_practice"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not assume resource-oriented use is equivalent to deep subcortical processing."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use resource-oriented or carefully titrated gaze work as preparation or alongside inner-child work."
  ],
  "successSignals": [
    "The person can contact material in small doses and return."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.BRAINSPOTTING]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]
