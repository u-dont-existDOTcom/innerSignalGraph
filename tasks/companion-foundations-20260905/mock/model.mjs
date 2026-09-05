import { invitationDecision, reflectionDecision, supportMode, stepBackDecision } from '../policy.mjs';

// Entirely fictional reports. No language model, real intake or diagnosis.
const sample = (id, episodeId, period, quote, assessment = 'supports') =>
  ({ id, episodeId, period, quote, assessment });
const freezeDeep = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};
export const SCENARIOS = freezeDeep({
  boundaries: {
    title: 'More choice during criticism', dimension: 'flexibility',
    reports: [
      sample('b1', 'b-event1', 'earlier', 'After one disagreement, I apologized repeatedly and spent the weekend replaying it.'),
      sample('b2', 'b-event2', 'recent', 'In a different disagreement, I asked what needed changing. It still hurt, but I returned to my evening.')
    ],
    reading: 'These two examples suggest more choice in your response to criticism. The hurt has not disappeared, and two situations do not establish a lasting pattern. Does that fit your experience, or am I missing something?'
  },
  mixed: {
    title: 'More control, less connection', dimension: 'everyday_participation',
    reports: [
      sample('m1', 'm-event1', 'earlier', 'My weeks felt chaotic. I argued often, but still enjoyed seeing friends.'),
      sample('m2', 'm-event2', 'recent', 'This week I kept my commitments and did not argue.'),
      sample('m3', 'm-event3', 'recent', 'I also stopped seeing people and have had little enjoyment or affection lately.', 'complicates')
    ],
    reading: 'You describe steadier commitments and fewer arguments, alongside withdrawal and less enjoyment. I would not call this simply better. It may be worth distinguishing more freedom from more control. What feels different to you?'
  },
  natural: {
    title: 'Growth through friendship', dimension: 'care',
    reports: [
      sample('n1', 'n-event1', 'earlier', 'When I made a mistake, I used to attack myself and push through.'),
      sample('n2', 'n-event2', 'recent', 'Patient friends have helped by example. After a recent mistake, I comforted myself, repaired what I could, and enjoyed the rest of the day. I never did therapy.')
    ],
    reading: 'You describe learning a more caring response through your friends, while still taking responsibility and enjoying life. A named therapy or this app is not required for that development. This is a reported change, not a certificate of complete healing. Does this description fit?'
  },
  missing: {
    title: 'Not enough earlier information', dimension: 'connection',
    reports: [sample('x1', 'x-event1', 'recent', 'I had a good conversation this week.')],
    reading: null
  },
  repeated: {
    title: 'One incident, described twice', dimension: 'flexibility',
    reports: [
      sample('r1', 'r-event1', 'earlier', 'At dinner on Monday, I asked for a pause instead of shouting.'),
      sample('r2', 'r-event1', 'recent', 'I am describing that same Monday dinner again, not a new incident.')
    ],
    reading: null
  }
});
// Fixed corrections for the demo; a real evidence store is not implemented here.
export const CORRECTIONS = freezeDeep({
  b2: { quote: 'Correction: I returned to my evening briefly, then spent most of the night replaying this different disagreement.', assessment: 'complicates' },
  m2: { quote: 'Correction: that steadier week was while I was on leave. I have not tried it with my usual work demands.', assessment: 'complicates' },
  n2: { quote: 'Correction: my friends helped me respond kindly on that occasion, but I still attack myself after other mistakes.', assessment: 'complicates' }
});
const INVITATIONS = ['unset', 'welcome', 'user_initiated', 'do_not_suggest'];
const REFLECTIONS = ['off', 'on_request', 'occasional'];
const THEMES = ['inner', 'spirit'];
const validateChoice = (value, choices) => {
  if (!choices.includes(value)) throw new TypeError('Unknown preview choice');
};
const validateFlag = value => {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean');
};
export function initialState() {
  return {
    closed: false, scenario: 'boundaries', history: false,
    preferences: { inner: 'unset', spirit: 'unset', reflections: 'on_request' },
    withdrawn: {}, corrected: {}, rejected: {}, reviewed: {}, offered: { inner: false, spirit: false },
    reports: [], reflection: null, feedback: '', notice: 'Choose a fictional history and enable its use to try a reflection.',
    invitations: { inner: '', spirit: '' }, asked: false, support: ''
  };
}
const clearReading = state => { state.reflection = null; state.feedback = ''; };
const refreshReports = state => {
  state.reports = state.history ? structuredClone(SCENARIOS[state.scenario].reports)
    .filter(item => !(state.withdrawn[state.scenario] || []).includes(item.id))
    .map(item => (state.corrected[state.scenario] || []).includes(item.id)
      ? { ...item, ...CORRECTIONS[item.id], corrected: true } : item) : [];
};
export function previewInvitation(state, theme, requestedNow = false) {
  validateChoice(theme, THEMES);
  validateFlag(requestedNow);
  return invitationDecision({ preference: state.preferences[theme], requestedNow,
    relevant: true, alreadyOffered: state.offered[theme], safetyClear: true });
}
export function previewReflection(state, requestedNow = true) {
  validateFlag(requestedNow);
  if (state.closed) return { allowed: false, reason: 'PREVIEW_CLOSED' };
  if (state.rejected[state.scenario]) return { allowed: false, reason: 'INTERPRETATION_REJECTED' };
  const scenario = SCENARIOS[state.scenario];
  // Do not silently drop withdrawn counterevidence and reuse the original prose.
  if ((state.withdrawn[state.scenario] || []).length || (state.corrected[state.scenario] || []).length) {
    return { allowed: false, reason: 'SOURCE_CHANGED_REASSESSMENT_REQUIRED' };
  }
  const evidence = state.reports.map(({ id, episodeId, period, assessment }) => ({
    id, episodeId, period, assessment, scope: state.scenario, dimension: scenario.dimension,
    source: 'user_report', status: 'active'
  }));
  return reflectionDecision({ scope: state.scenario, preference: state.preferences.reflections,
    requestedNow, safetyClear: true, historyAllowed: state.history,
    alreadyReviewed: Boolean(state.reviewed[state.scenario]), dimension: scenario.dimension,
    evidence, supportIds: evidence.filter(item => item.assessment === 'supports').map(item => item.id),
    counterIds: evidence.filter(item => item.assessment !== 'supports').map(item => item.id) });
}
export const REASONS = freezeDeep({
  HISTORY_PERMISSION_REQUIRED: 'The fictional history is not enabled. No comparison has been made.',
  REFLECTION_NOT_REQUESTED_OR_ENABLED: 'Your reflection preference does not permit this check-in. You can change it; no change is made for you.',
  NO_REPEAT_PROGRESS_CHECK: 'This example has already been reviewed. No repeated unprompted check-in is shown.',
  DISTINCT_EARLIER_AND_RECENT_EPISODES_REQUIRED: 'There is not enough distinct earlier and recent evidence to describe change. I will not invent a comparison.',
  INTERPRETATION_REJECTED: 'You rejected this reading. It stays withdrawn, even when you revisit this example. Reset this fictional example only to test it again.',
  SOURCE_CHANGED_REASSESSMENT_REQUIRED: 'A source was changed or withdrawn. The previous comparison is cleared and cannot be reused. This scripted preview cannot create a new interpretation.',
  PREVIEW_CLOSED: 'This preview session has ended.'
});

