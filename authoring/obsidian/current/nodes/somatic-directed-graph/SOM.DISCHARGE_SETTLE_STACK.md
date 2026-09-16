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
base_graph_sha256: 5f2387789deec1cc04e6d7ff0f1a66b455472b1dccdf6cb3cb5afc0707ba47fc
projection_input_sha256: d807775fcdfe2d3cd1ab0a040505f4c1e14aba98e39945a00dffa26a60306034
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
