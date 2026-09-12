---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: wisdom-practices-20260912
operation: add
graph_id: inner-child-directed-graph
node_id: IC.PAST_COMPETENCE
title: Retrieve a real occasion of responding well
kind: decision-node
tier: 4
priority: 88
authority: owner-approved-extension
graph_tags:
  - wisdom-practice
  - past-competence
  - optional
source_refs:
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.WISDOM_PAST_COMPETENCE
  - AMEND.IC.WISDOM_SOURCES
base_graph_sha256: 8c8a59965c4ee3ffc9fd9dc835e9589808638bd346510a3b4d2c44ba31f3f968
base_projection_input_sha256: 2b23083b114602af50c57f715c5afb16d1c1b9959e3ca8ea9d7f87f501a49b2f
---

# Retrieve a real occasion of responding well

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
        "value": "past_competence"
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
    "Stop or adapt distancing that produces a contemptuous observer, increased shame, loss of contact, numbness, or unreality. Return to present contact, care, or practical protection; do not intensify the same technique.",
    "Do not replace an urgent external action, the current relational reality check, or the existing risk/trajectory controller with a perspective exercise.",
    "Do not perform secondary graph nodes as a checklist. Use the primary task and only explicitly necessary support."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not require a perfect state, pleasantness, forgiveness, reconciliation, imagery, an inner-child interpretation, or weakened boundaries as the price of responding well.",
      "Do not infer another person's intentions, future regret, agreement, safety, or trustworthiness from an imagined wiser version of them.",
      "Do not claim that these exact combined practices are clinically validated, or that a momentary state proves lasting capacity.",
      "Do not treat unsent draft wording as established facts about another person, settled intent, or a durable diagnosis of its writer."
    ],
    "requiredNuance": [
      "Edit the communication without rejecting its author. Care, truthful responsibility, appropriate protection, and human agency remain together.",
      "These are optional, smallest-sufficient practices. Changed understanding, felt embodiment, and supportive companionship are distinct valid entrances, not mandatory stages or proof of healing.",
      "A task in offer phase is an invitation, not permission to perform the exercise. Accepted practice may proceed without repeated consent questions. Respect declining, ending, or changing the practice.",
      "Keep immediate relief, wise reasoning, actual action, and durable self-leadership separate. An appropriate outward response alone does not prove the return to inward care happened.",
      "Use secular language unless an individual requests or has an evidenced current preference for a tradition. Religious sources and exemplar practices are not clinical efficacy evidence.",
      "Prior capacity is evidence, not a guarantee that the same response is possible now."
    ]
  },
  "recommendations": [
    "Offer: “Remember one real occasion when you met a difficulty in a way you respect. What did you actually do, and what helped? Is one part available now?”",
    "A small relevant event is sufficient. Retrieve action, support, resources or conditions rather than merely a flattering identity claim.",
    "If recall is difficult, stop the search or use an already chosen anchor or another care entrance. Prior ability does not cancel present limits or the value of receiving help."
  ],
  "successSignals": [
    "A specific actual action or support becomes available without pressure or invented memory."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Apply the exact owner-approved wisdom-practice packet record while preserving current safety, relationship, trajectory, consent, provenance and task-state boundaries. The worst plausible failure is a fitting optional practice displacing protection, reality checking, a valid boundary, or current consent.

## Regression intent

The proposal declares G930–G962, including direct entrances, refusal/close boundaries, safety precedence, raw-variable spoofing, outward editor support and relationship-first routing.
