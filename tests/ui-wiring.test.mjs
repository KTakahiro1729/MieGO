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
test("when KataGo fails, the 対COM tab names the modes that work without it",()=>{
  assert.match(app,/\$\("startAiNote"\)\.hidden=!\(needsKatago && fallbackMode\)/);
  assert.match(html,/id="startAiNote"[^>]*hidden>[^<]*「1台で打つ」と「対友人」/);
  // The note sits beside the start buttons of every mode, so it follows the 対COM section's visibility.
  assert.match(html,/id="aiSetup"[\s\S]*?<\/section>\s*<p id="startAiNote"/);
  assert.match(css,/#aiSetup\[hidden\]~\.start-note\{display:none\}/);
});
test("iOS neither zooms into the manual copy fields nor on a double tap of a button",()=>{
  // Safari zooms into a focused field under 16px; manipulation drops the double-tap zoom only.
  for(const rule of ["#shareCopyFallback",".illegal-prompt-fallback textarea",".help-copy-fallback"])
    assert.match(css,new RegExp(rule.replace(/[.#]/g,"\\$&")+"\\{[^}]*font-size:16px"));
  assert.match(css,/\nbutton\{[^}]*touch-action:manipulation/);
});
test("states that only screen readers heard are also shown in the notice",()=>{
  // The turn row cuts ページを開き直してください… short, and the player row keeps reading 最強.
  assert.match(app,/\$\("aiMatchStatus"\)\.textContent = TEXT\.ai\.unavailable;\n    showNotice\(TEXT\.ai\.unavailable\);/);
  assert.match(app,/showNotice\(TEXT\.ai\.strongestFailed\)/);
});
test("a friend game's status line says what it waits for, and the sheet the check opened closes",()=>{
  assert.match(app,/async function joinRoom\(\)\{[\s\S]*?\$\("netStatus"\)\.textContent=TEXT\.online\.waitingConnection;\n  try\{/);
  assert.match(app,/callback:token=>\{if\(opened\)closePanels\(\);resolve\(token\);\}/);
  assert.match(app,/onConnected:\(\)=>\{[\s\S]*?TEXT\.online\.retrying\)\$\("saveStatus"\)\.hidden=true;/);
});
test("a dropped friend game says it reconnects by itself, and the opponent's line leaves the connection to the status line",()=>{
  assert.match(app,/room && !connected\?\(reconnecting\?TEXT\.game\.reconnecting:TEXT\.game\.waitingOpponent\)/);
  assert.match(app,/showNotice\(error\.retrying\?TEXT\.online\.retrying:/);
  assert.doesNotMatch(app,/side\.name===TEXT\.game\.opponent\?\$\("netStatus"\)/);
});
