# Reading-first journal importer — selective stable candidate

**Status:** DRAFT / EXPERIMENTAL BACKPORT / NOT RELEASED / NOT INSTALLED.
**Owner outcome:** Chronologically read and synthesize original source before building a new enriched index and graph, while keeping the existing quote index available.
**Parent tasks:** #183 and #168. Development source: merged PR #184 (4aa0d239debb304827dc657d91dfeac9ecc6ca8f). Frozen stable base: d74ae8b02d11b7edc72c70a753f6d93cf61e93b5 (15 September 2026).

## Scope and boundaries

The September stable branch contains no src/journal-import implementation. Applying the PR #184 patch alone fails because its pre-existing target files are absent. The importer + test static dependency closure contains 97 modules. This candidate copies the needed development-source code, schemas and synthetic tests while retaining existing stable provider modules and the existing guide-graph contract unchanged.

The reviewed draft now contains **139 added** and **6 modified** files relative to September stable. The existing changed files are the workflow bootstrap, package manifest, installation Node gate, fail-safe updater, and their launcher/updater tests. Existing stable provider modules and the guide-graph contract remain unchanged. The package change adds the journal CLI and three locked dependencies (ajv, jose, pdfjs-dist), retaining the original stable verifier. The dynamic production PDF and UTF-8 parser child/adapters were included after a mock-only dependency gap was discovered.

Additional review findings were corrected in this draft: a shared virtual-chunk inventory allows real page-less Unicode text to be read and mapped without inventing physical page citations, declared visual hazards remain pending, and unsupported OpenAI/Anthropic legacy provider factories are no longer exposed as functional journal inference routes. The missing trusted desktop image-tool validator is **not** recreated or bypassed; tool-permitted visual packets now fail before submission until a separate independently reviewed validator and policy decision exist. This intentionally leaves that tool-use mode unavailable. Native image handling or qualified human review is a distinct consented path.

Node's source-bound Argon2 dependency requires Node **24–26** in this candidate, enforced in package engines and the installer; the owner's desktop currently runs Node 26, on which a detached synthetic PDF/text parser smoke test passed (not a complete installed-runtime test). Older Node 20/22 installations must retain their currently working release rather than attempt this candidate.

The previously failing hosted Verify job was traced to absent dependency bootstrap: the September workflow skipped npm ci. The draft adds exact-lock npm ci without lifecycle scripts before CI tests, and the transactional updater now installs dependencies in both disposable validation and freshly reconstructed installation staging. Failure or missing lock retains the prior runtime and private bytes. Tests exercise first- and second-stage installation failure, locked dependency provenance, and sensitive-environment exclusion. No stable branch or running service was altered.

## Synthetic evaluation — 25 October 2026

- Reading-first and importer regression suite: passed, including 1,000-page synthesis provenance, pending modality/refusal, stage ordering, legacy lookup, and resume.
- Existing and new npm test suite: **299/299 passed**, including expanded Node, dependency, plain-text, and provider preflight tests.
- Import CLI doctor --mock: passed, no private data, mutation, or external model spend.
- Graph regression gate: passed.
- Original stable npm run verify package gate: **PASS (299/299 tests)**. Mock installer, rollback, private-byte preservation, package hygiene and guide checks passed.
- Offline npm ci --ignore-scripts: passed with the selective lockfile.
- The verifier temporarily regenerated two known outputs; these were restored to their exact pre-verify state. Staged change checks are clean.

These are synthetic engineering checks only. They do not demonstrate actual journal comprehension, production compatibility on the owner's machine, live-provider entitlement, or approval to ship.

## Open gates — no automatic promotion

1. Independently review the corrected complete backport, exact copy/provenance, dependency bootstrap, unsupported provider/desktop-tool exclusions, private-case boundaries and the Node 24–26 deployment requirement.
2. Obtain exact-head hosted verification, CodeQL and repository policy, as well as the applicable release-evidence and owner-decision gates in docs/RELEASE-EVIDENCE.md on development main.
3. Require explicit owner approval for changing stable and installing the candidate. A general request to continue development is not production-release authorization.
4. Preserve the prior runtime, check private data byte preservation, exercise rollback and startup/health checks, and verify exact installed source on the authorized host.
5. The last qualified 1,122-page journal audit still had **306 pages** with unresolved original text/media review. Do not bypass a tool refusal or claim a complete new generation while this remains pending. Any partial generation requires explicit authorization and visible coverage.

**Next safe action:** Request independent draft review and hosted checks. The stable branch, running services, original private journal and published index are unchanged.
