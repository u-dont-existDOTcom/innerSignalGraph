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
  - G094
  - G097
  - G098
  - G099
  - G101
  - G103
  - G105
  - G106
base_record_sha256: 18763dcc2839b80e777c89163237f384df333a778f911ff19f28ccda4128d641
base_graph_sha256: 41158d742e786dffad816d431995d660dc20d9fcc31b8d8d8a1b92b01ad88913
projection_input_sha256: 3c78c83c806fb468e2f73ddb65219b21545242594b087b0cd9345d34057e71b3
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
