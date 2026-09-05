/**
 * Offline multi-stage reflection controller.
 *
 * This coordinates freshness and explicit review boundaries only. It does not
 * extract evidence, judge clinical truth, call a model, render prose, persist
 * history, unlock a vault, or authenticate a user.
 */
const outcome = (allowed, reason) => Object.freeze({ allowed, reason });
const literalTrue = fn => {
  try { return typeof fn === 'function' && fn() === true; }
  catch { return false; }
};
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function createReflectionController() {
  let epoch = Object.freeze(Object.create(null));
  const invalidate = () => { epoch = Object.freeze(Object.create(null)); };

  const stillCurrent = (started, adapter, version, eligible, snapshot) =>
    epoch === started && literalTrue(() => adapter.isCurrent(version)) && literalTrue(() => eligible(snapshot));

  return Object.freeze({
    invalidate,
    async run({ snapshotAdapter, eligible, draft, semanticReview } = {}) {
      // A newer run always supersedes older work, even if this run is denied.
      invalidate();
      const started = epoch;
      if (!snapshotAdapter || typeof snapshotAdapter.capture !== 'function' ||
          typeof snapshotAdapter.isCurrent !== 'function' || typeof eligible !== 'function' ||
          typeof draft !== 'function') return outcome(false, 'INVALID_PIPELINE_ADAPTER');

      let captured;
      try { captured = snapshotAdapter.capture(); }
      catch { return outcome(false, 'SNAPSHOT_UNAVAILABLE'); }
      if (!plain(captured) || !Object.hasOwn(captured, 'version') || !Object.hasOwn(captured, 'snapshot')) {
        return outcome(false, 'INVALID_SNAPSHOT');
      }
      const { version, snapshot } = captured;
      if (!stillCurrent(started, snapshotAdapter, version, eligible, snapshot)) {
        return outcome(false, 'NOT_CURRENT_OR_ELIGIBLE');
      }

      let text;
      try { text = await draft(snapshot); }
      catch { return outcome(false, 'DRAFT_FAILED'); }
      if (!stillCurrent(started, snapshotAdapter, version, eligible, snapshot)) {
        return outcome(false, 'STALE_AFTER_DRAFT');
      }
      if (!nonempty(text)) return outcome(false, 'INVALID_DRAFT');
      const candidate = Object.freeze({ text });
      const reviewBinding = Object.freeze(Object.create(null));

      // Freshness/provenance are necessary but never semantic approval.
      if (typeof semanticReview !== 'function') return outcome(false, 'SEMANTIC_REVIEW_REQUIRED');
      let review;
      try {
        review = await semanticReview(Object.freeze({ snapshot, candidate, version, reviewBinding }));
      } catch {
        return outcome(false, 'SEMANTIC_REVIEW_FAILED');
      }
      if (!stillCurrent(started, snapshotAdapter, version, eligible, snapshot)) {
        return outcome(false, 'STALE_AFTER_SEMANTIC_REVIEW');
      }
      if (!plain(review) || review.approved !== true) return outcome(false, 'SEMANTIC_REVIEW_DENIED');
      if (review.candidate !== candidate || review.version !== version || review.reviewBinding !== reviewBinding) {
        return outcome(false, 'SEMANTIC_REVIEW_NOT_BOUND');
      }
      // Recheck immediately before release. The caller still owns actual display.
      if (!stillCurrent(started, snapshotAdapter, version, eligible, snapshot)) {
        return outcome(false, 'STALE_BEFORE_DISPLAY');
      }
      return Object.freeze({ allowed: true, reason: 'READY_FOR_DISPLAY', candidate });
    }
  });
}
