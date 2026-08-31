# Inner Signal Runtime v0.15.2

## Authoritative start path

Inner Signal is active, critical-risk software. The existing GitHub repository is public, and the publication transition is complete. Public visibility does not alter the authority boundaries below: `main` is development, `stable` is the sole installation/release source, and therapy/framework policy remains owner-gated. Start with `AGENTS.md`, then `.github/codex-repository.json` for exact commands and hosted-control state, `state/CODEX-CURRENT-STATE.md` for the resumable checkpoint, this README for branch/release/privacy authority, `AUTOPILOT.md` for runtime automation, and `docs/INDEX.md` for current evidence. The development-only Obsidian proposal workbench is documented in `docs/AUTHORING-ARCHITECTURE.md`; it does not replace graph/source authority or the Guide Packet owner-decision boundary. The accepted transition design is `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md`; `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` records the bounded pre-public audit and verified hosted readback. Repository-scoped installed GitHub App permissions remain `UNVERIFIED`, so the compliance terminal label is `BLOCKED` and issue 4 remains open. `IMPLEMENTATION-REPORT-v0.15.2.md` is the current production implementation report; dated reports remain historical evidence rather than current instructions.

The supported development runtime is Node >=24 <25. .nvmrc recommends Node 24.18.0, and the repository package manager is npm 11.16.0. The repository-visible path is:

```bash
npm ci --ignore-scripts
npm run audit:repository
npm run audit:publication
npm test
npm run verify
```

The local publication gate is `npm run audit:publication`. The authenticated hosted-surface gate is `npm run audit:publication:hosted`; it is required before the visibility transition and is not a hermetic ordinary-CI substitute. Provider checks are explicit opt-in live evidence and do not run in ordinary CI. `main` is development authority, `stable` is the sole installation/release source, and `runtime-diagnostics` is generated allowlisted status data that must never merge into source. Release promotion follows `docs/RELEASE-EVIDENCE.md` and remains distinct from merging development work to `main`.

## Hermetic Git updates, safe diagnostics, and remote progress

v0.15.2 makes recovery verification deterministic. Promotion-failure tests now hold the recovery restart at an explicit boundary, prove the launcher stays alive during that transition, then synchronize on the public `/health` endpoint before checking development status, guide status, and the recovery ZIP. Test launchers own inert desktop-open commands and complete process-group cleanup, so package validation cannot open browser tabs or leave temporary services behind. The production recovery path and its time limits are unchanged.

Inner Signal installs verified commits from the `stable` branch and uses the separate `runtime-diagnostics` branch for strictly allowlisted failure records and one current progress heartbeat. `main` remains the development branch; `stable` is the only installation source; `runtime-diagnostics` is never merged into runtime source. Failure incidents remain append-only; `progress/<machineId>/current.json` is intentionally replaced with its existing blob SHA.

One GitHub web login is required during bootstrap. After that, an ordinary launch retries queued incidents, checks `stable`, validates a candidate inside disposable home/config/state roots with GitHub and model credentials removed, preserves every pre-existing private file byte-for-byte, and swaps the runtime only after every deterministic gate passes. A failed ordinary update keeps the prior runtime usable. A failed bootstrap exits nonzero and never presents that older runtime as the requested release.

Remote incidents contain only random machine and deterministic incident identifiers, version/commit/status fields, bounded test names and locations, allowlisted error codes and scalar values, and integrity hashes. They never include browser chat, therapy or hypnosis content, model prompts/output/reasoning, raw logs, `.env`, credentials, usernames, hostnames, IP addresses, or absolute home paths.

While the launcher runs, a bounded companion publishes generated stage/status codes, counts, timestamps, liveness, elapsed time, and a deterministic assessment. Changed state is coalesced for 30 seconds; unchanged state refreshes every five minutes. `ADVANCING`, `LONG_RUNNING_STAGE`, `WAITING_FOR_HUMAN`, `BLOCKED`, `WORKER_NOT_RUNNING`, `COMPLETE`, and `IDLE` are computed locally. Task prose, job IDs, PIDs, blocker/analysis text, guide content, model content, logs, credentials, and host identity are excluded. Delivery failure retains only the newest private local snapshot and never blocks the app.

