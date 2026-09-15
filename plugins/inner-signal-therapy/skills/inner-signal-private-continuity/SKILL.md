---
name: inner-signal-private-continuity
description: Continue InnerSignal work from an authorized private handoff or case using the existing read-only continuity tools inside the same InnerSignal plugin.
---

# InnerSignal private continuity

This is a capability of the same **InnerSignal** plugin as `inner-signal-therapy`. Do not tell the user to install, enable, or switch to a second handoff plugin.

Use the host's authenticated private continuity MCP only when its tools are actually available. It is read-only. Never claim that this skill itself stores, mutates, approves, sends, or deletes private case data.

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

Do not call tools merely to collect everything. Prefer `load_handoff` as the normal one-call bootstrap, then retrieve only missing evidence that materially changes the current response.

## Authentication and capability boundaries

If authentication is required, let the host surface its ordinary connection/authorization flow. Do not ask the user to paste bearer tokens, credentials, keys, private locator databases, or secret material into chat.

If the current host does not expose the required tool, authentication fails, access is denied, or the handoff is not continuation-safe, state that exact boundary. Do not silently substitute a summary, public fixture, stale memory, regenerated candidate, or another person's context.

## Therapy continuation

After exact context is available, apply the `inner-signal-therapy` skill to the live user request. Preserve the distinction between exact transcript evidence, structured state, hypotheses, and current interpretation. Private continuity supplies context; it does not make every prior inference true.

Do not expose hidden chain-of-thought. Do not publish private case content or identifiers outside the user's authorized conversation merely because the tools can retrieve them.
