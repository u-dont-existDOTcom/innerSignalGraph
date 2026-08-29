---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.ALTERED_STATE_GATE
title: Build sober capacity before using altered states to deepen
kind: decision-node
tier: 2
priority: 89
authority: author-framework
graph_tags:
  - altered-state
  - gate
  - epistemic
source_refs:
  - IC.ALTERED_STATES
  - IC.ESCAPE_URGE
regression_refs:
  - G009
base_record_sha256: 060cdaab7a4a4f9f86b1d663aa049b4320367165af4c0dcbb911de485173ba62
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: e4e31e4dded7f0ec1f824717e405289f76163ca88db84795b2b1ceda149c7378
---

# Build sober capacity before using altered states to deepen

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
    "Do not treat entheogenic or hypnotic material as recovered fact or use altered intensity as proof of healing."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Prefer sober Nurturer and Protector capacity first or grounded support that does not seize authority.",
    "Return to ordinary orientation when the state outruns the ability to hold what appears."
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
