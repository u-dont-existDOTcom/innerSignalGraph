---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: love-horizon-r1
operation: replace
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
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
base_record_sha256: 060cdaab7a4a4f9f86b1d663aa049b4320367165af4c0dcbb911de485173ba62
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
---

# Build sober capacity before using altered states to deepen

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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
    "Do not prescribe recreating a psychedelic, NDE-like, or other extraordinary breakthrough as the answer to hopelessness."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "A past altered-state opening may establish that a deeper wellbeing horizon was experienced, but it does not prove present access, child inclusion, or integration."
    ]
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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
