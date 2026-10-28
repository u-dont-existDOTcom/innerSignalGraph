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
base_record_sha256: 574dd304f780b0ead089954eb6122de8e142ec1eb29995f7d3012c4d1e3387c6
base_graph_sha256: 83d1599726791c030b4b4729eca3f2b34d1b010e75bc290f5bb8cbe8c178f549
projection_input_sha256: 822897a41c07051b27e6fc97c7a806c2decfb388625d30ca4c96b7f5278c60b2
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

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.IC.NONPUNITIVE_REVIEW]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025]]

[[current/governance/amendments/AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026]]