## Preserved timezone-stable package validation

This release fixes the Zorin installation rollback in which the r01 Guide Packet rebuilt to `d93f…8738` while the preserved archive correctly remained `9395…5263`. The packet contents were identical; the ZIP writer had encoded the same absolute timestamp through the host timezone, and one test wrote its rebuild into the immutable fixture directory.

ZIP timestamps are now encoded in UTC, fixture-building tests use temporary directories, rebuilt packet contracts are compared by member names and bytes, and the package verifier checks the exact archived r01/r02 hashes again after the entire test suite. Existing r01 and r02 archives are retained byte-for-byte. No guide prose, graph routing, owner decision, hypnosis contract, or installed production policy changes in v0.14.4.

## A001 stage-aware audit recovery

This release fixes the live failure in which Fable completed `case_extraction`, `gpt-5.6-sol` failed during `case_audit`, and the second audit exception escaped as `uncaught-error`.

The runtime now:

- attributes provider, parsing, and validation failures to the exact model stage and role;
- checkpoints each validated A001 extraction before audit begins;
- retries only the failed Codex audit once when the cause is transient or a correctable structured-result failure;
- resumes that audit after restart without repeating completed Claude extraction;
- never treats a Codex audit failure as a reason to invoke Fable;
- performs one official `codex login` browser recovery when Codex authentication expires;
- shows the normalized failure class/model/cause in terminal and local status; and
- exports the safe A001 attempt ledger while excluding the clinical checkpoint and raw provider data.

The already completed Fable extraction from the v0.14.2 failed run cannot be reconstructed because v0.14.2 never wrote a stage checkpoint. The first stage-aware validation on v0.14.3 or later may therefore repeat that extraction once. Subsequent completed extractions are resumable.

## Complete Guide Packet source and service recovery

This release corrects the Guide Packet compilation boundary and keeps recovery/status/export services available after deterministic validation or promotion failures. Opus now receives the complete verified canonical guide prose rather than empty section previews. The packet also includes the cited Vagal Blitz page-5 source evidence with explicit provenance and validation limits. It does not use the old Claude Artifact JSX and does not replace installed therapy policy merely because new article text exists.

A guide packet preserves these layers separately:

- complete canonical inner-child and somatic source HTML;
- exact editor-body text and source maps;
- executable inner-child, somatic, and cross-guide graphs;
- owner amendments and product-only operational rules;
- provenance, certainty, and authority records;
- attached Vagal Blitz page-5 PDF/text evidence with an explicit `independentlyValidated=false` caveat;
- decision-case regressions;
- reverse graph-to-guide quality findings;
- concise owner decision cards.

The corrected packet `inner-signal-guides-2026.08.12-r02-candidate` supersedes r01 as the bundled **candidate**. The canonical article revisions remain `r01-candidate` because their prose is unchanged; r02 corrects packet evidence, model input, and graph-owned safety verification. The original r01 ZIP remains byte-for-byte preserved. Neither candidate changes production policy until every substantive behavioral decision receives owner approval and the approved derivative passes deterministic install verification.

## Guide Packet workflow

The **Guide Packet** tab shows:

- installed packet, guide, graph, and source hashes;
- candidate verification and independent Codex review;
- source identity diff and exact affected regressions;
- concise behavioral decision cards with behavioral effect, provenance, and worst plausible failure;
- reverse guide-quality findings;
- install, rollback, and exact export controls.

The packet pipeline is:

```text
ZIP/path/hash/schema verification
→ source/graph/provenance validation
→ behavioral diff and quality audit
→ Claude Opus 5 compilation from complete verified source text
→ independent Codex review
→ Fable only for unresolved material disagreement
→ owner decisions for substantive therapy/framework changes
→ atomic install
→ affected regression checks
→ rollback retained
```

