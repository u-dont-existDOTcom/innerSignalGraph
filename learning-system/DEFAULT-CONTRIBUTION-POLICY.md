# Default contribution policy — offline draft

**Status:** product/privacy policy model only; no live transmission, queue, signup, billing,
or release is enabled.

## Current product decision

Free InnerSignal community learning is **default-on with free per-candidate refusal**. The
only eligible unit is a privacy-screened, generalized lesson candidate. Raw therapy chat is
never an eligible contribution. Before any future submission, the generalized candidate
must be shown to the user. The user may choose **Do not contribute this candidate** at no
charge, without losing or reducing access. That refusal applies only to the displayed
candidate and does not suppress later candidate notices.

The paid API path may eventually provide a global community-contribution control. Whether
that future paid control starts on or off is deliberately
`UNSPECIFIED_PENDING_FUTURE_BILLING_UI_DECISION`; this draft does not choose a default.

## Offline state model

The model has only these states:

1. `generalized-candidate-ready`
2. `preview-required`
3. `default-contribution-pending-release`
4. `candidate-refused`
5. `blocked-live-transport-disabled`

There is no transmitted state. Showing the preview and receiving no refusal can produce
only `default-contribution-pending-release`, because live transport remains disabled. A
later transition is mechanically blocked. Refusal produces `candidate-refused`; it never
changes access. No timing window or grace period is selected here.

Existing local candidates are not backfilled. A future release needs a separately reviewed
transport, revocation, deletion, provider, signup, and retention implementation.

## Epistemic and therapy boundary

Community-learning contribution is evidence collection, not automatic truth. A disagreement,
correction, or outcome report does not by itself change InnerSignal therapy policy.
Generalized candidates require review, and any later therapy-policy change remains separately
owner-approved and regression-tested.

The owner product/privacy receipt for this policy has `therapyPolicyAuthority: none`. It
cannot approve a guide, graph, prompt, safety rule, evidence rule, or therapy behavior.
