#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = "authoring/PENDING-PUBLIC-GUIDE-CHANGES.md";
const syncPath = "authoring/public-guide-sync.json";
// Non-generated authorities: prompt-bearing orchestration code is deliberately included.
const SEMANTIC_SOURCE = /^(?:guide-graphs\/candidates\/.*\.graph\.json|guides\/owner-amendments\.json|guides\/(?:inner-child-guide(?:-[^/]*)?\.txt|somatic-sequencing-guide\.txt|altered-states-map-source\.txt)|src\/prompts\/.*\.mjs|src\/orchestrator\/(?:context-builder|pending-reply-revision|run-(?:formulated-pipeline|tiered-pipeline|pipeline)|response-contract)\.mjs|src\/core\/guide-references\.mjs|src\/therapy\/constitution\.mjs|src\/guide-graph\/(?:planner|validate|contract)\.mjs|corpus\/graph-cases\/.*\.json|plugins\/inner-signal-therapy\/skills\/inner-signal-therapy\/.*\.md)$/;
const GUIDE_SOURCE = /^guides\/(?:inner-child-guide(?:-[^/]*)?\.txt|somatic-sequencing-guide\.txt|altered-states-map-source\.txt)$/;
const NEW_ENTRY = /^### (PGQ-\d+)\s+—[^\r\n]*$/gm;
const FIELDS = ["Caused by:", "Teaching point:", "Reader need:", "Already covered:", "Where:"];

function fieldValue(body, field) {
  const escaped = field.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const match = body.match(new RegExp("^" + escaped + "[ \\t]*(\\S[^\\r\\n]*)$", "m"));
  return match?.[1]?.trim() ?? null;
}
function entries(queue) {
  const matches=[...queue.matchAll(NEW_ENTRY)];
  return matches.map(match=>{
    const next=matches.find(x=>x.index>match.index)?.index ?? queue.length;
    const h=queue.indexOf("\n## ",match.index+match[0].length);
    const end=h>=0?Math.min(next,h):next;
    return {id:match[1],body:queue.slice(match.index+match[0].length,end)};
  });
}
export function assessGuideChangeProvenance({changedPaths,oldQueue="",newQueue="",prBody=""}) {
  const affected=changedPaths.filter(p=>SEMANTIC_SOURCE.test(p));
  if(!affected.length)return [];
  const errors=[],queueChanged=changedPaths.includes(queuePath);
  const guideChanged=changedPaths.some(p=>GUIDE_SOURCE.test(p));
  const appOnly=/^Guide impact: app-only\s*[—-]\s*\S.{10,}$/mi.test(prBody);
  if(!queueChanged){
    if(guideChanged)errors.push("Canonical guide edit cannot be app-only; update the teaching-point queue.");
    else if(!appOnly)errors.push("Map/guide/prompt changes require a queue update or reasoned app-only declaration.");
    return errors;
  }
  if(!newQueue||oldQueue===newQueue)errors.push("Teaching-point queue did not change in content.");
  const before=entries(oldQueue),after=entries(newQueue),oldById=new Map(before.map(e=>[e.id,e])),ids=new Set(after.map(e=>e.id));
  if(after.length!==ids.size)errors.push("Duplicate PGQ obligation ID.");
  const added=after.filter(e=>!oldById.has(e.id)),removed=before.filter(e=>!ids.has(e.id));
  const revised=after.filter(e=>oldById.has(e.id)&&oldById.get(e.id).body!==e.body);
  if(!added.length&&!removed.length&&!revised.length)errors.push("Queue-only rewrite without added, revised or consumed obligations is insufficient.");
  if(removed.length&&!changedPaths.includes(syncPath))errors.push("Consumed obligations require the public-guide sync-manifest update.");
  for(const entry of [...added,...revised]){
    for(const field of FIELDS){
      const v=fieldValue(entry.body,field);
      if(!v){errors.push(entry.id+" missing "+field);continue;}
      if(v.length<6||/^(?:none|no|n\/a|not applicable|tbd|unknown)$/i.test(v))errors.push(entry.id+" has a non-substantive "+field);
    }
  }
  if((added.length||revised.length)&&!guideChanged){
    for(const entry of [...added,...revised]){
      const coverage=fieldValue(entry.body,"Already covered:");
      if(!coverage||/^(?:none|no|n\/a|nothing close\b|not covered\b|not yet covered\b|missing\b|tbd|unknown)/i.test(coverage)){
        errors.push(entry.id+" requires canonical guide text or a specific already-covered anchor.");
      }
    }
  }
  return errors;
}
function git(...args){return execFileSync("git",args,{cwd:root,encoding:"utf8"}).trimEnd();}
function main(){
  const base=process.env.GUIDE_BASE_SHA;
  if(!/^[a-f0-9]{40}$/.test(base??""))throw Error("GUIDE_BASE_SHA must be an exact PR-base SHA.");
  const changedPaths=git("diff","--name-only",base+"...HEAD").split("\n").filter(Boolean);
  let oldQueue="";try{oldQueue=git("show",base+":"+queuePath);}catch{}
  let newQueue="";
  try{newQueue=fs.readFileSync(path.join(root,queuePath),"utf8");}
  catch{console.error("GUIDE-PROVENANCE: pending guide queue is missing");process.exitCode=1;return;}
  const eventPath=process.env.GITHUB_EVENT_PATH;
  const prBody=eventPath&&fs.existsSync(eventPath)?JSON.parse(fs.readFileSync(eventPath,"utf8"))?.pull_request?.body??"":"";
  const errors=assessGuideChangeProvenance({changedPaths,oldQueue,newQueue,prBody});
  if(errors.length){for(const e of errors)console.error("GUIDE-PROVENANCE: "+e);process.exitCode=1;}
  else console.log("Guide teaching-point / app-only provenance: PASS");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main();
