import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  VAULT_CRYPTO_SUITE,
  VaultCryptoUnreadableError,
  createVaultEnvelope,
  decryptVaultEnvelopeWithRecoverySecret,
  decryptVaultEnvelopeWithRoutineKek,
} from '../src/storage/vault-crypto.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const modulePath = `${repositoryRoot}/src/storage/vault-crypto.mjs`;
const authorizationPath =
  `${repositoryRoot}/tasks/dev-r005-encrypted-local-storage-20260903/` +
  'S002-IMPLEMENTATION-AUTHORIZATION.json';

const plaintextBytes = Buffer.from([
  0x69, 0x6e, 0x6e, 0x65, 0x72, 0x2d, 0x73, 0x69, 0x67, 0x6e, 0x61, 0x6c,
]);
const routineKek = Buffer.from([
  0x41, 0x72, 0x63, 0x68, 0x69, 0x76, 0x65, 0x2d, 0x72, 0x6f, 0x75, 0x74,
  0x69, 0x6e, 0x65, 0x2d, 0x6b, 0x65, 0x79, 0x2d, 0x6d, 0x61, 0x74, 0x65,
  0x72, 0x69, 0x61, 0x6c, 0x2d, 0x30, 0x31, 0x21,
]);
const recoverySecretBytes = Buffer.from([
  0x72, 0x65, 0x63, 0x6f, 0x76, 0x65, 0x72, 0x79, 0x2d, 0x66, 0x69, 0x78,
  0x74, 0x75, 0x72, 0x65,
]);

const cloneEnvelope = (envelope) => ({
  version: envelope.version,
  suiteId: envelope.suiteId,
  payload: {
    iv: Buffer.from(envelope.payload.iv),
    ciphertext: Buffer.from(envelope.payload.ciphertext),
    authTag: Buffer.from(envelope.payload.authTag),
  },
  keyWraps: {
    routine: {
      iv: Buffer.from(envelope.keyWraps.routine.iv),
      ciphertext: Buffer.from(envelope.keyWraps.routine.ciphertext),
      authTag: Buffer.from(envelope.keyWraps.routine.authTag),
    },
    recovery: {
      salt: Buffer.from(envelope.keyWraps.recovery.salt),
      iv: Buffer.from(envelope.keyWraps.recovery.iv),
      ciphertext: Buffer.from(envelope.keyWraps.recovery.ciphertext),
      authTag: Buffer.from(envelope.keyWraps.recovery.authTag),
    },
  },
});

const mutateFirstByte = (bytes) => {
  bytes[0] ^= 0x01;
};

const assertUnreadable = async (operation) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof VaultCryptoUnreadableError, true);
    assert.equal(error.name, 'VaultCryptoUnreadableError');
    assert.equal(error.code, 'VAULT_CRYPTO_UNREADABLE');
    assert.equal(error.message, 'Vault envelope is unreadable.');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
};

let envelope;

before(async () => {
  envelope = await createVaultEnvelope({
    plaintextBytes,
    routineKek,
    recoverySecretBytes,
  });
});

test('S002 authorization and public suite are exact and deeply immutable', async () => {
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));

  assert.deepEqual(VAULT_CRYPTO_SUITE, {
    version: 1,
    suiteId: 'inner-signal-vault-envelope-v1',
    cipher: {
      algorithm: 'aes-256-gcm',
      keyBytes: 32,
      ivBytes: 12,
      authTagBytes: 16,
    },
    recoveryKdf: {
      algorithm: 'argon2id',
      saltBytes: 16,
      memoryKiB: 65536,
      passes: 3,
      parallelism: 4,
      derivedKeyBytes: 32,
    },
  });
  assert.equal(Object.isFrozen(VAULT_CRYPTO_SUITE), true);
  assert.equal(Object.isFrozen(VAULT_CRYPTO_SUITE.cipher), true);
  assert.equal(Object.isFrozen(VAULT_CRYPTO_SUITE.recoveryKdf), true);

  assert.equal(authorization.authorizationId, 'DEV-R005-EXEC-S002-v1');
  assert.equal(authorization.scope, 'IN_MEMORY_DUAL_WRAP_CRYPTO_ENVELOPE_ONLY');
  assert.deepEqual(authorization.design, {
    suiteId: VAULT_CRYPTO_SUITE.suiteId,
    cipher: VAULT_CRYPTO_SUITE.cipher.algorithm,
    dekBytes: VAULT_CRYPTO_SUITE.cipher.keyBytes,
    ivBytes: VAULT_CRYPTO_SUITE.cipher.ivBytes,
    authTagBytes: VAULT_CRYPTO_SUITE.cipher.authTagBytes,
    routineKekBytes: VAULT_CRYPTO_SUITE.cipher.keyBytes,
    recoveryKdf: {
      algorithm: VAULT_CRYPTO_SUITE.recoveryKdf.algorithm,
      saltBytes: VAULT_CRYPTO_SUITE.recoveryKdf.saltBytes,
      memoryKiB: VAULT_CRYPTO_SUITE.recoveryKdf.memoryKiB,
      passes: VAULT_CRYPTO_SUITE.recoveryKdf.passes,
      parallelism: VAULT_CRYPTO_SUITE.recoveryKdf.parallelism,
      derivedKeyBytes: VAULT_CRYPTO_SUITE.recoveryKdf.derivedKeyBytes,
    },
    binaryRecoveryInterfaceOnly: true,
    persistence: false,
    osIntegration: false,
    applicationWiring: false,
    migrationExecution: false,
    networkTransport: false,
    realPrivateData: false,
  });
  assert.equal(authorization.laterSlicesAuthorized, false);
});

