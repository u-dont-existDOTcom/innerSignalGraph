# InnerSignal continuity architecture — start here

This package specifies how to make case-history retrieval part of a controlled turn workflow rather than an optional model habit. It preserves native ChatGPT reasoning, private evidence, one user-facing plugin, and the existing candidate/audit lifecycle.

## Read or execute

- **Architecture:** `01-ARCHITECTURE.md`.
- **Interfaces, evidence bindings and errors:** `02-INTERFACES.md`.
- **Give Work this file:** `03-WORK-INSTRUCTION.md`, with the whole package.
- **Acceptance tests and limits:** `04-VERIFICATION-PLAN.md`.
- **Primary sources and reuse decisions:** `05-PRIOR-WORK-AND-SOURCES.md`.
- **Proposed short native instruction:** `CHATGPT-CONTINUITY-INSTRUCTION.md`.
- **Executable examples and test seeds:** `reference/`.
- **Writer-visible synthetic cases / separate evaluator expectations:** `evals/prompts.json` and `evals/gold.json`.
- **Selected machine-readable schemas:** `contracts/`.
- **Actual results and evidence:** `evidence/REFERENCE-VERIFICATION.json`, test output and source register.

## The crucial distinction

A controlled component can submit input to the private service before asking the native ChatGPT model to draft. The service can then refuse to release an approved artifact without recorded context and the required review. That does not make the service an interceptor of every ordinary ChatGPT message, and it does not make model reasoning infallible.

The preferred profile is native-controlled. Ordinary native advisory chat remains available. API inference stays separately authorized and disabled by default. Automatic native dispatch to a truly separate subscription-funded reviewer remains a capability to verify, not an assumed feature.

## Status

The architecture, interface specification, residual Work directive and isolated reference are delivered. The test receipt states exactly which checks ran. The application has not been integrated or deployed by this package; the current private case was not read or migrated; no paid inference was invoked. Passing isolated tests does not mean the user's live workflow is fixed.

The residual work is deliberately bounded: recover the actual host capabilities, extend incumbent source preparation and admission, integrate the native component/profile without silent billing/model changes, and demonstrate the no-reminder behavior at the real consumer boundary. Work should use the proposed architecture, not redesign therapy or invent new authority gates.

No real-client source text or patient-derived identifiers/hashes are intentionally included. The synthetic examples describe ordinary study/commute/task situations rather than a disguised reproduction of a private clinical history.

## Run the isolated checks

From this directory:

```sh
python reference/run_checks.py
```

Requires Python 3 and Node with the built-in test runner. No dependency installation or network access is needed for the reference. The receipt records the actual environment and does not confuse it with the repository's required Node runtime.
