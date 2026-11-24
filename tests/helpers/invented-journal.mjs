import { createHash } from "node:crypto";
import { adaptExtractionToGraph, persistGraphGeneration } from "../../src/journal-import/graph.mjs";
import { buildQuoteGeneration, splitQuoteUnits } from "../../src/journal-import/quote-index.mjs";
import { buildQuoteTerms } from "../../src/journal-import/quote-terms.mjs";

// An invented journal of a few hundred paragraphs, English and French, for the tests of the replies' journal search. Nothing in it is
// anyone's: it is put together from the lists below by a seeded generator, so every run reads the same words. The paragraphs share
// their everyday words, as a real journal's do, so a message always shares some word with many of them; the ones a test looks for are
// added by the test.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Mulberry32: a small seeded generator, the same numbers on every run.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const ENGLISH = Object.freeze({
  openings: ["I feel tired today and I don't know what I want", "Today I slept badly and felt heavy all morning", "I feel a bit lost again this week", "Work was long and I stared at the screen",
    "I can't sleep and I think about everything at night", "I felt calm today, almost happy, and I don't know why", "I keep telling myself that things will change", "I don't know what to do with all of this today"],
  doings: ["walked to the {place} with my {person}", "cooked {food} for my {person}", "sat in the {place} and watched the {weather}", "called my {person} about the {thing}", "cleaned the {thing} until evening",
    "read about the {thing} in the {place}", "waited for my {person} near the {place}", "ate {food} alone in the {place}", "fixed the {thing} with my {person}", "thought about the {thing} during the {weather}"],
  endings: ["It felt good and then it was gone.", "I told myself it was only a feeling.", "Nothing much changed after that.", "I want to remember this.", "I wrote it down so it would stop going around.", "Tomorrow is another day."],
  place: ["kitchen", "market", "harbour", "library", "garden", "station", "bakery", "chapel", "meadow", "cinema", "stairwell", "courtyard", "orchard", "viaduct", "allotment", "boathouse"],
  person: ["aunt", "neighbour", "cousin", "teacher", "flatmate", "grandmother", "brother", "colleague", "landlord", "goddaughter"],
  food: ["soup", "lentils", "pancakes", "rhubarb", "dumplings", "porridge", "chestnuts", "omelette"],
  weather: ["rain", "fog", "thunder", "hail", "drizzle", "frost"],
  thing: ["bicycle", "letterbox", "curtain", "accordion", "ladder", "kettle", "wardrobe", "atlas", "lantern", "typewriter", "compass", "mandolin"]
});
const FRENCH = Object.freeze({
  openings: ["Je me sens fatiguée aujourd'hui et je ne sais pas ce que je veux", "J'ai mal dormi et je me sens lourde", "Je ne sais plus quoi faire de tout cela", "Au travail la journée était longue",
    "Je me sens calme aujourd'hui, presque heureuse", "Je pense à tout la nuit et je ne dors pas"],
  doings: ["je suis allée au {place} avec ma {person}", "j'ai préparé {food} pour ma {person}", "j'ai regardé {weather} depuis le {place}", "j'ai appelé ma {person} pour parler du {thing}",
    "j'ai rangé le {thing} jusqu'au soir", "j'ai attendu ma {person} près du {place}", "j'ai réparé le {thing} avec ma {person}"],
  endings: ["C'était bien, puis c'était fini.", "Je me dis que ce n'est qu'une impression.", "Rien n'a changé ensuite.", "Je veux m'en souvenir.", "Demain est un autre jour."],
  place: ["marché", "jardin", "port", "cinéma", "grenier", "verger", "lavoir", "belvédère", "préau", "bocage"],
  person: ["voisine", "cousine", "tante", "collègue", "marraine", "colocataire"],
  food: ["une soupe", "des lentilles", "des crêpes", "un gratin", "des châtaignes", "une omelette"],
  weather: ["la pluie", "le brouillard", "l'orage", "la grêle", "le givre"],
  thing: ["vélo", "rideau", "accordéon", "coffre", "métronome", "paravent", "sablier", "cerf-volant"]
});

