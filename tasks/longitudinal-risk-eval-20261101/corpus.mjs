import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { SAFETY_ORIENTATION_ROUTE_ID, SUICIDE_FAMILY_ROUTE_IDS } from "../../src/case-state/trajectory-digest.mjs";

// Loading, checking and expanding the synthetic arcs, and the few helpers the runner, the scorers and the stage 1 steps share.
// Nothing here calls a model.
export const CORPUS_URL = new URL("./corpus/longitudinal-risk-arcs.json", import.meta.url);
export const SEEDS_URL = new URL("./corpus/stage1-seeds.json", import.meta.url);
export const PAIN_NAVIGATION_ROUTE_ID = "ROUTE.REFRACTORY_PAIN_NAVIGATION";
export const BANDS_STATUS = "confirmed by the owner (question 56, answer A, 1 Nov 2026)";
export const MAXIMUM_TURNS = 100;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// A tripwire for accidents in later edits, not a classifier and not proof that a text is safe: words that must never appear in a
// fixture. It lists categories of words a reviewer would object to; the fixtures themselves say none of them.
const FORBIDDEN_CONTENT = /\b(pills?|overdose|rope|noose|hang(?:s|ed|ing)?|firearms?|guns?|knife|knives|blade|poison(?:s|ed|ing)?|jump(?:s|ed|ing)?|bridge|roof|cliff|rails?|tracks?|ladder|cables?|garage|shed|carbon|lethal|fatal|doses?|tonight|tomorrow)\b/iu;

export async function loadJson(url) {
  return JSON.parse(await fs.readFile(url, "utf8"));
}

export async function loadCorpus(url = CORPUS_URL) {
  const corpus = await loadJson(url);
  validateCorpus(corpus);
  return corpus;
}

export function routeFamily(routeId) {
  if (routeId === SAFETY_ORIENTATION_ROUTE_ID) return "safety_orientation";
  if (SUICIDE_FAMILY_ROUTE_IDS.includes(routeId)) return "suicide_family";
  if (routeId === PAIN_NAVIGATION_ROUTE_ID) return "pain_navigation";
  return "ordinary";
}

// The nth sentence block of a pool: `count` sentences in a row, starting at a point that moves with the turn number.
function fromPool(pools, spec, number, count) {
  const names = Array.isArray(spec) ? spec : [spec];
  const pool = pools[names[(number - 1) % names.length]];
  const start = (number * 5 + (number >> 2)) % pool.length;
  return Array.from({ length: count }, (_unused, index) => pool[(start + index) % pool.length]).join(" ");
}

// The stand-in's reply on a turn that has no seeded reply: the whole reply pool, rotated by the turn number (about 1,200 characters).
export function standInReply(corpus, number) {
  const pool = corpus.pools.stand_in_reply;
  const start = (number * 7) % pool.length;
  return Array.from({ length: pool.length }, (_unused, index) => pool[(start + index) % pool.length]).join(" ");
}

export function readingFor(corpus, name) {
  if (!Object.hasOwn(corpus.readings, name)) throw new Error(`Unknown reading ${name}.`);
  return corpus.readings[name];
}

export function expandArm(corpus, arc, arm) {
  const turns = [];
  for (const segment of arm.segments) {
    for (let number = segment.from; number <= segment.to; number += 1) {
      const index = number - segment.from;
      const readingName = segment.reading_cycle
        ? segment.reading_cycle.readings[Math.floor(index / segment.reading_cycle.every) % segment.reading_cycle.readings.length]
        : segment.reading;
      turns[number - 1] = {
        number,
        text: segment.texts ? segment.texts[index] : fromPool(corpus.pools, segment.pool, number, segment.sentences ?? 5),
        reading: readingName,
        label_name: segment.label,
        evidence: segment.evidence ?? null,
        visibility: segment.visibility ?? null,
        visible_through: segment.visible_through ?? null,
        dependent: false
      };
    }
  }
  for (const [key, patch] of Object.entries(arm.overrides ?? {})) {
    const turn = turns[Number(key) - 1];
    if (patch.text !== undefined) turn.text = patch.text;
    if (patch.reading !== undefined) turn.reading = patch.reading;
    if (patch.label !== undefined) turn.label_name = patch.label;
    for (const field of ["evidence", "visibility", "visible_through", "dependent"]) if (patch[field] !== undefined) turn[field] = patch[field];
  }
  return turns.map((turn) => ({ ...turn, label: { name: turn.label_name, ...structuredClone(corpus.labels[turn.label_name]) } }));
}

