export const PUBLIC_GUIDE_REFERENCES = Object.freeze([
  Object.freeze({ id: "inner-child", label: "Inner Child Reparenting", url: "https://innerchild.u-dont-exist.com" }),
  Object.freeze({ id: "somatic", label: "Somatic Therapies", url: "https://somatic.u-dont-exist.com" }),
  Object.freeze({ id: "altered-states", label: "Bad Trips / Altered States", url: "https://badtrips.u-dont-exist.com" }),
  Object.freeze({ id: "hypnosis", label: "Self-Hypnosis", url: "https://hypnosis.u-dont-exist.com" }),
  Object.freeze({ id: "buddhist-meditation", label: "Buddhist Meditation / Nibbana", url: "https://nibbana.u-dont-exist.com" }),
  Object.freeze({ id: "dearmor", label: "Neurological De-Armoring", url: "https://dearmor.u-dont-exist.com" }),
  Object.freeze({ id: "sleep", label: "Sleep", url: "https://sleep.u-dont-exist.com" }),
  Object.freeze({ id: "detox", label: "Physical Health Detox", url: "https://detox.u-dont-exist.com" }),
  Object.freeze({ id: "metta", label: "Metta Meditation", url: "https://love.u-dont-exist.com" }),
  Object.freeze({ id: "anger", label: "Anger with Metta", url: "https://anger.u-dont-exist.com" }),
  Object.freeze({ id: "hearthwork", label: "Hearthwork Peer Counseling", url: "https://hearthwork.u-dont-exist.com" }),
  Object.freeze({ id: "community", label: "Communal Living", url: "https://community.u-dont-exist.com" }),
  Object.freeze({ id: "spiritual-bypassing", label: "Spiritual Bypassing / Goenka", url: "https://goenka.u-dont-exist.com" }),
]);

export function publicGuideReferencePromptBlock() {
  const lines = PUBLIC_GUIDE_REFERENCES.map(({ label, url }) => `- ${label}: ${url}`);
  return `OWNER READING GUIDES (reader-facing; not runtime authority):
${lines.join("\n")}
Referral rules: offer only a directly relevant guide when the user asks to read more or the long-form guide would genuinely answer the question better. Do not dump the catalog. Answer the useful current-turn question first. A guide referral never bypasses safety, medical, legal, substance-use, or other application limits. Public humanized wording may differ from the operational therapy map; new substantive therapy rules still require upstream map/source reconciliation.`;
}
