import test from "node:test";
import assert from "node:assert/strict";
import {createRetapConfirm,RETAP_MIN_MS} from "../public/confirm-retap.mjs";
import {TEXT} from "../public/texts.mjs";
import {installDom} from "./helpers/fake-dom.mjs";

function setup(t) {
  const dom=installDom();
  t.after(dom.restore);
  const resign=dom.document.add("button","resign",{text:"投了"});
  resign.setAttribute("aria-label","投了する");
  const leave=dom.document.add("button","leave",{text:"退出"});
  const elsewhere=dom.document.add("div","board");
  const clock={ms:0,wait(ms=RETAP_MIN_MS){clock.ms+=ms;}};
  return {...dom,resign,leave,elsewhere,clock,...createRetapConfirm({now:()=>clock.ms})};
}

test("the first tap arms the button in place and only a second tap proceeds",t=>{
  const {resign,clock,confirmByRetap}=setup(t);
  assert.equal(confirmByRetap(resign,"投了しますか？","もう一度押すと投了"),false);
  assert.ok(resign.classList.contains("danger-armed"));
  assert.equal(resign.textContent,TEXT.confirm.armedLabel("投了"));
  assert.equal(resign.getAttribute("aria-label"),"もう一度押すと投了");
  const note=resign.parent.children[resign.parent.children.indexOf(resign)+1];
  assert.equal(note.textContent,TEXT.confirm.retap("投了しますか？"));
  assert.equal(note.getAttribute("role"),"status");
  assert.equal(resign.getAttribute("aria-describedby"),note.id);
  clock.wait();
  assert.equal(confirmByRetap(resign,"投了しますか？","もう一度押すと投了"),true);
  // Proceeding puts the button back as it was.
  assert.equal(resign.classList.contains("danger-armed"),false);
  assert.equal(resign.textContent,"投了");
  assert.equal(resign.getAttribute("aria-label"),"投了する");
  assert.equal(resign.getAttribute("aria-describedby"),null);
  assert.equal(note.parent,null,"the explanation is removed");
});

test("arming a second button disarms the first",t=>{
  const {resign,leave,clock,confirmByRetap}=setup(t);
  confirmByRetap(resign);
  clock.wait();
  assert.equal(confirmByRetap(leave),false);
  assert.equal(resign.classList.contains("danger-armed"),false);
  assert.equal(resign.textContent,"投了");
  assert.ok(leave.classList.contains("danger-armed"));
  clock.wait();
  assert.equal(confirmByRetap(resign),false,"the first button starts over");
});

test("a tap anywhere else disarms; a tap on the armed button does not",t=>{
  const {document,resign,elsewhere,confirmByRetap}=setup(t);
  confirmByRetap(resign,"投了しますか？");
  document.dispatch("pointerdown",{target:resign});
  assert.ok(resign.classList.contains("danger-armed"));
  document.dispatch("pointerdown",{target:elsewhere});
  assert.equal(resign.classList.contains("danger-armed"),false);
  assert.equal(document.getElementById("resign").textContent,"投了");
  assert.equal(resign.parent.children.some(child=>child.id==="armedConfirmNote"),false);
});

test("a label rewritten while armed keeps its ？ and is restored as rewritten",t=>{
  const {resign,leave,confirmByRetap,keepArmedLabel,disarmConfirm}=setup(t);
  confirmByRetap(resign);
  resign.textContent="投了（黒）";
  keepArmedLabel(resign);
  assert.equal(resign.textContent,TEXT.confirm.armedLabel("投了（黒）"));
  leave.textContent="退出する";
  keepArmedLabel(leave);
  assert.equal(leave.textContent,"退出する","a button that is not armed is left alone");
  disarmConfirm();
  assert.equal(resign.textContent,"投了（黒）");
});

test("a double-tap or rapid repeat on the same spot does not confirm",t=>{
  const {resign,clock,confirmByRetap}=setup(t);
  confirmByRetap(resign,"投了しますか？");
  clock.wait(120);
  assert.equal(confirmByRetap(resign,"投了しますか？"),false,"a double-tap's second tap");
  clock.wait(RETAP_MIN_MS-120-1);
  assert.equal(confirmByRetap(resign,"投了しますか？"),false,"still within the minimum interval");
  assert.ok(resign.classList.contains("danger-armed"),"the button stays armed");
  assert.equal(resign.textContent,TEXT.confirm.armedLabel("投了"),"the ？ is not doubled");
  assert.equal(resign.parent.children.filter(child=>child.id==="armedConfirmNote").length,1);
  clock.wait(1);
  assert.equal(confirmByRetap(resign,"投了しますか？"),true,"a deliberate second tap proceeds");
});

test("a held Enter key cannot repeat its way to a confirmation",t=>{
  const {document,resign,elsewhere,confirmByRetap}=setup(t);
  const keydown=(target,repeat)=>{
    const event={target,repeat,defaultPrevented:false,preventDefault(){event.defaultPrevented=true;}};
    document.dispatch("keydown",event);
    return event.defaultPrevented;
  };
  assert.equal(keydown(resign,true),false,"nothing is armed yet");
  confirmByRetap(resign);
  assert.equal(keydown(resign,true),true,"a repeat on the armed button is swallowed");
  assert.equal(keydown(resign,false),false,"a fresh press still goes through");
  assert.equal(keydown(elsewhere,true),false,"repeats elsewhere are left alone");
});
