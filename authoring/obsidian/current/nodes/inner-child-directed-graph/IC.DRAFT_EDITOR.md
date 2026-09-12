---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.DRAFT_EDITOR
title: Edit the communication without rejecting its author
kind: decision-node
tier: 4
priority: 88
authority: owner-approved-extension
graph_tags:
  - wisdom-practice
  - draft-editor
  - optional
source_refs:
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.WISDOM_DRAFT_EDITOR
  - AMEND.IC.WISDOM_SOURCES
regression_refs: []
base_record_sha256: 16d69337c42b93ceff4ab265ae073802767a15632dfa2e7dd4024e105ffab900
base_graph_sha256: a82fe28e2917f3c301b588e770ee0e367ee56286abd94ed9cf4b37a34459fb08
projection_input_sha256: 1f98e966e76da6e426ced6cfc6e014ba9b97033cb71512468963415ca21e4169
---

# Edit the communication without rejecting its author

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
        "value": "draft_editor"
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
      "The first draft can be a mature protest; it is not automatically a child-state.",
      "A private draft is not a sent message, a settled intention, or an established account of the other person."
    ]
  },
  "recommendations": [
    "Invite a brief private mental or written draft of what the person wants to say. Keep raw draft and sendable response clearly separate; do not require disclosure or storage.",
    "Take the caring editor's position: preserve the important truth, justified protest, proportionate responsibility, realistic aim and necessary boundary. Better does not mean softer or more agreeable.",
    "Check an honest sufficient response for this actual recipient and situation. The human decides whether to send, pause, apologize, refuse or not respond. Do not send anything automatically.",
    "Make room to return to the original draft for inward care after the outward decision. Some inward care can come first if that makes editing possible. An appropriate existing draft may not need editing."
  ],
  "successSignals": [
    "The communication is more appropriate without internal abandonment.",
    "A later return to care remains visible as a separate purpose until reported, deferred or declined."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.IC.WISDOM_DRAFT_EDITOR]]

[[current/governance/amendments/AMEND.IC.WISDOM_SOURCES]]
