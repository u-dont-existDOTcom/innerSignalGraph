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
  - AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015
regression_refs:
  - G011
base_record_sha256: 623c2ee97f1e430a481166ea70c50a1a8d96cb49834db78197e88b5098df1ab5
base_graph_sha256: 3e2065e68183f51361b42e6bc085172aa2467ff991d01ba765406a399aa7e3dc
projection_input_sha256: ec86a0744c16447d9adac460b8947d3cd3e34a24eeb48583c07da2f0bc04071c
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
    "requiredNuance": [
      "Hypnosis in general isn’t incompatible with grief, nor with an altered state: whether it fits depends on what kind of hypnosis, what level of grief, and what is appropriate at the moment.",
      "During grief, what matters most is the purpose: hypnosis to reach feelings someone can’t access, for example “my dad just died, but I can’t feel anything about it… can we do a little hypnosis so I can access my feelings better?”, can help; hypnosis to get away from or escape what they need to face is less beneficial."
    ]
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

[[current/governance/amendments/AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015]]
