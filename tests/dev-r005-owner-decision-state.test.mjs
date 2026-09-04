import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const taskDirectory = `${repositoryRoot}/tasks/dev-r005-encrypted-local-storage-20260903`;

const readUtf8 = (path) => readFile(path, 'utf8');

const expectedD001 = {
  decisionId: 'DEV-R005-D001',
  status: 'owner-selected',
  selection: 'USER_HELD_RECOVERY_SECRET',
  boundary: {
    serviceEscrow: false,
    thirdPartyEscrow: false,
  },
  source: 'explicit-owner-selection-in-active-chat',
};

const expectedD001Bytes = `    {
      "decisionId": "DEV-R005-D001",
      "status": "owner-selected",
      "selection": "USER_HELD_RECOVERY_SECRET",
      "boundary": {
        "serviceEscrow": false,
        "thirdPartyEscrow": false
      },
      "source": "explicit-owner-selection-in-active-chat"
    }`;

const expectedD002 = {
  decisionId: 'DEV-R005-D002',
  status: 'owner-selected',
  selection: 'OS_BACKED_REAUTH_WITH_USER_LOCK_POLICY',
  boundary: {
    scope: 'paid-standalone-app',
    routineUnlock: 'os-secure-credential-store',
    recoverySecretUsedForRoutineUnlock: false,
    lockOnLogoutOrReboot: true,
    lockOnAppClose: true,
    reauthenticateOnReopen: true,
    manualLockControl: true,
    inactivityLockout: 'optional-user-configurable',
    forcedInactivityTimeout: false,
  },
  source: 'explicit-owner-selection-in-active-chat',
};

const expectedD003 = {
  decisionId: 'DEV-R005-D003',
  status: 'owner-selected',
  selection: 'OPT_IN_PLUGIN_VAULT_MIGRATION',
  boundary: {
    migrationPromptOnPaidSetup: true,
    automaticMigration: false,
    wholeChatGPTHistoryIngestion: false,
    preferredMigrationSource: 'inner-signal-plugin-vault',
    freePluginVault: {
      firstUseConsentRequired: true,
      automaticSavingAfterConsent: true,
      perSessionOptOut: true,
      pauseSavingControl: true,
      deletionControl: true,
      defaultRecord: 'structured-inner-signal-session-handoff',
      rawTranscriptArchiveByDefault: false,
      retainedServerPlaintext: false,
      serverHeldDecryptionKey: false,
      currentInterimTransport:
        'transient-plaintext-processing-may-occur-before-encrypted-storage',
      futurePreference:
        'client-side-pre-server-zero-knowledge-when-platform-reliably-supports-it',
    },
  },
  source: 'explicit-owner-selection-in-active-chat',
};

const expectedD004 = {
  decisionId: 'DEV-R005-D004',
  status: 'owner-selected',
  selection: 'PRESERVE_UNTIL_EXPLICIT_RESET',
  boundary: {
    silentResetOrDeletion: false,
    preserveUnreadableVault: true,
    recoveryFirst: true,
    explicitDestructiveConfirmationRequired: true,
    deleteOnlyOnExplicitUserChoice: true,
  },
  source: 'explicit-owner-selection-in-active-chat',
};

const expectedDecisions = [expectedD001, expectedD002, expectedD003, expectedD004];
const expectedDecisionBytes = expectedDecisions
  .map((decision) => JSON.stringify(decision, null, 2).replace(/^/gm, '    '))
  .join(',\n');

const expectedS001AuthorizedPaths = [
  'src/storage/vault-boundary.mjs',
  'tests/dev-r005-vault-boundary.test.mjs',
  'tasks/dev-r005-encrypted-local-storage-20260903/IMPLEMENTATION-AUTHORIZATION.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md',
  'tests/dev-r005-owner-decision-state.test.mjs',
  'state/CODEX-CURRENT-STATE.md',
];

const expectedS002AuthorizedPaths = [
  'src/storage/vault-crypto.mjs',
  'tests/dev-r005-vault-crypto.test.mjs',
  'tasks/dev-r005-encrypted-local-storage-20260903/S002-IMPLEMENTATION-AUTHORIZATION.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md',
  'state/CODEX-CURRENT-STATE.md',
  'tests/dev-r005-owner-decision-state.test.mjs',
];