test('one envelope round-trips through both independent authorized key paths', async () => {
  assert.deepEqual(
    await decryptVaultEnvelopeWithRoutineKek({ envelope, routineKek }),
    plaintextBytes,
  );
  assert.deepEqual(
    await decryptVaultEnvelopeWithRecoverySecret({ envelope, recoverySecretBytes }),
    plaintextBytes,
  );
});

test('routine opening has no recovery fallback and a wrong routine KEK fails closed', async () => {
  const wrongRoutineKek = Buffer.alloc(32, 0x77);
  await assertUnreadable(() =>
    decryptVaultEnvelopeWithRoutineKek({
      envelope,
      routineKek: wrongRoutineKek,
      recoverySecretBytes,
    }),
  );
});

test('wrong recovery material uses the same generic unreadable contract', async () => {
  await assertUnreadable(() =>
    decryptVaultEnvelopeWithRecoverySecret({
      envelope,
      recoverySecretBytes: Buffer.from([0x77, 0x72, 0x6f, 0x6e, 0x67]),
    }),
  );
});

test('payload ciphertext and authentication-tag tampering fail generically', async () => {
  for (const field of ['ciphertext', 'authTag']) {
    const tampered = cloneEnvelope(envelope);
    mutateFirstByte(tampered.payload[field]);
    await assertUnreadable(() =>
      decryptVaultEnvelopeWithRoutineKek({ envelope: tampered, routineKek }),
    );
    await assertUnreadable(() =>
      decryptVaultEnvelopeWithRecoverySecret({
        envelope: tampered,
        recoverySecretBytes,
      }),
    );
  }
});

test('either alternate key-wrap slot is authenticated by the payload', async () => {
  const recoveryTampered = cloneEnvelope(envelope);
  mutateFirstByte(recoveryTampered.keyWraps.recovery.authTag);
  await assertUnreadable(() =>
    decryptVaultEnvelopeWithRoutineKek({ envelope: recoveryTampered, routineKek }),
  );

  const routineTampered = cloneEnvelope(envelope);
  mutateFirstByte(routineTampered.keyWraps.routine.ciphertext);
  await assertUnreadable(() =>
    decryptVaultEnvelopeWithRecoverySecret({
      envelope: routineTampered,
      recoverySecretBytes,
    }),
  );
});

test('recovery salt and envelope metadata cannot be downgraded or altered', async () => {
  const saltTampered = cloneEnvelope(envelope);
  mutateFirstByte(saltTampered.keyWraps.recovery.salt);
  await assertUnreadable(() =>
    decryptVaultEnvelopeWithRoutineKek({ envelope: saltTampered, routineKek }),
  );

  for (const [field, value] of [
    ['version', 0],
    ['suiteId', 'inner-signal-vault-envelope-v0'],
  ]) {
    const metadataTampered = cloneEnvelope(envelope);
    metadataTampered[field] = value;
    await assertUnreadable(() =>
      decryptVaultEnvelopeWithRoutineKek({ envelope: metadataTampered, routineKek }),
    );
  }

  assert.deepEqual(Object.keys(envelope).sort(), ['keyWraps', 'payload', 'suiteId', 'version']);
  assert.deepEqual(Object.keys(envelope.keyWraps.recovery).sort(), [
    'authTag',
    'ciphertext',
    'iv',
    'salt',
  ]);
  for (const forbidden of ['memory', 'memoryKiB', 'passes', 'parallelism', 'tagLength']) {
    assert.equal(forbidden in envelope, false);
    assert.equal(forbidden in envelope.keyWraps.recovery, false);
  }
});

