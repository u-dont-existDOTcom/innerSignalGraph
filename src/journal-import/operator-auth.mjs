import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../core/errors.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { isOutside } from "../core/private-path.mjs";
import { vaultRootMatchesConfig } from "./run-config.mjs";

// Operator sign-in for long journal runs. The runtime checks case access before every semantic send,
// and a client-credentials token lasts minutes while a run lasts hours, so the operator's token is
// renewed shortly before it expires instead of being fixed for the whole run.
//
// Secrets come from private env files and the environment. They are never printed, logged or placed
// in an error: every failure carries a code only.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_KEY = /^[A-Z][A-Z0-9_]{0,127}$/u;
const DEFAULT_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
// The hosted operator settings the runtime needs besides the token. Sign-in is attempted only when
// they are all present and the JSON ones parse, so a local configuration error is reported as itself
// and credentials are never sent for a command that can't start.
const OPERATOR_SETTING_NAMES = Object.freeze([
  "INNER_SIGNAL_PRIVATE_ROOT",
  "INNER_SIGNAL_OAUTH_ISSUER",
  "INNER_SIGNAL_OAUTH_AUDIENCE",
  "INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON",
  "INNER_SIGNAL_OPERATOR_CASE_ACL_JSON",
  "INNER_SIGNAL_CASE_KEYS_JSON"
]);

function operatorSettingsReady(environment, config) {
  for (const name of OPERATOR_SETTING_NAMES) {
    if (typeof environment[name] !== "string" || environment[name].length === 0) return false;
    if (name.endsWith("_JSON")) {
      try { JSON.parse(environment[name]); } catch { return false; }
    }
  }
  if (!path.isAbsolute(environment.INNER_SIGNAL_PRIVATE_ROOT)) return false;
  // The vault the settings name must be the one the run config names, as the runtime will check.
  return config === null || vaultRootMatchesConfig(config, environment.INNER_SIGNAL_PRIVATE_ROOT);
}
const MAX_ENV_FILE_BYTES = 1024 * 1024;

function fail(code) {
  throw new ValidationError(code, { code });
}

// KEY=VALUE lines, as Docker Compose env files write them. Blank lines and # comments are skipped. A
// value keeps everything after the first "=", so JSON values survive; one pair of matching outer
// quotes is removed. The file must be private and outside this checkout.
export async function readPrivateJournalEnvFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) fail("JOURNAL_ENV_FILE_PATH_INVALID");
  if (!isOutside(repositoryRoot, filePath)) fail("JOURNAL_ENV_FILE_LOCATION_INVALID");
  const text = await withOpenedRegularFile(filePath, async (handle, info) => {
    if ((info.mode & 0o077) !== 0) fail("JOURNAL_ENV_FILE_MODE_INVALID");
    if (info.size > MAX_ENV_FILE_BYTES) fail("JOURNAL_ENV_FILE_TOO_LARGE");
    return handle.readFile("utf8");
  }).catch((error) => {
    if (error instanceof ValidationError) throw error;
    fail("JOURNAL_ENV_FILE_UNREADABLE");
  });
  const values = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const index = body.indexOf("=");
    if (index <= 0) fail("JOURNAL_ENV_FILE_INVALID");
    const key = body.slice(0, index).trim();
    if (!ENV_KEY.test(key)) fail("JOURNAL_ENV_FILE_INVALID");
    let value = body.slice(index + 1);
    if (value.length >= 2 && (value[0] === "\"" || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    if (!Object.hasOwn(values, key)) values[key] = value;
  }
  return Object.freeze(values);
}

function tokenEndpoint(issuer) {
  let url;
  try { url = new URL(issuer); } catch { fail("OPERATOR_ISSUER_INVALID"); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) fail("OPERATOR_ISSUER_INVALID");
  if (url.search || url.hash || url.username || url.password) fail("OPERATOR_ISSUER_INVALID");
  return `${url.href.replace(/\/+$/u, "")}/protocol/openid-connect/token`;
}

