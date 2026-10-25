// How the journal search splits text into words, and the English words too common to rank by. This module imports nothing, so
// the case store and the local server, which read words through word-forms.mjs, need no npm package. graph.mjs and
// quote-index.mjs re-export both names, so their callers are unchanged.

/** The words of a text, in lower case, each once, in first-appearance order: runs of letters and digits after NFKC. */
export function lexicalTerms(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]+/gu) ?? [])];
}

// Words too common to rank by. A query made only of them still searches by them.
export const QUOTE_STOPWORDS = Object.freeze(new Set(("a about above after again against all am an and any are as at be because been before being "
  + "below between both but by can could d did do does doing down during each few for from further had has have having he her here hers "
  + "herself him himself his how i if in into is it its itself just ll m me more most my myself now o of off on once only or other our ours "
  + "ourselves out over own re s same she should so some such t than that the their theirs them themselves then there these they this those "
  + "through to too under until up ve very was we were what when where which while who whom why will with would you your yours yourself "
  + "yourselves").split(" ")));
