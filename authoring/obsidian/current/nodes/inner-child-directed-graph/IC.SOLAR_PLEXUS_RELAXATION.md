---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SOLAR_PLEXUS_RELAXATION
title: Relax solar-plexus or abdominal holding before dialogue
kind: decision-node
tier: 3
priority: 90
authority: author-framework
graph_tags:
  - regulation
  - solar-plexus
  - love-access
source_refs:
  - IC.REGULATION_BEFORE_DIALOGUE
  - IC.HEART_SOLAR_LOOP
  - AMEND.SOM.PREP_MODALITIES
regression_refs:
  - G002
  - G003
base_record_sha256: 18763dcc2839b80e777c89163237f384df333a778f911ff19f28ccda4128d641
base_graph_sha256: 9330ed7fd7270f9419b45347fa95652332eeb8d4d59a473fc9d623a66e45cc2a
projection_input_sha256: 8851becb30c4bd6b8aaffac6a7f0d4aa4bec0332ed1d4fc91b7146fdff438765
---

# Relax solar-plexus or abdominal holding before dialogue

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "solar_plexus_tension",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
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
    "Do not force breath, chase intensity, or assume tension proves a hidden memory."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that energy has definitively moved or trauma has been released."
    ],
    "requiredNuance": [
      "Relaxation may remove a bodily barrier but does not by itself repair credibility or resolve relational conflict."
    ]
  },
  "recommendations": [
    "Use non-forced longer exhales, gentle self-massage, or another low-dose somatic method to reduce holding around the solar plexus or abdomen.",
    "Treat softening as an opening for love or presence, not an order to enter memories."
  ],
  "successSignals": [
    "The body softens without air hunger, flooding, or loss of orientation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.REGULATION_BEFORE_DIALOGUE]]

[[current/sources/inner-child-guide/IC.HEART_SOLAR_LOOP]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]
