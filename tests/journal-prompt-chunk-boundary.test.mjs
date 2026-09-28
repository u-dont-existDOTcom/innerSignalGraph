import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatGptSubscriptionDesktopCdpTransport} from '../src/journal-import/chatgpt-subscription-desktop-cdp.mjs';

function simulatedEditor() {
  let text=''; const insertions=[];
  return {
    insertions,
    get text(){return text},
    async call(fn){
      if(fn.name==='composerState')return {found:true,disabled:false,text};
      if(fn.name==='focusComposerAtEnd')return {ok:true};
      throw new Error('Unexpected DOM operation: '+fn.name);
    },
    async send(method,params){
      assert.equal(method,'Input.insertText'); insertions.push(params.text);
      text+=params.text;
      // Observed contenteditable behavior at the end of a partial insertion.
      if(text.endsWith(' '))text=text.slice(0,-1)+'\u00a0';
    }
  };
}

test('packet insertion avoids browser NBSP conversion at an ASCII-space chunk end',async()=>{
  const editor=simulatedEditor();
  const prompt='x'.repeat(8191)+' '+'unchanged suffix';
  const transport=new ChatGptSubscriptionDesktopCdpTransport();
  await transport.insertPrompt(editor,prompt);
  assert.equal(editor.text,prompt);
  assert.equal(editor.insertions.join(''),prompt);
});

test('actual nonbreaking spaces and repeated spaces retain their exact bytes',async()=>{
  const editor=simulatedEditor();
  const prompt='x'.repeat(8189)+'   '+'a\u00a0b  c';
  await new ChatGptSubscriptionDesktopCdpTransport().insertPrompt(editor,prompt);
  assert.equal(editor.text,prompt);
  assert.equal(editor.insertions.join(''),prompt);
});

test('adjusted whitespace boundaries do not split surrogate pairs',async()=>{
  const editor=simulatedEditor();
  const prompt='x'.repeat(8189)+'😀 '+'suffix';
  await new ChatGptSubscriptionDesktopCdpTransport().insertPrompt(editor,prompt);
  assert.equal(editor.text,prompt);
  for(const chunk of editor.insertions){
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk));
  }
});
