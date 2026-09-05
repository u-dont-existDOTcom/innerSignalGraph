import { initialState, transition, SCENARIOS } from './model.mjs';

export function mountPreview(doc) {
  let state = initialState();
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
      node.append(caption, quote, button); return node;
    });
    if (!nodes.length) {
      const empty = doc.createElement('div'); empty.className = 'empty';
      empty.textContent = state.history ? 'No active fictional reports remain.'
        : 'Enable the fictional history under Your approach to show the example reports.';
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
      state = transition(state, action);
      render();
      if (focusId) el(focusId).focus();
    } catch {
      // A rendering/transition failure must not leave a stale reading on screen.
      state = initialState();
      state.notice = 'The preview could not apply that change. Its temporary state has been cleared.';
      render();
      el('notice').focus();
    }
  }
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
