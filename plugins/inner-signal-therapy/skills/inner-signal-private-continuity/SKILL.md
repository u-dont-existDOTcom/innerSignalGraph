---
name: inner-signal-private-continuity
description: Continue an authorized InnerSignal case from current private evidence on every case-related turn, using the read-only continuity tools in the same InnerSignal plugin and reporting unavailable or uncontrolled coverage truthfully.
---

# InnerSignal private continuity

This is a capability of the same **InnerSignal** plugin as `inner-signal-therapy`. Do not tell the user to install, enable, or switch to a second handoff plugin.

Use the host's authenticated private continuity MCP only when its tools are actually available. It is read-only. Never claim that this skill itself stores, mutates, approves, sends, or deletes private case data.

## Per-turn activation

Treat relayed replies, corrections, translations used to compose a reply, and ordinary follow-ups as case-related turns. A case selected earlier in the conversation remains selected unless the user changes it or there is genuine ambiguity; do not routinely ask the user to identify it again.

Before case-specific interpretation, recover the current case state and complete active episode, then retrieve older exact evidence made relevant by the new message. Search raw history as well as the short structured state. Keep original reports, supervisor observations, hypotheses, proposed drafts, translations, and confirmed outgoing wording distinct. Never claim that a source or date was verified unless a tool result establishes it.

Before drafting, check which earlier relationships, intervention responses, exceptions, answered questions, and unresolved questions become relevant or testable under the new conditions. A changed condition may justify a recheck; it does not erase an earlier answer or establish a new outcome. Preserve the longer-term therapeutic agenda when the immediate focus changes.

Before delivery, check the actual reply for repeated answered questions, omitted decision-relevant history, unsupported certainty, and disagreement with later corrections. Keep the reply conversational rather than reciting this checklist. This same-context check is not an independent audit.

## Fresh-session bootstrap

When the user provides an InnerSignal `handoff_id`, call `load_handoff` first. Treat a successful returned handoff as the continuation authority for that private episode. Do not reconstruct prior therapy from memory, public repository summaries, or guesses when exact private context is available.

When the user instead supplies or clearly selects an authorized private case and no handoff identifier is available, use `load_case_context` when the host exposes it. Use narrower tools only as needed:

- `get_state_diff` for the frozen/current structured change;
- `get_recent_verbatim` for the exact active episode;
- `retrieve_case_evidence` for older exact evidence;
- `get_pending_candidate` or `get_candidate_response` for exact candidate text;
- `get_tracker_window` for descriptive longitudinal tracker data;
- `get_journal_entries` for exact journal/dream entries without promoting them into settled facts;
- `get_source_artifact` for an authorized exact source artifact.

Do not call tools merely to collect everything. Prefer `load_handoff` as the normal one-call bootstrap, then retrieve only missing evidence that materially changes the current response. On later case-related turns, refresh the current context rather than assuming the earlier tool result is still current.

## Authentication and capability boundaries

If authentication is required, let the host surface its ordinary connection/authorization flow. Do not ask the user to paste bearer tokens, credentials, keys, private locator databases, or secret material into chat.

If the current host does not expose the required tool, authentication fails, access is denied, or the handoff is not continuation-safe, state that exact boundary. Do not silently substitute a summary, public fixture, stale memory, regenerated candidate, or another person's context.

Ordinary chat messages that did not pass through a controlled case-turn surface have unknown controlled coverage. Do not describe them as durably captured, prepared, independently reviewed, approved, sent, or externally delivered. When a controlled runtime is available, submit the exact draft against its recorded preparation and report only the server's actual status. A rewrite or translation is a new artifact unless exact identity is established.

Do not silently change model, billing route, permissions, or mode to work around a missing capability. Immediate safety support must not wait for technical recovery, but it must remain clearly scoped to the evidence actually available.

## Therapy continuation

After exact context is available, apply the `inner-signal-therapy` skill to the live user request. Preserve the distinction between exact transcript evidence, structured state, hypotheses, and current interpretation. Private continuity supplies context; it does not make every prior inference true.

Do not expose hidden chain-of-thought. Do not publish private case content or identifiers outside the user's authorized conversation merely because the tools can retrieve them.
