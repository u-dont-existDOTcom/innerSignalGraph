# Isolated executable reference

Run from the package root:

```sh
node --test reference/continuity.test.mjs
```

`continuity.mjs` demonstrates exact-text hashing, limited canonical JSON, authorized per-case source selection, preservation of linked corrections, explicit source budgets, immutable context binding, and a pure release predicate.

It is **not** the InnerSignal application, an MCP server, a ChatGPT plugin, a clinical reasoner, or a secure deployed store. The identity and authorization inputs in the unit tests are trusted test fixtures. Production must load them from the authenticated server and incumbent candidate/audit records; it must not accept the same objects from the caller. A caller-controlled `accepted_external_provenance` string proves nothing.

The source budget is serialized UTF-8 source bytes, **not** provider tokens or a demonstrated native ChatGPT context limit. The lexical/topic search is a transparent baseline. It has not demonstrated semantic recall, semantic understanding or clinical effectiveness. The application integration must preserve required source neighborhoods, episode completeness and actual model-input budgets.

Not implemented here: encrypted persistence, effective-amendment compilation, network authentication, server-side receipt registration, transactions, cross-process locks, idempotent durable outbox, native host dispatch, automatic independent reviewer, production pagination, or cancellation. Those belong to incumbent services and the execution plan, not a second toy framework.

Use the reference as specification examples and test seeds. Adapt validated behavior into existing modules; do not drop this module into production without integration review. Repository runtime is Node 24.18.0 at the inspected baseline; the artifact receipt names the different Node version actually used for these isolated tests.
