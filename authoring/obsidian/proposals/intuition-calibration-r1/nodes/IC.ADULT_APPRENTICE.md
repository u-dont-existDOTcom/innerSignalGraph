---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
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
base_record_sha256: 4d9a03f5d84e4c1b5513ae0388739069f893801344a16925bbbf9cb6a5124cfa
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Move from receiving care to doing five percent

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {"field": "inner_adult_access", "op": "in", "value": ["low", "partial"]},
      {"field": "support_available", "op": "eq", "value": "present"}
    ],
    "none": [
      {"field": "present_safety", "op": "eq", "value": "unsafe"},
      {"field": "orientation", "op": "eq", "value": "disoriented"}
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
    "Gradually hand the role and the judgment behind it back to the user: they should become more able to check, disagree, revise, and act without the helper."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present, and the person can evaluate the helper without needing the helper’s permission."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Authority dependency can survive even when the user starts performing the borrowed behavior. Apprenticeship is complete only when epistemic authority is also returning.

## Regression intent

G027 and G032 distinguish genuine borrowing from authority transfer that weakens independent checking.
