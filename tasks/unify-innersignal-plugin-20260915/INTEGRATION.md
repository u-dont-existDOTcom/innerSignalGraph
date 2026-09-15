# Unified InnerSignal ChatGPT plugin — 2026-09-15

## Owner outcome

The owner wants one user-facing InnerSignal plugin, not separate Therapy and Private Handoff plugins. The existing authenticated private continuity MCP is a backend capability of InnerSignal and should remain attached to the same installed plugin as the therapy skills.

## Product decision

- One user-facing plugin name: **InnerSignal**.
- Preserve the existing internal package identifier `inner-signal-therapy` to avoid unnecessary package-identity churn.
- Keep therapy and private continuity as separate skills inside the same plugin package because they have different activation conditions and evidence boundaries.
- Preserve the existing authenticated read-only private continuity MCP and its ten tools; do not duplicate, replace, or broaden that backend merely to unify the UI identity.
- Do not create or ask users to install a second handoff/continuity plugin.
- Host-native multimodal therapy input remains part of the therapy skill.

## Implementation

- `.codex-plugin/plugin.json` now displays `InnerSignal`, advertises Advisory + Read capability, and includes private-handoff continuation among starter prompts.
- `skills/inner-signal-therapy/SKILL.md` explicitly routes handoff/private-case continuation through the same plugin when the host exposes the continuity tools.
- `skills/inner-signal-private-continuity/SKILL.md` defines exact fresh-session behavior around `load_handoff`, narrower evidence retrieval, OAuth/capability failures, and return to therapy after context recovery.
- `tests/inner-signal-plugin-unification.test.mjs` mechanically binds the one-plugin identity and all ten read-only MCP tool names to the live MCP source.

## Release/install boundary

Repository work and ChatGPT installation are separate surfaces. Chat owns this architecture and ordinary GitHub work. Browser/editor execution is residual Work/Computer-Use work only after a reviewed release source exists.

The final editor task must update the **existing** user-visible `InnerSignal Private Handoff` registration rather than create a second plugin:

1. preserve its existing MCP endpoint, OAuth configuration, scopes, and connection;
2. install/update the exact reviewed unified InnerSignal package;
3. rename the user-facing registration to `InnerSignal`;
4. verify the package skills plus the same ten read-only tools are available;
5. verify an ordinary therapy prompt works without requiring a handoff;
6. verify a handoff request routes to `load_handoff` when authorized;
7. do not expose or copy private case content during installation verification unless the owner explicitly requests a live private-data acceptance test.

If the ChatGPT editor requires a new user authorization gesture, authentication, or account-level confirmation, stop at that UI gate rather than bypassing it.

## Assurance

This task is at a merge/release boundary because the owner explicitly requested installation. Main-branch merge requires the repository's exact hosted gates. Actual ChatGPT installation must use a reviewed release source rather than an unreviewed task branch. Promotion of unrelated runtime changes is not implied by this plugin request.
