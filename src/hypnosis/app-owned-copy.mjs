export const HYPNOSIS_CONTRACT_VERSION = "hypnosis-components-v1";

export const ROUTE_IDS = Object.freeze([
  "continue_inward",
  "stay_external",
  "end_session"
]);

const COPY = Object.freeze({
  en: Object.freeze({
    gate: Object.freeze({
      title: "Protector choice point",
      intro: "Playback pauses here. Choose Continue inward only for a clear enough yes. For no, unsure, blank, no answer, or wanting more distance, choose Remain at this distance or Finish here.",
      note: "Continued presence, silence, stillness, and lack of objection never count as a selection. Your reviewed target and profile stay unchanged."
    }),
    labels: Object.freeze({
      continue_inward: "Continue inward",
      stay_external: "Remain at this distance",
      end_session: "Finish here"
    }),
    announcements: Object.freeze({
      continue_inward: "You selected Continue inward.",
      stay_external: "You selected Remain at this distance.",
      end_session: "You selected Finish here."
    }),
    endBody: "The session ends here. Nothing else is required from you.",
    wakingReturn: "Press your feet into the floor and move your hands and fingers deliberately. Look around the real room and notice the ordinary objects, light, and sounds around you. Let your posture become more active. You are fully awake, clear, and present. This session is complete."
  })
});

export function appOwnedCopy(language = "en") {
  return COPY[language] ?? COPY.en;
}
