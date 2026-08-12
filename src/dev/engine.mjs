export const DEV_ENGINE_REVISION = "continuous-dev-v6-2026-08-11";

export function shouldRetryTerminalDevelopmentJob(existing) {
  if (!existing || !existing.status) return false;
  if (existing.humanDecision?.decision === "reject") return false;
  if (["review-pending", "live-regression-pending", "audit-pending"].includes(existing.status)) return true;
  if (existing.status === "blocked") return existing.engineRevision !== DEV_ENGINE_REVISION;
  if (existing.status === "complete" && existing.outcome === "investigated-no-safe-repair") {
    return existing.engineRevision !== DEV_ENGINE_REVISION;
  }
  return false;
}
