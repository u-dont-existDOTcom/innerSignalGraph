// How an on/off setting is read from the environment. Every switch that is off unless someone turns it on reads its value this way:
// INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS (the reply-draft connector) and INNER_SIGNAL_OWNER_FALLBACK (the fixed fallback message).
//
// Absent or blank is off. 1, true, yes or on is on. 0, false, no or off is off. Case and surrounding spaces do not matter. Any other
// value gives null, and the caller stops startup with an error that names the setting and never prints the value it was given.
export function readOnOffSetting(raw) {
  if (raw == null || raw.trim() === "") return false;
  const word = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(word)) return true;
  if (["0", "false", "no", "off"].includes(word)) return false;
  return null;
}
