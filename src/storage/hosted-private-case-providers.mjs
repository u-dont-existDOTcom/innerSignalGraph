import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import { ValidationError } from "../core/errors.mjs";
import {
  PRIVATE_CASE_SCOPES,
  PrivateCaseAccessDeniedError,
  PrivateCaseKeyUnavailableError
} from "./private-case-access.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const HTTPS = /^https:\/\/[^\s/]+/i;

const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

function requiredText(value, name, maximum = 4_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ValidationError(`${name} must be bounded non-empty text.`);
  return value;
}

function parseJson(value, name) {
  try { return JSON.parse(requiredText(value, name, 2_000_000)); }
  catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`${name} must contain valid JSON.`);
  }
}

function normalizeGrants(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError("Hosted case ACL must contain at least one grant.");
  return value.map((grant, index) => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) throw new ValidationError(`Hosted ACL grant ${index} is invalid.`);
    const subject = requiredText(grant.subject, `Hosted ACL grant ${index} subject`, 320);
    if (!Array.isArray(grant.case_ids) || grant.case_ids.length === 0 || grant.case_ids.some((caseId) => typeof caseId !== "string" || !CASE_ID.test(caseId))) {
      throw new ValidationError(`Hosted ACL grant ${index} case_ids is invalid.`);
    }
    if (!Array.isArray(grant.scopes) || grant.scopes.length === 0 || grant.scopes.some((scope) => !Object.values(PRIVATE_CASE_SCOPES).includes(scope))) {
      throw new ValidationError(`Hosted ACL grant ${index} scopes is invalid.`);
    }
    return Object.freeze({ subject, caseIds: Object.freeze([...new Set(grant.case_ids)]), scopes: Object.freeze([...new Set(grant.scopes)]) });
  });
}

function normalizeCaseKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Hosted case key payload is invalid.");
  const keys = new Map();
  for (const [caseId, entry] of Object.entries(value)) {
    if (!CASE_ID.test(caseId) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw new ValidationError(`Hosted key entry ${caseId} is invalid.`);
    const routineKek = Buffer.from(requiredText(entry.routine_kek_base64, `Hosted key entry ${caseId} routine_kek_base64`, 1_000), "base64");
    const recoverySecretBytes = entry.recovery_secret_base64 == null
      ? null
      : Buffer.from(requiredText(entry.recovery_secret_base64, `Hosted key entry ${caseId} recovery_secret_base64`, 1_000), "base64");
    if (routineKek.byteLength !== 32 || (recoverySecretBytes && recoverySecretBytes.byteLength < 16)) {
      routineKek.fill(0);
      recoverySecretBytes?.fill(0);
      throw new ValidationError(`Hosted key entry ${caseId} has invalid key material.`);
    }
    keys.set(caseId, { routineKek, recoverySecretBytes });
  }
  if (keys.size === 0) throw new ValidationError("Hosted case key payload is empty.");
  return keys;
}

function tokenScopes(payload) {
  const scopes = new Set();
  if (typeof payload.scope === "string") for (const scope of payload.scope.split(/\s+/u)) if (scope) scopes.add(scope);
  if (Array.isArray(payload.permissions)) for (const scope of payload.permissions) if (typeof scope === "string" && scope) scopes.add(scope);
  return scopes;
}

export function createJwtPrivateCaseAuthorizationProvider({
  issuer,
  audience,
  jwksUri = null,
  jwks = null,
  grants,
  algorithms = ["RS256"],
  clockTolerance = 5,
  now = () => Math.floor(Date.now() / 1_000)
} = {}) {
  const normalizedIssuer = requiredText(issuer, "OAuth issuer").replace(/\/$/u, "");
  const normalizedAudience = requiredText(audience, "OAuth audience");
  if (!HTTPS.test(normalizedIssuer) && !jwks) throw new ValidationError("Hosted OAuth issuer must use HTTPS.");
  if (!jwks && !HTTPS.test(jwksUri)) throw new ValidationError("Hosted OAuth JWKS URI must use HTTPS.");
  if (!Array.isArray(algorithms) || algorithms.length === 0 || algorithms.some((entry) => typeof entry !== "string" || !entry)) throw new ValidationError("OAuth algorithms are invalid.");
  if (!Number.isFinite(clockTolerance) || clockTolerance < 0 || clockTolerance > 300) throw new ValidationError("OAuth clock tolerance is invalid.");
  const normalizedGrants = normalizeGrants(grants);
  const keySet = jwks
    ? createLocalJWKSet(jwks)
    : createRemoteJWKSet(new URL(requiredText(jwksUri, "OAuth JWKS URI")));

  return Object.freeze({
    kind: "oauth-jwt-case-acl",
    issuer: normalizedIssuer,
    audience: normalizedAudience,
    async authorize({ caseId, authContext, requiredScope }) {
      const token = authContext?.bearerToken;
      if (typeof token !== "string" || !token || !CASE_ID.test(caseId) || !Object.values(PRIVATE_CASE_SCOPES).includes(requiredScope)) {
        throw new PrivateCaseAccessDeniedError();
      }
      let verified;
      try {
        verified = await jwtVerify(token, keySet, {
          issuer: normalizedIssuer,
          audience: normalizedAudience,
          algorithms,
          clockTolerance,
          currentDate: new Date(now() * 1_000)
        });
      } catch {
        throw new PrivateCaseAccessDeniedError();
      }
      if (!Number.isInteger(verified.payload.exp)) throw new PrivateCaseAccessDeniedError();
      const subject = verified.payload.sub;
      if (typeof subject !== "string" || !subject) throw new PrivateCaseAccessDeniedError();
      const tokenScopeSet = tokenScopes(verified.payload);
      const grant = normalizedGrants.find((entry) => entry.subject === subject && entry.caseIds.includes(caseId));
      if (!grant || !grant.scopes.includes(requiredScope) || !tokenScopeSet.has(requiredScope)) throw new PrivateCaseAccessDeniedError();
      return Object.freeze({
        allowed: true,
        principalId: subject,
        scopes: Object.freeze(grant.scopes.filter((scope) => tokenScopeSet.has(scope))),
        tokenId: typeof verified.payload.jti === "string" ? verified.payload.jti : null,
        authorizationProvider: "oauth-jwt-case-acl"
      });
    }
  });
}

