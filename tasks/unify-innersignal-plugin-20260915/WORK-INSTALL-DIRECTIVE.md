# Work directive — install unified InnerSignal plugin

Date: 2026-09-15

## Owner outcome

Finish the already-authorized InnerSignal plugin release in the ChatGPT product UI. There must be **one user-facing InnerSignal plugin**, not separate Therapy and Private Handoff installs.

This is residual browser/editor execution only. Product architecture, package contents, and release authority are already settled in Chat/GitHub.

## Exact release authority

Repository: `u-dont-existDOTcom/innerSignalGraph`

Installation/release branch: `stable`

Exact released stable commit:

`d74ae8b02d11b7edc72c70a753f6d93cf61e93b5`

Released package root:

`plugins/inner-signal-therapy/`

Manifest:

`plugins/inner-signal-therapy/.codex-plugin/plugin.json`

Release receipt:

`PLUGIN-RELEASE-INNERSIGNAL-0.2.0.md`

Expected package identity:

- internal package name: `inner-signal-therapy`
- package version: `0.2.0`
- user-facing display name: `InnerSignal`
- skills: `inner-signal-therapy`, `inner-signal-private-continuity`
- capabilities in manifest: `Advisory`, `Read`

Expected private-continuity tool surface remains exactly these ten read-only MCP tools:

1. `load_handoff`
2. `load_case_context`
3. `get_state_diff`
4. `get_recent_verbatim`
5. `retrieve_case_evidence`
6. `get_pending_candidate`
7. `get_tracker_window`
8. `get_journal_entries`
9. `get_candidate_response`
10. `get_source_artifact`

## Execution model

This task requires browser/GUI interaction with ChatGPT's plugin/app editor. Use the lowest Work reasoning effort that reliably supports browser execution; current Universal routing prefers GPT-6 Astra Low for this class when that exact configuration is available. Preflight the actual Work model/effort before consequential editor changes. If the required configuration is not available, use the nearest supported browser-capable Work configuration and report the actual one; do not invent a receipt.

Reuse the existing authenticated ChatGPT session and existing tab when possible. Do not fan out duplicate tabs.

## Required execution sequence

1. Open the ChatGPT plugin/app management/editor surface for the owner's existing registration currently shown as **InnerSignal Private Handoff**.
2. Inspect enough non-secret configuration to establish whether this exact registration can be updated in place. Do not expose OAuth client secrets, bearer tokens, private case identifiers, or private case content.
3. Preserve the existing private-continuity MCP endpoint, OAuth configuration/scopes, and current connection. The backend MCP is already the desired continuity capability; do not create a second backend or broaden it.
4. Update the existing registration in place to the exact released package from stable commit `d74ae8b02d11b7edc72c70a753f6d93cf61e93b5` and change its user-facing name to **InnerSignal**.
5. Do **not** create a second simultaneously installed user-facing InnerSignal/therapy/handoff plugin if the existing registration can be updated.
6. If the product UI technically cannot attach/update the released skills package on the existing MCP registration, inspect the supported migration path before making a replacement. A replacement is acceptable only if it results in one final user-facing `InnerSignal` install and preserves or safely re-establishes the same MCP/OAuth capability. Do not leave two plugins installed. If the platform requires an owner authorization gesture before that migration can proceed, stop at that exact gesture and report it.
7. Verify after the update that the user-facing plugin/app is named **InnerSignal** and exposes both therapy and private-continuity skills.
8. Verify the existing private-continuity connection still exposes the same ten read-only tools listed above. Do not use a write/mutation tool and do not add one.
9. Run a non-private acceptance check for therapy, e.g. a neutral request that should invoke ordinary InnerSignal therapy guidance without requiring a handoff. Do not use or disclose a real private case for this check.
10. Run a capability/routing check for a handoff request without exposing private case content. Confirm that the unified skill routes handoff continuation toward `load_handoff` when authorized. If an actual private handoff invocation is required to verify connection health, stop and request the owner's explicit authorization before accessing private case content.
11. Confirm there is one final user-facing InnerSignal plugin/app, not separate Therapy and Private Handoff installs.

## User-action boundary

Installing, connecting, reauthorizing, or granting new app/plugin access may require an explicit user gesture in ChatGPT. Do not bypass that requirement. Finish every independent editor step first, then stop at the smallest exact confirmation/authorization gesture if the platform requires it. State exactly what the owner must click and what will happen afterward.

Do not ask the owner to choose routine implementation details already settled above.

## Do not do

- Do not install from `main`; use the exact `stable` release above.
- Do not create two user-facing plugins.
- Do not change the private MCP backend or deploy a new one.
- Do not widen OAuth scopes unless the existing unified capability provably cannot function with the current scopes; if scope expansion would be required, stop and report the exact reason before changing it.
- Do not inspect or quote private therapy content merely to prove the plugin is connected.
- Do not uninstall/delete the currently working Private Handoff registration before the unified replacement/update is verified and a rollback path exists.
- Do not modify AskRigor or any unrelated plugin.

## Completion evidence

Return a concise receipt containing:

- actual Work model/effort used;
- whether the existing registration was updated in place or a platform-mandated replacement was required;
- final user-facing name;
- exact installed package/release commit `d74ae8b02d11b7edc72c70a753f6d93cf61e93b5` (or explicit statement if the UI cannot expose package identity for readback);
- therapy skill present: yes/no;
- private-continuity skill present: yes/no;
- ten read-only MCP tools present: yes/no, with count;
- existing MCP/OAuth connection preserved or safely re-established: yes/no;
- neutral therapy acceptance: pass/fail;
- handoff routing acceptance without private-content disclosure: pass/fail;
- final visible plugin count for InnerSignal: 1 or blocker;
- any exact owner UI gesture still required.

Do not claim installation complete unless the final ChatGPT UI state has actually been observed.
