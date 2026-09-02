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
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
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
