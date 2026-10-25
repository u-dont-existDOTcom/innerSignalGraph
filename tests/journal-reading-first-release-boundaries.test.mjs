import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ChatGptSubscriptionDesktopCdpTransport } from "../src/journal-import/chatgpt-subscription-desktop-cdp.mjs";
import { sourceImageValidatorAvailable } from "../src/journal-import/source-image-inspection.mjs";
import { loadJournalInferencePortFromEnvironment } from "../src/journal-import/provider-runtime.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");

test("candidate source-image validator is available only with its pinned local script",()=>{
  assert.equal(sourceImageValidatorAvailable(),true);
});

test("unadapted API provider routes are rejected before credentials or network use",()=>{
  for(const provider of ["openai","anthropic"]){
    assert.throws(()=>loadJournalInferencePortFromEnvironment({
      INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON:JSON.stringify({
        schema_version:1,provider,route_ref:"synthetic",model:"invented",effort:"medium",
        max_external_spend_usd:0,timeout_ms:1000,max_output_tokens:1000
      })
    }),{code:"JOURNAL_INFERENCE_PROVIDER_UNSUPPORTED"});
  }
});

test("stable entrypoint explicitly requires Node versions with source-bound Argon2",async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL("../package.json",import.meta.url),"utf8"));
  assert.equal(manifest.engines.node,">=24 <27");
  const installer=await fs.readFile(new URL("../packaging/install-from-git.sh",import.meta.url),"utf8");
  assert.match(installer,/NODE_MAJOR < 24 \|\| NODE_MAJOR >= 27/);
});
