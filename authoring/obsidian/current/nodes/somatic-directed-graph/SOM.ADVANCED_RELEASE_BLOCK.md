---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.ADVANCED_RELEASE_BLOCK
title: Block advanced release when physical or regulatory safety is not established
kind: decision-node
tier: 1
priority: 98
authority: author-framework
graph_tags:
  - advanced-release
  - safety
  - block
source_refs:
  - SOM.ADVANCED_RELEASE_SOURCE
  - VAGAL.SAFETY.P5
  - AMEND.SOM.ADVANCED_RELEASE_PARALLEL
regression_refs:
  - G007
base_record_sha256: 486ab6a78444f3d7dd853015cdf577b26cfe701b0d9a293b8b06f5f2c6669518
base_graph_sha256: 5f2387789deec1cc04e6d7ff0f1a66b455472b1dccdf6cb3cb5afc0707ba47fc
projection_input_sha256: d807775fcdfe2d3cd1ab0a040505f4c1e14aba98e39945a00dffa26a60306034
---

# Block advanced release when physical or regulatory safety is not established

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "advanced_release_interest",
        "op": "eq",
        "value": "present"
      }
    ],
    "any": [
      {
        "field": "stable_for_advanced_release",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "advanced_release_physical_risk",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "panic_instability",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      }
    ]
  },
  "avoid": [
    "Do not coach syncope, prolonged forceful breath holds, standing lightheadedness, or substance potentiation."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use gentler regulation instead and reassess only after physical and psychological safety are established."
  ],
  "successSignals": [
    "No advanced-release attempt occurs under unstable conditions."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.ADVANCED_RELEASE_SOURCE]]

[[current/sources/vagal-blitz-source/VAGAL.SAFETY.P5]]

[[current/governance/amendments/AMEND.SOM.ADVANCED_RELEASE_PARALLEL]]
