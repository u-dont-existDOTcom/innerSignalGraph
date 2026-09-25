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
regression_refs: []
base_record_sha256: 8a071e808cccf40617f6391167665a7b5195a7b385460db49fed104cf2f12c70
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
projection_input_sha256: c9e563fdad998e15db8d98d0bbd7edc76cda90f0145459cc620ef5fcb869df78
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
    "Plan closure, food and hydration when safe, sleep, and protected integration time rather than leaving the session psychologically open-ended."
  ],
  "successSignals": [
    "The session has clear safety, consent, stopping, closure, and integration boundaries before altered-state work begins."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.PREPARATION]]
