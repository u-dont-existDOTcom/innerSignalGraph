# Inner Signal Agent Instructions

<!-- therapy-owner-decision-protocol-v1 -->

## Required therapy-governance context

Before any work involving therapy, hypnosis, somatic practice, a Guide Packet, a guide, a graph, a prompt, safety policy, evidence policy, or a therapy regression, read all three root ledgers: `THERAPY-LESSONS`, `SUGGESTED-THERAPY-LESSONS`, and `APPROVED-THERAPY-LESSONS`.

The ledgers have different authority. `THERAPY-LESSONS` is chronological audit history. `SUGGESTED-THERAPY-LESSONS` is the current guide-impacting decision queue. `APPROVED-THERAPY-LESSONS` contains only explicit owner approvals. Governance-design approval, review findings, model recommendations, and existing candidate history are not therapy-policy approval.

## Direct owner-decision protocol

For every therapy, hypnosis, somatic, guide, graph, prompt, safety, or evidence-policy decision:

1. Complete safe deterministic repairs that do not require owner judgment, or clearly separate those repairs from the owner choice.
2. Ask Joel directly in the active conversation. Ask one substantive decision at a time unless Joel explicitly asks to bundle them.
3. State the exact decision and why it is needed now.
4. Describe the evidence and its limitations, including whether each source is canonical, owner-authored, external, anecdotal, or independently validated.
5. Present each viable option with concrete benefits, costs, and worst plausible failure.
6. Give a recommendation with detailed reasoning, while keeping that recommendation visibly distinct from Joel's decision.
7. Enumerate the downstream effects on guides, graph nodes, prompt routing, safety gates, and regression cases.
8. State that no answer leaves current policy unchanged.
9. Record only Joel's explicit answer. Never infer approval from silence, prior general enthusiasm, a model verdict, a recommendation, or a suggested default.
10. Commit the resulting ledger transition and its tests to Git before treating the decision as durable development guidance.

If direct conversation with Joel is unavailable, leave the suggestion pending and leave production policy unchanged.

## Privacy boundary

Never store private therapy transcripts or other private therapy-session material in these ledgers or elsewhere in the repository. Record only the concise policy decision, its bounded rationale when Joel supplies one, affected identifiers, and non-private verification evidence needed for the development audit trail.
