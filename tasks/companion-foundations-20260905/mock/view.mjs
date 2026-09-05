import { initialState, transition, previewReflection, SCENARIOS, CORRECTIONS } from './model.mjs';

import { createReflectionHandoff } from '../reflection-handoff.mjs';

export function mountPreview(doc) {
  let state = initialState();
  const handoff = createReflectionHandoff();
  let queuedTicket = null;
  const el = id => {
    const element = doc.getElementById(id);
    if (!element) throw new Error(`Missing preview element: ${id}`);
    return element;
  };
  const setText = (id, value) => { el(id).textContent = value; };
  const option = (value, label) => {
    const node = doc.createElement('option');
    node.value = value; node.textContent = label; return node;
  };
  for (const id of ['inner-pref', 'spirit-pref']) {
    el(id).replaceChildren(...[
      ['unset', 'Not chosen — no suggestions'], ['welcome', 'Welcome relevant suggestions'],
      ['user_initiated', 'Only when I ask'], ['do_not_suggest', 'Do not suggest this']
    ].map(([value, label]) => option(value, label)));
  }
  el('scenario').replaceChildren(...Object.entries(SCENARIOS).map(([id, scenario]) => option(id, scenario.title)));
  function renderReports() {
    const nodes = state.reports.map(report => {
      const node = doc.createElement('article');
      node.className = `report ${report.assessment === 'complicates' ? 'complicates' : ''}`;
      const caption = doc.createElement('div'); caption.className = 'source';
      caption.textContent = `${report.period} · fictional source ${report.id} · ${report.episodeId}`;
      const quote = doc.createElement('blockquote'); quote.textContent = report.quote;
      const button = doc.createElement('button'); button.textContent = 'Withdraw this example';
      button.id = `withdraw-${report.id}`;
      button.setAttribute('aria-label', `Withdraw fictional source ${report.id}`);
      button.addEventListener('click', () => dispatch({ type: 'withdraw', id: report.id }, 'notice'));
      const actions = doc.createElement('div'); actions.className = 'row';
      actions.append(button);
      if (Object.hasOwn(CORRECTIONS, report.id) && !report.corrected) {
        const correct = doc.createElement('button'); correct.textContent = 'Simulate a correction';
        correct.id = `correct-${report.id}`;
        correct.setAttribute('aria-label', `Correct fictional source ${report.id}`);
        correct.addEventListener('click', () => dispatch({ type: 'correct', id: report.id }, 'notice'));
        actions.append(correct);
      }
      if (report.corrected) caption.textContent += ' · corrected example';
      node.append(caption, quote, actions); return node;
    });
    if (!nodes.length) {
      const empty = doc.createElement('div'); empty.className = 'empty';
      empty.textContent = state.history ? 'No active fictional reports remain.'
        : 'Use the fictional-history checkbox just above the example selector to show the reports.';
      nodes.push(empty);
    }
    el('reports').replaceChildren(...nodes);
  }
  function render() {
    el('active').hidden = state.closed;
    el('ended').hidden = !state.closed;
    el('exit').hidden = state.closed;
    el('inner-pref').value = state.preferences.inner;
    el('spirit-pref').value = state.preferences.spirit;
    el('reflection-pref').value = state.preferences.reflections;
    el('scenario').value = state.scenario;
    el('history').checked = state.history;
    setText('inner-result', state.invitations.inner);
    setText('spirit-result', state.invitations.spirit);
    renderReports();
    setText('notice', state.notice);
    el('reading').hidden = !state.reflection;
    el('reading').classList.toggle('mixed', Boolean(state.reflection?.mixed));
    setText('reading-text', state.reflection?.text || '');
    setText('reading-sources', state.reflection ? `Based only on fictional sources: ${state.reflection.sourceIds.join(', ')}.` : '');
    setText('feedback', state.feedback);
    setText('support-text', state.support);
    el('support-text').hidden = !state.support;
  }
  function dispatch(action, focusId) {
    try {
      if (['preference', 'history', 'scenario', 'correct', 'withdraw', 'reject', 'reset', 'review', 'exit', 'restart'].includes(action.type)) {
        handoff.invalidate();
        setText('handoff-status', queuedTicket ? 'The queued reply is no longer current. Deliver it to test that it is blocked.' : '');
      }
      if (action.type === 'exit' || action.type === 'restart') {
        queuedTicket = null;
        setText('handoff-status', '');
      }
      state = transition(state, action);
      render();
      if (focusId) el(focusId).focus();
    } catch {
      handoff.invalidate(); queuedTicket = null; setText('handoff-status', '');
      // A rendering/transition failure must not leave a stale reading on screen.
      state = initialState();
      state.notice = 'The preview could not apply that change. Its temporary state has been cleared.';
      render();
      el('notice').focus();
    }
  }
  el('queue-reflection').addEventListener('click', () => {
    dispatch({ type: 'clear-reading' });
    const request = handoff.begin(() => previewReflection(state, true).allowed);
    queuedTicket = request.allowed ? request.ticket : null;
    setText('handoff-status', request.allowed ? 'Example reply queued. Nothing has been generated or sent.'
      : 'No reply queued: the current example or permissions do not support a comparison.');
  });
  el('deliver-reflection').addEventListener('click', () => {
    const decision = handoff.consume(queuedTicket, () => previewReflection(state, true).allowed);
    queuedTicket = null;
    if (decision.allowed) {
      // Freshness is not semantic approval. Only the existing labeled scripted demo is rendered.
      dispatch({ type: 'review', requestedNow: true });
      setText('handoff-status', 'Current scripted example delivered once. No model or semantic evaluation occurred.');
    } else setText('handoff-status', 'Old or unavailable reply blocked. No reading was added or changed.');
  });
  el('cancel-reflection').addEventListener('click', () => {
    handoff.invalidate(); queuedTicket = null;
    setText('handoff-status', 'Queued reply cancelled. You can leave without completing anything.');
  });
  // This is a demo lifecycle hook, not an OS-backed vault implementation.
  doc.defaultView?.addEventListener('pagehide', () => dispatch({ type: 'exit' }));
  for (const [id, key] of [['inner-pref', 'inner'], ['spirit-pref', 'spirit'], ['reflection-pref', 'reflections']]) {
    el(id).addEventListener('change', event => dispatch({ type: 'preference', key, value: event.target.value }));
  }
  el('history').addEventListener('change', event => dispatch({ type: 'history', value: event.target.checked }));
  el('scenario').addEventListener('change', event => dispatch({ type: 'scenario', id: event.target.value }));
  const clicks = {
    review: { type: 'review', requestedNow: true }, opportunity: { type: 'review', requestedNow: false },
    confirm: { type: 'confirm' }, reject: { type: 'reject' }, reset: { type: 'reset' },
    practice: { type: 'support', practice: true }, direct: { type: 'support', practice: false },
    exit: { type: 'exit' }, reopen: { type: 'restart' }
  };
  for (const [id, action] of Object.entries(clicks)) {
    const focusId = id === 'exit' ? 'ended-title' : id === 'reopen' ? 'workspace' : id === 'reject' ? 'notice' : null;
    el(id).addEventListener('click', () => dispatch(action, focusId));
  }
  for (const theme of ['inner', 'spirit']) {
    el(`${theme}-invite`).addEventListener('click', () => dispatch({ type: 'invite', theme, requestedNow: false }));
    el(`${theme}-request`).addEventListener('click', () => dispatch({ type: 'invite', theme, requestedNow: true }));
  }
  render();
}
if (typeof document !== 'undefined') mountPreview(document);
