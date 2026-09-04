import {
  argon2,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const RECOVERY_KDF_CONTEXT = 'inner-signal:vault-envelope:v1:recovery-kek';
const ROUTINE_WRAP_CONTEXT = 'inner-signal:vault-envelope:v1:dek-wrap:routine';
const RECOVERY_WRAP_CONTEXT = 'inner-signal:vault-envelope:v1:dek-wrap:recovery';
const PAYLOAD_CONTEXT = 'inner-signal:vault-envelope:v1:payload';

export const VAULT_CRYPTO_SUITE = Object.freeze({
  version: 1,
  suiteId: 'inner-signal-vault-envelope-v1',
  cipher: Object.freeze({
    algorithm: CIPHER_ALGORITHM,
    keyBytes: 32,
    ivBytes: 12,
    authTagBytes: 16,
  }),
  recoveryKdf: Object.freeze({
    algorithm: 'argon2id',
    saltBytes: 16,
    memoryKiB: 65536,
    passes: 3,
    parallelism: 4,
    derivedKeyBytes: 32,
  }),
});

export class VaultCryptoUnreadableError extends Error {
  constructor() {
    super('Vault envelope is unreadable.');
    this.name = 'VaultCryptoUnreadableError';
    Object.defineProperty(this, 'code', {
      configurable: false,
      enumerable: true,
      value: 'VAULT_CRYPTO_UNREADABLE',
      writable: false,
    });
  }
}

function invalidInput() {
  return new TypeError('Invalid vault crypto input.');
}

function copyBytes(value) {
  try {
    if (value instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(value));
    }
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } catch {
    throw invalidInput();
  }
  throw invalidInput();
}

function copyRoutineKek(value) {
  const copy = copyBytes(value);
  if (copy.length !== VAULT_CRYPTO_SUITE.cipher.keyBytes) {
    copy.fill(0);
    throw invalidInput();
  }
  return copy;
}

function copyRecoverySecret(value) {
  const copy = copyBytes(value);
  if (copy.length === 0) {
    copy.fill(0);
    throw invalidInput();
  }
  return copy;
}

function frame(parts) {
  const buffers = parts.map((part) =>
    typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.from(part),
  );
  for (const buffer of buffers) {
    if (buffer.length > 0xffffffff) {
      throw invalidInput();
    }
  }

  const output = Buffer.allocUnsafe(
    4 + buffers.reduce((total, buffer) => total + 4 + buffer.length, 0),
  );
  let offset = 0;
  output.writeUInt32BE(buffers.length, offset);
  offset += 4;
  for (const buffer of buffers) {
    output.writeUInt32BE(buffer.length, offset);
    offset += 4;
    buffer.copy(output, offset);
    offset += buffer.length;
  }
  return output;
}

function encryptGcm({ key, iv, plaintext, aad }) {
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: VAULT_CRYPTO_SUITE.cipher.authTagBytes,
  });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: Buffer.from(iv),
    ciphertext,
    authTag: Buffer.from(cipher.getAuthTag()),
  };
}

function decryptGcm({ key, iv, ciphertext, authTag, aad }) {
  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: VAULT_CRYPTO_SUITE.cipher.authTagBytes,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  let updateChunk;
  let finalChunk;
  try {
    updateChunk = decipher.update(ciphertext);
    finalChunk = decipher.final();
  } catch (error) {
    zero(updateChunk, finalChunk);
    throw error;
  }

  if (finalChunk.length === 0) {
    return updateChunk;
  }
  if (updateChunk.length === 0) {
    return finalChunk;
  }

  try {
    return Buffer.concat([updateChunk, finalChunk]);
  } finally {
    zero(updateChunk, finalChunk);
  }
}

