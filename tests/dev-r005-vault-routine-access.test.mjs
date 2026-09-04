import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  openVaultWithRoutineAuthorization,
} from '../src/storage/vault-routine-access.mjs';
import {
  createVaultEnvelope,
  VaultCryptoUnreadableError,
} from '../src/storage/vault-crypto.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const modulePath = `${repositoryRoot}/src/storage/vault-routine-access.mjs`;
const receiptPath =
  `${repositoryRoot}/tasks/dev-r005-encrypted-local-storage-20260903/` +
  'S003-IMPLEMENTATION-AUTHORIZATION.json';

const expectedAuthorizedPaths = [
  'src/storage/vault-routine-access.mjs',
  'tests/dev-r005-vault-routine-access.test.mjs',
  'tasks/dev-r005-encrypted-local-storage-20260903/S003-IMPLEMENTATION-AUTHORIZATION.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md',
  'state/CODEX-CURRENT-STATE.md',
  'tests/dev-r005-owner-decision-state.test.mjs',
];

const expectedAuthorization = {
  schemaVersion: 1,
  taskId: 'DEV-R005',
  authorizationId: 'DEV-R005-EXEC-S003-v1',
  authoritySourceRequestId: 'dev-r005-post-s002-decomposition-20260904',
  canonicalBase: {
    commit: 'de045f8ce71f84dc05cd8e045a06f962a2e04dbd',
    tree: '733d600ee798aca4a9629b50c10917a00b28dc00',
  },
  scope: 'IN_MEMORY_ROUTINE_UNLOCK_POLICY_CRYPTO_COMPOSITION_ONLY',
  design: {
    policyAction: 'routine-unlock',
    requiredEvidence: 'osBackedReauthenticated',
    cryptoDelegate: 'decryptVaultEnvelopeWithRoutineKek',
    recoverySecretUsedForRoutineUnlock: false,
    statefulSession: false,
    persistence: false,
    serialization: false,
    osIntegration: false,
    fallbackAuthenticationImplementation: false,
    recoveryPathImplementation: false,
    migrationExecution: false,
    applicationWiring: false,
    networkTransport: false,
    realPrivateData: false,
  },
  authorizedPaths: expectedAuthorizedPaths,
  laterSlicesAuthorized: false,
};

const denied = {
  allowed: false,
  reason: 'os-backed-reauthentication-required',
};

const plaintextBytes = Buffer.from('synthetic S003 routine payload', 'utf8');
const routineKek = randomBytes(32);
const recoverySecretBytes = Buffer.from(
  'synthetic-s003-recovery-fixture',
  'utf8',
);
let envelope;

before(async () => {
  envelope = await createVaultEnvelope({
    plaintextBytes,
    routineKek,
    recoverySecretBytes,
  });
});

const assertDenied = async (input) => {
  const result = await openVaultWithRoutineAuthorization(input);
  assert.deepEqual(result, denied);
  assert.equal(Object.isFrozen(result), true);
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

const revokedProxy = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};

const throwingGetter = (base, property, message) =>
  Object.defineProperty({ ...base }, property, {
    enumerable: true,
    get() {
      throw new Error(message);
    },
  });

