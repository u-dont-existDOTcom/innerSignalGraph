---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.BORROW_ONE_FUNCTION
title: Borrow one bounded adult function
kind: decision-node
tier: 3
priority: 94
authority: author-framework
graph_tags:
  - borrowed-adulthood
  - nurturer
  - protector
  - guide
  - adult-side-borrowing
source_refs:
  - IC.BORROW_ONE_FUNCTION
  - IC.ADULT_APPRENTICE
base_record_sha256: 11f21fa8d4679e259279acbf9a15ffb60035cacb540b19a8f539985730b106a2
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0f787fed212f0e7bf6a0201fd36f1c6f0b3f1189425f42a1db02e96ca90501a8
---

# Borrow one bounded adult function

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial",
          "unknown"
        ]
      },
      {
        "field": "parent_imagery",
        "op": "in",
        "value": [
          "critical",
          "frightening",
          "blank"
        ]
      },
      {
        "field": "self_directed_love",
        "op": "in",
        "value": [
          "unsafe",
          "inaccessible"
        ]
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
    "Do not demand an ideal parent image or let the helper become authority over memories, medicine, relationships, or future."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim the inner adult has already been built."
    ],
    "requiredNuance": [
      "Adult identity may form after behavior.",
      "Borrowed adulthood can support the part attempting the adult role, not only the younger state."
    ]
  },
  "recommendations": [
    "Borrow one narrow function—warmth, protection, or direction—from a safe person, figure, plan, value, or ordinary action.",
    "Keep it bounded, observable, and returnable.",
    "When the part attempting the adult role becomes resentful, defensive, or retaliatory, borrow one non-retaliatory adult response for that side too—for example, how a decent adult would hear contempt without arguing its own goodness."
  ],
  "successSignals": [
    "The person can perform one adult function without pretending the whole role is available."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
