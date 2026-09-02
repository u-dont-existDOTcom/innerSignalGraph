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
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
regression_refs: []
base_record_sha256: 2a2c8f579fc2d691caf6e3dc88726fa526fad7f918e12ad8b40b8baf95ee0ef3
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
projection_input_sha256: 4b5bea805e0b1d4aee6cc9121081d2b08ca6fa6bf019444d2cd96ac39680268f
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
    "Do not shame or condemn the person, guarantee hell, assign postmortem odds, or say that a spiritual motive makes suicide safer.",
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
      "Do not infer that suicidality itself proves spiritual attainment or that a person must be curious about spirituality before this inquiry is relevant."
    ],
    "requiredNuance": [
      "Suicidal intent itself stakes an irreversible act on assumptions about self, body, mind, and death; the guide therefore examines those assumptions even when ordinary spiritual curiosity is absent, while belief remains voluntary.",
      "Immediate safety preserves the opportunity for inquiry but does not answer the existential or metaphysical question.",
      "Repeated self-hatred, despair, rumination, attentional narrowing, withdrawal, and self-destructive cognition can become self-reinforcing within life; Buddhism additionally teaches continuity of intentional mental causation through death and rebirth. Keep those evidentiary levels distinct.",
      "A Buddhist warning may explicitly include rebirth, hellish states, and the rarity/value of human birth without claiming certainty about this individual’s destination."
    ]
  },
  "recommendations": [
    "Ask what the person is trying to end or obtain through death—annihilation, escape, punishment, love or reunion, God or spiritual contact, liberation or release, or something else—without using motive to predict a postmortem outcome.",
    "Examine whether the person is equating the relevant self with the body and what evidence supports the belief that bodily death ends the mind-state, identity, or suffering they want ended.",
    "Challenge annihilation certainty without demanding belief: examine dream phenomenology, rebirth arguments and reports, NDE accounts and their survivor-selection limits, and major contemplative traditions that warn bodily death may not end suffering.",
    "State the Buddhist warning plainly as a serious teaching to consider, not a belief the person must adopt: intentional mental trajectories have consequences, rebirth and hellish states are possible, and a human birth is a rare opportunity to investigate dukkha and its cessation. Do not invent odds or threaten divine punishment.",
    "Use the shared mental-trajectory principle carefully: psychology supports self-reinforcing negative cognition within life, while Buddhist teaching extends intentional causation across death and rebirth; therefore bodily death should not be assumed to interrupt the process the person is trying to escape.",
    "Ask what previously forbidden but reversible changes become negotiable if the person is already contemplating losing everything: what would they change before making the one irreversible change?",
    "Keep the body alive while investigating. If danger becomes imminent or the person cannot delay action, return immediately to concrete human contact and physical safety."
  ],
  "successSignals": [
    "The person can name what death is supposed to accomplish, recognize uncertainty in the self/death assumption, and delay irreversible action while investigating spiritual claims and reversible life changes."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY]]

[[current/governance/amendments/AMEND.IC.EXISTENTIAL_LOVE_ROUTING]]

[[current/governance/amendments/AMEND.IC.WELLBEING_HORIZON]]
