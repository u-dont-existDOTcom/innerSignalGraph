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
