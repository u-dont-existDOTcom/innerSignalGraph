# Inner Signal Therapy public plugin preparation evidence

## Authority and provenance

- Directive: `ctc-innersignal-plugin-public-prep-20260831-001`
- Owner outcome: `OO-INNERSIGNAL-PLUGIN-LEARNING-20260831-E1`
- Reasoning surface: Extra High (`NO_PRO`)
- Public release authority: none
- Official requirements refreshed on 2026-08-31 from:
  - https://developers.openai.com/plugins/build/plugins
  - https://developers.openai.com/plugins/deploy/connect-chatgpt
  - https://developers.openai.com/plugins/deploy/submission

## Pre-mutation semantic freeze

- `plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md`
  SHA-256: `c6a6ae66930734c2276d8b3d5f930dd4ca22f5b1de17b347b08721d2fb2d379f`
- `plugins/inner-signal-therapy/skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md`
  SHA-256: `29b2d9b02d7017e0c6f9143a2159ebc8bb478a260680d494b4fe0b7b7656700b`

These hashes are the byte-level therapy-semantic boundary. Final package validation must
prove both files retain the same hashes.

## Product boundary

Current official documentation supports public skills-only submission and the universal
directory shared by ChatGPT and Codex. MCP is optional and is unnecessary for distributing
this static skill. Local marketplace visibility can vary by product surface, which explains
why successful Codex use does not prove ChatGPT desktop/web availability.

Static skills can guide host-model behavior and expose starter prompts. They cannot provide
publisher-controlled authentication, storage, actions, durable lesson capture, or access to
the separate local InnerSignal runtime. No public/network runtime is introduced.

## Fail-closed release state

The internal package contains the required synthetic prompts/tests and preparation drafts.
Overall submission remains externally blocked until the owner supplies and approves verified
publisher identity, public website/support/privacy/terms URLs, production branding, and
availability. Creating a Platform draft, submitting for review, and publishing are separate
future authority boundaries.

Validation results and exact-head hosted evidence are recorded in the execution receipt and
Extra High post-execution review.