const expectedS003AuthorizedPaths = [
  'src/storage/vault-routine-access.mjs',
  'tests/dev-r005-vault-routine-access.test.mjs',
  'tasks/dev-r005-encrypted-local-storage-20260903/S003-IMPLEMENTATION-AUTHORIZATION.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md',
  'state/CODEX-CURRENT-STATE.md',
  'tests/dev-r005-owner-decision-state.test.mjs',
];

test('DEV-R005 checkpoint preserves D001 and records exact D002-D004 decisions', async () => {
  const ledgerSource = await readUtf8(`${taskDirectory}/OWNER-DECISIONS.json`);
  const ledger = JSON.parse(ledgerSource);

  assert.deepEqual(ledger, {
    schemaVersion: 1,
    taskId: 'DEV-R005',
    decisionSetId: 'dev-r005-encrypted-local-storage-20260903',
    decisions: expectedDecisions,
    pendingDecisionIds: [],
    implementationAuthorized: true,
  });

  const d001Start = ledgerSource.indexOf('    {\n      "decisionId": "DEV-R005-D001"');
  const d002Start = ledgerSource.indexOf('    {\n      "decisionId": "DEV-R005-D002"');
  assert.notEqual(d001Start, -1);
  assert.notEqual(d002Start, -1);
  assert.equal(ledgerSource.slice(d001Start, d002Start), `${expectedD001Bytes},\n`);

  const decisionsEnd = ledgerSource.indexOf('\n  ],\n  "pendingDecisionIds"');
  assert.notEqual(decisionsEnd, -1);
  assert.equal(ledgerSource.slice(d001Start, decisionsEnd), expectedDecisionBytes);

  assert.equal(expectedD003.boundary.wholeChatGPTHistoryIngestion, false);
  assert.equal(expectedD003.boundary.freePluginVault.retainedServerPlaintext, false);
  assert.equal(expectedD003.boundary.freePluginVault.serverHeldDecryptionKey, false);
  assert.equal(expectedD004.boundary.silentResetOrDeletion, false);
  assert.equal(expectedD004.boundary.preserveUnreadableVault, true);
  assert.equal(expectedD004.boundary.recoveryFirst, true);
  assert.equal(expectedD004.boundary.explicitDestructiveConfirmationRequired, true);
  assert.equal(expectedD004.boundary.deleteOnlyOnExplicitUserChoice, true);

  const forbiddenDecisionKeys = new Set([
    'cryptographicAlgorithm',
    'kdfParameters',
    'databaseTechnology',
    'hostingProvider',
    'accountIdentity',
    'cloudRetentionDuration',
    'transportProtocol',
    'paidPricing',
    'exactSessionHandoffSchema',
    'defaultInactivityDuration',
    'fallbackAuthentication',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbiddenDecisionKeys.has(key), false, `unexpected decision key: ${key}`);
        visit(child);
      }
    }
  };
  visit(ledger);

  assert.doesNotMatch(
    ledgerSource,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|credentialValue|privateContentHash|recoverySecretValue|"transcript"\s*:/i,
  );
});

