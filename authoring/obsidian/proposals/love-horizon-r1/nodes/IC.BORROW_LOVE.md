---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: love-horizon-r1
operation: replace
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
base_record_sha256: f5bea4835b1f723233d7a5c49b1e0f9e9346a40c5a515f5c98cccbb8cdd70c8d
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: a7aeada0a9fa9fd791ae52f7e25dd7e6b7ea855bdfda56a37f438f07d7f6a3f5
---

# Borrow already-accessible love without flattening its depth

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
