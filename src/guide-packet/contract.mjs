export const GUIDE_PACKET_FORMAT = "inner-signal-guide-packet-v1";
export const GUIDE_PACKET_SCHEMA_VERSION = 1;
export const GUIDE_PACKET_STATUS = Object.freeze(["candidate", "approved", "installed", "superseded"]);
export const REQUIRED_PACKET_PATHS = Object.freeze([
  "manifest.json",
  "SHA256SUMS.txt",
  "guides/inner-child/canonical-source.html",
  "guides/inner-child/editor-body.txt",
  "guides/inner-child/source-map.json",
  "guides/inner-child/sections.json",
  "guides/somatic/canonical-source.html",
  "guides/somatic/editor-body.txt",
  "guides/somatic/source-map.json",
  "guides/somatic/sections.json",
  "graphs/inner-child.graph.json",
  "graphs/somatic.graph.json",
  "graphs/cross-guide-edges.json",
  "graphs/bundle.json",
  "policy/owner-amendments.json",
  "policy/provenance.json",
  "policy/certainty-and-authority.json",
  "audit/guide-quality-findings.json",
  "audit/owner-decisions.json",
  "README.md"
]);

export function comparePacketRevision(a, b) {
  const left = Number(a ?? 0);
  const right = Number(b ?? 0);
  if (!Number.isInteger(left) || !Number.isInteger(right)) throw new Error("Packet revisions must be integers.");
  return left === right ? 0 : left > right ? 1 : -1;
}

export function safePacketId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(id)) throw new Error("Packet id contains unsupported characters.");
  return id;
}

export const INNER_CHILD_SECTION_ALIASES = Object.freeze({
  "The Chicken-and-Egg Problem": "IC.CHICKEN_EGG",
  "Before You Try to Go Deep": "IC.BEFORE_DEEP",
  "Regulation May Come Before Dialogue": "IC.REGULATION_BEFORE_DIALOGUE",
  "Borrow the Adult Before You Can Be the Adult": "IC.BORROW_ADULT",
  "A Witness Is Enough to Begin": "IC.NEUTRAL_WITNESS",
  "Borrow One Function at a Time": "IC.BORROW_ONE_FUNCTION",
  "Borrow Love and Perspective You Already Have": "IC.BORROW_LOVE_PERSPECTIVE",
  "Become the Adult Apprentice": "IC.ADULT_APPRENTICE",
  "The Three Adult Functions": "IC.THREE_FUNCTIONS",
  "Make the Protector Visible": "IC.PROTECTOR_VISIBLE",
  "When Love Is There but Doesn’t Feel Safe": "IC.LOVE_UNSAFE",
  "Make a Simple Vow": "IC.VOW",
  "When the Adult Voice Feels Fake": "IC.ADULT_VOICE_FAKE",
  "The Parent You Inherited": "IC.INHERITED_PARENT",
  "Start With Whatever Showed Up": "IC.START_WHATEVER",
  "Two Common Protective Patterns": "IC.GUARDS",
  "A Bottom-Up Sequence": "IC.BOTTOM_UP_SEQUENCE",
  "When the Urge to Escape Arrives": "IC.ESCAPE_URGE",
  "Sometimes There Isn’t a Clear Child Yet": "IC.NO_CLEAR_CHILD",
  "From Survival to Experimental Play": "IC.IDENTITY_PLAY",
  "Untangling the Belonging Bargains": "IC.DIFFERENTIATION",
  "Let the Child Be Bad at Things": "IC.CHILD_BAD_THINGS",
  "The Inner Guide Comes Later": "IC.GUIDE_LATER",
  "A Heart-to-Child Loop": "IC.HEART_SOLAR_LOOP",
  "Use Childhood Photographs Without Interrogating Them": "IC.PHOTOS",
  "When Love Still Feels Missing": "IC.LOVE_MISSING",
  "Altered States Can Deepen the Therapy": "IC.ALTERED_STATES",
  "How to Forgive Without Forgetting": "IC.FORGIVENESS",
  "Borrowed Adulthood in Relationship": "IC.RELATIONSHIP",
  "How This Relates to IFS": "IC.IFS"
});

export const SOMATIC_SECTION_ALIASES = Object.freeze({
  "Introduction": "SOM.INTRO",
  "This is a Map, But You Are the Explorer": "SOM.MAP_NOT_LADDER",
  "The Map at a Glance": "SOM.MAP_GLANCE",
  "How Somatic Work and Inner-Child Reparenting Fit Together": "SOM.INNER_CHILD_PARALLEL",
  "Job 1: Build Enough Safety to Stay Present": "SOM.PHASE1",
  "A Useful Starting Modality: Somatic Experiencing": "SOM.SE",
  "Trauma-Sensitive / Restorative Yoga": "SOM.YOGA",
  "Gentle Support: Shaking / TRE": "SOM.GENTLE_SHAKING",
  "Job 2: Daily Regulation and Discharge — Keep the Pressure Low": "SOM.PHASE2",
  "EFT / Tapping": "SOM.EFT",
  "Shaking Qigong / Shaking Medicine": "SOM.SHAKING_QIGONG",
  "The Discharge → Settle Stack": "SOM.STACK",
  "Job 3: Work With Diffuse, Bodily, or Hard-to-Narrate Material": "SOM.PHASE3",
  "A Deeper-Processing Option: Brainspotting": "SOM.BRAINSPOTTING",
  "Post-Brainspotting Integration": "SOM.POST_BRAINSPOTTING",
  "Job 4: Targeted Memory Reconsolidation": "SOM.PHASE4",
  "A Targeted-Memory Option: EMDR": "SOM.EMDR",
  "After EMDR": "SOM.POST_EMDR",
  "Job 5: Meaning-Making and Life Integration": "SOM.PHASE5",
  "Light CBT / Narrative Integration": "SOM.INTEGRATION",
  "How to Judge What Is Helping": "SOM.JUDGE_HELP",
  "Optional High-Intensity State-Shift and Release Practices": "SOM.ADVANCED_RELEASE_SOURCE"
});

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}
