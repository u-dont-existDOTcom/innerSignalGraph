---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.ADULT_APPRENTICE
title: Move from receiving care to doing five percent
kind: decision-node
tier: 4
priority: 86
authority: author-framework
graph_tags:
  - adult-apprentice
  - five-percent
  - relationship
source_refs:
  - IC.ADULT_APPRENTICE
  - IC.RELATIONSHIP
  - AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.EMOTIONAL_TASK_GUIDANCE
  - IC.BORROW_ADULT
  - IC.BORROW_ONE_FUNCTION
  - IC.SPIRITUAL_LOAN
  - AMEND.IC.NONPUNITIVE_REVIEW
  - AMEND.IC.PRACTICE_TO_LIFE_TRANSFER
  - AMEND.IC.AUTOMATIC_CARE_INTEGRATION_20261022
regression_refs: []
base_record_sha256: 48316af51f0cd9a6627597103969c89905b9866b586aedd2cf781e644a52e0e5
base_graph_sha256: 41dbf0e44fd2ebc7bb452db405c70d727d9392795729e3cf406a233fc543882f
projection_input_sha256: 9de0d498e06b99b8aec614c7319ef3255bbfc3be0eb9ca0eeb269a0804eae4e8
---

# Move from receiving care to doing five percent

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "support_available",
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
      }
    ]
  },
  "avoid": [
    "Do not create permanent practical or epistemic authority dependency.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "The helper hands back judgment as well as behavior; successful apprenticeship should make independent checking easier rather than making the helper harder to question.",
      "Receiving support is not the endpoint: the sequence is receive care, observe care, participate in care, initiate a small part, and internalize what proves usable.",
      "The adult function can become real through ordinary action before it feels like a stable identity.",
      "Review distinguishes accountability and learning from punishment or judgments about worth. Accountability may still include consequences, firmer boundaries, and an honest assessment of present capacity.",
      "Adult capacity can be available inside an exercise while ordinary-life transfer remains session-only; do not infer generalized self-leadership from meditation performance alone."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role and the judgment behind it back to the person so they become more able to check, disagree, revise, and act without the helper.",
    "Name what capacity the person exercised, what help remained useful, and what the real-world attempt taught them; independence does not require refusing appropriate support. Care includes interest and delight, not duty alone, and should support exploration outside the exercise.",
    "Carry the borrowed function into one ordinary-life act that the person initiates, then review what it actually contributed rather than treating completion alone as success.",
    "Keep outside support available when useful while returning authorship, judgment, disagreement, and revision to the person.",
    "Treat the growing ability to give the vulnerable self real nurturing, protection and guidance as a central outcome of reparenting. Assess actual caring behavior in life without demanding automaticity, constant happiness, total self-sufficiency or flawless consistency.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present, and the person can evaluate the helper without needing the helper’s permission.",
    "The person can initiate a small caring/protective act and evaluate whether it helped without handing the helper permanent authority.",
    "With repeated real-world use, some caring, protective and guiding responses become more automatic and require less compulsive monitoring, without losing the ability to reflect, change course or ask for help.",
    "Repeated, credible care for the younger self through ordinary choices is central outcome evidence even when it still requires conscious effort or suitable outside support.",
    "The review yields clearer understanding and either one bounded repair or adjustment, or a clear conclusion that no change is needed, without materially escalating self-attack."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.RELATIONSHIP]]

[[current/governance/amendments/AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.EMOTIONAL_TASK_GUIDANCE]]

[[current/sources/inner-child-guide/IC.BORROW_ADULT]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/sources/inner-child-guide/IC.SPIRITUAL_LOAN]]

[[current/governance/amendments/AMEND.IC.NONPUNITIVE_REVIEW]]

[[current/governance/amendments/AMEND.IC.PRACTICE_TO_LIFE_TRANSFER]]

[[current/governance/amendments/AMEND.IC.AUTOMATIC_CARE_INTEGRATION_20261022]]