// Keycloak's machine-to-machine flow: the client-credentials grant backed by the client's service
// account. One token is shared until it is within the refresh margin of its expiry.
export function createOperatorTokenProvider({
  issuer,
  clientId,
  clientSecret,
  scope = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  refreshMarginMs = DEFAULT_REFRESH_MARGIN_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) fail("OPERATOR_REQUEST_TIMEOUT_INVALID");
  const endpoint = tokenEndpoint(issuer);
  if (typeof clientId !== "string" || clientId.length === 0) fail("OPERATOR_CLIENT_INVALID");
  if (typeof clientSecret !== "string" || clientSecret.length === 0) fail("OPERATOR_CLIENT_INVALID");
  if (scope !== null && (typeof scope !== "string" || !/^[\x21-\x7e]+( [\x21-\x7e]+)*$/u.test(scope))) fail("OPERATOR_SCOPE_INVALID");
  if (typeof fetchImpl !== "function") fail("OPERATOR_TOKEN_TRANSPORT_UNAVAILABLE");
  if (!Number.isSafeInteger(refreshMarginMs) || refreshMarginMs < 0) fail("OPERATOR_REFRESH_MARGIN_INVALID");
  let current = null;
  let pending = null;

  async function fetchToken() {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    if (scope) form.set("scope", scope);
    // A stalled endpoint must not hold up the run: the request and its body read share one deadline,
    // after which an early renewal falls back to the token still in hand.
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, requestTimeoutMs);
      timer.unref?.();
    });
    let response;
    let body;
    try {
      try {
        response = await Promise.race([fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: form.toString(),
          redirect: "error",
          signal: controller.signal
        }), deadline]);
      } catch { fail("OPERATOR_TOKEN_UNAVAILABLE"); }
      if (!response?.ok) fail("OPERATOR_TOKEN_UNAVAILABLE");
      try { body = await Promise.race([response.json(), deadline]); } catch { fail("OPERATOR_TOKEN_RESPONSE_INVALID"); }
    } finally {
      clearTimeout(timer);
      deadline.catch(() => {});
    }
    const token = body?.access_token;
    const lifetime = body?.expires_in;
    if (typeof token !== "string" || token.length === 0 || !/^[\x21-\x7e]+$/u.test(token)) fail("OPERATOR_TOKEN_RESPONSE_INVALID");
    if (typeof body?.token_type === "string" && body.token_type.toLowerCase() !== "bearer") fail("OPERATOR_TOKEN_RESPONSE_INVALID");
    if (!Number.isFinite(lifetime) || lifetime <= 0) fail("OPERATOR_TOKEN_RESPONSE_INVALID");
    const lifetimeMs = lifetime * 1000;
    // Renew a margin before expiry, but never sooner than halfway through the token's life, so a
    // short-lived token is still reused for a while instead of being requested on every check.
    const fetchedAt = now();
    current = { token, expiresAt: fetchedAt + lifetimeMs, renewAt: fetchedAt + Math.max(lifetimeMs - refreshMarginMs, lifetimeMs / 2) };
    return current;
  }

  return async function operatorAuthContext() {
    if (!current || now() >= current.renewAt) {
      pending ??= fetchToken().finally(() => { pending = null; });
      try { await pending; }
      catch (error) {
        // A failed early renewal keeps a token that is still valid; a later check tries again.
        if (!current || now() >= current.expiresAt) throw error;
      }
    }
    return { bearerToken: current.token };
  };
}

// Prepares the environment one journal command runs with, in place, so the loaders that remove their
// secrets from process.env after reading them still see process.env itself. Private env files fill
// in names the environment doesn't already set. When the operator's client credentials are present,
// the first token is fetched and a renewing auth-context provider is returned for the run; the client
// secret stays in the provider and is removed from the environment.
export async function prepareJournalOperatorEnvironment(environment = process.env, {
  envFiles = [],
  config = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now()
} = {}) {
  if (!environment || typeof environment !== "object") fail("JOURNAL_ENVIRONMENT_INVALID");
  if (!Array.isArray(envFiles)) fail("JOURNAL_ENV_FILE_PATH_INVALID");
  for (const file of envFiles) {
    const values = await readPrivateJournalEnvFile(file);
    for (const [key, value] of Object.entries(values)) if (!Object.hasOwn(environment, key)) environment[key] = value;
  }
  const clientId = environment.INNER_SIGNAL_OPERATOR_CLIENT_ID;
  const clientSecret = environment.INNER_SIGNAL_OPERATOR_CLIENT_SECRET;
  delete environment.INNER_SIGNAL_OPERATOR_CLIENT_SECRET;
  if (!clientId || !clientSecret || !operatorSettingsReady(environment, config)) return Object.freeze({ environment, authContextProvider: null });
  const authContextProvider = createOperatorTokenProvider({
    issuer: environment.INNER_SIGNAL_OAUTH_ISSUER,
    clientId,
    clientSecret,
    scope: environment.INNER_SIGNAL_OPERATOR_TOKEN_SCOPE || null,
    fetchImpl,
    now
  });
  environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN = (await authContextProvider()).bearerToken;
  return Object.freeze({ environment, authContextProvider });
}
