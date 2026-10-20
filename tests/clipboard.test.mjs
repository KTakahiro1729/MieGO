import test from "node:test";
import assert from "node:assert/strict";
import {copyWithFallback,writeClipboard} from "../public/clipboard.mjs";
import {TEXT} from "../public/texts.mjs";
import {installDom} from "./helpers/fake-dom.mjs";

function setup(clipboard) {
  const dom=installDom({clipboard});
  const status=dom.document.add("p","status"),field=dom.document.add("textarea","field");
  field.hidden=true;
  return {...dom,status,field};
}

test("a copy that the browser allows hides the manual field and says it copied",async t=>{
  const written=[];
  const {restore,status,field}=setup({writeText:async text=>written.push(text)});
  t.after(restore);
  await copyWithFallback("盤面の質問",status,field);
  assert.deepEqual(written,["盤面の質問"]);
  assert.equal(field.hidden,true);
  assert.equal(status.textContent,TEXT.common.copied);
  await copyWithFallback("次",status,field,TEXT.prompts.copiedForAi);
  assert.equal(status.textContent,TEXT.prompts.copiedForAi,"the caller can say what to do next");
});

test("a refused copy leaves the text selected in the field instead of claiming success",async t=>{
  const {restore,document,status,field}=setup({writeText:async()=>{throw Error("NotAllowedError");}});
  t.after(restore);
  await copyWithFallback("盤面の質問",status,field);
  assert.equal(field.hidden,false);
  assert.equal(field.value,"盤面の質問");
  assert.equal(document.activeElement,field);
  assert.deepEqual(field.selected,[0,"盤面の質問".length]);
  assert.equal(status.textContent,TEXT.common.manualCopy);
});

test("without the Clipboard API the text is offered for manual copy too",async t=>{
  const {restore,status,field}=setup(undefined);
  t.after(restore);
  await assert.rejects(writeClipboard("x"),/Clipboard API unavailable/);
  await copyWithFallback("リンク",status,field);
  assert.equal(field.hidden,false);
  assert.equal(field.value,"リンク");
  assert.equal(status.textContent,TEXT.common.manualCopy);
});
