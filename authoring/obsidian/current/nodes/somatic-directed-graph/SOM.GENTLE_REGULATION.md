---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.GENTLE_REGULATION
title: Gentle regulation and embodiment
kind: decision-node
tier: 3
priority: 93
authority: author-framework
graph_tags:
  - regulation
  - SE
  - yoga
  - breathing
source_refs:
  - SOM.PHASE1
  - SOM.SE
  - SOM.YOGA
  - AMEND.SOM.PREP_MODALITIES
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
regression_refs:
  - G001
  - G002
  - G003
  - G005
  - G011
  - G012
  - G013
  - G015
  - G016
  - G018
  - G033
base_record_sha256: 3d196d52c0dce8edef13b2006d5ce50103396b946f775778eed6e8eb8e233d77
base_graph_sha256: 0f47a3ce32a6207f69d5cbb30b18f8173d558597d10e03092e4720b8d4a9d559
projection_input_sha256: c4d2182b637336edfa59680276b150d868b2057650c75fd97453cd904987f8ef
---

# Gentle regulation and embodiment

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
        "field": "solar_plexus_tension",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "body_capacity",
        "op": "in",
        "value": [
          "low"
        ]
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      }
    ]
  },
  "avoid": [
    "Do not force breath, use long holds, push through sensation, or turn regulation into catharsis."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use titrated Somatic Experiencing, trauma-sensitive yoga, gentle longer exhales, gentle Buteyko-style breathing, or low-dose body awareness.",
    "Keep eyes open and choices explicit when imagery or inward focus destabilizes."
  ],
  "successSignals": [
    "Activation can rise and settle without flooding."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE1]]

[[current/sources/somatic-sequencing-guide/SOM.SE]]

[[current/sources/somatic-sequencing-guide/SOM.YOGA]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]
