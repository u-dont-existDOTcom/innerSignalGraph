---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SCAFFOLDED_CHALLENGE
title: Titrate difficult material instead of equating distress with harm
kind: decision-node
tier: 4
priority: 89
authority: owner-approved-extension
graph_tags:
  - scaffolding
  - pendulation
  - challenge
  - titration
  - dreams
source_refs:
  - AMEND.IC.SCAFFOLDED_CHALLENGE
  - IC.REGULATION_BEFORE_DIALOGUE
  - IC.SESSION_CLOSURE
regression_refs:
  - G062
base_record_sha256: 189727472f5cfd353740612ae4ad720265b49d63b06faf0148912df131a6cf14
base_graph_sha256: e9856521bef7b4cdc99119361292128385607971644ed075fd48d520522cfc3d
projection_input_sha256: 04d7283ac4e6fe1785a7c608486553be179beb204d2ff4ff66b8917c40f8b8af
---

# Titrate difficult material instead of equating distress with harm

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "practice_challenge",
        "op": "eq",
        "value": "workable"
      },
      {
        "field": "current_intent",
        "op": "in",
        "value": [
          "gentle_practice",
          "deep_dialogue",
          "memory_processing",
          "hypnosis"
        ]
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "safe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "oriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "inward_attention_effect",
        "op": "eq",
        "value": "worsens"
      }
    ]
  },
  "avoid": [
    "Do not protect the person from every unpleasant emotion or dream merely because it is distressing.",
    "Do not push through disorientation, loss of stopping capacity, prolonged functional decline, or the person's refusal in the name of growth, exposure, toughness, or catharsis.",
    "Do not treat intensity, suffering, vividness, or endurance as proof that the exercise is working."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that adversity necessarily causes growth or that disturbing dreams reveal hidden historical truth."
    ],
    "requiredNuance": [
      "Distress and harm are not synonyms; the relevant distinction is workable challenge versus overload, judged over time and with the person's own appraisal.",
      "Growth can occur through difficulty, but difficulty is never a reason to manufacture or intensify suffering."
    ]
  },
  "recommendations": [
    "Treat difficulty as information to calibrate, not as automatic evidence of either harm or progress. Ask how the person experiences the challenge and what happens to orientation, choice, recovery, later functioning, useful information, and willingness to re-engage.",
    "Pendulate between challenge and resource. Adjust one dimension at a time—duration, depth, timing, imagery intensity, eyes-closed immersion, isolation, or amount of support—so the person can learn at the edge of current capacity rather than only inside comfort or beyond capacity.",
    "A difficult dream, tears, grief, fear, vivid material, or temporary activation can be explored for the need or conflict it reveals without treating the content as historical fact and without assuming the practice caused harm.",
    "If the challenge becomes too much, step down and recover; when capacity returns, reconsider a bounded re-entry rather than treating the first reduction as permanent."
  ],
  "successSignals": [
    "The person can approach and leave difficult material voluntarily while remaining oriented and recovering afterward.",
    "Challenge produces usable emotional information, agency, skill, connection, or ordinary-life movement without requiring escalating intensity."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SCAFFOLDED_CHALLENGE]]

[[current/sources/inner-child-guide/IC.REGULATION_BEFORE_DIALOGUE]]

[[current/sources/inner-child-guide/IC.SESSION_CLOSURE]]
