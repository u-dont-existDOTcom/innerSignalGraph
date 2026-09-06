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
base_graph_sha256: 0f47a3ce32a6207f69d5cbb30b18f8173d558597d10e03092e4720b8d4a9d559
projection_input_sha256: a79819e9410ad9d210bf943baffaca37a61bd81b0ae1540687d7bb8613a4dceb
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
