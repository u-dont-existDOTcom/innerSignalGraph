---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.DRAFT_RETURN_TO_CARE
title: Return to the first draft for understanding and care
kind: decision-node
tier: 4
priority: 88
authority: owner-approved-extension
graph_tags:
  - wisdom-practice
  - return-to-care
  - optional
source_refs:
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.WISDOM_DRAFT_RETURN
  - AMEND.IC.WISDOM_SOURCES
regression_refs: []
base_record_sha256: 67f1f7fdb2953b8f87def0213588e1234b4927017bd03873cded71893a810c6c
base_graph_sha256: a82fe28e2917f3c301b588e770ee0e367ee56286abd94ed9cf4b37a34459fb08
projection_input_sha256: 1f98e966e76da6e426ced6cfc6e014ba9b97033cb71512468963415ca21e4169
---

# Return to the first draft for understanding and care

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "perspective_practice",
        "op": "eq",
        "value": "return_to_care"
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
      "Outward completion is not inward completion. Declining further work is not failure."
    ]
  },
  "recommendations": [
    "After the reported outward response or decision, return to the original writer's experience without scolding them for it. Mental recall is enough; do not require a stored draft.",
    "Attend to the actual hurt, need, protest, responsibility or limit. Offer feasible Nurturer/Protector/Guide care; the adult acts before requiring belief or reassurance from a part.",
    "Use existing guard, credibility, borrowed-function, protection or deeper-dialogue routes only as actually needed and within their existing gates. Do not infer a younger self or childhood memory.",
    "Track the return separately from communication success. Respect a wish to defer, stop or decline; preserve unfinished work without making it a compulsory assignment or another reassurance loop."
  ],
  "successSignals": [
    "The person reports understanding, helpful care, an appropriate protective action or a freely chosen ending."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.IC.WISDOM_DRAFT_RETURN]]

[[current/governance/amendments/AMEND.IC.WISDOM_SOURCES]]
