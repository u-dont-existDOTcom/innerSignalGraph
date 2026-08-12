import { ValidationError } from "./errors.mjs";

function stripFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function firstBalancedObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (start === -1) start = i;
      depth += 1;
    } else if (char === "}" && start !== -1) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseModelJson(text, label = "model response") {
  if (typeof text !== "string" || !text.trim()) {
    throw new ValidationError(`${label} was empty.`);
  }

  const stripped = stripFence(text);
  const candidates = [stripped, firstBalancedObject(stripped)].filter(Boolean);
  let lastError;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw new ValidationError(`${label} was not valid JSON.`, {
    cause: lastError,
    details: { preview: stripped.slice(0, 500) }
  });
}