/** Immutable state transitions; changes last only in this page session. */
export function transition(previous, action) {
  if (!action || typeof action.type !== 'string') throw new TypeError('Expected a preview action');
  if (action.type === 'restart') return initialState();
  if (previous.closed) return structuredClone(previous);
  const state = structuredClone(previous);
  switch (action.type) {
    case 'preference': {
      validateChoice(action.key, ['inner', 'spirit', 'reflections']);
      validateChoice(action.value, action.key === 'reflections' ? REFLECTIONS : INVITATIONS);
      state.preferences[action.key] = action.value;
      if (action.key === 'reflections') {
        clearReading(state);
        state.notice = 'Reflection preference changed for this preview only.';
      } else state.invitations[action.key] = '';
      break;
    }
    case 'history':
      validateFlag(action.value);
      state.history = action.value;
      refreshReports(state);
      clearReading(state);
      state.notice = action.value ? 'Fictional reports loaded. Nothing is stored beyond this page session.'
        : 'Active sample reports and the reflection were cleared. The fictional examples remain part of this demo file.';
      break;
    case 'scenario':
      validateChoice(action.id, Object.keys(SCENARIOS));
      state.scenario = action.id;
      refreshReports(state);
      clearReading(state);
      state.notice = 'Different fictional history selected. Previous judgments are not carried into it.';
      break;
    case 'review': {
      const decision = previewReflection(state, action.requestedNow ?? true);
      clearReading(state);
      if (decision.allowed && SCENARIOS[state.scenario].reading) {
        state.reflection = { text: SCENARIOS[state.scenario].reading, sourceIds: state.reports.map(item => item.id),
          mixed: decision.reason === 'TENTATIVE_MIXED_REFLECTION_ONLY' };
        state.reviewed[state.scenario] = true;
        state.notice = 'Scripted, tentative reading of the displayed fictional reports. Not a model evaluation.';
      } else state.notice = REASONS[decision.reason] || 'No supported comparison is available.';
      break;
    }
    case 'clear-reading':
      clearReading(state);
      break;
    case 'correct':
      if (!state.reports.some(item => item.id === action.id) || !Object.hasOwn(CORRECTIONS, action.id)) {
        throw new TypeError('Unknown correctable fictional source');
      }
      state.corrected[state.scenario] = [...new Set([...(state.corrected[state.scenario] || []), action.id])];
      refreshReports(state);
      clearReading(state);
      state.notice = REASONS.SOURCE_CHANGED_REASSESSMENT_REQUIRED;
      break;
    case 'withdraw':
      if (!state.reports.some(item => item.id === action.id)) throw new TypeError('Unknown active source');
      state.withdrawn[state.scenario] = [...(state.withdrawn[state.scenario] || []), action.id];
      refreshReports(state);
      clearReading(state);
      state.notice = REASONS.SOURCE_CHANGED_REASSESSMENT_REQUIRED;
      break;
    case 'reject':
      if (!state.reflection) throw new TypeError('No reading to reject');
      state.rejected[state.scenario] = true;
      clearReading(state);
      state.notice = REASONS.INTERPRETATION_REJECTED;
      break;
    case 'confirm':
      if (!state.reflection) throw new TypeError('No reading to confirm');
      state.feedback = 'Your response is noted in this preview only. Agreement does not make the interpretation a clinical fact.';
      break;
    case 'reset':
      delete state.withdrawn[state.scenario];
      delete state.corrected[state.scenario];
      delete state.rejected[state.scenario];
      delete state.reviewed[state.scenario];
      refreshReports(state);
      clearReading(state);
      state.notice = 'This fictional example was explicitly reset. Your approach preferences are unchanged.';
      break;
    case 'invite': {
      const decision = previewInvitation(state, action.theme, action.requestedNow ?? false);
      const label = action.theme === 'inner' ? 'inner-child work' : 'spiritual exploration';
      state.invitations[action.theme] = decision.allowed
        ? (action.requestedNow ? `Your current request permits ${label} for this conversation only. Your ongoing preference stays unchanged.`
          : `A relevant invitation to ${label} could be offered. You can decline without explanation.`)
        : (decision.reason === 'DO_NOT_REPEAT_INVITATION' ? 'No repeated invitation in this example.'
          : 'No unsolicited suggestion. Other forms of support remain available.');
      if (decision.allowed && !action.requestedNow) state.offered[action.theme] = true;
      break;
    }
    case 'support': {
      validateFlag(action.practice);
      const mode = supportMode({ safetyClear: true, wantsPractice: action.practice, ready: true,
        needsConcreteHelp: !action.practice, alreadyAsked: state.asked });
      if (mode === 'ONE_OPTIONAL_SELF_GUIDANCE_QUESTION') {
        state.asked = true;
        state.support = 'What would you advise someone you love if they felt hurt by a delayed reply? What do you know, and what are you guessing? You do not have to answer before receiving help.';
      } else state.support = 'A delayed reply can hurt without proving that someone does not care. A possible next step is to ask about expectations for contact rather than treating an inferred motive as established. Your hurt and the uncertainty can both be real.';
      break;
    }
    case 'exit': {
      const decision = stepBackDecision({ requestedNow: true, safetyClear: true,
        goalMetReported: false, workablePlanReported: false, wantsReview: false });
      if (decision.mayLeave) return { ...initialState(), closed: true, notice: 'The preview session is cleared.' };
      break;
    }
    default: throw new TypeError('Unknown preview action');
  }
  return state;
}
