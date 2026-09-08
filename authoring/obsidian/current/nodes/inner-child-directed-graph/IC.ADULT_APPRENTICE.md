---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
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
regression_refs: []
base_record_sha256: e7fcbbd83cbe5878a3d032e7ebeb3f5ee8d04197c4f5c16ec4c663690bde4eac
base_graph_sha256: 8c8a59965c4ee3ffc9fd9dc835e9589808638bd346510a3b4d2c44ba31f3f968
projection_input_sha256: a8e29c1684b1ac74a0869570a8e57a4a164a02c35beee1e47d269d06eaaf68de
---

# Move from receiving care to doing five percent

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

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
      "The helper hands back judgment as well as behavior; successful apprenticeship should make independent checking easier rather than making the helper harder to question."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role and the judgment behind it back to the person so they become more able to check, disagree, revise, and act without the helper.",
    "Name what capacity the person exercised, what help remained useful, and what the real-world attempt taught them; independence does not require refusing appropriate support. Care includes interest and delight, not duty alone, and should support exploration outside the exercise."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present, and the person can evaluate the helper without needing the helper’s permission."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.RELATIONSHIP]]

[[current/governance/amendments/AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.EMOTIONAL_TASK_GUIDANCE]]
