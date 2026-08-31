# Private correction-learning evidence

## Reviewed execution boundary

- Directive: `ctc-innersignal-private-correction-capture-20260831-001`
- Owner outcome: `OO-INNERSIGNAL-PLUGIN-LEARNING-20260831-E1`
- Reasoning surface: Extra High (`NO_PRO`)
- Repository: `u-dont-existDOTcom/innerSignalGraph`
- Branch / PR: `design/opt-in-community-learning-20260830` / #15
- Required start head: `243e61c2662cf9db3e6cb93c8fc7f02918fc2d89`
- Required stable ref: `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`
- Publication, network pilot, merge, stable mutation, therapy-policy activation, and
  community-derived runtime behavior: not authorized

## Candidate boundary

The saved object uses format `inner-signal-private-potential-lesson-v1`. Automatic capture
is a pure browser-local, fixed-taxonomy detector over only the user message currently being
submitted. It creates a category and fixed trigger code; the message is not copied, hashed,
fingerprinted, indexed, or serialized into lesson metadata. There is no model call and no
network call for detection.

Immutable candidate facts are:

- `sourceContentRetained: false`
- `conversationImported: false`
- `automaticTextExtraction: false`
- `communitySharing: false`
- `productImprovement: false`
- `researchUse: false`
- `runtimeAuthority: none`
- `therapyPolicyAuthority: none`

The candidate can be kept private, queued for later governance review, dismissed, or
deleted. Queueing requires a user-authored summary and explicit privacy/redaction
acknowledgement. Queueing writes no therapy ledger and grants no behavioral authority.
Lifecycle history contains fixed action codes and timestamps only; it does not duplicate a
summary or source message.

## Separation evidence

- Automatic candidates remain in the existing private browser profile and are not sent to
  InnerSignal Commons.
- The existing Commons `POST /v1/potential-lessons` explicit contribution primitive and
  schema are unchanged.
- The therapy response endpoint does not receive or return potential-lesson candidates.
- Diagnostic recovery export ignores browser state, including candidate content.
- Browser backup includes candidates for private restoration; import strictly rejects
  unsupported fields or authority escalation, and Erase local data removes the array.
- `apps/web/correction-learning.js` is self-hosted by the loopback server and contains no
  network dependency.

## Focused verification before the frozen final gate

- Focused private-app, server, and Commons-isolation suite: **PASS 47/47** in 2.01 seconds.
- Commons suite: **PASS 17/17** in 1.16 seconds.
- Commons schema/authority verification: **PASS** in 0.48 seconds.

Coverage includes every named correction signal, detector precedence, rejection of
third-party disagreement and unrelated therapy text, absence of private source content,
manual fallback, backup/reload, strict import rejection, privacy acknowledgement,
governance-review no-authority, deterministic dismissal/deletion, therapy-endpoint
isolation, diagnostic ZIP exclusion, self-hosted delivery, and unchanged Commons
integration.

The post-execution review packet supplies the frozen-diff audit, single final package gate,
commit, remote exact-head checks, GHAS annotation/new-alert readback, and stable-ref
confirmation.
