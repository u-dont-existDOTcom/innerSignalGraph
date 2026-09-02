# Correction-preservation execution evidence

**Directive:** `EH-INNERSIGNAL-CORRECTION-PRESERVATION-SLICE-20260831-001`

**Claim type:** `CHECKPOINT`

**Starting branch:** `design/opt-in-community-learning-20260830`

**Starting HEAD:** `a82b8406f63eda11ff32dcfce6a7b1717ac7a39c`

**Starting remote head:** `a82b8406f63eda11ff32dcfce6a7b1717ac7a39c`

## Starting status

The tracked tree was clean. The worktree already contained the untracked directory
`.review-handoff/`; it is unrelated existing material and remains outside this slice.

## Closed mutation set

This path list was fixed before the first source write. No source, test, or task-state
path outside it may be changed for this directive.

- `community-learning/schemas/potential-lesson.schema.json` (new bounded schema)
- `scripts/verify-community-learning.mjs`
- `src/community-learning/contracts.mjs`
- `src/community-learning/store.mjs`
- `src/community-learning/server.mjs`
- `apps/community/index.html`
- `apps/community/app.js`
- `tests/community-learning-contracts.test.mjs`
- `tests/community-learning-store.test.mjs`
- `tests/community-learning-server.test.mjs`
- `tests/community-web-client.test.mjs`
- `tests/community-learning-schema.test.mjs`
- `tasks/opt-in-community-mvp-20260830/CURRENT-STATE.md`
- `tasks/opt-in-community-mvp-20260830/CORRECTION-PRESERVATION-EVIDENCE.md`

No new runtime source module or test module is authorized. The only new source-like
artifact is the bounded JSON Schema above.

## Invariants

- Capture requires the explicit user action “Save this correction as a potential lesson.”
- No phrase detection, classifier, LLM extraction, chat import, transcript text,
  assistant response, message/session identifier, embedding, or hidden context is stored.
- Optional free text is manually entered and requires a privacy/redaction acknowledgement.
- Community sharing and product-improvement use default to and remain `false`.
- The draft has no therapy-policy or runtime authority and cannot enter Learning Cards or
  proposal exports.
- Missing therapy-governance ledgers, plugin code, `main`, and `stable` remain untouched.

## Recurring reconciliation

| Check | Initial state |
|---|---|
| `WORKER_TO_CONTRACT` | `MATCH` |
| `CONTRACT_TO_OWNER` | `PARTIAL` |
| `PRIVATE_TRANSCRIPT_RETENTION` | `NONE` |
| `AUTOMATIC_CORRECTION_EXTRACTION` | `NONE` |
| `RUNTIME_THERAPY_AUTHORITY` | `NONE` |
| `GOVERNANCE_LEDGER_MUTATION` | `NONE` |
| `PLUGIN_ACTIVE_ACCOUNT_USABILITY` | `UNPROVEN` |

Implementation, verification, diff classification, plugin integrity, and final review
evidence are appended at later checkpoints.

## Implementation checkpoint

The bounded implementation adds a separate `inner-signal-potential-lesson-v1` object and
`POST /v1/potential-lessons` path. The validator accepts only `category`, `summary`, and
`privacyAcknowledged`; unexpected fields fail closed. Stored records structurally fix
`status=potential-private-draft`, both sharing fields to `false`, `runtimeAuthority=none`,
`automaticExtraction=false`, and `conversationImported=false`. Existing state files without
the new collection remain readable and acquire it only through a serialized mutation.

The author-facing form contains no chat input or source reference. It explains that nothing
is copied automatically, requires the explicit save button, and shows saved drafts only in
the owning participant's contribution view. Account export/deletion include the private
draft; Learning Card and proposal builders continue to consume Field Notes only.

Checkpoint reconciliation:

| Check | Implementation state |
|---|---|
| `WORKER_TO_CONTRACT` | `MATCH` |
| `CONTRACT_TO_OWNER` | `PARTIAL` pending independent review |
| `PRIVATE_TRANSCRIPT_RETENTION` | `NONE` |
| `AUTOMATIC_CORRECTION_EXTRACTION` | `NONE` |
| `RUNTIME_THERAPY_AUTHORITY` | `NONE` |
| `GOVERNANCE_LEDGER_MUTATION` | `NONE` |
| `PLUGIN_ACTIVE_ACCOUNT_USABILITY` | `UNPROVEN` |

## Verification checkpoint

- Focused correction/Commons suite: **PASS 16/16**.
- `npm run community:test`: **PASS 17/17**.
- `npm run community:verify`: **PASS**.
- `npm test`: **PASS 458/458**.
- `npm run audit:repository`: **PASS**, one known unrelated
  `hosted-github_app_permissions` warning.
- `git diff --check`: **PASS**.

Representative ordinary posts containing “That didn't work,” “That doesn't make sense,”
and explicit disagreement/correction leave `potentialLessons` empty. Contract and HTTP
tests reject injected `messageId`, `sessionId`, `transcript`, and `assistantResponse` fields.
Store/API tests confirm default-false sharing, no runtime authority, no card aggregation,
no proposal export, and no eligible-Field-Note count effect.

## Read-only plugin integrity checkpoint

At remote object `ff97434ee2b70b19b03e35394c8166e17ba8ff81`, the package contains exactly:

- `.codex-plugin/plugin.json`;
- `skills/inner-signal-therapy/SKILL.md`;
- `skills/inner-signal-therapy/references/INNER-CHILD-THERAPY-MAP.md`.

The remote and cached map SHA-256 values are both
`29b2d9b02d7017e0c6f9143a2159ebc8bb478a260680d494b4fe0b7b7656700b`; manifest, skill,
and map are byte-identical between the remote object and the account-2 cache. The package
has no MCP, app, API, backend, credential, token, secret, or server payload. Package result:
`PACKAGE_PRESENT`. Product result: `ACTIVE_ACCOUNT_INVOCATION_NOT_PROVEN`. No plugin file,
installation, activation, registry, branch, or runtime was changed.

## Independent review checkpoint

The same Extra High supervision lane received the complete staged diff as direct text
attachments together with the bounded test, plugin-integrity, and reconciliation evidence.
It returned `ACCEPTED` with no required fix, Pro escalation, or owner decision. Review chat:
`https://chatgpt.com/c/6a95d1be-0bb4-83ea-a266-ee82bba0cf61`.

The accepted typed claim remains `CHECKPOINT`: correction-preservation mechanics are
implemented and verified, overall Commons is not newly declared complete, therapy-policy
authority remains unresolved, and active-account plugin usability remains unproven.
