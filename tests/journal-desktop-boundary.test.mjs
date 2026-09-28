import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { desktopComposerPlainText, responseState, sourceToolState, createChatGptSubscriptionDesktopCdpTransport } from "../src/journal-import/chatgpt-subscription-desktop-cdp.mjs";
import { createChatGptSubscriptionBrowserProvider } from "../src/providers/chatgpt-subscription-browser.mjs";

const bytes = Buffer.from("synthetic image");
const digest = createHash("sha256").update(bytes).digest("hex");
const image = {kind: "image", bytes, sha256: digest, media_type: "image/png"};
function receipt(input, overrides = {}) {
  return {authenticated:true, fresh_conversation:true, temporary_chat:true,
    unpersonalized:true, memory_disabled:true, custom_instructions_disabled:true,
    plugins_disabled:true, prior_user_turn_count:0, prior_assistant_turn_count:0,
    model_visible_label:"synthetic-model", effort_visible_label:"Pro", incremental_cost_usd:0,
    tools_disabled:false, tools_selected:false, source_bound_visual_tools_permitted:true,
    tool_use_observed:true, source_bound_image_inspection_observed:true,
    source_bound_image_inspection_verified:true, inspected_attachment_sha256s:[digest],
    external_tool_use_observed:false, unclassified_tool_use_observed:false,
    surface_session_id:"synthetic:fresh", request_id:"synthetic:request", assistant_turn_id:"synthetic:turn",
    prompt_sha256:input.promptSha256, ...overrides};
}
async function generate(overrides = {}, stage = "journal:visual_reader", attachments = [image]) {
  const provider=createChatGptSubscriptionBrowserProvider({model:"synthetic-model", effort:"Pro", routeRef:"synthetic:route",
    transport:{runPacket:async input=>({text:"{}",receipt:receipt(input,overrides)})}});
  return provider.generate({system:"Read only the attachment.",user:"{}",outputSchema:{type:"object"},metadata:{stage},attachments,sealed:true});
}

