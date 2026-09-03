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

const expectedAuthorizedPaths = [
  'src/storage/vault-boundary.mjs',
  'tests/dev-r005-vault-boundary.test.mjs',
  'tasks/dev-r005-encrypted-local-storage-20260903/IMPLEMENTATION-AUTHORIZATION.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json',
  'tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md',
  'tests/dev-r005-owner-decision-state.test.mjs',
  'state/CODEX-CURRENT-STATE.md',
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

test('DEV-R005 checkpoints bind implementation authority to S001 only', async () => {
  const [authorizationSource, taskState, repositoryState] = await Promise.all([
    readUtf8(`${taskDirectory}/IMPLEMENTATION-AUTHORIZATION.json`),
    readUtf8(`${taskDirectory}/CURRENT-STATE.md`),
    readUtf8(`${repositoryRoot}/state/CODEX-CURRENT-STATE.md`),
  ]);
  const authorization = JSON.parse(authorizationSource);
  const exactLedgerPath =
    'tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json';
  const exactAuthorizationPath =
    'tasks/dev-r005-encrypted-local-storage-20260903/IMPLEMENTATION-AUTHORIZATION.json';

  assert.deepEqual(authorization, {
    schemaVersion: 1,
    taskId: 'DEV-R005',
    authorizationId: 'DEV-R005-EXEC-S001-v1',
    authoritySourceRequestId: 'dev-r005-post-pr35-continuation-20260903',
    canonicalBase: {
      commit: 'a11700547b48f77e7968b378eb57b8d184bd3ec4',
      tree: 'defbf48cffd5eee4d2438d6c03fe7d62d26c7516',
    },
    scope: 'VAULT_BOUNDARY_CONTRACT_ONLY',
    authorizedPaths: expectedAuthorizedPaths,
    laterSlicesAuthorized: false,
  });

  assert.match(taskState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(taskState, new RegExp(exactAuthorizationPath.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactAuthorizationPath.replaceAll('.', '\\.')));
  assert.match(taskState, /All four currently defined DEV-R005 owner decisions.*are resolved/);
  assert.match(repositoryState, /All four currently defined owner decisions are resolved/);
  assert.match(taskState, /pendingDecisionIds` is empty for D001-D004 only/);
  assert.match(repositoryState, /pendingDecisionIds` is empty for D001-D004 only/);
  assert.match(taskState, /implementationAuthorized` is `true` only within that receipt's S001 boundary/);
  assert.match(repositoryState, /implementationAuthorized` is `true` only for S001/);
  assert.match(taskState, /no later slice is authorized/i);
  assert.match(repositoryState, /No later slice is authorized/);
  assert.match(taskState, /does not persist, encrypt, decrypt, migrate, unlock, recover, delete, authenticate, transmit/);
  assert.match(repositoryState, /no browser wiring, persistence, cryptography, OS integration, migration execution/);
  assert.match(taskState, /No additional product-policy decision is inferred or encoded/);
  const taskFixtureText = `${await readUtf8(`${taskDirectory}/OWNER-DECISIONS.json`)}\n${authorizationSource}\n${taskState}`;
  assert.doesNotMatch(
    taskFixtureText,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|credentialValue|privateContentHash|recoverySecretValue|"transcript"\s*:/i,
  );
  assert.doesNotMatch(taskFixtureText, /\b[a-f0-9]{64}\b/i);
});
