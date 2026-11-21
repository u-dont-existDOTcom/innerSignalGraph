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
  - AMEND.IC.GENTLER_THAN_GUIDE_20261120
  - IC.LIVE_GUIDE_DECISIONS_20261120
regression_refs:
  - G150
  - G151
  - G152
  - G153
  - G154
base_record_sha256: fd5f42125e0e634d7c3a4f94ddd361f5ba7b53a3cfc1a45426f39e6e7cbfe8d5
base_graph_sha256: ce32de79718f698e5051277ebfab6d31ef36b073338d1facbe2cbd68f5ef4519
projection_input_sha256: 9871a63c8240a1413f67f7da724b7a07e7c7069f2a41c45d1fdd6df3c2921de2
---

# Differentiate shame signals, social judgments, responsibility, and viable repair

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "shame_context",
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
    "Do not use disclosure to an unpredictable or hostile listener merely to test a fear of rejection, and do not dismiss accurate rejection predictions as irrational.",
    "Do not assign numerical percentages of responsibility, require reconciliation or promise that apology produces renewed trust.",
    "Do not call the shame feeling itself a malfunction, endorse global worthlessness or conflate involuntary experience with chosen harmful conduct.",
    "Do not infer shame merely from self-criticism or belonging pressure when the person has not supplied evidence of shame."
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
    "Apply this branch only when the current case evidence makes shame or humiliation relevant. Generic criticism, need for belonging, guilt or conflict do not establish shame by themselves.",
    "When shame matters to the active focus, separate the felt rejection alarm, actual social behavior, predicted judgment, chosen conduct and values, inherited self-treatment, and avoidance or self-blame. These can coexist; ask only distinctions that change the next action.",
    "Actual or predicted group rejection is not proof of moral wrongdoing. Acceptance does not prove harmlessness either. Appraise social evidence and independent ethical obligations separately.",
    "For genuinely harmful conduct, support specific acknowledgment, realistic reparability, changed behavior and appropriate consequences; release from endless self-punishment does not depend on forgiveness or restored trust.",
    "When shame is followed by shame about being ashamed or other cruel self-criticism, preserve the initial feeling, inquire into any protective purpose of the secondary attack, and change the self-treatment through existing Nurturer, Protector, Guide and guard work.",
    "Where rejection under unfair group expectations continues, consider boundaries, selective belonging and safe alternatives instead of repeating hostile or unpredictable disclosure.",
    "Use existing relational, action, forgiveness, guard, common-humanity and community routes rather than a compulsory shame exposure or novel parts ritual.",
    "Finding someone trusted to open up to slowly is one of the strongest ways through shame, and relief doesn't depend on it: when the person can't open up to anyone else safely, opening up to their inner adult and/or a higher power counts too. Accountability and repair for any damage they caused still apply."
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

[[current/governance/amendments/AMEND.IC.GENTLER_THAN_GUIDE_20261120]]

[[current/sources/inner-child-guide/IC.LIVE_GUIDE_DECISIONS_20261120]]
