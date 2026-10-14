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
base_graph_sha256: 75b1dc74386153edfa674a1b5ec6d47c3b7cc67ea4ca1202217aee8704c31e48
projection_input_sha256: 0d893b3532d45f09cc07b6f0a3417e031d6a0f04d0e424edaece106c3bf5fcc9
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
