---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.THREE_WAY_GATE
title: Discriminate processing, action, and non-engagement
kind: decision-node
tier: 3
priority: 96
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - discrimination
  - stop-rule
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - AMEND.CROSS.EXPERIENCE_INTERPRETATION_CHOICE
regression_refs:
  - G063
  - G092
base_record_sha256: 37c9639936b1af97e42408c458bfb3ff76cc3409694ea8e73e981534af65e30f
base_graph_sha256: 32fe4c146863ea66e757304b8b840c4eb219d5d2fdc51ce7c1b1896bb6771455
projection_input_sha256: 61a6f2bc0a4901a995b341b8e10f0a2d918b76e60ce795da05c2e83e93b98ec8
---

# Discriminate processing, action, and non-engagement

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "attention_loop",
        "op": "eq",
        "value": "present"
      }
    ],
    "any": [
      {
        "field": "thinking_yield",
        "op": "in",
        "value": [
          "mixed",
          "unknown"
        ]
      },
      {
        "field": "actionable_problem",
        "op": "eq",
        "value": "unknown"
      },
      {
        "field": "unresolved_inner_material",
        "op": "eq",
        "value": "unknown"
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
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ]
  },
  "avoid": [
    "Do not assume repeated analysis is problem-solving merely because the topic is important.",
    "Do not label refusal to process as healthy non-engagement until concrete problems and clearly avoided material have been checked.",
    "Do not treat behavioral effort as automatically productive merely because it is outward or difficult; an action can still be the same reassurance or certainty computation in behavioral form."
  ],
  "defaultQuestion": "Is this thinking giving you genuinely new information, a decision, or an action—or are we running the same computation again; and is there a concrete problem to act on or clearly avoided material to contact?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that one branch is universally superior to the others."
    ],
    "requiredNuance": [
      "The three movements can alternate over time; this is a routing decision for the current maintaining process, not a permanent personality classification.",
      "The relevant distinction is function, not whether the checking happens in thought or behavior.",
      "Ordinary exploration of sexuality, orientation, gender, attraction or relationship fit is not checking unless a repetitive certainty-seeking pattern is actually present.",
      "Exposure or clinician-guided ERP remains compatible with this route: remove covert checking and reassurance rather than avoiding the relevant situation."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Before prescribing another technique, discriminate whether the next useful movement is inward processing, outward action, or leaving a self-maintaining loop unanswered.",
    "Use output rather than intensity as the stop rule: useful thinking should yield new information, a decision, an action, or genuinely changed contact with previously avoided material.",
    "Discriminate genuine inquiry from certainty-seeking: genuine inquiry can update with evidence and tolerate an unresolved answer, while a checking loop tends to rerun the same question, use the body, other people or repeated actions as tests, and obtain only short-lived reassurance."
  ],
  "successSignals": [
    "The case can be classified into one primary movement without forcing every difficulty into a therapy technique.",
    "The person can leave an interpretation unresolved when no new evidence is available and choose the next useful action without first obtaining complete internal certainty."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]

[[current/governance/amendments/AMEND.CROSS.EXPERIENCE_INTERPRETATION_CHOICE]]
