import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
const dir=new URL("../public/",import.meta.url);
const html=readFileSync(new URL("index.html",dir),"utf8");
const app=readFileSync(new URL("app.mjs",dir),"utf8");
const css=readFileSync(new URL("style.css",dir),"utf8");
const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
test("every $(id) lookup in UI modules names an element in index.html",()=>{
  // A removed element left behind as $("x").prop=... throws and aborts the handler.
  for(const file of readdirSync(dir).filter(f=>f.endsWith(".mjs") && !f.includes("bundle"))){
    const source=readFileSync(new URL(file,dir),"utf8");
    for(const [,id] of source.matchAll(/\$\("([^"]+)"\)/g))
      assert.ok(ids.has(id),file+" references missing #"+id);
  }
});
test("saved-game import, SGF export and resume controls are wired",()=>{
  assert.match(app,/\$\("historyImportFile"\)\.onchange=/);
  assert.match(app,/\$\("shareSgf"\)\.onclick=exportSharedSGF/);
  assert.match(app,/\$\("reviewContinue"\)\.onclick=\(\)=>canResumeSelectedReview\(\)\?resumeSelectedReview\(\):atLiveLatest\(\)\?leaveBoardReview\(\):openContinuePanel\(\)/);
});
test("sheets make the board and header inert while open",()=>{
  assert.match(app,/function openPanel\(kind\) \{\n  setBackgroundInert\(true\);/);
  assert.match(app,/function closePanels\(\) \{\n  resetArmedButtons\(\);\n  setBackgroundInert\(false\);/);
});
test("game errors use the inline notice, never a blocking alert",()=>{
  assert.doesNotMatch(app,/\balert\(error/);
  assert.match(css,/\.save-status\{position:fixed/);
});
test("endgame advice never claims 'not yet' until KataGo has evaluated a position",()=>{
  // endgameHint reports 確認中／判定できません instead (see tests/endgame.test.mjs).
  assert.match(app,/endgameHint\(game,endgameAdvisor,\{\s*unavailable:fallbackMode/);
});
test("states that only screen readers heard are also shown in the notice",()=>{
  // The turn row cuts ページを開き直してください… short, and the player row keeps reading 最強.
  assert.match(app,/\$\("aiMatchStatus"\)\.textContent = TEXT\.ai\.unavailable;\n    showNotice\(TEXT\.ai\.unavailable\);/);
  assert.match(app,/showNotice\(TEXT\.ai\.strongestFailed\)/);
});
test("a friend game's status line says what it waits for, and the sheet the check opened closes",()=>{
  assert.match(app,/async function joinRoom\(\)\{[\s\S]*?\$\("netStatus"\)\.textContent=TEXT\.online\.waitingConnection;\n  try\{/);
  assert.match(app,/callback:token=>\{if\(opened\)closePanels\(\);resolve\(token\);\}/);
  assert.match(app,/onConnected:\(\)=>\{[\s\S]*?TEXT\.online\.requestFailed\)\$\("saveStatus"\)\.hidden=true;/);
});
test("a friend game offers もう一局, which waits until the other player presses it too",()=>{
  assert.match(app,/\$\("newMatch"\)\.hidden=!isFinished;/);
  assert.match(app,/if\(room\)\{\n    if\(connected\)apply\(\{type:"rematch",color:myOnlineColor\(\)/);
  assert.match(app,/rematchAsked\?TEXT\.online\.rematchWaiting:TEXT\.game\.rematchNote/);
});
