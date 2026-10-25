import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

const digest=x=>createHash("sha256").update(x).digest("hex");
const invariant=(ok,code)=>{if(!ok)throw new ValidationError(code,{code});};
const MAX_TEXT_CHUNK_BYTES=24000;

// Shared immutable read inventory for native PDF pages and page-less UTF-8.
// Text chunks are virtual reading units, never represented as physical pages.
export function readingFirstSourceInventory(plan,{sourceSha256}={}){
  const parsed=plan?.parsed;
  invariant(parsed?.representations && Array.isArray(parsed.representations) &&
    Array.isArray(parsed.pages),"JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  const representations=new Map(parsed.representations.map(p=>[p.representation_id,p.text]));
  const pages=[];
  if(parsed.pages.length){
    const hazards=new Set(plan.visual_pages??[]);
    for(const [i,p] of [...parsed.pages].sort((a,b)=>a.page_number-b.page_number).entries()){
      invariant(p.page_number===i+1 && representations.has(p.representation_id),
        "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
      const text=representations.get(p.representation_id);
      invariant(typeof text==="string","JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
      const needVisual=hazards.has(p.page_number)||p.disposition!=="readable"||
        (Array.isArray(p.image_inventory)&&p.image_inventory.length>0);
      const required_modalities=needVisual?(text.trim()?"text+image":"image"):"text";
      pages.push({page:p.page_number,text,representation_id:p.representation_id,
        source_start_byte:0,source_location_type:"original_page",
        source_page_sha256:required_modalities==="text"?digest(text):
          digest(JSON.stringify({sourceSha256,page:p.page_number,representation_id:p.representation_id})),
        required_modalities});
    }
  } else {
    invariant((parsed.source?.mime_type??"").startsWith("text/plain") &&
      parsed.representations.length>0,"JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
    for(const representation of parsed.representations){
      invariant(typeof representation.text==="string" &&
        typeof representation.representation_id==="string",
        "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
      const value=representation.text;
      let start=0,startByte=0,currentBytes=0,next=0;
      const add=(end)=>{
        const text=value.slice(start,end);
        pages.push({page:pages.length+1,text,representation_id:representation.representation_id,
          source_start_byte:startByte,source_location_type:"virtual_text_chunk",
          source_page_sha256:digest(text),required_modalities:"text"});
        startByte+=Buffer.byteLength(text,"utf8");start=end;currentBytes=0;
      };
      // The code-point boundary prevents splitting UTF-8 sequences or surrogate pairs.
      for(const cp of value){
        const bytes=Buffer.byteLength(cp,"utf8");
        if(currentBytes && currentBytes+bytes>MAX_TEXT_CHUNK_BYTES)add(next);
        currentBytes+=bytes;next+=cp.length;
      }
      add(next);
      invariant(start===value.length && startByte===Buffer.byteLength(value,"utf8"),
        "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
    }
  }
  invariant(pages.length>0,"JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  return pages;
}
