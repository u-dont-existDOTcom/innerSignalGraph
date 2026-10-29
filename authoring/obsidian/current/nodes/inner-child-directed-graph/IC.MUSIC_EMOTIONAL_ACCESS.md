---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.MUSIC_EMOTIONAL_ACCESS
title: Use familiar music as an optional emotional-access doorway
kind: decision-node
tier: 4
priority: 80
authority: owner-approved-extension
graph_tags:
  - state-access
  - music
  - emotion-access
  - nurturer
  - path-performance-moderator
source_refs:
  - AMEND.IC.MUSIC_EMOTIONAL_ACCESS
  - IC.BORROW_LOVE
  - IC.BORROW_ONE_FUNCTION
  - IC.LOVE_MISSING
  - AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015
regression_refs:
  - G128
  - G130
  - G134
base_record_sha256: b3d453b8a855f668409b1d8b210130ca5abeb0ad04ec5ba4ad2dd702857236ff
base_graph_sha256: 3e2065e68183f51361b42e6bc085172aa2467ff991d01ba765406a399aa7e3dc
projection_input_sha256: e49163f827f1ac7ce00bd516b36b6d05402cf234de9d0000fc5d02db6458402d
---

# Use familiar music as an optional emotional-access doorway

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "current_intent",
        "op": "in",
        "value": [
          "conversation",
          "gentle_practice",
          "deep_dialogue",
          "memory_processing",
          "integration"
        ]
      }
    ],
    "any": [
      {
        "field": "music_emotional_access",
        "op": "eq",
        "value": "helpful"
      },
      {
        "field": "love_access",
        "op": "in",
        "value": [
          "limited",
          "absent"
        ]
      },
      {
        "field": "self_directed_love",
        "op": "in",
        "value": [
          "unsafe",
          "inaccessible"
        ]
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      }
    ],
    "none": [
      {
        "field": "music_emotional_access",
        "op": "in",
        "value": [
          "neutral",
          "overwhelming",
          "declined"
        ]
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not prescribe unfamiliar music, infer taste, or select a song from diagnosis, demographics, spirituality, or presumed personality.",
    "Do not treat crying, chills, a rush of energy, vivid memory, or emotional intensity as proof of processing, memory accuracy, causal insight, integration, or durable change.",
    "Do not use music to bypass an active guard, a known missing caring/protective function, refusal, or an existing safety gate."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call a dramatic music-evoked state evidence that the underlying issue has been processed or that the active therapy caused the opening."
    ],
    "requiredNuance": [
      "Music is an optional access cue and session-context moderator, not a standalone explanation of outcome.",
      "Path Performance may count newly accessible emotion or need as proximal movement only when tied to a new observation; durable improvement still requires later evidence at the declared horizon.",
      "If the response becomes overwhelming, panicky, dissociative, disorienting, or difficult to stop, stop or reduce the cue and let the existing orientation/stabilization route take precedence.",
      "During grief, music can help someone reach feelings they can’t access, such as the tears for someone who died; music used to get away from what they need to face is less beneficial."
    ]
  },
  "recommendations": [
    "When emotional access is flat, effortful, overly intellectual, or inconsistent, ask whether music the person already knows has reliably helped them access this kind of feeling. If yes and they want to use it, treat that familiar music as a brief optional doorway before or during the existing practice.",
    "Once emotion, love, bodily feeling, memory, or a caring stance becomes more available, name what changed and continue through the existing relevant route rather than making the intensity itself the goal.",
    "For strategy review, keep intervention identity and context separate: same exercise versus different exercise, music present or absent, user-named track if supplied, state beforehand, immediate opening, and later carryover."
  ],
  "successSignals": [
    "A previously inaccessible relevant feeling, need, bodily sense, or caring function becomes more available while the person remains oriented and able to stop.",
    "The opening supports a concrete existing therapeutic task or later functional/durable movement rather than intensity alone."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.MUSIC_EMOTIONAL_ACCESS]]

[[current/sources/inner-child-guide/IC.BORROW_LOVE]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/sources/inner-child-guide/IC.LOVE_MISSING]]

[[current/governance/amendments/AMEND.IC.HYPNOSIS_GRIEF_ALTERED_20261015]]
