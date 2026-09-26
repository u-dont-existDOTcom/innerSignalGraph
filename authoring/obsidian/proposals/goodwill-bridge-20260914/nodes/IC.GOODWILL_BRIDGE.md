---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: goodwill-bridge-20260914
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.GOODWILL_BRIDGE
title: Offer sincere goodwill without calling it warm love
kind: decision-node
tier: 4
priority: 88
authority: owner-approved-extension
graph_tags:
  - wisdom-practice
  - goodwill-bridge
  - optional
source_refs:
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.WISDOM_GOODWILL_BRIDGE
  - AMEND.IC.WISDOM_SOURCES
base_record_sha256: 79cec8b01e9a44345fa288dcf509e2b9d5fe6271aa94a926f3cf04e456d612cd
base_graph_sha256: 630ff10c99c85088482c9b7e76a4031608fe10249a35ea08bb85f4132c2d0e23
base_projection_input_sha256: b9282301e3d8e5d81efead7f8a9683d086373931b70ae22ec3324244bb518248
---

# Offer sincere goodwill without calling it warm love

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "perspective_practice",
        "op": "eq",
        "value": "goodwill_bridge"
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
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "suicidal_state",
        "op": "eq",
        "value": "imminent"
      }
    ]
  },
  "avoid": [
    "Unconditional goodwill is not unconditional access. Goodwill never implies forgiveness, trust, contact, reconciliation, safety, moral approval, reduced accountability, removed consequences, relaxed boundaries, exposure to danger or a prediction about the other person.",
    "Do not treat inability to access goodwill as spiritual failure, pathology or responsibility for another person.",
    "Do not claim clinical validation for these exact phrases or this graded bridge; engineering tests do not establish clinical efficacy.",
    "Do not replace urgent protection, external reality checking, ordinary refusal, support or consequences with a benevolent wish."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Goodwill does not prove warm love, forgiveness, trust, contact, reconciliation, safety or moral approval.",
      "Inability to access goodwill is not spiritual failure, pathology or responsibility for another person.",
      "The exact phrases and graded bridge are not clinically validated."
    ],
    "requiredNuance": [
      "Warm affection/love, benevolent goodwill/intention and non-hatred/non-cruelty are distinct resources with no mandatory progression.",
      "Unconditional goodwill is not unconditional access.",
      "Accountability, consequences, boundaries, protection and trust calibration remain available."
    ]
  },
  "recommendations": [
    "Do not demand warm love or affection. Find the smallest benevolent wish the person can sincerely endorse toward the self, a younger self, a difficult person or an enemy.",
    "Offer `May you be loving, peaceful, and free` as an exemplar, not mandatory wording. User-chosen wording is valid, and `may you be happy` is optional; do not force it when it feels false or rewarding of harm.",
    "Keep warm affection/love, benevolent goodwill/intention and non-hatred/non-cruelty distinct. Goodwill may open some warmth, but warmth is optional and is not the success criterion or proof of love.",
    "For harmful behavior, a wish for greater love, peace, wisdom, safety or freedom may support changed capacity without approving the behavior. Preserve accountability, consequences, boundaries, protection, proportionate anger, distance, documentation and trust calibration.",
    "If goodwill is unavailable, non-cruelty or refusal to feed hatred can be the lower-cost floor without calling it love. Use secular language by default and keep spiritual framing preference-dependent."
  ],
  "successSignals": [
    "A sincerely endorsable goodwill or non-cruelty floor is available without relabelling it warm love or weakening protection."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
