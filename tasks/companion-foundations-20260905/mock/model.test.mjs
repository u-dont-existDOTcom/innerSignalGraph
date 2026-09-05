import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { initialState, transition, previewReflection, previewInvitation, SCENARIOS } from './model.mjs';
import { buildPreview } from './build.mjs';
const act = (state, type, extra = {}) => transition(state, { type, ...extra });
const ready = (id = 'boundaries') => act(act(initialState(), 'scenario', { id }), 'history', { value: true });
const read = id => act(ready(id), 'review');

test('fresh preview has no enabled history, reading or unsolicited invitations', () => {
  const state = initialState();
  assert.equal(state.history, false);
  assert.deepEqual(state.reports, []);
  assert.equal(state.reflection, null);
  assert.equal(previewInvitation(state, 'inner').allowed, false);
  assert.equal(previewInvitation(state, 'spirit').allowed, false);
});
for (const theme of ['inner', 'spirit']) {
  for (const preference of ['unset', 'user_initiated', 'do_not_suggest']) {
    test(`${theme}: ${preference} never creates an unsolicited invitation`, () => {
      const state = act(initialState(), 'preference', { key: theme, value: preference });
      assert.equal(previewInvitation(state, theme).allowed, false);
      assert.equal(previewInvitation(state, theme, true).reason, 'CURRENT_REQUEST_ONLY');
      const next = act(state, 'invite', { theme, requestedNow: true });
      assert.equal(next.preferences[theme], preference);
    });
  }
}
test('inner-child and spiritual permissions are independent', () => {
  const state = act(initialState(), 'preference', { key: 'inner', value: 'welcome' });
  assert.equal(previewInvitation(state, 'inner').allowed, true);
  assert.equal(previewInvitation(state, 'spirit').allowed, false);
});
test('welcomed suggestions are not repeated', () => {
  let state = act(initialState(), 'preference', { key: 'inner', value: 'welcome' });
  state = act(state, 'invite', { theme: 'inner' });
  assert.equal(previewInvitation(state, 'inner').reason, 'DO_NOT_REPEAT_INVITATION');
});
for (const id of ['boundaries', 'mixed', 'natural']) {
  test(`${id}: reading cites every active fictional source`, () => {
    const state = read(id);
    assert.ok(state.reflection.text);
    assert.deepEqual(state.reflection.sourceIds, state.reports.map(item => item.id));
  });
}
for (const id of ['missing', 'repeated']) {
  test(`${id}: insufficient distinct history produces no invented progress`, () => {
    assert.equal(read(id).reflection, null);
    assert.match(read(id).notice, /not enough distinct/);
  });
}
test('mixed case preserves complicating evidence and is not an unqualified success', () => {
  const state = read('mixed');
  assert.equal(state.reflection.mixed, true);
  assert.ok(state.reflection.sourceIds.includes('m3'));
  assert.match(state.reflection.text, /not call this simply better/);
});
test('natural development is credited to friends, not the app or a required modality', () => {
  assert.match(read('natural').reflection.text, /through your friends/);
  assert.match(read('natural').reflection.text, /not required/);
});
test('history must be explicitly enabled', () => {
  assert.equal(act(initialState(), 'review').reflection, null);
});
test('turning history off clears active reports, reading, feedback and references', () => {
  const state = act(act(read('mixed'), 'confirm'), 'history', { value: false });
  assert.deepEqual(state.reports, []);
  assert.equal(state.reflection, null);
  assert.equal(state.feedback, '');
});
for (const id of ['m1', 'm3']) {
  test(`withdrawing ${id} invalidates the old reading, including counterevidence withdrawal`, () => {
    let state = act(read('mixed'), 'withdraw', { id });
    assert.equal(state.reflection, null);
    assert.ok(state.reports.every(report => report.id !== id));
    assert.equal(previewReflection(state).reason, 'SOURCE_CHANGED_REASSESSMENT_REQUIRED');
    state = act(act(state, 'scenario', { id: 'boundaries' }), 'scenario', { id: 'mixed' });
    assert.ok(state.reports.every(report => report.id !== id));
    assert.equal(act(state, 'review').reflection, null);
    state = act(act(state, 'history', { value: false }), 'history', { value: true });
    assert.ok(state.reports.every(report => report.id !== id));
  });
}
test('rejection persists across review, preference changes and scenario switching', () => {
  let state = act(read('boundaries'), 'reject');
  state = act(state, 'preference', { key: 'reflections', value: 'occasional' });
  state = act(act(state, 'scenario', { id: 'natural' }), 'scenario', { id: 'boundaries' });
  assert.equal(act(state, 'review').reflection, null);
  assert.equal(previewReflection(state).reason, 'INTERPRETATION_REJECTED');
});
test('explicit fictional reset clears scenario suppression but preserves preferences', () => {
  let state = act(read('mixed'), 'withdraw', { id: 'm3' });
  state = act(state, 'preference', { key: 'spirit', value: 'do_not_suggest' });
  state = act(state, 'reset');
  assert.ok(act(state, 'review').reflection.sourceIds.includes('m3'));
  assert.equal(state.preferences.spirit, 'do_not_suggest');
});
test('confirming a reading does not add evidence or remove tentativeness', () => {
  const before = read('boundaries');
  const after = act(before, 'confirm');
  assert.deepEqual(after.reports, before.reports);
  assert.deepEqual(after.reflection, before.reflection);
  assert.match(after.feedback, /does not make.*clinical fact/);
});
test('off blocks even a current review request and clears the old reading', () => {
  const state = act(read('boundaries'), 'preference', { key: 'reflections', value: 'off' });
  assert.equal(state.reflection, null);
  assert.equal(act(state, 'review').reflection, null);
});
test('on-request blocks an unprompted check-in without silently changing consent', () => {
  const state = act(ready(), 'review', { requestedNow: false });
  assert.equal(state.reflection, null);
  assert.equal(state.preferences.reflections, 'on_request');
});
test('occasional can offer once, not loop; explicit revisiting is allowed', () => {
  let state = act(ready(), 'preference', { key: 'reflections', value: 'occasional' });
  state = act(state, 'review', { requestedNow: false });
  assert.ok(state.reflection);
  state = act(state, 'review', { requestedNow: false });
  assert.equal(state.reflection, null);
  assert.match(state.notice, /already been reviewed/);
  assert.ok(act(state, 'review', { requestedNow: true }).reflection);
});
test('switching scenario never leaks a previous interpretation', () => {
  assert.equal(act(read('natural'), 'scenario', { id: 'missing' }).reflection, null);
});
test('a requested question is optional; another request gives concrete help', () => {
  const once = act(initialState(), 'support', { practice: true });
  assert.match(once.support, /someone you love/);
  const twice = act(once, 'support', { practice: true });
  assert.match(twice.support, /without proving/);
  assert.match(act(initialState(), 'support', { practice: false }).support, /without proving/);
});
test('exit clears session and does not require completed goals or spiritual permission', () => {
  let state = act(read('natural'), 'support', { practice: true });
  state = act(state, 'exit');
  assert.equal(state.closed, true);
  assert.equal(state.history, false);
  assert.equal(state.reflection, null);
  assert.deepEqual(state.reports, []);
  assert.equal(state.support, '');
  assert.equal(state.preferences.spirit, 'unset');
  assert.deepEqual(act(state, 'review'), state);
  assert.deepEqual(act(state, 'restart'), initialState());
});
test('bad preview events fail closed at the reducer boundary', () => {
  for (const action of [{ type: 'oops' }, { type: 'history', value: 'true' },
    { type: 'scenario', id: '__proto__' }, { type: 'preference', key: 'spirit', value: 'yes' },
    { type: 'support', practice: 'yes' }, { type: 'withdraw', id: 'missing' }, { type: 'confirm' },
    { type: 'invite', theme: 'other' }]) {
    assert.throws(() => transition(initialState(), action), TypeError);
  }
});
test('transitions do not mutate the prior state or fictional fixtures', () => {
  const state = ready('mixed');
  const before = structuredClone(state);
  const fixture = JSON.stringify(SCENARIOS);
  act(state, 'withdraw', { id: 'm3' });
  assert.deepEqual(state, before);
  assert.equal(JSON.stringify(SCENARIOS), fixture);
  assert.ok(Object.isFrozen(SCENARIOS.mixed.reports[0]));
});
test('standalone build is deterministic with correct script and style CSP hashes', async () => {
  const html = await buildPreview();
  assert.equal(await buildPreview(), html);
  for (const tag of ['script', 'style']) {
    const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))[1];
    const hash = createHash('sha256').update(content).digest('base64');
    assert.ok(html.includes(`'sha256-${hash}'`));
  }
  assert.ok(!html.includes('__SCRIPT__') && !html.includes('__CSP__'));
  assert.match(html, /connect-src 'none'/);
});
test('browser sources use no persistence, network, runtime HTML injection or external resources', async () => {
  const html = await buildPreview();
  assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|sendBeacon|fetch|eval)\s*[.(]/);
  assert.doesNotMatch(html, /(?:innerHTML|outerHTML|document\.cookie)\s*=/);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i);
  assert.doesNotMatch(html, /<textarea|contenteditable/i);
  const view = await readFile(new URL('./view.mjs', import.meta.url), 'utf8');
  assert.match(view, /\.textContent =/);
});
test('UI includes explicit evidence limits, spiritual consent, secular wording and no model claim', async () => {
  const html = await buildPreview();
  for (const phrase of ['NO AI', 'NO SAVING', 'secular approach', 'not a clinical verdict',
    'fictional examples remain', 'not advice to end care', 'not a model evaluation']) {
    assert.ok(html.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});
