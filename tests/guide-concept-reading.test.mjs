import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const cli=path.join(root,"scripts/guide-concept-read.mjs");
const indexPath=path.join(root,"authoring/concepts/shame.json");
const run=(args)=>spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
test("active guide shame index resolves to exact evidence across sections and map",()=>{
 const p=run(["--check"]);
 assert.equal(p.status,0,p.stderr);
 const receipt=JSON.parse(p.stdout);
 assert.equal(receipt.ok,true);
 assert.equal(receipt.conceptsChecked,11);
 assert.equal(receipt.source.path,"inner-child-guide-2026-10-30-r8.txt");
 assert.ok(receipt.concepts.some(x=>x.id==="rejection-is-real"));
 assert.ok(receipt.concepts.some(x=>x.id==="imagery-related-not-identical"&&x.status==="related-not-equivalent"));
});
function badVariant(edit){
 const contents=JSON.parse(fs.readFileSync(indexPath,"utf8"));
 edit(contents);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"inner-signal-reading-"));
 try{
  const file=path.join(dir,"index.json");
  fs.writeFileSync(file,JSON.stringify(contents));
  return run(["--check","--index",file]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test("obsolete guide version refuses citation even if old prose remains",()=>{
 const p=badVariant(x=>{x.source.file="inner-child-guide-2026-09-07.txt";});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/stale/);
});
test("invented or lost quote refuses a coverage receipt",()=>{
 const p=badVariant(x=>{x.concepts[0].evidence[0].quote="This invented sentence is definitely in the guide";});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/quote absent/);
});
test("map references are not certified from a nonexistent node",()=>{
 const p=badVariant(x=>{x.concepts[0].nodes=["IC.NONEXISTENT"];});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/missing graph node/);
});
test("related technique is not automatically declared equivalent",()=>{
 const p=badVariant(x=>{const c=x.concepts.find(c=>c.id==="imagery-related-not-identical");delete c.limit;});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/narrow proof limit/);
});
