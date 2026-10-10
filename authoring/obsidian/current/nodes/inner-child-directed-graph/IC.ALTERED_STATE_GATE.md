---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.ALTERED_STATE_GATE
title: Calibrate therapy depth during altered states instead of assuming incapacity
kind: decision-node
tier: 5
priority: 78
authority: author-framework
graph_tags:
  - altered-state
  - gate
  - epistemic
source_refs:
  - IC.ALTERED_STATES
  - IC.ESCAPE_URGE
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
  - ALT.CAPACITY
  - ALT.EPISTEMICS
  - ALT.GROUNDING
regression_refs:
  - G009
  - G048
  - G058
base_record_sha256: 84f40c052600da9cf481d6238222ec74541f7814b37ebe3f88ec2df167629c28
base_graph_sha256: 4848af3f8e7938ad315a9a1b3e138768cd2d6a5d9c67530b520de13963130a83
projection_input_sha256: 354f6bae4ead288dbc25d78ee4550d529bfe6f19adf4b9ae8ff180b53acfd44f
---

# Calibrate therapy depth during altered states instead of assuming incapacity

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "current_intent",
        "op": "eq",
        "value": "altered_state"
      }
    ]
  },
  "avoid": [
    "Do not treat entheogenic or hypnotic material as recovered fact or use altered intensity as proof of healing.",
    "Do not automatically end useful therapy or replace the user’s actual question with generic grounding merely because they disclose an altered state.",
    "Do not prescribe recreating a psychedelic, NDE-like, or other extraordinary breakthrough as the answer to hopelessness."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "A past altered-state opening may establish that a deeper wellbeing horizon was experienced, but it does not prove present access, child inclusion, or integration.",
      "A current altered state and a lack of habitual inner speech are unrelated dimensions; neither establishes that the person cannot reason, use language, or engage therapy."
    ]
  },
  "recommendations": [
    "Treat current altered state as a routing variable rather than an automatic stop: assess physical safety, orientation, capacity to communicate, stopping capacity, ordinary agency, and available support.",
    "When those capacities remain coherent and stable, continue substantive inner-child or relational work at a depth the person can actually hold; when they deteriorate, shift toward room/body/human/time stabilization.",
    "Prefer already-developed or borrowed Nurturer/Protector capacity for deeper altered-state work, and reduce depth rather than escalating intensity when the experience outruns that capacity."
  ],
  "successSignals": [
    "The person can stop, orient, and integrate without escalating use."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.ALTERED_STATES]]

[[current/sources/inner-child-guide/IC.ESCAPE_URGE]]

[[current/governance/amendments/AMEND.IC.EXISTENTIAL_LOVE_ROUTING]]

[[current/governance/amendments/AMEND.IC.WELLBEING_HORIZON]]

[[current/sources/altered-states-map-source/ALT.CAPACITY]]

[[current/sources/altered-states-map-source/ALT.EPISTEMICS]]

[[current/sources/altered-states-map-source/ALT.GROUNDING]]
