import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createChatGptSubscriptionDesktopCdpTransport} from '../src/journal-import/chatgpt-subscription-desktop-cdp.mjs';

function fixture(checkpoint){
 let sent=false;
 // The final answer is captured with the native Copy control through a synthetic clipboard.
 let clip='';
 const clipboard={write:value=>{clip=value;},read:()=>clip};
 const transport=createChatGptSubscriptionDesktopCdpTransport({checkpoint,generationTimeoutMs:5000,clipboard});
 for(const method of ['ensureChatMode','startFreshUnpersonalizedTemporaryChat','ensureModelAndEffort','insertPrompt'])transport[method]=async()=>{};
 // The transport brings its own window to the front first; the synthetic page accepts that.
 const client={send:async()=>({}),call:async fn=>{
  if(fn.name==='selectedToolState')return {selectedCount:0};
  if(fn.name==='attachmentRemoveState')return {count:0};
  if(fn.name==='sendControlState')return {count:1,enabled:true,uploadFailed:false};
  if(fn.name==='clickSendControl'){sent=true;return {ok:true};}
  if(fn.name==='sourceToolState')return {count:0,codes:[],complete:true,external:false,unclassified:false};
  if(fn.name==='responseState')return {userCount:sent?1:0,assistantCount:sent?1:0,assistantText:sent?'{}':'',assistantDomText:sent?'{}':'',stop:false,composerFound:true,workComposerFound:false,composerDisabled:false,toolCue:false,finalAnswerReady:true};
  if(fn.name==='inspectFinalResponseSource')return {roots:1,user_turns:1,copy_controls:1,dom_text:'{}'};
  if(fn.name==='clickFinalResponseCopy'){clip='{}';return true;}
  throw new Error('Unexpected synthetic transport operation');
 }};
 transport.withPage=fn=>fn(client);
 const prompt='Synthetic source-only packet';
 return {transport,input:{prompt,promptSha256:createHash('sha256').update(prompt).digest('hex'),operationKey:'synthetic:checkpoint',modelVisibleLabel:'synthetic-model',effortVisibleLabel:'Pro'},sent:()=>sent};
}

test('preflight checkpoint failure prevents submission and preserves definite-unsent status',async()=>{
 const f=fixture(async()=>{throw new Error('Synthetic persistence failure');});
 await assert.rejects(()=>f.transport.runPacket(f.input),e=>e.submissionStatus==='not_submitted');
 assert.equal(f.sent(),false);
});

test('transport persists observed preflight and submitted context before its completed response',async()=>{
 const events=[];const f=fixture(async e=>events.push(e));
 const response=await f.transport.runPacket(f.input);
 assert.deepEqual(events.map(e=>e.phase),['preflight','submitted','completed']);
 assert.equal(events[0].context.operation_key,'synthetic:checkpoint');
 assert.equal(events[0].context.prompt_sha256,f.input.promptSha256);
 assert.equal(events[0].context.request_id,response.receipt.request_id);
 assert.deepEqual(events[2].response,response);
 assert.equal(response.receipt.incremental_cost_usd,0);
});
