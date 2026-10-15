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
regression_refs:
  - G128
  - G130
base_record_sha256: 3e72824a5116da28b5a6cd8a2bba252ccfac86837a6c0fae0adb0f32a5565a49
base_graph_sha256: f795edce55cf0df641adcdbc643b69d70a764687fa4bad13c46548b6b12d339c
projection_input_sha256: eb34789685440c90c630eb98a9021bae082c5b5f6b2b6f0fb55499246d8b4e72
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
    "deferNodes": [
      "ROUTE.GRATITUDE_PRACTICE"
    ],
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
