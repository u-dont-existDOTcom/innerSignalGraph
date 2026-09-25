---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: reparenting-strategy-refinement-20260925
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.ADULT_APPRENTICE
title: Move from receiving care to doing five percent
kind: decision-node
tier: 4
priority: 86
authority: author-framework
graph_tags:
  - adult-apprentice
  - five-percent
  - relationship
source_refs:
  - IC.ADULT_APPRENTICE
  - IC.RELATIONSHIP
  - AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.EMOTIONAL_TASK_GUIDANCE
  - IC.BORROW_ADULT
  - IC.BORROW_ONE_FUNCTION
  - IC.SPIRITUAL_LOAN
base_record_sha256: e7fcbbd83cbe5878a3d032e7ebeb3f5ee8d04197c4f5c16ec4c663690bde4eac
base_graph_sha256: 2f31316bacb025352fbd0e2440aaa6607f50f2fc7cb38bc95263fbd807a3459f
base_projection_input_sha256: 3416b1a51d2353e79b8e58a241e8f768c7c3f21e7fd99ffc5b3c500199d9ae0f
---

# Move from receiving care to doing five percent

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "support_available",
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
    "Do not create permanent practical or epistemic authority dependency."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "The helper hands back judgment as well as behavior; successful apprenticeship should make independent checking easier rather than making the helper harder to question.",
      "Receiving support is not the endpoint: the sequence is receive care, observe care, participate in care, initiate a small part, and internalize what proves usable.",
      "The adult function can become real through ordinary action before it feels like a stable identity."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role and the judgment behind it back to the person so they become more able to check, disagree, revise, and act without the helper.",
    "Name what capacity the person exercised, what help remained useful, and what the real-world attempt taught them; independence does not require refusing appropriate support. Care includes interest and delight, not duty alone, and should support exploration outside the exercise.",
    "Carry the borrowed function into one ordinary-life act that the person initiates, then review what it actually contributed rather than treating completion alone as success.",
    "Keep outside support available when useful while returning authorship, judgment, disagreement, and revision to the person."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present, and the person can evaluate the helper without needing the helper’s permission.",
    "The person can initiate a small caring/protective act and evaluate whether it helped without handing the helper permanent authority."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Make the hand-back sequence operational so borrowed care becomes the person’s own bounded action and judgment rather than a permanent helper dependency. The worst failure would be successful support increasing authority dependence instead of agency.

## Regression intent

R07/R12/R13: support is internalized through participation/action, current completion is reused, and the next task does not restart preparation.
