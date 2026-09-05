# Companion foundations: fictional-data interface, revision 2

This is a standalone design prototype, not a live therapist, model integration, memory system, or installed InnerSignal feature. It remains fictional-only and non-persistent.

Revision 2 moves fictional-history consent into the progress/example workspace; adds three fixed fictional source corrections that invalidate obsolete readings; and demonstrates a one-use delayed-reply freshness guard. The separate task-level `reflection-controller.mjs` now demonstrates a multi-stage current-snapshot -> draft -> explicit semantic review -> display boundary, with semantic approval denied by default. The controller is not wired into this page and is not a live model pipeline.

## Use

Build with the repository's supported Node runtime:

```bash
node tasks/companion-foundations-20260905/mock/build.mjs /tmp/InnerSignal-companion-preview.html
```

The output is one HTML file with no server, package installation, external assets, network calls, telemetry, cookies, or persistent browser storage. The prepared HTML is a generated artifact, not product-policy authority.

The page demonstrates independent inner-child/spiritual invitation preferences; fictional-history permission; on-request/occasional/off progress reflections; five source-linked fictional histories; mixed evidence; recognition of growth through friends; abstention when distinct history is missing; rejection, source correction/withdrawal and explicit fictional reset; optional self-guidance versus direct support; and unconditional exit.

A source correction or withdrawal clears the old reading. Returning to prior settings cannot resurrect it. The delayed-reply controls show that an old request is invalid after relevant state changes. That test establishes freshness behavior only—not semantic correctness.

## Evidence limits

All reflections/support replies in this page are prewritten and explicitly labeled examples. The metadata is hand-authored. The preview does not demonstrate that a model can reliably extract evidence, avoid sycophancy, detect deterioration, conduct therapy, or honor real-data deletion. `safetyClear: true` in fixtures is not a clinical safety assessment or production default.

Do not enter real personal data into the page or adapt it for real histories without the separately reviewed privacy/vault integration. Ending/reloading clears page state but is not a secure-erasure claim about real information.

## Tests

Task-local deterministic suite:

```bash
node --test tasks/companion-foundations-20260905/reflection-handoff.test.mjs \
  tasks/companion-foundations-20260905/reflection-controller.test.mjs \
  tasks/companion-foundations-20260905/mock/model.test.mjs \
  tasks/companion-foundations-20260905/mock/revision.test.mjs
```

Current local result: **77 passed, 0 failed** on Node v22.16.0. This count does not include the original 30 `policy.test.mjs` tests, which were not present in the extracted continuation workspace for this exact run.

Revision-2 browser evidence remains **64 assertions** in Chromium 144.0.7559.96 at 1400x1100, 390x844 and 320x720, using `set_content` with the exact generated HTML, with zero page network requests, page errors or CSP console errors. File-scheme navigation was not tested because managed browser policy blocked it.

Exact-head Node 24/full-repository verification is owned by hosted CI after publication. The original 16 model behavior cases remain unevaluated.