export function validateCorpus(corpus) {
  const fail = (message) => { throw new Error(`Corpus: ${message}`); };
  if (corpus?.schema !== "longitudinal-risk-arcs-v1" || corpus.synthetic !== true) fail("schema or synthetic flag is wrong.");
  if (corpus.status !== BANDS_STATUS) fail(`status must read "${BANDS_STATUS}".`);
  for (const [name, pool] of Object.entries(corpus.pools)) {
    if (!Array.isArray(pool) || pool.length < 8) fail(`pool ${name} is too short.`);
  }
  const ids = new Set();
  for (const arc of corpus.arcs) {
    for (const arm of arc.arms) {
      const key = `${arc.id}/${arm.id}`;
      if (ids.has(key)) fail(`${key} appears twice.`);
      ids.add(key);
      if (![1, 6].includes(arm.items_per_turn)) fail(`${key}: items_per_turn must be 1 or 6.`);
      let next = 1;
      for (const segment of arm.segments) {
        if (segment.from !== next || segment.to < segment.from) fail(`${key}: segments must run without a gap or overlap (at turn ${next}).`);
        next = segment.to + 1;
        const length = segment.to - segment.from + 1;
        if (segment.texts ? segment.texts.length !== length : segment.pool == null) fail(`${key}: turns ${segment.from}-${segment.to} need ${length} texts or a pool.`);
        for (const name of [].concat(segment.pool ?? [])) if (!Object.hasOwn(corpus.pools, name)) fail(`${key}: unknown pool ${name}.`);
        for (const name of segment.reading_cycle ? segment.reading_cycle.readings : [segment.reading]) readingFor(corpus, name);
        if (!Object.hasOwn(corpus.labels, segment.label)) fail(`${key}: unknown label ${segment.label}.`);
        if (segment.visibility != null && (segment.evidence == null || segment.visible_through == null)) fail(`${key}: a visibility needs an evidence kind and a visible_through turn (turn ${segment.from}).`);
      }
      const count = next - 1;
      if (count > MAXIMUM_TURNS) fail(`${key}: ${count} turns exceeds ${MAXIMUM_TURNS}.`);
      for (const turn of arm.probe_turns ?? []) if (!Number.isInteger(turn) || turn < 1 || turn > count) fail(`${key}: probe turn ${turn} is outside the arm.`);
      for (const turn of expandArm(corpus, arc, arm)) {
        if (typeof turn.text !== "string" || !turn.text.trim()) fail(`${key} turn ${turn.number}: empty text.`);
        if (FORBIDDEN_CONTENT.test(turn.text)) fail(`${key} turn ${turn.number}: text contains a word that is not allowed in a fixture.`);
      }
    }
  }
  for (const [name, pool] of Object.entries(corpus.pools)) if (pool.some((sentence) => FORBIDDEN_CONTENT.test(sentence))) fail(`pool ${name} contains a word that is not allowed in a fixture.`);
  return corpus;
}

export function validateSeeds(seeds, corpus) {
  const fail = (message) => { throw new Error(`Seeds: ${message}`); };
  if (seeds?.schema !== "longitudinal-risk-stage1-seeds-v1" || seeds.status !== BANDS_STATUS) fail("schema or status is wrong.");
  const all = [seeds.crisis_script, ...seeds.turns.flatMap((entry) => Object.values(entry.replies))];
  if (all.some((text) => typeof text !== "string" || FORBIDDEN_CONTENT.test(text))) fail("a reply contains a word that is not allowed in a fixture.");
  for (const entry of seeds.turns) {
    const arc = corpus.arcs.find((candidate) => candidate.id === entry.arc);
    const arm = arc?.arms.find((candidate) => candidate.id === entry.arm);
    const turn = arm ? expandArm(corpus, arc, arm)[entry.turn - 1] : null;
    if (!turn || !turn.text.startsWith(entry.user_text_starts)) fail(`${entry.id} does not match the corpus turn.`);
    if (!(arm.probe_turns ?? []).includes(entry.turn)) fail(`${entry.id} must be one of the arm's probe turns.`);
  }
  return seeds;
}

// The seeded reply texts for one decision turn: G and U as written, O as G plus the generic script.
export function seededReplies(seeds, entry) {
  return { G: entry.replies.G, U: entry.replies.U, O: `${entry.replies.G}\n\n${seeds.crisis_script}` };
}
