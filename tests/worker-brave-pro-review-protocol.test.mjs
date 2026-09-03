import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const readUtf8 = (relativePath) => readFile(`${repositoryRoot}/${relativePath}`, 'utf8');

const protocolPath = 'docs/WORKER-BRAVE-PRO-REVIEW-PROTOCOL.md';
const universalCommit = '83a3b7a2728d04fca94035fd59b8eb33f18bdf7b';
const universalSources = [
  'LESSON-INDEX.md',
  'templates/CURRENT-CODEX-WORKER-SUPERVISION-BOOTSTRAP.md',
  'templates/CHAT-TO-CODEX-EXECUTION-DIRECTIVE.json',
  'patterns/chat-led-reasoning-codex-execution-separation.md',
  'patterns/codex-supervision-intelligence-routing-and-context-lifecycle.md',
  'patterns/codex-supervision-resource-routing-account-failover-and-browser-hygiene.md',
  'patterns/persistent-browser-automation-hygiene.md',
  'patterns/independent-evaluation-separation.md',
  'patterns/research-before-reinvention.md',
  'feedback/mission-control/SDF-20260902-GITHUB-FINAL-HEAD-CHECK-LIVENESS-001.json',
];

test('canonical Worker to Brave Pro protocol exists, is indexed once, and preserves provenance', async () => {
  const [protocol, index] = await Promise.all([
    readUtf8(protocolPath),
    readUtf8('docs/INDEX.md'),
  ]);

  assert.equal(protocol.split('\n', 1)[0], '# Worker → Brave Pro Review Protocol');
  assert.match(protocol, /project-local canonical composition/i);
  assert.match(protocol, /not a byte-for-byte (?:recovery|restoration)/i);
  assert.match(protocol, new RegExp(universalCommit));
  for (const source of universalSources) assert.match(protocol, new RegExp(source.replaceAll('.', '\\.')));
  assert.match(protocol, /PR #15[^\n]*5487680022/);
  assert.match(protocol, /PR #15[^\n]*5494364061/);

  const indexRoutes = index.match(/WORKER-BRAVE-PRO-REVIEW-PROTOCOL\.md/g) ?? [];
  assert.equal(indexRoutes.length, 1);
  assert.match(index, /^## Worker → Brave Pro review$/m);
  assert.doesNotMatch(index, /REPOSITORY-OPERATING-MODEL\.md/);
});

test('protocol separates reasoning, execution, independent review, and browser transport', async () => {
  const protocol = await readUtf8(protocolPath);

  assert.match(
    protocol,
    /owner\/project authority → Extra High reasoning → versioned bounded directive → Codex execution → immutable receipt\/evidence → Extra High exact-head review → Pro when required → Extra High reconciliation/i,
  );
  assert.match(protocol, /Extra High may inspect GitHub directly/);
  assert.match(protocol, /Codex may execute, test, collect evidence/);
  assert.match(protocol, /Codex may not invent strategy, architecture, owner policy/);
  assert.match(protocol, /Pro must receive a self-contained packet/);
  assert.match(protocol, /Pro must not be expected to retrieve GitHub or filesystem evidence/);
  assert.match(protocol, /Pro findings are evidence, not owner authority/);
  assert.match(protocol, /Brave is review transport\/authentication state only, never authority/);
  assert.match(protocol, /headless operation by default where compatible/);
  assert.match(protocol, /BROWSER_TRANSPORT_BLOCKED/);
});

test('protocol fails closed on stale heads, placeholder checks, and false owner escalation', async () => {
  const protocol = await readUtf8(protocolPath);

  for (const binding of [
    'directive ID',
    'base commit/tree',
    'candidate commit/tree',
    'changed paths',
    'complete relevant diff/content',
    'hosted workflow run/job/check identities',
    'unresolved findings',
    'bounded review question',
  ]) {
    assert.match(protocol, new RegExp(binding.replaceAll('/', '\\/'), 'i'));
  }
  assert.match(protocol, /Head movement invalidates prior exact-head review evidence/);
  assert.match(protocol, /zero-job placeholder[^\n]*not valid exact-head CI proof/);
  assert.match(protocol, /OWNER_DECISION_REQUIRED[^\n]*genuine owner-controlled choice/);
  assert.match(protocol, /CI failures, ordinary bugs, browser failures, stale evidence[^\n]*non-owner blockers/);
});

test('protocol and checkpoints explicitly deny DEV-R005 S002 and runtime effects', async () => {
  const [protocol, taskState, repositoryState] = await Promise.all([
    readUtf8(protocolPath),
    readUtf8('tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md'),
    readUtf8('state/CODEX-CURRENT-STATE.md'),
  ]);

  assert.match(protocol, /DEV-R005 S002 AUTHORIZED: false/);
  assert.match(protocol, /laterSlicesAuthorized` remains `false/);
  assert.match(protocol, /does not alter D001–D004/);
  assert.match(protocol, /does not authorize storage implementation/);
  assert.match(protocol, /does not touch application behavior/);
  assert.match(protocol, /does not touch therapy\/hypnosis behavior/);
  for (const checkpoint of [taskState, repositoryState]) {
    assert.match(checkpoint, /PR #36[^\n]*merged/i);
    assert.match(checkpoint, /governance[^\n]*protocol[^\n]*(?:current|active) bounded repair/i);
    assert.match(checkpoint, /S002 remains unauthorized/i);
    assert.match(checkpoint, /no runtime, storage, cryptography, application, plugin, or therapy effect/i);
  }

  const urls = protocol.match(/https?:\/\/[^\s`)'"<>]+/g) ?? [];
  assert.equal(
    urls.some((candidate) => {
      const url = new URL(candidate);
      return url.hostname === 'chatgpt.com' && url.pathname.startsWith('/c/');
    }),
    false,
  );
  assert.doesNotMatch(
    protocol,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:cookie|token|sessionId|credentialValue|recoverySecretValue)\s*[:=]/i,
  );
});
