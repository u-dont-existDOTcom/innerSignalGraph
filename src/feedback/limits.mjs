import { createHmac, randomBytes } from "node:crypto";
import net from "node:net";

// Rate limits held only in memory (design section 5). Each rule is a list of fixed windows; a key is let through only while every
// window still has room, and only then is it counted. Keys are an HMAC of the client address under a key made at start, so no
// address is ever kept, and a key is forgotten when its longest window ends. The map is bounded: past `maxKeys`, expired keys are
// dropped, and if it is still full a new key is refused (an attacker with many addresses can't push out their own counters).

const MINUTES_10 = 10 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Page and chat have their own overall budgets, so a flood through one door leaves the other open. Deletion has no overall cap:
// an 80-bit code can't be guessed, and a cap would let a stranger block everyone's deletions.
export const FEEDBACK_LIMIT_RULES = Object.freeze({
  page_send: Object.freeze([{ windowMs: MINUTES_10, max: 5 }, { windowMs: DAY, max: 20 }]),
  page_all: Object.freeze([{ windowMs: MINUTES_10, max: 30 }, { windowMs: DAY, max: 150 }]),
  chat_send: Object.freeze([{ windowMs: MINUTES_10, max: 10 }, { windowMs: DAY, max: 50 }]),
  chat_all: Object.freeze([{ windowMs: MINUTES_10, max: 30 }, { windowMs: DAY, max: 150 }]),
  delete_attempt: Object.freeze([{ windowMs: HOUR, max: 30 }]),
  owner_failure: Object.freeze([{ windowMs: MINUTES_10, max: 5 }]),
  owner_failure_all: Object.freeze([{ windowMs: MINUTES_10, max: 20 }])
});

export function createRateLimiter({ rules = FEEDBACK_LIMIT_RULES, now = Date.now, maxKeys = 10_000 } = {}) {
  const counters = new Map();
  const windowsOf = (rule) => {
    const windows = rules[rule];
    if (!windows) throw new TypeError(`Unknown rate-limit rule ${rule}.`);
    return windows;
  };
  const longestOf = (windows) => Math.max(...windows.map((window) => window.windowMs));
  const dropExpired = (at) => {
    for (const [name, entry] of counters) if (at - entry.lastSeen >= entry.longest) counters.delete(name);
  };
  // The key's counters, or null when the map is full of live keys.
  const entryFor = (rule, key, at) => {
    const name = `${rule}\u0000${key}`;
    const windows = windowsOf(rule);
    let entry = counters.get(name);
    if (entry && at - entry.lastSeen >= entry.longest) {
      counters.delete(name);
      entry = null;
    }
    if (!entry) {
      if (counters.size >= maxKeys) dropExpired(at);
      if (counters.size >= maxKeys) return null;
      entry = { lastSeen: at, longest: longestOf(windows), windows: windows.map((window) => ({ ...window, start: at, count: 0 })) };
      counters.set(name, entry);
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
      if (!entry || entry.windows.some((window) => window.count >= window.max)) return false;
      for (const window of entry.windows) window.count += 1;
      entry.lastSeen = at;
      return true;
    },
    // Whether the next take would be refused, without counting.
    full(rule, key = "*") {
      const entry = entryFor(rule, key, now());
      return !entry || entry.windows.some((window) => window.count >= window.max);
    },
    size() { return counters.size; }
  });
}

// An IPv6 address's first four groups (its /64, one home connection's usual share), fully written out; IPv4 inside IPv6
// (::ffff:192.0.2.1) is read as the IPv4 address.
export function clientAddressKey(address) {
  let value = String(address ?? "").trim().replace(/%.*$/u, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value);
  if (mapped) value = mapped[1];
  if (net.isIPv4(value)) return value;
  if (!net.isIPv6(value)) return value.slice(0, 64) || "unknown";
  let groups = value.toLowerCase();
  const tailV4 = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(groups);
  if (tailV4) {
    const bytes = tailV4[1].split(".").map(Number);
    groups = `${groups.slice(0, -tailV4[1].length)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const [head, tail] = groups.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail === undefined ? [] : tail ? tail.split(":") : [];
  const parts = tail === undefined ? headParts : [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  return `${parts.slice(0, 4).map((part) => part.padStart(4, "0")).join(":")}::/64`;
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
    return createHmac("sha256", secret).update(clientAddressKey(address), "utf8").digest("hex").slice(0, 32);
  };
}