Every long-running stage has an attempt ID, exact model, worker PID, heartbeat, timestamps, expected next gate, durable output, and normalized failure class. Startup reconciliation converts orphaned work into `RECOVERING / STALE_STAGE` and resumes the first missing stage without rebuilding the packet or clearing owner decisions. If a newer bundled candidate is found, unchanged owner decisions carry forward only when their full decision contract is identical; changed or new decisions remain pending, and the older candidate is retained unchanged.

Deterministic code owns path safety, checksums, schemas, source/graph freshness, graph reachability, provenance enforcement, packet identity, install, export, and rollback. The somatic advanced-release suppression is now declared by the candidate graph itself and protected by a fifth affected regression. Models cannot approve policy on Joel's behalf.

## Model policy

- `claude-sonnet-4-6`: ordinary constrained extraction and realization after planning is validated.
- `claude-opus-5`: primary deep reasoning, guide compilation when recompilation is genuinely required, and autonomous code repair.
- `gpt-5.6-sol`: independent guide-packet audit, case audit, adversarial critic, patch reviewer, and replay comparator.
- `claude-fable-5`: difficult unresolved escalation only.

All local development uses subscription-backed CLIs rather than API billing. Guide Packet compilation accepts only `claude-opus-5`; independent review accepts only `gpt-5.6-sol`; conditional adjudication accepts only `claude-fable-5`. Blank selectors, CLI defaults, aliases, and other models cannot satisfy these roles. Live entitlement evidence is recorded before work begins.

## One-time French Zorin bootstrap

```bash
cd "$HOME/Téléchargements"
command -v gh >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y gh; }
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
gh auth setup-git
if [[ -d innerSignalGraph/.git ]]; then
  git -C innerSignalGraph fetch --prune origin stable
  git -C innerSignalGraph merge --ff-only origin/stable
else
  gh repo clone u-dont-existDOTcom/innerSignalGraph innerSignalGraph -- --branch stable
fi
bash innerSignalGraph/packaging/install-from-git.sh
```

The bootstrap installs to `~/Téléchargements/inner-signal-runtime` while keeping the checkout at `~/Téléchargements/innerSignalGraph`. Future launches update and repair automatically; routine release-ZIP downloads and diagnostic-ZIP uploads are unnecessary.

## Executive development supervision

The always-visible Overall Development supervisor remains intact. It uses deterministic state as the source of truth and may automatically direct restorative repair through isolated Opus/Fable candidates, parent-owned tests, and independent Codex review. It stops only for substantive therapy/safety/framework policy, authentication/permissions, or genuinely missing canonical source.

Guide-packet processing appears in the same always-visible supervisor, including actual stage/model, elapsed time, last successful transition, failure class, recovery action, next expected gate, and whether owner input is actually required. While Guide Packet work is foregrounded, its status is isolated from unrelated historical development-repair text. Stable packet facts participate in the supervisor fingerprint, so unchanged quiescent state does not repeat Codex analysis or append duplicate history.

## Therapy and hypnosis non-regression

The current production bundle `inner-child-somatic-pilot-2026-08-09-r5`, directed-graph planner, incremental case state, Fast/Reviewed/Deep/Forensic tiers, response-realization contract, and app-owned hypnosis gate/route/waking-return architecture remain in place. A staged guide candidate does not change A001, H001, ordinary therapy routing, or browser sessions until it is approved and atomically installed.

## Local state

Browser conversations stay browser-local. Runtime evidence, queued safe incidents, delivery receipts, candidate packets, owner decisions, installed packets, and rollback history remain under `.inner-signal-autopilot/`. Automatic remote diagnostics use the stricter ten-field allowlist described above. The optional one-click local recovery ZIP remains available for support and excludes browser chat, therapy reasoning ledgers, development-case payloads, Guide Packet ZIP bodies, `.env`, credentials, tokens, and runtime secrets.