/** `size` invented paragraphs, every third one in French, the same for the same seed. */
export function inventedParagraphs({ size = 360, seed = 20261124 } = {}) {
  const next = seeded(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const fill = (words, sentence) => sentence.replace(/\{(\w+)\}/gu, (_, name) => pick(words[name]));
  return Array.from({ length: size }, (_, index) => {
    const words = index % 3 === 2 ? FRENCH : ENGLISH;
    const doing = words === FRENCH
      ? `${fill(words, pick(words.doings))}, puis ${fill(words, pick(words.doings))}`
      : `I ${fill(words, pick(words.doings))}, then I ${fill(words, pick(words.doings))}`;
    return `${pick(words.openings)}. ${doing[0].toUpperCase()}${doing.slice(1)}. ${pick(words.endings)}`;
  });
}

/**
 * The invented journal's pages: ten paragraphs each, in order, one quote per paragraph. `dates` maps a paragraph's place to the date
 * line written above it.
 */
export function inventedPages(paragraphs, { dates = new Map() } = {}) {
  const pages = [];
  for (let start = 0; start < paragraphs.length; start += 10) {
    const text = paragraphs.slice(start, start + 10).map((paragraph, offset) => (dates.has(start + offset) ? `${dates.get(start + offset)}\n\n${paragraph}` : paragraph)).join("\n\n");
    pages.push({ representation_id: `invented:page:${pages.length}`, text: `${text}\n`, page_number: pages.length + 1, parse_status: "readable" });
  }
  return pages;
}

const GENERATIONS = Object.freeze({ "quote-index-v4": 4, "quote-index-v2": 2 });

/**
 * Stores the invented journal as a generation and returns { persisted, graph, passageOf, generation }. `index`:
 * - "quote-index-v4": a quote index with its word list (the forms reading) and dates, as a journal is imported now;
 * - "quote-index-v2": a quote index without a word list (exact words), with dates;
 * - "none": passages only, no quote index.
 * `change(node)` may change a passage before the generation is stored (its lifecycle, or hold its words back); the word list is built
 * from the quotes as they were, so a list can name a passage that may no longer be used. `passageOf(text)` is the passage id of a quote.
 */
export async function persistInventedJournal({ corpusStore, caseId, corpusId, pages, index = "quote-index-v4", change = null, permittedUses = ["archive", "organize_search", "session_use"] }) {
  const generation = `invented-${index}`;
  const sources = Object.fromEntries(pages.map((page) => [page.representation_id, page.text]));
  let graph, extraIndexes = {};
  if (GENERATIONS[index]) {
    const built = buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId: "original:invented", mediaType: "text/plain", representations: pages,
      unitOptions: { minimumBytes: 0 }, version: GENERATIONS[index] });
    graph = built.graph;
    extraIndexes = { quote_meta: built.quoteMeta, quote_months: built.quoteMonths };
  } else {
    const nodes = [], edges = [];
    let order = 0;
    for (const page of pages) {
      const units = splitQuoteUnits({ representationId: page.representation_id, text: page.text, minimumBytes: 0 }).map((unit) => ({ ...unit, source_order: order++ }));
      const part = adaptExtractionToGraph({ caseId, corpusId, generation,
        source: { id: `source:${sha256(page.representation_id).slice(0, 32)}`, representation_id: page.representation_id, original_object_id: "original:invented",
          media_type: "text/plain", byte_length: Buffer.byteLength(page.text), parse_status: "readable", page: page.page_number },
        units, extraction: { schema_version: "1.0", status: "incomplete", assertions: [], entities: [], episodes: [],
          coverage: units.map((unit) => ({ unit_id: unit.unit_id, disposition: "pending", assertion_local_ids: [], reason: "invented" })), requested_context: [] } });
      nodes.push(...part.nodes); edges.push(...part.edges);
    }
    graph = { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation, nodes, edges };
  }
  const passages = graph.nodes.filter((node) => node.kind === "passage");
  const passageOf = (text) => {
    const found = passages.find((node) => node.data.quote === text);
    if (!found) throw new Error("No invented passage holds exactly these words.");
    return found.id;
  };
  if (index === "quote-index-v4") extraIndexes.quote_terms = buildQuoteTerms(passages.map((node) => ({ id: node.id, quote: node.data.quote })));
  if (change) {
    graph = structuredClone(graph);
    const inactive = new Set();
    for (const node of graph.nodes) {
      if (node.kind !== "passage") continue;
      change(node);
      if (["deleted", "revoked"].includes(node.lifecycle)) inactive.add(node.id);
    }
    // A containment edge to a passage that is gone is gone with it, as the graph's contract requires.
    for (const edge of graph.edges) if (inactive.has(edge.to) || inactive.has(edge.from)) edge.lifecycle = "revoked";
  }
  const persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses, extraIndexes, indexRepresentations: GENERATIONS[index] !== undefined });
  return { persisted, graph, passageOf, generation };
}
