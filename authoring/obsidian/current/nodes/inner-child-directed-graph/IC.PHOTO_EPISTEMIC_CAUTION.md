---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PHOTO_EPISTEMIC_CAUTION
title: Keep photograph and memory sources separate
kind: decision-node
tier: 2
priority: 92
authority: author-framework
graph_tags:
  - memory
  - epistemic
  - photo
source_refs:
  - IC.PHOTOS
regression_refs:
  - G009
base_record_sha256: 5ad1385cc14179e45510b42b6a5982e8ffd2f6c3bd32d4350274a528f2da8ad6
base_graph_sha256: a757a341d88d71f3f5a1ede615e16e0746b86c0b002a35585bc7fa1feb8628e1
projection_input_sha256: 1af4fa8d1b56af3ee7d4dfce8cac182006477e75f5d39960c5535b7223b5b58a
---

# Keep photograph and memory sources separate

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "memory_source_risk",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "photo_work"
      }
    ]
  },
  "avoid": [
    "Do not ask what abuse must have happened or accuse someone from material generated in the practice."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Separate direct memory, report from another person, inference, dream, image, metaphor, altered-state impression, and uncertainty.",
    "Stop if the practice produces compulsive certainty or dysregulation."
  ],
  "successSignals": [
    "Emotional meaning can be used without converting uncertain material into historical fact."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.PHOTOS]]
