#!/usr/bin/env node
// Developer-only source-evidence binding, not an automatic semantic adequacy classifier.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
 const pos=args.indexOf(name);
 return pos>=0?args[pos+1]:fallback;
};
const root=path.resolve(getArg("--root",defaultRoot));
const indexPath=path.resolve(root,getArg("--index","authoring/concepts/shame.json"));
const want=getArg("--concept",null);
const checkOnly=args.includes("--check");
const readJson=(p)=>JSON.parse(fs.readFileSync(p,"utf8"));
const assert=(v,msg)=>{if(!v)throw new Error(msg);};
try{
 const manifest=readJson(path.join(root,"guides/manifest.json"));
 const index=readJson(indexPath);
 const source=manifest.sources.find((s)=>s.id===index.guideId);
 assert(source,"Guide not registered in manifest");
 assert(index.source.file===source.file,"Indexed source version stale; use the current guide manifest");
 const data=fs.readFileSync(path.join(root,"guides",source.file));
 const sha=createHash("sha256").update(data).digest("hex");
 assert(sha===source.sha256&&sha===index.source.sha256,"Indexed source hash stale or source manifest mismatch");
 const lines=data.toString("utf8").split("\n");
 const map=readJson(path.join(root,"guide-graphs/source-maps",index.guideId+".json"));
 assert(map.file===source.file,"Section map stale; run graph:compile");
 const nodeIds=new Set();
 for(const file of ["inner-child.graph.json","cross-guide.graph.json"]){
  const g=readJson(path.join(root,"guide-graphs/candidates",file));
  for(const n of g.nodes)nodeIds.add(n.id);
 }
 assert(Array.isArray(index.concepts)&&index.concepts.length>0,"No concepts");
 const seen=new Set(),results=[];
 for(const c of index.concepts){
  assert(typeof c.id==="string"&&!seen.has(c.id),"Duplicate concept "+c.id);
  seen.add(c.id);
  assert(["present","partial","related-not-equivalent","unknown"].includes(c.status),c.id+": invalid status");
  assert(Array.isArray(c.evidence)&&c.evidence.length,c.id+": missing evidence");
  assert(Array.isArray(c.nodes)&&c.nodes.length,c.id+": missing graph references");
  for(const id of c.nodes)assert(nodeIds.has(id),c.id+": missing graph node "+id);
  const spans=[];
  for(const e of c.evidence){
   const section=map.sections.find((s)=>s.id===e.section);
   assert(section&&Number.isInteger(section.lineStart)&&Number.isInteger(section.lineEnd),c.id+": missing section "+e.section);
   assert(typeof e.quote==="string"&&e.quote.length>=12,c.id+": invalid quote");
   const content=lines.slice(section.lineStart-1,section.lineEnd).join("\n");
   assert(content.includes(e.quote),c.id+": quote absent from "+e.section+": "+e.quote.slice(0,55));
   const first=lines.findIndex((line,i)=>i>=section.lineStart-1&&i<section.lineEnd&&line.includes(e.quote));
   spans.push({section:e.section,line:first<0?[section.lineStart,section.lineEnd]:[first+1,first+1],quote:e.quote,role:e.role||"evidence"});
  }
  if(c.status==="related-not-equivalent")assert(c.limit&&c.limit.includes("not established"),c.id+": state narrow proof limit");
  results.push({id:c.id,label:c.label,status:c.status,evidence:spans,graphNodes:c.nodes,explanation:c.explanation,limit:c.limit||null});
 }
 if(want)assert(results.some(r=>r.id===want),"Unknown concept "+want);
 const subset=want?results.filter(r=>r.id===want):results;
 console.log(JSON.stringify({ok:true,assurance:"source-citation binding only, not semantic completeness or live model verification",source:{guideId:index.guideId,path:source.file,sha256:sha,lineCount:lines.length},readMode:"manifest-first plus curated cross-section evidence index",conceptsChecked:results.length,concepts:checkOnly?subset.map(({id,status,evidence,graphNodes})=>({id,status,sourceSpans:evidence.map(x=>x.section),graphNodes})):subset},null,2));
}catch(error){console.error(JSON.stringify({ok:false,failure:String(error.message),index:indexPath}));process.exitCode=1;}
