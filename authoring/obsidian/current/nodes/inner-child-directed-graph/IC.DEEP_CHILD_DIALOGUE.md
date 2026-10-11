---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.DEEP_CHILD_DIALOGUE
title: Enter deeper child dialogue only when capacity is adequate
kind: decision-node
tier: 6
priority: 70
authority: author-framework
graph_tags:
  - deep-work
  - child-dialogue
  - memory
source_refs:
  - IC.BEFORE_DEEP
  - IC.ALTERED_STATES
  - AMEND.SOM.EARLY_INNER_CHILD_PARALLEL
  - AMEND.IC.EMOTIONAL_TASK_GUIDANCE
  - IC.BORROW_ONE_FUNCTION
  - IC.BORROW_LOVE
  - IC.SPIRITUAL_LOAN
  - AMEND.IC.PRACTICE_TO_LIFE_TRANSFER
regression_refs:
  - G004
  - G005
  - G011
  - G029
  - G030
  - G063
  - G068
  - G069
  - G074
  - G087
  - G088
  - G089
base_record_sha256: 05bc189c5fc4093686eadbd62425b537fa844cc73b3d063ce66fa45af3cb9d26
base_graph_sha256: 2dbd3b3481a9dfef47b6259ade2306e453b40983020854f05beff9378fc6946f
projection_input_sha256: ec4a7909c2fb0e5bdc4aa78ebedf02685d9b97bd54a9f494331f7d3d0048166d
---

# Enter deeper child dialogue only when capacity is adequate

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
          "deep_dialogue",
          "memory_processing",
          "hypnosis"
        ]
      },
      {
        "field": "deep_work_readiness",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not interrogate imagery or imply emotional truth proves historical fact.",
    "Do not let generic deep-work readiness, an accepted task, a remembered loving state, or correct-sounding adult words bypass a known missing caring/protective preparation."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "General orientation and stop/return capacity establish safety readiness, not the positive caring adult function needed for this relational exercise.",
      "Partial but usable positive care/protection can be enough for a bounded step; unknown access is uncertainty to clarify, not a permanent incapacity finding.",
      "Completing preparation permits reconsideration of the deeper step under current gates; it does not prove that the child has received the care.",
      "A successful inner exercise and ordinary-life transfer are separate evidence states; when the practice works but carryover does not, deepen only after the transfer mismatch has been addressed or new unresolved material actually warrants it."
    ]
  },
  "recommendations": [
    "Use deeper dialogue only when the person can remain present, stop voluntarily, and recover afterward.",
    "Keep memory-source distinctions explicit.",
    "Follow the current emotional task, not a generic demand to go deeper: clarify an unclear feeling, respond to self-treatment, hear an unmet need, or offer care according to the reported marker. Notice partial change and check fit before progressing; do not restart the same exercise after a meaningful shift.",
    "When the needed positive caring/protective function is known to be unavailable, use IC.BORROW_ONE_FUNCTION as adult-side preparation before deeper child-facing dialogue.",
    "Once that function is demonstrably usable and current safety, permission, and readiness still allow the work, resume the live care/reception task rather than restarting the whole bootstrap.",
    "When the adult function is already clearly usable in-session but ordinary-life transfer is still session-only, hand off to IC.PRACTICE_TO_LIFE_TRANSFER before repeating or deepening the child-facing exercise for more intensity."
  ],
  "successSignals": [
    "The session increases capacity and functioning rather than compulsion or disorientation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.ALTERED_STATES]]

[[current/governance/amendments/AMEND.SOM.EARLY_INNER_CHILD_PARALLEL]]

[[current/governance/amendments/AMEND.IC.EMOTIONAL_TASK_GUIDANCE]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/sources/inner-child-guide/IC.BORROW_LOVE]]

[[current/sources/inner-child-guide/IC.SPIRITUAL_LOAN]]

[[current/governance/amendments/AMEND.IC.PRACTICE_TO_LIFE_TRANSFER]]
