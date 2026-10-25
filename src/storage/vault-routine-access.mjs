import {
  evaluateVaultAction,
  VAULT_ACTION,
} from './vault-boundary.mjs';
import {
  decryptVaultEnvelopeWithRoutineKek,
  VaultCryptoUnreadableError,
} from './vault-crypto.mjs';

function routineAuthorization(input) {
  let osBackedReauthenticated = false;
  try {
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      osBackedReauthenticated = input.osBackedReauthenticated === true;
    }
  } catch {
    osBackedReauthenticated = false;
  }

  return evaluateVaultAction(VAULT_ACTION.ROUTINE_UNLOCK, {
    osBackedReauthenticated,
  });
}

export async function openVaultWithRoutineAuthorization(input = {}) {
  const authorization = routineAuthorization(input);
  if (!authorization.allowed) return authorization;

  try {
    const envelope = input.envelope;
    const routineKek = input.routineKek;
    const plaintextBytes = await decryptVaultEnvelopeWithRoutineKek({
      envelope,
      routineKek,
    });
    return Object.freeze({
      allowed: true,
      reason: authorization.reason,
      plaintextBytes,
    });
  } catch {
    throw new VaultCryptoUnreadableError();
  }
}

export async function openVaultWithDevelopmentAuthorization(input = {}) {
  let allowed = false;
  try {
    allowed = input !== null
      && typeof input === 'object'
      && !Array.isArray(input)
      && input.developmentExternalCredentialAuthorized === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return Object.freeze({ allowed: false, reason: 'DEVELOPMENT_CREDENTIAL_AUTHORIZATION_REQUIRED' });

  try {
    const plaintextBytes = await decryptVaultEnvelopeWithRoutineKek({
      envelope: input.envelope,
      routineKek: input.routineKek,
    });
    return Object.freeze({
      allowed: true,
      reason: 'DEVELOPMENT_EXTERNAL_CREDENTIAL_AUTHORIZED',
      plaintextBytes,
    });
  } catch {
    throw new VaultCryptoUnreadableError();
  }
}

export async function openVaultWithManagedSecretAuthorization(input = {}) {
  let allowed = false;
  try {
    allowed = input !== null
      && typeof input === 'object'
      && !Array.isArray(input)
      && input.managedSecretAuthorized === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return Object.freeze({ allowed: false, reason: 'MANAGED_SECRET_AUTHORIZATION_REQUIRED' });

  try {
    const plaintextBytes = await decryptVaultEnvelopeWithRoutineKek({
      envelope: input.envelope,
      routineKek: input.routineKek,
    });
    return Object.freeze({
      allowed: true,
      reason: 'MANAGED_SECRET_PROVIDER_AUTHORIZED',
      plaintextBytes,
    });
  } catch {
    throw new VaultCryptoUnreadableError();
  }
}
