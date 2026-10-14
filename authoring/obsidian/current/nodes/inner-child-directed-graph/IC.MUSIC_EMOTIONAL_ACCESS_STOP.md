---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.MUSIC_EMOTIONAL_ACCESS_STOP
title: Stop music when it overwhelms rather than opens
kind: decision-node
tier: 2
priority: 99
authority: owner-approved-extension
graph_tags:
  - state-access
  - music
  - safety
  - orientation
source_refs:
  - AMEND.IC.MUSIC_EMOTIONAL_ACCESS
  - IC.BEFORE_DEEP
  - IC.REGULATION_BEFORE_DIALOGUE
regression_refs: []
base_record_sha256: e3adc01d9a27eea439e7ac857c07f473b8cd79a11d7201869780d8f82e322c09
base_graph_sha256: 3b294038b2cb13818489ef5fd3a9e350c3f1778dd0fa95d1443c810d791f1ba8
projection_input_sha256: d1b29964a064664d20ef683f1507064fe461e9e8f8c37d082a75698f47ae2ed3
---

# Stop music when it overwhelms rather than opens

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "music_emotional_access",
        "op": "eq",
        "value": "overwhelming"
      }
    ]
  },
  "avoid": [
    "Do not interpret overwhelm as evidence that the music has reached the correct trauma, memory, or healing depth.",
    "Do not intensify volume, repetition, imagery, or emotional exposure to force a breakthrough."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [
      "IC.MUSIC_EMOTIONAL_ACCESS"
    ],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call overwhelm therapeutic progress or recovered memory evidence."
    ],
    "requiredNuance": [
      "Music-specific overload does not replace the broader safety gate; present danger, disorientation, or inability to stop still outrank this node."
    ]
  },
  "recommendations": [
    "Turn the music down or off and return attention to the ordinary room, body, time, and voluntary choice rather than trying to push through the reaction.",
    "If orientation, stopping capacity, or ordinary functioning is also impaired, use the existing safety/orientation route instead of deeper symbolic or child-facing work."
  ],
  "successSignals": [
    "The person can stop the cue, reorient, and return to ordinary voluntary choice."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.MUSIC_EMOTIONAL_ACCESS]]

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.REGULATION_BEFORE_DIALOGUE]]
