---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.EFT_PORTABLE
title: Portable EFT for real-world triggers
kind: decision-node
tier: 4
priority: 86
authority: author-framework
graph_tags:
  - EFT
  - portable
  - regulation
source_refs:
  - SOM.EFT
  - AMEND.SOM.PREP_MODALITIES
regression_refs: []
base_record_sha256: 06ba98fd307149cdb274cd0fd010d741c68e55d8816ae21fcbae2b25960dcc21
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
---

# Portable EFT for real-world triggers

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "activation",
        "op": "in",
        "value": [
          "moderate",
          "high"
        ]
      },
      {
        "field": "trigger_loop",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "gentle_practice"
      }
    ]
  },
  "avoid": [
    "Do not present EFT as the sole treatment for severe trauma or a substitute for deeper work when needed."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use tapping before or after difficult conversations or therapy, and when thought loops and bodily activation occur together."
  ],
  "successSignals": [
    "The person can return to the task or relationship with more choice."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.EFT]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]
