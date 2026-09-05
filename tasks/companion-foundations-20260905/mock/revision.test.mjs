import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition } from './model.mjs';
import { buildPreview } from './build.mjs';
const act = (state, type, extra = {}) => transition(state, { type, ...extra });
const ready = (id = 'boundaries') => act(act(initialState(), 'scenario', { id }), 'history', { value: true });
const read = id => act(ready(id), 'review');

test('history control and reflection settings belong with the fictional examples, not invitations', async () => {
  const html = await buildPreview();
  const aside = html.match(/<aside[\s\S]*?<\/aside>/)[0];
  const group = html.match(/<fieldset id="history-controls">[\s\S]*?<\/fieldset>/)[0];
  assert.doesNotMatch(aside, /id="(?:history|scenario|reflection-pref)"/);
  for (const id of ['history', 'scenario', 'reflection-pref']) assert.ok(group.includes(`id="${id}"`));
  assert.ok(html.indexOf('id="workspace"') < html.indexOf('id="history-controls"'));
  assert.doesNotMatch(html, /history under Your approach/);
});
for (const [scenario, id] of [['boundaries', 'b2'], ['mixed', 'm2'], ['natural', 'n2']]) {
  test(`${scenario}: correction replaces a report and prevents obsolete interpretation reuse`, () => {
    const before = read(scenario);
    const corrected = act(before, 'correct', { id });
    assert.notEqual(corrected.reports.find(r => r.id === id).quote, before.reports.find(r => r.id === id).quote);
    assert.equal(corrected.reports.find(r => r.id === id).assessment, 'complicates');
    assert.equal(corrected.reflection, null);
    assert.equal(act(corrected, 'review').reflection, null);
    const toggled = act(act(corrected, 'history', { value: false }), 'history', { value: true });
    assert.equal(act(toggled, 'review').reflection, null);
    const switched = act(act(toggled, 'scenario', { id: 'missing' }), 'scenario', { id: scenario });
    assert.equal(act(switched, 'review').reflection, null);
    assert.ok(act(act(switched, 'reset'), 'review').reflection);
    assert.deepEqual(before, read(scenario));
  });
}
test('unknown correction and correction without enabled history are rejected', () => {
  assert.throws(() => act(ready(), 'correct', { id: 'b1' }), TypeError);
  assert.throws(() => act(initialState(), 'correct', { id: 'b2' }), TypeError);
});
