import test from 'node:test';
import assert from 'node:assert/strict';

const {createChatGptSubscriptionDesktopCdpTransport} = await import(
  process.env.J10_DESKTOP_MODULE || new URL('../src/journal-import/chatgpt-subscription-desktop-cdp.mjs', import.meta.url));

function restoredDraftClient({failedClear = false, existingTurns = false, loseFinalIsolation = false} = {}) {
  const t = createChatGptSubscriptionDesktopCdpTransport({pageReadyTimeoutMs: 25});
  const disclosure = 'Temporary chat This chat will ignore memory, plugins, and custom instructions';
  let draft = '', chatReady = false, bodyReads = 0, backspaces = 0;
  const trace = [];
  t.pointerClick = async (_c, kind, value) => {
    trace.push(['click', kind, value]);
    assert.equal(value, 'New chat', 'already configured isolation needs no toggle');
    draft = 'synthetic restored draft '.repeat(1400); // exceeds the actual 3000-character bodyTail.
    chatReady = true;
  };
  const client = {
    async call(fn, args) {
      trace.push(['call', fn.name]);
      switch (fn.name) {
        case 'chatSurfaceState': {
          bodyReads++;
          const header = loseFinalIsolation && bodyReads >= 5 ? 'Temporary chat' : disclosure;
          const bodyTail = (header + (existingTurns ? ' You said: prior turn ChatGPT said: prior answer' : '') + '\n' + draft).slice(-3000);
          trace.push(['body', draft.length, bodyTail.includes(disclosure)]);
          return {modeLabel: 'ChatGPT', composerFound: chatReady, bodyTail};
        }
        case 'attachmentRemoveState': return {count: 0, first: null};
        case 'composerState': return {found: chatReady, disabled: false, text: draft};
        case 'focusComposerAtEnd': return {ok: true};
        case 'exactControl':
          assert.equal(draft.length, 0, 'isolation control read must follow successful draft clearance');
          assert.ok(['Turn off temporary chat', 'Unpersonalized'].includes(args[1]));
          return {ok: true};
        default: assert.fail('Unexpected client read: ' + fn.name);
      }
    },
    async send(method, args) {
      trace.push(['send', method, args.key]);
      assert.equal(method, 'Input.dispatchKeyEvent', 'must never submit or insert a packet');
      assert.ok(['a', 'Backspace'].includes(args.key));
      if (args.type === 'keyUp' && args.key === 'Backspace') {
        backspaces++;
        if (!failedClear) draft = '';
      }
    }
  };
  return {t, client, trace, state: () => ({draft, backspaces, bodyReads})};
}

test('restored long draft is cleared before isolation labels are checked', async () => {
  const f = restoredDraftClient();
  await f.t.startFreshUnpersonalizedTemporaryChat(f.client);
  const bodyRows = f.trace.filter(e => e[0] === 'body');
  assert.ok(bodyRows[0][1] > 3000);
  assert.equal(bodyRows[0][2], false, 'mode readiness sees the original truncated tail');
  assert.ok(bodyRows.slice(1).every(e => e[1] === 0 && e[2] === true));
  assert.equal(f.state().draft, '');
  assert.equal(f.state().backspaces, 1);
});

test('failed draft clearance rejects before any isolation transition or packet submission', async () => {
  const f = restoredDraftClient({failedClear: true});
  await assert.rejects(() => f.t.startFreshUnpersonalizedTemporaryChat(f.client),
    {code: 'PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE', message: 'Fresh packet composer retained stale text.'});
  assert.ok(f.state().draft.length > 3000);
  assert.equal(f.trace.some(e => e[0] === 'call' && e[1] === 'exactControl'), false);
});

test('existing conversation turns still prevent freshness admission after draft clearance', async () => {
  const f = restoredDraftClient({existingTurns: true});
  await assert.rejects(() => f.t.startFreshUnpersonalizedTemporaryChat(f.client),
    /Fresh ChatGPT conversation did not become empty/);
  assert.equal(f.trace.some(e => e[0] === 'call' && e[1] === 'exactControl'), false);
});

test('final isolation disclosure check remains active after repeated clear operations', async () => {
  const f = restoredDraftClient({loseFinalIsolation: true});
  await assert.rejects(() => f.t.startFreshUnpersonalizedTemporaryChat(f.client),
    {code: 'PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE', message: 'Unpersonalized isolation was lost while clearing the composer.'});
});
