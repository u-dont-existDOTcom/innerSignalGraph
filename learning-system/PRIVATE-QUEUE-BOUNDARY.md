# Private queue boundary

The queue in this slice is a pure in-memory adapter used by tests and fabricated reviewer fixtures. It performs no filesystem persistence, HTTP request, GitHub operation, issue creation, authentication, or external write.

Canonical candidate fingerprints are computed by the adapter rather than trusted from a mock client. Candidate-scoped occurrence tokens allow recurrence deduplication without cross-candidate linkage. A retry with the same occurrence token converges on one receipt; a distinct token increments recurrence. Revocation uses a separate opaque token and removes only the matching mocked occurrence.

Contradictory outcome directions are grouped by explicit bounded `subjectKey` and retained separately. A worsening minority is never hidden by a benefit majority. Counts never upgrade evidence class, causal boundary, runtime authority, therapy-policy authority, or transmission authority.

If the adapter is unavailable, all counts are `null` with a reason code. Unavailability is never displayed as zero.

An eventual least-privilege GitHub App would require only repository metadata read and issues read/write. Contents, commits, pull requests, actions, administration, secrets, and organization-wide access are explicitly forbidden. This is documentation only: no App, token, repository, webhook, issue, or endpoint is created.
