---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.FRESH_GRIEF_FIRST
title: After a fresh death or harm, let grief and support come first
kind: decision-node
tier: 3
priority: 97
authority: author-framework
graph_tags:
  - grief
  - loss
  - support
source_refs:
  - AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014
regression_refs:
  - G117
base_record_sha256: 6e3bd39cf7a0ce267c6ad928d684b07cde89d8014c80fd8818bede749127e0a3
base_graph_sha256: 39c850d6cdd5645a37a2bf85db327a0cdc58f37156821809d5910ddafbe412a0
projection_input_sha256: c90efbba47c2fc6e3fb90f764d20fa64f7c5660cdf4f274500fdfa47ee92c63f
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
      }
    ]
  },
  "avoid": [
    "Do not tell a grieving person to be grateful for the loss, that it happened for a reason, or that they should already be at peace."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim the loss happened for a reason or was meant to teach something."
    ],
    "requiredNuance": [
      "Fresh grief is not a problem to fix with gratitude; crying and support are the work."
    ]
  },
  "recommendations": [
    "After a fresh death or harm, don’t ask for gratitude, and never gratitude for the loss. Encourage crying, support from loved ones, and prayer if they pray.",
    "If it fits what the person believes, invite them to send love to the one who died; in the author’s view it can still be felt, and the one who died will be grateful for it. Don’t present that as fact to someone who doesn’t share it.",
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
