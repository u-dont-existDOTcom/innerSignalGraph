import { ValidationError } from "../core/errors.mjs";
import { lexicalTerms } from "./graph.mjs";

const invariant=(ok,code)=>{if(!ok)throw new ValidationError(code,{code});};
const add=(map,key,value)=>{
  if(!map.has(key))map.set(key,new Set());
  map.get(key).add(value);
};

/**
 * New reading-first index facets. Every derived term points to the *original
 * quote passage* containing an exact verified source anchor. Neither an
 * unanchored summary nor a model assertion becomes a source quote or event.
 *
 * Input observations are loaded ONLY from the encrypted private journal
 * store after verified source reading/synthesis. No case data goes to Git.
 */
export function buildReadingFirstFacetIndexes({built,observations,sourcePages}){
  invariant(built?.graph?.nodes && Array.isArray(observations) &&
    Array.isArray(sourcePages),"JOURNAL_READING_FACET_INPUT_INVALID");
  const passagesByPage=new Map();
  for(const record of built.graph.nodes){
    if(record.kind!=="passage")continue;
    const page=record.data?.locator?.page;
    if(!Number.isSafeInteger(page))continue;
    if(!passagesByPage.has(page))passagesByPage.set(page,[]);
    passagesByPage.get(page).push(record);
  }
  const textByPage=new Map(sourcePages.map(item=>[item.page,item.text]));
  const terms=new Map(),meta=new Map();
  let facetCount=0;
  let unmapped=0;
  for(const record of observations){
    const page=record?.page;
    const observation=record?.observation;
    const text=textByPage.get(page);
    invariant(typeof text==="string" && observation?.page===page &&
      Array.isArray(observation.exact_source_anchors) &&
      Array.isArray(observation.source_findings) &&
      record.source_page_sha256===observation.source_page_sha256,
      "JOURNAL_READING_FACET_SOURCE_INVALID");
    const pagePassages=passagesByPage.get(page)??[];
    for(const finding of observation.source_findings){
      invariant(typeof finding.statement==="string" && finding.statement.length>0 &&
        Array.isArray(finding.anchor_indices) && finding.anchor_indices.length>0,
        "JOURNAL_READING_FACET_SOURCE_INVALID");
      const hits=new Set();
      for(const idx of finding.anchor_indices){
        const anchor=observation.exact_source_anchors[idx];
        invariant(anchor && Number.isSafeInteger(anchor.start) &&
          Number.isSafeInteger(anchor.end) && anchor.end>anchor.start &&
          text.slice(anchor.start,anchor.end)===anchor.exact_text,
          "JOURNAL_READING_FACET_ANCHOR_MISMATCH");
        const startByte=Buffer.byteLength(text.slice(0,anchor.start),"utf8");
        const endByte=Buffer.byteLength(text.slice(0,anchor.end),"utf8");
        const passages=pagePassages.filter(p=>
          Number.isSafeInteger(p.data?.start_byte) &&
          p.data.start_byte<=startByte && p.data.end_byte>=endByte &&
          typeof p.data.quote==="string" &&
          p.data.quote.includes(anchor.exact_text)
        );
        for(const p of passages)hits.add(p.id);
      }
      // A cross-paragraph or otherwise unmappable anchor is visible as
      // incompleteness; do not invent a different source location.
      if(!hits.size){unmapped++;continue;}
      const tokens=lexicalTerms(finding.statement);
      for(const id of hits){
        for(const term of tokens)add(terms,term,id);
        if(!meta.has(id))meta.set(id,[]);
        meta.get(id).push({
          source_page:page,
          source_evidence_ref:record.private_reference,
          statement:finding.statement,
          required_qualifiers:[...(finding.required_qualifiers??[])],
          status:"provisional_reading_interpretation"
        });
        facetCount++;
      }
    }
  }
  const sorter=(a,b)=>a.localeCompare(b);
  return Object.freeze({
    readingTerms:new Map([...terms].sort(([a],[b])=>sorter(a,b)).map(([k,v])=>[k,[...v].sort(sorter)])),
    readingMeta:new Map([...meta].sort(([a],[b])=>sorter(a,b))),
    stats:{facets:facetCount,unmapped}
  });
}
