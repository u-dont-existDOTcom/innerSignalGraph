---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: reparenting-strategy-refinement-20260925
operation: replace
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
base_record_sha256: a662fd97fb51466ad7494c1b42e913df7a0663728a1edc7768fbc3b69c9053a6
base_graph_sha256: 2f31316bacb025352fbd0e2440aaa6607f50f2fc7cb38bc95263fbd807a3459f
base_projection_input_sha256: 3416b1a51d2353e79b8e58a241e8f768c7c3f21e7fd99ffc5b3c500199d9ae0f
---

# Enter deeper child dialogue only when capacity is adequate

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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

## Proposal rationale

Add the inner-child-specific positive-care preparation distinction without changing general somatic deep-work safety. The worst failure would be generic readiness or an accepted task bypassing known missing care; the opposite failure would be blocking partial usable capacity indefinitely.

## Regression intent

R04/R11/R12/R16: adequate current care can continue; known missing caring function cannot be waived by generic readiness; conditional progression is allowed; child-contact restrictions still override loving/spiritual phrasing.
