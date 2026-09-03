import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  VAULT_ACTION,
  VAULT_BOUNDARY_POLICY,
  VAULT_LIFECYCLE_EVENT,
  evaluateVaultAction,
  evaluateVaultLifecycle,
} from '../src/storage/vault-boundary.mjs';

const modulePath = fileURLToPath(
  new URL('../src/storage/vault-boundary.mjs', import.meta.url),
);

test('vault boundary policy exactly reflects the authorized D001-D004 constraints', () => {
  assert.deepEqual(VAULT_BOUNDARY_POLICY, {
    recovery: {
      authority: 'user-held-recovery-secret',
      serviceEscrow: false,
      thirdPartyEscrow: false,
    },
    unlock: {
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
    migration: {
      migrationPromptOnPaidSetup: true,
      automaticMigration: false,
      wholeChatGPTHistoryIngestion: false,
      preferredMigrationSource: 'inner-signal-plugin-vault',
    },
    unreadableVault: {
      silentResetOrDeletion: false,
      preserveUnreadableVault: true,
      recoveryFirst: true,
      explicitDestructiveConfirmationRequired: true,
      deleteOnlyOnExplicitUserChoice: true,
    },
  });

  assert.equal(Object.isFrozen(VAULT_BOUNDARY_POLICY), true);
  for (const boundary of Object.values(VAULT_BOUNDARY_POLICY)) {
    assert.equal(Object.isFrozen(boundary), true);
  }
  assert.equal(Object.hasOwn(VAULT_BOUNDARY_POLICY.unlock, 'defaultInactivityDuration'), false);
  assert.equal(Object.hasOwn(VAULT_BOUNDARY_POLICY.migration, 'allowedSources'), false);
});

test('lifecycle events lock deterministically and unknown events fail closed', () => {
  for (const event of [
    VAULT_LIFECYCLE_EVENT.APP_CLOSE,
    VAULT_LIFECYCLE_EVENT.LOGOUT,
    VAULT_LIFECYCLE_EVENT.REBOOT,
    VAULT_LIFECYCLE_EVENT.MANUAL_LOCK,
  ]) {
    assert.deepEqual(evaluateVaultLifecycle(event), {
      lockRequired: true,
      reauthenticationRequired: false,
      reason: 'mandatory-lock-event',
    });
  }

  assert.deepEqual(evaluateVaultLifecycle(VAULT_LIFECYCLE_EVENT.REOPEN), {
    lockRequired: true,
    reauthenticationRequired: true,
    reason: 'reopen-reauthentication-required',
  });
  assert.deepEqual(evaluateVaultLifecycle(VAULT_LIFECYCLE_EVENT.INACTIVITY), {
    lockRequired: false,
    reauthenticationRequired: false,
    reason: 'no-user-inactivity-lock-configured',
  });
  assert.deepEqual(
    evaluateVaultLifecycle(VAULT_LIFECYCLE_EVENT.INACTIVITY, {
      inactivityLockConfigured: true,
    }),
    {
      lockRequired: true,
      reauthenticationRequired: false,
      reason: 'user-configured-inactivity-lock',
    },
  );
  assert.deepEqual(evaluateVaultLifecycle('unrecognized-event'), {
    lockRequired: true,
    reauthenticationRequired: true,
    reason: 'unknown-lifecycle-event',
  });
});

test('actions enforce OS-backed routine unlock, opt-in migration, and confirmed reset', () => {
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.ROUTINE_UNLOCK, {
      recoverySecretPresented: true,
    }),
    { allowed: false, reason: 'os-backed-reauthentication-required' },
  );
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.ROUTINE_UNLOCK, {
      osBackedReauthenticated: true,
    }),
    { allowed: true, reason: 'os-backed-reauthentication-satisfied' },
  );

  assert.deepEqual(evaluateVaultAction(VAULT_ACTION.PLUGIN_VAULT_MIGRATION), {
    allowed: false,
    reason: 'explicit-migration-opt-in-required',
  });
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.PLUGIN_VAULT_MIGRATION, {
      userOptedIn: true,
      opaqueRecord: Symbol('opaque'),
    }),
    { allowed: true, reason: 'explicit-migration-opt-in-satisfied' },
  );

  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.DESTRUCTIVE_RESET, {
      explicitUserChoice: true,
    }),
    { allowed: false, reason: 'recovery-first-choice-and-confirmation-required' },
  );
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.DESTRUCTIVE_RESET, {
      destructiveConfirmation: true,
    }),
    { allowed: false, reason: 'recovery-first-choice-and-confirmation-required' },
  );
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.DESTRUCTIVE_RESET, {
      explicitUserChoice: true,
      destructiveConfirmation: true,
    }),
    { allowed: false, reason: 'recovery-first-choice-and-confirmation-required' },
  );
  assert.deepEqual(
    evaluateVaultAction(VAULT_ACTION.DESTRUCTIVE_RESET, {
      recoveryFirstSatisfied: true,
      explicitUserChoice: true,
      destructiveConfirmation: true,
    }),
    { allowed: true, reason: 'explicit-reset-choice-and-confirmation-satisfied' },
  );
  assert.deepEqual(evaluateVaultAction('unrecognized-action'), {
    allowed: false,
    reason: 'unknown-action',
  });
});

test('boundary module is pure and leaves reserved architecture choices absent', async () => {
  const source = await readFile(modulePath, 'utf8');

  assert.doesNotMatch(
    source,
    /^\s*import\b|\brequire\s*\(|\bnode:|\blocalStorage\b|\bindexedDB\b|\bfetch\s*\(|\bWebSocket\b|\bprocess\.env\b/m,
  );
  assert.doesNotMatch(source, /\bpayload\b|\bschema\b/i);

  for (const reservedField of [
    'cryptographicAlgorithm',
    'cipherSuite',
    'kdfParameters',
    'keyWrapping',
    'databaseTechnology',
    'hostingProvider',
    'accountIdentity',
    'cloudRetentionDuration',
    'transportProtocol',
    'paidPricing',
    'exactSessionHandoffSchema',
    'defaultInactivityDuration',
    'fallbackAuthentication',
  ]) {
    assert.equal(source.includes(reservedField), false, `unexpected reserved field: ${reservedField}`);
  }
});
