# Inner Signal v0.14.2 — Guide Packet Source and Service Recovery

## Release boundary

This release corrects Guide Packet evidence transport, makes the candidate graph own its advanced-release safety block, isolates Guide Packet status from unrelated development history, and keeps recovery services online after deterministic validation or promotion failure.

It does not alter the canonical inner-child or somatic prose, approve any owner decision, install a candidate, or change the active production graph bundle `inner-child-somatic-pilot-2026-08-09-r5`.

## Corrected r02 candidate

`inner-signal-guides-2026.08.12-r02-candidate` supersedes r01 as the bundled active candidate. The guide revisions remain `r01-candidate` because their canonical prose is unchanged. The original r01 ZIP remains byte-for-byte preserved at SHA-256 `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`.

When an uninstalled r01 candidate already exists, startup stages r02 without mutating r01. An owner decision carries forward only when the complete decision contract is identical; new or changed decisions stay pending. Installed production policy remains untouched.

## Complete model input and provenance

The compiler reconstructs every section from the verified canonical HTML and sends the complete source text to Opus. Empty or truncated `textPreview` fields are no longer treated as model evidence.

The corrected packet also includes the source PDF and exact page-5 text used for the Vagal Blitz safety claim. The manifest records the page, source hashes, and `independentlyValidated=false`. Provenance identity is therefore explicit without representing the source as independently established medical evidence.

## Graph-owned safety

`SOM.ADVANCED_RELEASE_BLOCK` explicitly declares that it blocks `SOM.ADVANCED_RELEASE_OPTIONAL`. The planner still retains its legacy fallback for the unchanged production r5 bundle and preserved r01 compatibility, while r02 owns the rule in graph data.

The affected suite adds `G-SOM-ADVANCED-BLOCK`. Its mutation check removes the graph-owned block and must fail, proving the fifth regression exercises the safety contract rather than a hardcoded planner special case.

## Status and service liveness

When Guide Packet work is foregrounded, the web status summary and next automatic action are derived from Guide Packet state. An old development-supervisor repair directive no longer appears as the packet's current instruction.

If full validation fails, the launcher starts the local runtime and development worker instead of exiting. If promotion fails after rollback, it restarts the health, status, Guides, and export service, retains the failed marker fingerprint, and retries only after the candidate changes. Integration tests exercise both failure paths through `/health`, `/v1/dev/status`, `/v1/guides/status`, and `/v1/debug/export`.

## Owner gate

The corrected candidate contains five affected regressions and five substantive decision cards. Deterministic verification, model compilation, independent review, recovery, and packaging cannot approve or install it. Installation still requires every substantive decision to be approved and the approved derivative to pass atomic install verification.
