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
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY
  - AMEND.CROSS.RESPONSE_FIDELITY_20261025
  - AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025
  - AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026
  - AMEND.CROSS.EARLY_REGULATION_CONDITION_20261026
  - AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029
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
  - G098
  - G099
  - G101
  - G105
  - G141
base_record_sha256: faf2bb1cba2d53021db09c634d48047b5dd7b14c2638a8d23a965de202be903a
base_graph_sha256: 20f40a9060a42470c0f8a9956a00d1957ef33d05c3b01743c8b2cd1c508d9776
projection_input_sha256: b4a6e73f888e81f14230e1c2655e69c0eeb4c35a64abb7c409702f29ac7afebb
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
    "Do not collapse one blocked subproblem into a global blocked state when another current priority has an evidence-supported step.",
    "Do not ignore known long-term harm from short-lived coping relief, infer substance dependence contrary to an established negative, or ask for facts the person already supplied.",
    "Do not use disclosure of suicidal thoughts as a bargaining chip for analgesia, and do not equate another generic psychiatric referral with a physical-pain treatment plan after coercive or ineffective prior care.",
    "Do not prescribe a generic high-effort routine or withdrawal plan when recorded stopping history and limited executive capacity point to a different problem.",
    "Do not present deleting one contact or relocating as a guaranteed solution when equivalent access remains or the person declines the setting.",
    "Do not collapse feelings, chosen conduct, legal restrictions, clinical categories and consent into the same question."
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
      "practical_action_state is scoped to the selected practical focus; another practical lane can remain blocked_waiting at the same time without suppressing outward action on the selected focus.",
      "A supportive coach can supply useful accountability without validating a claimed supplement, mold or detox mechanism; test actions and observed outcomes separately from explanations.",
      "In translation and paraphrase preserve attributed inclusive groups, including monks and nuns when the speaker uses monastics; do not silently narrow source scope."
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
    "When the person already welcomes an inner-child frame and the outward step genuinely supplies care, protection, guidance, or connection, it may be named sparingly as a Nurturer/Protector/Guide move. Otherwise keep ordinary practical language.",
    "When a familiar short-term relief strategy is already documented to worsen later health or functioning, choose a feasible safer response for the next crisis instead of recommending more of the harmful coping strategy. Preserve previous unsuccessful evaluations and distinguish acute relief from definitive cure.",
    "When continuing severe pain remains inadequately managed after prior workups, seek a specific specialist pain clinic referral and written flare protocol. In France the HAS adult SDC referral form permits a physician to justify a priority request; neither a coupe-file appointment nor acceptance is guaranteed.",
    "When a client says one symptom is the root preventing change, compare known lower-symptom periods with what problems remained and identify plausible conditions that keep bringing the symptom back; treat the causal proposal as a hypothesis.",
    "For a repeated harmful coping choice, check recorded previous cessation attempts and why use resumed, including sleep, pain, loneliness, or an intensely valued feeling, before making withdrawal the presumed obstacle.",
    "Ask what component of an intensely valued inner state matters most and which non-harmful activities or methods have already provided some of it, without proposing a list of hidden meanings as the person's answer.",
    "Before suggesting an access barrier, test whether it changes practical access through social networks or local availability; choose only feasible and accepted protection.",
    "Where a practice produces a rapid partial body relaxation change, ask which method, how long relief lasts if continued or stopped, and how usable it is during daily demands rather than inferring all anxiety vanished.",
    "When a spontaneous feeling invites an unsuitable action, help choose a consent-respecting practical boundary rather than treating the feeling itself as a diagnosis or wrongdoing.",
    "Address a documented, modifiable sleep or environmental barrier and examine when an already-tested calming method works before a severe escalation; preserve causation uncertainty.",
    "If shame follows real harmful conduct, choose feasible repair, changed behavior and legitimate accountability rather than a numerical blame allocation or demand for another person's forgiveness."
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

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.REFRACTORY_PAIN_CARE_PATHWAY]]

[[current/governance/amendments/AMEND.CROSS.RESPONSE_FIDELITY_20261025]]

[[current/governance/amendments/AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025]]

[[current/governance/amendments/AMEND.CROSS.FEELING_AGENCY_AND_REFERRAL_FIT_20261026]]

[[current/governance/amendments/AMEND.CROSS.EARLY_REGULATION_CONDITION_20261026]]

[[current/governance/amendments/AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029]]
