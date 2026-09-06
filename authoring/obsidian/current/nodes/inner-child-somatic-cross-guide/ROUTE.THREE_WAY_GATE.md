---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.THREE_WAY_GATE
title: Discriminate processing, action, and non-engagement
kind: decision-node
tier: 3
priority: 96
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - discrimination
  - stop-rule
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
regression_refs: []
base_record_sha256: 7acfc475d67770638b3c689f8308c37d114fd27876d708aded37f2aac8e59767
base_graph_sha256: 484f0ab3b8f54b7921a6dfa7e7b8e3eec21cc6bbe4376a5c0af62a9521453f33
projection_input_sha256: 5186451f521009dc8acd45b07cfd20f476c4ecd588761bed3aaee625ef3e4129
---

# Discriminate processing, action, and non-engagement

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "attention_loop",
        "op": "eq",
        "value": "present"
      }
    ],
    "any": [
      {
        "field": "thinking_yield",
        "op": "in",
        "value": [
          "mixed",
          "unknown"
        ]
      },
      {
        "field": "actionable_problem",
        "op": "eq",
        "value": "unknown"
      },
      {
        "field": "unresolved_inner_material",
        "op": "eq",
        "value": "unknown"
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
    "Do not assume repeated analysis is problem-solving merely because the topic is important.",
    "Do not label refusal to process as healthy non-engagement until concrete problems and clearly avoided material have been checked."
  ],
  "defaultQuestion": "Is this thinking giving you genuinely new information, a decision, or an action—or are we running the same computation again; and is there a concrete problem to act on or clearly avoided material to contact?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that one branch is universally superior to the others."
    ],
    "requiredNuance": [
      "The three movements can alternate over time; this is a routing decision for the current maintaining process, not a permanent personality classification."
    ]
  },
  "recommendations": [
    "Before prescribing another technique, discriminate whether the next useful movement is inward processing, outward action, or leaving a self-maintaining loop unanswered.",
    "Use output rather than intensity as the stop rule: useful thinking should yield new information, a decision, an action, or genuinely changed contact with previously avoided material."
  ],
  "successSignals": [
    "The case can be classified into one primary movement without forcing every difficulty into a therapy technique."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]
