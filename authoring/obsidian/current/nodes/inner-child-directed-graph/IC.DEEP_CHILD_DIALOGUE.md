---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.DEEP_CHILD_DIALOGUE
title: Enter deeper child dialogue only when capacity is adequate
kind: decision-node
tier: 6
priority: 70
authority: author-framework
graph_tags:
  - deep-work
  - child-dialogue
  - memory
source_refs:
  - IC.BEFORE_DEEP
  - IC.ALTERED_STATES
  - AMEND.SOM.EARLY_INNER_CHILD_PARALLEL
regression_refs:
  - G004
  - G005
  - G011
base_record_sha256: 65f073956ce75cccc4bc04cbd999d6b8752126eb8848c44dfb9e0b84f78ffd6c
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: a7aeada0a9fa9fd791ae52f7e25dd7e6b7ea855bdfda56a37f438f07d7f6a3f5
---

# Enter deeper child dialogue only when capacity is adequate

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "current_intent",
        "op": "in",
        "value": [
          "deep_dialogue",
          "memory_processing",
          "hypnosis"
        ]
      },
      {
        "field": "deep_work_readiness",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not interrogate imagery or imply emotional truth proves historical fact."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Use deeper dialogue only when the person can remain present, stop voluntarily, and recover afterward.",
    "Keep memory-source distinctions explicit."
  ],
  "successSignals": [
    "The session increases capacity and functioning rather than compulsion or disorientation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.ALTERED_STATES]]

[[current/governance/amendments/AMEND.SOM.EARLY_INNER_CHILD_PARALLEL]]
