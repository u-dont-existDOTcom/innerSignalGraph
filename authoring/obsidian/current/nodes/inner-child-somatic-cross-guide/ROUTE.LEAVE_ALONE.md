---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.LEAVE_ALONE
title: Leave the loop alone and re-enter ordinary life
kind: decision-node
tier: 3
priority: 100
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - rumination
  - metacognitive
  - ordinary-life
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
regression_refs:
  - G013
  - G014
base_record_sha256: ea98415f36af14b7f242776590f49bf7146f598d4c127544e72d920eb5d63d98
base_graph_sha256: 52bce090d4dd5380cdc2c647b12704655d9596451468807184e41d3b64c192af
projection_input_sha256: 03b5fbde47286f0ba3b55df88057273a2822276d9d24cc0cac6940cfea418c24
---

# Leave the loop alone and re-enter ordinary life

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
      },
      {
        "field": "thinking_yield",
        "op": "eq",
        "value": "repetitive_no_new_output"
      },
      {
        "field": "actionable_problem",
        "op": "eq",
        "value": "absent"
      },
      {
        "field": "unresolved_inner_material",
        "op": "eq",
        "value": "absent"
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
      },
      {
        "field": "other_person_central",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "influence_domain",
        "op": "eq",
        "value": "ordinary_social"
      }
    ]
  },
  "avoid": [
    "Do not call thought suppression, denial, emotional numbing, or ignoring a medical, safety, relational, or practical problem 'leaving it alone'.",
    "Do not treat reduced attention to symptoms as proof that the underlying condition is cured."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "SOM.RESOURCE_BRAINSPOTTING",
      "SOM.DEEP_BRAINSPOTTING",
      "SOM.EMDR_DISCRETE",
      "SOM.EMDR_DEVELOPMENTAL",
      "SOM.ADVANCED_RELEASE_OPTIONAL"
    ],
    "forbiddenOverclaims": [
      "Do not claim that rumination or attention caused all symptoms, or that every persistent symptom should simply be ignored."
    ],
    "requiredNuance": [
      "For some people, the imagined need to keep finding or performing therapy can itself become part of the maintaining attention loop.",
      "Low-dose regulation is not forbidden when it is needed for functioning; the stop rule targets repetitive processing and checking rather than every form of support."
    ]
  },
  "recommendations": [
    "Notice the thought, sensation, or urge to solve without suppressing it and without answering the same question again; then re-engage ordinary life.",
    "Stop repeated reassurance, symptom checking, healing-method searching, and therapeutic interpretation when they are producing no new information, decision, or action.",
    "If a concrete problem or clearly avoided inner issue later appears, route back to outward action or inward processing rather than preserving non-engagement as a dogma."
  ],
  "successSignals": [
    "Checking and reassurance decrease while flexible attention, ordinary activity, relationships, and functioning increase.",
    "The person can let an unanswered thought exist without immediately converting it into another healing task."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]
