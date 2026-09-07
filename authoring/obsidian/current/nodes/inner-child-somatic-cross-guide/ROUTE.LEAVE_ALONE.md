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
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
regression_refs:
  - G013
  - G014
  - G026
  - G027
  - G028
base_record_sha256: 02722afbbd0cfc900111e7d7a9d721f790897ee0b9c96a93d219ab7ec2f2732b
base_graph_sha256: beb05b08a340cf9bd62efacaab7619a3dd4f6adf6bedabb4927cfe4e3a329560
projection_input_sha256: 87fe2a86cd73db5cb54f86ba19f04d231dff02d8a775faa8121ab27f34ae51b1
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
        "field": "leave_alone_eligibility",
        "op": "eq",
        "value": "eligible"
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
      "Low-dose regulation is not forbidden when it is needed for functioning; the stop rule targets repetitive processing and checking rather than every form of support.",
      "Non-engagement concerns this repetitive operation, not a declaration that background grief, a relationship, or all developmental work is resolved. A completed reality check reopens for new relevant evidence, not every renewed reassurance urge."
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

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]
