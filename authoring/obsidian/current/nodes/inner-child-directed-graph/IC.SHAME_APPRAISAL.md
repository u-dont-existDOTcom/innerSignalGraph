---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SHAME_APPRAISAL
title: Differentiate shame signals, social judgments, responsibility, and viable repair
kind: decision-node
tier: 3
priority: 40
authority: owner-approved-extension
graph_tags:
  - shame
  - social-judgment
  - accountability
  - repair
  - belonging
source_refs:
  - IC.SHAME_APPRAISAL
  - AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029
regression_refs:
  - G008
  - G109
  - G150
  - G151
base_record_sha256: 1d0f14a0534bfe11d5d0c434e41f95fc014d879bb0710ae775200082e8b693de
base_graph_sha256: 0c38adc879614295b16177b952b4979fb80fb50a72e6fc31043b66ac3653b474
projection_input_sha256: 6e45a3a2b88cd00dadfa2393874ee745c979fed13684d70bf9028d581529a7f8
---

# Differentiate shame signals, social judgments, responsibility, and viable repair

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "self_criticism",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "belonging_pressure",
        "op": "eq",
        "value": "present"
      }
    ],
    "none": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
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
    "Do not use disclosure to an unpredictable or hostile listener merely to test a fear of rejection, and do not dismiss accurate rejection predictions as irrational.",
    "Do not assign numerical percentages of responsibility, require reconciliation or promise that apology produces renewed trust.",
    "Do not call the shame feeling itself a malfunction, endorse global worthlessness or conflate involuntary experience with chosen harmful conduct."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that rejection proves wrongdoing, or acceptance proves innocence."
    ],
    "requiredNuance": [
      "Social acceptance, rejection risk and moral rightness are different variables.",
      "Disclosure, accountability, self-care and differentiation serve different functions; no generic exposure ladder."
    ]
  },
  "recommendations": [
    "When shame matters to the active focus, separate the felt rejection alarm, actual social behavior, predicted judgment, chosen conduct and values, inherited self-treatment, and avoidance or self-blame. These can coexist; ask only distinctions that change the next action.",
    "Actual or predicted group rejection is not proof of moral wrongdoing. Acceptance does not prove harmlessness either. Appraise social evidence and independent ethical obligations separately.",
    "For genuinely harmful conduct, support specific acknowledgment, realistic reparability, changed behavior and appropriate consequences; release from endless self-punishment does not depend on forgiveness or restored trust.",
    "When shame is followed by shame about being ashamed or other cruel self-criticism, preserve the initial feeling, inquire into any protective purpose of the secondary attack, and change the self-treatment through existing Nurturer, Protector, Guide and guard work.",
    "Where rejection under unfair group expectations continues, consider boundaries, selective belonging and safe alternatives instead of repeating hostile or unpredictable disclosure.",
    "Use existing relational, action, forgiveness, guard, common-humanity and community routes rather than a compulsory shame exposure or novel parts ritual."
  ],
  "successSignals": [
    "Responsibility, legitimate protection, and freedom from an unsupported global verdict are separated clearly enough to support one feasible next move."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.SHAME_APPRAISAL]]

[[current/governance/amendments/AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029]]
