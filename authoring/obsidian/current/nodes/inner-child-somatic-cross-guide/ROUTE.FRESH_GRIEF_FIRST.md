---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.FRESH_GRIEF_FIRST
title: After a fresh death or harm, let grief and support come first
kind: decision-node
tier: 1
priority: 90
authority: author-framework
graph_tags:
  - grief
  - loss
  - support
source_refs:
  - AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014
regression_refs:
  - G117
  - G122
  - G123
  - G124
  - G126
  - G127
base_record_sha256: d35f309d87cb65f08323770aa05c3c461a2c995790d575409be5b0ad6b27207f
base_graph_sha256: fb56323a8971efd88a7fba8678db766e3a6cca90dafc25e42bf5ae3de39f7298
projection_input_sha256: eb34789685440c90c630eb98a9021bae082c5b5f6b2b6f0fb55499246d8b4e72
---

# After a fresh death or harm, let grief and support come first

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "fresh_grief",
        "op": "eq",
        "value": "present"
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
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "music_emotional_access",
        "op": "eq",
        "value": "overwhelming"
      }
    ]
  },
  "avoid": [
    "Do not tell a grieving person to be grateful for the loss, that it happened for a reason, or that they should already be at peace."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "ROUTE.GRATITUDE_PRACTICE",
      "IC.DEEP_LOVE_TO_CHILD",
      "IC.GUARD_BEFORE_CHILD_LOVE",
      "IC.REALIZATION_LOVE_INTEGRATION",
      "IC.LOVE_HORIZON_EXPLORATION",
      "IC.EXISTENTIAL_NOURISHMENT",
      "IC.REACTIVATION",
      "IC.PRACTICE_TO_LIFE_TRANSFER",
      "IC.CREDIBILITY_REPAIR",
      "IC.NEUTRAL_WITNESS",
      "IC.BORROW_ONE_FUNCTION",
      "IC.AGE_RESPONSIBILITY_CLARIFICATION",
      "IC.SOLAR_PLEXUS_RELAXATION",
      "IC.BORROW_LOVE",
      "IC.PROTECTOR_ACTION",
      "IC.SCAFFOLDED_CHALLENGE",
      "IC.ADULT_APPRENTICE",
      "IC.GENTLE_SELF_HYPNOSIS",
      "IC.IDENTITY_FORMATION",
      "IC.DEEP_CHILD_DIALOGUE",
      "IC.DIFFERENTIATION",
      "IC.GUIDE_LATER",
      "IC.FORGIVENESS_LATER",
      "ROUTE.GO_INWARD",
      "SOM.SIBAM_TRACKING",
      "SOM.RESOURCE_BRAINSPOTTING",
      "SOM.DEEP_BRAINSPOTTING",
      "SOM.EMDR_DISCRETE",
      "SOM.EMDR_DEVELOPMENTAL",
      "SOM.MEANING_INTEGRATION",
      "SOM.ADVANCED_RELEASE_OPTIONAL",
      "SOM.AQUATIC_BODYWORK",
      "ROUTE.REFRACTORY_PAIN_NAVIGATION"
    ],
    "forbiddenOverclaims": [
      "Do not claim the loss happened for a reason or was meant to teach something."
    ],
    "requiredNuance": [
      "Fresh grief is not a problem to fix with gratitude; crying and support are the work."
    ]
  },
  "recommendations": [
    "After a fresh death or harm, don’t ask for gratitude, and never gratitude for the loss. Encourage crying, support from loved ones, and prayer if they pray.",
    "After a death, if it fits what the person believes, invite them to send love to the one who died; in the author’s view it can still be felt, and the one who died will be grateful for it. Don’t present that as fact to someone who doesn’t share it, and don’t speak of anyone dying when the loss or harm was something else.",
    "Gratitude can come in sideways, if at all: for the love itself, the time together, or the people helping now, offered lightly and never made the priority.",
    "After a harm, safety and practical help come before anything inward. While the grief is fresh, inner-child work, going inward, trauma processing, meaning-making and forgiveness wait; support, prayer, gentle settling of the body and practical help stay."
  ],
  "successSignals": [
    "The grief is allowed and shared, and the person feels less alone with it."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.GRATITUDE_FOR_EVERYONE_20261014]]
