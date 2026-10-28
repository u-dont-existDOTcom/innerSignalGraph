---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_ACTION_LOCK
title: Delay consequential action during intense certainty or pressure
kind: decision-node
tier: 2
priority: 98
authority: author-framework
graph_tags:
  - altered-state
  - action-lock
  - grandiosity
  - epistemic
source_refs:
  - ALT.ACTION_LOCK
  - ALT.EPISTEMICS
regression_refs: []
base_record_sha256: 6e1fe6c566a71b48b57cd755141cc64fc2d11fa41f558b7505b3f90eeebf31fe
base_graph_sha256: ea0d2be564d26d2e2f98e937386c53a98e5846ef20b9a57da166be05a12c2e08
projection_input_sha256: 7825a41bfc9d387ae2ce534d2a779e41254241f9dfbe37c78b4fce092b8f210e
---

# Delay consequential action during intense certainty or pressure

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "altered_action_pressure",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not encourage driving, redosing, public posting, confrontation, accusation, confession, major purchases or gifts, sexual boundary changes, relationship endings, travel, or attempts to prove a revelation while judgment is altered."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "ROUTE.FRESH_GRIEF_FIRST"
    ],
    "forbiddenOverclaims": [
      "Do not say the revelation is false merely because action is being postponed; the claim remains open to sober review."
    ],
    "requiredNuance": [
      "Euphoric certainty can carry more behavioral risk than fear because the person may feel no need to ground."
    ]
  },
  "recommendations": [
    "Write consequential ideas down and postpone major or irreversible action until after sleep, food, and sober review with a grounded person.",
    "Treat visions, entities, apparent memories, cosmic conclusions, and mission-like certainty as experience-content before treating them as fact-content or commands.",
    "Keep non-harm and consent authoritative even when the experience feels blissful, sacred, urgent, or absolutely certain."
  ],
  "successSignals": [
    "The person preserves the insight for later review without converting urgency into an irreversible action."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.ACTION_LOCK]]

[[current/sources/altered-states-map-source/ALT.EPISTEMICS]]
