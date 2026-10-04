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
base_record_sha256: b63626c2c67d82dbf821fa306dff28ddf7cd3a311c8aae138b6ca9313642496c
base_graph_sha256: f2be6a2332d84ae3c771b97261698829b09bec863ad4a57f6675e1bceac413c9
projection_input_sha256: 1095040bcb3258c07ae813989cacb96e2c1f0d87cbdf24373854fecd52376b53
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
    "Do not turn uncertainty-driven avoidance into the remedy for a checking loop when safe, useful exposure or ordinary contact remains appropriate.",
    "Do not use exposure or anti-avoidance framing to override consent, continue touch or sex the person wants to stop, stay in concrete danger, or skip medical evaluation."
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
      "Consent, immediate safety, and possible medical red flags set a floor beneath exposure: useful exposure never requires continuing touch or sex after a no, staying in concrete danger, or skipping needed medical evaluation."
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
