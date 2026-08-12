function textOf(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value ?? ""); }
}

export function looksLikeClaudeAuthFailure(value) {
  const text = textOf(value).toLowerCase();
  if (!text) return false;
  const patterns = [
    /oauth[^\n]{0,120}(?:expired|refresh|invalid|failed)/i,
    /refresh[^\n]{0,120}(?:token|grant)[^\n]{0,120}(?:expired|invalid|failed)/i,
    /refresh[^\n]{0,120}(?:failed|expired|invalid)/i,
    /(?:authentication|auth)[^\n]{0,120}(?:expired|failed|required|invalid)/i,
    /(?:not|no longer)\s+(?:logged|signed)\s+in/i,
    /login\s+(?:is\s+)?required/i,
    /run\s+[`'\"]?claude\s+auth\s+login/i,
    /claude\s+auth\s+login/i,
    /\b401\b[^\n]{0,80}(?:unauthorized|authentication|oauth|token)/i,
    /(?:unauthorized|invalid token|expired token)/i
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function hypnosisRunHasClaudeAuthFailure(run) {
  return Boolean(run?.attempts?.some((attempt) => looksLikeClaudeAuthFailure(attempt?.error)));
}

export function resolutionHasClaudeAuthFailure(resolution) {
  return Boolean(resolution?.attempts?.anthropic?.some((attempt) => looksLikeClaudeAuthFailure(attempt)));
}
