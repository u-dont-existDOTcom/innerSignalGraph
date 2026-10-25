# Reading-first journal importer — selective stable candidate

**Status:** DRAFT / EXPERIMENTAL BACKPORT / NOT RELEASED / NOT INSTALLED.
**Owner outcome:** Chronologically read and synthesize original source before building a new enriched index and graph, while keeping the existing quote index available.
**Parent tasks:** #183 and #168. Development source: merged PR #184 (4aa0d239debb304827dc657d91dfeac9ecc6ca8f). Frozen stable base: d74ae8b02d11b7edc72c70a753f6d93cf61e93b5 (15 September 2026).

## Scope and boundaries

The September stable branch contains no src/journal-import implementation. Applying the PR #184 patch alone fails because its pre-existing target files are absent. The importer + test static dependency closure contains 97 modules. This candidate copies the needed development-source code, schemas and synthetic tests while retaining existing stable provider modules and the existing guide-graph contract unchanged.

The candidate adds 135 source/schema/test/lock files, modifies package.json, and adds this evidence note. It changes package.json only to add the journal:import command and three package dependencies (ajv, jose, pdfjs-dist); the original stable verify script and other existing scripts are preserved. package-lock.json is included for reproducibility. The production parser child and its separate text/PDF adapters were included after a mock-only blind spot was discovered; both real parsers passed synthetic in-memory byte tests. One newly added pointer-pass file was normalized to remove a trailing blank line; all other copied source is public development code.

## Synthetic evaluation — 25 October 2026

- Reading-first suite: 38/38 passed, including 1,000-page synthesis provenance, pending modality/refusal, stage ordering, legacy lookup, and resume.
- Existing and new npm test suite: 288/288 passed.
- Import CLI doctor --mock: passed, no private data, mutation, or external model spend.
- Graph regression gate: passed.
- Original stable npm run verify package gate: PASS. Mock installer, rollback, private-byte preservation, package hygiene and guide checks passed.
- Offline npm ci --ignore-scripts: passed with the selective lockfile.
- The verifier temporarily regenerated two known outputs; these were restored to their exact pre-verify state. Staged change checks are clean.

These are synthetic engineering checks only. They do not demonstrate actual journal comprehension, production compatibility on the owner's machine, live-provider entitlement, or approval to ship.

## Open gates — no automatic promotion

1. Independently review this entire draft backport, exact copied sources, dependency interface, privacy/case-boundary effects, actual release-host Node support, and compatibility of the new importer with the older runtime.
2. Obtain exact-head hosted verification, CodeQL and repository policy, as well as the applicable release-evidence and owner-decision gates in docs/RELEASE-EVIDENCE.md on development main.
3. Require explicit owner approval for changing stable and installing the candidate. A general request to continue development is not production-release authorization.
4. Preserve the prior runtime, check private data byte preservation, exercise rollback and startup/health checks, and verify exact installed source on the authorized host.
5. The last qualified 1,122-page journal audit still had 306 pages with unresolved original text/media review. Do not bypass a tool refusal or claim a complete new generation while this remains pending. Any partial generation requires explicit authorization and visible coverage.

**Next safe action:** Request independent draft review and hosted checks. The stable branch, running services, original private journal and published index are unchanged.
