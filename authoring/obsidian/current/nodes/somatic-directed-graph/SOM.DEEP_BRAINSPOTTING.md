---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.DEEP_BRAINSPOTTING
title: Deep Brainspotting for diffuse or body-held material
kind: decision-node
tier: 6
priority: 66
authority: author-framework
graph_tags:
  - brainspotting
  - deep-processing
source_refs:
  - SOM.PHASE3
  - SOM.BRAINSPOTTING
  - SOM.POST_BRAINSPOTTING
regression_refs:
  - G002
base_record_sha256: 5bcc060e0093ae2a14b71a2e534ec332529146195241373c6a96611b00f7f4fa
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 4481c17e9ee7ea48f2127b7e58a33ef8c25abb06dbb1bf2cf17f9f615da0794e
---

# Deep Brainspotting for diffuse or body-held material

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "deep_work_readiness",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "target_type",
        "op": "in",
        "value": [
          "developmental",
          "diffuse"
        ]
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
    "Do not rush directly into analysis afterward or treat every image as historical fact."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use deeper gaze-position work when regulation, discharge, body awareness, and integration skills are established."
  ],
  "successSignals": [
    "Deeper material can be contacted without loss of orientation or prolonged destabilization."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE3]]

[[current/sources/somatic-sequencing-guide/SOM.BRAINSPOTTING]]

[[current/sources/somatic-sequencing-guide/SOM.POST_BRAINSPOTTING]]
