# InnerSignal web-app stack direction

Status: OWNER-SELECTED
Date: 2026-09-19
Scope: web application architecture direction only

## Owner outcome

Keep future InnerSignal web-app work from drifting into a second backend or a framework/platform choice that duplicates the existing runtime.

## Selected stack

- Frontend: React + Vite + TypeScript.
- Delivery shape: installable Progressive Web App (PWA) first; native wrappers are a later decision if they become useful.
- Application/backend: preserve and evolve the existing Node 24 InnerSignal runtime and its current API/service boundaries.
- Hosting/deployment target: Railway.
- Current sensitive persistence: preserve the existing encrypted private-case/runtime storage architecture; do not replace it merely to build the frontend.
- Later multi-user relational persistence, if/when required: PostgreSQL is the default data model. Supabase is the preferred managed option to evaluate when authentication, relational persistence, or object storage are needed.
- Firebase/Firestore is not the default architecture.
- Next.js is not the default frontend framework for this application.

## Why this direction fits the existing system

InnerSignal already has a substantial server-side therapy runtime, private-case encryption, model orchestration, MCP/service boundaries, and an existing browser application under `apps/web/`. The web-app task is therefore primarily a frontend/product evolution around an existing backend, not a greenfield full-stack rewrite.

The selected stack keeps therapy logic, secrets, model credentials, private-case persistence, and other sensitive controls on the server. It also avoids introducing a second server runtime solely because a frontend framework can provide one.

## Build rules

1. New user-facing web work should evolve toward React + Vite + TypeScript rather than expanding the current large vanilla-JS UI indefinitely.
2. Migrate incrementally. Existing `apps/web/` behavior may remain while equivalent React surfaces are built and verified.
3. Do not rewrite the existing therapy/runtime backend into Firebase, Supabase Edge Functions, Next.js server actions, or another backend framework without a new explicit owner architecture decision.
4. Do not move sensitive therapy data, model keys, audit logic, or private-case cryptography into the browser.
5. Do not introduce Firestore as the primary persistence model by convenience.
6. When multi-user persistence becomes necessary, prefer PostgreSQL semantics; evaluate Supabase as managed infrastructure rather than as authority over the InnerSignal domain model.
7. Railway remains the default deployment target unless a concrete capability, reliability, privacy, or cost requirement establishes a reason to change it.

## Build-readiness staging

### Now: prototype/product iteration is allowed

A thin vertical-slice app can be built now against the existing runtime. Appropriate work includes:

- application shell and navigation;
- therapy chat/session UI;
- streaming response presentation;
- voice/playback controls already supported by the runtime;
- journal/history views using existing safe interfaces;
- responsive/mobile behavior;
- installable PWA plumbing;
- migration of existing `apps/web/` behavior into typed React components.

This stage is for product learning and does not imply public release readiness.

### Before multi-user production

Do not commit to production multi-user architecture until the required account/authentication boundary, encrypted persistence lifecycle, retention/reset behavior, and server-side API contracts are sufficiently stable to avoid frontend-driven security design.

At that point, add PostgreSQL/Supabase only for the responsibilities it actually improves; preserve application-level encryption and server-side therapy controls where required.

### Before public launch

Public launch remains a separate release decision and must satisfy the repository's current privacy, safety, authentication, deployment, rollback, and stable-promotion contracts. This stack decision does not authorize deployment, public release, or `stable` promotion.

## Change control

This is an owner-selected architecture direction. Routine implementation may choose libraries inside this stack. Changing the primary frontend framework, replacing the existing Node runtime, adopting Firebase/Firestore as the primary backend, or moving away from Railway requires a new explicit owner architecture decision.
