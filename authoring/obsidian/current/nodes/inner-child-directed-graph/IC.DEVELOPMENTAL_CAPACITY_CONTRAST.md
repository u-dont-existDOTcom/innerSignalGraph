---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.DEVELOPMENTAL_CAPACITY_CONTRAST
title: Establish the developmental function before assigning it
kind: decision-node
tier: 2
priority: 99
authority: author-framework
graph_tags:
  - developmental-prerequisite
  - context-sensitive-assessment
  - reparenting
source_refs:
  - IC.BORROW_ADULT
  - IC.ADULT_APPRENTICE
  - IC.THREE_FUNCTIONS
  - AMEND.IC.DEVELOPMENTAL_PREREQUISITE_GATE
regression_refs: []
base_record_sha256: 6c6179633aabb287a906e2bacd7bad4490d36d1c6a1832921bced0c615c9e139
base_graph_sha256: 4a25d27086c6ec2f11a67ec6592d058e3ad3bb63d37be10a78e9a8f48f1cf206
projection_input_sha256: be76479fe2e7eaa61ebee5c045123130a833c1a288a90fdaa786006e63026932
---

# Establish the developmental function before assigning it

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "developmental_inquiry_route",
        "op": "in",
        "value": [
          "successful_exception",
          "breakdown_state",
          "paired"
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
      }
    ]
  },
  "avoid": [
    "Do not assign an unestablished Adult, Nurturer, Protector, Leader, or Guide another task.",
    "Do not add symptom-function, rejection, false-self, substance, shaking, or generic consent and boundary tangents to this comparison."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.CREDIBILITY_REPAIR",
      "IC.PROTECTOR_ACTION",
      "IC.GUIDE_LATER"
    ],
    "forbiddenOverclaims": [
      "Do not infer capacity, trust, or a coherent inner Adult from vocabulary alone."
    ],
    "requiredNuance": [
      "When both questions are selected, their evidence-selected order forms one discriminating comparison rather than two competing agendas; when one side is already known, ask only the unresolved side."
    ]
  },
  "recommendations": [
    "Use the successful-exception inquiry, the breakdown-state inquiry, or their context-ordered comparison exactly as supplied by the developmental capacity contract.",
    "Ask both only when each resolves a distinct action-changing uncertainty and the client can tolerate the pair; otherwise ask only the unresolved side.",
    "Use the resulting evidence to identify observable caregiving or leadership functions without treating role language as proof of a literal internal entity."
  ],
  "successSignals": [
    "The selected inquiry identifies an emerging function, what disappears under distress, or both when the comparison is justified."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.BORROW_ADULT]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.THREE_FUNCTIONS]]

[[current/governance/amendments/AMEND.IC.DEVELOPMENTAL_PREREQUISITE_GATE]]
