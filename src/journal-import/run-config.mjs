import path from "node:path";
import { realLocation } from "../core/private-path.mjs";

import { ValidationError } from "../core/errors.mjs";
import { QUOTE_DATE_DEFAULTS, QUOTE_NUMERIC_DATE_ORDERS } from "./quote-index.mjs";
import { POINTER_COPY_RUN_LIMITS, POINTER_COPY_RUN_WORDS } from "./pointer-reference.mjs";

export function journalSemanticConcurrency(config) {
  const value = config.semantic_concurrency === undefined ? 1 : config.semantic_concurrency;
  if (!Number.isSafeInteger(value) || value < 1 || value > 8)
    throw new ValidationError("JOURNAL_SEMANTIC_CONCURRENCY_INVALID", { code: "JOURNAL_SEMANTIC_CONCURRENCY_INVALID" });
  return value;
}

// An optional cap on failed calibration units per round. Unset, a round runs every unit and is judged on its
// pooled totals; it still stops early once a critical reference item is missed or a unit can't be scored, since
// the round can't pass. Checked when a run opens and by doctor, before any import step or inference.
export function journalCalibrationFailureLimit(config) {
  if (config.calibration_failure_limit === undefined || config.calibration_failure_limit === null) return null;
  const value = config.calibration_failure_limit;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ValidationError("JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID", { code: "JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID" });
  return value;
}

// How many critical reference items a calibration round may miss after repairs and still pass. Unset means none,
// the original rule. Each miss stays recorded with its unit, and one more than the limit ends the round.
export function journalCalibrationCriticalMissLimit(config) {
  if (config.calibration_critical_miss_limit === undefined || config.calibration_critical_miss_limit === null) return 0;
  const value = config.calibration_critical_miss_limit;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ValidationError("JOURNAL_CALIBRATION_CRITICAL_MISS_LIMIT_INVALID",
      { code: "JOURNAL_CALIBRATION_CRITICAL_MISS_LIMIT_INVALID" });
  return value;
}

// How the quote index reads an all-numeric date both orders could read (3/4): "month_first", the default,
// or "day_first", for a journal whose owner writes the day first.
export function journalQuoteNumericDateOrder(config) {
  const value = config.quote_numeric_date_order ?? QUOTE_DATE_DEFAULTS.numericOrder;
  if (!QUOTE_NUMERIC_DATE_ORDERS.includes(value))
    throw new ValidationError("JOURNAL_QUOTE_NUMERIC_DATE_ORDER_INVALID", { code: "JOURNAL_QUOTE_NUMERIC_DATE_ORDER_INVALID" });
  return value;
}

// The pointer pass's step deadlines, in minutes (plan 2026-10-09-journal-quote-first.md, Part 3, "Deadlines that
// hold"): the reference step, each pass (the pilot, the full pass and a coverage pass, their event checks included)
// and each measurement. Each step saves its deadline when it starts.
export const POINTER_DEADLINE_DEFAULTS = Object.freeze({ reference: 180, pass: 180, measure: 300 });

export function journalPointerDeadlines(config) {
  const minutes = (name, fallback) => {
    const value = config[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > 24 * 60)
      throw new ValidationError("JOURNAL_POINTER_DEADLINE_INVALID", { code: "JOURNAL_POINTER_DEADLINE_INVALID" });
    return value;
  };
  return Object.freeze({
    reference: minutes("pointer_reference_deadline_minutes", POINTER_DEADLINE_DEFAULTS.reference),
    pass: minutes("pointer_deadline_minutes", POINTER_DEADLINE_DEFAULTS.pass),
    measure: minutes("pointer_measure_deadline_minutes", POINTER_DEADLINE_DEFAULTS.measure)
  });
}

// The pointer pass's copy check (owner decision 30, 12 Oct 2026): a question copies its quote when it holds this many
// of the quote's words in a row. A run keeps the value it started with.
// Where the operator reads review files (`pointer-examples`), named in the private run config: an absolute directory
// that only its owner can open, checked when the command runs. Unset, no command writes journal text anywhere.
export function journalOperatorReviewDir(config) {
  const dir = config.operator_review_dir;
  if (dir === undefined || dir === null) return null;
  if (typeof dir !== "string" || !path.isAbsolute(dir) || dir.includes("\0") || path.normalize(dir) !== dir || path.parse(dir).root === dir)
    throw new ValidationError("JOURNAL_OPERATOR_REVIEW_DIR_INVALID", { code: "JOURNAL_OPERATOR_REVIEW_DIR_INVALID" });
  return dir;
}

export function journalPointerCopyRunWords(config) {
  const value = config.pointer_copy_run_words ?? POINTER_COPY_RUN_WORDS;
  if (!Number.isSafeInteger(value) || value < POINTER_COPY_RUN_LIMITS.min || value > POINTER_COPY_RUN_LIMITS.max)
    throw new ValidationError("JOURNAL_POINTER_COPY_RUN_INVALID", { code: "JOURNAL_POINTER_COPY_RUN_INVALID" });
  return value;
}

// The efforts the hardest lane may set for Claude Opus. Max is the default. The pointer pass's judge runs at high, since at
// max its coverage checks took more than the 30 minutes a Claude call had (owner decision 28, 12 Oct 2026).
export const JOURNAL_HARDEST_EFFORTS = Object.freeze(["high", "max"]);

export function normalizeJournalHardestLaneConfig(config) {
  return Object.freeze({
    enabled: config?.hardest_lane?.enabled === true,
    model: config?.hardest_lane?.model ?? "claude-opus-5-5",
    effort: config?.hardest_lane?.effort ?? "max",
    ttl_hours: config?.hardest_lane?.ttl_hours ?? 24,
    daily_limit: config?.hardest_lane?.daily_limit ?? 20
  });
}

/**
 * Whether a vault root is one this run's config names: its private runtime root, that root's
 * "vaults" directory, or its mount when it has one. Judged on real locations, so doctor and a run
 * accept the same vault however its path is spelled.
 */
export function vaultRootMatchesConfig(config, vaultRoot) {
  const root = config?.private_runtime_root;
  const named = [root, typeof root === "string" ? path.join(root, "vaults") : null, config?.private_runtime_mount]
    .filter((value) => typeof value === "string" && path.isAbsolute(value));
  if (typeof vaultRoot !== "string" || !path.isAbsolute(vaultRoot)) return false;
  const actual = realLocation(vaultRoot);
  return named.some((value) => realLocation(value) === actual);
}
