export const VAULT_LIFECYCLE_EVENT = Object.freeze({
  APP_CLOSE: 'app-close',
  LOGOUT: 'logout',
  REBOOT: 'reboot',
  MANUAL_LOCK: 'manual-lock',
  REOPEN: 'reopen',
  INACTIVITY: 'inactivity',
});

export const VAULT_ACTION = Object.freeze({
  ROUTINE_UNLOCK: 'routine-unlock',
  PLUGIN_VAULT_MIGRATION: 'plugin-vault-migration',
  DESTRUCTIVE_RESET: 'destructive-reset',
});

export const VAULT_BOUNDARY_POLICY = Object.freeze({
  recovery: Object.freeze({
    authority: 'user-held-recovery-secret',
    serviceEscrow: false,
    thirdPartyEscrow: false,
  }),
  unlock: Object.freeze({
    scope: 'paid-standalone-app',
    routineUnlock: 'os-secure-credential-store',
    recoverySecretUsedForRoutineUnlock: false,
    lockOnLogoutOrReboot: true,
    lockOnAppClose: true,
    reauthenticateOnReopen: true,
    manualLockControl: true,
    inactivityLockout: 'optional-user-configurable',
    forcedInactivityTimeout: false,
  }),
  migration: Object.freeze({
    migrationPromptOnPaidSetup: true,
    automaticMigration: false,
    wholeChatGPTHistoryIngestion: false,
    preferredMigrationSource: 'inner-signal-plugin-vault',
  }),
  unreadableVault: Object.freeze({
    silentResetOrDeletion: false,
    preserveUnreadableVault: true,
    recoveryFirst: true,
    explicitDestructiveConfirmationRequired: true,
    deleteOnlyOnExplicitUserChoice: true,
  }),
});

const result = (value) => Object.freeze(value);

export function evaluateVaultLifecycle(event, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};

  switch (event) {
    case VAULT_LIFECYCLE_EVENT.APP_CLOSE:
    case VAULT_LIFECYCLE_EVENT.LOGOUT:
    case VAULT_LIFECYCLE_EVENT.REBOOT:
    case VAULT_LIFECYCLE_EVENT.MANUAL_LOCK:
      return result({
        lockRequired: true,
        reauthenticationRequired: false,
        reason: 'mandatory-lock-event',
      });
    case VAULT_LIFECYCLE_EVENT.REOPEN:
      return result({
        lockRequired: true,
        reauthenticationRequired: true,
        reason: 'reopen-reauthentication-required',
      });
    case VAULT_LIFECYCLE_EVENT.INACTIVITY:
      if (settings.inactivityLockConfigured === true) {
        return result({
          lockRequired: true,
          reauthenticationRequired: false,
          reason: 'user-configured-inactivity-lock',
        });
      }
      return result({
        lockRequired: false,
        reauthenticationRequired: false,
        reason: 'no-user-inactivity-lock-configured',
      });
    default:
      return result({
        lockRequired: true,
        reauthenticationRequired: true,
        reason: 'unknown-lifecycle-event',
      });
  }
}

export function evaluateVaultAction(action, options = {}) {
  const evidence = options && typeof options === 'object' ? options : {};

  switch (action) {
    case VAULT_ACTION.ROUTINE_UNLOCK:
      if (evidence.osBackedReauthenticated === true) {
        return result({
          allowed: true,
          reason: 'os-backed-reauthentication-satisfied',
        });
      }
      return result({
        allowed: false,
        reason: 'os-backed-reauthentication-required',
      });
    case VAULT_ACTION.PLUGIN_VAULT_MIGRATION:
      if (evidence.userOptedIn === true) {
        return result({
          allowed: true,
          reason: 'explicit-migration-opt-in-satisfied',
        });
      }
      return result({
        allowed: false,
        reason: 'explicit-migration-opt-in-required',
      });
    case VAULT_ACTION.DESTRUCTIVE_RESET:
      if (
        evidence.recoveryFirstSatisfied === true &&
        evidence.explicitUserChoice === true &&
        evidence.destructiveConfirmation === true
      ) {
        return result({
          allowed: true,
          reason: 'explicit-reset-choice-and-confirmation-satisfied',
        });
      }
      return result({
        allowed: false,
        reason: 'recovery-first-choice-and-confirmation-required',
      });
    default:
      return result({ allowed: false, reason: 'unknown-action' });
  }
}
