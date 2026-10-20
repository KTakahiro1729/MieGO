import test from "node:test";
import assert from "node:assert/strict";
import {createHelpSheet} from "../public/help-sheet.mjs";
import {newGame,play} from "../public/core.mjs";
import {TEXT} from "../public/texts.mjs";
import {installDom} from "./helpers/fake-dom.mjs";

function setup(t,{clipboard}={}) {
  const dom=installDom({width:390,height:844,clipboard});
  t.after(dom.restore);
  const {document}=dom,add=(tag,id,options)=>document.add(tag,id,options);
  const backdrop=add("div","settingsBackdrop");backdrop.hidden=true;
  const panel=add("aside","helpPanel");panel.hidden=true;
  for(const [topic,title] of [["rules","ルール"],["scoring","採点"]]){
    const details=document.createElement("details");details.id="help-"+topic;details.open=true;
    const summary=document.createElement("summary");summary.textContent=title;
    const body=document.createElement("p");body.textContent=title+"の説明";body.id=topic+"Note";
    details.append(summary,body);panel.append(details);
  }
  for(const id of ["helpToggle","closeHelp","closeHelpPopover","copyRulesPrompt","copyPositionPrompt"])add("button",id);
  add("p","beginnerPromptStatus");add("textarea","beginnerPromptFallback").hidden=true;
  const popover=add("div","helpPopover");popover.hidden=true;
  popover.offsetWidth=280;popover.offsetHeight=120;
  popover.append(document.createElement("h2"));popover.children[0].id="helpPopoverTitle";
  const popoverBody=document.createElement("div");popoverBody.id="helpPopoverBody";popover.append(popoverBody);
  const rulesButton=add("button","rulesHelp",{rect:{top:100,bottom:120,left:40,width:20}});
  rulesButton.setAttribute("data-help","rules");
  const board=add("canvas","board");
  const calls={inert:[],closePanels:0};
  let game=play(newGame(),40);
  const sheet=createHelpSheet({$:dom.$,getGame:()=>game,
    setBackgroundInert:value=>calls.inert.push(value),
    closePanels:()=>{calls.closePanels++;backdrop.hidden=true;}});
  return {...dom,backdrop,panel,popover,popoverBody,rulesButton,board,calls,sheet};
}

test("the header button opens the whole sheet with every topic closed, over its own backdrop",t=>{
  const {$,document,backdrop,panel,calls}=setup(t);
  $("beginnerPromptStatus").textContent="old";
  $("helpToggle").click();
  assert.equal(panel.hidden,false);
  assert.equal(backdrop.hidden,false);
  assert.deepEqual(calls.inert,[true]);
  assert.equal($("helpToggle").getAttribute("aria-expanded"),"true");
  assert.ok(panel.querySelectorAll("details").every(item=>!item.open));
  assert.equal($("beginnerPromptStatus").textContent,"");
  assert.equal(document.activeElement,$("closeHelp"));
  // Closing the sheet it opened alone closes the backdrop too.
  $("helpToggle").click();
  assert.equal(panel.hidden,true);
  assert.equal($("helpToggle").getAttribute("aria-expanded"),"false");
  assert.equal(calls.closePanels,1);
});

test("over another open sheet, help closes alone and Escape closes it first",t=>{
  const {$,document,backdrop,panel,calls}=setup(t);
  backdrop.hidden=false; // the 新規対戦 sheet is open
  $("helpToggle").click();
  assert.deepEqual(calls.inert,[],"the open sheet already made the page inert");
  document.dispatch("keydown",{key:"Escape"});
  assert.equal(panel.hidden,true);
  assert.equal(calls.closePanels,0,"the sheet under help stays open");
  assert.equal(document.activeElement,$("helpToggle"));
  document.dispatch("keydown",{key:"Escape"});
  assert.equal(calls.closePanels,1,"the next Escape closes the sheet under it");
});

test("a local ? shows a copy of its own topic beside it, without the sheet's ids",t=>{
  const {$,document,dispatchWindow,popover,popoverBody,rulesButton,board,panel}=setup(t);
  rulesButton.click();
  assert.equal(popover.hidden,false);
  assert.equal(panel.hidden,true,"only the topic opens, not the sheet");
  assert.equal($("helpPopoverTitle").textContent,"ルール");
  assert.deepEqual(popoverBody.children.map(node=>node.textContent),["ルールの説明"]);
  assert.equal(popoverBody.children[0].id,null,"no id is duplicated");
  assert.equal(document.getElementById("rulesNote").parent.id,"help-rules");
  assert.equal(popover.style.top,"128px","placed just under the button");
  assert.equal(popover.style.left,"12px","kept inside the screen's margin");
  assert.equal(document.activeElement,$("closeHelpPopover"));
  // The same ? closes it and gives focus back.
  rulesButton.click();
  assert.equal(popover.hidden,true);
  assert.equal(document.activeElement,rulesButton);
  // Escape, a tap elsewhere and a layout change each dismiss it.
  rulesButton.click();
  document.dispatch("keydown",{key:"Escape"});
  assert.equal(popover.hidden,true);
  rulesButton.click();
  document.dispatch("pointerdown",{target:popoverBody.children[0]});
  assert.equal(popover.hidden,false,"a tap inside keeps it");
  document.dispatch("pointerdown",{target:board});
  assert.equal(popover.hidden,true);
  rulesButton.click();
  dispatchWindow("resize");
  assert.equal(popover.hidden,true);
});

test("the beginner questions copy a description of the live game for an AI chat",async t=>{
  const written=[];
  const {$}=setup(t,{clipboard:{writeText:async text=>written.push(text)}});
  await $("copyPositionPrompt").onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(written.length,1);
  assert.match(written[0],/1手目まで打ちました/);
  assert.match(written[0],/棋譜URL: https:\/\/miego\.example\/\?sgf=/);
  assert.equal($("beginnerPromptStatus").textContent,TEXT.prompts.copiedForAi);
  await $("copyRulesPrompt").onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(written[1],/初心者/);
});
