---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SUICIDAL_SELF_DEATH_INQUIRY
title: Examine the self/death assumption before an irreversible act
kind: decision-node
tier: 1
priority: 99
authority: author-framework
graph_tags:
  - suicide-prevention
  - self-inquiry
  - rebirth
  - existential
  - safety
source_refs:
  - AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY
  - AMEND.IC.SUICIDAL_PRECIOUS_HUMAN_OPPORTUNITY
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
  - ASSET.IC.SUICIDE.COSMIC_JACKPOT
regression_refs: []
base_record_sha256: 041b2a85dcd478b6c644c5c047b3d468f0acc790395f6cf8a6bd68093821a607
base_graph_sha256: 55b079263bc6ced7c1cf9b1ed3d1a786fa0b191dde1ad700485294ac72804c92
projection_input_sha256: 6c471dc4918c6dc86d09d10c23cbac91a8ce8dbb6795f5e71ce111d0b49171bd
---

# Examine the self/death assumption before an irreversible act

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
      }
    ]
  },
  "avoid": [
    "Do not shame or condemn the person, claim punitive divine certainty, assign postmortem odds, or say that a spiritual motive makes suicide safer.",
    "Do not present dreams, NDEs, rebirth reports, or religious teachings as empirical proof of a specific individual’s postmortem outcome.",
    "Do not claim psychology proves postmortem mental continuity.",
    "Do not prescribe an NDE, psychedelic experience, or solitary spiritual practice as a substitute for urgent real-world protection when danger is imminent."
  ],
  "defaultQuestion": "What exactly is the self you want to kill, and what makes you think killing this body ends that self or the suffering you are trying to escape?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.EXISTENTIAL_NOURISHMENT",
      "IC.LOVE_HORIZON_EXPLORATION"
    ],
    "forbiddenOverclaims": [
      "Do not say suicide reliably leads to hell or reliably leads to heaven, nothingness, liberation, reunion, or any other postmortem outcome.",
      "Do not infer that suicidality itself proves spiritual attainment or that a person must be curious about spirituality before this inquiry or the precious-human-birth reality check is relevant."
    ],
    "requiredNuance": [
      "Suicidal intent itself stakes an irreversible act on assumptions about self, body, mind, and death; the guide therefore examines those assumptions even when ordinary spiritual curiosity is absent, while belief remains voluntary.",
      "Immediate safety preserves the opportunity for inquiry but does not answer the existential or metaphysical question.",
      "Repeated self-hatred, despair, rumination, attentional narrowing, withdrawal, and self-destructive cognition can become self-reinforcing within life; Buddhism additionally teaches continuity of intentional mental causation through death and rebirth. Keep those evidentiary levels distinct.",
      "A Buddhist warning may explicitly include rebirth, hellish states, and severe postmortem suffering without claiming certainty about this individual’s destination or suppressing the warning merely because it is frightening.",
      "Every reflective suicidal route also presents human birth as an extraordinarily rare and precious opportunity to investigate dukkha and liberation, not merely as a life that might possibly become worthwhile."
    ]
  },
  "recommendations": [
    "Ask what the person is trying to end or obtain through death—annihilation, escape, punishment, love or reunion, God or spiritual contact, liberation or release, or something else—without using motive to predict a postmortem outcome.",
    "Examine whether the person is equating the relevant self with the body and what evidence supports the belief that bodily death ends the mind-state, identity, or suffering they want ended.",
    "Challenge annihilation certainty without demanding belief: examine dream phenomenology, rebirth arguments and reports, NDE accounts and their survivor-selection limits, and major contemplative traditions that warn bodily death may not end suffering.",
    "State the Buddhist danger warning plainly: intentional mental trajectories have consequences, rebirth and hellish states are possible, and bodily death should not be treated as a demonstrated off-switch. Keep doctrine, evidence, and inference distinguished rather than inventing odds.",
    "Use the shared mental-trajectory principle carefully: psychology supports self-reinforcing negative cognition within life, while Buddhist teaching extends intentional causation across death and rebirth; therefore bodily death should not be assumed to interrupt the process the person is trying to escape.",
    "Pair this inquiry with the precious-human-opportunity reality check: human birth is presented in Buddhism as an extraordinarily rare chance to investigate suffering, wisdom, love, and liberation before discarding the platform on which that investigation is possible.",
    "Ask what previously forbidden but reversible changes become negotiable if the person is already contemplating losing everything: what would they change before making the one irreversible change?",
    "Keep the body alive while investigating. If danger becomes imminent or the person cannot delay action, return immediately to concrete human contact and physical safety."
  ],
  "successSignals": [
    "The person can name what death is supposed to accomplish, recognize uncertainty in the self/death assumption, grasp the high value Buddhism assigns to the present human opportunity, and delay irreversible action while investigating spiritual claims and reversible life changes."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY]]

[[current/governance/amendments/AMEND.IC.SUICIDAL_PRECIOUS_HUMAN_OPPORTUNITY]]

[[current/governance/amendments/AMEND.IC.EXISTENTIAL_LOVE_ROUTING]]

[[current/governance/amendments/AMEND.IC.WELLBEING_HORIZON]]

[[current/sources/semantic-assets/ASSET.IC.SUICIDE.COSMIC_JACKPOT]]