test("source-bound inspection requires a visual packet, exact image binding and explicit verified observations", async () => {
  assert.equal((await generate()).costUsd,0);
  for (const overrides of [
    {source_bound_image_inspection_verified:undefined},
    {source_bound_image_inspection_observed:false},
    {external_tool_use_observed:true}, {external_tool_use_observed:undefined},
    {unclassified_tool_use_observed:true}, {unclassified_tool_use_observed:undefined},
    {inspected_attachment_sha256s:[]}, {inspected_attachment_sha256s:["wrong"]},
    {tools_selected:true}, {tool_use_observed:undefined}
  ]) await assert.rejects(()=>generate(overrides),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
  await assert.rejects(()=>generate({},"journal:extractor"),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
  await assert.rejects(()=>generate({},"journal:visual_reader",[]),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
});

test("tool permission is not evidence; contradictory disabled receipt does not hide observed external use",async()=>{
  await assert.rejects(()=>generate({source_bound_image_inspection_verified:false}),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
  await assert.rejects(()=>generate({tools_disabled:true,external_tool_use_observed:true}),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
  await generate({tool_use_observed:false,tool_use_prohibited:false,source_bound_image_inspection_observed:false,source_bound_image_inspection_verified:false,inspected_attachment_sha256s:[]});
});

test("completed response actions remain a final-answer cue when the desktop disclaimer is absent",()=>{
  const dom=new JSDOM('<aside>Evaluate Debate Sources</aside><main><div class="bg-user-message">packet</div><section><h4 class="sr-only">ChatGPT</h4><div><div class="_MarkdownRoot_x">{}</div></div></section><button aria-label="Regenerate response"></button><button aria-label="Rate response"></button><textarea aria-label="Message ChatGPT"></textarea></main>');
  const previous=globalThis.document;
  const previousElement=globalThis.Element;
  const previousGetComputedStyle=globalThis.getComputedStyle;
  const previousInnerHeight=globalThis.innerHeight;
  const previousInnerWidth=globalThis.innerWidth;
  globalThis.document=dom.window.document;
  globalThis.Element=dom.window.Element;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.innerHeight=1000;
  globalThis.innerWidth=1000;
  dom.window.Element.prototype.getClientRects=function(){return [{width:1,height:1}]};
  dom.window.Element.prototype.getBoundingClientRect=function(){return {width:1,height:1,top:1,left:1,bottom:2,right:2}};
  try{
    const observed=responseState();
    assert.equal(observed.finalAnswerReady,true);
    assert.equal(observed.assistantText,"{}");
    assert.equal(observed.toolCue,false);
    dom.window.document.querySelector('[aria-label="Rate response"]').remove();
    assert.equal(responseState().finalAnswerReady,false);
  }finally{
    globalThis.document=previous;
    globalThis.Element=previousElement;
    globalThis.getComputedStyle=previousGetComputedStyle;
    globalThis.innerHeight=previousInnerHeight;
    globalThis.innerWidth=previousInnerWidth;
    dom.window.close();
  }
});

test("composer preserves paragraphs, blank lines, inline formatting, Unicode and explicit breaks",()=>{
  const dom=new JSDOM('<div id="c"><p>é<span>cho</span></p><p><br class="ProseMirror-trailingBreak"></p><p>line<br>next</p></div><textarea>one\ntwo</textarea>');
  assert.equal(desktopComposerPlainText(dom.window.document.querySelector('#c')),"écho\n\nline\nnext");
  assert.equal(desktopComposerPlainText(dom.window.document.querySelector('textarea')),"one\ntwo");
  dom.window.close();
});

test("composer consumer waits for complete exact insertion and rejects a stale prefix before submission",async()=>{
  const transport=createChatGptSubscriptionDesktopCdpTransport({pageReadyTimeoutMs:1000});
  const prompt="one\n\nélan";
  let inserted=false, polls=0;
  const client={call:async fn=>fn.name==='focusComposerAtEnd'?{ok:true}:{found:true,disabled:false,text:inserted?(++polls===1?"one":prompt):""},send:async(method,args)=>{assert.equal(method,"Input.insertText");assert.equal(args.text,prompt);inserted=true;}};
  await transport.insertPrompt(client,prompt);
  assert.equal(polls,2);
  await assert.rejects(()=>transport.insertPrompt({call:async()=>({found:true,disabled:false,text:"stale"}),send:async()=>assert.fail("must not insert")},prompt),{code:"PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"});
});

test("dedicated desktop target selection never guesses among windows",async()=>{
  const targets=[{id:'one',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://synthetic/one'},{id:'two',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://synthetic/two'}];
  const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify(targets)});
  await assert.rejects(()=>createChatGptSubscriptionDesktopCdpTransport({fetchImpl}).appTarget(),{code:'PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE'});
  assert.equal((await createChatGptSubscriptionDesktopCdpTransport({fetchImpl,targetId:'two'}).appTarget()).id,'two');
});

test("tool audit separates reasoning summaries, retains inspection inputs, and rejects unknown tools",()=>{
 const dom=new JSDOM('<div><button class="activity-header">Worked for 18m</button></div><div><button class="activity-header" aria-expanded="true">Analyzed</button><code class="_CodeContent_x">display(image)</code></div>');
 const previous=globalThis.document;globalThis.document=dom.window.document;
 try {
  assert.deepEqual(sourceToolState(),{count:1,codes:['display(image)'],statuses:['Analyzed'],external:false,unclassified:false,terminalErrorCount:0,recoveredFromTerminalError:false,complete:true});
  dom.window.document.querySelector('button').textContent='Search';
  assert.equal(sourceToolState().external,true);
  dom.window.document.querySelector('button').textContent='Unknown tool';
  assert.equal(sourceToolState().unclassified,true);
 } finally {globalThis.document=previous;dom.window.close();}
});

test('mode readiness tolerates initialization and recognizes the current Work label',async()=>{
 const t=createChatGptSubscriptionDesktopCdpTransport({pageReadyTimeoutMs:1000});let polls=0;const clicks=[];
 t.pointerClick=async(_c,kind,value)=>clicks.push([kind,value]);
 const client={call:async()=>++polls===1?{modeLabel:null,composerFound:false}:polls===2?{modeLabel:'Work',composerFound:false}:{modeLabel:'ChatGPT',composerFound:true}};
 await t.ensureChatMode(client);
 assert.deepEqual(clicks,[['aria','Switch mode, current mode: Work'],['text','ChatGPT']]);
});

test('unfinished tool headers wait for a complete label and code without accepting unknown tools',()=>{
 const dom=new JSDOM('<div><button class="activity-header" aria-expanded="true"></button><code class="_CodeContent_x">display(image)</code></div>');
 const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const header=dom.window.document.querySelector('button');
  for(const label of ['', 'AnalyzingAnalyzed', 'Analyzed\nAnalyzing']){
   header.textContent=label;const observed=sourceToolState();assert.equal(observed.unclassified,false);assert.equal(observed.complete,false);
  }
  header.textContent='Analyzed';assert.equal(sourceToolState().complete,true);
  header.textContent='Unknown tool';assert.equal(sourceToolState().unclassified,true);
  header.textContent='Search';assert.equal(sourceToolState().external,true);
 }finally{globalThis.document=previous;dom.window.close();}
});

test('terminal source-tool errors require a later successful analyzed step',()=>{
 const dom=new JSDOM('<div><button class="activity-header">Analyzed</button><code class="_CodeContent_x">display(image)</code></div><div><button class="activity-header">Analysis errored</button><code class="_CodeContent_x">print(image.size)</code></div><div><button class="activity-header">Analyzed</button><code class="_CodeContent_x">display(image)</code></div>');
 const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  let observed=sourceToolState();
  assert.equal(observed.unclassified,false);
  assert.equal(observed.complete,true);
  assert.equal(observed.terminalErrorCount,1);
  assert.equal(observed.recoveredFromTerminalError,true);
  assert.deepEqual(observed.statuses,['Analyzed','AnalysisErrored','Analyzed']);
  const headers=dom.window.document.querySelectorAll('button');
  headers[2].textContent='Analyzing';
  observed=sourceToolState();
  assert.equal(observed.complete,false);
  assert.equal(observed.recoveredFromTerminalError,false);
  headers[0].textContent='Analysis errored';
  headers[2].textContent='Analysis errored';
  observed=sourceToolState();
  assert.equal(observed.complete,false);
  assert.equal(observed.terminalErrorCount,3);
  headers[2].textContent='Unknown tool';
  assert.equal(sourceToolState().unclassified,true);
 }finally{globalThis.document=previous;dom.window.close();}
});

test('fresh conversation restores the Chat tab when New chat defaults to Work',async()=>{
 const t=createChatGptSubscriptionDesktopCdpTransport({pageReadyTimeoutMs:1000});const clicks=[];let chat=false;
 t.pointerClick=async(_c,kind,value)=>{clicks.push([kind,value]);if(value==='New chat')chat=false;if(value==='Chat')chat=true;};
 t.clearComposerDraft=async()=>assert.equal(chat,true);
 const body='Temporary chat This chat will ignore memory, plugins, and custom instructions';
 const client={call:async fn=>fn.name==='chatSurfaceState'?{modeLabel:'ChatGPT',composerFound:chat,bodyTail:body}:{ok:true}};
 await t.startFreshUnpersonalizedTemporaryChat(client);
 assert.deepEqual(clicks,[['text','New chat'],['text','Chat']]);
});
