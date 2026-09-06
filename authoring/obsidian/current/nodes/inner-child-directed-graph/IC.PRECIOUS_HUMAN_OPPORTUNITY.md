---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PRECIOUS_HUMAN_OPPORTUNITY
title: Treat human birth as a precious opportunity before discarding it
kind: decision-node
tier: 1
priority: 98
authority: author-framework
graph_tags:
  - suicide-prevention
  - precious-human-birth
  - rebirth
  - existential
  - buddhist-reality-check
source_refs:
  - AMEND.IC.SUICIDAL_PRECIOUS_HUMAN_OPPORTUNITY
  - AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY
  - ASSET.IC.SUICIDE.COSMIC_JACKPOT
regression_refs: []
base_record_sha256: 71691ff9bb1f8c2c0b35f1cc4a17f42fc03a1dcaa146debbb0590dbebe3e8ad2
base_graph_sha256: 55b079263bc6ced7c1cf9b1ed3d1a786fa0b191dde1ad700485294ac72804c92
projection_input_sha256: c5c4aed6b8851992ca36c580a60360aeef78931bfaf972429487e3d3143f8084
---

# Treat human birth as a precious opportunity before discarding it

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ],
    "any": [
      {
        "field": "witness_capacity",
        "op": "in",
        "value": [
          "present",
          "partial"
        ]
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "partial",
          "available"
        ]
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
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "identity_blur",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not reduce the message to 'life might possibly be worthwhile' when the Buddhist claim being presented is that human birth is an extraordinarily rare and precious opportunity.",
    "Do not shame the person, claim punitive divine certainty, guarantee an individual postmortem destination, or invent odds for hell, heaven, nothingness, rebirth, or liberation.",
    "Do not prescribe an NDE, psychedelic experience, dangerous ordeal, or solitary spiritual practice instead of urgent human protection when immediate safety deteriorates."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.EXISTENTIAL_NOURISHMENT",
      "IC.LOVE_HORIZON_EXPLORATION"
    ],
    "forbiddenOverclaims": [
      "Do not claim empirical certainty about this individual’s postmortem destination.",
      "Do not require pre-existing spiritual curiosity before presenting the precious-human-birth reality check."
    ],
    "requiredNuance": [
      "Once a suicidal person is safe and differentiated enough to reflect, the precious-human-opportunity reality check applies regardless of prior spiritual curiosity.",
      "The Buddhist claim is stronger than mere possible worth: human birth is an extraordinarily rare opportunity to investigate dukkha, cultivate wisdom and love, and attain liberation.",
      "Fear can carry information about danger. Do not suppress a relevant Buddhist warning about rebirth, hellish states, or severe postmortem suffering merely because the warning may be frightening; keep uncertainty and provenance explicit.",
      "Within life, deliberate self-harm and repeated self-destructive cognition cause harm and can reinforce a destructive trajectory; Buddhism additionally teaches that intentional causal momentum can continue through death and rebirth."
    ]
  },
  "recommendations": [
    "Give the reality check plainly: in Buddhist teaching, a human birth is extraordinarily rare and precious—a high-leverage opportunity to understand dukkha, deepen wisdom and love, and pursue liberation before discarding the conditions that make that investigation possible.",
    "Use the blind-turtle-and-yoke or cosmic-jackpot analogy when helpful: the person need not accept the doctrine, but should understand the magnitude of the opportunity Buddhism says is presently in hand before making an irreversible decision.",
    "Present hell, rebirth, and severe postmortem suffering as serious Buddhist possibilities to investigate rather than as fabricated probabilities; the purpose of the warning is to challenge the assumption that bodily death is a safe off-switch.",
    "Keep the human body and social world available while investigating: sensory reality, other people, practice, learning, repair, and reversible life changes all remain possible redirections while alive."
  ],
  "successSignals": [
    "The person can recognize that suicide may discard an exceptionally valuable investigative opportunity, can hold uncertainty about what death does, and is willing to preserve the human platform while investigating further."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SUICIDAL_PRECIOUS_HUMAN_OPPORTUNITY]]

[[current/governance/amendments/AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY]]

[[current/sources/semantic-assets/ASSET.IC.SUICIDE.COSMIC_JACKPOT]]
