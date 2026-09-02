---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.BORROW_LOVE
title: Borrow already-accessible love without flattening its depth
kind: decision-node
tier: 4
priority: 92
authority: author-framework
graph_tags:
  - love
  - borrowed-adulthood
  - nurturer
source_refs:
  - IC.LOVE_MISSING
  - IC.HEART_SOLAR_LOOP
  - AMEND.IC.BORROW_LOVE_EXTERNAL
  - AMEND.IC.WELLBEING_HORIZON
regression_refs:
  - G003
  - G005
  - G008
  - G011
base_record_sha256: 671e2be3f1b5e2db155f668a0b222101179c83304e2a7a0d6207fadf23e136d9
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Borrow already-accessible love without flattening its depth

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "love_access",
        "op": "in",
        "value": [
          "accessible",
          "limited"
        ]
      }
    ],
    "any": [
      {
        "field": "self_directed_love",
        "op": "in",
        "value": [
          "unsafe",
          "inaccessible",
          "unknown"
        ]
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      }
    ]
  },
  "avoid": [
    "Do not manufacture warmth or make the loved being responsible for the session."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call reluctance proof that the child rejects love."
    ],
    "requiredNuance": [
      "The problem may be safety of receiving love rather than absence of love.",
      "Ordinary affection or care and profound transpersonal love are distinct resources; either may be therapeutically useful, and one must not be used to erase the distinction the user is making."
    ]
  },
  "recommendations": [
    "First feel real love for a pet, baby, friend, child, partner, beauty, or another naturally loved presence.",
    "Do not force an immediate turn toward the self; offer only as much toward the younger state as feels possible.",
    "Use ordinary affection or care as a real bridge when it is available, without claiming that it is equivalent to profound spiritual or transpersonal love."
  ],
  "successSignals": [
    "The capacity for love becomes experientially available without coercion."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.LOVE_MISSING]]

[[current/sources/inner-child-guide/IC.HEART_SOLAR_LOOP]]

[[current/governance/amendments/AMEND.IC.BORROW_LOVE_EXTERNAL]]

[[current/governance/amendments/AMEND.IC.WELLBEING_HORIZON]]
