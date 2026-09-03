import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const taskDirectory = `${repositoryRoot}/tasks/dev-r005-encrypted-local-storage-20260903`;

const readUtf8 = (path) => readFile(path, 'utf8');

test('DEV-R005 checkpoint records only the explicit D001 owner selection', async () => {
  const ledgerSource = await readUtf8(`${taskDirectory}/OWNER-DECISIONS.json`);
  const ledger = JSON.parse(ledgerSource);

  assert.deepEqual(ledger, {
    schemaVersion: 1,
    taskId: 'DEV-R005',
    decisionSetId: 'dev-r005-encrypted-local-storage-20260903',
    decisions: [
      {
        decisionId: 'DEV-R005-D001',
        status: 'owner-selected',
        selection: 'USER_HELD_RECOVERY_SECRET',
        boundary: {
          serviceEscrow: false,
          thirdPartyEscrow: false,
        },
        source: 'explicit-owner-selection-in-active-chat',
      },
    ],
    pendingDecisionIds: [
      'DEV-R005-D002',
      'DEV-R005-D003',
      'DEV-R005-D004',
    ],
    implementationAuthorized: false,
  });

  assert.doesNotMatch(
    ledgerSource,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|credentialValue|privateContentHash|recoverySecretValue|"transcript"\s*:/i,
  );
});

test('DEV-R005 task and repository checkpoints preserve the authorization boundary', async () => {
  const [taskState, repositoryState] = await Promise.all([
    readUtf8(`${taskDirectory}/CURRENT-STATE.md`),
    readUtf8(`${repositoryRoot}/state/CODEX-CURRENT-STATE.md`),
  ]);
  const exactLedgerPath =
    'tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json';

  assert.match(taskState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(repositoryState, new RegExp(exactLedgerPath.replaceAll('.', '\\.')));
  assert.match(taskState, /DEV-R005-D002.*next substantive owner decision/);
  assert.match(taskState, /DEV-R005-D003.*DEV-R005-D004.*remain unanswered/);
  assert.match(taskState, /implementation remains blocked/);
  assert.match(taskState, /implementationAuthorized` remains `false/);
  assert.match(repositoryState, /DEV-R005 implementation remains unauthorized/);
  assert.match(taskState, /No selection is inferred for any pending decision/);
  assert.doesNotMatch(
    `${taskState}\n${repositoryState}`,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|credentialValue|privateContentHash|recoverySecretValue|"transcript"\s*:/i,
  );
});
