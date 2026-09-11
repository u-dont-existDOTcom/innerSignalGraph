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
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
projection_input_sha256: 57beb002b0750fd8df8adc9b5edc7d957f9398b619607a883ab9b76c7cf11778
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
