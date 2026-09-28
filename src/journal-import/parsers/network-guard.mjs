import { registerHooks } from "node:module";

const BLOCKED_NETWORK_MODULES = new Set([
  "net", "node:net", "tls", "node:tls", "http", "node:http", "https", "node:https",
  "http2", "node:http2", "dgram", "node:dgram", "dns", "node:dns", "dns/promises", "node:dns/promises"
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (BLOCKED_NETWORK_MODULES.has(specifier)) throw new Error("PARSER_NETWORK_MODULE_BLOCKED");
    return nextResolve(specifier, context);
  }
});

const denied = () => { throw new Error("PARSER_NETWORK_ACCESS_BLOCKED"); };
Object.defineProperty(globalThis, "fetch", { value: denied, writable: false, configurable: false });
if (Object.hasOwn(globalThis, "WebSocket")) {
  Object.defineProperty(globalThis, "WebSocket", { value: class BlockedWebSocket { constructor() { denied(); } }, writable: false, configurable: false });
}

export const PARSER_NETWORK_POLICY = Object.freeze({
  builtin_network_modules: "blocked",
  fetch: "blocked",
  websocket: "blocked",
  external_urls: "not_followed"
});
