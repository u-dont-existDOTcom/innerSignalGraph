// A worker's failures for which its call is made once more, for a reply's workers (runtime.mjs) and the cold test's (journal-cold-test.mjs)
// alike: the call didn't finish in its time, or gave no whole answer. Never a plan limit, a lapsed sign-in, a refusal or an action taken.
export const RETRYABLE_WORKER_FAILURES = Object.freeze(["TIMEOUT", "PROVIDER_MALFORMED", "CODEX_RECEIPT_INCOMPLETE"]);
