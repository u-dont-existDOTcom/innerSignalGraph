---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
operation: add
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
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Treat human birth as a precious opportunity before discarding it

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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
        "value": ["present", "partial"]
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": ["partial", "available"]
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

## Proposal rationale

The prior suicide node mentioned the rarity and value of human birth but did not make the owner’s stronger point structurally unavoidable. This node ensures that every reflective suicidal route includes the Buddhist precious-human-birth reality check while preserving immediate-safety priority and epistemic distinctions.

## Regression intent

G025 requires this node for safe, sober suicidal intent despite absent spiritual curiosity. G026 requires it to stay out of the active route when immediate safety or reflective capacity is unavailable.
