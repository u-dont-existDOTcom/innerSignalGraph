import { ValidationError } from "../core/errors.mjs";
import { QUOTE_TERMS_STATS_KEY } from "./quote-index.mjs";
import { formsReadingTokens } from "./word-forms.mjs";

// The word list of version 3 of the quote index (`quote_terms`): for each term under the forms reading (word-forms.mjs), the
// quotes that hold it, so the search can rank them without reading every quote. It lives apart from quote-index.mjs because it
// reads words with word-forms.mjs, which imports the quote index. Everything here is mechanical and holds the quotes' words only
// as stems; no model reads or writes any of it.

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

/**
 * The `quote_terms` index of some quotes: a Map from key to an array, stored like the other extra indexes of a quote generation.
 * `passages` is an array of { id, quote }, with every id starting with "passage:" and `quote` the text the search check indexes
 * for the passage (the passage node's `data.quote`); a passage listed twice is read once, from its first listing.
 * - Each term, as the forms reading takes it (accents folded, then the English stem, then the French stem; no stop word is left
 *   out), holds [passage_id, uses, length] for every quote that holds it, in passage id order: `uses` is how many tokens of the
 *   quote read as that term, and `length` the quote's token count, stop words included.
 * - `QUOTE_TERMS_STATS_KEY` holds [{ quotes, mean_length }]: how many quotes there are and the mean of their lengths (1 when
 *   there are none or all are empty). No term can be that key, as terms are runs of letters and digits.
 * Keys are in order, so the index's shards cover separate ranges of keys.
 */
export function buildQuoteTerms(passages) {
  invariant(Array.isArray(passages), "QUOTE_TERMS_INPUT_INVALID");
  const byId = new Map();
  for (const passage of passages) {
    invariant(passage !== null && typeof passage === "object" && typeof passage.id === "string" && passage.id.startsWith("passage:")
      && typeof passage.quote === "string", "QUOTE_TERMS_INPUT_INVALID");
    if (!byId.has(passage.id)) byId.set(passage.id, passage.quote);
  }
  const memo = new Map();
  const postings = new Map();
  let tokens = 0;
  for (const id of [...byId.keys()].sort((left, right) => left.localeCompare(right))) {
    const read = formsReadingTokens(byId.get(id), memo);
    tokens += read.length;
    const uses = new Map();
    for (const token of read) uses.set(token, (uses.get(token) ?? 0) + 1);
    for (const [term, count] of uses) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([id, count, read.length]);
    }
  }
  postings.set(QUOTE_TERMS_STATS_KEY, [{ quotes: byId.size, mean_length: tokens / byId.size || 1 }]);
  return new Map([...postings.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/** `buildQuoteTerms` of the passages of a quote generation's graph, each with its quote text, as the search check indexes them. */
export function buildQuoteTermsFromGraph(graph) {
  invariant(graph !== null && typeof graph === "object" && Array.isArray(graph.nodes), "QUOTE_TERMS_INPUT_INVALID");
  return buildQuoteTerms(graph.nodes.filter((node) => node.kind === "passage").map((node) => ({ id: node.id, quote: node.data.quote })));
}
