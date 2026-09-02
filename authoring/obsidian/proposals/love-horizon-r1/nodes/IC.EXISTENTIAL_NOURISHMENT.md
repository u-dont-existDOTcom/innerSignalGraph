---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: love-horizon-r1
operation: add
graph_id: inner-child-directed-graph
node_id: IC.EXISTENTIAL_NOURISHMENT
title: Match the work to existential hunger without making spirituality mandatory
kind: decision-node
tier: 2
priority: 98
authority: author-framework
graph_tags:
  - existential
  - love
  - meaning
  - curiosity
  - safety
source_refs:
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: a7aeada0a9fa9fd791ae52f7e25dd7e6b7ea855bdfda56a37f438f07d7f6a3f5
---

# Match the work to existential hunger without making spirituality mandatory

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "existential_sufficiency",
        "op": "in",
        "value": [
          "insufficient",
          "profoundly_insufficient"
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
        "field": "suicidal_state",
        "op": "in",
        "value": ["ideation", "intent", "imminent"]
      }
    ]
  },
  "avoid": [
    "Do not tell a satisfied, non-curious person that they are spiritually deficient or must seek a profound experience.",
    "Do not romanticize suicidal crisis, despair, an NDE, psychedelics, conversion, or extraordinary states as a route to transformation."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say a small practical act should be sufficient for profound existential hopelessness.",
      "Do not say a suicidal crisis is spiritually useful or necessary."
    ],
    "requiredNuance": [
      "Immediate safety action and existential nourishment solve different problems; do not confuse preserving life today with answering why life feels worth living.",
      "Curiosity can open a route without proving that a spiritual conclusion is true or required."
    ]
  },
  "recommendations": [
    "Distinguish whether the person is simply working on a wound within a basically sufficient life, is hungry and curious for a deeper horizon, or experiences ordinary life as radically insufficient.",
    "When the person says they hate themselves yet voluntarily seeks help, believe the self-hating part and also ask what the help-seeking part hoped might happen; do not name that motive love for them.",
    "When hopelessness is profound, keep immediate safety and human contact first while also taking the why-live question seriously; a small protective action can preserve the person without pretending to answer the existential question."
  ],
  "successSignals": [
    "The intervention matches the scale of the person’s hunger while preserving safety and choice about spiritual exploration."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
