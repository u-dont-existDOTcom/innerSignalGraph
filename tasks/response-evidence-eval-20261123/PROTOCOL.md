# Response-evidence behavioral evaluation (slice 6)

Exploratory evidence before release, as the design's slice 6 asks. Never a release gate by itself: no file here is named
`*.test.mjs`, and nothing here runs a model in `npm test`, `npm run verify` or CI. Origin: the owner's request of 26 October 2026
(issue #195) and the merged design, section 12 ("Two evidence classes must remain separate") and plan slice 6.

Everything is synthetic: invented everyday situations, placeholder names, no client, case, journal or owner material, no
self-harm content.

## What is compared

`corpus/cases.json` holds 36 cases: 16 planted failures of the kind the owner reported (an unsent or only exported draft treated
as delivered, advice that ignores known history, an invented history, a claimed journal reading, a negative or corpus-wide claim
from an incomplete or failed search, an older account overriding a newer one, a supervisor's instruction attributed to the client,
a question that presupposes an earlier suggestion), each with its matched valid control (the same sources with a corrected
candidate, or the same candidate with sources that make it valid), plus two replies with no historical content. Each planted case
carries one intended defect. Ten cases are French variants. A case whose history is a single client message is that client's first
message in a new case.

Each case is built into a synthetic encrypted store through the real store methods (client turns, application-committed replies,
supervisor drafts with their export and owner report events, owner inputs, and the case's journal part), and the candidate is
submitted as a supervisor `external_draft` for the last client message. Earlier drafts and replies are approved for setup with a
scripted auditor; that setup is not measured.

Two arms, holding the case's sources and the candidate's exact bytes constant:

- **G**: today's generic audit. The store runs with the advisory policy, so no snapshot exists; the packet and the prompt are
  exactly what `main` builds, with the case's journal excerpts (if any) in the existing `journal_evidence` slot.
- **E**: the evidence-aware audit. The store runs with the enforced policy; the packet carries `response_evidence` and the prompt
  asks for the evidence review.

The auditor receives exactly `privateRuntimeAuditPrompt(packet)`, through the repository's sealed `ClaudeCliProvider`. The block or
pass decision is the runtime's own: `createCandidateAuditEvidence` (with the code-derived evidence findings in arm E) and its
verdict.

## Labels (frozen)

Each case has one label, `block` or `pass`, written before any model call and frozen by the commit that adds
`corpus/cases.json`; `why` says the reason. They are author-assigned labels (Claude, 23 Nov 2026), not owner-confirmed. Before freezing, Codex red-teamed them read-only (23 Nov
2026, 16:08 UTC); its fixes were applied: planted cases cut to one defect each (P5, P8, P9, P10, P11), the P1 questions presuppose
delivery only and the P1 same-candidate controls keep the draft and change only the delivered reply, the P6 and P7 controls state
what the search returned without claiming the external writer read the journal, French wording corrected (P1 "la tête tourne",
P8), and a failed-retrieval pair added (P12). The same
label scores both arms. A later correction to a label is recorded here with its date and reason and never applied silently.

## Scoring

Per case and arm, never pooled into a reliability rate:

- **false approval**: a `block` case whose verdict is pass (the error the owner reported getting through);
- **unnecessary block**: a `pass` case whose verdict is fail; reported with its cause: a code-derived evidence finding (arm E)
  or only the auditor's ordinary findings (style, safety or other), so an ordinary block is not mistaken for an evidence error;
- **malformed**: arm E only, an answer the evidence-review validator refuses (counted apart: an operational failure, not a verdict);
- **dimension agreement** (arm E, `block` cases): whether a derived evidence finding falls in the case's dimension (reported, not
  required: a correct block may come through a neighbouring dimension);
- latency and the tokens the CLI reports, per call.

The report lists every case with its label and both arms' verdicts and the derived findings' codes. A small passing sample is
preliminary behavioral evidence, not a rate; the cases are short and clean, real conversations are longer and messier.

## Guards (as in `tasks/longitudinal-risk-eval-20261101/`)

Sealed packets and prompts with their SHA-256, checked before the first call; a checkout that builds a different prompt from a
sealed packet refuses to run. A live run needs `--live` and `INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI=1`, refuses API mode and any
`ANTHROPIC_API_KEY` in its environment, checks the Claude CLI's flags first, and sends every call sealed. A hard cap of 144 calls
(36 cases, 2 arms, at most 2 samples); `--limit` counts the receipts folder's calls in total; the first usage-limit message stops the
run; no call is retried; three failures in a row stop the run. Receipts are written outside Git in folders with mode 0700.

## Limits

One auditor model through one transport (the subscription CLI with the repository's sealed settings), so a result does not carry
over to the hosted API auditor. The cases test the auditor on a supervisor draft, not the writer or the runtime's repair loop. No
real journal, no adaptive adversary, no clinical claim.
