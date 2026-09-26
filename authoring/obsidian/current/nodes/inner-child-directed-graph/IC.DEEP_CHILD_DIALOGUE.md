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
regression_refs:
  - G004
  - G005
  - G011
  - G029
  - G030
base_record_sha256: 08a74bafc5433b5fe2ca3c120c5f410ceac4f6b6acd22979b669a96f432a4055
base_graph_sha256: 779b3f5d7b6098cdfa10243aa5d32caac60d988fa8394a0e35917a1ee289c369
projection_input_sha256: f92fac6d9a09658ed5bdf982583a7f102b5005e9145db5db141020e10a873b87
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
      "Completing preparation permits reconsideration of the deeper step under current gates; it does not prove that the child has received the care."
    ]
  },
  "recommendations": [
    "Use deeper dialogue only when the person can remain present, stop voluntarily, and recover afterward.",
    "Keep memory-source distinctions explicit.",
    "Follow the current emotional task, not a generic demand to go deeper: clarify an unclear feeling, respond to self-treatment, hear an unmet need, or offer care according to the reported marker. Notice partial change and check fit before progressing; do not restart the same exercise after a meaningful shift.",
    "When the needed positive caring/protective function is known to be unavailable, use IC.BORROW_ONE_FUNCTION as adult-side preparation before deeper child-facing dialogue.",
    "Once that function is demonstrably usable and current safety, permission, and readiness still allow the work, resume the live care/reception task rather than restarting the whole bootstrap."
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
