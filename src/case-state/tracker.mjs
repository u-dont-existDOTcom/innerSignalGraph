import { ValidationError } from "../core/errors.mjs";

export const TRACKER_VERSION = 1;
export const TRACKER_CONTEXT_LIMIT = 180;
const SCORE_FIELDS = ["sleep_quality", "pain_intensity", "pain_function_interference", "anxiety", "depressed_mood", "stability", "unreality", "division", "social_contact_quality", "rejection_impact", "shaking_intensity", "functioning"];

const finiteScore = (value, name) => {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 10) throw new ValidationError(`${name} must be from 0 to 10 or null.`);
  return value;
};
const optionalText = (value, name, max = 2400) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) throw new ValidationError(`${name} must be bounded text.`);
  return value;
};
const textArray = (value, name) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 40 || value.some((item) => typeof item !== "string" || item.length > 600)) throw new ValidationError(`${name} must contain bounded text.`);
  return value;
};

export function validateTrackerEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("tracker entry must be an object.");
  if (value.schema_version !== TRACKER_VERSION) throw new ValidationError("tracker entry schema_version is invalid.");
  for (const field of ["id", "observed_at"]) if (typeof value[field] !== "string" || !value[field].trim()) throw new ValidationError(`tracker entry ${field} is required.`);
  if (value.thc_used != null && typeof value.thc_used !== "boolean") throw new ValidationError("thc_used must be boolean or null.");
  const entry = {
    schema_version: TRACKER_VERSION,
    id: value.id,
    observed_at: value.observed_at,
    sleep_duration_hours: value.sleep_duration_hours == null ? null : Number(value.sleep_duration_hours),
    sleep_quality: finiteScore(value.sleep_quality, "sleep_quality"),
    pain_intensity: finiteScore(value.pain_intensity, "pain_intensity"),
    pain_location: optionalText(value.pain_location, "pain_location", 400),
    pain_function_interference: finiteScore(value.pain_function_interference, "pain_function_interference"),
    anxiety: finiteScore(value.anxiety, "anxiety"),
    depressed_mood: finiteScore(value.depressed_mood, "depressed_mood"),
    stability: finiteScore(value.stability, "stability"),
    unreality: finiteScore(value.unreality, "unreality"),
    division: finiteScore(value.division, "division"),
    social_contact_quality: finiteScore(value.social_contact_quality, "social_contact_quality"),
    rejection_impact: finiteScore(value.rejection_impact, "rejection_impact"),
    shaking_minutes: value.shaking_minutes == null ? null : Number(value.shaking_minutes),
    shaking_intensity: finiteScore(value.shaking_intensity, "shaking_intensity"),
    shaking_timing: optionalText(value.shaking_timing, "shaking_timing", 240),
    thc_used: value.thc_used ?? null,
    thc_timing: optionalText(value.thc_timing, "thc_timing", 240),
    substances_medications_supplements: textArray(value.substances_medications_supplements, "substances_medications_supplements"),
    interventions: textArray(value.interventions, "interventions"),
    food_exposures: textArray(value.food_exposures, "food_exposures"),
    stressors_events: textArray(value.stressors_events, "stressors_events"),
    activities: textArray(value.activities, "activities"),
    functioning: finiteScore(value.functioning, "functioning"),
    journal_note: optionalText(value.journal_note, "journal_note", 12000),
    dream_note: optionalText(value.dream_note, "dream_note", 12000)
  };
  if (entry.sleep_duration_hours != null && (!Number.isFinite(entry.sleep_duration_hours) || entry.sleep_duration_hours < 0 || entry.sleep_duration_hours > 24)) throw new ValidationError("sleep_duration_hours must be from 0 to 24 or null.");
  if (entry.shaking_minutes != null && (!Number.isFinite(entry.shaking_minutes) || entry.shaking_minutes < 0 || entry.shaking_minutes > 1440)) throw new ValidationError("shaking_minutes must be from 0 to 1440 or null.");
  return entry;
}

export function appendTrackerEntry(entries, entry) {
  if (!Array.isArray(entries)) throw new ValidationError("tracker entries must be an array.");
  const next = entries.map((item) => validateTrackerEntry(item));
  const validated = validateTrackerEntry(entry);
  if (next.some((item) => item.id === validated.id)) throw new ValidationError(`Duplicate tracker entry ${validated.id}.`);
  next.push(validated);
  return next.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
}

function metricSummary(values) {
  if (!values.length) return { count: 0, first: null, last: null, min: null, max: null };
  return { count: values.length, first: values[0], last: values.at(-1), min: Math.min(...values), max: Math.max(...values) };
}

export function summarizeTrackerWindow(entries, { from = null, to = null, maximumEntries = TRACKER_CONTEXT_LIMIT } = {}) {
  if (!Array.isArray(entries)) throw new ValidationError("tracker entries must be an array.");
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > TRACKER_CONTEXT_LIMIT) throw new ValidationError("maximumEntries is outside the bounded tracker-context policy.");
  const eligible = entries.map((entry) => validateTrackerEntry(entry)).filter((entry) => (!from || entry.observed_at >= from) && (!to || entry.observed_at <= to)).sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const selected = eligible.slice(-maximumEntries);
  const metrics = {};
  for (const field of ["sleep_duration_hours", ...SCORE_FIELDS, "shaking_minutes"]) metrics[field] = metricSummary(selected.map((entry) => entry[field]).filter(Number.isFinite));
  return Object.freeze({
    schema_version: 1,
    interpretation: "descriptive_only_no_causal_inference",
    from: selected[0]?.observed_at ?? from,
    to: selected.at(-1)?.observed_at ?? to,
    entry_count: selected.length,
    eligible_entry_count: eligible.length,
    truncated_for_bound: selected.length < eligible.length,
    omitted_entry_count: eligible.length - selected.length,
    metrics,
    exposure_counts: {
      thc_used: selected.filter((entry) => entry.thc_used === true).length,
      shaking_recorded: selected.filter((entry) => entry.shaking_minutes != null || entry.shaking_intensity != null).length,
      social_or_rejection_event: selected.filter((entry) => entry.social_contact_quality != null || entry.rejection_impact != null).length
    },
    missingness: Object.fromEntries(Object.entries(metrics).map(([field, summary]) => [field, selected.length - summary.count])),
    note: "Temporal co-occurrence and change are observation prompts, not evidence that one tracked variable caused another."
  });
}