const productionFiles = async (directory) => {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }

  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await productionFiles(path));
    } else if (/\.(?:cjs|js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
};

test('S003 authorization receipt locks the routine composition boundary', async () => {
  const authorization = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.deepEqual(authorization, expectedAuthorization);
  assert.equal(authorization.laterSlicesAuthorized, false);
  assert.equal(authorization.design.recoverySecretUsedForRoutineUnlock, false);
  assert.equal(authorization.design.persistence, false);
  assert.equal(authorization.design.osIntegration, false);
  assert.equal(authorization.design.statefulSession, false);
});

test('routine access denies absent or false OS-backed evidence', async () => {
  await assertDenied({ envelope, routineKek });
  await assertDenied({
    osBackedReauthenticated: false,
    envelope,
    routineKek,
  });
});

test('recovery material cannot authorize or substitute for routine unlock', async () => {
  await assertDenied({ recoverySecretBytes, envelope, routineKek });
  await assertDenied({
    osBackedReauthenticated: false,
    recoverySecretBytes,
    envelope,
    routineKek,
  });

  const authorized = await openVaultWithRoutineAuthorization({
    osBackedReauthenticated: true,
    envelope,
    routineKek,
    get recoverySecretBytes() {
      throw new Error('recovery-material-must-not-be-read');
    },
  });
  assert.deepEqual(authorized.plaintextBytes, plaintextBytes);
});

test('denial occurs before envelope or routine key access', async () => {
  let envelopeReads = 0;
  let keyReads = 0;
  const input = {
    osBackedReauthenticated: false,
    get envelope() {
      envelopeReads += 1;
      throw new Error('denied-envelope-read');
    },
    get routineKek() {
      keyReads += 1;
      throw new Error('denied-key-read');
    },
  };

  await assertDenied(input);
  assert.equal(envelopeReads, 0);
  assert.equal(keyReads, 0);
});

test('hostile authorization evidence fails closed without leaking', async () => {
  const throwingProxy = new Proxy({}, {
    get() {
      throw new Error('hostile-evidence-proxy');
    },
  });
  const cases = [
    null,
    17,
    [],
    revokedProxy(),
    throwingProxy,
    throwingGetter({}, 'osBackedReauthenticated', 'hostile-evidence-getter'),
  ];

  for (const input of cases) {
    await assertDenied(input);
  }
});

test('authorized routine access returns the exact plaintext in a frozen result', async () => {
  const result = await openVaultWithRoutineAuthorization({
    osBackedReauthenticated: true,
    envelope,
    routineKek,
  });

  assert.deepEqual(result, {
    allowed: true,
    reason: 'os-backed-reauthentication-satisfied',
    plaintextBytes,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('authorized malformed and inaccessible inputs stay generically unreadable', async () => {
  const wrongRoutineKek = randomBytes(32);
  const corruptedEnvelope = structuredClone(envelope);
  corruptedEnvelope.payload.authTag[0] ^= 0xff;
  const cases = [
    { osBackedReauthenticated: true, envelope, routineKek: wrongRoutineKek },
    { osBackedReauthenticated: true, envelope, routineKek: Buffer.alloc(1) },
    { osBackedReauthenticated: true, envelope: corruptedEnvelope, routineKek },
    throwingGetter(
      { osBackedReauthenticated: true, routineKek },
      'envelope',
      'authorized-envelope-getter',
    ),
    throwingGetter(
      { osBackedReauthenticated: true, envelope },
      'routineKek',
      'authorized-key-getter',
    ),
  ];

  for (const input of cases) {
    await assertUnreadable(() => openVaultWithRoutineAuthorization(input));
  }
});

test('routine composition is pure, stateless, and has no recovery fallback', async () => {
  const source = await readFile(modulePath, 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);

  assert.deepEqual(imports.sort(), [
    './vault-boundary.mjs',
    './vault-crypto.mjs',
  ]);
  assert.doesNotMatch(source, /decryptVaultEnvelopeWithRecoverySecret/);
  assert.doesNotMatch(
    source,
    /recoverySecretBytes|recoverySecretPresented|\brecoverySecret\b/,
  );
  assert.doesNotMatch(
    source,
    /node:fs|node:crypto|localStorage|indexedDB|\bfetch\s*\(|WebSocket|process\.env|database|keychain|credential-store implementation|JSON\.stringify|base64|plugin|migration|telemetry|network/i,
  );
  assert.doesNotMatch(
    source,
    /^\s*(?:let|var)\s+(?:currentVault|currentPlaintext|session|unlockTimestamp|inactivityTimer|lockTimer|credentialCache|keyCache)\b/m,
  );
  for (const stateName of [
    'currentVault',
    'currentPlaintext',
    'unlockTimestamp',
    'inactivityTimer',
    'lockTimer',
    'credentialCache',
    'keyCache',
  ]) {
    assert.equal(source.includes(stateName), false, `unexpected retained state: ${stateName}`);
  }
});

test('production code cannot bypass the routine authorization seam', async () => {
  const allowed = new Set([
    'src/storage/vault-crypto.mjs',
    'src/storage/vault-routine-access.mjs',
  ]);
  const roots = ['src', 'apps', 'plugins'];
  const violations = [];

  for (const root of roots) {
    const absoluteRoot = `${repositoryRoot}/${root}`;
    for (const file of await productionFiles(absoluteRoot)) {
      const relative = file.slice(repositoryRoot.length + 1);
      if (allowed.has(relative)) continue;
      const source = await readFile(file, 'utf8');
      if (source.includes('decryptVaultEnvelopeWithRoutineKek')) {
        violations.push(relative);
      }
    }
  }

  assert.deepEqual(violations, []);
});
