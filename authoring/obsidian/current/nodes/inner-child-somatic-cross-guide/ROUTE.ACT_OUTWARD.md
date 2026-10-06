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
  - AMEND.IC.CONTINUITY_TITRATION
  - AMEND.IC.COMMUNITY_REPARENTING
  - AMEND.CROSS.BLOCKED_ACTION_WAIT
  - AMEND.CROSS.PRACTICAL_FOCUS_SEQUENCING
regression_refs:
  - G013
  - G014
  - G033
  - G060
  - G064
  - G066
  - G070
  - G091
  - G092
  - G093
base_record_sha256: ec33bc90ba1720f08c19b643fdc40b56e0199d02730188f4550f5de4c1aaf816
base_graph_sha256: aaa58c6795d8fb057d4167add2cd04c37377850b68247fbf9cf5bb99866963dd
projection_input_sha256: ef6e5e42246d9e7ee8a0985e0275933f76a95ef15038e6658d678fd5399beb44
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
      },
      {
        "field": "practical_action_state",
        "op": "in",
        "value": [
          "blocked_waiting",
          "resolved"
        ]
      }
    ]
  },
  "avoid": [
    "Do not wait for complete emotional certainty before taking a reversible necessary action.",
    "Do not assign an action that requires a known external constraint to be false; blocked waiting is a different state from failure to act.",
    "Do not use action as a way to deny clearly unresolved inner material that continues to drive the problem.",
    "Do not treat noncompletion as lack of motivation or a protective part before examining practical barriers; do not treat task completion or immediate mood improvement as the sole evidence of benefit.",
    "Do not call a social, romantic or sexual action healthy exposure merely because it is difficult when its main function is reassurance, self-testing or using another person to regulate uncertainty.",
    "Do not turn uncertainty-driven avoidance into the remedy for a checking loop when safe, useful exposure or ordinary contact remains appropriate.",
    "Do not use exposure or anti-avoidance framing to override consent, continue touch or sex the person wants to stop, stay in concrete danger, or skip medical evaluation.",
    "Do not collapse one blocked subproblem into a global blocked state when another current priority has an evidence-supported step."
  ],
  "defaultQuestion": "What is the next observable action that could actually change this situation?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not reduce every emotional problem to productivity or behavioral execution.",
      "Do not claim that brief relief from an action establishes durable improvement, resolution, or a causal mechanism.",
      "Do not claim that useful exposure requires continuing touch or sex after the person wants to stop, staying in concrete danger, or skipping a medical check of a possible red flag."
    ],
    "requiredNuance": [
      "A concrete problem and unresolved inner material can coexist; outward action goes first when the environment can actually be changed, while inward work may remain a parallel or later job.",
      "Outward action is judged by its function and consequences, not by courage or exposure intensity alone.",
      "Clinician-guided ERP or other useful exposure is compatible with this route: keep the exposure when appropriate and drop the checking function.",
      "Outcome tracking should be brief and bounded so measurement itself does not become reassurance or symptom checking.",
      "Consent, immediate safety, and possible medical red flags set a floor beneath exposure: useful exposure never requires continuing touch or sex after a no, staying in concrete danger, or skipping needed medical evaluation.",
      "Outward action can embody inner care without being labeled as reparenting; use that label only when the person already welcomes the frame, never after decline or during an acute safety turn.",
      "practical_action_state is scoped to the selected practical focus; another practical lane can remain blocked_waiting at the same time without suppressing outward action on the selected focus."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Extract one concrete problem that can be changed and choose the next observable decision or action.",
    "When several independent practical lanes coexist, choose the highest-leverage feasible current focus. Preserve blocked sibling lanes and their reopening conditions, but do not let them suppress action on the selected focus.",
    "Before planning an action, distinguish a feasible step available now from a real problem that is externally blocked. If all supported next steps are blocked, use the defined-wait route rather than inventing a workaround.",
    "When useful problem-solving is surrounded by rumination, act on the actionable piece and stop rerunning the remainder until genuinely new information arrives.",
    "Use Protector functions for boundaries and safety, and Guide or Leader functions for sequencing and practical follow-through, without requiring deeper introspection merely because action is emotionally charged.",
    "When an action is agreed, make its cue, feasible size, resource needs and personally useful purpose concrete. When an attempt has already happened, review the actual sequence and consequences instead of assigning the same action again.",
    "For a chosen interpersonal response that the person wants help composing, offer the draft/editor method if useful. A brief sufficient response, firm boundary, apology, pause or nonresponse can be appropriate. Preserve the return to inward care separately from outward completion.",
    "For deliberate social or relationship practice, name the life-serving purpose first—connection, curiosity, communication, skill, play or another chosen value. If the action has become certainty-seeking, remove the checking function rather than escalating the test or avoiding the situation.",
    "Match claims about whether an action helped to the observed horizon; brief mood or symptom relief is not durable improvement or proof of mechanism.",
    "When the person already welcomes an inner-child frame and the outward step genuinely supplies care, protection, guidance, or connection, it may be named sparingly as a Nurturer/Protector/Guide move. Otherwise keep ordinary practical language."
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

[[current/governance/amendments/AMEND.IC.CONTINUITY_TITRATION]]

[[current/governance/amendments/AMEND.IC.COMMUNITY_REPARENTING]]

[[current/governance/amendments/AMEND.CROSS.BLOCKED_ACTION_WAIT]]

[[current/governance/amendments/AMEND.CROSS.PRACTICAL_FOCUS_SEQUENCING]]