test('identical synthetic inputs produce independently randomized envelopes', async () => {
  const second = await createVaultEnvelope({
    plaintextBytes,
    routineKek,
    recoverySecretBytes,
  });

  assert.notDeepEqual(second, envelope);
  assert.notDeepEqual(second.payload.iv, envelope.payload.iv);
  assert.notDeepEqual(second.keyWraps.routine.iv, envelope.keyWraps.routine.iv);
  assert.notDeepEqual(second.keyWraps.recovery.iv, envelope.keyWraps.recovery.iv);
  assert.notDeepEqual(second.keyWraps.recovery.salt, envelope.keyWraps.recovery.salt);

  for (const current of [envelope, second]) {
    const ivs = [
      current.payload.iv,
      current.keyWraps.routine.iv,
      current.keyWraps.recovery.iv,
    ];
    assert.equal(ivs[0].equals(ivs[1]), false);
    assert.equal(ivs[0].equals(ivs[2]), false);
    assert.equal(ivs[1].equals(ivs[2]), false);
  }
});

test('envelopes expose no secret-named properties or caller key material', () => {
  const propertyNames = [];
  const byteValues = [];
  const visit = (value) => {
    if (Buffer.isBuffer(value)) {
      byteValues.push(value);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        propertyNames.push(key);
        visit(child);
      }
    }
  };
  visit(envelope);

  for (const forbidden of ['dek', 'routineKek', 'recoveryKek', 'recoverySecret', 'derivedKey']) {
    assert.equal(propertyNames.includes(forbidden), false);
  }
  for (const bytes of byteValues) {
    assert.equal(bytes.equals(routineKek), false);
    assert.equal(bytes.equals(recoverySecretBytes), false);
  }
});

test('byte-only inputs are not mutated and malformed creation inputs fail safely', async () => {
  const plaintextBefore = Buffer.from(plaintextBytes);
  const routineBefore = Buffer.from(routineKek);
  const recoveryBefore = Buffer.from(recoverySecretBytes);

  await createVaultEnvelope({ plaintextBytes, routineKek, recoverySecretBytes });
  assert.deepEqual(plaintextBytes, plaintextBefore);
  assert.deepEqual(routineKek, routineBefore);
  assert.deepEqual(recoverySecretBytes, recoveryBefore);

  for (const input of [
    { plaintextBytes: 'text', routineKek, recoverySecretBytes },
    { plaintextBytes, routineKek: Buffer.alloc(31), recoverySecretBytes },
    { plaintextBytes, routineKek, recoverySecretBytes: Buffer.alloc(0) },
    { plaintextBytes, routineKek, recoverySecretBytes: 'not-bytes' },
  ]) {
    await assert.rejects(() => createVaultEnvelope(input), {
      name: 'TypeError',
      message: 'Invalid vault crypto input.',
    });
  }
});

test('implementation remains an in-memory Node-built-in-only primitive', async () => {
  const source = await readFile(modulePath, 'utf8');
  const importSpecifiers = [
    ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);

  assert.deepEqual(importSpecifiers, ['node:crypto']);
  assert.doesNotMatch(
    source,
    /node:fs|localStorage|indexedDB|\bfetch\s*\(|\bWebSocket\b|process\.env|database|plugin|telemetry/i,
  );
  assert.doesNotMatch(source, /JSON\.(?:stringify|parse)|base64|argon2Sync/);
  assert.doesNotMatch(source, /Buffer\.from\s*\(\s*derivedKey\s*\)/);
  assert.match(source, /argon2\s*\(/);
  assert.match(source, /resolve\s*\(\s*derivedKey\s*\)/);
  assert.match(source, /createCipheriv\s*\(/);
  assert.match(source, /createDecipheriv\s*\(/);
});

test('authenticated decryption retains and clears sensitive plaintext chunks', async () => {
  const source = await readFile(modulePath, 'utf8');
  const helper = source.match(
    /function decryptGcm\([\s\S]+?\n}\n\nfunction deriveRecoveryKek/,
  )?.[0];

  assert.ok(helper, 'decryptGcm helper must remain inspectable');
  assert.doesNotMatch(
    helper,
    /Buffer\.concat\s*\(\s*\[\s*decipher\.update\([\s\S]*?decipher\.final\(\)/,
  );
  assert.match(helper, /let updateChunk;/);
  assert.match(helper, /let finalChunk;/);
  assert.match(helper, /updateChunk = decipher\.update\(ciphertext\);/);
  assert.match(helper, /finalChunk = decipher\.final\(\);/);
  assert.match(
    helper,
    /catch \(error\) {[\s\S]*?zero\(updateChunk, finalChunk\);[\s\S]*?throw error;/,
  );
  assert.match(
    helper,
    /if \(finalChunk\.length === 0\) {[\s\S]*?return updateChunk;/,
  );
  assert.match(
    helper,
    /if \(updateChunk\.length === 0\) {[\s\S]*?return finalChunk;/,
  );
  assert.match(
    helper,
    /try {[\s\S]*?Buffer\.concat\(\[updateChunk, finalChunk\]\)[\s\S]*?finally {[\s\S]*?zero\(updateChunk, finalChunk\);/,
  );
  assert.doesNotMatch(source, /Buffer\.from\s*\(\s*derivedKey\s*\)/);
});
