// How an on/off setting is read from the environment. Every switch that is off unless someone turns it on reads its value this way:
// INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS (reply-draft connector), INNER_SIGNAL_OWNER_FALLBACK (fixed fallback) and
// INNER_SIGNAL_RESPONSE_EVIDENCE (source-support admission).
//
// Absent or blank is off. 1, true, yes or on is on. 0, false, no or off is off. Case and surrounding spaces do not matter. Any other
// value gives null, and the caller stops startup with an error that names the setting and never prints the value it was given.
import { RuntimeError } from "./errors.mjs";

export const RESPONSE_EVIDENCE_SETTING = "INNER_SIGNAL_RESPONSE_EVIDENCE";
export function readResponseEvidenceSetting(environment = process.env) {
  const enabled = readOnOffSetting(environment[RESPONSE_EVIDENCE_SETTING]);
  if (enabled === null) throw new RuntimeError(`${RESPONSE_EVIDENCE_SETTING} must be true or false.`, { code: "BAD_CONFIG" });
  return enabled;
}
export const responseEvidenceReadback = (enforced) => ({
  runtime: enforced ? "internal_runtime_enforced" : "advisory",
  supervisorExport: enforced ? "supervisor_export_enforced" : "advisory",
  journalProvider: "unconfigured"
});

export function readOnOffSetting(raw) {
  if (raw == null || raw.trim() === "") return false;
  const word = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(word)) return true;
  if (["0", "false", "no", "off"].includes(word)) return false;
  return null;
}
