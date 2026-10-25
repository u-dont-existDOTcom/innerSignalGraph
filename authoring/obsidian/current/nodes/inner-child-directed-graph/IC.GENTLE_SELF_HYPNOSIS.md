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
base_graph_sha256: 5bdb1c4ec6bd08f6edbfcccc5c2737bfe9a1e79a5b3399bb69f30cad3951393c
projection_input_sha256: 9ad70adf3fb81a8234b228cee8c581023cd53771e45a04e551155f54f4f9083c
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
