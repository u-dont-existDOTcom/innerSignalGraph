---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ACT_OUTWARD
title: Act on the concrete problem
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - outward-action
  - protector
  - guide
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
regression_refs:
  - G013
  - G014
base_record_sha256: 33a99d0a8d97fdb5d00f63242ddee664bdf569e562398cc1b406ae37525d9731
base_graph_sha256: 484f0ab3b8f54b7921a6dfa7e7b8e3eec21cc6bbe4376a5c0af62a9521453f33
projection_input_sha256: 5186451f521009dc8acd45b07cfd20f476c4ecd588761bed3aaee625ef3e4129
---

# Act on the concrete problem

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "actionable_problem",
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
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ]
  },
  "avoid": [
    "Do not wait for complete emotional certainty before taking a reversible necessary action.",
    "Do not use action as a way to deny clearly unresolved inner material that continues to drive the problem."
  ],
  "defaultQuestion": "What is the next observable action that could actually change this situation?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not reduce every emotional problem to productivity or behavioral execution."
    ],
    "requiredNuance": [
      "A concrete problem and unresolved inner material can coexist; outward action goes first when the environment can actually be changed, while inward work may remain a parallel or later job."
    ]
  },
  "recommendations": [
    "Extract one concrete problem that can be changed and choose the next observable decision or action.",
    "When useful problem-solving is surrounded by rumination, act on the actionable piece and stop rerunning the remainder until genuinely new information arrives.",
    "Use Protector functions for boundaries and safety, and Guide or Leader functions for sequencing and practical follow-through, without requiring deeper introspection merely because action is emotionally charged."
  ],
  "successSignals": [
    "A decision, boundary, request, repair, plan, or other observable action changes the real situation.",
    "Thinking becomes shorter and more specific because it terminates in action or a defined wait for new information."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]