function deriveRecoveryKek(recoverySecret, salt) {
  return new Promise((resolve, reject) => {
    argon2(
      VAULT_CRYPTO_SUITE.recoveryKdf.algorithm,
      {
        message: recoverySecret,
        nonce: salt,
        parallelism: VAULT_CRYPTO_SUITE.recoveryKdf.parallelism,
        tagLength: VAULT_CRYPTO_SUITE.recoveryKdf.derivedKeyBytes,
        memory: VAULT_CRYPTO_SUITE.recoveryKdf.memoryKiB,
        passes: VAULT_CRYPTO_SUITE.recoveryKdf.passes,
        associatedData: Buffer.from(RECOVERY_KDF_CONTEXT, 'utf8'),
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function recoveryWrapAad(salt) {
  return frame([RECOVERY_WRAP_CONTEXT, salt]);
}

function payloadAad(keyWraps) {
  return frame([
    PAYLOAD_CONTEXT,
    keyWraps.routine.iv,
    keyWraps.routine.ciphertext,
    keyWraps.routine.authTag,
    keyWraps.recovery.salt,
    keyWraps.recovery.iv,
    keyWraps.recovery.ciphertext,
    keyWraps.recovery.authTag,
  ]);
}

function distinctIv(previous) {
  let iv;
  do {
    iv = randomBytes(VAULT_CRYPTO_SUITE.cipher.ivBytes);
  } while (previous.some((candidate) => candidate.equals(iv)));
  previous.push(iv);
  return iv;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function requireBytes(value, length) {
  const copy = copyBytes(value);
  if (length !== undefined && copy.length !== length) {
    copy.fill(0);
    throw invalidInput();
  }
  return copy;
}

function readEnvelope(envelope) {
  if (
    !hasExactKeys(envelope, ['version', 'suiteId', 'payload', 'keyWraps']) ||
    envelope.version !== VAULT_CRYPTO_SUITE.version ||
    envelope.suiteId !== VAULT_CRYPTO_SUITE.suiteId ||
    !hasExactKeys(envelope.payload, ['iv', 'ciphertext', 'authTag']) ||
    !hasExactKeys(envelope.keyWraps, ['routine', 'recovery']) ||
    !hasExactKeys(envelope.keyWraps.routine, ['iv', 'ciphertext', 'authTag']) ||
    !hasExactKeys(envelope.keyWraps.recovery, [
      'salt',
      'iv',
      'ciphertext',
      'authTag',
    ])
  ) {
    throw invalidInput();
  }

  const cipher = VAULT_CRYPTO_SUITE.cipher;
  const recoveryKdf = VAULT_CRYPTO_SUITE.recoveryKdf;
  const copy = {
    version: envelope.version,
    suiteId: envelope.suiteId,
    payload: {
      iv: requireBytes(envelope.payload.iv, cipher.ivBytes),
      ciphertext: requireBytes(envelope.payload.ciphertext),
      authTag: requireBytes(envelope.payload.authTag, cipher.authTagBytes),
    },
    keyWraps: {
      routine: {
        iv: requireBytes(envelope.keyWraps.routine.iv, cipher.ivBytes),
        ciphertext: requireBytes(envelope.keyWraps.routine.ciphertext, cipher.keyBytes),
        authTag: requireBytes(envelope.keyWraps.routine.authTag, cipher.authTagBytes),
      },
      recovery: {
        salt: requireBytes(envelope.keyWraps.recovery.salt, recoveryKdf.saltBytes),
        iv: requireBytes(envelope.keyWraps.recovery.iv, cipher.ivBytes),
        ciphertext: requireBytes(envelope.keyWraps.recovery.ciphertext, cipher.keyBytes),
        authTag: requireBytes(envelope.keyWraps.recovery.authTag, cipher.authTagBytes),
      },
    },
  };
  return copy;
}

function zero(...buffers) {
  for (const buffer of buffers) {
    if (Buffer.isBuffer(buffer)) buffer.fill(0);
  }
}

export async function createVaultEnvelope({
  plaintextBytes,
  routineKek,
  recoverySecretBytes,
} = {}) {
  let plaintext;
  let routineKey;
  let recoverySecret;
  let dek;
  let recoveryKek;

  try {
    plaintext = copyBytes(plaintextBytes);
    routineKey = copyRoutineKek(routineKek);
    recoverySecret = copyRecoverySecret(recoverySecretBytes);
    dek = randomBytes(VAULT_CRYPTO_SUITE.cipher.keyBytes);
    const salt = randomBytes(VAULT_CRYPTO_SUITE.recoveryKdf.saltBytes);
    recoveryKek = await deriveRecoveryKek(recoverySecret, salt);
    const usedIvs = [];

    const routine = encryptGcm({
      key: routineKey,
      iv: distinctIv(usedIvs),
      plaintext: dek,
      aad: frame([ROUTINE_WRAP_CONTEXT]),
    });
    const recovery = {
      salt: Buffer.from(salt),
      ...encryptGcm({
        key: recoveryKek,
        iv: distinctIv(usedIvs),
        plaintext: dek,
        aad: recoveryWrapAad(salt),
      }),
    };
    const keyWraps = { routine, recovery };
    const payload = encryptGcm({
      key: dek,
      iv: distinctIv(usedIvs),
      plaintext,
      aad: payloadAad(keyWraps),
    });

    return {
      version: VAULT_CRYPTO_SUITE.version,
      suiteId: VAULT_CRYPTO_SUITE.suiteId,
      payload,
      keyWraps,
    };
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid vault crypto input.') {
      throw error;
    }
    throw invalidInput();
  } finally {
    zero(plaintext, routineKey, recoverySecret, dek, recoveryKek);
  }
}

export async function decryptVaultEnvelopeWithRoutineKek({
  envelope,
  routineKek,
} = {}) {
  let routineKey;
  let dek;
  try {
    const current = readEnvelope(envelope);
    routineKey = copyRoutineKek(routineKek);
    dek = decryptGcm({
      key: routineKey,
      ...current.keyWraps.routine,
      aad: frame([ROUTINE_WRAP_CONTEXT]),
    });
    return decryptGcm({
      key: dek,
      ...current.payload,
      aad: payloadAad(current.keyWraps),
    });
  } catch {
    throw new VaultCryptoUnreadableError();
  } finally {
    zero(routineKey, dek);
  }
}

export async function decryptVaultEnvelopeWithRecoverySecret({
  envelope,
  recoverySecretBytes,
} = {}) {
  let recoverySecret;
  let recoveryKek;
  let dek;
  try {
    const current = readEnvelope(envelope);
    recoverySecret = copyRecoverySecret(recoverySecretBytes);
    recoveryKek = await deriveRecoveryKek(
      recoverySecret,
      current.keyWraps.recovery.salt,
    );
    dek = decryptGcm({
      key: recoveryKek,
      iv: current.keyWraps.recovery.iv,
      ciphertext: current.keyWraps.recovery.ciphertext,
      authTag: current.keyWraps.recovery.authTag,
      aad: recoveryWrapAad(current.keyWraps.recovery.salt),
    });
    return decryptGcm({
      key: dek,
      ...current.payload,
      aad: payloadAad(current.keyWraps),
    });
  } catch {
    throw new VaultCryptoUnreadableError();
  } finally {
    zero(recoverySecret, recoveryKek, dek);
  }
}
