---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.DISCHARGE_SETTLE_STACK
title: Discharge, then settle and reorient
kind: decision-node
tier: 5
priority: 80
authority: author-framework
graph_tags:
  - settle
  - integration
  - aftercare
source_refs:
  - SOM.STACK
  - SOM.POST_BRAINSPOTTING
  - SOM.POST_EMDR
regression_refs: []
base_record_sha256: d698ab969a49146d76966743e2f0c9ab804b25f11018b64fba75f0dc05f6ba96
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: c5c4aed6b8851992ca36c580a60360aeef78931bfaf972429487e3d3143f8084
---

# Discharge, then settle and reorient

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "discharge_used",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not stack several intense processing methods on the same day without established tolerance and skilled support."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "After discharge, use restorative movement, gentle yoga, walking, hydration, food, rest, or light EFT according to what the body needs."
  ],
  "successSignals": [
    "The person returns to ordinary functioning rather than remaining raw."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.STACK]]

[[current/sources/somatic-sequencing-guide/SOM.POST_BRAINSPOTTING]]

[[current/sources/somatic-sequencing-guide/SOM.POST_EMDR]]
