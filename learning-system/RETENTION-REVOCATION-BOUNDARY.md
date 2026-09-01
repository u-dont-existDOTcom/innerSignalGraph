# Retention, refusal, revocation, and deletion boundary

**Status:** local loopback lifecycle implemented. No remotely hosted retention schedule or
off-device data lifecycle is selected or implemented.

- A free user can refuse the displayed generalized candidate at no charge.
- Refusal affects only that candidate and does not reduce product access.
- Revocation and deletion must remain available without payment before any live contribution
  system is released.
- Existing local candidates are never backfilled under this policy.
- Raw therapy chat is never an eligible contribution record.
- The private local queue retains a strict derived candidate until the user revokes its last
  occurrence or a maintainer applies a non-authoritative review disposition. Final occurrence
  revocation removes the candidate and its local review metadata with no residue in this queue.
- No current artifact chooses a remotely hosted InnerSignal retention duration, withdrawal
  window, grace period, deletion SLA, or provider storage configuration.
- Provider-side handling is disclosed separately. OpenAI's default API abuse-monitoring
  retention statement is a provider fact, not an InnerSignal retention choice.
- A future live design must specify the exact stored object, controller, processor, purpose,
  retention lifecycle, deletion semantics, revocation scope, audit residue, and jurisdictional
  handling, then receive a new bounded review before implementation.

The local state machine may reach `contributed-local-loopback` only after preview and an
explicit continuation action. Off-device transport remains disabled.
