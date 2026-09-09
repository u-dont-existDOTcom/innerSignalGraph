/**
 * Offline request-freshness seam, not authentication, storage or semantic review.
 * Holds one opaque in-memory ticket and epoch, never evidence, source IDs, hashes,
 * user identity or reply prose. The trusted caller must invalidate before every
 * context/consent/source/lifecycle change and clear its own rendered data.
 */
export function createReflectionHandoff() {
  let pending = null;
  let epoch = null;
  const outcome = (allowed, reason) => Object.freeze({ allowed, reason });
  const eligible = check => {
    try { return typeof check === 'function' && check() === true; }
    catch { return false; }
  };
  const invalidate = () => { pending = null; epoch = Object.freeze(Object.create(null)); };
  return Object.freeze({
    begin(check) {
      // Even an ineligible newer attempt supersedes an older one.
      invalidate();
      const started = epoch;
      const allowed = eligible(check);
      if (epoch !== started) return outcome(false, 'CONTEXT_CHANGED_DURING_CHECK');
      if (!allowed) return outcome(false, 'NOT_ELIGIBLE');
      const ticket = Object.freeze(Object.create(null));
      pending = ticket;
      return Object.freeze({ allowed: true, reason: 'QUEUED', ticket });
    },
    consume(ticket, check) {
      // Reject stale input before any callback; never erase a newer ticket.
      if (pending === null || ticket !== pending) return outcome(false, 'STALE_OR_UNKNOWN_REPLY');
      const started = epoch;
      pending = null; // One use, including a failed recheck.
      const allowed = eligible(check);
      if (epoch !== started) return outcome(false, 'CONTEXT_CHANGED_DURING_CHECK');
      if (!allowed) return outcome(false, 'NOT_ELIGIBLE');
      return outcome(true, 'FRESH_FOR_REVIEW_ONLY');
    },
    invalidate
  });
}
