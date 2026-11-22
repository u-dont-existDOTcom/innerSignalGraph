# Stable release evidence

This records the completed therapy skill release 0.2.6 and the limits of the retained evidence. It follows `docs/RELEASE-EVIDENCE.md`. It does not certify missing gates or repeat the release.

Kit: `/home/joel/askrigor-releases/20261122-innersignal-0.2.6/`. Evidence paths below are relative to that directory. "Lane record, 22 Nov 2026" means the InnerSignal lane's own report of a step it ran (merges, host runs, post-release checks), not a transcript in the kit. `README.md` describes preparation before deployment; its expected output is not an execution receipt. The lane copied the host's check and activation logs and the deploy receipt into `real-run/` (no key values in them). Writing this record used only read-only GitHub and git readbacks: no production access, npm commands or tests.

- Exact candidate commit: published `stable` commit `45759cb2667513dfc7df136b5dc779377320ad31`, the squash merge of pull request 239 at 2026-11-22T16:39:24Z (`gh pr view 239`; `real-run/deploy-receipt.txt`, `stable_commit`). The reviewed release-branch head was `c9c3fc0c6ccb8a5b36ccffc24f650d9059531070` (`codex/review-stable-pr.txt`). Development source was `45c0f906e3406517b4dbed25ce29a0b1133a9c79` on `main`: pull request 237 (the served sentence, head `016ff7f94`) squash-merged onto `146ac4df3`, which is pull request 236 (the feedback place, head `0554d6299`) squash-merged onto `22a2a2901` (`README.md`, "Read first"). Repository: `u-dont-existDOTcom/innerSignalGraph`.
- Recursive tree: stable `72ead4a31a37511952f1bbe5d62ef569df801771`, parent `a7550955`, read back with `git log` after the merge; main `b8e35bab873f4a8803e68d582b8156fc33f94ba5`, its first parent's `cf45abb57b4968cb481d3e68f58ccc016b04656f`, equal to the trees `repin.sh` computed (`tmp-release/values.env`, `tmp-release/repin.log`) and re-proved on the host by `check` (`real-run/check-20261122T164021Z.log`: "backend: running c852b7cb -> new 45c0f906 (descendant; tree b8e35bab, first parent's tree cf45abb5 …)").
- Version: therapy skill `0.2.6` (`real-run/deploy-receipt.txt`). Runtime version: **Not in the local release kit**; the lane's `/health` readback would hold it.
- Predecessor on `stable`: `a7550955a79470d7b93c21f08cc17c21ef074210`, therapy skill `0.2.5`. Previous backend: `c852b7cbf122d0cc2cd16528f3a584458502b28a` (`real-run/deploy-receipt.txt`, `previous_backend`).
- Candidate branch: `release/therapy-skill-0.2.6-20261122` into `stable`, pull request 239. Development pull requests 236 and 237 ship together with what `main` gained since 0.2.5 (#85, #148, #186, #189, #196, #207, #208, #221, #222, #233, #234, #235). `git diff --name-only a7550955 45759cb26` lists only `.github/workflows/verify.yml`, `docs/releases/THERAPY-SKILL-0.2.6-20261122.md` and the plugin's `.codex-plugin/plugin.json`, `skills/inner-signal-therapy/SKILL.md`, `references/INNER-CHILD-BOX-GUIDANCE.md` and `references/INNER-CHILD-THERAPY-MAP.md` (plugin root `plugins/inner-signal-therapy/`). The plugin has 13 files and 13 reviewed blob pins; its manifest version is the only difference from main's plugin (`tmp-release/repin.log`).
- Artifact hashes: protocol SHA-256 `2126edaf1c4045939dd5b3fefa397dc81871debea2d7d6f30601f58e8053fd07`; instructions SHA-256 `d59d66640aeb8d2db760fa1e9b3b8e1d6c4808ff3f856fe4956ff986bd43df3a` (32,268 bytes); plugin Git tree `e98a72d00ce66a29f42e29cfdb564dd4fd3eaa5b`; the ten reference SHA-256 values in `tmp-release/expected-reference-sha256-0.2.6.txt` (`tmp-release/values.env`).
  - Activation script, reviewed unfilled copy: `deploy/InnerSignal_0.2.6_activate.reviewed.sh`, sha256 `b01f6c6827c2df1cf93c2bcb9b459436c59547c008a29e3cfa09e38d7a3318f1`.
  - Activation script, filled copy run on the host: `InnerSignal_0.2.6_activate.filled.sh`, sha256 `fcea95f7d641cda35b85e8375a89d92a0d3faa36d2c9a56d39600a678f339fad`. The staged copy's checksum on the host is the lane's record.
  - Previous image: `sha256:1920ac45ebf09142263078c741dcd2d469a36edc92682204111d96dda704b6d2`, retained as `rollback-before-0.2.6` (`real-run/deploy-receipt.txt`). The new image's digest is **Not in the local release kit**; `docker image inspect` on the host would hold it.
- Evidence timestamp (UTC): stable gate on the real release tree 2026-11-22T16:31:37Z (`tmp-release/stable-gate-real-20261122T163137Z.log`); host check 16:40:21Z and activation 16:40:41Z (`real-run/` file names); VERIFIED at 16:41 UTC (lane record, 22 Nov 2026).

## Deterministic gates

- Bootstrap command/result: stable `npm ci --ignore-scripts --omit=dev --no-audit --no-fund` added 9 packages (`tmp-release/stable-gate-real-20261122T163137Z.log`). Main's bootstrap ran inside the Verify workflow on `45c0f906e`, which succeeded (`gh run list --commit 45c0f906e`). An explicit shell receipt of main's local bootstrap is **Not in the local release kit**.
- Focused command(s)/result:
  - The workflow pin step on the real release tree: PIN STEP PASS (lane record, 22 Nov 2026).
  - `repin.sh` on the real merges: `PIN STEP PASS` and `COMPARE PASSED` (`tmp-release/repin.log`). Local servers of the running backend and of `M` list 19 tools, 6 journal tools, sha12 `100de602436d`, with the page off and on. The page answers with `default-src 'none'`, and a send followed by its deletion by code leaves the message out of the store (`tmp-release/compare.json`).
  - The activation script's local harness: 44 of 44 passed (`tmp-deploy/run-tests-pass2.log`). It stubs Docker, Compose and the host; its connector, page and store are the application's own code.
- `npm test` result:
  - Stable release tree: 307 of 307 passed, 0 failed (`tmp-release/stable-gate-real-20261122T163137Z.log`).
  - Main: the full suites ran in CI on the development pull requests' final heads. `0554d6299` passed 3,147 tests, 0 failed, 1 skipped (#236's merge statement); `016ff7f94` passed 3,149 tests, 0 failed, 1 skipped (#237's merge statement).
  - Verify succeeded on `45c0f906e` and on `45759cb26` (`gh run list`). These are separate suites; the stable count is not a main count.
- Graph and psychological-safety/therapy regression result: the stable gate log records the graph cases, the Guide Packet fixture checks and the mock therapy and hypnosis checks passing (`tmp-release/stable-gate-real-20261122T163137Z.log`, `=== VERDICT ===` / `PASS`). The served sentence has its own test (`tests/feedback-served-sentence.test.mjs`), and IS7 carries graph case G20261019C (#234). The danger reader's prompt was red-teamed and checked blind: 49 of 49 on two runs (`/home/joel/askrigor-releases/20261122-innersignal-feedback/danger-reader-eval.md`). It runs on the owner's laptop, not in the connector. These checks establish their tested scope, not live therapeutic effectiveness.
- Therapy lesson governance result: reported inside the stable gate's verify run (`tmp-release/stable-gate-real-20261122T163137Z.log`). A separate main-side governance receipt is **Not in the local release kit**; main's Verify run log would hold it.
- Package/build and repository audit result:
  - `npm run verify` ends `PASS` on the stable release tree (`tmp-release/stable-gate-real-20261122T163137Z.log`).
  - Verify, CodeQL and Repository workflow policy succeeded on `45c0f906e` and on `45759cb26` (`gh run list`).
  - On the host: `backend image built`, the plugin layer built, and the candidate image's offline check passed (`real-run/activate-20261122T164041Z.log`). That check found 430 files, 0 unreadable, uid 1000, modules that load, and the draft path, the owner fallback and the feedback place off by default. Its three sentinel files (`src/feedback/setup.mjs`, `src/server/private-case-mcp.mjs`, `src/protocol/therapy-protocol.mjs`) hashed the same as at `45c0f906e`; the rest of the image's code was not compared file by file.
  - The host's `backend-build.log` and `plugin-layer-build.log` are **Not in the local release kit**.
- Immutable archive result: reported in the stable gate's verify run (`tmp-release/stable-gate-real-20261122T163137Z.log`). Archive checksums bound to this release are **Not in the local release kit**.
- Clean-worktree result: on the host, `check` and the activation required the stable checkout and the backend source tree to be clean, and found 0 entries to repair (`real-run/check-20261122T164021Z.log`, `real-run/activate-20261122T164041Z.log`). The final `git status` of the laptop release checkout is **Not in the local release kit** (lane record).

## Live and independent evidence

- Live-model entitlement evidence by exact role/model/request: **Not in the local release kit** for any application role; this release adds no model stage to the connector. The danger reader's live check on the owner's laptop is a laptop tool check, not a connector stage: true for an invented danger message, false for an ordinary one (lane record, 22 Nov 2026).
- Live compilation/review/adjudication stage result: none in this release's connector path.
- Adversarial review of the exact candidate commit:
  - Codex found nothing on the release PR's final commit `c9c3fc0c6` (`codex/review-stable-pr.txt`, "No findings."), on #236's final head `0554d6299` (its eleventh review) and on #237's final head `016ff7f94` (its twelfth review). The merge statements: https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/236#issuecomment-7080403282, https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/237#issuecomment-7080547440 and https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/239#issuecomment-7082239057.
  - Codex reviewed the release kit in eight rounds; the last ended "No findings. VERDICT: ready" (`codex/review-r8.md`).
  - Fable red-teamed the feedback design (`/home/joel/askrigor-releases/20261122-innersignal-feedback/fable-redteam-design-20261122.md`); each finding is answered in the design's appendix.
  - A direct review of the published squash commit `45759cb26` is **Not in the local release kit**. Its tree is the reviewed head merged onto `a7550955` with no other change (`git diff --name-only` above).
- Finding repairs and re-review:
  - #236: Codex's first seven reviews found 28 findings; #236's merge statement reports them fixed with tests, with the design's Appendices B to G as the record. Not every one is a code fix: Appendix B keeps one as a documented limit (the disk's own change time on each stored file shows when it arrived; `docs/FEEDBACK.md` says so). Its eleventh review found nothing.
  - CodeQL: the three high alerts were fixed in `26c904055`; five medium alerts in the owner's laptop script were dismissed with reasons, and checking one of them led to a real fix in `34508369d` (#236's merge statement).
  - The release kit: Codex's rounds found 10, 4, 1, 1, 1, 3, 1 and 0 findings (`codex/review-r1.md` to `codex/review-r8.md`). Each round's findings were answered before the next round, which re-reviewed them; two answers needed a second pass (round 2 found step 2b's guard still did not stop, round 3 that it still printed STOP and continued), fixed by `check-reviewed.sh`. Round 8 found nothing (`README.md` Results 5).

Deterministic or mock evidence cannot satisfy live-model entitlement or a required live stage.

## Owner decisions

- Applicable owner decision/card/receipt identities: i63b (a private feedback place only the owner reads); i66 `1a 2a 3a 4a 5b 6a 7a` (the page at `https://innerself.love/feedback`, a path on his site routed to the connector; the danger reader on his laptop; the page's words); i65b (his 19 Oct line, IS7, ships with this release); i69 `1a 2a` (22 Nov 2026, 13:35 UTC: release the feedback page with the changed sentences, and put the daily count in the lane's report). These are recorded summaries of chat and Inbox answers; the original receipts are the owner's decision records.
- Privacy or model-role decision:
  - Messages are sealed to the owner's X25519 key (key id `3ab5305028193553`, `real-run/deploy-receipt.txt`), so the server cannot open them. No IP address, account or token is kept.
  - `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR=on`, by the lane's decision of 22 Nov 2026 13:49 UTC. The reasons:
    - Port 8787 is published nowhere and the container sits only on the `coolify` network (re-proved by `check`: "network: coolify only, no host port").
    - innerself.love resolves straight to the server, with no CDN in front, so the last `X-Forwarded-For` entry, which Traefik appends from the connecting address, is the visitor's.
    - Rate limits live in memory, keyed by an HMAC under a key made at start, so nothing stores the address.
    - Only the owner's own containers on `coolify` could forge the header, and that only dodges the per-client limits; the door-wide limits still hold.
    - Off would make the per-client limit one limit for all visitors together.
  - The chat tool `send_feedback` stays off; the reply-draft path and the owner fallback stay off (`real-run/deploy-receipt.txt`).
- Explicit stable release approval: i69 `1a 2a`, and the owner's `go 0.2.6`, typed in the InnerSignal lane's chat on 22 Nov 2026 at 16:30 UTC before the promotion and the server switch (#239's merge statement; lane record, 22 Nov 2026).

## Promotion and installation

- Non-forced `stable` promotion and fetched matching refs/trees: pull request 239 squash-merged at 2026-11-22T16:39:24Z. `refs/heads/stable` reads `45759cb2667513dfc7df136b5dc779377320ad31`, tree `72ead4a31a37511952f1bbe5d62ef569df801771`, parent `a7550955a79470d7b93c21f08cc17c21ef074210` (`git ls-remote`, `git log`). Required checks passed on the reviewed head `c9c3fc0c6` (#239's merge statement) and on the merge commit (Verify, CodeQL, Repository workflow policy: success).
- Proof `runtime-diagnostics` was not merged: `refs/heads/runtime-diagnostics` is `87b42f49d040f6a20d45cd500c21a42bf9bdb40d`, and `git merge-base --is-ancestor 87b42f49d 45759cb26` is false (readback while writing this record).
- Transactional install result: on `mission-control-primary`, in stage `release-candidates/stable-therapy-0.2.6`:
  - `check` exited 0: "CHECK PASSED. Nothing was tagged, built, created or restarted." (`real-run/check-20261122T164021Z.log`).
  - `activate` exited 0: "VERIFIED: InnerSignal MCP now serves version 0.2.6 with protocol SHA256 2126edaf… on backend 45c0f906, and the feedback page at https://innerself.love/feedback" (`real-run/activate-20261122T164041Z.log`).
  - Only the `private-case-mcp` container was recreated. The receipt is `status=verified`, with every field (`real-run/deploy-receipt.txt`).
  - This was the hosted connector's install; the desktop runtime's atomic install contract is not what ran here.
- Disposable validation and credential-removal evidence: the candidate image was checked offline with `--network none --read-only`. That check included the feedback settings, read by the image's own code with the key settings passed by `--env-file`: `feedback settings in the image: {"settings_ok":true,"tool":"off","trust_forwarded_for":"on","key_ok":true,"key_id_matches":true,"address_matches":true}` (`real-run/activate-20261122T164041Z.log`). The settings file was checked by mode, owner, format and key id only, never printed (`feedback settings: mode 600, owner joel, … key_id_expected=true`).
- Private-byte preservation evidence:
  - The script compared `.env` and the base compose file before and after the restart. It blocks on any change, and the run passed, so they were unchanged.
  - It never reads the private case vault.
  - The new feedback store was created empty (0700, uid 1000), and the release check's own message was deleted from it: "public round trip: send=200 code_shown=true its_file_stored=true delete=200 deleted=true its_file_gone=true" (`real-run/activate-20261122T164041Z.log`).
  - Before/after hashes of the other preserved roots are **Not in the local release kit**. Private contents and their hashes are not published here.
- Exact installed commit marker: `stable_commit=45759cb2667513dfc7df136b5dc779377320ad31 … backend_commit=45c0f906e3406517b4dbed25ce29a0b1133a9c79` (`real-run/deploy-receipt.txt`).
- Rollback and retry evidence:
  - Retained predecessor: `a7550955`.
  - Rollback image: `rollback-before-0.2.6`, the 0.2.5 image `1920ac45ebf0…`, proved offline to serve 0.2.5.
  - The rollback command was rehearsed with `compose --dry-run` before the restart: "rollback rehearsal: passed" (`real-run/activate-20261122T164041Z.log`).
  - The page-only rollback (`feedback-off`) and the full rollback were exercised only in the local harness (`tmp-deploy/run-tests-pass2.log`). No production rollback exercise was run.
- Sustained health/status/recovery ZIP observation, after VERIFIED (lane record, 22 Nov 2026, steps 6 and 7):
  - `/health` reported version `0.2.6`, protocol `2126edaf…` and `feedback: {page: "on", tool: "off"}`.
  - `https://innerself.love/feedback` answered 200 with `content-security-policy: default-src 'none'` and `x-robots-tag: noindex`; the site root answered 200.
  - The connector's `get_therapy_protocol_manifest` equalled the expected list and the files at `45759cb26`, 10 of 10.
  - A Claude Code chat saved `load_therapy_protocol`'s whole structured result to a file, uncut: instructions sha256 `d59d66640aeb…`, 32,268 bytes, naming the page; every file's content matched its sha256 and bytes; 324,933 bytes in all.
  - Raw readbacks, development status, Guide Packet status and a recovery ZIP are **Not in the local release kit**. No longer health observation has been made yet.
- Owned-process teardown result: **Not in the local release kit**; the lane's process record would hold it. No application process was launched to write this record.

## Residual risk

- Unavailable or unverified hosted controls: current repository settings and branch-protection readback are **Not in the local release kit**. The merge statements and `gh run list` report the required checks passing.
- Durable issue: pull request 232 (split delivery, plus the chat tool's switch and its tool-list change) stays open for its own release. ChatGPT's incomplete delivery of the long first result (owner question i60) is unchanged by this release.
- Other limits or exceptions:
  - The release check's own test message passed through the store and was deleted by its code. The owner's first fetch showed 0 new messages and 1 deletion (that message), and was confirmed (lane record, 22 Nov 2026).
  - The host keeps the two key settings in `/srv/inner-signal-private/feedback-owner.env`, mode 600 (`real-run/check-20261122T164021Z.log`: "feedback settings: mode 600, owner joel …"). Whether other copies exist, and whether the owner has made the second copy of his private key and read token that README step 8 asks for, is **Not in the local release kit**; the owner's or the lane's confirmation would hold it.
  - After the release, the Inbox's Feedback view was published, the runner trial was restarted with its feedback link (16:42:59 UTC), and GPT was asked to add the site's footer link (innerself issue 3, comment 7082291659) (lane record, 22 Nov 2026).
  - Missing required evidence remains unverified under the release contract.