export function createManagedSecretCaseKeyProvider({ caseKeys, providerName = "managed-environment-secret" } = {}) {
  const keys = normalizeCaseKeys(caseKeys);
  let closed = false;
  return Object.freeze({
    kind: providerName,
    async getCaseKeyMaterial({ caseId, authorization }) {
      if (closed || authorization?.allowed !== true || typeof authorization?.principalId !== "string") throw new PrivateCaseKeyUnavailableError();
      const value = keys.get(caseId);
      if (!value) throw new PrivateCaseKeyUnavailableError();
      return {
        routineKek: Buffer.from(value.routineKek),
        recoverySecretBytes: value.recoverySecretBytes ? Buffer.from(value.recoverySecretBytes) : null,
        accessAssurance: "managed_secret_provider",
        managedSecretProvider: true,
        provider: providerName
      };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const value of keys.values()) {
        value.routineKek.fill(0);
        value.recoverySecretBytes?.fill(0);
      }
    }
  });
}

export function loadHostedPrivateCaseProvidersFromEnvironment(environment = process.env) {
  const rootDir = path.resolve(requiredText(environment.INNER_SIGNAL_PRIVATE_ROOT, "INNER_SIGNAL_PRIVATE_ROOT"));
  if (isWithin(repositoryRoot, rootDir)) throw new ValidationError("Hosted private storage root must be outside the public repository.");
  const issuer = requiredText(environment.INNER_SIGNAL_OAUTH_ISSUER, "INNER_SIGNAL_OAUTH_ISSUER").replace(/\/$/u, "");
  const audience = requiredText(environment.INNER_SIGNAL_OAUTH_AUDIENCE, "INNER_SIGNAL_OAUTH_AUDIENCE");
  const jwksUri = requiredText(environment.INNER_SIGNAL_OAUTH_JWKS_URI, "INNER_SIGNAL_OAUTH_JWKS_URI");
  for (const [value, name] of [[issuer, "INNER_SIGNAL_OAUTH_ISSUER"], [audience, "INNER_SIGNAL_OAUTH_AUDIENCE"], [jwksUri, "INNER_SIGNAL_OAUTH_JWKS_URI"]]) {
    if (!HTTPS.test(value)) throw new ValidationError(`${name} must use HTTPS in hosted mode.`);
  }
  const grantsValue = parseJson(environment.INNER_SIGNAL_CASE_ACL_JSON, "INNER_SIGNAL_CASE_ACL_JSON");
  const grants = Array.isArray(grantsValue) ? grantsValue : grantsValue.grants;
  const caseKeys = parseJson(environment.INNER_SIGNAL_CASE_KEYS_JSON, "INNER_SIGNAL_CASE_KEYS_JSON");
  const authorizationProvider = createJwtPrivateCaseAuthorizationProvider({ issuer, audience, jwksUri, grants });
  const keyProvider = createManagedSecretCaseKeyProvider({ caseKeys });
  if (environment === process.env) delete process.env.INNER_SIGNAL_CASE_KEYS_JSON;
  return Object.freeze({
    kind: "hosted-oauth-managed-secret-provider",
    productionReady: true,
    rootDir,
    oauth: Object.freeze({ issuer, audience, jwksUri, scopesSupported: Object.freeze([PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT]) }),
    authorizationProvider,
    keyProvider,
    close() { keyProvider.close(); }
  });
}
