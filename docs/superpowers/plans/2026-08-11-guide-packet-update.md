# Guide Packet Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a deterministic, versioned Guide Packet Update system that can verify, stage, diff, audit, approve, atomically install, export, and roll back guide/graph packets without silently changing therapy policy.

**Architecture:** A new `src/guide-packet/` subsystem owns the packet contract, safe ZIP parsing, deterministic verification, source-section extraction, graph/source provenance validation, behavioral diff, decision cards, quality audit, and atomic store. The HTTP server exposes candidate/import/decision/install/rollback/export endpoints; the browser adds a Guide Packet screen. The installed runtime continues using the current guide graph until an owner-approved packet is atomically promoted.

**Tech Stack:** Node.js ESM, built-in `fs`, `crypto`, `zlib`, existing stored-ZIP writer, existing guide-graph validator/planner, browser-local JavaScript UI, node:test.

## Global Constraints

- Start from standalone Inner Signal v0.13.1; do not use the Claude Artifact JSX.
- Use subscription-backed CLIs only in installed live mode; deterministic verification must not require any model or API.
- Candidate guide revisions are fixtures only and must not install without explicit owner approval.
- Deterministic code owns hashes, schema, path safety, provenance, graph reachability, package integrity, promotion, export identity, and rollback.
- Therapy/safety/framework changes always create concise owner decision cards.
- Guide packets exclude user therapy transcripts, credentials, runtime secrets, and autonomous-development logs.
- French Zorin one-command workflow remains under `~/Téléchargements`.

---

### Task 1: ZIP reader and packet contract

**Files:**
- Modify: `src/core/zip.mjs`
- Create: `src/guide-packet/contract.mjs`
- Test: `tests/guide-packet.test.mjs`

**Interfaces:**
- Produces `readZipEntries(buffer)` and packet contract/version/path helpers.

- [x] Write failing tests for stored ZIP read, tamper rejection, CRC mismatch, and zip-slip rejection.
- [x] Run the focused test and confirm RED.
- [x] Implement central-directory parsing for stored/deflated entries and canonical path validation.
- [x] Run the focused test and confirm GREEN.

### Task 2: Source extraction, packet builder, and fixture

**Files:**
- Create: `src/guide-packet/source-html.mjs`
- Create: `src/guide-packet/builder.mjs`
- Create: `guide-packets/fixtures/r01-candidate/*`
- Test: `tests/guide-packet.test.mjs`

**Interfaces:**
- Produces `extractEditorBody`, `extractHtmlSections`, `buildGuidePacket`, and exact fixture ZIP/manifest.

- [x] Add failing tests for exact source/editor-body hashes and stable section extraction.
- [x] Implement raw-island extraction without full-document reserialization.
- [x] Build candidate graphs/source maps/provenance/tests from the supplied candidate HTML and current validated graphs.
- [x] Verify the fixture hashes and candidate-only status.

### Task 3: Deterministic verification, quality audit, and behavioral diff

**Files:**
- Create: `src/guide-packet/verifier.mjs`
- Create: `src/guide-packet/quality-audit.mjs`
- Create: `src/guide-packet/diff.mjs`
- Test: `tests/guide-packet.test.mjs`

**Interfaces:**
- Produces `verifyGuidePacket`, `runGuideQualityAudit`, `buildBehavioralDiff`, and `buildDecisionCards`.

- [x] Add failing tests for missing members, stale source/graph, provenance, monotonic revision, changed route/question/priority/blocked/deferred jobs, graph-only amendments, categorical source wording, cycles, and unreachable nodes.
- [x] Implement minimal deterministic checks and concise decision cards.
- [x] Run focused tests and confirm GREEN.

### Task 4: Atomic store, install, rollback, export, and identity

**Files:**
- Create: `src/guide-packet/store.mjs`
- Test: `tests/guide-packet-store.test.mjs`

**Interfaces:**
- Produces candidate staging, approval recording, atomic install, exact rollback, export, and installed status APIs.

- [x] Add failing tests for candidate staging, no silent install, exact rollback, export/re-import identity, and private-data exclusion.
- [x] Implement atomic directory swaps and durable history.
- [x] Run focused tests and confirm GREEN.

### Task 5: Server API and supervisor integration

**Files:**
- Modify: `src/core/config.mjs`
- Modify: `src/server/create-server.mjs`
- Modify: `src/dev/supervisor-state.mjs`
- Test: `tests/server.test.mjs`
- Test: `tests/development-supervisor.test.mjs`

**Interfaces:**
- Adds `/v1/guides/status`, `/v1/guides/import`, `/v1/guides/decision`, `/v1/guides/install`, `/v1/guides/rollback`, `/v1/guides/export`.

- [x] Add failing endpoint and supervisor-stage tests.
- [x] Implement request parsing, binary ZIP import/export, decision recording, install/rollback, and packet-process status.
- [x] Confirm the installed therapy graph remains unchanged until approval/install.

### Task 6: Guide Packet browser screen

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/app.js`
- Modify: `apps/web/styles.css`
- Test: `tests/web-client.test.mjs`

**Interfaces:**
- Adds Guides tab, packet import, verification summary, decision cards, install, rollback, export, and exact affected-case status.

- [x] Add failing static/browser contract tests.
- [x] Implement concise cards and controls without raw JSON as primary UI.
- [x] Keep Overall Development always visible during packet processing.

### Task 7: Regression, package verification, installer, and release

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-package.sh`
- Modify: `README.md`, `AUTOPILOT.md`, `.env.cli.example`, `.env.example`
- Create: `src/cli/guide-packet-fixture.mjs`
- Modify: outer `install-and-run.sh`

**Interfaces:**
- Produces v0.14.0 atomic release and candidate packet fixture; leaves candidate uninstalled.

- [x] Run A001/H001 mock non-regression, packet tests, complete tests, graph regressions, web smoke, package verify, exact ZIP clean extraction, and dirty-upgrade simulation.
- [x] Verify no credentials/private transcripts are packaged.
- [x] Generate checksums and concise implementation/testing/pending-owner report.
