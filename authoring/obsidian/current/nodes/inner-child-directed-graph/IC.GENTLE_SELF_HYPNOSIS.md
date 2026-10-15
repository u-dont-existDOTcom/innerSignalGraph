---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.GENTLE_SELF_HYPNOSIS
title: Use gentle present-focused self-hypnosis only as preparation
kind: decision-node
tier: 4
priority: 76
authority: author-framework
graph_tags:
  - hypnosis
  - gentle
  - preparation
source_refs:
  - IC.ESCAPE_URGE
  - AMEND.IC.EARLY_GENTLE_HYPNOSIS
regression_refs:
  - G011
base_record_sha256: c3ff9bb3dc6faa4b3f0b673403aa4d16ea3ccb6256fd9e54ccf2cc79d362aa8b
base_graph_sha256: 753548520b3d009a9d46a23b411d08b003b50a8e6e485e9487f9a1e3b4345f28
projection_input_sha256: c19c958d0e00a03c87c9a33a407e97730c9e4606220bfadccbc7725d6376ae3c
---

# Use gentle present-focused self-hypnosis only as preparation

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
          "gentle_practice",
          "hypnosis"
        ]
      },
      {
        "field": "deep_work_readiness",
        "op": "notIn",
        "value": [
          "yes"
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
    "Do not enter memories, immersive child dialogue, or suggestive origin stories."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Keep the practice present-focused: calming, warmth, non-cruelty, borrowed adulthood, or a simple Protector rehearsal."
  ],
  "successSignals": [
    "The person remains oriented, can stop, and returns to ordinary functioning."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.ESCAPE_URGE]]

[[current/governance/amendments/AMEND.IC.EARLY_GENTLE_HYPNOSIS]]
