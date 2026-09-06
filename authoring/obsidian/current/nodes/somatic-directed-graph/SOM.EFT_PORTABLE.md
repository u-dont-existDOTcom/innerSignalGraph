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
regression_refs:
  - G015
  - G016
  - G018
  - G025
base_record_sha256: 06ba98fd307149cdb274cd0fd010d741c68e55d8816ae21fcbae2b25960dcc21
base_graph_sha256: 0f47a3ce32a6207f69d5cbb30b18f8173d558597d10e03092e4720b8d4a9d559
projection_input_sha256: a79819e9410ad9d210bf943baffaca37a61bd81b0ae1540687d7bb8613a4dceb
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
