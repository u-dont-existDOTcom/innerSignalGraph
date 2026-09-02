# Privacy and consent boundary

The privacy screens accept only already-derived records that pass strict learning schemas. They
reject raw conversation-shaped input and deterministically report risks including secrets,
email addresses, phone numbers, account-like UUIDs, absolute local paths, identifying URL
queries, raw conversation formatting, long quoted spans, and address-like text.

The screen runs before and after any caller-supplied synthetic transform. Its output always includes `liveTransmissionApproved: false`. `offlineStructuralPass: true` means only that the bounded deterministic checks found no listed structural risk; it is not a privacy adequacy finding and never authorizes transmission.

Three consent policies are modeled for future reasoning: `local-only`, `per-candidate`, and
`conversation-standing`. The active external-transmission authority remains `none`. The live
local lifecycle requires an exact preview and explicit continuation action for every candidate;
there is no background timer or standing-consent implementation.

Before any real candidate can leave a user's device, Joel must make the separate owner decision required by the therapy-governance protocol. Silence leaves local-only/no-transmission unchanged.
