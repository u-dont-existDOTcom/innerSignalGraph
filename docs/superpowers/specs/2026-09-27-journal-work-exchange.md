# Journal work exchange: connector tools for the private journal import

Date: 2026-09-27. Status: connector side implemented on `claude/journal-work-exchange-20260927`; runtime and Mission Control sides are the next changes. Classification: public design; no private data.

## Why

The first real journal import (1,188 text units) stalled in calibration. Its transport drives the ChatGPT desktop app and copies each answer off the page. When anything goes wrong after Send, the run records "completion unknown", refuses to re-send, and waits for the next hourly run to recover the answer by hand. The import has advanced about one step an hour.

The owner approved two private connector tools on 2026-09-26: one that hands ChatGPT a work item and one that stores its answer in InnerSignal. On 2026-09-27 he approved keeping this code in this public repository.

## Shape

1. The single-writer import runtime publishes each role call as an encrypted **work item** in the exchange's `outbox/`.
2. Mission Control opens a fresh ChatGPT chat with the InnerSignal connector enabled and sends a short instruction that names only the work ID. No journal text passes through Mission Control.
3. ChatGPT calls `get_journal_work_packet`, does the role's work on the packet, and calls `submit_journal_work_result` with its JSON answer.
4. The connector checks the answer against the item's JSON Schema. If it fails, the model gets the exact problems and fixes them in the same chat. A valid answer is written, encrypted, to `inbox/` with a connector-signed receipt.
5. The runtime reads the answer, authenticates the receipt, validates it again, and stores it in the encrypted corpus store as before. Then it retires both exchange files.

Completion is therefore known: an answer either is in `inbox/` or is not. Re-sending is safe: the first valid answer for a work ID wins, so a late answer from an earlier chat can never replace it, and the route is flat-rate ChatGPT, so a second send costs nothing.

## Exchange files (`src/journal-import/work-exchange.mjs`)

- One secret (`INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64`, at least 32 bytes) is split with HKDF-SHA256 into an encryption key and a receipt key. Neither side shares the corpus key.
- Each file is AES-256-GCM with a random 12-byte nonce. The associated data binds the version, the direction and the file name, so a file copied under another name, or from the other direction, fails.
- File names are a SHA-256 of the work ID. A watcher can tell whether an answer arrived without holding any key; the names reveal nothing else.
- The exchange root must already exist (Deployment step 1); the exchange never creates it. Its two queues, `outbox/` and `inbox/`, are its direct children and must be real directories: a queue that is a symbolic link, or not a directory, is refused before anything is written, so no write leaves the canonical root.
- Publication writes and syncs a private temporary file, hard-links it into place and syncs the queue. The root is synced before every write, so a queue's own name is durable whichever caller or process created it. `link()` never replaces an existing file, which makes publication first-write-wins. Directories are 0700 and files 0600, so the runtime and the connector must run as the same user.
- Retiring an item replaces its answer with an encrypted tombstone in one rename and then removes the work item. The answer's name never goes missing, so a duplicate submission still in flight cannot leave a late answer behind. The tombstone holds no answer text, and retiring an unanswered item closes it the same way.
- A work item carries the case ID, role, instruction, packet, output schema, expected generation, and issue and expiry times. An answer carries the output and a receipt: receipt ID, transport `chatgpt_connector_tool`, completion status, file key, output SHA-256, a SHA-256 of the OAuth subject, receipt time, and an HMAC tag.
- Limits: 4 MiB per file, 900,000 bytes per answer, 256 KiB per instruction.

## Tools (`src/server/journal-work-tools.mjs`)

| Tool | Scope | Does |
|---|---|---|
| `get_journal_work_packet` | `case:read` | Returns the instruction, packet and output schema of one outstanding work item, or `already_submitted` once an answer is stored |
| `submit_journal_work_result` | `journal:submit` | Checks the answer with Ajv (draft 2020-12, `allErrors`, `strict`), returns up to 25 schema problems when it fails, and stores the first valid answer |

- `journal:submit` is new and narrow: it opens no case store and allows no other write. Grant it only to the accounts that run the import, next to `case:read` for the import's case.
- The tools are advertised only when all three settings are present: `INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT` (an absolute, existing directory; canonicalized through any symbolic links and refused if it resolves into the repository), the secret, and `INNER_SIGNAL_JOURNAL_WORK_CASE_ID`. Without them the server's tools and instructions are unchanged.
- Authorization comes first (`authorizeCase`, which opens no case and touches no key). The tools serve only items the runtime published, only for the configured case, and only before they expire.
- Denials behave like every other private tool: a sign-in challenge unless re-authentication cannot help. A challenge asks only for the called tool's scopes: the ordinary tools never ask for `journal:submit`, and both journal tools ask for `case:read` and `journal:submit` together, so the import account signs in once.
- Nothing is logged. Errors carry codes, and schema problems carry schema paths and keywords, not answer text.

## Instruction Mission Control sends

> Private InnerSignal journal work item `<work_id>`. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.

## Next changes

1. **Runtime.** The importer now lives in this repository, moved from its private work branch (owner decisions, 2026-09-27). Add a provider that publishes work items and waits for `inbox/`, and have the port's `getCompletion` read `inbox/` so a restart recovers answers instead of reporting "completion unknown". On a zero-spend route, an unknown completion re-sends the item. The REFERENCE_AUDIT branch's permanent completion-unknown marker must consult the exchange before blocking.
2. **Mission Control.** A job type that opens a fresh chat on the chosen account, model and effort with the InnerSignal app enabled, sends the instruction above, and treats an `inbox/` file as done. It keeps the heartbeat ladder: continue, then Retry, then a fresh chat. ChatGPT occasionally asks the user to confirm an app's write (the owner reports this is rare). If ChatGPT offers "always allow" for the app, that is set once. Otherwise the heartbeat approves a waiting confirmation only for `submit_journal_work_result` and sends any other confirmation to the owner.
3. **Parallel calls.** The controller runs one call at a time today. Several in-flight work items need per-item state, not one `state.json` read-modify-write per process.

## Deployment (owner-gated)

1. Create the exchange directory on the host that runs both the runtime and the connector, owned by the same user, mode 0700. The connector won't start with journal work configured while it is missing.
2. Generate one 32-byte secret; give it to both processes through their secret files, never Git.
3. Mount the exchange into the connector container read-write; the case vault mount stays read-only.
4. Add `journal:submit` to the import account's ACL grant for the import's case, and to the identity provider's client scopes.
5. Redeploy the connector, then reconnect the InnerSignal app in each ChatGPT account that runs the import, so the new scope is granted. Both the Plus and the Pro account can create custom MCP apps with OAuth (owner check, 2026-09-27; developer mode is no longer shown). Neither account has yet run a custom app's write, so the pilot's first step submits one synthetic answer from each account.

## Tests

`tests/journal-work-exchange.test.mjs` covers the round trip, first-write-wins, private file names and modes, and tamper, move and wrong-key refusals. It also covers the required root and concurrent first uses, root canonicalization, queues and entries that are symbolic links, foreign receipt keys and the input limits. `tests/journal-work-tools.test.mjs` covers advertisement and scopes, authorization, outstanding-only serving, other cases, expiry, schema feedback, and the first-answer rule over MCP. The full suite passes on Node 24.18.0.
