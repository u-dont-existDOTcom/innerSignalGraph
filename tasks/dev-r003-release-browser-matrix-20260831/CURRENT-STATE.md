# DEV-R003 local release/browser matrix task state

Task ID: `DEV-R003`

Status: `HOSTED_EVIDENCE_AND_REVIEW_HANDOFF`

Assurance lane: `iteration` with release-engineering, private-state, rollback, loopback, and argument-safety hard gates. This is not release authorization.

## Authority and execution boundary

- Owner outcome: continue the currently authorized InnerSignal engineering queue without changing `stable`, releasing, deploying, running a public pilot, creating a plugin, or activating community-derived/correction-derived therapy behavior.
- Owner-outcome identity: `OO-INNERSIGNAL-ROADMAP-RESUME-20260831-E1`, epoch `1`, SHA-256 `1482b1f9ee9f5462d1b80f3e98be778b3463ea27b804d6a338ba29b0dca980c3`.
- Chat-authored directive: `ctc-innersignal-dev-r003-release-browser-matrix-20260831-001`.
- Contract corrections: `rr-innersignal-dev-r003-release-browser-matrix-scope-repair-20260831-001` and `rr-innersignal-dev-r003-runtime-baseline-scope-repair-20260831-002`, both Extra High `CONTRACT_CORRECTION_DIRECTIVE` receipts with automatic resumption.
- Strategy: `dev-r003-consolidated-local-release-matrix-r1`.
- Exact accepted base: DEV-R002 commit `ed6ab5277d4a079314b0ddd67aefe64ab0e08a8e`; PR #18 open, draft, stacked, and unmerged.
- Task branch: `codex/dev-r003-release-browser-matrix-20260831`, created from the exact accepted base.
- Stable authority: `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`; no mutation authorized.
- Maximum execution horizon: one implementation/verification/stacked-draft-PR cycle followed by one self-contained Extra High post-execution review.
- Pro classification: `NO_PRO`. Any therapy-semantic, guide, graph, prompt, consent, correction-learning, community-learning, release, or publication choice is outside scope.

## Objective-reconciliation matrix

| Owner requirement | Chat interpretation | Task criterion | Acceptance evidence | Current state | Authorized change |
|---|---|---|---|---|---|
| Continue safe engineering work now | Complete only the next bounded roadmap slice | DEV-R003 exact branch, tests, draft PR, and review receipt | Exact-head local/hosted evidence | In verification | Release tooling and deterministic tests only |
| Keep stable and release untouched | Exercise release behavior only in disposable local fixtures | Stable SHA unchanged; no real install/browser/network | GitHub/stable readback plus matrix flags | Enforced | None |
| Support safe Node 24 patches | Separate exact recommendation from major compatibility | `.nvmrc` `24.18.0`; engines `>=24 <25`; centralized validator | Boundary tests and repository audit | Implemented; final gates pending | Runtime requirements and mechanical audit mirrors |
| Open only the ready local app safely | Resolve one executable and pass the URL as an argument with `shell:false` | Explicit override validation, PATH evidence, fake-browser exact argument | Launcher tests and release matrix | Implemented; final gates pending | Browser discovery/launcher only |
| Preserve private bytes and rollback | Reuse the existing updater and inject deterministic failures | Clean install, successful state overlay, activation rollback, install-record rollback | Real `runGitUpdate` path over local bare Git | Implemented; final matrix pending | Matrix/test fixtures only |
| Preserve correction-learning request | Keep the later potential-lesson request queued and inactive | No therapy/community/correction paths changed | Final changed-path readback | Preserved outside scope | None |
| Continue through reasoning review | Codex executes; Extra High assigns alignment/completion | One exact evidence packet after the frozen cycle | Persisted request/result receipt | Pending | Review handoff only |

## Active lesson contract

1. `.nvmrc` remains the exact recommended patch; package and lock metadata express only the approved Node 24 major range.
2. Installer and local launch entry points share one deterministic runtime-version parser/validator.
3. `INNER_SIGNAL_BROWSER_EXECUTABLE` is one executable name/path, never a command string; browser invocation is direct with `shell:false`.
4. Browser discovery is ordered and emits structured evidence; deterministic tests and matrix use only fake executables.
5. The matrix uses isolated temporary directories, local bare Git, mock providers, ephemeral loopback, and the real `runGitUpdate` install path.
6. Private-state bytes are hash-compared across update and both rollback failures; the existing atomic updater implementation is not rewritten.
7. Verification uses focused tests first, then the matrix and repository audit after freeze, and exactly one final `npm run verify`.

## Current implementation

- Node 24 compatibility, safe browser launcher, runtime entry-point wiring, and the isolated release matrix are implemented in the task worktree.
- Required focused tests passed 33/33.
- Extra High-authorized runtime audit/baseline mirror tests passed 34/34 after an offline lockfile bootstrap supplied the fresh worktree's test dependencies.
- `RESULTS.json` is generated and records `ok: true`: Node boundary checks, fake-browser argument safety, clean install, private-state preservation, both rollback failures, ephemeral loopback health/close, and exact ready-URL delivery all passed without external network, a real install, or a real browser.
- Frozen-diff `git diff --check`: PASS.
- Repository audit: PASS with 0 errors and the one pre-existing installed-GitHub-App-permission warning.
- Exactly one final `npm run verify`: PASS, 466/466 automated tests, graph regressions 12/12, final verdict PASS.
- Test-efficiency receipt: 236.56 seconds observed test time; one failure-discovering affected run identified the fresh-worktree dependency prerequisite; 0 seconds forced redundant green reruns; final full gate 191.03 seconds.
- Verified implementation commit: `ad85d7457bf4631c8bab5ae29746c49667c6e28f`.
- Draft stacked PR: [#19](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/19), based on `codex/dev-r002-audio-playback-20260831`.
- Hosted checks, exact final PR-head readback, stable readback, clean-worktree readback, and post-execution Extra High judgment remain pending. The final PR head adds only this task-state transition to the verified implementation commit.

## Supervision state

- Worker-to-contract alignment: unassigned pending Extra High post-execution review.
- Contract-to-owner alignment: unassigned pending Extra High post-execution review.
- Operational alignment: pending post-execution review.
- Scientific adequacy: not assessed in this non-scientific slice; no scientific claim or therapy-policy change is authorized.
- Release adequacy: not authorized; the matrix is local deterministic evidence only.
- Typed completion claim: unassigned pending Extra High review.
- Recurring reconciliation: re-check exact head, changed paths, PR stack state, hosted checks, stable SHA, private boundaries, and owner-request preservation at the frozen diff and before the reasoning handoff.

## Recovery

Resume from this file and the exact task branch. Do not repeat the green focused tests or matrix without a material code change, and do not repeat a green full package gate. If a verified commit and draft PR exist, collect exact-head hosted evidence and route the one bounded Extra High post-execution packet.
