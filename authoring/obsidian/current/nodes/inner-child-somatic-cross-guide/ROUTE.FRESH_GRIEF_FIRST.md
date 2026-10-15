---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.FRESH_GRIEF_FIRST
title: After a fresh death or harm, let grief and support come first
kind: decision-node
tier: 1
priority: 90
authority: author-framework
graph_tags:
  - grief
  - loss
  - support
source_refs:
  - AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014
regression_refs:
  - G117
  - G122
  - G123
  - G124
base_record_sha256: 68905b7ecbaf2730df0dee225b8ab290d3b8051c352fbb57949b6f56151e33e0
base_graph_sha256: 759779ed630dc174f3f5106ad553c072cc6b6ac79478fb1ee750024e6e026989
projection_input_sha256: 2495b3017a645b940190c53f9ba2fa724b442ad014fc2e1846a912dd2cdeb1cc
---

# After a fresh death or harm, let grief and support come first

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "fresh_grief",
        "op": "eq",
        "value": "present"
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
      },
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      }
    ]
  },
  "avoid": [
    "Do not tell a grieving person to be grateful for the loss, that it happened for a reason, or that they should already be at peace."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.GRATITUDE_PRACTICE",
      "IC.DEEP_LOVE_TO_CHILD",
      "IC.GUARD_BEFORE_CHILD_LOVE",
      "IC.REALIZATION_LOVE_INTEGRATION",
      "IC.LOVE_HORIZON_EXPLORATION"
    ],
    "forbiddenOverclaims": [
      "Do not claim the loss happened for a reason or was meant to teach something."
    ],
    "requiredNuance": [
      "Fresh grief is not a problem to fix with gratitude; crying and support are the work."
    ]
  },
  "recommendations": [
    "After a fresh death or harm, don’t ask for gratitude, and never gratitude for the loss. Encourage crying, support from loved ones, and prayer if they pray.",
    "After a death, if it fits what the person believes, invite them to send love to the one who died; in the author’s view it can still be felt, and the one who died will be grateful for it. Don’t present that as fact to someone who doesn’t share it, and don’t speak of anyone dying when the loss or harm was something else.",
    "Gratitude can come in sideways, if at all: for the love itself, the time together, or the people helping now, offered lightly and never made the priority.",
    "After a harm, safety and practical help come before anything inward."
  ],
  "successSignals": [
    "The grief is allowed and shared, and the person feels less alone with it."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014]]
