# Retention, refusal, revocation, and deletion boundary

**Status:** offline requirements only. No live retention schedule or data lifecycle is
selected or implemented.

- A free user can refuse the displayed generalized candidate at no charge.
- Refusal affects only that candidate and does not reduce product access.
- Revocation and deletion must remain available without payment before any live contribution
  system is released.
- Existing local candidates are never backfilled under this policy.
- Raw therapy chat is never an eligible contribution record.
- No current artifact chooses an InnerSignal retention duration, withdrawal window, grace
  period, deletion SLA, or provider storage configuration.
- Provider-side handling is disclosed separately. OpenAI's default API abuse-monitoring
  retention statement is a provider fact, not an InnerSignal retention choice.
- A future live design must specify the exact stored object, controller, processor, purpose,
  retention lifecycle, deletion semantics, revocation scope, audit residue, and jurisdictional
  handling, then receive a new bounded review before implementation.

The offline state machine deliberately stops at `default-contribution-pending-release` or
`candidate-refused`; live transport is disabled.
