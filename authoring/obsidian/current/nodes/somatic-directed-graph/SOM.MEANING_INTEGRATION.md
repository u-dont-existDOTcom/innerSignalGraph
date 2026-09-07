---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.MEANING_INTEGRATION
title: Meaning-making after the body is less trapped in survival mode
kind: decision-node
tier: 7
priority: 58
authority: author-framework
graph_tags:
  - integration
  - meaning
  - CBT
source_refs:
  - SOM.PHASE5
  - SOM.INTEGRATION
  - SOM.JUDGE_HELP
regression_refs:
  - G010
base_record_sha256: c4d28d1685a405c1293aa34e0d62198c6855a73e9ed2756cea2dd30d1e986341
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
projection_input_sha256: 9499803d7373c2217bf3f59035cf680e8b679dbf7281c7db14797be0b132a557
---

# Meaning-making after the body is less trapped in survival mode

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "current_intent",
        "op": "eq",
        "value": "integration"
      },
      {
        "field": "guide_readiness",
        "op": "eq",
        "value": "present"
      }
    ],
    "none": [
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      }
    ]
  },
  "avoid": [
    "Do not try to think the body out of an active survival state."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use light cognitive or narrative work for beliefs, values, boundaries, agency, and a coherent life story."
  ],
  "successSignals": [
    "Meaning-making improves life participation rather than becoming another processing project."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE5]]

[[current/sources/somatic-sequencing-guide/SOM.INTEGRATION]]

[[current/sources/somatic-sequencing-guide/SOM.JUDGE_HELP]]
