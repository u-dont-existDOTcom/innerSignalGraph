---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PROTECTOR_ACTION
title: Make the Protector visible in ordinary life
kind: decision-node
tier: 4
priority: 90
authority: author-framework
graph_tags:
  - protector
  - ordinary-life
  - credibility
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.ADULT_APPRENTICE
  - IC.GUIDE_LATER
  - IC.INHERITED_PARENT
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.NONPUNITIVE_REVIEW
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025
  - AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026
regression_refs:
  - G003
  - G008
  - G011
  - G029
  - G030
  - G036
  - G050
  - G051
  - G057
  - G113
  - G114
  - G115
base_record_sha256: 14c3f7f4e726e0e078f145fc04615374f34bb1bb68514108c8677d5a9d5c2dd4
base_graph_sha256: 1be36fd7dc3435ef3c08b90afa3b6810738aa4e5170dcc0d727279ac7a61a3bc
projection_input_sha256: 1a2c76f605f0712c39a31c625acdeb404804395f06b9a0d80bb03ac097f9c1c7
---

# Make the Protector visible in ordinary life

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "credibility_conflict",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not recommend a coping strategy known to worsen the person's condition merely because it briefly relieves distress.",
    "Do not choose an action so large that failure becomes new evidence of unreliability.",
    "Do not mistake escape from anything difficult for self-love: without direction, reparenting can become permissive.",
    "Do not confuse being capable of stopping a substance with removing the circumstances that repeatedly drive a return to it.",
    "Do not equate involuntary feeling and chosen harmful conduct, and do not use acceptance of a feeling to exempt behavior from ordinary accountability.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Choose one bounded action: a meal, sleep, a boundary, a phone put down, a task handled, an unsafe exchange ended, or help requested.",
    "Report the action without requiring the younger state to trust it yet.",
    "Where communication itself is the action, a private draft and caring editor may help preserve truth and the boundary; return to inward care afterward when useful. Do not postpone a necessary protective action to complete an exercise.",
    "The inner adult may reject the insult and firmly stop degrading inner speech without first settling what the voice is for, keeping compassion, boundaries and accountability for real conduct. Understanding where the criticism comes from does not mean agreeing with it or allowing it to keep attacking.",
    "For recurring risky relief used against sleep disruption or other distress, identify the unmet need and one feasible safer response available in the moment, evaluating realistic access barriers and social or environmental supports without blaming the person.",
    "Choosing not to act on an unsuitable attraction can be a compassionate protective response, respecting the needs, boundaries and consent of everyone affected without making the feeling itself a source of shame.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One small promise is kept.",
    "The action or its review provides truthful information about what supports protection and follow-through, including when a reasonable plan needs changing."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.GUIDE_LATER]]

[[current/sources/inner-child-guide/IC.INHERITED_PARENT]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.IC.NONPUNITIVE_REVIEW]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025]]

[[current/governance/amendments/AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026]]
