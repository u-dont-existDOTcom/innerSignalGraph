---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_PREPARATION
title: Give planned altered-state work a beginning, support plan, and ending
kind: decision-node
tier: 3
priority: 97
authority: author-framework
graph_tags:
  - altered-state
  - preparation
  - consent
  - closure
source_refs:
  - ALT.PREPARATION
  - AMEND.CROSS.STATE_DEPENDENT_TRANSFER
regression_refs:
  - G048
base_record_sha256: c86d2d6552ea03210dc24eda0ab469ec561c0c37467bf0498fa642f7835f4fa5
base_graph_sha256: 09fcd58a61e13de924524b56a428337b92056447695e679b980b90dca2a35d55
projection_input_sha256: 8d617820e7bd9b59137c81fa8c7239a7c4995a62bc5c51265e60b22d98103437
---

# Give planned altered-state work a beginning, support plan, and ending

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_phase",
        "op": "eq",
        "value": "planned"
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
    "Do not use ceremony planning once an acute crisis has started; return to acute triage instead.",
    "Do not make a sitter, playlist, spiritual frame, or expected insight into an authority the person cannot stop or change."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Plan rest and timing, physical safety, environment, support, and what would require outside help before the session begins.",
    "Use intention without demanding a particular revelation, memory, emotional arc, or spiritual result; support stays low-directivity and consent-based.",
    "Plan closure, food and hydration when safe, sleep, and protected integration time rather than leaving the session psychologically open-ended.",
    "Familiarize the person soberly with any relevant inner-child, guard, Nurturer, Protector, or Guide map and practice at least one small adult function, so newly accessible material has somewhere to land without requiring belief in advance.",
    "Choose a simple way to preserve what becomes newly real or accessible and name what useful sober carryover would look like afterward; this is a container for whatever happens, not a demand for a breakthrough."
  ],
  "successSignals": [
    "The session has clear safety, consent, stopping, closure, and integration boundaries before altered-state work begins."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.PREPARATION]]

[[current/governance/amendments/AMEND.CROSS.STATE_DEPENDENT_TRANSFER]]
