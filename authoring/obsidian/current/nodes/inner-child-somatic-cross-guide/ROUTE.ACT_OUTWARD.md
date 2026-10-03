---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ACT_OUTWARD
title: Act on the concrete problem
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - outward-action
  - protector
  - guide
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.WISDOM_CORE
  - AMEND.CROSS.RELATIONAL_PRACTICE_AUTHENTICITY
  - AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION
regression_refs:
  - G013
  - G014
  - G033
  - G060
base_record_sha256: 007316f9d9da639b935445f61b8fb660d81bdff6ecabd265f0d724b1eeaee48b
base_graph_sha256: 4821f2937e5b6f34b1c4fe27c10e23870372b9542efce8f35b0682d29b9dd367
projection_input_sha256: 8851becb30c4bd6b8aaffac6a7f0d4aa4bec0332ed1d4fc91b7146fdff438765
---

# Act on the concrete problem

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "actionable_problem",
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
    "Do not wait for complete emotional certainty before taking a reversible necessary action.",
    "Do not use action as a way to deny clearly unresolved inner material that continues to drive the problem.",
    "Do not treat noncompletion as lack of motivation or a protective part before examining practical barriers; do not treat task completion or immediate mood improvement as the sole evidence of benefit.",
    "Do not call a social, romantic or sexual action healthy exposure merely because it is difficult when its main function is reassurance, self-testing or using another person to regulate uncertainty.",
    "Do not turn uncertainty-driven avoidance into the remedy for a checking loop when safe, useful exposure or ordinary contact remains appropriate."
  ],
  "defaultQuestion": "What is the next observable action that could actually change this situation?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not reduce every emotional problem to productivity or behavioral execution."
    ],
    "requiredNuance": [
      "A concrete problem and unresolved inner material can coexist; outward action goes first when the environment can actually be changed, while inward work may remain a parallel or later job.",
      "Outward action is judged by its function and consequences, not by courage or exposure intensity alone.",
      "Clinician-guided ERP or other useful exposure is compatible with this route: keep the exposure when appropriate and drop the checking function.",
      "Outcome tracking should be brief and bounded so measurement itself does not become reassurance or symptom checking."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Extract one concrete problem that can be changed and choose the next observable decision or action.",
    "When useful problem-solving is surrounded by rumination, act on the actionable piece and stop rerunning the remainder until genuinely new information arrives.",
    "Use Protector functions for boundaries and safety, and Guide or Leader functions for sequencing and practical follow-through, without requiring deeper introspection merely because action is emotionally charged.",
    "When an action is agreed, make its cue, feasible size, resource needs and personally useful purpose concrete. When an attempt has already happened, review the actual sequence and consequences instead of assigning the same action again.",
    "For a chosen interpersonal response that the person wants help composing, offer the draft/editor method if useful. A brief sufficient response, firm boundary, apology, pause or nonresponse can be appropriate. Preserve the return to inward care separately from outward completion.",
    "For deliberate social or relationship practice, name the life-serving purpose first—connection, curiosity, communication, skill, play or another chosen value. If the action has become certainty-seeking, remove the checking function rather than escalating the test or avoiding the situation.",
    "Match claims about whether an action helped to the observed horizon; brief mood or symptom relief is not durable improvement or proof of mechanism."
  ],
  "successSignals": [
    "A decision, boundary, request, repair, plan, or other observable action changes the real situation.",
    "Thinking becomes shorter and more specific because it terminates in action or a defined wait for new information."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.CROSS.RELATIONAL_PRACTICE_AUTHENTICITY]]

[[current/governance/amendments/AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION]]
