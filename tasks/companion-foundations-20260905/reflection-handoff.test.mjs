import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReflectionHandoff } from './reflection-handoff.mjs';
const yes = () => true;

test('fresh reply is usable once, for review only', () => {
  const guard = createReflectionHandoff();
  const { ticket } = guard.begin(yes);
  assert.deepEqual(guard.consume(ticket, yes), { allowed: true, reason: 'FRESH_FOR_REVIEW_ONLY' });
  assert.equal(guard.consume(ticket, yes).allowed, false);
});
test('ticket contains no private data or serializable identity', () => {
  const guard = createReflectionHandoff();
  const queued = guard.begin(yes);
  assert.ok(Object.isFrozen(guard) && Object.isFrozen(queued) && Object.isFrozen(queued.ticket));
  assert.deepEqual(Reflect.ownKeys(queued.ticket), []);
  assert.equal(Object.getPrototypeOf(queued.ticket), null);
});
for (const result of [false, undefined, null, 'true', 1, {}, Promise.resolve(true)]) {
  test(`eligibility must be a synchronous literal true: ${typeof result}`, () => {
    const guard = createReflectionHandoff();
    assert.equal(guard.begin(() => result).allowed, false);
    const { ticket } = guard.begin(yes);
    assert.equal(guard.consume(ticket, () => result).allowed, false);
    assert.equal(guard.consume(ticket, yes).allowed, false);
  });
}
test('throwing or absent eligibility fails closed without leaking the exception', () => {
  const guard = createReflectionHandoff();
  const boom = () => { throw new Error('synthetic-private-decoy'); };
  assert.deepEqual(guard.begin(boom), { allowed: false, reason: 'NOT_ELIGIBLE' });
  assert.equal(guard.begin(null).allowed, false);
  const { ticket } = guard.begin(yes);
  assert.deepEqual(guard.consume(ticket, boom), { allowed: false, reason: 'NOT_ELIGIBLE' });
});
test('invalidation blocks old replies before rechecking eligibility', () => {
  const guard = createReflectionHandoff();
  const { ticket } = guard.begin(yes);
  guard.invalidate();
  assert.equal(guard.consume(ticket, () => { assert.fail('stale callback ran'); }).allowed, false);
});
test('a stale delivery cannot erase a newer request', () => {
  const guard = createReflectionHandoff();
  const a = guard.begin(yes).ticket;
  const b = guard.begin(yes).ticket;
  assert.equal(guard.consume(a, yes).allowed, false);
  assert.equal(guard.consume(b, yes).allowed, true);
});
test('denied newer requests also invalidate older requests', () => {
  const guard = createReflectionHandoff();
  const ticket = guard.begin(yes).ticket;
  guard.begin(() => false);
  assert.equal(guard.consume(ticket, yes).allowed, false);
});
test('restoring old permissions or scenario does not resurrect a ticket', () => {
  const guard = createReflectionHandoff();
  const ticket = guard.begin(yes).ticket;
  guard.invalidate(); guard.invalidate();
  assert.equal(guard.consume(ticket, yes).allowed, false);
});
test('cloned, forged and foreign-instance tickets cannot consume the current request', () => {
  const guard = createReflectionHandoff();
  const ticket = guard.begin(yes).ticket;
  for (const forged of [structuredClone(ticket), {}, null, undefined, createReflectionHandoff().begin(yes).ticket]) {
    assert.equal(guard.consume(forged, yes).allowed, false);
  }
  assert.equal(guard.consume(ticket, yes).allowed, true);
});
test('invalidation during eligibility prevents a queued or accepted result', () => {
  const guard = createReflectionHandoff();
  assert.equal(guard.begin(() => { guard.invalidate(); return true; }).allowed, false);
  const ticket = guard.begin(yes).ticket;
  assert.equal(guard.consume(ticket, () => { guard.invalidate(); return true; }).allowed, false);
});
test('a newer reentrant request is preserved and the older result is refused', () => {
  const guard = createReflectionHandoff();
  const a = guard.begin(yes).ticket;
  let b;
  assert.equal(guard.consume(a, () => { b = guard.begin(yes).ticket; return true; }).allowed, false);
  assert.equal(guard.consume(b, yes).allowed, true);
});
test('unknown hostile tickets are not inspected', () => {
  const guard = createReflectionHandoff();
  const ticket = guard.begin(yes).ticket;
  const hostile = new Proxy({}, { get: () => { assert.fail('ticket inspected'); } });
  assert.equal(guard.consume(hostile, yes).allowed, false);
  assert.equal(guard.consume(ticket, yes).allowed, true);
});
test('freshness seam has no evidence retention, hashes, I/O or model implementation', async () => {
  const source = await readFile(new URL('./reflection-handoff.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import |\b(?:fetch|createHash|localStorage|sessionStorage|indexedDB|setTimeout)\s*[.(]/m);
});
