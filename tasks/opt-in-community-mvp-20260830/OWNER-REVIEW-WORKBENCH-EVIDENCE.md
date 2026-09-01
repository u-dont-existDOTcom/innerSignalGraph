# Live local owner-review workbench evidence

**Directive:** `ctc-innersignal-live-local-owner-review-workbench-20260901-001`, revision 1

**Strategy:** `live-local-owner-review-workbench-v1`

**Owner continuation source SHA-256:**
`7f7988b3cfe6e3f4fb515bb32acd5cf05737deff8308c6f9dd097ff3804187f2`

**Start head:** `cd789ea9c5df582ac2524e8f4d563e3a9bd7e98e`

**Typed worker claim target:**
`LIVE_LOCAL_OWNER_REVIEW_WORKBENCH_SUBTASK_COMPLETE_PARENT_OPEN`

## Boundary

This slice makes the existing same-device learning queue usable from the main InnerSignal
browser app. It adds status, list, detail, and disposition routes under
`/v1/learning/review/*` plus a Local learning review section inside the existing Local Data
surface. The routes consume only the existing store's public `status/list/show/decide`
projections.

The review API and UI cannot return durable occurrence/revocation hashes, browser-held raw
occurrence/revocation credentials, preview nonces, filesystem paths, raw therapy content, or
assistant answers. Corrupt or unreadable state is reported as unavailable with null counts;
it is never presented as an empty queue.

All six review actions are triage-only. Every returned record retains runtime, therapy-policy,
and external-transmission authority `none`. Flagging a candidate for an owner therapy-policy
decision changes only its status to `needs-owner-therapy-decision`; no therapy ledger, guide,
graph, prompt, regression, install, or runtime path is invoked.

## Non-goals

- no remote or cross-user queue;
- no OpenAI/OpenRouter/provider request;
- no billing, signup, authentication expansion, credential, deployment, or public endpoint;
- no personalization activation;
- no Commons mutation;
- no therapy-policy decision or therapy-ledger mutation;
- no merge, release, `main`, or `stable` mutation.

## Verification checkpoint

Pre-freeze verification on the bounded implementation is green:

- focused review API, workbench, live-server, isolation, and web-client tests: **PASS 28/28**;
- complete live-local learning suite: **PASS 49/49**;
- live-loopback verifier: **PASS** for one strict schema, five conservative mappings, exactly
  seven loopback routes, one local owner-review workbench, two authorized runtime consumers,
  zero external learning calls, and authority `none`;
- offline-groundwork reconciliation verifier: **PASS** for exactly seven local learning routes
  and the two authorized live consumers;
- correction-learning regressions: **PASS 35/35**;
- Commons regressions: **PASS 17/17**;
- main-app web smoke: **PASS**;
- repository audit: **PASS**, with only the known unrelated
  `hosted-github_app_permissions` warning;
- canonical design audit: **PASS**, no findings.

Controlled-browser QA used an isolated temporary learning store and a populated generalized
candidate. The Local Data workbench exposed the required semantic region, labeled fields,
six triage actions, explicit causal and therapy-authority boundaries, and on-demand strict
candidate detail. A real `insufficient-evidence` action updated the displayed record and
awaiting-review count. The first pass found that the explicit refresh button retained an async
event reference incorrectly and remained disabled; the handler now preserves the button before
the async boundary, a regression assertion covers it, and the confirmation pass showed the
button restored after refresh. Desktop computed layout at 1298 CSS pixels had no page, section,
card, action, or button overflow. The external controlled browser did not honor temporary
viewport overrides, so 320/375/414/768/1024/1440 and 200%-text resilience were checked from the
bounded responsive implementation: the 720px column switch, wrapped actions, overflow-wrapped
identifiers/values, and scroll-safe evidence block. This is not a public-release visual claim.

The current Superdesign real-codebase init would write `.superdesign/*`, outside this directive's
closed authorized path set, so no generation command ran. The live canonical design repository's
`audit` operation and production gates were applied directly instead.

Frozen-diff, the single final package, exact-head hosted, and post-execution Extra High review
results are supplied in the execution receipt after they exist. This tracked evidence does not
pre-claim those later results. The unrelated `tasks/ACTIVE-TASK.json` lock, all four therapy
ledger paths, Commons paths, `main`, and `stable` have pre-execution identity receipts and must
remain unchanged.
