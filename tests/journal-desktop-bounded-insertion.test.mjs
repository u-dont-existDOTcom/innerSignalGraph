import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {createChatGptSubscriptionDesktopCdpTransport} = await import(
  process.env.J10_DESKTOP_MODULE || new URL('../src/journal-import/chatgpt-subscription-desktop-cdp.mjs', import.meta.url));

function setup({behavior = 'normal', initial = '', lagReads = 0} = {}) {
  const transport = createChatGptSubscriptionDesktopCdpTransport({pageReadyTimeoutMs: 25});
  let text = initial, expected = initial, pending = false, readsRemaining = 0, verified = true;
  const chunks = [], trace = [];
  const client = {
    async call(fn) {
      trace.push(['read', fn.name]);
      if (fn.name === 'focusComposerAtEnd') {
        assert.equal(verified, true, 'next insertion requires previous exact prefix readback');
        return {ok: true};
      }
      assert.equal(fn.name, 'composerState');
      if (pending && behavior !== 'timeout-unapplied' && behavior !== 'timeout-partial') {
        if (readsRemaining-- <= 0) { text = expected; pending = false; }
      }
      if (text === expected) verified = true;
      return {found: true, disabled: false, text};
    },
    async send(method, args) {
      assert.equal(method, 'Input.insertText', 'only bounded editing is allowed, never a Send gesture');
      assert.equal(verified, true, 'must read back each previous prefix before another edit');
      verified = false;
      chunks.push(args.text);
      trace.push(['insert', args.text.length]);
      expected += args.text;
      pending = true;
      readsRemaining = lagReads;
      if (behavior === 'diverge') { text = expected + '!'; pending = false; }
      if (behavior === 'timeout-partial') text += args.text.slice(0, 10);
      if (behavior === 'non-timeout-error') { text = expected; throw new Error('Synthetic protocol rejection'); }
      if (behavior.startsWith('timeout-')) throw new Error('Chrome DevTools request timed out.');
    }
  };
  return {transport, client, chunks, trace, state: () => ({text, expected})};
}

test('large packet preserves every byte and verifies each bounded Unicode-safe chunk', async () => {
  const f = setup();
  const prompt = 'a'.repeat(8191) + '😀' + 'é\n\nline\n'.repeat(25000) + '終';
  await f.transport.insertPrompt(f.client, prompt);
  assert.ok(f.chunks.length > 20);
  assert.ok(f.chunks.every(c => c.length <= 8192));
  assert.ok(f.chunks.every(c => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)));
  assert.equal(f.chunks.join(''), prompt);
  assert.equal(f.state().text, prompt);
  assert.equal(createHash('sha256').update(f.state().text).digest('hex'), createHash('sha256').update(prompt).digest('hex'));
});

test('small packet stays one edit and waits for complete exact readback', async () => {
  const f = setup({lagReads: 1}); f.transport.pageReadyTimeoutMs = 500;
  await f.transport.insertPrompt(f.client, 'one\n\nélan');
  assert.equal(f.chunks.length, 1);
  assert.equal(f.state().text, 'one\n\nélan');
});

test('timeout after successful edit advances only after exact readback and never resends', async () => {
  const f = setup({behavior: 'timeout-applied'});
  const prompt = 'x'.repeat(20000);
  await f.transport.insertPrompt(f.client, prompt);
  assert.equal(f.chunks.length, 3);
  assert.equal(f.chunks.join(''), prompt);
  assert.equal(f.state().text, prompt);
});

test('unapplied or partial timed-out edit stops without a retry or later chunk', async () => {
  for (const behavior of ['timeout-unapplied', 'timeout-partial']) {
    const f = setup({behavior});
    await assert.rejects(() => f.transport.insertPrompt(f.client, 'x'.repeat(20000)),
      /could not be reconciled by exact readback/);
    assert.equal(f.chunks.length, 1, behavior);
  }
});

test('unexpected composer text stops immediately without another insertion', async () => {
  const f = setup({behavior: 'diverge'});
  await assert.rejects(() => f.transport.insertPrompt(f.client, 'x'.repeat(20000)),
    {code: 'PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE', message: 'ChatGPT desktop composer diverged during packet insertion.'});
  assert.equal(f.chunks.length, 1);
});

test('non-timeout command failure is not treated as a successful edit', async () => {
  const f = setup({behavior: 'non-timeout-error'});
  await assert.rejects(() => f.transport.insertPrompt(f.client, 'x'.repeat(20000)), /Synthetic protocol rejection/);
  assert.equal(f.chunks.length, 1);
});

test('stale initial composer rejects without inserting or submitting', async () => {
  const f = setup({initial: 'stale'});
  await assert.rejects(() => f.transport.insertPrompt(f.client, 'new packet'),
    {code: 'PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE'});
  assert.equal(f.chunks.length, 0);
});
