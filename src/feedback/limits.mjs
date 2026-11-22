import { createHmac, randomBytes } from "node:crypto";

// Rate limits held only in memory (design section 5). Each rule is a list of fixed windows; a key is let through only while every
// window still has room, and only then is it counted. Keys are an HMAC of the client address under a key made at start, so no
// address is ever kept, and a key is forgotten when its longest window ends. The map is bounded: past `maxKeys` the oldest key is
// dropped (the overall rules still bound what many addresses can do together).

export const FEEDBACK_LIMIT_RULES = Object.freeze({
  page_send: Object.freeze([{ windowMs: 10 * 60_000, max: 5 }, { windowMs: 24 * 3_600_000, max: 20 }]),
  chat_send: Object.freeze([{ windowMs: 10 * 60_000, max: 10 }, { windowMs: 24 * 3_600_000, max: 50 }]),
  any_send: Object.freeze([{ windowMs: 10 * 60_000, max: 30 }, { windowMs: 24 * 3_600_000, max: 300 }]),
  delete_attempt: Object.freeze([{ windowMs: 3_600_000, max: 10 }]),
  any_delete_attempt: Object.freeze([{ windowMs: 3_600_000, max: 100 }]),
  owner_failure: Object.freeze([{ windowMs: 10 * 60_000, max: 5 }]),
  any_owner_failure: Object.freeze([{ windowMs: 10 * 60_000, max: 20 }])
});

export function createRateLimiter({ rules = FEEDBACK_LIMIT_RULES, now = Date.now, maxKeys = 10_000 } = {}) {
  const counters = new Map();
  const windowsOf = (rule) => {
    const windows = rules[rule];
    if (!windows) throw new TypeError(`Unknown rate-limit rule ${rule}.`);
    return windows;
  };
  const entryFor = (rule, key, at) => {
    const name = `${rule}\u0000${key}`;
    let entry = counters.get(name);
    const windows = windowsOf(rule);
    const longest = Math.max(...windows.map((window) => window.windowMs));
    if (entry && at - entry.lastSeen >= longest) {
      counters.delete(name);
      entry = null;
    }
    if (!entry) {
      entry = { lastSeen: at, windows: windows.map((window) => ({ ...window, start: at, count: 0 })) };
      counters.set(name, entry);
      while (counters.size > maxKeys) counters.delete(counters.keys().next().value);
    }
    for (const window of entry.windows) {
      if (at - window.start >= window.windowMs) {
        window.start = at;
        window.count = 0;
      }
    }
    return entry;
  };
  return Object.freeze({
    // True and counted when every window has room; false (and not counted) otherwise.
    take(rule, key = "*") {
      const at = now();
      const entry = entryFor(rule, key, at);
      if (entry.windows.some((window) => window.count >= window.max)) return false;
      for (const window of entry.windows) window.count += 1;
      entry.lastSeen = at;
      return true;
    },
    // Whether the next take would be refused, without counting.
    full(rule, key = "*") {
      const at = now();
      return entryFor(rule, key, at).windows.some((window) => window.count >= window.max);
    },
    size() { return counters.size; }
  });
}

// The client's key: the connection's address, or, when the proxy is trusted (setting INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR),
// the last address in X-Forwarded-For, which is the one our own proxy appends. Never stored; only its HMAC is used as a key.
export function createClientKeyer({ trustForwardedFor = false, secret = randomBytes(32) } = {}) {
  return (req) => {
    let address = req?.socket?.remoteAddress ?? "unknown";
    if (trustForwardedFor) {
      const header = req?.headers?.["x-forwarded-for"];
      const value = Array.isArray(header) ? header.at(-1) : header;
      const last = typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean).at(-1) : null;
      if (last && last.length <= 64) address = last;
    }
    return createHmac("sha256", secret).update(address, "utf8").digest("hex").slice(0, 32);
  };
}
