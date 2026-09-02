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
base_graph_sha256: 55b079263bc6ced7c1cf9b1ed3d1a786fa0b191dde1ad700485294ac72804c92
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
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
