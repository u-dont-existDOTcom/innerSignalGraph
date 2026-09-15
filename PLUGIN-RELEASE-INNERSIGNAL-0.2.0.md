# InnerSignal plugin 0.2.0 release receipt — 2026-09-15

Purpose: release only the unified ChatGPT plugin package, without promoting unrelated development-runtime changes from `main`.

Source development merge: `3a6e065097e36aac3096549b9f734d2ea3a5c557`.

Exact package blobs copied from reviewed `main`:

- `.codex-plugin/plugin.json`: `4a1f9b08b23da2facd85875c19cc3660a159938c`
- `skills/inner-signal-therapy/SKILL.md`: `91e337e39f2fc2ea8bcea4ef415b3e7c06cd6f04`
- `skills/inner-signal-private-continuity/SKILL.md`: `b7561064fdbf82e67a4edd1642bc79851e300b54`
- `skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md`: `1fb150a0a0c2a05188fa3acf35d0f564fde9395d`
- `skills/inner-signal-therapy/references/PHENOMENOLOGY-AND-REPRESENTATION.md`: `6b66a331042c6ce8470e8c5f63e80e4dbc195180`

Release semantics:

- one user-facing plugin: **InnerSignal**;
- therapy and private continuity are separate skills inside that one package;
- preserve the already-deployed authenticated read-only private continuity MCP connection;
- do not create a second handoff plugin;
- no runtime/backend deployment is authorized by this receipt;
- actual ChatGPT editor installation remains a separate browser/Work action and must preserve the existing MCP/OAuth registration.
