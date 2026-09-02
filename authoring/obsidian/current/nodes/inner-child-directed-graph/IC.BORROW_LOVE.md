---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.BORROW_LOVE
title: Borrow love from an already-loved being
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
regression_refs:
  - G003
  - G005
  - G008
  - G011
base_record_sha256: f5bea4835b1f723233d7a5c49b1e0f9e9346a40c5a515f5c98cccbb8cdd70c8d
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: 2cd50da8bfdb8e3e7b08926f7d1b9eabc9cf854231c4fa59350f27a7bf684320
---

# Borrow love from an already-loved being

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
      "The problem may be safety of receiving love rather than absence of love."
    ]
  },
  "recommendations": [
    "First feel real love for a pet, baby, friend, child, partner, beauty, or another naturally loved presence.",
    "Do not force an immediate turn toward the self; offer only as much toward the younger state as feels possible."
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
