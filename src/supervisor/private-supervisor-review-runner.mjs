import { RuntimeError, ValidationError } from "../core/errors.mjs";

// Runs supervisor draft reviews in the background of one process, so that a tool call is answered within a bounded time while a
// review that takes minutes (a model audit, up to two model repairs) carries on after it.
//
// What this holds is only scheduling, in memory: which review is running now, what waits for a turn, and what failed a moment ago.
// What a review has done lives in the stored draft lineage, written step by step by the draft service, so nothing here has to
// survive a restart: a process that stops mid-review loses the running job, and the next call about that draft resumes it from the
// step the lineage reached.
//
//   - Reviews for one case run strictly one after another, in the order they were asked for.
//   - At most `concurrency` reviews run at once across cases, and at most `queueLimit` wait for a turn; past that a call is told the
//     service is busy rather than left waiting.
//   - A call waits at most `budgetMs` for its review; if the review is not done by then the call is answered `running` and the
//     review continues.
//   - An identical request that arrives while its review is running joins that review instead of starting another. A request that
//     differs in any way never joins, so the draft service's comparison of a retry with the original still applies to it.
//   - When a review fails because the model service is unavailable, the same draft is not tried again for `cooldownMs`, so a caller
//     that polls does not repeat a failing provider call each time.
//
// The work a job does is whatever the caller passes; this module takes no part in what a review decides.

export const SUPERVISOR_REVIEW_BUSY = "SUPERVISOR_REVIEW_BUSY";
const COOLDOWN_CODES = Object.freeze(["SUPERVISOR_REVIEW_UNAVAILABLE", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"]);

export function createSupervisorReviewRunner({
  concurrency = 2,
  queueLimit = 8,
  budgetMs = 25_000,
  cooldownMs = 30_000,
  now = () => Date.now()
} = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new ValidationError("concurrency must be from 1 to 16.");
  if (!Number.isSafeInteger(queueLimit) || queueLimit < 0 || queueLimit > 256) throw new ValidationError("queueLimit must be from 0 to 256.");
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 0 || budgetMs > 600_000) throw new ValidationError("budgetMs must be from 0 to 600000.");
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 3_600_000) throw new ValidationError("cooldownMs must be from 0 to 3600000.");

  const jobs = new Map();
  const lineages = new Map();
  const caseTails = new Map();
  const failures = new Map();
  const turnQueue = [];
  let running = 0;
  let waiting = 0;

  const lineageKey = (caseId, lineage) => `${caseId}\u0000${lineage}`;

  const acquireTurn = () => {
    if (running < concurrency) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => { turnQueue.push(resolve); });
  };
  const releaseTurn = () => {
    const next = turnQueue.shift();
    if (next) next();
    else running -= 1;
  };

  // Answers when the job finishes, or `running` once the budget has passed. A job that fails inside the budget fails the call; one
  // that fails after it is only remembered (see `finish`), because no call is waiting for it.
  const settle = (job) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ state: "running" }), budgetMs);
    timer.unref?.();
    job.promise.then(
      (value) => { clearTimeout(timer); resolve({ state: "finished", value }); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });

  const finish = (job, error) => {
    if (jobs.get(job.identity) === job) jobs.delete(job.identity);
    if (job.lineage !== null && lineages.get(job.lineageKey) === job) lineages.delete(job.lineageKey);
    if (job.lineage === null) return;
    if (!error) failures.delete(job.lineageKey);
    else if (COOLDOWN_CODES.includes(error?.code) && cooldownMs > 0) failures.set(job.lineageKey, { error, until: now() + cooldownMs });
  };

  return Object.freeze({
    // Starts a review, or joins the identical one already running, and answers `{ state: "finished", value }` or
    // `{ state: "running" }` within the budget. `lineage` names the draft the work reviews (or null when it does not yet exist).
    async run({ caseId, lineage = null, identity, work }) {
      if (typeof caseId !== "string" || !caseId || typeof identity !== "string" || !identity || typeof work !== "function") {
        throw new ValidationError("A review job needs a case, an identity and work to do.");
      }
      const existing = jobs.get(identity);
      if (existing) return settle(existing);
      const key = lineage === null ? null : lineageKey(caseId, lineage);
      const present = now();
      for (const [failedKey, failure] of failures) if (failure.until <= present) failures.delete(failedKey);
      if (key !== null) {
        const recent = failures.get(key);
        if (recent) throw recent.error;
      }
      // A job that has to wait for a turn (another review is running for its case, or every turn is taken) takes a place in the
      // bounded queue; one that can start at once does not.
      if ((running >= concurrency || caseTails.has(caseId)) && waiting >= queueLimit) {
        throw new RuntimeError("InnerSignal is reviewing other drafts right now. Nothing was approved; try again shortly.", { code: SUPERVISOR_REVIEW_BUSY });
      }
      const job = { identity, caseId, lineage, lineageKey: key, promise: null };
      job.promise = (async () => {
        waiting += 1;
        let counted = true;
        const uncount = () => { if (counted) { counted = false; waiting -= 1; } };
        const previous = caseTails.get(caseId) ?? Promise.resolve();
        let releaseCase;
        const tail = new Promise((resolve) => { releaseCase = resolve; });
        caseTails.set(caseId, tail);
        try {
          await previous;
          await acquireTurn();
          uncount();
          try { return await work(); }
          finally { releaseTurn(); }
        } finally {
          uncount();
          releaseCase();
          if (caseTails.get(caseId) === tail) caseTails.delete(caseId);
        }
      })();
      jobs.set(identity, job);
      if (key !== null) lineages.set(key, job);
      job.promise.then(() => finish(job, null), (error) => finish(job, error));
      return settle(job);
    },

    // Joins the review running for a draft, if there is one, and answers like `run`; otherwise null.
    watch({ caseId, lineage }) {
      const job = lineages.get(lineageKey(caseId, lineage));
      return job ? settle(job) : null;
    },

    // What is happening now, without anything that identifies a case or a draft.
    stats() {
      return Object.freeze({ running, waiting, jobs: jobs.size });
    },

    // Resolves when no review is running or waiting. For shutdown and tests.
    async idle() {
      while (jobs.size > 0) await Promise.allSettled([...jobs.values()].map((job) => job.promise));
    }
  });
}
