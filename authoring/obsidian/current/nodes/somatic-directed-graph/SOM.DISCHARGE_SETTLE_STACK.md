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
base_graph_sha256: 5353c44e3a61ef4c93660b66fcf57ad87b064c417c8413c45213f68306a6dd18
projection_input_sha256: 3416b1a51d2353e79b8e58a241e8f768c7c3f21e7fd99ffc5b3c500199d9ae0f
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