test('DEV-R005 checkpoints preserve S001/S002 and independently bind S003 only', async () => {
  const [s001Source, s002Source, s003Source, taskState, repositoryState] = await Promise.all([
    readUtf8(`${taskDirectory}/IMPLEMENTATION-AUTHORIZATION.json`),
    readUtf8(`${taskDirectory}/S002-IMPLEMENTATION-AUTHORIZATION.json`),
    readUtf8(`${taskDirectory}/S003-IMPLEMENTATION-AUTHORIZATION.json`),
    readUtf8(`${taskDirectory}/CURRENT-STATE.md`),
    readUtf8(`${repositoryRoot}/state/CODEX-CURRENT-STATE.md`),
  ]);
  const s001Authorization = JSON.parse(s001Source);
  const s002Authorization = JSON.parse(s002Source);
  const s003Authorization = JSON.parse(s003Source);
  const exactLedgerPath =
    'tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json';
  const exactS001Path =
    'tasks/dev-r005-encrypted-local-storage-20260903/IMPLEMENTATION-AUTHORIZATION.json';
  const exactS002Path =
    'tasks/dev-r005-encrypted-local-storage-20260903/S002-IMPLEMENTATION-AUTHORIZATION.json';
  const exactS003Path =
    'tasks/dev-r005-encrypted-local-storage-20260903/S003-IMPLEMENTATION-AUTHORIZATION.json';

  assert.deepEqual(s001Authorization, {
    schemaVersion: 1,
    taskId: 'DEV-R005',
    authorizationId: 'DEV-R005-EXEC-S001-v1',
    authoritySourceRequestId: 'dev-r005-post-pr35-continuation-20260903',
    canonicalBase: {
      commit: 'a11700547b48f77e7968b378eb57b8d184bd3ec4',
      tree: 'defbf48cffd5eee4d2438d6c03fe7d62d26c7516',
    },
    scope: 'VAULT_BOUNDARY_CONTRACT_ONLY',
    authorizedPaths: expectedS001AuthorizedPaths,
    laterSlicesAuthorized: false,
  });

  assert.deepEqual(s002Authorization, {
    schemaVersion: 1,
    taskId: 'DEV-R005',
    authorizationId: 'DEV-R005-EXEC-S002-v1',
    authoritySourceRequestId: 'dev-r005-post-pr37-continuation-20260903',
    canonicalBase: {
      commit: 'e2ed489edcb74d510c91d596dcff4260e4336f2f',
      tree: '0716837786388ea564e5360f5ca31e62ba524d0e',
    },
    scope: 'IN_MEMORY_DUAL_WRAP_CRYPTO_ENVELOPE_ONLY',
    design: {
      suiteId: 'inner-signal-vault-envelope-v1',
      cipher: 'aes-256-gcm',
      dekBytes: 32,
      ivBytes: 12,
      authTagBytes: 16,
      routineKekBytes: 32,
      recoveryKdf: {
        algorithm: 'argon2id',
        saltBytes: 16,
        memoryKiB: 65536,
        passes: 3,
        parallelism: 4,
        derivedKeyBytes: 32,
      },
      binaryRecoveryInterfaceOnly: true,
      persistence: false,
      osIntegration: false,
      applicationWiring: false,
      migrationExecution: false,
      networkTransport: false,
      realPrivateData: false,
    },
    authorizedPaths: expectedS002AuthorizedPaths,
    laterSlicesAuthorized: false,
  });

  assert.deepEqual(s003Authorization, {
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
    authorizedPaths: expectedS003AuthorizedPaths,
    laterSlicesAuthorized: false,
  });

  assert.match(taskState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(taskState, new RegExp(exactS001Path.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactS001Path.replaceAll('.', '\\.')));
  assert.match(taskState, new RegExp(exactS002Path.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactS002Path.replaceAll('.', '\\.')));
  assert.match(taskState, new RegExp(exactS003Path.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactS003Path.replaceAll('.', '\\.')));
  assert.match(taskState, /All four currently defined DEV-R005 owner decisions.*are resolved/);
  assert.match(repositoryState, /All four currently defined owner decisions are resolved/);
  assert.match(taskState, /pendingDecisionIds` is empty for D001-D004 only/);
  assert.match(repositoryState, /pendingDecisionIds` is empty for D001-D004 only/);
  assert.match(taskState, /implementationAuthorized` is not blanket DEV-R005 authority/);
  assert.match(repositoryState, /implementationAuthorized` is not blanket DEV-R005 authority/);
  assert.match(taskState, /S002.*IN_MEMORY_DUAL_WRAP_CRYPTO_ENVELOPE_ONLY/);
  assert.match(repositoryState, /S002.*IN_MEMORY_DUAL_WRAP_CRYPTO_ENVELOPE_ONLY/);
  assert.match(taskState, /S003.*IN_MEMORY_ROUTINE_UNLOCK_POLICY_CRYPTO_COMPOSITION_ONLY/);
  assert.match(repositoryState, /S003.*IN_MEMORY_ROUTINE_UNLOCK_POLICY_CRYPTO_COMPOSITION_ONLY/);
  assert.match(taskState, /No implementation after S003 is authorized/);
  assert.match(repositoryState, /No implementation after S003 is authorized/);
  assert.equal(s003Authorization.laterSlicesAuthorized, false);
  assert.match(taskState, /does not persist, encrypt, decrypt, migrate, unlock, recover, delete, authenticate, transmit/);
  assert.match(repositoryState, /no browser wiring, persistence, cryptography, OS integration, migration execution/);
  assert.match(taskState, /No additional product-policy decision is inferred or encoded/);
  const taskFixtureText = `${await readUtf8(`${taskDirectory}/OWNER-DECISIONS.json`)}\n${s001Source}\n${s002Source}\n${s003Source}\n${taskState}`;
  assert.doesNotMatch(
    taskFixtureText,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|credentialValue|privateContentHash|recoverySecretValue|"transcript"\s*:/i,
  );
  assert.doesNotMatch(taskFixtureText, /\b[a-f0-9]{64}\b/i);
});
